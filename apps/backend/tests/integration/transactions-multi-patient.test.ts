/**
 * Integration tests for MULTI-PATIENT transactions (family / group billing).
 *
 * One transaction / receipt covers services for several patients; ONE combined
 * payment settles it; each patient carries their own BIR SC/PWD discount.
 * Model: header `transactions.patient_id` = primary / bill-to; per-line
 * `transaction_items.patient_id` (NULL ⇒ primary); a `transaction_patients`
 * sub-header per patient holding their discount.
 *
 * Coverage:
 *   1. Two patients on one txn — per-patient discount applies only to the
 *      eligible patient's line; sub-headers + per-item patient resolve; one
 *      combined payment lands the txn Paid.
 *   2. Back-compat — a single-patient create still works and synthesizes one
 *      sub-header row from the primary.
 *   3. Consent gate — a create whose patient has no active consent is rejected
 *      (also covers the previously-missing non-bundle consent check).
 *   4. D2 secondary — a secondary patient last-administered at another branch
 *      is rejected with D2_CROSS_BRANCH_SECONDARY.
 *
 * These exercise `createTransaction` directly (it uses the Drizzle pool, so
 * `withRollback` does not apply); created rows are cleaned up in afterAll.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import { db } from '../../src/shared/db/index.js'
import { branches, users } from '../../src/shared/db/schema.js'
import { createTransaction, addPayment, getTransaction } from '../../src/modules/transactions/db.js'

const TENANT = 'SVX'
// Seeded patients: A1/A2 have active consent and NO completed clinical order
// (D2 allows any branch); A3 has a completed order at HST (used as a secondary
// at a different branch to trip the D2 mirror).
const P_PRIMARY = 'PAT_AAAAAAA1'
const P_SECONDARY = 'PAT_AAAAAAA2'
const P_LAST_HST = 'PAT_AAAAAAA3'
const SVC = 'ARVBOOSTER_IM' // active, non-VAT-exempt, priced, non-bundle vaccine

const pgClient = postgres(process.env['DATABASE_URL']!)

let hstBranchId = 0
let timBranchId = 0
let adminUserId = 0
let noConsentPatientId = 0
const noConsentDisplayId = `PAT_MPT${Date.now().toString(36).toUpperCase().slice(-5)}`
const createdTxnDisplayIds: string[] = []

/** Run a fn inside a committed tx with the RLS/audit GUCs set (app role). */
async function withGucs<T>(fn: (sql: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return pgClient.begin(async (sql) => {
    await sql`select set_config('app.current_tenant_id', ${TENANT}, true)`
    await sql`select set_config('app.current_user_id', ${String(adminUserId)}, true)`
    await sql`select set_config('app.current_branch_id', '', true)`
    return fn(sql as unknown as postgres.TransactionSql)
  }) as Promise<T>
}

beforeAll(async () => {
  const hst = await db.select({ id: branches.id }).from(branches).where(eq(branches.code, 'HST'))
  if (!hst[0]) throw new Error('HST branch not found; run pnpm run setup first')
  hstBranchId = hst[0].id

  const tim = await db.select({ id: branches.id }).from(branches).where(eq(branches.code, 'TMG'))
  if (!tim[0]) throw new Error('TMG branch not found: run pnpm run setup first')
  timBranchId = tim[0].id

  const admin = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'admin@surevax.com'))
  if (!admin[0]) throw new Error('admin user not found; run pnpm run setup first')
  adminUserId = admin[0].id

  // A patient with NO consent row — exercises the consent gate.
  await withGucs(async (sql) => {
    const rows = await sql`
      INSERT INTO patients (display_id, tenant_id, mrn, first_name, last_name)
      VALUES (${noConsentDisplayId}, ${TENANT}, ${'MRN-MPT-' + Date.now()}, 'NoConsent', 'Tester')
      RETURNING id`
    noConsentPatientId = Number(rows[0]!['id'])
  })
})

afterAll(async () => {
  await withGucs(async (sql) => {
    if (createdTxnDisplayIds.length > 0) {
      const ids = sql(createdTxnDisplayIds)
      // transaction_patients cascades on the transactions delete; payments and
      // transaction_items do not — delete them first.
      await sql`DELETE FROM payments WHERE transaction_id IN (SELECT id FROM transactions WHERE display_id IN ${ids})`
      await sql`DELETE FROM transaction_items WHERE transaction_id IN (SELECT id FROM transactions WHERE display_id IN ${ids})`
      await sql`DELETE FROM transactions WHERE display_id IN ${ids}`
    }
    if (noConsentPatientId) await sql`DELETE FROM patients WHERE id = ${noConsentPatientId}`
  })
  await pgClient.end()
})

describe('multi-patient transactions', () => {
  it('bills two patients on one transaction with per-patient discount + combined payment', async () => {
    const res = await createTransaction({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      moneyCaller: { kind: 'internal' },
      payload: {
        patientId: P_PRIMARY,
        discount: { idType: 'OSCA', idNumber: 'OSCA-12345' },
        patients: [{ patientId: P_SECONDARY }], // no discount
        items: [
          { serviceId: SVC, quantity: 1 }, // → primary (OSCA)
          { serviceId: SVC, quantity: 1, patientId: P_SECONDARY }, // → secondary (none)
        ],
      },
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    createdTxnDisplayIds.push(res.id)
    expect(res.status).toBe('Pending')

    const detail = await getTransaction({ tenantId: TENANT, displayId: res.id })
    expect(detail).not.toBeNull()
    if (!detail) return

    // Two sub-headers, each with the right discount.
    expect(detail.patients).toHaveLength(2)
    const primarySub = detail.patients.find((p) => p.patient.id === P_PRIMARY)!
    const secondarySub = detail.patients.find((p) => p.patient.id === P_SECONDARY)!
    expect(primarySub.discountIdType).toBe('OSCA')
    expect(primarySub.discountIdNumber).toBe('OSCA-12345')
    expect(secondarySub.discountIdType).toBeNull()

    // Per-item patient attribution.
    expect(detail.items).toHaveLength(2)
    const primaryItem = detail.items.find((i) => i.patient?.id === P_PRIMARY)!
    const secondaryItem = detail.items.find((i) => i.patient?.id === P_SECONDARY)!
    // OSCA line is discounted; the non-eligible patient's line is not.
    expect(parseFloat(primaryItem.discountAmount)).toBeGreaterThan(0)
    expect(parseFloat(secondaryItem.discountAmount)).toBe(0)

    // Per-patient subtotals foot to the transaction net.
    const subtotalSum = detail.patients.reduce((s, p) => s + parseFloat(p.subtotal), 0)
    expect(subtotalSum).toBeCloseTo(parseFloat(detail.netAmount), 2)

    // One combined payment settles the whole transaction.
    const pay = await addPayment({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      moneyCaller: { kind: 'internal' },
      transactionDisplayId: res.id,
      method: 'Cash',
      amount: detail.netAmount,
    })
    expect(pay.status).toBe('Paid')
  })

  it('remains backward-compatible for a single-patient transaction', async () => {
    const res = await createTransaction({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      moneyCaller: { kind: 'internal' },
      payload: { patientId: P_SECONDARY, items: [{ serviceId: SVC, quantity: 1 }] },
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    createdTxnDisplayIds.push(res.id)

    const detail = await getTransaction({ tenantId: TENANT, displayId: res.id })
    expect(detail?.patients).toHaveLength(1)
    expect(detail?.patients[0]?.patient.id).toBe(P_SECONDARY)
    expect(detail?.items[0]?.patient?.id).toBe(P_SECONDARY)
  })

  it('rejects a transaction whose patient has no active consent', async () => {
    await expect(
      createTransaction({
        tenantId: TENANT,
        userId: adminUserId,
        branchId: hstBranchId,
        moneyCaller: { kind: 'internal' },
        payload: { patientId: noConsentDisplayId, items: [{ serviceId: SVC, quantity: 1 }] },
      }),
    ).rejects.toMatchObject({ code: 'CONSENT_REVOKED' })
  })

  it('rejects a secondary patient last-administered at a different branch (D2)', async () => {
    const res = await createTransaction({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: timBranchId, // primary P1 is clean → trigger allows; secondary P3 last at HST
      moneyCaller: { kind: 'internal' },
      payload: {
        patientId: P_PRIMARY,
        patients: [{ patientId: P_LAST_HST }],
        items: [
          { serviceId: SVC, quantity: 1 },
          { serviceId: SVC, quantity: 1, patientId: P_LAST_HST },
        ],
      },
    })
    expect(res.ok).toBe(false)
    if (res.ok) {
      createdTxnDisplayIds.push(res.id)
      return
    }
    expect(res.code).toBe('D2_CROSS_BRANCH_SECONDARY')
  })
})
