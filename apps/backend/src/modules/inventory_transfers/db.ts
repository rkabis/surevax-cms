import { eq, and, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { withTenantTx } from '../../shared/db/withTenantTx.js'
import {
  inventoryTransfers,
  inventoryMovements,
  branches,
  inventoryLots,
  products,
} from '../../shared/db/schema.js'
import type { Tx } from '../../shared/db/withTenantTx.js'
import { displayId } from '../../shared/utils/displayId.js'
import { LifecycleError } from '../transactions/db.js'

// ---------------------------------------------------------------------------
// Public shape — internal bigint id is never returned to callers.
// display_id is surfaced as the public `id` field.
// ---------------------------------------------------------------------------

export type TransferPublic = {
  id: string // display_id (TRF_<8 base32>)
  transferRef: string | null
  tenantId: string
  quantity: string
  status: 'PendingReceipt' | 'Received' | 'Cancelled'
  shippedAt: Date
  receivedAt: Date | null
  cancelledAt: Date | null
  notes: string | null
  rowVersion: number
  createdAt: Date
  updatedAt: Date
}

export type TransferResolved = TransferPublic & {
  sourceBranchDisplayId: string
  destinationBranchDisplayId: string
  sourceBranchCode: string
  destinationBranchCode: string
  lotDisplayId: string
  destinationLotDisplayId: string | null
  sourceBranchName: string | null
  destinationBranchName: string | null
  lotBatchNumber: string | null
  productName: string | null
}

/**
 * Map a raw inventoryTransfers row to the public shape.
 * Swaps internal bigint `id` for `displayId`.
 */
function toPublic(row: typeof inventoryTransfers.$inferSelect): TransferPublic {
  return {
    id: row.displayId,
    transferRef: row.transferRef,
    tenantId: row.tenantId,
    quantity: row.quantity,
    status: row.status,
    shippedAt: row.shippedAt,
    receivedAt: row.receivedAt ?? null,
    cancelledAt: row.cancelledAt ?? null,
    notes: row.notes ?? null,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export type ListTransferFilters = {
  status?: string
  // Accept display_id strings from the URL; resolve to bigint internally.
  sourceBranchId?: number
  destinationBranchId?: number
}

/**
 * List transfers for a tenant with optional filters.
 * Bare-array response (no envelope).
 */
export async function listTransfers(
  tenantId: string,
  filters: ListTransferFilters,
): Promise<TransferResolved[]> {
  // Read-only list query — no GUC needed (audit trigger only fires on writes).
  const conditions = [eq(inventoryTransfers.tenantId, tenantId)]
  if (filters.status) {
    conditions.push(
      eq(inventoryTransfers.status, filters.status as 'PendingReceipt' | 'Received' | 'Cancelled'),
    )
  }
  if (filters.sourceBranchId != null) {
    conditions.push(eq(inventoryTransfers.sourceBranchId, filters.sourceBranchId))
  }
  if (filters.destinationBranchId != null) {
    conditions.push(eq(inventoryTransfers.destinationBranchId, filters.destinationBranchId))
  }

  const sourceBranch = alias(branches, 'source_branch')
  const destinationBranch = alias(branches, 'destination_branch')
  const destinationLot = alias(inventoryLots, 'destination_lot')
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const rows = await tx
      .select({
        transfer: inventoryTransfers,
        sourceBranchDisplayId: sourceBranch.displayId,
        sourceBranchCode: sourceBranch.code,
        sourceBranchName: sourceBranch.name,
        destinationBranchDisplayId: destinationBranch.displayId,
        destinationBranchCode: destinationBranch.code,
        destinationBranchName: destinationBranch.name,
        lotDisplayId: inventoryLots.displayId,
        destinationLotDisplayId: destinationLot.displayId,
        lotBatchNumber: inventoryLots.batchNumber,
        productName: products.name,
      })
      .from(inventoryTransfers)
      .innerJoin(sourceBranch, eq(sourceBranch.id, inventoryTransfers.sourceBranchId))
      .innerJoin(
        destinationBranch,
        eq(destinationBranch.id, inventoryTransfers.destinationBranchId),
      )
      .innerJoin(inventoryLots, eq(inventoryLots.id, inventoryTransfers.lotId))
      .leftJoin(destinationLot, eq(destinationLot.id, inventoryTransfers.destinationLotId))
      .innerJoin(products, eq(products.id, inventoryLots.productId))
      .where(and(...conditions))
      .orderBy(sql`${inventoryTransfers.shippedAt} DESC`)

    return rows.map(({ transfer, ...resolved }) => ({ ...toPublic(transfer), ...resolved }))
  })
}

/**
 * Resolve a transfer display_id to its internal bigint id.
 * Returns null if not found.
 */
async function resolveTransferId(displayIdStr: string, tenantId: string): Promise<number | null> {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const [row] = await tx
      .select({ id: inventoryTransfers.id })
      .from(inventoryTransfers)
      .where(
        and(
          eq(inventoryTransfers.tenantId, tenantId),
          eq(inventoryTransfers.displayId, displayIdStr),
        ),
      )
      .limit(1)
    return row?.id ?? null
  })
}

/**
 * Resolve a branch display_id to its internal bigint id.
 */
async function resolveBranchId(displayIdStr: string, tenantId: string): Promise<number | null> {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const [row] = await tx
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.tenantId, tenantId), eq(branches.displayId, displayIdStr)))
      .limit(1)
    return row?.id ?? null
  })
}

/**
 * Resolve a lot display_id to its internal bigint id.
 */
async function resolveLotId(displayIdStr: string, tenantId: string): Promise<number | null> {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const [row] = await tx
      .select({ id: inventoryLots.id })
      .from(inventoryLots)
      .where(and(eq(inventoryLots.tenantId, tenantId), eq(inventoryLots.displayId, displayIdStr)))
      .limit(1)
    return row?.id ?? null
  })
}

/**
 * Get a single transfer with joined branch + lot details.
 * Accepts the public display_id string from the URL.
 */
export async function getTransfer(
  tenantId: string,
  transferDisplayId: string,
): Promise<
  | (TransferPublic & {
      sourceBranchName: string | null
      destinationBranchName: string | null
      lotBatchNumber: string | null
      sourceBranchDisplayId: string
      destinationBranchDisplayId: string
      sourceBranchCode: string
      destinationBranchCode: string
      lotDisplayId: string
      destinationLotDisplayId: string | null
      productName: string | null
    })
  | null
> {
  // Two-alias self-join on branches requires raw SQL.
  const rows = await withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) =>
    tx.execute(
      sql`
      SELECT
        t.*,
        src.name  AS "sourceBranchName",
        dst.name  AS "destinationBranchName",
        il.batch_number AS "lotBatchNumber"
        ,src.display_id AS "sourceBranchDisplayId"
        ,dst.display_id AS "destinationBranchDisplayId"
        ,src.code AS "sourceBranchCode"
        ,dst.code AS "destinationBranchCode"
        ,il.display_id AS "lotDisplayId"
        ,dil.display_id AS "destinationLotDisplayId"
        ,p.name AS "productName"
      FROM inventory_transfers t
      LEFT JOIN branches src ON src.id = t.source_branch_id
      LEFT JOIN branches dst ON dst.id = t.destination_branch_id
      LEFT JOIN inventory_lots il ON il.id = t.lot_id
      LEFT JOIN inventory_lots dil ON dil.id = t.destination_lot_id
      LEFT JOIN products p ON p.id = il.product_id
      WHERE t.tenant_id = ${tenantId}
        AND t.display_id = ${transferDisplayId}
      LIMIT 1
    `,
    ),
  )

  type RawRow = typeof inventoryTransfers.$inferSelect & {
    sourceBranchName: string | null
    destinationBranchName: string | null
    lotBatchNumber: string | null
    sourceBranchDisplayId: string
    destinationBranchDisplayId: string
    sourceBranchCode: string
    destinationBranchCode: string
    lotDisplayId: string
    destinationLotDisplayId: string | null
    productName: string | null
  }

  const raw = (rows as unknown as RawRow[])[0]
  if (!raw) return null

  return {
    ...toPublic(raw),
    sourceBranchName: raw.sourceBranchName,
    destinationBranchName: raw.destinationBranchName,
    lotBatchNumber: raw.lotBatchNumber,
    sourceBranchDisplayId: raw.sourceBranchDisplayId,
    destinationBranchDisplayId: raw.destinationBranchDisplayId,
    sourceBranchCode: raw.sourceBranchCode,
    destinationBranchCode: raw.destinationBranchCode,
    lotDisplayId: raw.lotDisplayId,
    destinationLotDisplayId: raw.destinationLotDisplayId,
    productName: raw.productName,
  }
}

type CreateTransferArgs = {
  tenantId: string
  userId: number
  branchId: number | null
  sourceBranchDisplayId: string
  destinationBranchDisplayId: string
  lotDisplayId: string
  quantity: number
  notes?: string | null
}

/**
 * Ship a transfer: validate lot stock, insert transfer row + outbound movement.
 * Must be called inside withTenantTx (GUCs already set).
 * Accepts display_id strings; resolves to bigint internally.
 */
export async function createTransfer(tx: Tx, args: CreateTransferArgs): Promise<TransferPublic> {
  const {
    tenantId,
    userId,
    branchId,
    sourceBranchDisplayId,
    destinationBranchDisplayId,
    lotDisplayId,
    quantity,
    notes,
  } = args

  // Resolve display IDs to internal bigints
  const sourceBranchRow = await tx
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.tenantId, tenantId), eq(branches.displayId, sourceBranchDisplayId)))
    .limit(1)
  const sourceBranchId = sourceBranchRow[0]?.id
  if (!sourceBranchId) {
    throw new LifecycleError('Source branch not found', 'BRANCH_NOT_FOUND', 404)
  }
  if (branchId !== null && branchId !== sourceBranchId) {
    throw new LifecycleError(
      'A branch can only ship stock from its own inventory',
      'TRANSFER_SOURCE_REQUIRED',
      403,
    )
  }

  const destBranchRow = await tx
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.tenantId, tenantId), eq(branches.displayId, destinationBranchDisplayId)))
    .limit(1)
  const destinationBranchId = destBranchRow[0]?.id
  if (!destinationBranchId) {
    throw new LifecycleError('Destination branch not found', 'BRANCH_NOT_FOUND', 404)
  }

  const lotRow = await tx
    .select({ id: inventoryLots.id })
    .from(inventoryLots)
    .where(and(eq(inventoryLots.tenantId, tenantId), eq(inventoryLots.displayId, lotDisplayId)))
    .limit(1)
  const lotId = lotRow[0]?.id
  if (!lotId) {
    throw new LifecycleError('Inventory lot not found', 'LOT_NOT_FOUND', 404)
  }

  // Lock source lot FOR UPDATE and validate stock
  const lotRows = await tx.execute(
    sql`
      SELECT id, product_id, batch_number, expiry_date, quantity_on_hand, is_quarantined, tenant_id, branch_id
      FROM inventory_lots
      WHERE id = ${lotId}
        AND tenant_id = ${tenantId}
        AND branch_id = ${sourceBranchId}
      FOR UPDATE
    `,
  )

  const lot = (
    lotRows as unknown as Array<{
      id: number
      product_id: number
      batch_number: string
      expiry_date: string
      quantity_on_hand: string
      is_quarantined: boolean
      tenant_id: string
      branch_id: number
    }>
  )[0]

  if (!lot) {
    throw new LifecycleError(
      'Inventory lot not found or not at source branch',
      'LOT_NOT_FOUND',
      404,
    )
  }
  if (lot.is_quarantined) {
    throw new LifecycleError('Cannot transfer a quarantined lot', 'LOT_QUARANTINED', 409)
  }
  if (parseFloat(lot.quantity_on_hand) < quantity) {
    throw new LifecycleError(
      `Insufficient stock: available ${lot.quantity_on_hand}, requested ${quantity}`,
      'INSUFFICIENT_STOCK',
      409,
    )
  }

  const transferDisplayId = displayId('TRF')

  // Insert transfer row (PendingReceipt)
  const [transfer] = await tx
    .insert(inventoryTransfers)
    .values({
      displayId: transferDisplayId,
      tenantId,
      sourceBranchId,
      destinationBranchId,
      lotId,
      quantity: String(quantity),
      status: 'PendingReceipt',
      shippedById: userId,
      notes: notes ?? null,
    })
    .returning()

  // Decrement source lot quantity_on_hand (SQL expression, never JS arithmetic on numeric string).
  // INV-7: the quantity_on_hand >= 0 CHECK (migration 0017) raises 23514 on a race.
  // Translate to a 409 NEGATIVE_INVENTORY — same pattern as fefo.ts.
  try {
    await tx.execute(
      sql`
        UPDATE inventory_lots
        SET quantity_on_hand = quantity_on_hand - ${quantity},
            updated_at = NOW()
        WHERE id = ${lotId}
          AND tenant_id = ${tenantId}
      `,
    )
  } catch (err) {
    if (
      err != null &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === '23514'
    ) {
      throw new LifecycleError(
        'Inventory race: lot quantity would go negative — re-fetch and retry',
        'NEGATIVE_INVENTORY',
        409,
      )
    }
    throw err
  }

  // Insert outbound movement at source (Transfer type, negative delta)
  await tx.insert(inventoryMovements).values({
    displayId: displayId('MVT'),
    tenantId,
    lotId,
    branchId: sourceBranchId,
    movementType: 'Transfer',
    quantityDelta: String(-quantity),
    inventoryTransferId: transfer!.id,
    performedById: userId,
    notes: `Transfer out to destination branch (${destinationBranchDisplayId}) — transfer ${transferDisplayId}`,
    createdById: userId,
  })

  return toPublic(transfer!)
}

type ReceiveTransferArgs = {
  tenantId: string
  userId: number
  branchId: number | null
  transferDisplayId: string
  destinationLotDisplayId?: string | null
  notes?: string | null
}

/**
 * Receive a pending transfer: create/match destination lot, insert inbound movement,
 * mark transfer Received. Must be called inside withTenantTx.
 * Accepts display_id strings; resolves to bigint internally.
 */
export async function receiveTransfer(tx: Tx, args: ReceiveTransferArgs): Promise<TransferPublic> {
  const { tenantId, userId, branchId, transferDisplayId, destinationLotDisplayId, notes } = args

  // Look up transfer by display_id (lock for update)
  const xfrRows = await tx.execute(
    sql`
      SELECT t.*, il.product_id, il.batch_number, il.expiry_date, il.branch_id AS source_branch_id_actual
      FROM inventory_transfers t
      JOIN inventory_lots il ON il.id = t.lot_id
      WHERE t.display_id = ${transferDisplayId}
        AND t.tenant_id = ${tenantId}
      FOR UPDATE OF t
    `,
  )

  const xfr = (xfrRows as unknown as Array<Record<string, unknown>>)[0]

  if (!xfr) {
    throw new LifecycleError('Transfer not found', 'NOT_FOUND', 404)
  }
  if (xfr['status'] !== 'PendingReceipt') {
    throw new LifecycleError(
      `Transfer is ${xfr['status']}, only PendingReceipt transfers can be received`,
      'INVALID_STATUS',
      409,
    )
  }

  const transferInternalId = xfr['id'] as number
  const quantity = parseFloat(xfr['quantity'] as string)
  const destinationBranchId = xfr['destination_branch_id'] as number
  if (branchId !== null && branchId !== destinationBranchId) {
    throw new LifecycleError(
      'Only the destination branch can confirm receipt of this transfer',
      'TRANSFER_DESTINATION_REQUIRED',
      403,
    )
  }
  const productId = xfr['product_id'] as number
  const batchNumber = xfr['batch_number'] as string
  const expiryDate = xfr['expiry_date'] as string

  let resolvedDestLotId: number

  if (destinationLotDisplayId) {
    // Resolve provided destination lot display_id
    const [destLot] = (await tx.execute(
      sql`
        SELECT id FROM inventory_lots
        WHERE display_id = ${destinationLotDisplayId}
          AND tenant_id = ${tenantId}
          AND branch_id = ${destinationBranchId}
          AND product_id = ${productId}
        LIMIT 1
      `,
    )) as unknown as Array<{ id: number }>
    if (!destLot) {
      throw new LifecycleError(
        'Provided destinationLotId not found at destination branch for this product',
        'LOT_NOT_FOUND',
        404,
      )
    }
    resolvedDestLotId = destLot.id
  } else {
    // Try to find matching lot at destination branch (same product + batch + expiry)
    const existingRows = (await tx.execute(
      sql`
        SELECT id FROM inventory_lots
        WHERE tenant_id = ${tenantId}
          AND branch_id = ${destinationBranchId}
          AND product_id = ${productId}
          AND batch_number = ${batchNumber}
          AND expiry_date::text = ${typeof expiryDate === 'string' ? expiryDate.slice(0, 10) : (expiryDate as Date).toISOString().slice(0, 10)}
          AND is_quarantined = false
        LIMIT 1
      `,
    )) as unknown as Array<{ id: number }>

    if (existingRows[0]) {
      resolvedDestLotId = existingRows[0].id
    } else {
      // Create new lot at destination branch
      const newLotDisplayId = displayId('LOT')
      const expiryStr =
        typeof expiryDate === 'string'
          ? expiryDate.slice(0, 10)
          : (expiryDate as Date).toISOString().slice(0, 10)

      const [newLotRow] = (await tx.execute(
        sql`
          INSERT INTO inventory_lots
            (display_id, tenant_id, branch_id, product_id, batch_number, expiry_date,
             quantity_on_hand, quantity_received, unit_cost, is_quarantined,
             manufacturer, created_at, updated_at)
          SELECT
            ${newLotDisplayId}, ${tenantId}, ${destinationBranchId}, ${productId},
            ${batchNumber}, ${expiryStr}::date,
            0, 0, il.unit_cost, false,
            il.manufacturer, NOW(), NOW()
          FROM inventory_lots il
          WHERE il.id = ${xfr['lot_id'] as number}
          RETURNING id
        `,
      )) as unknown as Array<{ id: number }>
      resolvedDestLotId = newLotRow!.id
    }
  }

  // INV-3: two writes are REQUIRED and intentional — they maintain two parallel
  // counters that serve different consumers:
  //   1. inventory_lots.quantity_on_hand   — read by the deduction helpers for
  //      stock eligibility via FOR UPDATE SKIP LOCKED on inventory_lots.
  //   2. inventory_lot_balances.quantity_on_hand — maintained by the
  //      maintain_lot_balances trigger (fires on inventory_movements INSERT);
  //      read by the inventory list UI and balance reports.
  //
  // Both writes use SQL expressions (never JS arithmetic on numeric strings) and
  // run inside the caller's withTenantTx — they are atomically rolled back together
  // on any failure. Write order: lot first (matches ship path), movement second
  // (trigger fires last, consistent across all three transfer paths).
  //
  // Increment destination lot quantity_on_hand (FEFO reader).
  await tx.execute(
    sql`
      UPDATE inventory_lots
      SET quantity_on_hand = quantity_on_hand + ${quantity},
          updated_at = NOW()
      WHERE id = ${resolvedDestLotId}
        AND tenant_id = ${tenantId}
    `,
  )

  // Insert inbound movement at destination — triggers maintain_lot_balances
  // which increments inventory_lot_balances.quantity_on_hand.
  await tx.insert(inventoryMovements).values({
    displayId: displayId('MVT'),
    tenantId,
    lotId: resolvedDestLotId,
    branchId: destinationBranchId,
    movementType: 'Transfer',
    quantityDelta: String(quantity),
    inventoryTransferId: transferInternalId,
    performedById: userId,
    notes: notes ?? `Transfer in from source — transfer ${transferDisplayId}`,
    createdById: userId,
  })

  // Mark transfer Received
  const [updated] = await tx
    .update(inventoryTransfers)
    .set({
      status: 'Received',
      receivedAt: new Date(),
      receivedById: userId,
      destinationLotId: resolvedDestLotId,
      rowVersion: sql`${inventoryTransfers.rowVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(eq(inventoryTransfers.id, transferInternalId), eq(inventoryTransfers.tenantId, tenantId)),
    )
    .returning()

  return toPublic(updated!)
}

type CancelTransferArgs = {
  tenantId: string
  userId: number
  branchId: number | null
  transferDisplayId: string
  reason?: string | null
}

/**
 * Cancel a pending transfer: refund source lot with an Adjustment movement.
 * Must be called inside withTenantTx.
 * Accepts display_id string; resolves to bigint internally.
 */
export async function cancelTransfer(tx: Tx, args: CancelTransferArgs): Promise<TransferPublic> {
  const { tenantId, userId, branchId, transferDisplayId, reason } = args

  const xfrRows = await tx.execute(
    sql`
      SELECT * FROM inventory_transfers
      WHERE display_id = ${transferDisplayId}
        AND tenant_id = ${tenantId}
      FOR UPDATE
    `,
  )

  const xfr = (xfrRows as unknown as Array<Record<string, unknown>>)[0]

  if (!xfr) {
    throw new LifecycleError('Transfer not found', 'NOT_FOUND', 404)
  }
  if (xfr['status'] !== 'PendingReceipt') {
    throw new LifecycleError(
      `Transfer is ${xfr['status']}, only PendingReceipt transfers can be cancelled`,
      'INVALID_STATUS',
      409,
    )
  }

  const transferInternalId = xfr['id'] as number
  const quantity = parseFloat(xfr['quantity'] as string)
  const lotId = xfr['lot_id'] as number
  const sourceBranchId = xfr['source_branch_id'] as number
  if (branchId !== null && branchId !== sourceBranchId) {
    throw new LifecycleError(
      'Only the source branch can cancel this outbound transfer',
      'TRANSFER_SOURCE_REQUIRED',
      403,
    )
  }

  // INV-3: two writes are REQUIRED — see receiveTransfer comment for the full
  // rationale (FEFO reads inventory_lots; UI reads inventory_lot_balances).
  // Write order: lot first (matches ship path), movement second.
  //
  // Restore source lot quantity_on_hand (FEFO reader).
  await tx.execute(
    sql`
      UPDATE inventory_lots
      SET quantity_on_hand = quantity_on_hand + ${quantity},
          updated_at = NOW()
      WHERE id = ${lotId}
        AND tenant_id = ${tenantId}
    `,
  )

  // Refund: insert offsetting Adjustment movement (positive delta) — triggers
  // maintain_lot_balances which increments inventory_lot_balances.quantity_on_hand.
  await tx.insert(inventoryMovements).values({
    displayId: displayId('MVT'),
    tenantId,
    lotId,
    branchId: sourceBranchId,
    movementType: 'Adjustment',
    quantityDelta: String(quantity),
    inventoryTransferId: transferInternalId,
    performedById: userId,
    notes: reason
      ? `Transfer cancelled: ${reason}`
      : `Transfer cancelled — transfer ${transferDisplayId}`,
    createdById: userId,
  })

  // Mark transfer Cancelled
  const [updated] = await tx
    .update(inventoryTransfers)
    .set({
      status: 'Cancelled',
      cancelledAt: new Date(),
      cancelledById: userId,
      rowVersion: sql`${inventoryTransfers.rowVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(eq(inventoryTransfers.id, transferInternalId), eq(inventoryTransfers.tenantId, tenantId)),
    )
    .returning()

  return toPublic(updated!)
}

// Re-export resolver for service layer (branch/lot display_id → bigint)
export { resolveBranchId, resolveLotId, resolveTransferId }
