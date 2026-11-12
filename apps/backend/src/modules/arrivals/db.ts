import { and, eq, gt, asc, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { withTenantTx } from '../../shared/db/withTenantTx.js'
import {
  inventoryLots,
  serviceCatalog,
  servicePrices,
  standingOrderTemplateItems,
} from '../../shared/db/schema.js'
import { toCents, fromCents, multiplyMoney } from '../../shared/utils/money.js'
import { eligibleProductIdsSql } from '../inventory/eligibility.js'

export type PreviewBundleItem = {
  service: {
    /** service_catalog.id — the raw catalog code (e.g. ARVPEP_IM), not a prefixed display_id */
    id: string
    name: string
    sku: string | null
  }
  lot: {
    /** inventory_lots.display_id — LOT_<8 base32> */
    id: string
    batchNumber: string
  } | null
  expiryDate: string | null
  doseSize: string | null
  qty: string
  unitPrice: string
  subtotal: string
}

export type PreviewBundleResult = {
  items: PreviewBundleItem[]
  total: string
}

/**
 * Read-only FEFO bundle preview for one or more templates. For each Day-0
 * item across the selected templates, finds the earliest-expiring inventory
 * lot with stock > 0 at the given branch. No writes — no reservation.
 * Multi-template (e.g. ARV course + ERIG + ATS for a Cat III walk-in) merges
 * every template's Day-0 items into one bundle.
 */
export async function previewBundle(opts: {
  tenantId: string
  /** branches.id (bigint) */
  branchId: number
  /** standing_order_templates.id values — raw catalog codes (e.g. ARVPEP_IM) */
  templateIds: string[]
}): Promise<PreviewBundleResult> {
  const { tenantId, branchId, templateIds } = opts

  return withTenantTx({ tenantId, userId: 0, branchId }, async (tx) => {
    // Load all Day-0 template items for the given template, joined with service
    const items = await tx
      .select({
        serviceId: standingOrderTemplateItems.serviceId,
        quantity: standingOrderTemplateItems.quantity,
        serviceName: serviceCatalog.name,
        serviceSku: serviceCatalog.sku,
        serviceEffectivePrice: servicePrices.unitPrice,
      })
      .from(standingOrderTemplateItems)
      .innerJoin(serviceCatalog, eq(standingOrderTemplateItems.serviceId, serviceCatalog.id))
      // LEFT JOIN catch-all service_prices row (branch=null, payer=null, effectiveFrom<=today)
      .leftJoin(
        servicePrices,
        and(
          eq(servicePrices.serviceId, serviceCatalog.id),
          eq(servicePrices.tenantId, tenantId),
          isNull(servicePrices.branchId),
          isNull(servicePrices.payerId),
          isNull(servicePrices.deletedAt),
          lte(servicePrices.effectiveFrom, sql`CURRENT_DATE`),
          or(isNull(servicePrices.effectiveTo), sql`${servicePrices.effectiveTo} >= CURRENT_DATE`)!,
        ),
      )
      .where(
        and(
          eq(standingOrderTemplateItems.tenantId, tenantId),
          inArray(standingOrderTemplateItems.templateId, templateIds),
          eq(standingOrderTemplateItems.dayOffset, 0),
        ),
      )
      .orderBy(asc(standingOrderTemplateItems.templateId), asc(standingOrderTemplateItems.sequence))

    // For each item, find the FEFO lot (earliest expiry, qty > 0, branch-scoped)
    const bundleItems: PreviewBundleItem[] = []
    let totalCents = 0

    for (const item of items) {
      // Stock preview — the earliest-expiring in-stock lot whose product
      // satisfies this service, shown so intake can see the Day-0 item is
      // available. Indicative only: the nurse picks the actual brand at
      // administer time. Eligibility goes through the shared helper
      // (modules/inventory/eligibility.ts) — a plain join on `product_id`
      // misses every abstract service and falsely reads "No lots in stock".
      const [lot] = await tx
        .select({
          // Surface display_id (LOT_<8 base32>) — never leak internal bigint to API
          id: inventoryLots.displayId,
          batchNumber: inventoryLots.batchNumber,
          expiryDate: inventoryLots.expiryDate,
        })
        .from(inventoryLots)
        .where(
          and(
            eq(inventoryLots.tenantId, tenantId),
            eq(inventoryLots.branchId, branchId), // bigint column = bigint value
            eq(inventoryLots.isQuarantined, false),
            gt(inventoryLots.quantityOnHand, '0'),
            sql`${inventoryLots.expiryDate} >= CURRENT_DATE`,
            sql`${inventoryLots.productId} IN ${eligibleProductIdsSql(tenantId, item.serviceId)}`,
          ),
        )
        .orderBy(asc(inventoryLots.expiryDate))
        .limit(1)

      const qty = item.quantity
      const unitPrice = item.serviceEffectivePrice ?? '0'
      const subtotalCents = toCents(multiplyMoney(unitPrice, qty))
      totalCents += subtotalCents

      bundleItems.push({
        service: {
          id: item.serviceId,
          name: item.serviceName,
          sku: item.serviceSku ?? null,
        },
        lot: lot
          ? {
              id: lot.id,
              batchNumber: lot.batchNumber,
            }
          : null,
        expiryDate: lot?.expiryDate ?? null,
        doseSize: null, // instructions field is on template items — surfaced in next iteration
        qty,
        unitPrice,
        subtotal: fromCents(subtotalCents),
      })
    }

    return {
      items: bundleItems,
      total: fromCents(totalCents),
    }
  })
}
