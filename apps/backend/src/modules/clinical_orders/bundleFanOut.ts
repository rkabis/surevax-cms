/**
 * Bundle fan-out helper — atomic fan-out of bundle service constituents.
 *
 * When a clinician orders a bundle service (e.g. lab panel SV01, wellness
 * package), this helper fans out to create one lab_orders row (for Lab-type
 * constituents) or clinical_orders row (for other types) per constituent in
 * service_bundle_items.
 *
 * FAIL-WHOLE-BUNDLE semantics: if any constituent has insufficient inventory
 * (for Vaccine/Procedure/Product types), the entire fan-out is aborted and a
 * BundleFanOutError is thrown naming the missing constituent. Postgres rolls
 * back all sibling inserts because this runs inside an open db.transaction().
 *
 * Bundle detection (§5d): caller should check for service_bundle_items rows
 * BEFORE invoking fanOutBundle. Use isBundleService() for this.
 *
 * Call-site integration (§5f): fanOutBundle is called from createTransaction
 * (transactions/db.ts) after the transaction header + items are written,
 * within the SAME withTenantTx call. The bundle stays the single billable
 * line item in transaction_items — this helper only creates the work-order
 * rows (clinical_orders / lab_orders) for each constituent.
 *
 * NOT called from arrivals (day-0 intake uses standing-order flow) — see
 * arrivals/ module for the SOT-vs-bundle distinction.
 *
 * Two-tier IDs: bigserial PKs for internal FKs; display_id text for the
 * public surface. Returns display_ids in the result payload.
 *
 * Void unwind (see fanOutVoid.ts): every clinical_orders row created here
 * carries `fan_out_transaction_id = transactions.id` so a later void of that
 * same transaction can find and cancel exactly these rows, and reverse any
 * stock the fan-out consumed. This function has no duplicate guard of its
 * own: it is safe to call twice for the same transaction (a corrected
 * re-entry after a proper void) only because voidTransaction cancels the
 * first set first.
 */
import { and, eq, sql, type SQL } from 'drizzle-orm'
import {
  serviceBundleItems,
  serviceCatalog,
  clinicalOrders,
  labOrders,
} from '../../shared/db/schema.js'
import { displayId } from '../../shared/utils/displayId.js'
import type { Tx } from '../../shared/db/withTenantTx.js'
import { pickEarliestExpiringLot } from '../inventory/fefo.js'
import { eligibleProductIdsSql } from '../inventory/eligibility.js'
import { assertActiveConsent } from '../../shared/utils/consent.js'

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/**
 * Thrown when a bundle constituent fails stock check or is inactive.
 * The route handler maps this to a 409 with the offending service id named.
 */
export class BundleFanOutError extends Error {
  constructor(
    /** service_catalog.id of the offending constituent. */
    public readonly constituentServiceId: string,
    /** Machine-readable reason code. */
    public readonly reason: 'OUT_OF_STOCK' | 'INACTIVE_SERVICE',
    /** Human-readable explanation, forwarded to the client. */
    message: string,
  ) {
    super(message)
    this.name = 'BundleFanOutError'
  }
}

// ---------------------------------------------------------------------------
// Bundle detection — cheap check: does this service have any bundle items?
// ---------------------------------------------------------------------------

/**
 * Returns true if the given service code has at least one row in
 * service_bundle_items for the given tenant. Caller must be inside a
 * withTenantTx call (or pass a Tx directly) when doing this inside
 * an existing transaction.
 *
 * Uses the open tx when supplied (no nested transaction); otherwise runs
 * against the shared db pool.
 */
export async function isBundleService(
  tenantId: string,
  bundleServiceId: string,
  /** Open Drizzle transaction. When provided, runs inside it (no new tx). */
  tx?: Tx,
): Promise<boolean> {
  // Use the tx when inside an existing transaction to avoid a new db.transaction()
  // nesting, which Postgres/postgres-js doesn't support in the same connection.
  const executor = tx ?? (await import('../../shared/db/index.js')).db
  const rows = await executor
    .select({ bundleServiceId: serviceBundleItems.bundleServiceId })
    .from(serviceBundleItems)
    .where(
      and(
        eq(serviceBundleItems.tenantId, tenantId),
        eq(serviceBundleItems.bundleServiceId, bundleServiceId),
      ),
    )
    .limit(1)
  return rows.length > 0
}

// ---------------------------------------------------------------------------
// Fan-out input / result types
// ---------------------------------------------------------------------------

export type FanOutBundleInput = {
  /** Tenant slug (text PK on tenants.id). */
  tenantId: string
  /** branches.id (bigint). Required for stock checks. */
  branchId: number
  /** users.id (bigint) — the ordering clinician. */
  userId: number
  /** service_catalog.id (raw text code) of the bundle row. */
  bundleServiceId: string
  /** encounters.id bigint FK — links fan-out orders to the encounter. */
  encounterId: number | null
  /** patients.id bigint FK — patient receiving the orders. */
  patientId: number
  /**
   * transactions.id (bigint): the bill this fan-out is created for.
   *
   * Written onto every clinical_orders row this call creates (as
   * `fan_out_transaction_id`) so a later void of THIS transaction can find
   * exactly the orders its own fan-out produced. `clinical_orders/fanOutVoid.ts`
   * reads the column back to unwind it; see that file for why voiding must
   * own this work.
   */
  transactionId: number
  /**
   * Open Drizzle transaction from the outer withTenantTx call.
   * Fan-out MUST run inside the SAME transaction as the billing write
   * for fail-whole-bundle atomicity.
   */
  tx: Tx
}

export type FanOutBundleResult = {
  /** Total rows created (clinical_orders + lab_orders combined). */
  fannedOutCount: number
  /** display_ids of created clinical_orders rows (non-Lab constituents). */
  clinicalOrderIds: string[]
  /** display_ids of created lab_orders rows (Lab constituents). */
  labOrderIds: string[]
}

// ---------------------------------------------------------------------------
// Core helper
// ---------------------------------------------------------------------------

/**
 * Atomically fans out a bundle service into its constituent work orders.
 *
 * MUST be called with an open `tx` inside an existing withTenantTx (e.g.
 * from createTransaction in transactions/db.ts). Never opens a new
 * db.transaction() internally — that would nest transactions which
 * postgres-js does not support.
 *
 * Algorithm (§5e):
 *  1. Load bundle constituents joined with serviceCatalog.
 *  2. For Vaccine/Procedure/Product constituents — verify stock via
 *     pickEarliestExpiringLot (throws BundleFanOutError on failure before any
 *     writes). Lab/Consultation constituents skip stock check.
 *  3. After ALL stock checks pass, write clinical_orders (non-Lab) and
 *     lab_orders (Lab) rows.
 *  4. Return { fannedOutCount, clinicalOrderIds, labOrderIds }.
 *
 * If step 2 throws for ANY constituent, no rows are written; Postgres
 * rolls back all sibling inserts via the enclosing transaction.
 */
export async function fanOutBundle(input: FanOutBundleInput): Promise<FanOutBundleResult> {
  const { tenantId, branchId, userId, bundleServiceId, encounterId, patientId, transactionId, tx } =
    input

  // DPA §19 + §34(b): reject bundle fan-out when patient consent is revoked/absent.
  await assertActiveConsent(tx, tenantId, patientId)

  // ── 1. Load constituents joined with service_catalog ────────────────────
  const items = await tx
    .select({
      itemServiceId: serviceBundleItems.itemServiceId,
      quantity: serviceBundleItems.quantity,
      displayOrder: serviceBundleItems.displayOrder,
      serviceType: serviceCatalog.serviceType,
      isActive: serviceCatalog.isActive,
    })
    .from(serviceBundleItems)
    .innerJoin(
      serviceCatalog,
      and(
        eq(serviceCatalog.id, serviceBundleItems.itemServiceId),
        eq(serviceCatalog.tenantId, tenantId),
      ) as SQL<boolean>,
    )
    .where(
      and(
        eq(serviceBundleItems.tenantId, tenantId),
        eq(serviceBundleItems.bundleServiceId, bundleServiceId),
      ),
    )
    .orderBy(serviceBundleItems.displayOrder)

  if (items.length === 0) {
    // Bundle row exists but has no constituents — treated as an empty bundle.
    // Return early without error; the transaction proceeds normally.
    return { fannedOutCount: 0, clinicalOrderIds: [], labOrderIds: [] }
  }

  // ── 2. Validate all constituents before writing anything ─────────────────
  // Check active status for all; stock-check for inventory-backed types.
  // We need clinical_order bigint IDs BEFORE stock check because pickEarliestExpiringLot
  // requires a clinical_order_id. However, we can't write clinical_orders before
  // validating all stock. Strategy: pre-generate display_ids + insert clinical_orders
  // for non-Lab items first, then do stock check, then insert lab_orders.
  // Wait — that breaks atomicity. The correct approach:
  //   a. Check active status (pure read).
  //   b. For inventory-backed types: do a read-only availability check first
  //      (no deduction). If any fail, abort with BundleFanOutError.
  //   c. After all checks pass, insert clinical_orders for non-Lab constituents.
  //   d. Run pickEarliestExpiringLot for inventory-backed orders (now that we have
  //      the clinical_order bigint IDs from step c).
  //   e. Insert lab_orders for Lab constituents.

  // ── 2a. Active status check (pure read, no writes) ──────────────────────
  // Note: panel-only lab constituents intentionally carry isActive = false
  // (see gotchas.md: "Panel Constituents (hidden)"). These hidden items exist
  // solely to satisfy service_bundle_items FK constraints — they are always
  // orderable through the bundle. We skip the isActive check for Lab-type
  // constituents; only Vaccine/Procedure/Product constituents must be active
  // since an inactive non-Lab constituent would indicate a real deactivation.
  for (const item of items) {
    if (!item.isActive && item.serviceType !== 'Lab') {
      throw new BundleFanOutError(
        item.itemServiceId,
        'INACTIVE_SERVICE',
        `Bundle constituent "${item.itemServiceId}" is inactive and cannot be ordered`,
      )
    }
  }

  // ── 2b. Pre-flight stock availability check for inventory-backed types ───
  // Separate from deduction — we want to catch ALL failures before any writes.
  // Read inventory_lots to confirm sufficient stock without locking (no SKIP LOCKED).
  // Actual deduction happens in step 3d after clinical_orders are inserted.
  const INVENTORY_BACKED: ReadonlySet<string> = new Set(['Vaccine', 'Procedure', 'Product'])

  // INV-5: aggregate required quantity per product across ALL bundle constituents
  // before checking availability. Without this aggregation, a bundle with two
  // constituents backed by the same product (e.g. two vaccine doses from the
  // same lot) could pass per-item checks individually even when combined demand
  // exceeds available stock, then fail mid-fan-out during the deduction pass.
  //
  // Strategy: for each inventory-backed constituent, resolve the set of eligible
  // product IDs, then accumulate total quantity demanded per product ID. The
  // per-product aggregate is what we check against the lot's quantity_on_hand.
  type ProductDemand = {
    totalQuantity: number
    /** First constituent service ID that introduced this product (for error reporting). */
    firstServiceId: string
  }
  const productDemandMap = new Map<number, ProductDemand>()

  for (const item of items) {
    if (!INVENTORY_BACKED.has(item.serviceType)) continue

    // Which products satisfy this constituent — shared definition.
    const eligibleRows = await tx.execute(
      sql`SELECT product_id FROM ${eligibleProductIdsSql(tenantId, item.itemServiceId)} AS eligible`,
    )
    const eligibleProductIds = (eligibleRows as unknown as { product_id: number }[]).map(
      (r) => r.product_id,
    )

    for (const productId of eligibleProductIds) {
      const existing = productDemandMap.get(productId)
      if (existing) {
        existing.totalQuantity += item.quantity
      } else {
        productDemandMap.set(productId, {
          totalQuantity: item.quantity,
          firstServiceId: item.itemServiceId,
        })
      }
    }
  }

  // Check that the branch holds enough stock per product to satisfy cumulative demand.
  for (const [productId, demand] of productDemandMap) {
    const stockCheck = await tx.execute(
      sql`
        SELECT COALESCE(SUM(il.quantity_on_hand::numeric), 0) AS total_qty
        FROM inventory_lots il
        WHERE
          il.tenant_id           = ${tenantId}
          AND il.branch_id       = ${branchId}
          AND il.product_id      = ${productId}
          AND il.is_quarantined  = false
          AND il.expiry_date >= CURRENT_DATE
      `,
    )
    const totalQty = Number((stockCheck as unknown as { total_qty: string }[])[0]?.total_qty ?? '0')
    if (totalQty < demand.totalQuantity) {
      throw new BundleFanOutError(
        demand.firstServiceId,
        'OUT_OF_STOCK',
        `Insufficient inventory for bundle constituent "${demand.firstServiceId}" (product ${productId}: need ${demand.totalQuantity}, have ${totalQty})`,
      )
    }
  }

  // ── 3. All checks passed — write rows ───────────────────────────────────
  const clinicalOrderIds: string[] = []
  const labOrderIds: string[] = []

  // Non-Lab constituents → clinical_orders
  const nonLabItems = items.filter((i) => i.serviceType !== 'Lab')
  if (nonLabItems.length > 0) {
    const orderRows = nonLabItems.map((item) => ({
      displayId: displayId('ORD'),
      tenantId,
      patientId,
      serviceId: item.itemServiceId,
      encounterId,
      // Bundle-driven orders are Ad_Hoc (not part of a standing-order schedule).
      orderType: 'Ad_Hoc' as const,
      status: 'Pending' as const,
      quantity: String(item.quantity),
      fanOutTransactionId: transactionId,
      createdById: userId,
    }))

    const insertedOrders = await tx.insert(clinicalOrders).values(orderRows).returning({
      id: clinicalOrders.id,
      displayId: clinicalOrders.displayId,
      serviceId: clinicalOrders.serviceId,
    })

    // Collect display_ids for the result.
    for (const row of insertedOrders) {
      clinicalOrderIds.push(row.displayId)
    }

    // ── 3d. Stock deduction, earliest-expiry (after clinical_order rows exist) ───
    for (const row of insertedOrders) {
      const item = nonLabItems.find((i) => i.itemServiceId === row.serviceId)!
      if (INVENTORY_BACKED.has(item.serviceType)) {
        // Point-of-sale fan-out keeps the automatic earliest-expiry pick: a
        // cashier billing a panel is not choosing a brand. The dose path picks
        // its lot explicitly (deductLot).
        // The pre-flight check in 2b should have prevented reaching this point
        // with insufficient stock. If concurrent depletion occurs between 2b
        // and 3d, this throws and the transaction rolls back automatically.
        await pickEarliestExpiringLot(
          tx,
          {
            tenantId,
            branchId,
            serviceId: item.itemServiceId,
            clinicalOrderId: row.id,
            userId,
          },
          item.quantity,
        )
      }
    }
  }

  // Lab constituents → clinical_orders first (for FK), then lab_orders
  const labItems = items.filter((i) => i.serviceType === 'Lab')
  for (const item of labItems) {
    // 1. Insert clinical_orders row as the parent (lab_orders.clinical_order_id FK).
    const labClinicalOrderDid = displayId('ORD')
    const [insertedClinicalOrder] = await tx
      .insert(clinicalOrders)
      .values({
        displayId: labClinicalOrderDid,
        tenantId,
        patientId,
        serviceId: item.itemServiceId,
        encounterId,
        orderType: 'Ad_Hoc' as const,
        status: 'Pending' as const,
        quantity: String(item.quantity),
        fanOutTransactionId: transactionId,
        createdById: userId,
      })
      .returning({ id: clinicalOrders.id, displayId: clinicalOrders.displayId })

    if (!insertedClinicalOrder) {
      // Extremely unlikely in normal operation (tx should abort via pg error first).
      throw new BundleFanOutError(
        item.itemServiceId,
        'INACTIVE_SERVICE',
        `Failed to insert clinical_orders row for Lab constituent "${item.itemServiceId}"`,
      )
    }

    // 2. Insert lab_orders row referencing the clinical_order + branch.
    const [insertedLabOrder] = await tx
      .insert(labOrders)
      .values({
        displayId: displayId('LBO'),
        tenantId,
        clinicalOrderId: insertedClinicalOrder.id,
        branchId,
        createdById: userId,
      })
      .returning({ displayId: labOrders.displayId })

    if (!insertedLabOrder) {
      throw new BundleFanOutError(
        item.itemServiceId,
        'INACTIVE_SERVICE',
        `Failed to insert lab_orders row for Lab constituent "${item.itemServiceId}"`,
      )
    }

    clinicalOrderIds.push(insertedClinicalOrder.displayId)
    labOrderIds.push(insertedLabOrder.displayId)
  }

  return {
    fannedOutCount: clinicalOrderIds.length + labOrderIds.length,
    clinicalOrderIds,
    labOrderIds,
  }
}
