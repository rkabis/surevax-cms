import { sql } from 'drizzle-orm'
import type { db } from '../../shared/db/index.js'
import { inventoryMovements } from '../../shared/db/schema.js'
import { displayId } from '../../shared/utils/displayId.js'
import { LifecycleError } from '../transactions/db.js'
import { eligibleProductIdsSql } from './eligibility.js'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type DeductCtx = {
  tenantId: string
  /** branches.id — bigint. */
  branchId: number
  /** service_catalog.id — text PK (raw catalog code). */
  serviceId: string
  /** clinical_orders.id — bigint. */
  clinicalOrderId: number
  /** users.id — bigint. */
  userId: number
}

/**
 * Stock deduction for a lot the CALLER chose.
 *
 * This is the dose path: the nurse picks the brand at administer time (see
 * `GET /api/scheduled-orders/:id/eligible-lots`), so the lot arrives as an
 * explicit argument rather than being inferred. Automatic earliest-expiry
 * selection survives only for point-of-sale bundle fan-out — see
 * `pickEarliestExpiringLot` below.
 *
 * Every guard the picker applied is RE-CHECKED here; a client-supplied lot is
 * untrusted input and the picker's data can be stale by the time the nurse
 * commits:
 *   - belongs to this tenant AND this branch
 *   - not quarantined, recalled, or expired
 *   - holds at least `qtyNeeded`
 *   - its product is eligible for `serviceId` (the shared UNION) — this is what
 *     stops a flu lot being administered against a rabies order
 *
 * Locking uses plain `FOR UPDATE`, deliberately NOT `SKIP LOCKED`: with a named
 * lot there is no next-best row to fall back to, so skipping a merely-locked
 * row would surface a concurrent hold as a bogus "out of stock". Waiting is the
 * correct behaviour, and the losing writer then fails the quantity re-check.
 *
 * Must be called inside an open db.transaction() with RLS GUCs already set.
 *
 * @throws LifecycleError LOT_NOT_FOUND (404) — no such lot in this tenant
 * @throws LifecycleError LOT_WRONG_BRANCH | LOT_QUARANTINED | LOT_RECALLED | LOT_EXPIRED |
 *   LOT_NOT_ELIGIBLE | LOT_OUT_OF_STOCK (409)
 * @throws LifecycleError NEGATIVE_INVENTORY (409) — CHECK race, retryable
 */
export async function deductLot(
  tx: Tx,
  ctx: DeductCtx,
  qtyNeeded: number,
  lotDisplayId: string,
): Promise<{ lotId: number; deducted: number }> {
  const { tenantId, branchId, serviceId, clinicalOrderId, userId } = ctx

  // 1. Lock the named lot and read back everything needed to explain a refusal.
  //    Each guard is projected rather than filtered so the error names the
  //    actual problem instead of a flat "not found".
  const rows = await tx.execute(
    sql`
      SELECT
        il.id,
        il.branch_id,
        il.is_quarantined,
        il.quantity_on_hand::numeric AS quantity_on_hand,
        (il.expiry_date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date) AS is_expired,
        EXISTS (
          SELECT 1
          FROM product_recalls pr
          WHERE pr.tenant_id = ${tenantId}
            AND pr.resolved_at IS NULL
            AND pr.deleted_at IS NULL
            AND (
              (pr.affected_lots_pattern IS NULL AND pr.product_id = il.product_id)
              OR (
                pr.affected_lots_pattern IS NOT NULL
                AND (pr.product_id IS NULL OR pr.product_id = il.product_id)
                AND starts_with(lower(il.batch_number), lower(pr.affected_lots_pattern))
              )
            )
        ) AS is_recalled,
        (il.product_id IN ${eligibleProductIdsSql(tenantId, serviceId)}) AS is_eligible
      FROM inventory_lots il
      WHERE il.display_id = ${lotDisplayId}
        AND il.tenant_id  = ${tenantId}
      LIMIT 1
      FOR UPDATE OF il
    `,
  )

  const lot = (
    rows as unknown as Array<{
      id: number | string
      branch_id: number | string
      is_quarantined: boolean
      quantity_on_hand: string
      is_expired: boolean
      is_recalled: boolean
      is_eligible: boolean
    }>
  )[0]

  if (!lot) {
    throw new LifecycleError(`Inventory lot not found: ${lotDisplayId}`, 'LOT_NOT_FOUND', 404)
  }

  const lotId = typeof lot.id === 'number' ? lot.id : Number(lot.id)

  if (Number(lot.branch_id) !== branchId) {
    throw new LifecycleError('That lot is held at a different branch', 'LOT_WRONG_BRANCH', 409)
  }
  if (lot.is_quarantined) {
    throw new LifecycleError('That lot is quarantined', 'LOT_QUARANTINED', 409)
  }
  // Re-check recalls in the same transaction that holds the lot lock. The
  // pre-administration UI lookup is advisory: a recall can be published after
  // the nurse selects a brand but before they confirm the dose.
  if (lot.is_recalled) {
    throw new LifecycleError('That lot is under active recall', 'LOT_RECALLED', 409)
  }
  if (lot.is_expired) {
    throw new LifecycleError('That lot has expired', 'LOT_EXPIRED', 409)
  }
  if (!lot.is_eligible) {
    throw new LifecycleError(
      'That brand is not an approved product for this service',
      'LOT_NOT_ELIGIBLE',
      409,
    )
  }
  if (Number(lot.quantity_on_hand) < qtyNeeded) {
    throw new LifecycleError(
      `That lot has ${lot.quantity_on_hand} on hand, ${qtyNeeded} needed`,
      'LOT_OUT_OF_STOCK',
      409,
    )
  }

  await applyDeduction(tx, { tenantId, branchId, clinicalOrderId, userId }, lotId, qtyNeeded)
  return { lotId, deducted: qtyNeeded }
}

/**
 * Earliest-expiry deduction — the automatic pick, retained ONLY for
 * point-of-sale bundle fan-out (`clinical_orders/bundleFanOut.ts`), where a
 * cashier bills a diagnostic panel and no clinician is choosing a brand.
 *
 * Was `pickAndDeductFefo`. The dose path no longer calls it: brand choice at
 * administer time is the nurse's, so it goes through `deductLot` instead.
 *
 * `FOR UPDATE … SKIP LOCKED` is correct HERE (unlike in `deductLot`): with no
 * named lot there IS a next-best row, so a concurrent caller picks the
 * following eligible lot rather than queueing. Both callers share the same
 * eligibility set, so the result is still earliest-expiry-correct.
 *
 * Must be called inside an open db.transaction() with RLS GUCs already set.
 *
 * @throws LifecycleError('No inventory lot available', 'OUT_OF_STOCK', 409)
 */
export async function pickEarliestExpiringLot(
  tx: Tx,
  ctx: DeductCtx,
  qtyNeeded: number,
): Promise<{ lotId: number; deducted: number }> {
  const { tenantId, branchId, serviceId, clinicalOrderId, userId } = ctx

  // quantityOnHand is numeric(12,4) — serialized as string, so cast in SQL.
  // received_at is the secondary ORDER BY tiebreaker for stable selection
  // when two lots share an expiry_date.
  //
  // Drizzle's query builder does not expose `SKIP LOCKED` (only `FOR UPDATE`
  // via `.for('update')`) — falling back to raw `sql` template, which also
  // keeps the eligibility subquery in one statement.
  const rows = await tx.execute(
    sql`
      SELECT il.id, il.quantity_on_hand
      FROM inventory_lots il
      WHERE
        il.tenant_id           = ${tenantId}
        AND il.branch_id       = ${branchId}
        AND il.is_quarantined  = false
        AND il.expiry_date >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date
        AND il.quantity_on_hand::numeric >= ${qtyNeeded}
        AND il.product_id IN ${eligibleProductIdsSql(tenantId, serviceId)}
      ORDER BY il.expiry_date ASC, il.received_at ASC, il.id ASC
      LIMIT 1
      FOR UPDATE OF il SKIP LOCKED
    `,
  )

  const lot = (
    rows as unknown as Array<{
      id: number | string
      quantity_on_hand: string
    }>
  )[0]

  if (!lot) {
    throw new LifecycleError('No inventory lot available', 'OUT_OF_STOCK', 409)
  }

  // postgres-js returns bigserial columns as JS number when mode:'number';
  // raw execute returns the driver-native shape — coerce defensively.
  const lotId = typeof lot.id === 'number' ? lot.id : Number(lot.id)

  await applyDeduction(tx, { tenantId, branchId, clinicalOrderId, userId }, lotId, qtyNeeded)
  return { lotId, deducted: qtyNeeded }
}

/**
 * Shared write half: decrement the lot, then record the movement. Both entry
 * points converge here so the deduction semantics can never drift apart.
 */
async function applyDeduction(
  tx: Tx,
  ctx: { tenantId: string; branchId: number; clinicalOrderId: number; userId: number },
  lotId: number,
  qtyNeeded: number,
): Promise<void> {
  const { tenantId, branchId, clinicalOrderId, userId } = ctx

  // Decrement quantity_on_hand via SQL expression — never JS arithmetic on
  // numeric strings (gotcha: numeric(12,4) serializes as string).
  //
  // The 0017 CHECK (`quantity_on_hand >= 0`) is defense-in-depth: the caller
  // already verified `qoh >= qtyNeeded` while holding the row locked. If a race
  // somehow lands here with insufficient stock, Postgres raises 23514;
  // translate that to a 409 NEGATIVE_INVENTORY rather than a 500.
  try {
    await tx.execute(
      sql`
        UPDATE inventory_lots
        SET quantity_on_hand = quantity_on_hand - ${qtyNeeded},
            updated_at = NOW()
        WHERE id = ${lotId}
          AND tenant_id = ${tenantId}
      `,
    )
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === '23514'
    ) {
      throw new LifecycleError(
        'Inventory race: lot dipped below zero — re-fetch and retry',
        'NEGATIVE_INVENTORY',
        409,
      )
    }
    throw err
  }

  // Insert inventory_movements record.
  // quantityDelta is signed: negative for Out movements so the
  // maintain_lot_balances trigger correctly decrements inventory_lot_balances.
  // branch_id is denormalized from the lot — populated at insert (HIGH
  // audit finding from W1.B).
  await tx.insert(inventoryMovements).values({
    displayId: displayId('MVT'),
    tenantId,
    lotId,
    branchId,
    movementType: 'Out',
    quantityDelta: String(-qtyNeeded),
    clinicalOrderId,
    performedById: userId,
    notes: 'Administered',
    createdById: userId,
  })
}

/**
 * Reverse every 'Out' stock deduction previously recorded against a clinical
 * order, used when the order itself is being cancelled before anything was
 * administered (e.g. voiding the bundle bill that fanned it out; see
 * `clinical_orders/fanOutVoid.ts`).
 *
 * Finds each `inventory_movements` row this order's deduction wrote
 * (`movement_type = 'Out'`, matched by `clinical_order_id`) and adds the same
 * quantity back to the SAME lot via a new 'Adjustment' movement. Movements
 * are append-only history, never edited or deleted: the original 'Out' row
 * stays exactly as written, and the reversal is its own auditable row.
 *
 * Uses the same UPDATE-first pattern as `receiveStock` (never raw JS
 * arithmetic on the numeric string, always a SQL `+`/`-` expression): the
 * reversal is always a positive add, so it can never trip the
 * non-negative `quantity_on_hand` CHECK the way a second deduction could.
 *
 * Safe to call for an order that consumed no stock (Lab/Consultation
 * constituents never deduct, per fanOutBundle's INVENTORY_BACKED set), it
 * returns `{ reversedCount: 0 }` and touches nothing.
 *
 * Must be called inside an open db.transaction() with RLS GUCs already set.
 */
export async function reverseDeductionForOrder(
  tx: Tx,
  ctx: { tenantId: string; clinicalOrderId: number; userId: number; reason: string },
): Promise<{ reversedCount: number }> {
  const { tenantId, clinicalOrderId, userId, reason } = ctx

  const movements = await tx.execute<{
    id: number
    lot_id: number
    branch_id: number
    quantity_delta: string
  }>(
    sql`
      SELECT id, lot_id, branch_id, quantity_delta
      FROM inventory_movements
      WHERE tenant_id = ${tenantId}
        AND clinical_order_id = ${clinicalOrderId}
        AND movement_type = 'Out'
    `,
  )

  for (const movement of movements) {
    const lotId = Number(movement.lot_id)
    const branchId = Number(movement.branch_id)
    // The original 'Out' row carries a negative delta, so the reversal adds
    // back its absolute value. Keep that arithmetic in SQL on the numeric
    // itself, never through a JS number: `quantity_delta` is numeric(12,4)
    // and arrives as a STRING, and `applyDeduction` above keeps its own
    // decrement in a SQL expression for exactly this reason. Round-tripping
    // it through Number() reintroduces the float drift that rule prevents.
    const reversalQty = sql`ABS(${movement.quantity_delta}::numeric)`

    await tx.execute(
      sql`
        UPDATE inventory_lots
        SET quantity_on_hand = quantity_on_hand + ${reversalQty},
            updated_at = NOW()
        WHERE id = ${lotId}
          AND tenant_id = ${tenantId}
      `,
    )

    await tx.insert(inventoryMovements).values({
      displayId: displayId('MVT'),
      tenantId,
      lotId,
      branchId,
      movementType: 'Adjustment',
      quantityDelta: reversalQty,
      clinicalOrderId,
      performedById: userId,
      notes: reason,
      createdById: userId,
    })
  }

  return { reversedCount: movements.length }
}
