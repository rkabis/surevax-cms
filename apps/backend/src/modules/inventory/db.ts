import { and, eq, sql, desc, asc, ilike, isNull, or, gt, type Column } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { withTenantTx } from '../../shared/db/withTenantTx.js'
import {
  inventoryLots,
  inventoryMovements,
  inventoryLotBalances,
  products,
  users,
} from '../../shared/db/schema.js'
import { displayId } from '../../shared/utils/displayId.js'
import { LifecycleError } from '../transactions/db.js'
import { clinicCalendarDateString } from '../../shared/utils/clinicDate.js'

export type InventoryFilter = 'all' | 'low_stock' | 'quarantined' | 'expiring_soon'

// Map allow-listed sort keys → Drizzle column references.
// NEVER pass user-supplied sort strings to sql.identifier() — map through this object.
const INVENTORY_SORT_COLS: Record<string, Column> = {
  expiry_date: inventoryLots.expiryDate,
  quantity_on_hand: inventoryLots.quantityOnHand,
  received_at: inventoryLots.receivedAt,
}

/** Map DB movement_type enum → UI direction */
function movementDirection(type: string): 'in' | 'out' | 'adjust' {
  if (type === 'In') return 'in'
  if (type === 'Out' || type === 'Expire') return 'out'
  return 'adjust' // Adjustment, Transfer
}

/**
 * Day-scoped branch movement log for GET /api/inventory/movements?date=YYYY-MM-DD.
 * Filters by branch_id + tenant_id + the Asia/Manila clinic calendar day.
 *
 * Two-tier IDs (W3.b.1): inventory_movements / inventory_lots are bigserial PK with
 * display_id ('MVT_…' / 'LOT_…'). Public surface returns display_ids; internal joins
 * use bigint FKs (`lot_id`).
 */
export async function listInventoryMovements(opts: {
  tenantId: string
  branchId: number
  date: string // YYYY-MM-DD
}) {
  const rows = await withTenantTx(
    { tenantId: opts.tenantId, userId: 0, branchId: opts.branchId },
    async (tx) =>
      tx
        .select({
          // Public-facing — display_id, not the bigint PK.
          id: inventoryMovements.displayId,
          lotId: inventoryLots.displayId,
          batchNumber: inventoryLots.batchNumber,
          // serviceName retains its API-contract key for the frontend; the
          // value is now the product name (one lot → one product → N services).
          serviceName: products.name,
          movementType: inventoryMovements.movementType,
          quantityDelta: inventoryMovements.quantityDelta,
          notes: inventoryMovements.notes,
          performedAt: inventoryMovements.performedAt,
        })
        .from(inventoryMovements)
        .innerJoin(inventoryLots, eq(inventoryMovements.lotId, inventoryLots.id))
        .innerJoin(products, eq(inventoryLots.productId, products.id))
        .where(
          and(
            eq(inventoryMovements.tenantId, opts.tenantId),
            eq(inventoryMovements.branchId, opts.branchId),
            sql`(${inventoryMovements.performedAt} AT TIME ZONE 'Asia/Manila')::date = ${opts.date}::date`,
          ),
        )
        .orderBy(asc(inventoryMovements.performedAt)),
  )

  return rows.map((r) => ({
    movementId: r.id,
    lotNumber: r.batchNumber,
    serviceName: r.serviceName,
    movementType: r.movementType,
    direction: movementDirection(r.movementType),
    // quantityDelta is numeric(12,4); parse to number — never money, safe as float
    quantity: Math.abs(Number(r.quantityDelta)),
    reason: r.notes ?? null,
    occurredAt: r.performedAt.toISOString(),
  }))
}

/**
 * Opaque cursor for lot list pagination.
 * Encodes the sort-column value + bigint lot id so the cursor key always
 * matches the active sort, preventing skips/duplicates (API-3).
 *
 * Format: "<sortVal>:<id>" where sortVal is ISO-date, ISO-datetime, or
 * a numeric string depending on the active sort column.
 *
 * Consumers (route + frontend) treat this as opaque — only pass it back.
 */
export type LotListCursor = string

/** Build a LotListCursor from a DB row and the active sort column name. */
function buildLotCursor(
  row: {
    _internalId: number
    expiryDate: Date | string | null
    receivedAt: Date
    quantityReceived: string
  },
  sortCol: string,
): LotListCursor {
  let sortVal: string
  if (sortCol === 'expiry_date') {
    const d = row.expiryDate
    sortVal = d instanceof Date ? d.toISOString().slice(0, 10) : (d ?? '9999-12-31')
  } else if (sortCol === 'received_at') {
    sortVal = row.receivedAt.toISOString()
  } else if (sortCol === 'quantity_on_hand') {
    // quantity_on_hand is a numeric string from the lots table
    sortVal = row.quantityReceived // fallback — caller should use balance column
  } else {
    sortVal = String(row._internalId) // id-only fallback for unknown sorts
  }
  return `${sortVal}:${row._internalId}`
}

/** Parse a LotListCursor back into { sortVal, id }. Returns null on bad input. */
function parseLotCursor(cursor: string): { sortVal: string; id: number } | null {
  const colonIdx = cursor.lastIndexOf(':')
  if (colonIdx < 1) return null
  const sortVal = cursor.slice(0, colonIdx)
  const id = Number.parseInt(cursor.slice(colonIdx + 1), 10)
  if (!Number.isFinite(id) || id <= 0) return null
  return { sortVal, id }
}

export async function listInventoryLots(opts: {
  tenantId: string
  q?: string
  filter?: InventoryFilter
  cursor?: LotListCursor // opaque compound cursor — see LotListCursor above
  limit?: number // default 50, max 200
  sort?: string
  order?: 'asc' | 'desc'
}) {
  const conditions = [eq(inventoryLots.tenantId, opts.tenantId)]

  if (opts.q) {
    conditions.push(
      or(ilike(products.name, `%${opts.q}%`), ilike(inventoryLots.batchNumber, `%${opts.q}%`))!,
    )
  }

  // Filters use inventory_lot_balances.quantity_available/quantity_on_hand
  // For low_stock we still fall back to the lots column since the filter is
  // UI-convenience only (not safety-critical) — keeps the join simpler.
  if (opts.filter === 'low_stock') {
    conditions.push(
      sql`CAST(${inventoryLots.quantityOnHand} AS numeric) > 0`,
      sql`CAST(${inventoryLots.quantityOnHand} AS numeric) <= 5`,
    )
  } else if (opts.filter === 'quarantined') {
    conditions.push(eq(inventoryLots.isQuarantined, true))
  } else if (opts.filter === 'expiring_soon') {
    conditions.push(
      sql`${inventoryLots.expiryDate}::date > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date`,
      sql`${inventoryLots.expiryDate}::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date + INTERVAL '90 days'`,
    )
  }

  // API-3: compound cursor — key matches the active sort column so pages
  // are contiguous even when sort values repeat (e.g. two lots same expiry_date).
  // Cursor condition: (sortCol > lastSortVal) OR (sortCol = lastSortVal AND id > lastId)
  // for ASC sorts; swap > / < for DESC.
  if (opts.cursor !== undefined) {
    const parsed = parseLotCursor(opts.cursor)
    if (parsed !== null) {
      const { sortVal, id } = parsed
      const effectiveSortCol = opts.sort ?? 'expiry_date'
      const isAsc = (opts.order ?? (effectiveSortCol === 'expiry_date' ? 'asc' : 'desc')) === 'asc'
      if (effectiveSortCol === 'expiry_date') {
        conditions.push(
          isAsc
            ? sql`(${inventoryLots.expiryDate} > ${sortVal}::date OR (${inventoryLots.expiryDate} = ${sortVal}::date AND ${inventoryLots.id} > ${id}))`
            : sql`(${inventoryLots.expiryDate} < ${sortVal}::date OR (${inventoryLots.expiryDate} = ${sortVal}::date AND ${inventoryLots.id} > ${id}))`,
        )
      } else if (effectiveSortCol === 'received_at') {
        conditions.push(
          isAsc
            ? sql`(${inventoryLots.receivedAt} > ${sortVal}::timestamptz OR (${inventoryLots.receivedAt} = ${sortVal}::timestamptz AND ${inventoryLots.id} > ${id}))`
            : sql`(${inventoryLots.receivedAt} < ${sortVal}::timestamptz OR (${inventoryLots.receivedAt} = ${sortVal}::timestamptz AND ${inventoryLots.id} > ${id}))`,
        )
      } else if (effectiveSortCol === 'quantity_on_hand') {
        conditions.push(
          isAsc
            ? sql`(${inventoryLots.quantityOnHand}::numeric > ${sortVal}::numeric OR (${inventoryLots.quantityOnHand}::numeric = ${sortVal}::numeric AND ${inventoryLots.id} > ${id}))`
            : sql`(${inventoryLots.quantityOnHand}::numeric < ${sortVal}::numeric OR (${inventoryLots.quantityOnHand}::numeric = ${sortVal}::numeric AND ${inventoryLots.id} > ${id}))`,
        )
      } else {
        // Fallback: id-only cursor (safe for any sort, just not skip-proof)
        conditions.push(gt(inventoryLots.id, id))
      }
    }
  }

  const pageSize = Math.min(opts.limit ?? 50, 200)

  // Count total matching rows (ignoring cursor) for X-Total-Count header
  const countConditions = [eq(inventoryLots.tenantId, opts.tenantId)]
  if (opts.q) {
    countConditions.push(
      or(ilike(products.name, `%${opts.q}%`), ilike(inventoryLots.batchNumber, `%${opts.q}%`))!,
    )
  }

  const [countResult] = await withTenantTx(
    { tenantId: opts.tenantId, userId: 0, branchId: null },
    async (tx) =>
      tx
        .select({ count: sql<number>`COUNT(*)` })
        .from(inventoryLots)
        .innerJoin(products, eq(inventoryLots.productId, products.id))
        .where(and(...countConditions)),
  )

  const totalCount = Number(countResult?.count ?? 0)

  // Post-0011: inventory is product-keyed. Service variants (and their
  // sale prices) live one hop away; an inventory row no longer has a single
  // "effective price." The frontend's basePrice/effectivePrice fields stay
  // for backward compat and return '0.00' — order placement is the right
  // surface for price resolution (resolveServicePrice by service variant).
  const rows = await withTenantTx(
    { tenantId: opts.tenantId, userId: 0, branchId: null },
    async (tx) =>
      tx
        .select({
          // Public-facing — surface display_id as `id` so the API never leaks bigint.
          id: inventoryLots.displayId,
          // internalId + sort-column values are used ONLY for cursor construction below;
          // they are stripped from the mapped output before returning.
          _internalId: inventoryLots.id,
          tenantId: inventoryLots.tenantId,
          serviceName: products.name,
          batchNumber: inventoryLots.batchNumber,
          expiryDate: inventoryLots.expiryDate,
          manufacturer: inventoryLots.manufacturer,
          unitCost: inventoryLots.unitCost,
          costCurrency: inventoryLots.costCurrency,
          locationId: inventoryLots.locationId,
          isQuarantined: inventoryLots.isQuarantined,
          isRecalled: sql<boolean>`EXISTS (
            SELECT 1 FROM product_recalls pr
            WHERE pr.tenant_id = ${opts.tenantId}
              AND pr.resolved_at IS NULL
              AND pr.deleted_at IS NULL
              AND (
                (pr.affected_lots_pattern IS NULL AND pr.product_id = ${inventoryLots.productId})
                OR (
                  pr.affected_lots_pattern IS NOT NULL
                  AND (pr.product_id IS NULL OR pr.product_id = ${inventoryLots.productId})
                  AND starts_with(lower(${inventoryLots.batchNumber}), lower(pr.affected_lots_pattern))
                )
              )
          )`,
          quarantineReason: inventoryLots.quarantineReason,
          supplierName: inventoryLots.supplierName,
          receivedAt: inventoryLots.receivedAt,
          balanceQuantityOnHand: inventoryLotBalances.quantityOnHand,
          balanceQuantityAvailable: inventoryLotBalances.quantityAvailable,
          balanceWeightedAverageCost: inventoryLotBalances.weightedAverageCost,
          quantityReceived: inventoryLots.quantityReceived,
        })
        .from(inventoryLots)
        .innerJoin(products, eq(inventoryLots.productId, products.id))
        .leftJoin(inventoryLotBalances, eq(inventoryLotBalances.lotId, inventoryLots.id))
        .where(and(...conditions))
        .orderBy(
          // Default: FEFO (expiry_date asc). Honour ?sort=<col>&order=asc|desc when supplied.
          (() => {
            const col = INVENTORY_SORT_COLS[opts.sort ?? 'expiry_date'] ?? inventoryLots.expiryDate
            // Default direction for FEFO is asc; for non-FEFO columns default is desc
            const defaultDir = opts.sort && opts.sort !== 'expiry_date' ? 'desc' : 'asc'
            const dirFn = (opts.order ?? defaultDir) === 'asc' ? asc : desc
            return dirFn(col)
          })(),
        )
        .limit(pageSize),
  )

  const mapped = rows.map((r) => ({
    id: r.id,
    serviceName: r.serviceName,
    // serviceType field retained on the wire; non-meaningful at product
    // level (one product → N service variants). Returning 'Vaccine' as a
    // pragmatic default — frontend uses it only for filter chips today.
    serviceType: 'Vaccine' as const,
    batchNumber: r.batchNumber,
    expiryDate: r.expiryDate,
    manufacturer: r.manufacturer ?? null,
    unitCost: r.unitCost != null ? String(r.unitCost) : null,
    costCurrency: r.costCurrency,
    locationId: r.locationId ?? null,
    quantityOnHand: r.balanceQuantityOnHand != null ? String(r.balanceQuantityOnHand) : '0',
    quantityAvailable:
      r.balanceQuantityAvailable != null ? String(r.balanceQuantityAvailable) : null,
    weightedAverageCost:
      r.balanceWeightedAverageCost != null ? String(r.balanceWeightedAverageCost) : null,
    quantityReceived: String(r.quantityReceived),
    isQuarantined: r.isQuarantined,
    isRecalled: r.isRecalled,
    quarantineReason: r.quarantineReason,
    supplierName: r.supplierName,
    receivedAt: r.receivedAt.toISOString().slice(0, 10),
    service: {
      basePrice: '0.00',
      effectivePrice: '0.00',
    },
    // _cursor is internal — stripped from the public API response in the route.
    _cursor: buildLotCursor(r, opts.sort ?? 'expiry_date'),
  }))

  // Build next-page cursor from the last row's sort-column value + internal id.
  const lastRow = rows[rows.length - 1]
  const nextCursor: LotListCursor | null =
    lastRow != null && mapped.length === pageSize
      ? buildLotCursor(lastRow, opts.sort ?? 'expiry_date')
      : null

  // Strip internal _cursor field from mapped rows before returning.
  const publicRows = mapped.map(({ _cursor: _ignored, ...rest }) => rest)

  // Internal return: route handler unpacks rows + totalCount + nextCursor.
  return { rows: publicRows, totalCount, nextCursor }
}

/**
 * Resolve a LOT_<…> display_id to its bigint PK + canonical row, scoped to tenant.
 * Returns null when no match — callers should 404.
 */
async function resolveLotByDisplayId(opts: { tenantId: string; displayId: string }) {
  return withTenantTx({ tenantId: opts.tenantId, userId: 0, branchId: null }, async (tx) => {
    const [row] = await tx
      .select({ id: inventoryLots.id })
      .from(inventoryLots)
      .where(
        and(eq(inventoryLots.tenantId, opts.tenantId), eq(inventoryLots.displayId, opts.displayId)),
      )
      .limit(1)
    return row ?? null
  })
}

export async function getInventoryLot(opts: { tenantId: string; displayId: string }) {
  // Post-0011: detail view exposes the product (physical SKU) instead of a
  // single service variant. `service.*` fields kept on the wire for backward
  // compat; populated from product columns. Price fields return '0.00' —
  // resolveServicePrice runs at order-placement time, not on inventory detail.
  const createdByUser = alias(users, 'created_by_user')
  const row = await withTenantTx(
    { tenantId: opts.tenantId, userId: 0, branchId: null },
    async (tx) => {
      const [r] = await tx
        .select({
          // Public id field surfaces display_id; bigint PK never leaves the layer.
          id: inventoryLots.displayId,
          tenantId: inventoryLots.tenantId,
          branchId: inventoryLots.branchId,
          productId: inventoryLots.productId,
          batchNumber: inventoryLots.batchNumber,
          expiryDate: inventoryLots.expiryDate,
          quantityReceived: inventoryLots.quantityReceived,
          isQuarantined: inventoryLots.isQuarantined,
          quarantineReason: inventoryLots.quarantineReason,
          manufacturer: inventoryLots.manufacturer,
          unitCost: inventoryLots.unitCost,
          costCurrency: inventoryLots.costCurrency,
          locationId: inventoryLots.locationId,
          supplierName: inventoryLots.supplierName,
          receivedAt: inventoryLots.receivedAt,
          createdAt: inventoryLots.createdAt,
          updatedAt: inventoryLots.updatedAt,
          createdById: inventoryLots.createdById,
          balanceQuantityOnHand: inventoryLotBalances.quantityOnHand,
          balanceQuantityAvailable: inventoryLotBalances.quantityAvailable,
          balanceWeightedAverageCost: inventoryLotBalances.weightedAverageCost,
          productName: products.name,
          // createdBy
          createdByUserId: createdByUser.id,
          createdByDisplayId: createdByUser.displayId,
          createdByFirstName: createdByUser.firstName,
          createdByLastName: createdByUser.lastName,
        })
        .from(inventoryLots)
        .innerJoin(products, eq(inventoryLots.productId, products.id))
        .leftJoin(inventoryLotBalances, eq(inventoryLotBalances.lotId, inventoryLots.id))
        .leftJoin(createdByUser, eq(createdByUser.id, inventoryLots.createdById))
        .where(
          and(
            eq(inventoryLots.displayId, opts.displayId),
            eq(inventoryLots.tenantId, opts.tenantId),
          ),
        )
        .limit(1)
      return r ?? null
    },
  )

  if (!row) return null

  return {
    ...row,
    manufacturer: row.manufacturer ?? null,
    unitCost: row.unitCost != null ? String(row.unitCost) : null,
    costCurrency: row.costCurrency,
    locationId: row.locationId ?? null,
    quantityOnHand: row.balanceQuantityOnHand != null ? String(row.balanceQuantityOnHand) : '0',
    quantityAvailable:
      row.balanceQuantityAvailable != null ? String(row.balanceQuantityAvailable) : null,
    weightedAverageCost:
      row.balanceWeightedAverageCost != null ? String(row.balanceWeightedAverageCost) : null,
    quantityReceived: String(row.quantityReceived),
    receivedAt: row.receivedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdBy: row.createdByUserId
      ? {
          id: row.createdByUserId,
          displayId: row.createdByDisplayId!,
          firstName: row.createdByFirstName!,
          lastName: row.createdByLastName!,
        }
      : null,
    service: {
      // serviceName is the product name (one lot → one product → N services).
      // Surface productId as a bare number — frontend uses it as an opaque tag.
      id: row.productId,
      code: '',
      name: row.productName,
      serviceType: 'Vaccine' as const,
      category: null as string | null,
      basePrice: '0.00',
      effectivePrice: '0.00',
    },
  }
}

export async function getInventorySummary(tenantId: string) {
  const [result] = await withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) =>
    tx
      .select({
        totalUnits: sql<number>`COALESCE(SUM(CAST(${inventoryLots.quantityOnHand} AS numeric)), 0)`,
        lowStockCount: sql<number>`COUNT(*) FILTER (WHERE CAST(${inventoryLots.quantityOnHand} AS numeric) > 0 AND CAST(${inventoryLots.quantityOnHand} AS numeric) <= 5 AND ${inventoryLots.isQuarantined} = false)`,
        quarantinedCount: sql<number>`COUNT(*) FILTER (WHERE ${inventoryLots.isQuarantined} = true)`,
        expiringCount: sql<number>`COUNT(*) FILTER (WHERE ${inventoryLots.expiryDate}::date > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date AND ${inventoryLots.expiryDate}::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date + INTERVAL '90 days' AND ${inventoryLots.isQuarantined} = false)`,
      })
      .from(inventoryLots)
      .where(eq(inventoryLots.tenantId, tenantId)),
  )

  return {
    totalUnits: Number(result?.totalUnits ?? 0),
    lowStockCount: Number(result?.lowStockCount ?? 0),
    quarantinedCount: Number(result?.quarantinedCount ?? 0),
    expiringCount: Number(result?.expiringCount ?? 0),
  }
}

/**
 * Phase 2: List movement history for a lot from inventory_movements.
 * Accepts a LOT_<…> display_id; resolves to bigint then fetches movements.
 * Returns display_ids on the public surface (movement display_id; FK refs
 * stay as bigints since they target sibling tables not yet at the public
 * boundary).
 */
export async function getLotMovements(opts: {
  tenantId: string
  lotDisplayId: string
  limit?: number
}) {
  const lot = await resolveLotByDisplayId({ tenantId: opts.tenantId, displayId: opts.lotDisplayId })
  if (!lot) return null

  const rows = await withTenantTx(
    { tenantId: opts.tenantId, userId: 0, branchId: null },
    async (tx) =>
      tx
        .select({
          id: inventoryMovements.displayId,
          lotId: inventoryLots.displayId,
          branchId: inventoryMovements.branchId,
          movementType: inventoryMovements.movementType,
          quantityDelta: inventoryMovements.quantityDelta,
          unitCostSnapshot: inventoryMovements.unitCostSnapshot,
          clinicalOrderId: inventoryMovements.clinicalOrderId,
          inventoryAdjustmentId: inventoryMovements.inventoryAdjustmentId,
          inventoryTransferId: inventoryMovements.inventoryTransferId,
          notes: inventoryMovements.notes,
          performedById: inventoryMovements.performedById,
          performedAt: inventoryMovements.performedAt,
          createdAt: inventoryMovements.createdAt,
        })
        .from(inventoryMovements)
        .innerJoin(inventoryLots, eq(inventoryMovements.lotId, inventoryLots.id))
        .where(
          and(eq(inventoryMovements.lotId, lot.id), eq(inventoryMovements.tenantId, opts.tenantId)),
        )
        .orderBy(desc(inventoryMovements.performedAt))
        .limit(opts.limit ?? 100),
  )

  return rows.map((r) => ({
    id: r.id,
    lotId: r.lotId,
    branchId: r.branchId,
    movementType: r.movementType,
    quantityDelta: String(r.quantityDelta),
    unitCostSnapshot: r.unitCostSnapshot != null ? String(r.unitCostSnapshot) : null,
    clinicalOrderId: r.clinicalOrderId ?? null,
    inventoryAdjustmentId: r.inventoryAdjustmentId ?? null,
    inventoryTransferId: r.inventoryTransferId ?? null,
    notes: r.notes ?? null,
    performedById: r.performedById,
    performedAt: r.performedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  }))
}

/**
 * Active products a nurse can receive stock against, optionally filtered by a
 * name/manufacturer substring. There is no standalone products module yet,
 * so this lives here alongside the other inventory reads to back the
 * frontend product picker in the receive-stock flow.
 */
export async function listActiveProducts(opts: {
  tenantId: string
  q?: string
}): Promise<Array<{ id: string; name: string; manufacturer: string | null }>> {
  const conditions = [
    eq(products.tenantId, opts.tenantId),
    eq(products.isActive, true),
    isNull(products.deletedAt),
  ]
  if (opts.q) {
    conditions.push(
      or(ilike(products.name, `%${opts.q}%`), ilike(products.manufacturer, `%${opts.q}%`))!,
    )
  }
  return withTenantTx({ tenantId: opts.tenantId, userId: 0, branchId: null }, async (tx) =>
    tx
      .select({ id: products.displayId, name: products.name, manufacturer: products.manufacturer })
      .from(products)
      .where(and(...conditions))
      .orderBy(asc(products.name))
      .limit(100),
  )
}

export type ReceiveStockInput = {
  productDisplayId: string
  batchNumber: string
  /** YYYY-MM-DD */
  expiryDate: string
  quantity: number
  /** Decimal string, up to 4 places: never a JS float. */
  unitCost: string
  manufacturer: string
  supplierName?: string | null
  supplierInvoiceNumber?: string | null
  notes?: string | null
}

export type ReceiveStockResult = {
  id: string
  batchNumber: string
  expiryDate: string
  quantityOnHand: string
  quantityReceived: string
  isNewLot: boolean
}

type ReceivedLotRow = {
  id: number
  display_id: string
  batch_number: string
  expiry_date: string
  quantity_on_hand: string
  quantity_received: string
}

/**
 * Receive a delivery of stock at the caller's branch: create a lot, or top up
 * an existing one, plus the paired 'In' movement the `maintain_lot_balances`
 * trigger needs to keep `inventory_lot_balances` in sync (see the trigger's
 * own comment in 0001_extensions_and_rls.sql: UPDATE-first, INSERT-if-missing,
 * never `ON CONFLICT`, a first receipt's positive delta is fine, but this
 * function's own lot-row write must follow the same lot-then-movement order
 * transfer-receipt uses).
 *
 * Duplicate-batch decision: the composite unique index on
 * (tenant_id, branch_id, product_id, batch_number) means a second delivery of
 * a batch already on hand at this branch can never become a second row, so a
 * matching batch number TOPS UP the existing lot's quantity_on_hand and
 * quantity_received rather than being refused outright. A matching batch
 * number with a DIFFERENT expiry is refused instead of silently overwritten:
 * a real batch never carries two expiries, so a mismatch is a data-entry
 * error worth catching, not a value to trust. A quarantined match is refused
 * too: silently adding fresh stock to a lot that was pulled from use would
 * effectively un-quarantine it.
 *
 * Must be called with a real branchId (resolved from the session by the
 * caller, never from the request body) and a real userId (the audit trigger
 * requires it on every write).
 */
export async function receiveStock(
  ctx: { tenantId: string; userId: number; branchId: number },
  input: ReceiveStockInput,
): Promise<ReceiveStockResult> {
  const { tenantId, userId, branchId } = ctx

  // Refuse an already-expired lot at intake. deductLot treats
  // FEFO treats expiry dates before the Manila clinic date as expired, so anything before today
  // would be dead stock the moment it landed; today itself stays
  // administrable, matching that same boundary.
  const todayIso = clinicCalendarDateString()
  if (input.expiryDate < todayIso) {
    throw new LifecycleError(
      `Cannot receive a lot expiring ${input.expiryDate}: that date has already passed`,
      'LOT_ALREADY_EXPIRED',
      422,
    )
  }

  return withTenantTx({ tenantId, userId, branchId }, async (tx) => {
    const [product] = await tx
      .select({ id: products.id, isActive: products.isActive })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.displayId, input.productDisplayId)))
      .limit(1)
    if (!product) {
      throw new LifecycleError('Product not found', 'PRODUCT_NOT_FOUND', 404)
    }
    if (!product.isActive) {
      throw new LifecycleError('Product is not active', 'PRODUCT_INACTIVE', 409)
    }

    // Lock any existing lot for this exact (tenant, branch, product, batch):
    // the same tuple the unique index guards.
    const existingRows = (await tx.execute(sql`
      SELECT id, expiry_date::text AS expiry_date, is_quarantined
      FROM inventory_lots
      WHERE tenant_id    = ${tenantId}
        AND branch_id    = ${branchId}
        AND product_id   = ${product.id}
        AND batch_number = ${input.batchNumber}
      LIMIT 1
      FOR UPDATE
    `)) as unknown as Array<{ id: number; expiry_date: string; is_quarantined: boolean }>
    const existing = existingRows[0]

    if (existing) {
      if (existing.expiry_date !== input.expiryDate) {
        throw new LifecycleError(
          `Batch ${input.batchNumber} already exists at this branch expiring ${existing.expiry_date}, but this delivery says ${input.expiryDate}. Check the batch number and expiry before receiving.`,
          'LOT_BATCH_EXPIRY_MISMATCH',
          409,
        )
      }
      if (existing.is_quarantined) {
        throw new LifecycleError(
          `Batch ${input.batchNumber} is quarantined at this branch. Resolve the quarantine before receiving more of it.`,
          'LOT_QUARANTINED',
          409,
        )
      }

      const updatedRows = (await tx.execute(sql`
        UPDATE inventory_lots
        SET quantity_on_hand  = quantity_on_hand + ${input.quantity},
            quantity_received = quantity_received + ${input.quantity},
            updated_at = NOW()
        WHERE id = ${existing.id}
          AND tenant_id = ${tenantId}
        RETURNING id, display_id, batch_number, expiry_date::text AS expiry_date,
                  quantity_on_hand, quantity_received
      `)) as unknown as ReceivedLotRow[]
      const updated = updatedRows[0]!

      await tx.insert(inventoryMovements).values({
        displayId: displayId('MVT'),
        tenantId,
        lotId: existing.id,
        branchId,
        movementType: 'In',
        quantityDelta: String(input.quantity),
        unitCostSnapshot: input.unitCost,
        notes: input.notes ?? 'Stock received (repeat delivery)',
        performedById: userId,
        createdById: userId,
      })

      return {
        id: updated.display_id,
        batchNumber: updated.batch_number,
        expiryDate: updated.expiry_date,
        quantityOnHand: String(updated.quantity_on_hand),
        quantityReceived: String(updated.quantity_received),
        isNewLot: false,
      }
    }

    // No existing lot for this batch: create one plus its paired 'In'
    // movement. A concurrent receive of the exact same batch can still race
    // past the SELECT above; the unique index is the backstop, translated
    // below into a clear conflict instead of a raw constraint error.
    const newLotDisplayId = displayId('LOT')
    let createdRows: ReceivedLotRow[]
    try {
      createdRows = (await tx.execute(sql`
        INSERT INTO inventory_lots (
          display_id, tenant_id, branch_id, product_id, batch_number, manufacturer,
          expiry_date, quantity_on_hand, quantity_received, unit_cost, cost_currency,
          is_quarantined, supplier_name, supplier_invoice_number, received_at,
          created_at, updated_at, created_by_id
        ) VALUES (
          ${newLotDisplayId}, ${tenantId}, ${branchId}, ${product.id}, ${input.batchNumber},
          ${input.manufacturer}, ${input.expiryDate}::date, ${input.quantity}, ${input.quantity},
          ${input.unitCost}::numeric, 'PHP', false, ${input.supplierName ?? null},
          ${input.supplierInvoiceNumber ?? null}, NOW(), NOW(), NOW(), ${userId}
        )
        RETURNING id, display_id, batch_number, expiry_date::text AS expiry_date,
                  quantity_on_hand, quantity_received
      `)) as unknown as ReceivedLotRow[]
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: string }).code === '23505'
      ) {
        throw new LifecycleError(
          `Batch ${input.batchNumber} was just received by someone else, refresh and try again`,
          'LOT_BATCH_RACE',
          409,
        )
      }
      throw err
    }
    const created = createdRows[0]!

    await tx.insert(inventoryMovements).values({
      displayId: displayId('MVT'),
      tenantId,
      lotId: created.id,
      branchId,
      movementType: 'In',
      quantityDelta: String(input.quantity),
      unitCostSnapshot: input.unitCost,
      notes: input.notes ?? 'Stock received',
      performedById: userId,
      createdById: userId,
    })

    return {
      id: created.display_id,
      batchNumber: created.batch_number,
      expiryDate: created.expiry_date,
      quantityOnHand: String(created.quantity_on_hand),
      quantityReceived: String(created.quantity_received),
      isNewLot: true,
    }
  })
}
