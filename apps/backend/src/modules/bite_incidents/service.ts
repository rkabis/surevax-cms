/**
 * Bite Incidents — service layer.
 *
 * Two-tier IDs (W3.c.3): all *Id arguments here are display_id strings
 * (BIT_…, AOF_…, PAT_…). userId/branchId are bigint internals.
 */
import { withTenantTx } from '../../shared/db/withTenantTx.js'
import { cancelDay28ArvPepForPatient } from '../scheduled_orders/db.js'
import { recordFollowupOutcomeTx, type RecordOutcomeInput, type RecordOutcomeResult } from './db.js'

/**
 * Records the Day-14 animal observation outcome.
 * If the outcome proves the animal non-rabid (AliveHealthy, or
 * DiedNaturally + FAT=Negative), auto-cancels the patient's Day-28
 * ARV PEP dose per DOH/WHO SOP.
 *
 * CLIN-6: both the outcome write and the Day-28 cancellation run inside
 * a single withTenantTx so they succeed or roll back together.
 *
 * Returns the updated followup + a flag indicating whether Day-28 was cancelled.
 */
export async function recordOutcomeAndMayCancelDay28(
  tenantId: string,
  userId: number,
  branchId: number | null,
  biteIncidentDisplayId: string,
  followupDisplayId: string,
  input: RecordOutcomeInput,
): Promise<(RecordOutcomeResult & { cancelledOrderId: string | null }) | null> {
  return withTenantTx({ tenantId, userId, branchId }, async (tx) => {
    const result = await recordFollowupOutcomeTx(
      tx,
      tenantId,
      userId,
      biteIncidentDisplayId,
      followupDisplayId,
      input,
    )

    if (!result) return null

    let cancelledOrderId: string | null = null

    if (result.cancelsDay28) {
      const cancellation = await cancelDay28ArvPepForPatient(tx, {
        tenantId,
        patientId: result.patientId,
        biteIncidentId: biteIncidentDisplayId,
      })
      cancelledOrderId = cancellation?.cancelledOrderId ?? null
    }

    return {
      followup: result.followup,
      cancelsDay28: result.cancelsDay28,
      patientId: result.patientId,
      cancelledOrderId,
    }
  })
}
