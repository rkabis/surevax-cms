/**
 * Void-side-effect unwind for bundle fan-out.
 *
 * `fanOutBundle` (bundleFanOut.ts) creates one clinical_orders row (non-Lab)
 * or one clinical_orders + lab_orders pair (Lab) per bundle constituent when
 * a bundle service is billed, and, for Vaccine/Procedure/Product
 * constituents, DEDUCTS STOCK at order-CREATION time via
 * `pickEarliestExpiringLot` (not at administer time; the dose path is the
 * only one that defers deduction to administer). Before this file existed,
 * `voidTransaction` flipped `transactions.status` to `Voided` and did
 * nothing else: it referenced zero clinical orders, lab orders, or
 * inventory. That left a voided bundle bill with live clinical/lab work and
 * already-consumed stock behind it, and, because `fanOutBundle` has no
 * duplicate guard, the natural "void the wrong bill, re-enter it correctly"
 * operator workflow would fan the same constituents out a SECOND time.
 *
 * Linkage: `fanOutBundle` writes every clinical_orders row it creates with
 * `fan_out_transaction_id = <transactions.id>`. `transaction_items.clinical_order_id`
 * is NOT this linkage: that column points the OTHER direction (a pre-existing
 * dose being billed in advance or in arrears), is scalar (one order per line,
 * while a bundle fans out to many), and is never populated by fan-out at
 * all, see createTransaction in transactions/db.ts. lab_orders are found by
 * joining to their parent clinical_orders row: fanOutBundle always writes
 * that parent row (linked the same way) in the SAME insert as the
 * lab_orders row, purely to satisfy `lab_orders.clinical_order_id`'s FK.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import { clinicalOrders, labOrders } from '../../shared/db/schema.js'
import type { Tx } from '../../shared/db/withTenantTx.js'
import { LifecycleError } from '../transactions/db.js'
import { reverseDeductionForOrder } from '../inventory/fefo.js'

export type FanOutClinicalOrderRow = {
  id: number
  displayId: string
  status: string
}

export type FanOutLabOrderRow = {
  id: number
  displayId: string
  status: string
  clinicalOrderId: number
}

export type FanOutOrdersForTransaction = {
  clinicalOrders: FanOutClinicalOrderRow[]
  labOrders: FanOutLabOrderRow[]
}

/**
 * Reads back every clinical_orders (+ lab_orders) row this transaction's
 * bundle fan-out created, via the `fan_out_transaction_id` column.
 *
 * Returns empty arrays for a plain (non-bundle) transaction, or one whose
 * bundle had zero constituents: both are legitimate no-ops for the caller,
 * not errors.
 */
export async function findFanOutOrdersForTransaction(
  tx: Tx,
  tenantId: string,
  transactionId: number,
): Promise<FanOutOrdersForTransaction> {
  // Deliberately NO join to service_catalog. An earlier version joined it to
  // carry a `serviceType` nobody read, and an INNER JOIN silently drops any
  // order whose catalog row does not match, which for an unwind means quietly
  // leaving that order live and its stock consumed while reporting success.
  // A function whose whole job is to leave nothing behind must not filter its
  // own worklist.
  const clinicalOrderRows: FanOutClinicalOrderRow[] = await tx
    .select({
      id: clinicalOrders.id,
      displayId: clinicalOrders.displayId,
      status: clinicalOrders.status,
    })
    .from(clinicalOrders)
    .where(
      and(
        eq(clinicalOrders.tenantId, tenantId),
        eq(clinicalOrders.fanOutTransactionId, transactionId),
      ),
    )

  if (clinicalOrderRows.length === 0) {
    return { clinicalOrders: [], labOrders: [] }
  }

  const orderIds = clinicalOrderRows.map((r) => r.id)
  const loRows = await tx
    .select({
      id: labOrders.id,
      displayId: labOrders.displayId,
      status: labOrders.status,
      clinicalOrderId: labOrders.clinicalOrderId,
    })
    .from(labOrders)
    .where(and(eq(labOrders.tenantId, tenantId), inArray(labOrders.clinicalOrderId, orderIds)))

  return { clinicalOrders: clinicalOrderRows, labOrders: loRows }
}

export type UnwindFanOutCtx = {
  tenantId: string
  userId: number
  /** transactions.id (bigint) being voided. */
  transactionId: number
  /** transactions.display_id (TXN_…), for the cancellation note + error message. */
  transactionDisplayId: string
}

export type UnwindFanOutResult = {
  cancelledClinicalOrderIds: string[]
  cancelledLabOrderIds: string[]
  reversedMovementCount: number
}

/**
 * Called from `voidTransaction`, inside the SAME `withTenantTx`, before the
 * money-control approval gate: refusing here must not file or consume a
 * manager-approval request for a void that can never proceed.
 *
 * Refuses (throws `LifecycleError` `CLINICAL_WORK_COMPLETED`, 409) when ANY
 * fanned-out clinical_order is `Completed`, or ANY fanned-out lab_order has
 * left `Pending` (i.e. `Sent` or `ResultReceived`): the clinical or lab act
 * already happened for real, so cancelling the bill would erase the record
 * of billable work that was genuinely performed, which is revenue leakage
 * AND a clinical-record inconsistency. A refund is the correct route
 * instead. Nothing is mutated when this throws: the check runs before any
 * write.
 *
 * When every fanned-out order is still untouched, cancels each clinical_order
 * and lab_order (status -> 'Cancelled') and reverses any stock the fan-out
 * consumed via `reverseDeductionForOrder` (never for an order that was
 * actually administered, that stock was really used, and the function
 * never reaches this branch for such an order anyway, since the refusal
 * above fires first).
 */
export async function unwindFanOutForVoid(
  tx: Tx,
  ctx: UnwindFanOutCtx,
): Promise<UnwindFanOutResult> {
  const { tenantId, userId, transactionId, transactionDisplayId } = ctx

  const found = await findFanOutOrdersForTransaction(tx, tenantId, transactionId)
  if (found.clinicalOrders.length === 0) {
    // Not a bundle transaction, or its bundle had zero constituents: no
    // fan-out work exists to unwind. Plain transactions take this path and
    // void exactly as before.
    return { cancelledClinicalOrderIds: [], cancelledLabOrderIds: [], reversedMovementCount: 0 }
  }

  const completedOrder = found.clinicalOrders.find((o) => o.status === 'Completed')
  if (completedOrder) {
    throw new LifecycleError(
      `Clinical order ${completedOrder.displayId} from this bill has already been administered, so this bill cannot be voided. File a refund instead.`,
      'CLINICAL_WORK_COMPLETED',
      409,
      { clinicalOrderDisplayId: completedOrder.displayId },
    )
  }
  const actionedLabOrder = found.labOrders.find(
    (o) => o.status !== 'Pending' && o.status !== 'Cancelled',
  )
  if (actionedLabOrder) {
    throw new LifecycleError(
      `Lab order ${actionedLabOrder.displayId} from this bill has already been sent, so this bill cannot be voided. File a refund instead.`,
      'CLINICAL_WORK_COMPLETED',
      409,
      { labOrderDisplayId: actionedLabOrder.displayId },
    )
  }

  // Every fanned-out order is still untouched, safe to unwind.
  const reason = `Fan-out cancelled: originating transaction ${transactionDisplayId} voided`

  let reversedMovementCount = 0
  const cancelledClinicalOrderIds: string[] = []
  for (const order of found.clinicalOrders) {
    // Skip rows already cancelled, exactly as the lab loop below does.
    // `reverseDeductionForOrder` is NOT idempotent: it re-selects every 'Out'
    // movement for the order, so running it twice adds the same quantity back
    // twice and inflates the lot. An order cancelled through another path is
    // still returned by findFanOutOrdersForTransaction, so without this guard
    // that other path plus this one double-reverse the same deduction. It
    // would also bump rowVersion, overwrite deferralReason, and report the row
    // as though THIS void had cancelled it.
    if (order.status === 'Cancelled') continue

    const { reversedCount } = await reverseDeductionForOrder(tx, {
      tenantId,
      clinicalOrderId: order.id,
      userId,
      reason,
    })
    reversedMovementCount += reversedCount

    await tx
      .update(clinicalOrders)
      .set({
        status: 'Cancelled',
        deferralReason: reason,
        updatedAt: new Date(),
        rowVersion: sql`${clinicalOrders.rowVersion} + 1`,
      })
      .where(and(eq(clinicalOrders.tenantId, tenantId), eq(clinicalOrders.id, order.id)))
    cancelledClinicalOrderIds.push(order.displayId)
  }

  const cancelledLabOrderIds: string[] = []
  for (const lo of found.labOrders) {
    if (lo.status === 'Cancelled') continue
    await tx
      .update(labOrders)
      .set({
        status: 'Cancelled',
        notes: reason,
        updatedAt: new Date(),
        rowVersion: sql`${labOrders.rowVersion} + 1`,
      })
      .where(and(eq(labOrders.tenantId, tenantId), eq(labOrders.id, lo.id)))
    cancelledLabOrderIds.push(lo.displayId)
  }

  return {
    cancelledClinicalOrderIds,
    cancelledLabOrderIds,
    reversedMovementCount,
  }
}
