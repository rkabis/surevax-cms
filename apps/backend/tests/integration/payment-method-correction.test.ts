/**
 * Integration tests for "correct a posted payment's method" (fc4c624).
 *
 * `correctPaymentMethod` voids the original payment row and inserts a
 * replacement via `addPaymentTx`, in one tenant transaction, so the bill, its
 * items, and its BIR receipt number stay untouched: only the money leg moves.
 *
 * Coverage:
 *   1. amount_paid / amount_outstanding invariance across a correction.
 *   2. The BIR receipt_no survives a correction (built through addPayment so
 *      a real receipt gets allocated, since seeded transactions may carry a
 *      null one).
 *   3. Drawer reattribution: the replacement lands in the CURRENTLY open
 *      session, the voided original keeps whatever session it originally had
 *      (proved with a dedicated open-then-closed-then-reopened session at a
 *      branch with no seeded drawer, so the shared HST seed session used by
 *      other tests is never touched).
 *   4. The approval gate is direction based: Cash to non-Cash above the
 *      manager threshold is gated; below it, or any other direction, is not.
 *   5. A Credit payment cannot be corrected in either direction.
 *   6. Refusals: NO_CHANGE, ALREADY_VOIDED, INVALID_STATE (Voided parent).
 *   7. Reference-number reuse across a correction and its reversal, the case
 *      the partial unique index's `voided_at IS NULL` clause exists for.
 *   8. The ledger keeps showing the voided row (affectsBalance false) while
 *      running totals, balance, and credit are unaffected.
 *
 * These call `createTransaction` / `addPayment` / `correctPaymentMethod` /
 * `applyPrepayment` directly (Drizzle pool, so `withRollback` does not
 * apply); created rows are cleaned up in `afterAll`. Modeled on
 * `transactions-multi-patient.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import { db } from '../../src/shared/db/index.js'
import { branches, users } from '../../src/shared/db/schema.js'
import {
  createTransaction,
  addPayment,
  correctPaymentMethod,
  applyPrepayment,
  getPatientCredit,
} from '../../src/modules/transactions/db.js'
import { getPatientLedger, getPatientBalance } from '../../src/modules/patient_accounts/db.js'

const TENANT = 'SVX'
// Same seeded patient the multi-patient test uses: active consent, no
// completed clinical order anywhere in the fixture set, so the D2
// branch-invariant trigger admits it at ANY branch (HST or TMG).
const PATIENT = 'PAT_AAAAAAA1'
const SVC_EXPENSIVE = 'ARVBOOSTER_IM' // 1500.00, above the PHP 1,000 manager threshold
const SVC_CHEAP = 'LAB_GLUCOSE_FBS' // 95.00, below the threshold, standalone (non-bundle) lab test

const pgClient = postgres(process.env['DATABASE_URL']!)

let hstBranchId = 0
let tmgBranchId = 0
let adminUserId = 0
let branchUserId = 0
const createdTxnDisplayIds: string[] = []
const createdDrawerSessionIds: number[] = []

/** Run a fn inside a committed tx with the RLS/audit GUCs set (app role). */
async function withGucs<T>(fn: (sql: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return pgClient.begin(async (sql) => {
    await sql`select set_config('app.current_tenant_id', ${TENANT}, true)`
    await sql`select set_config('app.current_user_id', ${String(adminUserId)}, true)`
    await sql`select set_config('app.current_branch_id', '', true)`
    return fn(sql as unknown as postgres.TransactionSql)
  }) as Promise<T>
}

type PaymentRow = {
  id: number
  display_id: string
  method: string
  amount: string
  voided_at: string | null
  replaced_by_payment_id: number | null
  cash_drawer_session_id: number | null
  reference_number: string | null
}

async function loadPayment(displayId: string): Promise<PaymentRow> {
  const rows = await withGucs(
    (sql) =>
      sql<PaymentRow[]>`
        SELECT id, display_id, method, amount::text AS amount, voided_at,
               replaced_by_payment_id, cash_drawer_session_id, reference_number
        FROM payments
        WHERE tenant_id = ${TENANT} AND display_id = ${displayId}
      `,
  )
  const row = rows[0]
  if (!row) throw new Error(`payment not found: ${displayId}`)
  return row
}

type TxnRow = {
  amount_paid: string
  amount_outstanding: string
  status: string
  receipt_no: string | null
}

async function loadTxn(displayId: string): Promise<TxnRow> {
  const rows = await withGucs(
    (sql) =>
      sql<TxnRow[]>`
        SELECT amount_paid::text AS amount_paid, amount_outstanding::text AS amount_outstanding,
               status, receipt_no
        FROM transactions
        WHERE tenant_id = ${TENANT} AND display_id = ${displayId}
      `,
  )
  const row = rows[0]
  if (!row) throw new Error(`transaction not found: ${displayId}`)
  return row
}

/** Create a single-item, single-patient transaction and remember it for cleanup. */
async function makeTransaction(branchId: number, serviceId: string, quantity = 1): Promise<string> {
  const res = await createTransaction({
    tenantId: TENANT,
    userId: adminUserId,
    branchId,
    moneyCaller: { kind: 'internal' },
    payload: { patientId: PATIENT, items: [{ serviceId, quantity }] },
  })
  expect(res.ok).toBe(true)
  if (!res.ok) throw new Error(`createTransaction failed: ${res.error}`)
  createdTxnDisplayIds.push(res.id)
  return res.id
}

beforeAll(async () => {
  const hst = await db.select({ id: branches.id }).from(branches).where(eq(branches.code, 'HST'))
  if (!hst[0]) throw new Error('HST branch not found: run pnpm setup first')
  hstBranchId = hst[0]!.id

  const tmg = await db.select({ id: branches.id }).from(branches).where(eq(branches.code, 'TMG'))
  if (!tmg[0]) throw new Error('TMG branch not found: run pnpm setup first')
  tmgBranchId = tmg[0]!.id

  const admin = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'admin@surevax.com'))
  if (!admin[0]) throw new Error('admin user not found: run pnpm setup first')
  adminUserId = admin[0]!.id

  // A SECOND user, so the attribution test can prove a correction made by one
  // person does not reassign the collection away from the one who took it.
  const branchUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'branch-main@surevax.com'))
  if (!branchUser[0]) throw new Error('branch user not found: run pnpm setup first')
  branchUserId = branchUser[0]!.id
})

afterAll(async () => {
  await withGucs(async (sql) => {
    if (createdTxnDisplayIds.length > 0) {
      const ids = sql(createdTxnDisplayIds)
      await sql`DELETE FROM payments WHERE transaction_id IN (SELECT id FROM transactions WHERE display_id IN ${ids})`
      await sql`DELETE FROM transaction_items WHERE transaction_id IN (SELECT id FROM transactions WHERE display_id IN ${ids})`
      await sql`DELETE FROM transactions WHERE display_id IN ${ids}`
    }
    if (createdDrawerSessionIds.length > 0) {
      const sessionIds = sql(createdDrawerSessionIds)
      await sql`DELETE FROM cash_drawer_sessions WHERE id IN ${sessionIds}`
    }
  })
  await pgClient.end()
})

describe('correctPaymentMethod', () => {
  it('leaves amount_paid and amount_outstanding byte-identical across a correction', async () => {
    // Below the manager threshold on purpose: this test is about the
    // amount_paid/amount_outstanding invariant, not the approval gate (that
    // direction is covered separately below).
    const txnId = await makeTransaction(hstBranchId, SVC_CHEAP)
    const paid = await addPayment({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      moneyCaller: { kind: 'internal' },
      transactionDisplayId: txnId,
      method: 'Cash',
      amount: '95.00',
    })
    expect(paid.status).toBe('Paid')

    const before = await loadTxn(txnId)
    expect(before.status).toBe('Paid')
    expect(before.amount_paid).toBe('95.00')
    expect(before.amount_outstanding).toBe('0.00')

    const result = await correctPaymentMethod({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      moneyCaller: { kind: 'internal' },
      transactionDisplayId: txnId,
      paymentDisplayId: paid.id,
      newMethod: 'GCash',
      reason: 'Cashier mis-keyed the tender type',
    })
    expect(result.status).toBe('Paid')

    const after = await loadTxn(txnId)
    expect(after.status).toBe('Paid')
    expect(after.amount_paid).toBe(before.amount_paid)
    expect(after.amount_outstanding).toBe(before.amount_outstanding)

    const original = await loadPayment(paid.id)
    expect(original.voided_at).not.toBeNull()
    expect(original.replaced_by_payment_id).not.toBeNull()

    const replacement = await loadPayment(result.replacementPaymentId)
    expect(replacement.id).toBe(original.replaced_by_payment_id)
    expect(replacement.method).toBe('GCash')
    expect(replacement.voided_at).toBeNull()

    const allRows = await withGucs(
      (sql) =>
        sql<{ count: string }[]>`
          SELECT COUNT(*)::text AS count FROM payments
          WHERE tenant_id = ${TENANT}
            AND transaction_id = (SELECT id FROM transactions WHERE display_id = ${txnId})
        `,
    )
    expect(allRows[0]!.count).toBe('2')

    const liveRows = await withGucs(
      (sql) =>
        sql<{ count: string }[]>`
          SELECT COUNT(*)::text AS count FROM payments
          WHERE tenant_id = ${TENANT}
            AND transaction_id = (SELECT id FROM transactions WHERE display_id = ${txnId})
            AND voided_at IS NULL
        `,
    )
    expect(liveRows[0]!.count).toBe('1')
  })

  it('preserves the BIR receipt_no across a correction', async () => {
    const txnId = await makeTransaction(hstBranchId, SVC_EXPENSIVE)
    const paid = await addPayment({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      moneyCaller: { kind: 'internal' },
      transactionDisplayId: txnId,
      method: 'GCash',
      amount: '1500.00',
    })
    expect(paid.status).toBe('Paid')
    expect(paid.receiptNo).not.toBeNull()
    const receiptBefore = paid.receiptNo

    // GCash to Maya is a non-Cash to non-Cash direction: never gated,
    // regardless of amount (case 4 covers the gate itself).
    const result = await correctPaymentMethod({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      moneyCaller: { kind: 'internal' },
      transactionDisplayId: txnId,
      paymentDisplayId: paid.id,
      newMethod: 'Maya',
      reason: 'Patient actually paid via Maya, not GCash',
    })

    expect(result.receiptNo).not.toBeNull()
    expect(result.receiptNo).toBe(receiptBefore)

    const after = await loadTxn(txnId)
    expect(after.receipt_no).toBe(receiptBefore)
  })

  it('corrects a Paid transaction that has no receipt_no without tripping immutability', async () => {
    // Regression: seeded and legacy rows can sit at status Paid with a NULL
    // receipt_no (BIR allocation only happens on the Paid TRANSITION). The
    // reissue re-enters addPaymentTx on an already-Paid row, and it used to
    // see `nextStatus === 'Paid' && !txn.receiptNo`, allocate a receipt, and
    // UPDATE an immutable transaction. The 0004 trigger then rejected the
    // whole correction with a bare 500: "Paid transactions are immutable".
    // A reissue is not a new Paid transition, so it must not mint a receipt.
    const txnId = await makeTransaction(hstBranchId, SVC_CHEAP)
    const paid = await addPayment({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      moneyCaller: { kind: 'internal' },
      transactionDisplayId: txnId,
      method: 'GCash',
      amount: '95.00',
    })
    expect(paid.status).toBe('Paid')

    // Force the legacy shape: Paid with no receipt. Clearing receipt_no is
    // itself blocked by the immutability trigger, so disable it for this one
    // statement rather than reaching for a superuser session.
    await withGucs(async (sql) => {
      await sql`ALTER TABLE transactions DISABLE TRIGGER trg_transactions_immutable`
      await sql`UPDATE transactions SET receipt_no = NULL
                 WHERE tenant_id = ${TENANT} AND display_id = ${txnId}`
      await sql`ALTER TABLE transactions ENABLE TRIGGER trg_transactions_immutable`
    })
    expect((await loadTxn(txnId)).receipt_no).toBeNull()

    const result = await correctPaymentMethod({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      moneyCaller: { kind: 'internal' },
      transactionDisplayId: txnId,
      paymentDisplayId: paid.id,
      newMethod: 'Maya',
      reason: 'Correcting a legacy Paid bill that never got a receipt number',
    })

    expect(result.status).toBe('Paid')
    // No receipt is invented for a row that never had one.
    expect(result.receiptNo).toBeNull()

    const after = await loadTxn(txnId)
    expect(after.receipt_no).toBeNull()
    expect(after.amount_paid).toBe('95.00')
    expect(after.amount_outstanding).toBe('0.00')
  })

  it('keeps the original receiver and receipt time on the replacement', async () => {
    // Only the METHOD was mis-recorded: the money still arrived when it
    // arrived, from whoever took it. If the replacement inherited the
    // corrector instead, shifts.getCurrentShift (which filters on
    // received_by_id + received_at) would move the amount off the collecting
    // cashier's total and onto the corrector's.
    const txnId = await makeTransaction(hstBranchId, SVC_CHEAP)
    const paid = await addPayment({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      moneyCaller: { kind: 'internal' },
      transactionDisplayId: txnId,
      method: 'GCash',
      amount: '95.00',
    })

    // Raw postgres-js handle: bigint columns arrive as strings here (the OID 20
    // coercion is configured on the Drizzle client, not this one), so compare
    // through Number().
    const before = await withGucs(
      (sql) => sql<{ received_by_id: string; received_at: Date }[]>`
        SELECT received_by_id, received_at FROM payments
        WHERE tenant_id = ${TENANT} AND display_id = ${paid.id}
      `,
    )
    const original = before[0]
    if (!original) throw new Error('original payment not found')

    const result = await correctPaymentMethod({
      tenantId: TENANT,
      userId: branchUserId,
      branchId: hstBranchId,
      moneyCaller: { kind: 'internal' },
      transactionDisplayId: txnId,
      paymentDisplayId: paid.id,
      newMethod: 'Maya',
      reason: 'A different user corrects a payment someone else received',
    })

    const after = await withGucs(
      (sql) => sql<{ received_by_id: string; received_at: Date; created_by_id: string }[]>`
        SELECT received_by_id, received_at, created_by_id FROM payments
        WHERE tenant_id = ${TENANT} AND display_id = ${result.replacementPaymentId}
      `,
    )
    const replacement = after[0]
    if (!replacement) throw new Error('replacement payment not found')

    expect(Number(replacement.received_by_id)).toBe(Number(original.received_by_id))
    expect(replacement.received_at.getTime()).toBe(original.received_at.getTime())
    // The corrector is still captured, just not as the receiver.
    expect(Number(replacement.created_by_id)).toBe(branchUserId)
    expect(Number(replacement.created_by_id)).not.toBe(Number(original.received_by_id))
  })

  it('refuses to silently assign a legacy payment with no receiver to the corrector', async () => {
    const txnId = await makeTransaction(hstBranchId, SVC_CHEAP)
    const paid = await addPayment({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      moneyCaller: { kind: 'internal' },
      transactionDisplayId: txnId,
      method: 'GCash',
      amount: '95.00',
    })

    await withGucs(
      (sql) => sql`
        UPDATE payments SET received_by_id = NULL
        WHERE tenant_id = ${TENANT} AND display_id = ${paid.id}
      `,
    )

    await expect(
      correctPaymentMethod({
        tenantId: TENANT,
        userId: branchUserId,
        branchId: hstBranchId,
        moneyCaller: { kind: 'internal' },
        transactionDisplayId: txnId,
        paymentDisplayId: paid.id,
        newMethod: 'Maya',
        reason: 'Legacy payment has no accountable receiver',
      }),
    ).rejects.toMatchObject({ code: 'PAYMENT_RECEIVER_UNKNOWN', httpStatus: 409 })

    const original = await loadPayment(paid.id)
    expect(original.voided_at).toBeNull()
    expect(original.replaced_by_payment_id).toBeNull()
  })

  it('attributes the replacement to the currently-open drawer session, never a closed one', async () => {
    // TMG has no seeded open drawer session (only HST does), so we can open
    // and close our own sessions here without touching state other
    // concurrently-running tests in this file (or other files, run
    // sequentially per vitest.config.ts) rely on. `cash_drawer_sessions` is
    // tenant-scoped and audited, so these writes go through withGucs (raw SQL
    // with the tenant/user GUCs set) rather than the bare Drizzle pool.
    const [sessionA] = await withGucs(
      (sql) =>
        sql<{ id: number }[]>`
          INSERT INTO cash_drawer_sessions
            (display_id, tenant_id, user_id, branch_id, state, opening_float, created_by_id)
          VALUES (${`CSH_TEST${Date.now().toString(36).toUpperCase().slice(-4)}A`}, ${TENANT},
                  ${adminUserId}, ${tmgBranchId}, 'Open', '1000.00', ${adminUserId})
          RETURNING id
        `,
    )
    if (!sessionA) throw new Error('failed to open session A')
    createdDrawerSessionIds.push(sessionA.id)

    const txnId = await makeTransaction(tmgBranchId, SVC_CHEAP)
    const paid = await addPayment({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: tmgBranchId,
      moneyCaller: { kind: 'internal' },
      transactionDisplayId: txnId,
      method: 'Cash',
      amount: '95.00',
    })
    expect(paid.status).toBe('Paid')

    const originalBefore = await loadPayment(paid.id)
    expect(originalBefore.cash_drawer_session_id).toBe(sessionA.id)

    // Close session A and open a fresh session B: simulates end-of-day
    // reconciliation happening between the original payment and its later
    // correction.
    await withGucs(
      (sql) =>
        sql`UPDATE cash_drawer_sessions SET state = 'Closed', closed_at = now() WHERE id = ${sessionA.id}`,
    )

    const [sessionB] = await withGucs(
      (sql) =>
        sql<{ id: number }[]>`
          INSERT INTO cash_drawer_sessions
            (display_id, tenant_id, user_id, branch_id, state, opening_float, created_by_id)
          VALUES (${`CSH_TEST${Date.now().toString(36).toUpperCase().slice(-4)}B`}, ${TENANT},
                  ${adminUserId}, ${tmgBranchId}, 'Open', '1000.00', ${adminUserId})
          RETURNING id
        `,
    )
    if (!sessionB) throw new Error('failed to open session B')
    createdDrawerSessionIds.push(sessionB.id)

    // 95.00 is well under the manager threshold, so Cash to GCash proceeds
    // without an approval gate here.
    const result = await correctPaymentMethod({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: tmgBranchId,
      moneyCaller: { kind: 'internal' },
      transactionDisplayId: txnId,
      paymentDisplayId: paid.id,
      newMethod: 'GCash',
      reason: 'Correcting tender type after drawer close',
    })

    const replacement = await loadPayment(result.replacementPaymentId)
    expect(replacement.cash_drawer_session_id).toBe(sessionB.id)

    const originalAfter = await loadPayment(paid.id)
    expect(originalAfter.cash_drawer_session_id).toBe(sessionA.id)
    expect(originalAfter.cash_drawer_session_id).not.toBe(sessionB.id)
  })

  describe('corrections are never approval-gated', () => {
    it('allows Cash to GCash ABOVE the old manager threshold with no approval', async () => {
      // The owner's standing decision (2026-07-06) is that record corrections
      // are inline, warned and logged, NOT an approval queue: approval_requests
      // stays reserved for the void and refund money thresholds. This test used
      // to assert the opposite (APPROVAL_REQUIRED at 1500.00) and is inverted
      // deliberately. The gate also routed to a BranchAdmin role no real user
      // holds, so on the shared Branch login it was an unresolvable dead end.
      const txnId = await makeTransaction(hstBranchId, SVC_EXPENSIVE) // 1500.00 > 1000.00
      const paid = await addPayment({
        tenantId: TENANT,
        userId: adminUserId,
        branchId: hstBranchId,
        moneyCaller: { kind: 'internal' },
        transactionDisplayId: txnId,
        method: 'Cash',
        amount: '1500.00',
      })
      expect(paid.status).toBe('Paid')

      const result = await correctPaymentMethod({
        tenantId: TENANT,
        userId: adminUserId,
        branchId: hstBranchId,
        moneyCaller: { kind: 'internal' },
        transactionDisplayId: txnId,
        paymentDisplayId: paid.id,
        newMethod: 'GCash',
        reason: 'Cash to GCash above the old threshold now proceeds inline',
      })

      expect(result.status).toBe('Paid')
      const original = await loadPayment(paid.id)
      expect(original.voided_at).not.toBeNull()
      const replacement = await loadPayment(result.replacementPaymentId)
      expect(replacement.method).toBe('GCash')
      expect(replacement.voided_at).toBeNull()

      // Money is untouched by a reclassification.
      const after = await loadTxn(txnId)
      expect(after.amount_paid).toBe('1500.00')
      expect(after.amount_outstanding).toBe('0.00')
    })

    it('allows Cash to GCash below the old threshold with no approval', async () => {
      const txnId = await makeTransaction(hstBranchId, SVC_CHEAP) // 95.00 < 1000.00
      const paid = await addPayment({
        tenantId: TENANT,
        userId: adminUserId,
        branchId: hstBranchId,
        moneyCaller: { kind: 'internal' },
        transactionDisplayId: txnId,
        method: 'Cash',
        amount: '95.00',
      })
      expect(paid.status).toBe('Paid')

      const result = await correctPaymentMethod({
        tenantId: TENANT,
        userId: adminUserId,
        branchId: hstBranchId,
        moneyCaller: { kind: 'internal' },
        transactionDisplayId: txnId,
        paymentDisplayId: paid.id,
        newMethod: 'GCash',
        reason: 'Cashier mis-keyed the tender type',
      })
      expect(result.status).toBe('Paid')

      const replacement = await loadPayment(result.replacementPaymentId)
      expect(replacement.method).toBe('GCash')
    })

    it('allows GCash to Cash regardless of amount (increases expected cash, not the fraud shape)', async () => {
      const txnId = await makeTransaction(hstBranchId, SVC_EXPENSIVE) // 1500.00 > 1000.00
      const paid = await addPayment({
        tenantId: TENANT,
        userId: adminUserId,
        branchId: hstBranchId,
        moneyCaller: { kind: 'internal' },
        transactionDisplayId: txnId,
        method: 'GCash',
        amount: '1500.00',
      })
      expect(paid.status).toBe('Paid')

      const result = await correctPaymentMethod({
        tenantId: TENANT,
        userId: adminUserId,
        branchId: hstBranchId,
        moneyCaller: { kind: 'internal' },
        transactionDisplayId: txnId,
        paymentDisplayId: paid.id,
        newMethod: 'Cash',
        reason: 'Patient actually paid cash, not GCash',
      })
      expect(result.status).toBe('Paid')

      const replacement = await loadPayment(result.replacementPaymentId)
      expect(replacement.method).toBe('Cash')
    })

    it('allows GCash to Maya regardless of amount (non-Cash to non-Cash)', async () => {
      const txnId = await makeTransaction(hstBranchId, SVC_EXPENSIVE) // 1500.00 > 1000.00
      const paid = await addPayment({
        tenantId: TENANT,
        userId: adminUserId,
        branchId: hstBranchId,
        moneyCaller: { kind: 'internal' },
        transactionDisplayId: txnId,
        method: 'GCash',
        amount: '1500.00',
      })
      expect(paid.status).toBe('Paid')

      const result = await correctPaymentMethod({
        tenantId: TENANT,
        userId: adminUserId,
        branchId: hstBranchId,
        moneyCaller: { kind: 'internal' },
        transactionDisplayId: txnId,
        paymentDisplayId: paid.id,
        newMethod: 'Maya',
        reason: 'Patient actually paid via Maya, not GCash',
      })
      expect(result.status).toBe('Paid')

      const replacement = await loadPayment(result.replacementPaymentId)
      expect(replacement.method).toBe('Maya')
    })
  })

  describe('Credit is refused in both directions', () => {
    it('refuses correcting an EXISTING Credit payment (CREDIT_NOT_CORRECTABLE)', async () => {
      // Mint a real Credit draw: a free-standing deposit, then applyPrepayment
      // against a consuming Draft/Pending bill.
      const depositRes = await createTransaction({
        tenantId: TENANT,
        userId: adminUserId,
        branchId: hstBranchId,
        moneyCaller: { kind: 'internal' },
        payload: { patientId: PATIENT, isPrepayment: true, depositAmount: '1000.00', items: [] },
      })
      expect(depositRes.ok).toBe(true)
      if (!depositRes.ok) throw new Error('deposit create failed')
      createdTxnDisplayIds.push(depositRes.id)

      const depositPay = await addPayment({
        tenantId: TENANT,
        userId: adminUserId,
        branchId: hstBranchId,
        moneyCaller: { kind: 'internal' },
        transactionDisplayId: depositRes.id,
        method: 'Cash',
        amount: '1000.00',
      })
      expect(depositPay.status).toBe('Paid')

      const consumingTxnId = await makeTransaction(hstBranchId, SVC_CHEAP) // 95.00, Draft

      const draw = await applyPrepayment({
        tenantId: TENANT,
        userId: adminUserId,
        branchId: hstBranchId,
        prepaymentDisplayId: depositRes.id,
        consumingDisplayId: consumingTxnId,
      })
      expect(draw.applied).toBe(true)
      expect(draw.status).toBe('Paid')

      await expect(
        correctPaymentMethod({
          tenantId: TENANT,
          userId: adminUserId,
          branchId: hstBranchId,
          moneyCaller: { kind: 'internal' },
          transactionDisplayId: consumingTxnId,
          paymentDisplayId: draw.paymentId,
          newMethod: 'Cash',
          reason: 'Testing Credit refusal',
        }),
      ).rejects.toMatchObject({ code: 'CREDIT_NOT_CORRECTABLE' })
    })

    it('refuses correcting a payment TO Credit (CREDIT_NOT_CORRECTABLE)', async () => {
      const txnId = await makeTransaction(hstBranchId, SVC_CHEAP)
      const paid = await addPayment({
        tenantId: TENANT,
        userId: adminUserId,
        branchId: hstBranchId,
        moneyCaller: { kind: 'internal' },
        transactionDisplayId: txnId,
        method: 'Cash',
        amount: '95.00',
      })
      expect(paid.status).toBe('Paid')

      await expect(
        correctPaymentMethod({
          tenantId: TENANT,
          userId: adminUserId,
          branchId: hstBranchId,
          moneyCaller: { kind: 'internal' },
          transactionDisplayId: txnId,
          paymentDisplayId: paid.id,
          newMethod: 'Credit',
          reason: 'Testing Credit refusal',
        }),
      ).rejects.toMatchObject({ code: 'CREDIT_NOT_CORRECTABLE' })
    })
  })

  describe('refusals', () => {
    it('refuses NO_CHANGE when method and reference number are both unchanged', async () => {
      const txnId = await makeTransaction(hstBranchId, SVC_CHEAP)
      const paid = await addPayment({
        tenantId: TENANT,
        userId: adminUserId,
        branchId: hstBranchId,
        moneyCaller: { kind: 'internal' },
        transactionDisplayId: txnId,
        method: 'Cash',
        amount: '95.00',
      })
      expect(paid.status).toBe('Paid')

      await expect(
        correctPaymentMethod({
          tenantId: TENANT,
          userId: adminUserId,
          branchId: hstBranchId,
          moneyCaller: { kind: 'internal' },
          transactionDisplayId: txnId,
          paymentDisplayId: paid.id,
          newMethod: 'Cash',
          reason: 'Nothing actually changed',
        }),
      ).rejects.toMatchObject({ code: 'NO_CHANGE' })
    })

    it('refuses ALREADY_VOIDED when correcting the same payment twice', async () => {
      const txnId = await makeTransaction(hstBranchId, SVC_CHEAP)
      const paid = await addPayment({
        tenantId: TENANT,
        userId: adminUserId,
        branchId: hstBranchId,
        moneyCaller: { kind: 'internal' },
        transactionDisplayId: txnId,
        method: 'Cash',
        amount: '95.00',
      })
      expect(paid.status).toBe('Paid')

      await correctPaymentMethod({
        tenantId: TENANT,
        userId: adminUserId,
        branchId: hstBranchId,
        moneyCaller: { kind: 'internal' },
        transactionDisplayId: txnId,
        paymentDisplayId: paid.id,
        newMethod: 'GCash',
        reason: 'First correction',
      })

      await expect(
        correctPaymentMethod({
          tenantId: TENANT,
          userId: adminUserId,
          branchId: hstBranchId,
          moneyCaller: { kind: 'internal' },
          transactionDisplayId: txnId,
          paymentDisplayId: paid.id,
          newMethod: 'Maya',
          reason: 'Second correction on the same (now voided) payment',
        }),
      ).rejects.toMatchObject({ code: 'ALREADY_VOIDED' })
    })

    it('refuses INVALID_STATE when the parent transaction is Voided', async () => {
      const txnId = await makeTransaction(hstBranchId, SVC_CHEAP)
      const paid = await addPayment({
        tenantId: TENANT,
        userId: adminUserId,
        branchId: hstBranchId,
        moneyCaller: { kind: 'internal' },
        transactionDisplayId: txnId,
        method: 'Cash',
        amount: '95.00',
      })
      expect(paid.status).toBe('Paid')

      // voidTransaction refuses a Paid transaction with live payments (it
      // requires a refund first), so we void this one directly at the DB
      // layer for the sole purpose of exercising correctPaymentMethod's own
      // status guard, without exercising refundTransaction's rules here.
      await withGucs(
        (sql) =>
          sql`
            UPDATE transactions
            SET status = 'Voided', voided_at = now(), void_reason = 'test setup'
            WHERE tenant_id = ${TENANT} AND display_id = ${txnId}
          `,
      )

      await expect(
        correctPaymentMethod({
          tenantId: TENANT,
          userId: adminUserId,
          branchId: hstBranchId,
          moneyCaller: { kind: 'internal' },
          transactionDisplayId: txnId,
          paymentDisplayId: paid.id,
          newMethod: 'GCash',
          reason: 'Should be refused, transaction is Voided',
        }),
      ).rejects.toMatchObject({ code: 'INVALID_STATE' })
    })
  })

  it('allows reference-number reuse: correct away then correct back with the same reference', async () => {
    const txnId = await makeTransaction(hstBranchId, SVC_CHEAP)
    const ref = `REF-${Date.now().toString(36).toUpperCase()}`
    const paid = await addPayment({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      moneyCaller: { kind: 'internal' },
      transactionDisplayId: txnId,
      method: 'GCash',
      amount: '95.00',
      referenceNumber: ref,
    })
    expect(paid.status).toBe('Paid')

    // GCash -> Maya, keeping the same reference number.
    const away = await correctPaymentMethod({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      moneyCaller: { kind: 'internal' },
      transactionDisplayId: txnId,
      paymentDisplayId: paid.id,
      newMethod: 'Maya',
      newReferenceNumber: ref,
      reason: 'Correcting to Maya, same reference',
    })
    expect(away.status).toBe('Paid')

    // Maya -> GCash (back to the original method), still the same reference.
    // Without the partial unique index's `voided_at IS NULL` clause, the
    // now-voided ORIGINAL GCash+ref row would still occupy the
    // (tenant, txn, method, ref) slot and this insert would collide.
    const back = await correctPaymentMethod({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      moneyCaller: { kind: 'internal' },
      transactionDisplayId: txnId,
      paymentDisplayId: away.replacementPaymentId,
      newMethod: 'GCash',
      newReferenceNumber: ref,
      reason: 'Correcting back to GCash, same reference',
    })
    expect(back.status).toBe('Paid')

    const finalPayment = await loadPayment(back.replacementPaymentId)
    expect(finalPayment.method).toBe('GCash')
    expect(finalPayment.reference_number).toBe(ref)
    expect(finalPayment.voided_at).toBeNull()
  })

  it('keeps the ledger, balance, and credit unaffected by a correction', async () => {
    const balanceBefore = await getPatientBalance({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      patientDisplayId: PATIENT,
    })
    const creditBefore = await getPatientCredit({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      patientDisplayId: PATIENT,
    })

    const txnId = await makeTransaction(hstBranchId, SVC_CHEAP)
    const paid = await addPayment({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      moneyCaller: { kind: 'internal' },
      transactionDisplayId: txnId,
      method: 'Cash',
      amount: '95.00',
    })
    expect(paid.status).toBe('Paid')

    const ledgerBeforeCorrection = await getPatientLedger({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      patientDisplayId: PATIENT,
    })

    const result = await correctPaymentMethod({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      moneyCaller: { kind: 'internal' },
      transactionDisplayId: txnId,
      paymentDisplayId: paid.id,
      newMethod: 'GCash',
      reason: 'Cashier mis-keyed the tender type',
    })

    const ledgerAfter = await getPatientLedger({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      patientDisplayId: PATIENT,
    })

    // The voided original payment row is still shown, distinctly, and the
    // replacement now appears as the live payment leg.
    const voidedRow = ledgerAfter.rows.find((r) => r.paymentId === paid.id)
    expect(voidedRow).toBeDefined()
    expect(voidedRow!.paymentVoidedAt).not.toBeNull()
    expect(voidedRow!.affectsBalance).toBe(false)

    const replacementRow = ledgerAfter.rows.find((r) => r.paymentId === result.replacementPaymentId)
    expect(replacementRow).toBeDefined()
    expect(replacementRow!.paymentVoidedAt).toBeNull()

    // Running totals are unaffected: the correction is a pure substitution,
    // not a new charge or a new payment against the patient's balance.
    expect(ledgerAfter.closingBalanceDue).toBe(ledgerBeforeCorrection.closingBalanceDue)
    expect(ledgerAfter.closingNetDue).toBe(ledgerBeforeCorrection.closingNetDue)
    expect(ledgerAfter.totalCharges).toBe(ledgerBeforeCorrection.totalCharges)

    const balanceAfter = await getPatientBalance({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      patientDisplayId: PATIENT,
    })
    expect(balanceAfter.grossOutstanding).toBe(balanceBefore.grossOutstanding)
    expect(balanceAfter.netOutstanding).toBe(balanceBefore.netOutstanding)

    const creditAfter = await getPatientCredit({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      patientDisplayId: PATIENT,
    })
    expect(creditAfter.available).toBe(creditBefore.available)
  })
})
