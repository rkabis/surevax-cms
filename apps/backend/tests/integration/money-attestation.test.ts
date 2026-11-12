/**
 * Integration tests for money attestation (95f243c).
 *
 * On the shared, day-scoped `Branch` login (one kiosk, 108 nurses), a payment
 * now has to name the real staff member taking it and prove it with that
 * person's 4-digit kiosk PIN: `payments.received_by_id` becomes the attested
 * human, `payments.created_by_id` stays the session. A caller who is a real
 * person logged in as themselves attests implicitly and sends nothing. Money
 * roles (Nurse, Physician, BranchAdmin, TenantAdmin, Cashier) differ from the
 * dose-administration role set only by including Cashier; `Branch` is
 * excluded from both, it is the shared service account this control exists
 * to stop attributing acts to.
 *
 * These tests exercise `resolveMoneyHandler`
 * (`apps/backend/src/shared/utils/clinicianAttestation.ts`) indirectly,
 * through the money-moving db.ts functions that call it: `addPayment` and
 * `correctPaymentMethod`.
 *
 * Modeled on `payment-method-correction.test.ts`: direct calls to the db.ts
 * functions, a `withGucs` helper for raw-SQL assertions, cleanup in
 * `afterAll`. Created transactions and any `pin_attempts` rows this file
 * touches are deleted in `afterAll`, so a wrong-PIN test never leaves a
 * seeded nurse locked out for later manual testing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { and, eq } from 'drizzle-orm'
import { db } from '../../src/shared/db/index.js'
import { branches, users } from '../../src/shared/db/schema.js'
import {
  createTransaction,
  addPayment,
  addPayments,
  correctPaymentMethod,
  type AddPaymentArgs,
} from '../../src/modules/transactions/db.js'

const TENANT = 'SVX'
// Same seeded patient the payment-method-correction test uses: active
// consent, no completed clinical order anywhere in the fixture set, so the
// D2 branch-invariant trigger admits it at ANY branch (HST or TMG).
const PATIENT = 'PAT_AAAAAAA1'
const SVC_CHEAP = 'LAB_GLUCOSE_FBS' // 95.00, standalone (non-bundle) lab test

const ADMIN_DISPLAY_ID = 'USR_AAAAAAA1' // admin@surevax.com, TenantAdmin
const NURSE_DISPLAY_ID = 'USR_AAAAAAA3' // juan.dc@surevax.com, Nurse at HST
const NURSE2_DISPLAY_ID = 'USR_AAAAAAA4' // ana.reyes@surevax.com, Nurse at HST
const CASHIER_DISPLAY_ID = 'USR_AAAAAAA5' // jose.santos@surevax.com, Cashier at HST
const BRANCH_HST_DISPLAY_ID = 'USR_AAAAAAA7' // branch-main@surevax.com, the shared HST kiosk login
/** Resolved in beforeAll: the shared kiosk login at TMG, seeded or created. */
let tmgKioskDisplayId = ''
/** Set only when beforeAll had to create the kiosk itself, so afterAll cleans up. */
let createdTmgKioskDisplayId: string | null = null
const SEEDED_PIN = '1234'

const pgClient = postgres(process.env['DATABASE_URL']!)

let hstBranchId = 0
let tmgBranchId = 0
let adminUserId = 0
let branchUserId = 0 // branch-main@surevax.com (HST kiosk login)
let tmgBranchUserId = 0 // surevax.tmg@surevax.com (TMG kiosk login)
let nurseUserId = 0 // juan.dc
let nurse2UserId = 0 // ana.reyes
let cashierUserId = 0 // jose.santos
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

/** Create a single-item, single-patient Draft transaction; remember it for cleanup. */
async function makeTransaction(branchId: number, serviceId: string): Promise<string> {
  const res = await createTransaction({
    tenantId: TENANT,
    userId: adminUserId,
    branchId,
    moneyCaller: { kind: 'internal' },
    payload: { patientId: PATIENT, items: [{ serviceId, quantity: 1 }] },
  })
  expect(res.ok).toBe(true)
  if (!res.ok) throw new Error(`createTransaction failed: ${res.error}`)
  createdTxnDisplayIds.push(res.id)
  return res.id
}

async function paymentCountForTxn(txnDisplayId: string): Promise<number> {
  const rows = await withGucs(
    (sql) =>
      sql<{ count: string }[]>`
        SELECT COUNT(*)::text AS count FROM payments
        WHERE tenant_id = ${TENANT}
          AND transaction_id = (SELECT id FROM transactions WHERE display_id = ${txnDisplayId})
      `,
  )
  return Number(rows[0]!.count)
}

async function transactionFootprintForPatient(): Promise<{
  transactions: number
  items: number
}> {
  const [row] = await withGucs(
    (sql) => sql<{ transactions: string; items: string }[]>`
      SELECT COUNT(DISTINCT t.id)::text AS transactions,
             COUNT(ti.id)::text AS items
      FROM transactions t
      JOIN patients pat ON pat.id = t.patient_id AND pat.tenant_id = t.tenant_id
      LEFT JOIN transaction_items ti
        ON ti.transaction_id = t.id AND ti.tenant_id = t.tenant_id
      WHERE t.tenant_id = ${TENANT} AND pat.display_id = ${PATIENT}
    `,
  )
  return {
    transactions: Number(row?.transactions ?? 0),
    items: Number(row?.items ?? 0),
  }
}

async function pinAttemptFailedCount(userId: number): Promise<number> {
  const rows = await withGucs(
    (sql) =>
      sql<{ failed_count: number }[]>`
        SELECT failed_count FROM pin_attempts
        WHERE tenant_id = ${TENANT} AND user_id = ${userId}
      `,
  )
  return rows[0]?.failed_count ?? 0
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

  const branchUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'branch-main@surevax.com'))
  if (!branchUser[0]) throw new Error('branch user not found: run pnpm setup first')
  branchUserId = branchUser[0]!.id

  // A shared kiosk login at a branch OTHER than HST, for the WRONG_BRANCH
  // case. Resolved by role and branch rather than by a hardcoded seed
  // display_id, and created here when absent.
  //
  // This used to pin `USR_BRTMG` and hard-fail. That coupled the suite to a
  // seed internal it cannot actually rely on: CI logged the kiosk logins as
  // created and this lookup still came back empty 45 seconds later, so the
  // row is not guaranteed to survive for the life of a shared-database run.
  // A fixture the test owns end to end cannot be taken away from it.
  const [seededTmgKiosk] = await db
    .select({ id: users.id, displayId: users.displayId })
    .from(users)
    .where(and(eq(users.tenantId, TENANT), eq(users.primaryBranchId, tmgBranchId)))
    .limit(1)

  if (seededTmgKiosk) {
    tmgBranchUserId = seededTmgKiosk.id
    tmgKioskDisplayId = seededTmgKiosk.displayId
  } else {
    tmgKioskDisplayId = `USR_MAT${Date.now().toString(36).toUpperCase().slice(-5)}`
    createdTmgKioskDisplayId = tmgKioskDisplayId
    const [created] = await withGucs(
      (sql) => sql<{ id: number }[]>`
        INSERT INTO users (display_id, tenant_id, email, password_hash, first_name, last_name,
                           is_active, can_login, primary_branch_id)
        VALUES (${tmgKioskDisplayId}, ${TENANT}, ${`${tmgKioskDisplayId.toLowerCase()}@test.surevax.com`},
                'x', 'TMG', 'Kiosk Fixture', true, true, ${tmgBranchId})
        RETURNING id
      `,
    )
    if (!created) throw new Error('could not create the TMG kiosk fixture')
    tmgBranchUserId = created.id
    await withGucs(
      (sql) => sql`
        INSERT INTO user_roles (tenant_id, user_id, role) VALUES (${TENANT}, ${created.id}, 'Branch')
        ON CONFLICT DO NOTHING
      `,
    )
  }

  const nurse = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'juan.dc@surevax.com'))
  if (!nurse[0]) throw new Error('nurse user not found: run pnpm setup first')
  nurseUserId = nurse[0]!.id

  const nurse2 = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'ana.reyes@surevax.com'))
  if (!nurse2[0]) throw new Error('nurse2 user not found: run pnpm setup first')
  nurse2UserId = nurse2[0]!.id

  const cashier = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'jose.santos@surevax.com'))
  if (!cashier[0]) throw new Error('cashier user not found: run pnpm setup first')
  cashierUserId = cashier[0]!.id
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
    // Only when beforeAll had to mint the TMG kiosk itself. A seeded one is
    // not ours to delete.
    if (createdTmgKioskDisplayId !== null) {
      await sql`DELETE FROM user_roles WHERE user_id IN
                  (SELECT id FROM users WHERE display_id = ${createdTmgKioskDisplayId})`
      await sql`DELETE FROM users WHERE display_id = ${createdTmgKioskDisplayId}`
    }
    // Never leave a seeded nurse locked out for later manual testing: delete
    // every pin_attempts row this file may have touched, unconditionally.
    // A successful correct-PIN call already clears its own row, so this is a
    // no-op belt-and-suspenders pass for anything a failed test left behind.
    const pinUserIds = [nurseUserId, nurse2UserId, cashierUserId].filter((id) => id > 0)
    if (pinUserIds.length > 0) {
      const ids = sql(pinUserIds)
      await sql`DELETE FROM pin_attempts WHERE tenant_id = ${TENANT} AND user_id IN ${ids}`
    }
  })
  await pgClient.end()
})

describe('money attestation', () => {
  it('fails closed at runtime when an HTTP adapter omits caller context', async () => {
    const txnId = await makeTransaction(hstBranchId, SVC_CHEAP)
    const omittedByUnsafeCaller = {
      tenantId: TENANT,
      userId: branchUserId,
      branchId: hstBranchId,
      transactionDisplayId: txnId,
      method: 'Cash',
      amount: '95.00',
    } as unknown as AddPaymentArgs

    await expect(addPayment(omittedByUnsafeCaller)).rejects.toMatchObject({
      code: 'MONEY_CALLER_CONTEXT_REQUIRED',
      httpStatus: 500,
    })
    expect(await paymentCountForTxn(txnId)).toBe(0)
  })

  describe('shared Branch login', () => {
    it('posts a valid split tender exactly once with one named staff attestation', async () => {
      const txnId = await makeTransaction(hstBranchId, SVC_CHEAP)

      const paid = await addPayments({
        tenantId: TENANT,
        userId: branchUserId,
        branchId: hstBranchId,
        transactionDisplayId: txnId,
        payments: [
          { method: 'Cash', amount: '40.00' },
          { method: 'GCash', amount: '55.00', referenceNumber: 'GCASH-SPLIT-OK' },
        ],
        moneyCaller: { kind: 'http', role: 'Branch', displayId: BRANCH_HST_DISPLAY_ID },
        attestedById: NURSE_DISPLAY_ID,
        attestationPin: SEEDED_PIN,
      })

      expect(paid.status).toBe('Paid')
      expect(paid.payments).toHaveLength(2)
      expect(await paymentCountForTxn(txnId)).toBe(2)

      const rows = await withGucs(
        (sql) => sql<{ method: string; amount: string; received_by_id: string }[]>`
          SELECT method, amount, received_by_id FROM payments
          WHERE tenant_id = ${TENANT}
            AND transaction_id = (SELECT id FROM transactions WHERE display_id = ${txnId})
          ORDER BY id
        `,
      )
      expect(rows.map(({ method, amount }) => ({ method, amount }))).toEqual([
        { method: 'Cash', amount: '40.00' },
        { method: 'GCash', amount: '55.00' },
      ])
      expect(rows.every((row) => Number(row.received_by_id) === nurseUserId)).toBe(true)
    })

    it('rolls back every split-tender leg when a later leg exceeds the bill cap', async () => {
      const txnId = await makeTransaction(hstBranchId, SVC_CHEAP)

      await expect(
        addPayments({
          tenantId: TENANT,
          userId: branchUserId,
          branchId: hstBranchId,
          transactionDisplayId: txnId,
          payments: [
            { method: 'Cash', amount: '40.00' },
            { method: 'GCash', amount: '60.00', referenceNumber: 'GCASH-SPLIT-OVER' },
          ],
          moneyCaller: { kind: 'http', role: 'Branch', displayId: BRANCH_HST_DISPLAY_ID },
          attestedById: NURSE_DISPLAY_ID,
          attestationPin: SEEDED_PIN,
        }),
      ).rejects.toMatchObject({ code: 'OVERPAYMENT_NOT_ALLOWED' })

      expect(await paymentCountForTxn(txnId)).toBe(0)
    })

    it('validates collection attestation before creating a Pending bill, then a valid retry posts once', async () => {
      const before = await transactionFootprintForPatient()
      const payload = {
        patientId: PATIENT,
        items: [{ serviceId: SVC_CHEAP, quantity: 1 }],
        attestedById: NURSE_DISPLAY_ID,
      }

      await expect(
        createTransaction({
          tenantId: TENANT,
          userId: branchUserId,
          branchId: hstBranchId,
          moneyCaller: { kind: 'http', role: 'Branch', displayId: BRANCH_HST_DISPLAY_ID },
          payload: { ...payload, attestationPin: '0000' },
        }),
      ).rejects.toMatchObject({ code: 'ATTESTATION_PIN_INVALID' })

      expect(await transactionFootprintForPatient()).toEqual(before)

      const created = await createTransaction({
        tenantId: TENANT,
        userId: branchUserId,
        branchId: hstBranchId,
        moneyCaller: { kind: 'http', role: 'Branch', displayId: BRANCH_HST_DISPLAY_ID },
        payload: { ...payload, attestationPin: SEEDED_PIN },
      })
      expect(created.ok).toBe(true)
      if (!created.ok) throw new Error(`createTransaction failed: ${created.error}`)
      createdTxnDisplayIds.push(created.id)

      const afterCreate = await transactionFootprintForPatient()
      expect(afterCreate.transactions).toBe(before.transactions + 1)
      expect(afterCreate.items).toBe(before.items + 1)

      const paid = await addPayment({
        tenantId: TENANT,
        userId: branchUserId,
        branchId: hstBranchId,
        transactionDisplayId: created.id,
        method: 'Cash',
        amount: '95.00',
        moneyCaller: { kind: 'http', role: 'Branch', displayId: BRANCH_HST_DISPLAY_ID },
        attestedById: NURSE_DISPLAY_ID,
        attestationPin: SEEDED_PIN,
      })
      expect(paid.status).toBe('Paid')
      expect(await paymentCountForTxn(created.id)).toBe(1)
      expect(await transactionFootprintForPatient()).toEqual(afterCreate)
    })

    it('refuses ATTESTATION_REQUIRED with no named attester, and writes no payment row', async () => {
      const txnId = await makeTransaction(hstBranchId, SVC_CHEAP)

      await expect(
        addPayment({
          tenantId: TENANT,
          userId: branchUserId,
          branchId: hstBranchId,
          transactionDisplayId: txnId,
          method: 'Cash',
          amount: '95.00',
          moneyCaller: { kind: 'http', role: 'Branch', displayId: BRANCH_HST_DISPLAY_ID },
        }),
      ).rejects.toMatchObject({ code: 'ATTESTATION_REQUIRED' })

      expect(await paymentCountForTxn(txnId)).toBe(0)
    })

    it('refuses ATTESTATION_PIN_INVALID for a named clinician with the wrong PIN', async () => {
      const txnId = await makeTransaction(hstBranchId, SVC_CHEAP)

      await expect(
        addPayment({
          tenantId: TENANT,
          userId: branchUserId,
          branchId: hstBranchId,
          transactionDisplayId: txnId,
          method: 'Cash',
          amount: '95.00',
          moneyCaller: { kind: 'http', role: 'Branch', displayId: BRANCH_HST_DISPLAY_ID },
          attestedById: NURSE_DISPLAY_ID,
          attestationPin: '0000',
        }),
      ).rejects.toMatchObject({ code: 'ATTESTATION_PIN_INVALID' })

      expect(await paymentCountForTxn(txnId)).toBe(0)
    })

    it('leaves the lockout counter incremented even though the payment failed (proves the resolver runs before the transaction opens)', async () => {
      // A dedicated user for this test, kept separate from the wrong-PIN test
      // above, so this assertion is not coupled to another test's ordering.
      const before = await pinAttemptFailedCount(nurse2UserId)

      const txnId = await makeTransaction(hstBranchId, SVC_CHEAP)
      await expect(
        addPayment({
          tenantId: TENANT,
          userId: branchUserId,
          branchId: hstBranchId,
          transactionDisplayId: txnId,
          method: 'Cash',
          amount: '95.00',
          moneyCaller: { kind: 'http', role: 'Branch', displayId: BRANCH_HST_DISPLAY_ID },
          attestedById: NURSE2_DISPLAY_ID,
          attestationPin: '9999',
        }),
      ).rejects.toMatchObject({ code: 'ATTESTATION_PIN_INVALID' })

      // The payment transaction failed whole: no payment row exists...
      expect(await paymentCountForTxn(txnId)).toBe(0)
      // ...yet the lockout counter for the named clinician moved anyway. If
      // resolveMoneyHandler ran INSIDE the financial transaction instead of
      // strictly before it, this increment would have rolled back along with
      // the failed payment, and a wrong PIN could be retried without limit.
      const after = await pinAttemptFailedCount(nurse2UserId)
      expect(after).toBe(before + 1)
      expect(after).toBeGreaterThan(0)
    })

    it('succeeds with the correct PIN: received_by_id is the named clinician, created_by_id is the session', async () => {
      const txnId = await makeTransaction(hstBranchId, SVC_CHEAP)

      const paid = await addPayment({
        tenantId: TENANT,
        userId: branchUserId,
        branchId: hstBranchId,
        transactionDisplayId: txnId,
        method: 'Cash',
        amount: '95.00',
        moneyCaller: { kind: 'http', role: 'Branch', displayId: BRANCH_HST_DISPLAY_ID },
        attestedById: NURSE_DISPLAY_ID,
        attestationPin: SEEDED_PIN,
      })
      expect(paid.status).toBe('Paid')

      const rows = await withGucs(
        (sql) =>
          sql<{ received_by_id: string; created_by_id: string }[]>`
            SELECT received_by_id, created_by_id FROM payments
            WHERE tenant_id = ${TENANT} AND display_id = ${paid.id}
          `,
      )
      const row = rows[0]
      if (!row) throw new Error('payment row not found')
      expect(Number(row.received_by_id)).toBe(nurseUserId)
      expect(Number(row.created_by_id)).toBe(branchUserId)
      expect(Number(row.received_by_id)).not.toBe(Number(row.created_by_id))
    })

    it('accepts a Cashier as the named money attester, though a Cashier could never be named for a dose', async () => {
      const txnId = await makeTransaction(hstBranchId, SVC_CHEAP)

      const paid = await addPayment({
        tenantId: TENANT,
        userId: branchUserId,
        branchId: hstBranchId,
        transactionDisplayId: txnId,
        method: 'Cash',
        amount: '95.00',
        moneyCaller: { kind: 'http', role: 'Branch', displayId: BRANCH_HST_DISPLAY_ID },
        attestedById: CASHIER_DISPLAY_ID,
        attestationPin: SEEDED_PIN,
      })
      expect(paid.status).toBe('Paid')

      const rows = await withGucs(
        (sql) =>
          sql<{ received_by_id: string }[]>`
            SELECT received_by_id FROM payments
            WHERE tenant_id = ${TENANT} AND display_id = ${paid.id}
          `,
      )
      expect(Number(rows[0]!.received_by_id)).toBe(cashierUserId)
    })

    it('refuses ATTESTATION_WRONG_BRANCH for a clinician not assigned to the caller branch', async () => {
      const txnId = await makeTransaction(tmgBranchId, SVC_CHEAP)

      await expect(
        addPayment({
          tenantId: TENANT,
          userId: tmgBranchUserId,
          branchId: tmgBranchId,
          transactionDisplayId: txnId,
          method: 'Cash',
          amount: '95.00',
          moneyCaller: { kind: 'http', role: 'Branch', displayId: tmgKioskDisplayId },
          // juan.dc is seeded only at HST, never at TMG.
          attestedById: NURSE_DISPLAY_ID,
          attestationPin: SEEDED_PIN,
        }),
      ).rejects.toMatchObject({ code: 'ATTESTATION_WRONG_BRANCH' })
    })

    it('refuses ATTESTATION_ROLE_INVALID for naming a Branch service account', async () => {
      const txnId = await makeTransaction(hstBranchId, SVC_CHEAP)

      await expect(
        addPayment({
          tenantId: TENANT,
          userId: branchUserId,
          branchId: hstBranchId,
          transactionDisplayId: txnId,
          method: 'Cash',
          amount: '95.00',
          moneyCaller: { kind: 'http', role: 'Branch', displayId: BRANCH_HST_DISPLAY_ID },
          // Naming the shared login itself: it is still not a real person.
          attestedById: BRANCH_HST_DISPLAY_ID,
          attestationPin: SEEDED_PIN,
        }),
      ).rejects.toMatchObject({ code: 'ATTESTATION_ROLE_INVALID' })
    })
  })

  describe('a real person logged in as themselves', () => {
    it('self-attests without naming anyone or supplying a PIN', async () => {
      const txnId = await makeTransaction(hstBranchId, SVC_CHEAP)

      const paid = await addPayment({
        tenantId: TENANT,
        userId: adminUserId,
        branchId: hstBranchId,
        moneyCaller: { kind: 'http', role: 'TenantAdmin', displayId: ADMIN_DISPLAY_ID },
        transactionDisplayId: txnId,
        method: 'Cash',
        amount: '95.00',
      })
      expect(paid.status).toBe('Paid')

      const rows = await withGucs(
        (sql) =>
          sql<{ received_by_id: string; created_by_id: string }[]>`
            SELECT received_by_id, created_by_id FROM payments
            WHERE tenant_id = ${TENANT} AND display_id = ${paid.id}
          `,
      )
      const row = rows[0]
      if (!row) throw new Error('payment row not found')
      expect(Number(row.received_by_id)).toBe(adminUserId)
      expect(Number(row.created_by_id)).toBe(adminUserId)
    })
  })

  describe('correctPaymentMethod prior-period flag', () => {
    it('flags a correction false when the original payment sits in the still-open drawer session', async () => {
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
        reason: 'Cashier mis-keyed the tender type, still same shift',
      })

      const rows = await withGucs(
        (sql) =>
          sql`
            SELECT metadata FROM audit_logs
            WHERE tenant_id = ${TENANT}
              AND action = 'TRANSACTION_MODIFY'
              AND metadata->>'reason' = 'payment_method_correction'
              AND metadata->>'voidedPaymentId' = ${paid.id}
            ORDER BY id DESC LIMIT 1
          ` as unknown as Promise<Array<{ metadata: Record<string, unknown> }>>,
      )
      const row = rows[0]
      if (!row) throw new Error('audit row not found')
      expect(row.metadata['touchesClosedPeriod']).toBe(false)
      expect(row.metadata['originalCashDrawerSessionState']).toBe('Open')
    })

    it('flags a correction true when the original payment sits in a now-closed drawer session', async () => {
      // TMG has no seeded open drawer session (only HST does), so open and
      // close our own here without touching the shared HST session other
      // tests in this file, and other files (run sequentially per
      // vitest.config.ts), rely on.
      const [sessionA] = await withGucs(
        (sql) =>
          sql<{ id: number }[]>`
            INSERT INTO cash_drawer_sessions
              (display_id, tenant_id, user_id, branch_id, state, opening_float, created_by_id)
            VALUES (${`CSH_ATT${Date.now().toString(36).toUpperCase().slice(-4)}A`}, ${TENANT},
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

      // Close session A, then open a fresh session B so the replacement
      // payment addPaymentTx inserts during the correction has somewhere
      // open to land: simulates end-of-day reconciliation happening between
      // the original payment and its later correction.
      await withGucs(
        (sql) =>
          sql`UPDATE cash_drawer_sessions SET state = 'Closed', closed_at = now() WHERE id = ${sessionA.id}`,
      )
      const [sessionB] = await withGucs(
        (sql) =>
          sql<{ id: number }[]>`
            INSERT INTO cash_drawer_sessions
              (display_id, tenant_id, user_id, branch_id, state, opening_float, created_by_id)
            VALUES (${`CSH_ATT${Date.now().toString(36).toUpperCase().slice(-4)}B`}, ${TENANT},
                    ${adminUserId}, ${tmgBranchId}, 'Open', '1000.00', ${adminUserId})
            RETURNING id
          `,
      )
      if (!sessionB) throw new Error('failed to open session B')
      createdDrawerSessionIds.push(sessionB.id)

      await correctPaymentMethod({
        tenantId: TENANT,
        userId: adminUserId,
        branchId: tmgBranchId,
        moneyCaller: { kind: 'internal' },
        transactionDisplayId: txnId,
        paymentDisplayId: paid.id,
        newMethod: 'GCash',
        reason: 'Correcting tender type after drawer close',
      })

      const rows = await withGucs(
        (sql) =>
          sql`
            SELECT metadata FROM audit_logs
            WHERE tenant_id = ${TENANT}
              AND action = 'TRANSACTION_MODIFY'
              AND metadata->>'reason' = 'payment_method_correction'
              AND metadata->>'voidedPaymentId' = ${paid.id}
            ORDER BY id DESC LIMIT 1
          ` as unknown as Promise<Array<{ metadata: Record<string, unknown> }>>,
      )
      const row = rows[0]
      if (!row) throw new Error('audit row not found')
      expect(row.metadata['touchesClosedPeriod']).toBe(true)
      expect(row.metadata['originalCashDrawerSessionState']).toBe('Closed')
    })
  })
})
