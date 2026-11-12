import { and, eq, isNull } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { withTenantTx } from '../../shared/db/withTenantTx.js'
import {
  applyRecomputeTx,
  administerOrderTx,
  recordObservationActionTx,
  rescheduleOrderTx,
  type AdministerDto,
  type AdministerResult,
  type ObservationActionDto,
  type ObservationSummary,
} from './db.js'
import { writeScheduleChangeAudit } from './auditWrite.js'
import { resolveAdministeringClinician } from '../../shared/utils/clinicianAttestation.js'
import { clinicalOrders, domainEvents } from '../../shared/db/schema.js'
import type { DownstreamWire } from './dateMath.js'
import { LifecycleError } from '../transactions/db.js'

export type { DownstreamProjection, DownstreamWire } from './dateMath.js'

type AuthUser = {
  id: number | null
  displayId: string
  email: string
  role: string
  tenantId: string | null
  branchId: number | null
}

function requireUserCtx(user: AuthUser): {
  tenantId: string
  userId: number
  branchId: number | null
} {
  if (user.id === null || user.tenantId === null) {
    throw new Error('USER_CONTEXT_REQUIRED')
  }
  return { tenantId: user.tenantId, userId: user.id, branchId: user.branchId }
}

/**
 * Apply downstream schedule recomputation for order :id (display_id).
 * Opens a db.transaction with all three GUC set_configs, applies the math,
 * and always writes an explicit audit_logs row (even if 0 rows changed,
 * because the trigger won't fire when nothing is updated).
 */
export async function recomputeOrder(
  user: AuthUser,
  orderDisplayId: string,
): Promise<{ updated: number; downstream: DownstreamWire[] }> {
  const ctx = requireUserCtx(user)
  const { tenantId, userId, branchId } = ctx

  return withTenantTx({ tenantId, userId, branchId }, async (tx) => {
    // Load the source order by display_id.
    const [sourceRow] = await tx
      .select({
        id: clinicalOrders.id,
        displayId: clinicalOrders.displayId,
        patientStandingOrderId: clinicalOrders.patientStandingOrderId,
        doseNumber: clinicalOrders.doseNumber,
        serviceId: clinicalOrders.serviceId,
        status: clinicalOrders.status,
        completedAt: clinicalOrders.completedAt,
        currentScheduledDate: clinicalOrders.currentScheduledDate,
      })
      .from(clinicalOrders)
      .where(
        and(
          eq(clinicalOrders.displayId, orderDisplayId),
          eq(clinicalOrders.tenantId, tenantId),
          isNull(clinicalOrders.deletedAt),
        ),
      )
      .limit(1)

    if (!sourceRow) {
      return { updated: 0, downstream: [] }
    }

    const result = await applyRecomputeTx(tx, {
      tenantId,
      userId,
      id: orderDisplayId,
      sourceData: sourceRow,
    })

    if (result.updated === 0) {
      throw new LifecycleError(
        'The projected schedule is unchanged; no schedule shift was committed',
        'NO_SCHEDULE_CHANGES',
        409,
      )
    }

    // Audit only a real shift. A no-op is rejected above and cannot be logged
    // as if dates moved.
    await writeScheduleChangeAudit(tx, {
      tenantId,
      userId,
      recordId: orderDisplayId,
      action: 'SCHEDULE_CHANGE',
      changes: {
        type: 'recompute',
        updated: result.updated,
        downstream: result.downstream.map((d) => ({ id: d.id, toDate: d.toDate })),
      },
    })

    return result
  })
}

/**
 * Atomically administer a scheduled order:
 * FEFO deduct → consent upsert → status Completed → downstream recompute.
 */
export async function administerOrder(
  user: AuthUser,
  orderDisplayId: string,
  dto: AdministerDto,
  idempotencyKey?: string,
): Promise<AdministerResult> {
  const ctx = requireUserCtx(user)
  const { tenantId, userId, branchId } = ctx

  // Who physically gave the dose. On the shared Branch kiosk this is a named
  // clinician proved by their kiosk PIN; on an individual clinical login it is
  // the caller. Resolved BEFORE the transaction opens so a failed attestation
  // costs nothing and cannot half-write: verifying a PIN performs its own
  // writes (the `pin_attempts` lockout counters), which must not ride on, or be
  // rolled back with, the clinical transaction.
  const administeredById = await resolveAdministeringClinician({
    tenantId,
    branchId,
    caller: { id: userId, role: user.role, displayId: user.displayId },
    administeredById: dto.administeredById,
    attestationPin: dto.attestationPin,
  })

  return withTenantTx({ tenantId, userId, branchId }, async (tx) => {
    const result = await administerOrderTx(tx, {
      tenantId,
      branchId,
      userId,
      administeredById,
      id: orderDisplayId,
      dto,
      idempotencyKey,
    })

    // Domain event payload carries display_ids (per spec #11).
    await tx.insert(domainEvents).values({
      tenantId,
      eventType: 'ClinicalOrderAdministered',
      aggregateType: 'ClinicalOrder',
      aggregateId: orderDisplayId,
      payload: JSON.stringify({
        patientId: result.patientId ?? '',
        branchId: branchId === null ? '' : String(branchId),
        administeredAt: result.completedAt,
        lotId: result.lot.lotId,
        serviceId: result.serviceId,
      }) as unknown,
    })

    return result
  })
}

export type ObservationActionInput = ObservationActionDto & {
  attestedById?: string | undefined
  attestationPin?: string | undefined
}

/**
 * Record an explicit post-dose outcome or discharge acknowledgement. The same
 * clinician/PIN resolver used for dose attribution proves the human behind the
 * action on a shared Branch session.
 */
export async function recordObservationAction(
  user: AuthUser,
  orderDisplayId: string,
  dto: ObservationActionInput,
): Promise<ObservationSummary> {
  const { tenantId, userId, branchId } = requireUserCtx(user)
  if (branchId === null) {
    throw new LifecycleError('Branch context required', 'BRANCH_REQUIRED', 400)
  }

  const attestedById = await resolveAdministeringClinician({
    tenantId,
    branchId,
    caller: { id: userId, role: user.role, displayId: user.displayId },
    administeredById: dto.attestedById,
    attestationPin: dto.attestationPin,
  })

  return withTenantTx({ tenantId, userId, branchId }, async (tx) => {
    const result = await recordObservationActionTx(tx, {
      tenantId,
      branchId,
      orderDisplayId,
      attestedById,
      dto:
        dto.action === 'record_outcome'
          ? { action: dto.action, outcome: dto.outcome, notes: dto.notes }
          : { action: dto.action },
    })

    await tx.insert(domainEvents).values({
      tenantId,
      eventType:
        dto.action === 'record_outcome'
          ? 'PostAdministrationOutcomeRecorded'
          : 'PostAdministrationDischargeAcknowledged',
      aggregateType: 'ClinicalOrder',
      aggregateId: orderDisplayId,
      payload: JSON.stringify({
        observationId: result.id,
        action: dto.action,
        outcome: result.outcome,
        attestedById: dto.attestedById ?? user.displayId,
        occurredAt:
          dto.action === 'record_outcome' ? result.outcomeRecordedAt : result.dischargedAt,
      }) as unknown,
    })

    return result
  })
}

/**
 * Manually reschedule a clinical order to a new date with a reason.
 * Writes an explicit audit row capturing the before/after dates and reason.
 */
export async function rescheduleOrder(
  user: AuthUser,
  orderDisplayId: string,
  newDate: string,
  reason: string,
): Promise<{ id: string; currentScheduledDate: string }> {
  const ctx = requireUserCtx(user)
  const { tenantId, userId, branchId } = ctx

  return withTenantTx({ tenantId, userId, branchId }, async (tx) => {
    return rescheduleOrderTx(tx, {
      tenantId,
      id: orderDisplayId,
      newDate,
      reason,
      userId,
    })
  })
}

// silence unused-suppress imports when needed
void sql
