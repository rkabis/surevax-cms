/**
 * Integration tests for MANUAL BRAND SELECTION at administer time.
 *
 * One abstract service (`ARVPEP_IM`) is satisfied by several products
 * (Abhayrab = house brand, Speeda = alternative). The nurse picks the brand;
 * the server no longer infers it from expiry order. A picked brand may carry its
 * own price, and payer contracts still outrank brand pricing.
 *
 * Coverage:
 *   1. `getEligibleLots` — lists every eligible brand in stock at the branch,
 *      house brand first, each with ITS brand-resolved price.
 *   2. `resolveServicePrice` precedence — base < brand, payer beats brand,
 *      brand+payer beats payer.
 *   3. `deductLot` guards — an ineligible / quarantined / unknown lot is
 *      refused with a specific code, before any stock moves.
 *   4. End-to-end: bill a dose at the base rate, administer the PRICIER brand →
 *      the chosen lot is deducted, the billed line records the brand, and a
 *      BRAND_PRICE_VARIANCE audit row captures the difference.
 *
 * Test 4 consumes one seeded Pending ARVPEP_IM order and one unit of stock (an
 * administered dose is immutable, so it cannot be rolled back — same tradeoff
 * the E2E daily-loop spec accepts). Everything the test itself INSERTS is
 * cleaned up in afterAll.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import { db } from '../../src/shared/db/index.js'
import { branches, users } from '../../src/shared/db/schema.js'
import { withTenantTx } from '../../src/shared/db/withTenantTx.js'
import { resolveServicePrice } from '../../src/shared/lib/pricing.js'
import { getEligibleLots, administerOrderTx } from '../../src/modules/scheduled_orders/db.js'
import { createTransaction } from '../../src/modules/transactions/db.js'
import { displayId } from '../../src/shared/utils/displayId.js'
import { DEFAULT_OBSERVATION_MINUTES } from '../../src/modules/scheduled_orders/observation.js'

const TENANT = 'SVX'
const SVC = 'ARVPEP_IM' // base 1500.00; Abhayrab (house) + Speeda eligible
const HOUSE_BRAND = 'Abhayrab'
const OTHER_BRAND = 'Speeda'
const SPEEDA_BASE_PRICE = 1800 // seeded brand row (seed/catalog.ts BRAND_PRICING)

const pgClient = postgres(process.env['DATABASE_URL']!)

let hstBranchId = 0
let adminUserId = 0
let speedaProductId = 0
let payerId = 0
const createdPriceIds: number[] = []
const createdTxnDisplayIds: string[] = []
const createdRecallDisplayIds: string[] = []

/** Committed tx with the RLS/audit GUCs set (app role). */
async function withGucs<T>(fn: (sql: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return pgClient.begin(async (sql) => {
    await sql`select set_config('app.current_tenant_id', ${TENANT}, true)`
    await sql`select set_config('app.current_user_id', ${String(adminUserId)}, true)`
    await sql`select set_config('app.current_branch_id', '', true)`
    return fn(sql as unknown as postgres.TransactionSql)
  }) as Promise<T>
}

/** A seeded, not-yet-administered ARVPEP_IM dose at HST whose patient can consent. */
async function findAdministrableOrder(): Promise<{
  orderDisplayId: string
  patientDisplayId: string
} | null> {
  const rows = await withGucs(
    async (sql) => sql`
      SELECT co.display_id AS order_display_id, p.display_id AS patient_display_id
      FROM clinical_orders co
      INNER JOIN patients   p ON p.id = co.patient_id
      INNER JOIN encounters e ON e.id = co.encounter_id
      WHERE co.tenant_id  = ${TENANT}
        AND co.service_id = ${SVC}
        AND co.status IN ('Scheduled', 'Pending')
        AND co.deleted_at IS NULL
        AND e.branch_id   = ${hstBranchId}
        AND EXISTS (
          SELECT 1 FROM consents c
          WHERE c.patient_id = co.patient_id
            AND c.tenant_id  = co.tenant_id
            AND c.revoked_at IS NULL
            AND c.deleted_at IS NULL
        )
      ORDER BY co.id
      LIMIT 1
    `,
  )
  const row = rows[0]
  if (!row) return null
  return {
    orderDisplayId: String(row['order_display_id']),
    patientDisplayId: String(row['patient_display_id']),
  }
}

beforeAll(async () => {
  const hst = await db.select({ id: branches.id }).from(branches).where(eq(branches.code, 'HST'))
  if (!hst[0]) throw new Error('HST branch not found; run pnpm run setup first')
  hstBranchId = hst[0].id

  const admin = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'admin@surevax.com'))
  if (!admin[0]) throw new Error('admin user not found; run pnpm run setup first')
  adminUserId = admin[0].id

  const [{ id: speeda } = { id: 0 }] = await withGucs(
    async (sql) =>
      sql`SELECT id FROM products WHERE tenant_id = ${TENANT} AND name = ${OTHER_BRAND} LIMIT 1` as unknown as Array<{
        id: number
      }>,
  )
  speedaProductId = Number(speeda)
  if (!speedaProductId) throw new Error(`${OTHER_BRAND} product not seeded`)

  const [{ id: payer } = { id: 0 }] = await withGucs(
    async (sql) =>
      sql`SELECT id FROM payer_profiles WHERE tenant_id = ${TENANT} AND is_active = true ORDER BY id LIMIT 1` as unknown as Array<{
        id: number
      }>,
  )
  payerId = Number(payer)
  if (!payerId) throw new Error('no active payer_profiles row seeded')
})

afterAll(async () => {
  await withGucs(async (sql) => {
    if (createdPriceIds.length > 0) {
      await sql`DELETE FROM service_prices WHERE id IN ${sql(createdPriceIds)}`
    }
    if (createdTxnDisplayIds.length > 0) {
      const ids = sql(createdTxnDisplayIds)
      await sql`DELETE FROM payments WHERE transaction_id IN (SELECT id FROM transactions WHERE display_id IN ${ids})`
      await sql`DELETE FROM transaction_items WHERE transaction_id IN (SELECT id FROM transactions WHERE display_id IN ${ids})`
      await sql`DELETE FROM transactions WHERE display_id IN ${ids}`
    }
    if (createdRecallDisplayIds.length > 0) {
      await sql`DELETE FROM product_recalls WHERE display_id IN ${sql(createdRecallDisplayIds)}`
    }
  })
  await pgClient.end()
})

describe('eligible brands for a dose', () => {
  it('lists every in-stock eligible brand, house brand first, priced per brand', async () => {
    const order = await findAdministrableOrder()
    expect(order, 'seed should contain a pending ARVPEP_IM dose at HST').not.toBeNull()
    if (!order) return

    const { data, billedUnitPrice } = await getEligibleLots({
      tenantId: TENANT,
      branchId: hstBranchId,
      id: order.orderDisplayId,
    })

    // Both anti-rabies brands are seeded in stock at HST.
    const brands = data.map((l) => l.product.name)
    expect(brands).toContain(HOUSE_BRAND)
    expect(brands).toContain(OTHER_BRAND)

    // House brand leads even though the Speeda lot expires sooner — the
    // ordering rule is is_default/ranking first, expiry only within a brand.
    expect(data[0]!.product.name).toBe(HOUSE_BRAND)
    expect(data[0]!.isHouseBrand).toBe(true)

    // Each row carries ITS brand's price, not one shared service price.
    const house = data.find((l) => l.product.name === HOUSE_BRAND)!
    const other = data.find((l) => l.product.name === OTHER_BRAND)!
    expect(Number(other.unitPrice)).toBe(SPEEDA_BASE_PRICE)
    expect(Number(other.unitPrice)).toBeGreaterThan(Number(house.unitPrice))

    // Nothing billed for this dose yet → no variance is possible.
    expect(billedUnitPrice).toBeNull()

    // Every row is genuinely administrable.
    for (const lot of data) {
      expect(Number(lot.quantityOnHand)).toBeGreaterThan(0)
      expect(lot.id.startsWith('LOT_')).toBe(true)
    }
  })
})

describe('price precedence — payer outranks brand', () => {
  it('resolves base < brand, and lets a payer row beat a brand row', async () => {
    const base = await resolveServicePrice(db, { tenantId: TENANT, serviceId: SVC })
    const brand = await resolveServicePrice(db, {
      tenantId: TENANT,
      serviceId: SVC,
      productId: speedaProductId,
    })
    expect(Number(brand)).toBeGreaterThan(Number(base))

    // A payer contract for the same service, cheaper than the brand uplift.
    const payerPrice = '1000.00'
    const payerRowId = await withGucs(async (sql) => {
      const rows = await sql`
        INSERT INTO service_prices
          (display_id, tenant_id, service_id, branch_id, payer_id, product_id,
           unit_price, currency, effective_from, created_by_id)
        VALUES (${displayId('SVP')}, ${TENANT}, ${SVC}, NULL, ${payerId}, NULL,
                ${payerPrice}, 'PHP', '-infinity', ${adminUserId})
        RETURNING id`
      return Number(rows[0]!['id'])
    })
    createdPriceIds.push(payerRowId)

    // Brand + payer, no combined row → the contracted rate wins (the clinic
    // absorbs the pricier brand rather than silently re-pricing the contract).
    const payerWithBrand = await resolveServicePrice(db, {
      tenantId: TENANT,
      serviceId: SVC,
      payerId,
      productId: speedaProductId,
    })
    expect(payerWithBrand).toBe(payerPrice)

    // Add the explicit brand+payer row → it is more specific, so it wins.
    const combinedPrice = '1250.00'
    const combinedRowId = await withGucs(async (sql) => {
      const rows = await sql`
        INSERT INTO service_prices
          (display_id, tenant_id, service_id, branch_id, payer_id, product_id,
           unit_price, currency, effective_from, created_by_id)
        VALUES (${displayId('SVP')}, ${TENANT}, ${SVC}, NULL, ${payerId}, ${speedaProductId},
                ${combinedPrice}, 'PHP', '-infinity', ${adminUserId})
        RETURNING id`
      return Number(rows[0]!['id'])
    })
    createdPriceIds.push(combinedRowId)

    const combined = await resolveServicePrice(db, {
      tenantId: TENANT,
      serviceId: SVC,
      payerId,
      productId: speedaProductId,
    })
    expect(combined).toBe(combinedPrice)

    // A cash patient is unaffected by payer rows.
    const cashBrand = await resolveServicePrice(db, {
      tenantId: TENANT,
      serviceId: SVC,
      productId: speedaProductId,
    })
    expect(Number(cashBrand)).toBe(SPEEDA_BASE_PRICE)
  })
})

describe('deductLot guards', () => {
  async function administerWith(orderDisplayId: string, lotDisplayId: string) {
    return withTenantTx(
      { tenantId: TENANT, userId: adminUserId, branchId: hstBranchId },
      async (tx) =>
        administerOrderTx(tx, {
          tenantId: TENANT,
          branchId: hstBranchId,
          userId: adminUserId,
          administeredById: adminUserId,
          id: orderDisplayId,
          dto: {
            consentBy: 'Patient',
            consentObtained: true,
            visVersion: 'VIS-RABIES-2024',
            lotId: lotDisplayId,
            observationMinutes: DEFAULT_OBSERVATION_MINUTES,
          },
        }),
    )
  }

  it('refuses a lot whose product does not satisfy the service', async () => {
    const order = await findAdministrableOrder()
    if (!order) return

    // A tetanus-toxoid lot is real, in stock, and unrelated to anti-rabies.
    const [ttLot] = await withGucs(
      async (sql) =>
        sql`
      SELECT il.display_id FROM inventory_lots il
      INNER JOIN products p ON p.id = il.product_id
      WHERE il.tenant_id = ${TENANT} AND il.branch_id = ${hstBranchId}
        AND p.name = 'AbhayTox' AND il.quantity_on_hand::numeric > 0
      LIMIT 1` as unknown as Array<{ display_id: string }>,
    )
    expect(ttLot, 'seed should hold an AbhayTox lot at HST').toBeTruthy()
    if (!ttLot) return

    await expect(administerWith(order.orderDisplayId, ttLot.display_id)).rejects.toMatchObject({
      code: 'LOT_NOT_ELIGIBLE',
    })
  })

  it('refuses a quarantined lot', async () => {
    const order = await findAdministrableOrder()
    if (!order) return

    const [quarantined] = await withGucs(
      async (sql) =>
        sql`
      SELECT display_id FROM inventory_lots
      WHERE tenant_id = ${TENANT} AND is_quarantined = true
      LIMIT 1` as unknown as Array<{ display_id: string }>,
    )
    expect(quarantined, 'seed should hold a quarantined lot').toBeTruthy()
    if (!quarantined) return

    // Quarantine is checked before eligibility/expiry, so the code is specific
    // even for a lot that would fail several guards.
    await expect(
      administerWith(order.orderDisplayId, quarantined.display_id),
    ).rejects.toMatchObject({ code: 'LOT_QUARANTINED' })
  })

  it('refuses an active recall inside the server-side deduction transaction', async () => {
    const order = await findAdministrableOrder()
    if (!order) return

    const [candidate] = await withGucs(
      async (sql) =>
        sql`
          SELECT il.display_id, il.product_id, il.batch_number
          FROM inventory_lots il
          INNER JOIN products p ON p.id = il.product_id
          WHERE il.tenant_id = ${TENANT}
            AND il.branch_id = ${hstBranchId}
            AND p.name = ${OTHER_BRAND}
            AND il.is_quarantined = false
            AND il.expiry_date >= CURRENT_DATE
            AND il.quantity_on_hand::numeric > 0
          ORDER BY il.id
          LIMIT 1` as unknown as Array<{
          display_id: string
          product_id: number
          batch_number: string
        }>,
    )
    expect(candidate, 'seed should hold an administrable alternative-brand lot').toBeTruthy()
    if (!candidate) return

    const recallDisplayId = displayId('RCL')
    createdRecallDisplayIds.push(recallDisplayId)
    await withGucs(async (sql) => {
      await sql`
        INSERT INTO product_recalls (
          display_id, tenant_id, product_id, affected_lots_pattern,
          recall_reason, recall_severity, issued_at, patient_notification_required,
          created_by_id
        ) VALUES (
          ${recallDisplayId}, ${TENANT}, ${candidate.product_id}, NULL,
          'Regression-test product-wide active recall', 'Class1', NOW(), true, ${adminUserId}
        )`
    })

    try {
      const eligible = await getEligibleLots({
        tenantId: TENANT,
        branchId: hstBranchId,
        id: order.orderDisplayId,
      })
      expect(eligible.data.find((lot) => lot.id === candidate.display_id)?.isRecalled).toBe(true)
      await expect(
        administerWith(order.orderDisplayId, candidate.display_id),
      ).rejects.toMatchObject({
        code: 'LOT_RECALLED',
      })
    } finally {
      await withGucs(async (sql) => {
        await sql`DELETE FROM product_recalls WHERE display_id = ${recallDisplayId}`
      })
      createdRecallDisplayIds.splice(createdRecallDisplayIds.indexOf(recallDisplayId), 1)
    }
  })

  it('refuses an unknown lot id', async () => {
    const order = await findAdministrableOrder()
    if (!order) return
    await expect(administerWith(order.orderDisplayId, 'LOT_ZZZZZZZZ')).rejects.toMatchObject({
      code: 'LOT_NOT_FOUND',
    })
  })
})

describe('administering a pricier brand than was billed', () => {
  it('deducts the chosen lot, stamps the billed line, and audits the variance', async () => {
    const order = await findAdministrableOrder()
    expect(order).not.toBeNull()
    if (!order) return

    // 1. Make this a two-unit order, then bill it before administering (the
    // prepay shape). The brand is unknown at this point, so it prices at the
    // brand-agnostic base rate.
    const orderQuantity = 2
    await withGucs(async (sql) => {
      await sql`
        UPDATE clinical_orders
        SET quantity = ${orderQuantity}
        WHERE tenant_id = ${TENANT} AND display_id = ${order.orderDisplayId}`
    })
    const billed = await createTransaction({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      moneyCaller: { kind: 'internal' },
      payload: {
        patientId: order.patientDisplayId,
        items: [{ serviceId: SVC, quantity: orderQuantity, clinicalOrderId: order.orderDisplayId }],
      },
    })
    expect(billed.ok).toBe(true)
    if (!billed.ok) return
    createdTxnDisplayIds.push(billed.id)

    const baseUnitPrice = await resolveServicePrice(db, { tenantId: TENANT, serviceId: SVC })

    // 2. The picker now reports what was billed, so the UI can warn.
    const eligible = await getEligibleLots({
      tenantId: TENANT,
      branchId: hstBranchId,
      id: order.orderDisplayId,
    })
    expect(eligible.billedUnitPrice).toBe(baseUnitPrice)
    const speedaLot = eligible.data.find((l) => l.product.name === OTHER_BRAND)!
    expect(speedaLot).toBeTruthy()
    expect(Number(speedaLot.unitPrice)).toBeGreaterThan(Number(eligible.billedUnitPrice))

    const qtyBefore = Number(speedaLot.quantityOnHand)

    // 3. Administer the pricier brand — allowed, not blocked on money.
    const result = await withTenantTx(
      { tenantId: TENANT, userId: adminUserId, branchId: hstBranchId },
      async (tx) =>
        administerOrderTx(tx, {
          tenantId: TENANT,
          branchId: hstBranchId,
          userId: adminUserId,
          administeredById: adminUserId,
          id: order.orderDisplayId,
          dto: {
            consentBy: 'Patient',
            consentObtained: true,
            visVersion: 'VIS-RABIES-2024',
            lotId: speedaLot.id,
            brandPriceVarianceAcknowledged: true,
            observationMinutes: DEFAULT_OBSERVATION_MINUTES,
          },
        }),
    )

    // The lot the NURSE chose is the lot that was used.
    expect(result.status).toBe('Completed')
    expect(result.lot.lotId).toBe(speedaLot.id)
    expect(result.lot.batchNumber).toBe(speedaLot.batchNumber)

    // 4. Stock moved by the order's actual quantity, not one hard-coded vial.
    const [lotAfter] = await withGucs(
      async (sql) =>
        sql`
      SELECT quantity_on_hand::numeric AS qoh FROM inventory_lots
      WHERE tenant_id = ${TENANT} AND display_id = ${speedaLot.id}` as unknown as Array<{
          qoh: string
        }>,
    )
    expect(Number(lotAfter!.qoh)).toBe(qtyBefore - orderQuantity)

    // 5. The billed line now records WHICH brand it paid for.
    const [item] = await withGucs(
      async (sql) =>
        sql`
      SELECT ti.lot_id, il.display_id AS lot_display_id
      FROM transaction_items ti
      INNER JOIN transactions t ON t.id = ti.transaction_id
      LEFT  JOIN inventory_lots il ON il.id = ti.lot_id
      WHERE t.display_id = ${billed.id}` as unknown as Array<{
          lot_id: number | null
          lot_display_id: string | null
        }>,
    )
    expect(item!.lot_display_id).toBe(speedaLot.id)

    // 6. The price gap is on the audit trail — the settled bill is untouched.
    const [variance] = await withGucs(
      async (sql) =>
        sql`
      SELECT metadata FROM audit_logs
      WHERE tenant_id = ${TENANT}
        AND action = 'TRANSACTION_MODIFY'
        AND metadata->>'reason' = 'brand_price_variance'
        AND metadata->>'clinicalOrderId' = ${order.orderDisplayId}
      ORDER BY id DESC LIMIT 1` as unknown as Array<{ metadata: Record<string, string> }>,
    )
    expect(variance, 'a BRAND_PRICE_VARIANCE audit row should exist').toBeTruthy()
    if (!variance) return
    expect(variance.metadata['billedUnitPrice']).toBe(baseUnitPrice)
    expect(Number(variance.metadata['brandUnitPrice'])).toBe(Number(speedaLot.unitPrice))
    expect(Number(variance.metadata['delta'])).toBeCloseTo(
      Number(speedaLot.unitPrice) - Number(baseUnitPrice),
      2,
    )
    expect(variance.metadata['acknowledgedByOperator']).toBe(true)
  })
})
