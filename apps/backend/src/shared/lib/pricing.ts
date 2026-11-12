/**
 * resolveServicePrice — look up the effective unit price for a service from
 * the `service_prices` table.
 *
 * Three optional dimensions, each NULL-able on the row (NULL = "applies to
 * all"). Precedence is by WEIGHT, not by count, so every combination has one
 * deterministic winner:
 *
 *   payer-specific    → 4   (a negotiated payer/HMO rate is contractual)
 *   product-specific  → 2   (a brand that costs more than the base service)
 *   branch-specific   → 1   (finest-grained tiebreak)
 *
 *   payer+brand+branch (7) > payer+brand (6) > payer+branch (5) > payer (4)
 *     > brand+branch (3)   > brand (2)      > branch (1)       > base (0)
 *
 * Why payer outranks brand: when a partner contract exists but no
 * brand-and-payer row does, the contracted rate is what the payer owes — the
 * clinic absorbs a pricier brand. To pass a brand's cost through to a payer,
 * seed an explicit (product_id, payer_id) row, which scores 6 and wins.
 *
 * NOTE this resolves a case that was previously ambiguous: branch-specific and
 * payer-specific both scored 1 and `effective_from DESC` broke the tie. Payer
 * now wins outright. No seeded row is affected — every seeded row (base and
 * partner alike) carries `branch_id = NULL`.
 *
 * Phase 1 backfill created one catch-all row per service with
 * branch_id=NULL, payer_id=NULL, product_id=NULL, effective_from='-infinity'.
 *
 * `id DESC` is the final tiebreaker and is NOT decorative. `effective_from`
 * and `effective_to` are DATE columns, and `updateService` supersedes a price
 * by setting `effective_to = today` while inserting the replacement with
 * `effective_from = today`. The validity filter below admits `effective_to >=
 * CURRENT_DATE`, so for the rest of that day BOTH rows are eligible, equally
 * weighted, and carry the same `effective_from`. Without the id tiebreaker the
 * winner was whatever Postgres happened to return first, so a second price
 * change on the same day could silently keep billing the superseded price (and
 * flip between requests). Newest row wins. Caught 2026-08-03 by the
 * BranchAdmin case in services-write-guard.test.ts.
 *
 * Phase 4 cutover: serviceCatalog.basePrice column has been dropped — every
 * active service should have at least one service_prices row. When no row is
 * found this returns '0.00' as a defensive fallback.
 *
 * Payer-wide percentage adjustment (payer_profiles.priceAdjustmentPercent):
 * a blanket "N% off/markup everything" rule, distinct from an explicit
 * (payer_id, service_id) service_prices row (a negotiated rate for one
 * specific service). The explicit row always wins outright — it already won
 * the weighted lookup above by scoring +4 — so the percentage only applies
 * when the winning row is NOT itself payer-specific, and the service isn't
 * listed in payer_price_adjustment_exclusions for that payer.
 */
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { payerPriceAdjustmentExclusions, payerProfiles, servicePrices } from '../db/schema.js'

// Drizzle transaction type — matches the `Tx` alias used elsewhere in the codebase.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type DbOrTx = typeof db | Tx

export async function resolveServicePrice(
  dbOrTx: DbOrTx,
  opts: {
    tenantId: string
    /** service_catalog.id — raw catalog code (text PK). */
    serviceId: string
    /** branches.id — bigint, or null for tenant-wide pricing. */
    branchId?: number | null
    /** payer_profiles.id — bigint, or null for cash/retail. */
    payerId?: number | null
    /**
     * products.id — the brand actually being dispensed, or null when the brand
     * is not yet known (catalog headline price, a bill raised before the nurse
     * picks a lot). Null restricts the lookup to brand-agnostic rows.
     */
    productId?: number | null
  },
): Promise<string> {
  const { tenantId, serviceId, branchId = null, payerId = null, productId = null } = opts

  // Build the WHERE for branchId: match exact branch OR null (all-branches)
  const branchCondition = branchId
    ? or(eq(servicePrices.branchId, branchId), isNull(servicePrices.branchId))!
    : isNull(servicePrices.branchId)

  // Build the WHERE for payerId: match exact payer OR null (retail/cash)
  const payerCondition = payerId
    ? or(eq(servicePrices.payerId, payerId), isNull(servicePrices.payerId))!
    : isNull(servicePrices.payerId)

  // Match this brand's rows OR the brand-agnostic ones. When the brand is
  // unknown, only brand-agnostic rows are eligible — a brand surcharge must
  // never leak into a bill raised before the brand was chosen.
  const productCondition = productId
    ? or(eq(servicePrices.productId, productId), isNull(servicePrices.productId))!
    : isNull(servicePrices.productId)

  const rows = await (dbOrTx as typeof db)
    .select({
      unitPrice: servicePrices.unitPrice,
      branchId: servicePrices.branchId,
      payerId: servicePrices.payerId,
      productId: servicePrices.productId,
    })
    .from(servicePrices)
    .where(
      and(
        eq(servicePrices.tenantId, tenantId),
        eq(servicePrices.serviceId, serviceId),
        isNull(servicePrices.deletedAt),
        // effectiveFrom <= today (handles '-infinity' correctly in Postgres)
        lte(servicePrices.effectiveFrom, sql`CURRENT_DATE`),
        // effectiveTo is null OR effectiveTo >= today
        or(isNull(servicePrices.effectiveTo), sql`${servicePrices.effectiveTo} >= CURRENT_DATE`)!,
        branchCondition,
        payerCondition,
        productCondition,
      ),
    )
    .orderBy(
      // Weighted most-specific-wins — payer (4) > product (2) > branch (1).
      // See the docblock for the full 8-row precedence ladder.
      sql`(CASE WHEN ${servicePrices.payerId}   IS NOT NULL THEN 4 ELSE 0 END +
          CASE WHEN ${servicePrices.productId} IS NOT NULL THEN 2 ELSE 0 END +
          CASE WHEN ${servicePrices.branchId}  IS NOT NULL THEN 1 ELSE 0 END) DESC,
         ${servicePrices.effectiveFrom} DESC,
         ${servicePrices.id} DESC`,
    )
    .limit(1)

  const winner = rows[0]
  const resolvedPrice = winner && winner.unitPrice != null ? winner.unitPrice : null

  if (payerId && resolvedPrice !== null && winner!.payerId !== payerId) {
    const adjusted = await applyPayerPriceAdjustment(
      dbOrTx,
      { tenantId, payerId, serviceId },
      resolvedPrice,
    )
    if (adjusted !== null) return adjusted
  }

  if (resolvedPrice !== null) {
    return resolvedPrice
  }

  // Phase 4: serviceCatalog.basePrice has been dropped. Defensive fallback only.
  return '0.00'
}

async function applyPayerPriceAdjustment(
  dbOrTx: DbOrTx,
  opts: { tenantId: string; payerId: number; serviceId: string },
  resolvedPrice: string,
): Promise<string | null> {
  const [payer] = await (dbOrTx as typeof db)
    .select({ percent: payerProfiles.priceAdjustmentPercent })
    .from(payerProfiles)
    .where(and(eq(payerProfiles.tenantId, opts.tenantId), eq(payerProfiles.id, opts.payerId)))
    .limit(1)

  if (payer?.percent == null) return null

  const [excluded] = await (dbOrTx as typeof db)
    .select({ serviceId: payerPriceAdjustmentExclusions.serviceId })
    .from(payerPriceAdjustmentExclusions)
    .where(
      and(
        eq(payerPriceAdjustmentExclusions.tenantId, opts.tenantId),
        eq(payerPriceAdjustmentExclusions.payerId, opts.payerId),
        eq(payerPriceAdjustmentExclusions.serviceId, opts.serviceId),
      ),
    )
    .limit(1)

  if (excluded) return null

  const factor = 1 + Number(payer.percent) / 100
  return (Number(resolvedPrice) * factor).toFixed(2)
}
