import { and, desc, asc, eq, sql, type Column } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { withTenantTx } from '../../shared/db/withTenantTx.js'
import { displayId } from '../../shared/utils/displayId.js'
import { assertActiveConsent } from '../../shared/utils/consent.js'
import {
  labOrders,
  partnerLaboratories,
  clinicalOrders,
  encounters,
  serviceCatalog,
  patientStandingOrders,
  patients,
  users,
} from '../../shared/db/schema.js'

// Map allow-listed sort keys → Drizzle column references.
const LAB_ORDER_SORT_COLS: Record<string, Column> = {
  created_at: labOrders.createdAt,
  status: labOrders.status,
  sent_at: labOrders.sentAt,
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a lab order's display_id to its bigint PK + status, scoped to tenant.
 * Returns `null` when no match — callers should 404.
 */
async function resolveLabOrderByDisplayId(opts: { tenantId: string; displayId: string }) {
  return withTenantTx({ tenantId: opts.tenantId, userId: 0, branchId: null }, async (tx) => {
    const [row] = await tx
      .select({ id: labOrders.id, status: labOrders.status })
      .from(labOrders)
      .where(and(eq(labOrders.tenantId, opts.tenantId), eq(labOrders.displayId, opts.displayId)))
      .limit(1)
    return row ?? null
  })
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

/**
 * List lab_orders for a tenant, joined with the linked service (via
 * clinical_orders) and the partner laboratory. Returns a flat row shape
 * suitable for table rendering.
 */
export async function listLabOrders(
  tenantId: string,
  opts: { sort?: string; order?: 'asc' | 'desc' } = {},
) {
  const sortCol = LAB_ORDER_SORT_COLS[opts.sort ?? 'created_at'] ?? labOrders.createdAt
  const dirFn = opts.order === 'asc' ? asc : desc

  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const rows = await tx
      .select({
        // Surface display_id as the public `id` — never leak bigint.
        id: labOrders.displayId,
        status: labOrders.status,
        sentAt: labOrders.sentAt,
        resultReceivedAt: labOrders.resultReceivedAt,
        collectedAt: labOrders.collectedAt,
        hasCriticalValue: labOrders.hasCriticalValue,
        externalOrderId: labOrders.externalOrderId,
        laboratoryName: partnerLaboratories.name,
        serviceName: serviceCatalog.name,
        resultFileAttachmentId: labOrders.resultFileAttachmentId,
        createdAt: labOrders.createdAt,
      })
      .from(labOrders)
      .leftJoin(partnerLaboratories, eq(labOrders.laboratoryId, partnerLaboratories.id))
      .innerJoin(clinicalOrders, eq(labOrders.clinicalOrderId, clinicalOrders.id))
      .innerJoin(serviceCatalog, eq(clinicalOrders.serviceId, serviceCatalog.id))
      .where(eq(labOrders.tenantId, tenantId))
      .orderBy(dirFn(sortCol))
      .limit(200)

    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      sentAt: r.sentAt ? r.sentAt.toISOString() : null,
      resultReceivedAt: r.resultReceivedAt ? r.resultReceivedAt.toISOString() : null,
      collectedAt: r.collectedAt ? r.collectedAt.toISOString() : null,
      hasCriticalValue: r.hasCriticalValue,
      externalOrderId: r.externalOrderId ?? null,
      laboratoryName: r.laboratoryName ?? null,
      serviceName: r.serviceName,
      resultFileAttachmentId: r.resultFileAttachmentId ?? null,
      createdAt: r.createdAt.toISOString(),
    }))
  })
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

/**
 * Fetch a single lab_order by display_id with every column, plus joined labels
 * for the linked service, patient, and partner laboratory.
 */
export async function getLabOrder(tenantId: string, labDisplayId: string) {
  const createdByUser = alias(users, 'created_by_user')
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const [row] = await tx
      .select({
        // lab_orders columns — surface display_id as public `id`
        id: labOrders.displayId,
        tenantId: labOrders.tenantId,
        clinicalOrderId: clinicalOrders.displayId,
        laboratoryId: partnerLaboratories.displayId,
        status: labOrders.status,
        externalOrderId: labOrders.externalOrderId,
        collectedAt: labOrders.collectedAt,
        collectedById: labOrders.collectedById,
        rejectionReason: labOrders.rejectionReason,
        hasCriticalValue: labOrders.hasCriticalValue,
        criticalValueAcknowledgedAt: labOrders.criticalValueAcknowledgedAt,
        criticalValueAcknowledgedById: labOrders.criticalValueAcknowledgedById,
        resultData: labOrders.resultData,
        resultFileAttachmentId: labOrders.resultFileAttachmentId,
        sentAt: labOrders.sentAt,
        resultReceivedAt: labOrders.resultReceivedAt,
        notes: labOrders.notes,
        createdAt: labOrders.createdAt,
        updatedAt: labOrders.updatedAt,
        createdById: labOrders.createdById,
        // Joined labels
        laboratoryName: partnerLaboratories.name,
        serviceName: serviceCatalog.name,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
        // createdBy
        createdByUserId: createdByUser.id,
        createdByDisplayId: createdByUser.displayId,
        createdByFirstName: createdByUser.firstName,
        createdByLastName: createdByUser.lastName,
      })
      .from(labOrders)
      .leftJoin(partnerLaboratories, eq(labOrders.laboratoryId, partnerLaboratories.id))
      .innerJoin(clinicalOrders, eq(labOrders.clinicalOrderId, clinicalOrders.id))
      .innerJoin(serviceCatalog, eq(clinicalOrders.serviceId, serviceCatalog.id))
      .leftJoin(
        patientStandingOrders,
        eq(clinicalOrders.patientStandingOrderId, patientStandingOrders.id),
      )
      .leftJoin(patients, eq(patientStandingOrders.patientId, patients.id))
      .leftJoin(createdByUser, eq(createdByUser.id, labOrders.createdById))
      .where(and(eq(labOrders.tenantId, tenantId), eq(labOrders.displayId, labDisplayId)))
      .limit(1)

    if (!row) return null

    const patientName =
      row.patientFirstName && row.patientLastName
        ? `${row.patientLastName}, ${row.patientFirstName}`
        : null

    return {
      id: row.id,
      tenantId: row.tenantId,
      clinicalOrderId: row.clinicalOrderId ?? null,
      laboratoryId: row.laboratoryId ?? null,
      status: row.status,
      externalOrderId: row.externalOrderId ?? null,
      collectedAt: row.collectedAt ? row.collectedAt.toISOString() : null,
      collectedById: row.collectedById ?? null,
      rejectionReason: row.rejectionReason ?? null,
      hasCriticalValue: row.hasCriticalValue,
      criticalValueAcknowledgedAt: row.criticalValueAcknowledgedAt
        ? row.criticalValueAcknowledgedAt.toISOString()
        : null,
      criticalValueAcknowledgedById: row.criticalValueAcknowledgedById ?? null,
      resultData: row.resultData as Record<string, unknown> | null,
      resultFileAttachmentId: row.resultFileAttachmentId ?? null,
      sentAt: row.sentAt ? row.sentAt.toISOString() : null,
      resultReceivedAt: row.resultReceivedAt ? row.resultReceivedAt.toISOString() : null,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      createdById: row.createdById,
      createdBy: row.createdByUserId
        ? {
            id: row.createdByUserId,
            displayId: row.createdByDisplayId!,
            firstName: row.createdByFirstName!,
            lastName: row.createdByLastName!,
          }
        : null,
      laboratoryName: row.laboratoryName ?? null,
      serviceName: row.serviceName,
      patientName,
    }
  })
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export type CreateLabOrderInput = {
  tenantId: string
  clinicalOrderDisplayId: string
  laboratoryDisplayId?: string | null
  externalOrderId?: string | null
  notes?: string | null
  userId: number | null
  branchId: number | null
}

export async function createLabOrder(input: CreateLabOrderInput) {
  // Resolve clinical_order bigint PK, joined with its encounter to get branch_id
  // (lab_orders.branch_id is denormalized from encounter.branch_id via clinical_orders).
  const co = await withTenantTx(
    { tenantId: input.tenantId, userId: 0, branchId: null },
    async (tx) => {
      const [row] = await tx
        .select({
          id: clinicalOrders.id,
          patientId: clinicalOrders.patientId,
          // Encounters carry branch_id; clinical_orders links to encounter via encounterId.
          branchId: encounters.branchId,
        })
        .from(clinicalOrders)
        .leftJoin(encounters, eq(clinicalOrders.encounterId, encounters.id))
        .where(
          and(
            eq(clinicalOrders.tenantId, input.tenantId),
            eq(clinicalOrders.displayId, input.clinicalOrderDisplayId),
          ),
        )
        .limit(1)
      return row ?? null
    },
  )
  if (!co) return null

  // Fall back to the caller-supplied branchId when encounter join produces null
  // (e.g. standing-order-driven clinical_orders without a linked encounter).
  const resolvedBranchId = co.branchId ?? input.branchId
  if (!resolvedBranchId) return null

  // Optionally resolve lab bigint PK
  let labPk: number | null = null
  if (input.laboratoryDisplayId) {
    const lab = await withTenantTx(
      { tenantId: input.tenantId, userId: 0, branchId: null },
      async (tx) => {
        const [row] = await tx
          .select({ id: partnerLaboratories.id })
          .from(partnerLaboratories)
          .where(
            and(
              eq(partnerLaboratories.tenantId, input.tenantId),
              eq(partnerLaboratories.displayId, input.laboratoryDisplayId!),
            ),
          )
          .limit(1)
        return row ?? null
      },
    )
    if (!lab) return null
    labPk = lab.id
  }

  const row = await withTenantTx(
    { tenantId: input.tenantId, userId: input.userId ?? 0, branchId: resolvedBranchId },
    async (tx) => {
      // DPA §19 + §34(b): reject lab-order creation when patient consent is revoked/absent.
      await assertActiveConsent(tx, input.tenantId, co.patientId)

      const [inserted] = await tx
        .insert(labOrders)
        .values({
          displayId: displayId('LBO'),
          tenantId: input.tenantId,
          clinicalOrderId: co.id,
          // Denormalize branch_id from encounter (HIGH audit finding fix)
          branchId: resolvedBranchId,
          laboratoryId: labPk,
          externalOrderId: input.externalOrderId ?? null,
          notes: input.notes ?? null,
          createdById: input.userId ?? null,
        })
        .returning({ displayId: labOrders.displayId })
      return inserted!
    },
  )
  return getLabOrder(input.tenantId, row.displayId)
}

// ---------------------------------------------------------------------------
// Mark Sent
// ---------------------------------------------------------------------------

/**
 * Transition a lab order from Pending → Sent.
 * Returns 'invalid_state' if the order is not in Pending state.
 */
export async function markLabSent(
  tenantId: string,
  labDisplayId: string,
  userId: number | null,
): Promise<
  | { type: 'success'; row: NonNullable<Awaited<ReturnType<typeof getLabOrder>>> }
  | { type: 'not_found' }
  | { type: 'invalid_state' }
> {
  const existing = await resolveLabOrderByDisplayId({ tenantId, displayId: labDisplayId })
  if (!existing) return { type: 'not_found' }
  if (existing.status !== 'Pending') return { type: 'invalid_state' }

  return withTenantTx({ tenantId, userId: userId ?? 0, branchId: null }, async (tx) => {
    const now = new Date()
    await tx
      .update(labOrders)
      .set({
        status: 'Sent',
        sentAt: now,
        updatedAt: now,
        rowVersion: sql`${labOrders.rowVersion} + 1`,
      })
      .where(and(eq(labOrders.tenantId, tenantId), eq(labOrders.displayId, labDisplayId)))

    const updated = await getLabOrder(tenantId, labDisplayId)
    if (!updated) return { type: 'not_found' }
    return { type: 'success', row: updated }
  })
}

// ---------------------------------------------------------------------------
// Submit Result
// ---------------------------------------------------------------------------

/**
 * Transition a lab order from Sent → ResultReceived.
 * Returns 'invalid_state' if the order is not in Sent state.
 */
export async function submitLabResult(
  tenantId: string,
  labDisplayId: string,
  userId: number | null,
  payload: {
    resultData?: Record<string, unknown>
    resultFileAttachmentId?: number
    notes?: string
  },
): Promise<
  | { type: 'success'; row: NonNullable<Awaited<ReturnType<typeof getLabOrder>>> }
  | { type: 'not_found' }
  | { type: 'invalid_state' }
> {
  const existing = await resolveLabOrderByDisplayId({ tenantId, displayId: labDisplayId })
  if (!existing) return { type: 'not_found' }
  if (existing.status !== 'Sent') return { type: 'invalid_state' }

  const observations = payload.resultData?.['observations']
  const hasCritical =
    Array.isArray(observations) &&
    observations.some(
      (o: unknown) =>
        typeof o === 'object' &&
        o !== null &&
        (o as Record<string, unknown>)['interpretation'] === 'Critical',
    )

  return withTenantTx({ tenantId, userId: userId ?? 0, branchId: null }, async (tx) => {
    const now = new Date()
    await tx
      .update(labOrders)
      .set({
        status: 'ResultReceived',
        resultData: payload.resultData ? JSON.stringify(payload.resultData) : undefined,
        resultFileAttachmentId: payload.resultFileAttachmentId ?? undefined,
        notes: payload.notes ?? undefined,
        resultReceivedAt: now,
        updatedAt: now,
        rowVersion: sql`${labOrders.rowVersion} + 1`,
        ...(hasCritical ? { hasCriticalValue: true } : {}),
      })
      .where(and(eq(labOrders.tenantId, tenantId), eq(labOrders.displayId, labDisplayId)))

    const updated = await getLabOrder(tenantId, labDisplayId)
    if (!updated) return { type: 'not_found' }
    return { type: 'success', row: updated }
  })
}

// ---------------------------------------------------------------------------
// Acknowledge Critical Value
// ---------------------------------------------------------------------------

/**
 * Acknowledge a critical lab value.
 * Returns 'not_critical' if has_critical_value is false.
 * Returns 'already_acknowledged' if already acknowledged.
 */
export async function acknowledgeCriticalValue(
  tenantId: string,
  labDisplayId: string,
  userId: number | null,
): Promise<
  | { type: 'success'; row: NonNullable<Awaited<ReturnType<typeof getLabOrder>>> }
  | { type: 'not_found' }
  | { type: 'not_critical' }
  | { type: 'already_acknowledged' }
> {
  return withTenantTx({ tenantId, userId: userId ?? 0, branchId: null }, async (tx) => {
    const [existing] = await tx
      .select({
        id: labOrders.id,
        hasCriticalValue: labOrders.hasCriticalValue,
        criticalValueAcknowledgedAt: labOrders.criticalValueAcknowledgedAt,
      })
      .from(labOrders)
      .where(and(eq(labOrders.tenantId, tenantId), eq(labOrders.displayId, labDisplayId)))
      .limit(1)

    if (!existing) return { type: 'not_found' }
    if (!existing.hasCriticalValue) return { type: 'not_critical' }
    if (existing.criticalValueAcknowledgedAt !== null) return { type: 'already_acknowledged' }

    const now = new Date()
    await tx
      .update(labOrders)
      .set({
        criticalValueAcknowledgedAt: now,
        criticalValueAcknowledgedById: userId ?? undefined,
        updatedAt: now,
        rowVersion: sql`${labOrders.rowVersion} + 1`,
      })
      .where(and(eq(labOrders.tenantId, tenantId), eq(labOrders.displayId, labDisplayId)))

    const updated = await getLabOrder(tenantId, labDisplayId)
    if (!updated) return { type: 'not_found' as const }
    return { type: 'success', row: updated }
  })
}
