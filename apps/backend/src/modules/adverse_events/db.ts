/**
 * Adverse Events module — DB layer.
 *
 * Two-tier IDs (W3.c.3, 2026-05-19):
 *   - `adverse_events.id` is bigserial; `display_id` = `AVE_<8 base32>`.
 *   - `case_no` is the optional DOH/FDA external reference.
 *   - All FKs (patient, encounter, clinical_order, lot, user) are bigint
 *     internals — callers pass display_ids, we resolve them inside the
 *     transaction.
 *   - Public projections surface display_id strings only; internal bigints
 *     never leak to API callers.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { withTenantTx } from '../../shared/db/withTenantTx.js'
import {
  adverseEvents,
  patients,
  users,
  clinicalOrders,
  encounters,
} from '../../shared/db/schema.js'
import { displayId } from '../../shared/utils/displayId.js'

export type CreateAdverseEventInput = {
  /** patients.display_id (PAT_...) */
  patientId: string
  /** clinical_orders.display_id (ORD_...) */
  clinicalOrderId?: string | null
  /** encounters.display_id (ENC_...) */
  encounterId?: string | null
  caseNo?: string | null
  onsetAt?: string | null
  severity: string
  outcome?: string | null
  description: string
  symptomsCoded?: unknown
  treatmentGiven?: string | null
  reportedToAuthorityAt?: string | null
  authorityReferenceNumber?: string | null
}

export type UpdateAdverseEventInput = {
  caseNo?: string | null
  severity?: string
  outcome?: string | null
  description?: string
  symptomsCoded?: unknown
  treatmentGiven?: string | null
  reportedToAuthorityAt?: string | null
  authorityReferenceNumber?: string | null
}

export type ListAdverseEventsOptions = {
  /** patient display_id filter */
  patientId?: string
  severity?: string
  limit?: number
}

type AdversePublic = {
  id: string // display_id (AVE_...)
  caseNo: string | null
  tenantId: string
  patientId: string // patient display_id
  clinicalOrderId: string | null
  encounterId: string | null
  reportedAt: string
  reportedById: number | null
  onsetAt: string | null
  severity: string
  outcome: string | null
  description: string
  symptomsCoded: unknown
  treatmentGiven: string | null
  reportedToAuthorityAt: string | null
  authorityReferenceNumber: string | null
  rowVersion: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  createdById: number | null
}

function serializeRow(row: {
  displayId: string
  caseNo: string | null
  tenantId: string
  patientDisplayId: string
  clinicalOrderDisplayId: string | null
  encounterDisplayId: string | null
  reportedAt: Date
  reportedById: number | null
  onsetAt: Date | null
  severity: string
  outcome: string | null
  description: string
  symptomsCoded: unknown
  treatmentGiven: string | null
  reportedToAuthorityAt: Date | null
  authorityReferenceNumber: string | null
  rowVersion: number
  deletedAt: Date | null
  createdAt: Date
  updatedAt: Date
  createdById: number | null
}): AdversePublic {
  return {
    id: row.displayId,
    caseNo: row.caseNo ?? null,
    tenantId: row.tenantId,
    patientId: row.patientDisplayId,
    clinicalOrderId: row.clinicalOrderDisplayId ?? null,
    encounterId: row.encounterDisplayId ?? null,
    reportedAt: row.reportedAt.toISOString(),
    reportedById: row.reportedById ?? null,
    onsetAt: row.onsetAt ? row.onsetAt.toISOString() : null,
    severity: row.severity,
    outcome: row.outcome ?? null,
    description: row.description,
    symptomsCoded: row.symptomsCoded ?? null,
    treatmentGiven: row.treatmentGiven ?? null,
    reportedToAuthorityAt: row.reportedToAuthorityAt
      ? row.reportedToAuthorityAt.toISOString()
      : null,
    authorityReferenceNumber: row.authorityReferenceNumber ?? null,
    rowVersion: row.rowVersion,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdById: row.createdById ?? null,
  }
}

export async function listAdverseEvents(tenantId: string, opts: ListAdverseEventsOptions) {
  const limit = Math.min(opts.limit ?? 50, 200)

  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const conditions = [eq(adverseEvents.tenantId, tenantId), isNull(adverseEvents.deletedAt)]

    // Resolve patient display_id → bigint (RLS-scoped, returns empty if missing).
    if (opts.patientId) {
      const [pat] = await tx
        .select({ id: patients.id })
        .from(patients)
        .where(and(eq(patients.tenantId, tenantId), eq(patients.displayId, opts.patientId)))
        .limit(1)
      if (!pat) return []
      conditions.push(eq(adverseEvents.patientId, pat.id))
    }
    if (opts.severity) {
      conditions.push(eq(adverseEvents.severity, opts.severity))
    }

    const rows = await tx
      .select({
        displayId: adverseEvents.displayId,
        caseNo: adverseEvents.caseNo,
        tenantId: adverseEvents.tenantId,
        patientDisplayId: patients.displayId,
        clinicalOrderDisplayId: clinicalOrders.displayId,
        encounterDisplayId: encounters.displayId,
        reportedAt: adverseEvents.reportedAt,
        reportedById: adverseEvents.reportedById,
        onsetAt: adverseEvents.onsetAt,
        severity: adverseEvents.severity,
        outcome: adverseEvents.outcome,
        description: adverseEvents.description,
        symptomsCoded: adverseEvents.symptomsCoded,
        treatmentGiven: adverseEvents.treatmentGiven,
        reportedToAuthorityAt: adverseEvents.reportedToAuthorityAt,
        authorityReferenceNumber: adverseEvents.authorityReferenceNumber,
        rowVersion: adverseEvents.rowVersion,
        deletedAt: adverseEvents.deletedAt,
        createdAt: adverseEvents.createdAt,
        updatedAt: adverseEvents.updatedAt,
        createdById: adverseEvents.createdById,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
        reportedByFirstName: users.firstName,
        reportedByLastName: users.lastName,
      })
      .from(adverseEvents)
      .innerJoin(patients, eq(adverseEvents.patientId, patients.id))
      .leftJoin(clinicalOrders, eq(adverseEvents.clinicalOrderId, clinicalOrders.id))
      .leftJoin(encounters, eq(adverseEvents.encounterId, encounters.id))
      .leftJoin(users, eq(adverseEvents.reportedById, users.id))
      .where(and(...conditions))
      .orderBy(desc(adverseEvents.reportedAt))
      .limit(limit)

    return rows.map((r) => ({
      ...serializeRow(r),
      patientFirstName: r.patientFirstName,
      patientLastName: r.patientLastName,
      reportedByName:
        r.reportedByFirstName && r.reportedByLastName
          ? `${r.reportedByLastName}, ${r.reportedByFirstName}`
          : null,
    }))
  })
}

export async function getAdverseEvent(tenantId: string, eventDisplayId: string) {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const [row] = await tx
      .select({
        displayId: adverseEvents.displayId,
        caseNo: adverseEvents.caseNo,
        tenantId: adverseEvents.tenantId,
        patientDisplayId: patients.displayId,
        clinicalOrderDisplayId: clinicalOrders.displayId,
        encounterDisplayId: encounters.displayId,
        reportedAt: adverseEvents.reportedAt,
        reportedById: adverseEvents.reportedById,
        onsetAt: adverseEvents.onsetAt,
        severity: adverseEvents.severity,
        outcome: adverseEvents.outcome,
        description: adverseEvents.description,
        symptomsCoded: adverseEvents.symptomsCoded,
        treatmentGiven: adverseEvents.treatmentGiven,
        reportedToAuthorityAt: adverseEvents.reportedToAuthorityAt,
        authorityReferenceNumber: adverseEvents.authorityReferenceNumber,
        rowVersion: adverseEvents.rowVersion,
        deletedAt: adverseEvents.deletedAt,
        createdAt: adverseEvents.createdAt,
        updatedAt: adverseEvents.updatedAt,
        createdById: adverseEvents.createdById,
        // join-only fields
        clinicalOrderStatus: clinicalOrders.status,
        encounterSpecialty: encounters.specialty,
        encounterStatus: encounters.status,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
        reportedByFirstName: users.firstName,
        reportedByLastName: users.lastName,
      })
      .from(adverseEvents)
      .innerJoin(patients, eq(adverseEvents.patientId, patients.id))
      .leftJoin(clinicalOrders, eq(adverseEvents.clinicalOrderId, clinicalOrders.id))
      .leftJoin(encounters, eq(adverseEvents.encounterId, encounters.id))
      .leftJoin(users, eq(adverseEvents.reportedById, users.id))
      .where(
        and(
          eq(adverseEvents.tenantId, tenantId),
          eq(adverseEvents.displayId, eventDisplayId),
          isNull(adverseEvents.deletedAt),
        ),
      )
      .limit(1)

    if (!row) return null

    return {
      ...serializeRow(row),
      patientFirstName: row.patientFirstName,
      patientLastName: row.patientLastName,
      reportedByName:
        row.reportedByFirstName && row.reportedByLastName
          ? `${row.reportedByLastName}, ${row.reportedByFirstName}`
          : null,
      clinicalOrder:
        row.clinicalOrderDisplayId && row.clinicalOrderStatus
          ? { id: row.clinicalOrderDisplayId, status: row.clinicalOrderStatus }
          : null,
      encounter:
        row.encounterDisplayId && row.encounterSpecialty && row.encounterStatus
          ? {
              id: row.encounterDisplayId,
              specialty: row.encounterSpecialty,
              status: row.encounterStatus,
            }
          : null,
    }
  })
}

export async function createAdverseEvent(
  tenantId: string,
  userId: number,
  branchId: number | null,
  input: CreateAdverseEventInput,
) {
  const newDisplayId = displayId('AVE')
  const now = new Date()

  await withTenantTx({ tenantId, userId, branchId }, async (tx) => {
    // Resolve patient display_id → bigint
    const [pat] = await tx
      .select({ id: patients.id })
      .from(patients)
      .where(and(eq(patients.tenantId, tenantId), eq(patients.displayId, input.patientId)))
      .limit(1)
    if (!pat) {
      throw Object.assign(new Error('Patient not found'), { statusCode: 404, code: 'NOT_FOUND' })
    }

    // Resolve optional clinical_order display_id → bigint
    let clinicalOrderBigId: number | null = null
    if (input.clinicalOrderId) {
      const [co] = await tx
        .select({ id: clinicalOrders.id })
        .from(clinicalOrders)
        .where(
          and(
            eq(clinicalOrders.tenantId, tenantId),
            eq(clinicalOrders.displayId, input.clinicalOrderId),
          ),
        )
        .limit(1)
      if (!co) {
        throw Object.assign(new Error('Clinical order not found'), {
          statusCode: 404,
          code: 'NOT_FOUND',
        })
      }
      clinicalOrderBigId = co.id
    }

    // Resolve optional encounter display_id → bigint
    let encounterBigId: number | null = null
    if (input.encounterId) {
      const [enc] = await tx
        .select({ id: encounters.id })
        .from(encounters)
        .where(and(eq(encounters.tenantId, tenantId), eq(encounters.displayId, input.encounterId)))
        .limit(1)
      if (!enc) {
        throw Object.assign(new Error('Encounter not found'), {
          statusCode: 404,
          code: 'NOT_FOUND',
        })
      }
      encounterBigId = enc.id
    }

    await tx.insert(adverseEvents).values({
      displayId: newDisplayId,
      caseNo: input.caseNo ?? null,
      tenantId,
      patientId: pat.id,
      clinicalOrderId: clinicalOrderBigId,
      encounterId: encounterBigId,
      reportedAt: now,
      reportedById: userId,
      onsetAt: input.onsetAt ? new Date(input.onsetAt) : null,
      severity: input.severity,
      outcome: input.outcome ?? null,
      description: input.description,
      symptomsCoded: input.symptomsCoded != null ? JSON.stringify(input.symptomsCoded) : null,
      treatmentGiven: input.treatmentGiven ?? null,
      reportedToAuthorityAt: input.reportedToAuthorityAt
        ? new Date(input.reportedToAuthorityAt)
        : null,
      authorityReferenceNumber: input.authorityReferenceNumber ?? null,
      rowVersion: 0,
      createdAt: now,
      updatedAt: now,
      createdById: userId,
    })
  })

  return getAdverseEvent(tenantId, newDisplayId)
}

export async function updateAdverseEvent(
  tenantId: string,
  userId: number,
  branchId: number | null,
  eventDisplayId: string,
  input: UpdateAdverseEventInput,
) {
  const now = new Date()

  const result = await withTenantTx({ tenantId, userId, branchId }, async (tx) => {
    const [existing] = await tx
      .select({ id: adverseEvents.id })
      .from(adverseEvents)
      .where(
        and(
          eq(adverseEvents.tenantId, tenantId),
          eq(adverseEvents.displayId, eventDisplayId),
          isNull(adverseEvents.deletedAt),
        ),
      )
      .limit(1)

    if (!existing) return null

    const updates: Record<string, unknown> = {
      updatedAt: now,
      rowVersion: sql`${adverseEvents.rowVersion} + 1`,
    }

    if ('caseNo' in input) updates.caseNo = input.caseNo ?? null
    if (input.severity !== undefined) updates.severity = input.severity
    if ('outcome' in input) updates.outcome = input.outcome ?? null
    if (input.description !== undefined) updates.description = input.description
    if ('symptomsCoded' in input)
      updates.symptomsCoded =
        input.symptomsCoded != null ? JSON.stringify(input.symptomsCoded) : null
    if ('treatmentGiven' in input) updates.treatmentGiven = input.treatmentGiven ?? null
    if ('reportedToAuthorityAt' in input)
      updates.reportedToAuthorityAt = input.reportedToAuthorityAt
        ? new Date(input.reportedToAuthorityAt)
        : null
    if ('authorityReferenceNumber' in input)
      updates.authorityReferenceNumber = input.authorityReferenceNumber ?? null

    await tx
      .update(adverseEvents)
      .set(updates)
      .where(and(eq(adverseEvents.tenantId, tenantId), eq(adverseEvents.id, existing.id)))

    return { updated: true }
  })

  if (!result) return null
  return getAdverseEvent(tenantId, eventDisplayId)
}

export async function softDeleteAdverseEvent(
  tenantId: string,
  userId: number,
  branchId: number | null,
  eventDisplayId: string,
) {
  return withTenantTx({ tenantId, userId, branchId }, async (tx) => {
    const [existing] = await tx
      .select({ id: adverseEvents.id })
      .from(adverseEvents)
      .where(
        and(
          eq(adverseEvents.tenantId, tenantId),
          eq(adverseEvents.displayId, eventDisplayId),
          isNull(adverseEvents.deletedAt),
        ),
      )
      .limit(1)

    if (!existing) return null

    await tx
      .update(adverseEvents)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(adverseEvents.tenantId, tenantId), eq(adverseEvents.id, existing.id)))

    return { ok: true as const }
  })
}
