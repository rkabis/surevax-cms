/**
 * Integration tests for the void-side-effects fix: voiding a bundle
 * transaction now owns the clinical/lab work its own fan-out created.
 *
 * Before this change, `voidTransaction` flipped `transactions.status` to
 * `Voided` and touched nothing else: a voided bundle bill left its fanned-out
 * `clinical_orders` / `lab_orders` live with no bill behind them, and any
 * stock the fan-out consumed stayed deducted. Worse, `fanOutBundle` has no
 * duplicate guard, so the natural "void the wrong bill, re-enter it
 * correctly" workflow would fan the same constituents out a second time.
 *
 * Coverage:
 *   1. Voiding an unpaid Lab-only bundle transaction (PANEL_TFT1: LAB_TSH,
 *      LAB_FT3, LAB_FT4) cancels every clinical_orders + lab_orders row the
 *      fan-out created.
 *   2. Voiding reverses inventory the fan-out consumed. PANEL_TFT1's
 *      constituents are all Lab (never stock-deducting, see
 *      bundleFanOut.ts INVENTORY_BACKED), so this test manually simulates
 *      exactly what an inventory-backed constituent's fan-out writes (a
 *      clinical_orders row carrying the SAME `fan_out_transaction_id`
 *      linkage fanOutBundle writes, plus the 'Out' inventory_movements row
 *      fanOutBundle's pickEarliestExpiringLot would have written) against a
 *      REAL transaction, then drives the REAL `voidTransaction` to prove the
 *      reversal math (`reverseDeductionForOrder`).
 *   3. A fanned-out clinical_order already `Completed` refuses the void with
 *      `CLINICAL_WORK_COMPLETED` (409) and mutates nothing: transaction
 *      status, order statuses all unchanged.
 *   4. Void-then-recreate: after voiding a bundle transaction, creating a
 *      corrected replacement does not leave two LIVE sets of constituent
 *      orders, the regression this whole change exists to prevent.
 *   5. A plain non-bundle transaction voids exactly as before: empty
 *      cancelled-order arrays, no behaviour change.
 *
 * Modelled on payment-method-correction.test.ts: direct calls to db.ts
 * functions, `withGucs` for raw-SQL setup/assertions, cleanup in `afterAll`.
 * `withRollback` doesn't apply: supertest-style direct DB writes bypass it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import { db } from '../../src/shared/db/index.js'
import { branches, users } from '../../src/shared/db/schema.js'
import { createTransaction, voidTransaction } from '../../src/modules/transactions/db.js'
import { displayId } from '../../src/shared/utils/displayId.js'

const TENANT = 'SVX'
// Same seeded patient payment-method-correction.test.ts uses: active
// consent, no completed clinical order anywhere in the fixture set, so the
// D2 branch-invariant trigger admits it at any branch. We deliberately never
// set `completed_at` on a forced-Completed row below (see test 3), which
// keeps this patient invisible to D2's lookup (it INNER JOINs encounters and
// filters `completed_at IS NOT NULL`), this file never narrows the
// patient's branch for later test files that reuse the same fixture.
const PATIENT = 'PAT_AAAAAAA1'
const LAB_BUNDLE = 'PANEL_TFT1' // 3 Lab constituents: LAB_TSH, LAB_FT3, LAB_FT4
const SVC_STANDALONE = 'LAB_GLUCOSE_FBS' // 95.00, non-bundle, standalone lab test
const VACCINE_CONSTITUENT = 'ARVPEP_IM' // Vaccine, INVENTORY_BACKED, seeded stock at HST

const pgClient = postgres(process.env['DATABASE_URL']!)

let hstBranchId = 0
let adminUserId = 0
let patientId = 0
const createdTxnDisplayIds: string[] = []
/** Manually-inserted clinical_orders ids this file wrote directly (test 2). */
const createdClinicalOrderIds: number[] = []

/** Run a fn inside a committed tx with the RLS/audit GUCs set (app role). */
async function withGucs<T>(fn: (sql: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return pgClient.begin(async (sql) => {
    await sql`select set_config('app.current_tenant_id', ${TENANT}, true)`
    await sql`select set_config('app.current_user_id', ${String(adminUserId)}, true)`
    await sql`select set_config('app.current_branch_id', '', true)`
    return fn(sql as unknown as postgres.TransactionSql)
  }) as Promise<T>
}

/** Create a single-item, single-patient transaction and remember it for cleanup. */
async function makeTransaction(serviceId: string, quantity = 1): Promise<string> {
  const res = await createTransaction({
    tenantId: TENANT,
    userId: adminUserId,
    branchId: hstBranchId,
    moneyCaller: { kind: 'internal' },
    payload: { patientId: PATIENT, items: [{ serviceId, quantity }] },
  })
  expect(res.ok).toBe(true)
  if (!res.ok) throw new Error(`createTransaction failed: ${res.error}`)
  createdTxnDisplayIds.push(res.id)
  return res.id
}

type FanOutRow = {
  id: number
  display_id: string
  status: string
}

/** clinical_orders carrying this transaction's fan-out linkage. */
async function loadFannedOutClinicalOrders(transactionNumericId: number): Promise<FanOutRow[]> {
  return withGucs(
    (sql) =>
      sql<FanOutRow[]>`
        SELECT id, display_id, status
        FROM clinical_orders
        WHERE tenant_id = ${TENANT}
          AND fan_out_transaction_id = ${transactionNumericId}
        ORDER BY id
      `,
  )
}

/** lab_orders whose parent clinical_order carries this transaction's fan-out linkage. */
async function loadFannedOutLabOrders(transactionNumericId: number): Promise<FanOutRow[]> {
  return withGucs(
    (sql) =>
      sql<FanOutRow[]>`
        SELECT lo.id, lo.display_id, lo.status
        FROM lab_orders lo
        JOIN clinical_orders co ON co.id = lo.clinical_order_id
        WHERE lo.tenant_id = ${TENANT}
          AND co.fan_out_transaction_id = ${transactionNumericId}
        ORDER BY lo.id
      `,
  )
}

async function transactionNumericId(displayIdStr: string): Promise<number> {
  const rows = await withGucs(
    (sql) =>
      sql<{ id: number }[]>`
        SELECT id FROM transactions WHERE tenant_id = ${TENANT} AND display_id = ${displayIdStr}
      `,
  )
  const row = rows[0]
  if (!row) throw new Error(`transaction not found: ${displayIdStr}`)
  return Number(row.id)
}

async function transactionStatus(displayIdStr: string): Promise<string> {
  const rows = await withGucs(
    (sql) =>
      sql<{ status: string }[]>`
        SELECT status FROM transactions WHERE tenant_id = ${TENANT} AND display_id = ${displayIdStr}
      `,
  )
  const row = rows[0]
  if (!row) throw new Error(`transaction not found: ${displayIdStr}`)
  return row.status
}

beforeAll(async () => {
  const hst = await db.select({ id: branches.id }).from(branches).where(eq(branches.code, 'HST'))
  if (!hst[0]) throw new Error('HST branch not found: run pnpm setup first')
  hstBranchId = hst[0]!.id

  const admin = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'admin@surevax.com'))
  if (!admin[0]) throw new Error('admin user not found: run pnpm setup first')
  adminUserId = admin[0]!.id

  const patientRows = await withGucs(
    (sql) =>
      sql<{ id: number }[]>`
        SELECT id FROM patients WHERE tenant_id = ${TENANT} AND display_id = ${PATIENT}
      `,
  )
  if (!patientRows[0]) throw new Error(`${PATIENT} not found: run pnpm setup first`)
  patientId = Number(patientRows[0].id)
})

afterAll(async () => {
  await withGucs(async (sql) => {
    if (createdClinicalOrderIds.length > 0) {
      const coIds = sql(createdClinicalOrderIds)
      await sql`DELETE FROM inventory_movements WHERE clinical_order_id IN ${coIds}`
      await sql`DELETE FROM clinical_orders WHERE id IN ${coIds}`
    }
    if (createdTxnDisplayIds.length > 0) {
      const ids = sql(createdTxnDisplayIds)
      await sql`DELETE FROM lab_orders WHERE clinical_order_id IN (
        SELECT co.id FROM clinical_orders co
        WHERE co.fan_out_transaction_id IN (
          SELECT id FROM transactions WHERE display_id IN ${ids}
        )
      )`
      await sql`DELETE FROM clinical_orders WHERE fan_out_transaction_id IN (
        SELECT id FROM transactions WHERE display_id IN ${ids}
      )`
      await sql`DELETE FROM payments WHERE transaction_id IN (SELECT id FROM transactions WHERE display_id IN ${ids})`
      await sql`DELETE FROM transaction_items WHERE transaction_id IN (SELECT id FROM transactions WHERE display_id IN ${ids})`
      await sql`DELETE FROM transactions WHERE display_id IN ${ids}`
    }
  })
  await pgClient.end()
})

describe('voidTransaction: bundle fan-out unwind', () => {
  it('cancels every fanned-out clinical_order and lab_order for an unpaid Lab bundle', async () => {
    const txnId = await makeTransaction(LAB_BUNDLE)
    const numericId = await transactionNumericId(txnId)

    const clinicalBefore = await loadFannedOutClinicalOrders(numericId)
    const labBefore = await loadFannedOutLabOrders(numericId)
    expect(clinicalBefore).toHaveLength(3)
    expect(labBefore).toHaveLength(3)
    expect(clinicalBefore.every((r) => r.status === 'Pending')).toBe(true)
    expect(labBefore.every((r) => r.status === 'Pending')).toBe(true)

    const result = await voidTransaction({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      transactionDisplayId: txnId,
      reason: 'Wrong bundle billed, voiding to re-enter correctly',
    })
    expect(result.status).toBe('Voided')
    expect(result.cancelledClinicalOrderIds.sort()).toEqual(
      clinicalBefore.map((r) => r.display_id).sort(),
    )
    expect(result.cancelledLabOrderIds.sort()).toEqual(labBefore.map((r) => r.display_id).sort())

    const clinicalAfter = await loadFannedOutClinicalOrders(numericId)
    const labAfter = await loadFannedOutLabOrders(numericId)
    expect(clinicalAfter.every((r) => r.status === 'Cancelled')).toBe(true)
    expect(labAfter.every((r) => r.status === 'Cancelled')).toBe(true)
  })

  it('reverses inventory the fan-out consumed', async () => {
    // PANEL_TFT1's constituents never touch stock (all Lab), so this test
    // manually reproduces exactly what fanOutBundle writes for an
    // inventory-backed constituent (ARVPEP_IM, Vaccine) against a REAL
    // transaction, then drives the real voidTransaction to prove the
    // reversal math in reverseDeductionForOrder / unwindFanOutForVoid.
    const txnId = await makeTransaction(SVC_STANDALONE)
    const numericId = await transactionNumericId(txnId)

    const productRows = await withGucs(
      (sql) =>
        sql<
          { id: number }[]
        >`SELECT id FROM products WHERE tenant_id = ${TENANT} AND name = 'Abhayrab'`,
    )
    const productId = productRows[0]?.id
    if (!productId) throw new Error('Abhayrab product not seeded')

    const lotRows = await withGucs(
      (sql) =>
        sql<{ id: number; quantity_on_hand: string }[]>`
          SELECT id, quantity_on_hand::text AS quantity_on_hand
          FROM inventory_lots
          WHERE tenant_id = ${TENANT} AND branch_id = ${hstBranchId} AND product_id = ${productId}
            AND is_quarantined = false AND expiry_date >= CURRENT_DATE
          ORDER BY expiry_date ASC
          LIMIT 1
        `,
    )
    const lot = lotRows[0]
    if (!lot) throw new Error('No in-stock Abhayrab lot seeded at HST')
    const qtyBefore = Number(lot.quantity_on_hand)

    // Simulate fanOutBundle's own writes: a clinical_orders row carrying
    // this transaction's fan_out_transaction_id linkage, plus the 'Out'
    // movement + lot decrement pickEarliestExpiringLot would have performed.
    const coDisplayId = displayId('ORD')
    const [inserted] = await withGucs(
      (sql) =>
        sql<{ id: number }[]>`
          INSERT INTO clinical_orders
            (display_id, tenant_id, patient_id, service_id, order_type, status, quantity, fan_out_transaction_id, created_by_id)
          VALUES (${coDisplayId}, ${TENANT}, ${patientId}, ${VACCINE_CONSTITUENT}, 'Ad_Hoc', 'Pending', '1',
                  ${numericId}, ${adminUserId})
          RETURNING id
        `,
    )
    if (!inserted) throw new Error('failed to insert simulated fan-out clinical_order')
    // Raw postgres-js returns bigint columns as strings (the OID 20 coercion
    // is configured on the Drizzle client, not this one), coerce before
    // storing for cleanup.
    const insertedId = Number(inserted.id)
    createdClinicalOrderIds.push(insertedId)

    await withGucs(async (sql) => {
      await sql`
        UPDATE inventory_lots SET quantity_on_hand = quantity_on_hand - 1, updated_at = NOW()
        WHERE id = ${lot.id} AND tenant_id = ${TENANT}
      `
      await sql`
        INSERT INTO inventory_movements
          (display_id, tenant_id, lot_id, branch_id, movement_type, quantity_delta, clinical_order_id, performed_by_id, notes, created_by_id)
        VALUES (${displayId('MVT')}, ${TENANT}, ${lot.id}, ${hstBranchId}, 'Out', '-1', ${inserted.id}, ${adminUserId}, 'Administered', ${adminUserId})
      `
    })

    const lotDuring = await withGucs(
      (sql) =>
        sql<{ quantity_on_hand: string }[]>`
          SELECT quantity_on_hand::text AS quantity_on_hand FROM inventory_lots WHERE id = ${lot.id}
        `,
    )
    expect(Number(lotDuring[0]!.quantity_on_hand)).toBe(qtyBefore - 1)

    const result = await voidTransaction({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      transactionDisplayId: txnId,
      reason: 'Voiding to reverse the simulated fan-out deduction',
    })
    expect(result.cancelledClinicalOrderIds).toEqual([coDisplayId])

    const lotAfter = await withGucs(
      (sql) =>
        sql<{ quantity_on_hand: string }[]>`
          SELECT quantity_on_hand::text AS quantity_on_hand FROM inventory_lots WHERE id = ${lot.id}
        `,
    )
    expect(Number(lotAfter[0]!.quantity_on_hand)).toBe(qtyBefore)

    const adjustmentRows = await withGucs(
      (sql) =>
        sql<{ movement_type: string; quantity_delta: string }[]>`
          SELECT movement_type, quantity_delta::text AS quantity_delta
          FROM inventory_movements
          WHERE tenant_id = ${TENANT} AND clinical_order_id = ${inserted.id} AND movement_type = 'Adjustment'
        `,
    )
    expect(adjustmentRows).toHaveLength(1)
    expect(Number(adjustmentRows[0]!.quantity_delta)).toBe(1)

    const orderAfter = await withGucs(
      (sql) =>
        sql<{ status: string }[]>`SELECT status FROM clinical_orders WHERE id = ${inserted.id}`,
    )
    expect(orderAfter[0]!.status).toBe('Cancelled')
  })

  it('refuses CLINICAL_WORK_COMPLETED when a fanned-out order is already Completed, mutating nothing', async () => {
    const txnId = await makeTransaction(LAB_BUNDLE)
    const numericId = await transactionNumericId(txnId)
    const statusBefore = await transactionStatus(txnId)

    const clinicalBefore = await loadFannedOutClinicalOrders(numericId)
    expect(clinicalBefore).toHaveLength(3)
    const targetOrder = clinicalBefore[0]!

    // Force ONE of the three constituents into Completed, as if it had
    // really been actioned. completed_at is deliberately left NULL: the D2
    // branch-invariant trigger INNER JOINs encounters and requires
    // completed_at IS NOT NULL, so this forced row stays invisible to D2 and
    // never narrows this patient's branch for other test files.
    await withGucs(
      (sql) =>
        sql`UPDATE clinical_orders SET status = 'Completed' WHERE tenant_id = ${TENANT} AND id = ${targetOrder.id}`,
    )

    await expect(
      voidTransaction({
        tenantId: TENANT,
        userId: adminUserId,
        branchId: hstBranchId,
        transactionDisplayId: txnId,
        reason: 'Should be refused: one constituent already administered',
      }),
    ).rejects.toMatchObject({ code: 'CLINICAL_WORK_COMPLETED', httpStatus: 409 })

    // Nothing mutated: transaction status unchanged, all three orders
    // unchanged (the forced one still Completed, the other two still Pending).
    expect(await transactionStatus(txnId)).toBe(statusBefore)
    const clinicalAfter = await loadFannedOutClinicalOrders(numericId)
    const byId = new Map(clinicalAfter.map((r) => [r.id, r.status]))
    expect(byId.get(targetOrder.id)).toBe('Completed')
    for (const before of clinicalBefore) {
      if (before.id === targetOrder.id) continue
      expect(byId.get(before.id)).toBe('Pending')
    }

    // Un-poison this patient's D2 visibility for good measure even though
    // completed_at was never set (belt and suspenders for other test files).
    await withGucs(
      (sql) =>
        sql`UPDATE clinical_orders SET deleted_at = NOW() WHERE tenant_id = ${TENANT} AND id = ${targetOrder.id}`,
    )
  })

  it('does not leave two live sets of constituent orders after void-then-recreate', async () => {
    const firstTxnId = await makeTransaction(LAB_BUNDLE)
    const firstNumericId = await transactionNumericId(firstTxnId)
    const firstOrders = await loadFannedOutClinicalOrders(firstNumericId)
    expect(firstOrders).toHaveLength(3)

    await voidTransaction({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      transactionDisplayId: firstTxnId,
      reason: 'Wrong discount applied, voiding to re-enter correctly',
    })

    const secondTxnId = await makeTransaction(LAB_BUNDLE)
    const secondNumericId = await transactionNumericId(secondTxnId)
    const secondOrders = await loadFannedOutClinicalOrders(secondNumericId)
    expect(secondOrders).toHaveLength(3)

    // The regression this change exists to prevent: at most ONE live
    // (non-Cancelled) set of constituent clinical_orders for these two
    // fan-outs combined, even though fanOutBundle itself has no duplicate
    // guard.
    const allOrderIds = [...firstOrders, ...secondOrders].map((r) => r.id)
    const liveRows = await withGucs(
      (sql) =>
        sql<{ count: string }[]>`
          SELECT COUNT(*)::text AS count FROM clinical_orders
          WHERE id IN ${sql(allOrderIds)} AND status <> 'Cancelled'
        `,
    )
    expect(Number(liveRows[0]!.count)).toBe(3)

    const cancelledRows = await withGucs(
      (sql) =>
        sql<{ count: string }[]>`
          SELECT COUNT(*)::text AS count FROM clinical_orders
          WHERE id IN ${sql(allOrderIds)} AND status = 'Cancelled'
        `,
    )
    expect(Number(cancelledRows[0]!.count)).toBe(3)
  })

  it('voids a plain non-bundle transaction exactly as before (no fan-out, no behaviour change)', async () => {
    const txnId = await makeTransaction(SVC_STANDALONE)

    const result = await voidTransaction({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      transactionDisplayId: txnId,
      reason: 'Plain standalone bill, no bundle involved',
    })

    expect(result.status).toBe('Voided')
    expect(result.cancelledClinicalOrderIds).toEqual([])
    expect(result.cancelledLabOrderIds).toEqual([])
  })
})
