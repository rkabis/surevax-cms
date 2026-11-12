/**
 * Bite Incidents module — DB layer.
 *
 * Two-tier IDs (W3.c.3, 2026-05-19):
 *   - `bite_incidents.id` is bigserial; `display_id` = `BIT_<8 base32>`.
 *   - `bite_incidents.incident_no` is the optional clinical case-file reference.
 *   - `animal_observation_followups.id` is bigserial; `display_id` = `AOF_<…>`.
 *   - Patient + PSO + user FKs are all bigint internals; HTTP layer
 *     accepts/returns display_id strings only.
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { withTenantTx, type Tx } from '../../shared/db/withTenantTx.js'
import {
  biteIncidents,
  animalObservationFollowups,
  patients,
  users,
  patientStandingOrders,
} from '../../shared/db/schema.js'
import { displayId } from '../../shared/utils/displayId.js'
import {
  shouldCancelDay28ForAnimalOutcome,
  type AnimalOutcome,
  type FatTestResult,
} from './outcomeSemantics.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export type CreateBiteIncidentInput = {
  /** patients.display_id (PAT_...) */
  patientId: string
  /** patient_standing_orders.display_id (PSO_...) */
  patientStandingOrderId?: string | null
  incidentNo?: string | null
  incidentDate: string // YYYY-MM-DD
  species: string
  animalVaccinationStatus: string
  animalVaccinationDocDate?: string | null // YYYY-MM-DD
  animalAgeMonths?: number | null
  exposureCategory: string
  biteSite: string
  requiresObservation?: boolean
  metadata?: unknown
}

export type UpdateBiteIncidentInput = {
  incidentNo?: string | null
  incidentDate?: string
  species?: string
  animalVaccinationStatus?: string
  animalVaccinationDocDate?: string | null
  animalAgeMonths?: number | null
  exposureCategory?: string
  biteSite?: string
  requiresObservation?: boolean
  metadata?: unknown
}

export type RecordOutcomeInput = {
  outcome: AnimalOutcome
  fatTestResult?: FatTestResult
  notes?: string | null
}

// ── Serializers ───────────────────────────────────────────────────────────────

function serializeIncident(row: {
  displayId: string
  incidentNo: string | null
  tenantId: string
  patientDisplayId: string
  psoDisplayId: string | null
  incidentDate: string
  species: 'Dog' | 'Cat' | 'Bat' | 'Monkey' | 'Other'
  animalVaccinationStatus: 'Vaccinated' | 'NotVaccinated' | 'Unknown'
  animalVaccinationDocDate: string | null
  animalAgeMonths: number | null
  exposureCategory: 'I' | 'II' | 'III'
  biteSite: string
  requiresObservation: boolean
  metadata: unknown
  rowVersion: number
  deletedAt: Date | null
  createdAt: Date
  updatedAt: Date
  createdById: number | null
}) {
  return {
    id: row.displayId,
    incidentNo: row.incidentNo ?? null,
    tenantId: row.tenantId,
    patientId: row.patientDisplayId,
    patientStandingOrderId: row.psoDisplayId ?? null,
    incidentDate: row.incidentDate,
    species: row.species,
    animalVaccinationStatus: row.animalVaccinationStatus,
    animalVaccinationDocDate: row.animalVaccinationDocDate ?? null,
    animalAgeMonths: row.animalAgeMonths ?? null,
    exposureCategory: row.exposureCategory,
    biteSite: row.biteSite,
    requiresObservation: row.requiresObservation,
    metadata: row.metadata ?? null,
    rowVersion: row.rowVersion,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdById: row.createdById ?? null,
  }
}

function serializeFollowup(row: {
  displayId: string
  tenantId: string
  biteIncidentDisplayId: string
  dueDate: string
  status: string
  outcome: string | null
  fatTestResult: string | null
  outcomeRecordedAt: Date | null
  // outcomeRecordedById (bigint users FK) is intentionally not surfaced — no
  // bigint crosses the wire (display-id convention — gotchas.md "Display IDs").
  notes: string | null
  rowVersion: number
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: row.displayId,
    tenantId: row.tenantId,
    biteIncidentId: row.biteIncidentDisplayId,
    dueDate: row.dueDate,
    status: row.status,
    outcome: row.outcome ?? null,
    fatTestResult: row.fatTestResult ?? null,
    outcomeRecordedAt: row.outcomeRecordedAt ? row.outcomeRecordedAt.toISOString() : null,
    notes: row.notes ?? null,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Add 14 calendar days to a YYYY-MM-DD string, return YYYY-MM-DD. */
function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// ── List ──────────────────────────────────────────────────────────────────────

export async function listBiteIncidents(opts: {
  tenantId: string
  /** patient display_id (PAT_...) */
  patientId?: string
  limit?: number
}) {
  const limit = Math.min(opts.limit ?? 50, 200)

  return withTenantTx({ tenantId: opts.tenantId, userId: 0, branchId: null }, async (tx) => {
    const conditions = [eq(biteIncidents.tenantId, opts.tenantId), isNull(biteIncidents.deletedAt)]

    if (opts.patientId) {
      const [pat] = await tx
        .select({ id: patients.id })
        .from(patients)
        .where(and(eq(patients.tenantId, opts.tenantId), eq(patients.displayId, opts.patientId)))
        .limit(1)
      if (!pat) return []
      conditions.push(eq(biteIncidents.patientId, pat.id))
    }

    const rows = await tx
      .select({
        id: biteIncidents.id,
        displayId: biteIncidents.displayId,
        incidentNo: biteIncidents.incidentNo,
        tenantId: biteIncidents.tenantId,
        patientDisplayId: patients.displayId,
        psoDisplayId: patientStandingOrders.displayId,
        incidentDate: biteIncidents.incidentDate,
        species: biteIncidents.species,
        animalVaccinationStatus: biteIncidents.animalVaccinationStatus,
        animalVaccinationDocDate: biteIncidents.animalVaccinationDocDate,
        animalAgeMonths: biteIncidents.animalAgeMonths,
        exposureCategory: biteIncidents.exposureCategory,
        biteSite: biteIncidents.biteSite,
        requiresObservation: biteIncidents.requiresObservation,
        metadata: biteIncidents.metadata,
        rowVersion: biteIncidents.rowVersion,
        deletedAt: biteIncidents.deletedAt,
        createdAt: biteIncidents.createdAt,
        updatedAt: biteIncidents.updatedAt,
        createdById: biteIncidents.createdById,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
      })
      .from(biteIncidents)
      .innerJoin(patients, eq(biteIncidents.patientId, patients.id))
      .leftJoin(
        patientStandingOrders,
        eq(biteIncidents.patientStandingOrderId, patientStandingOrders.id),
      )
      .where(and(...conditions))
      .orderBy(desc(biteIncidents.incidentDate))
      .limit(limit)

    // Attach each incident's Day-14 observation followup (one batch query — the
    // list page renders observation status per row).
    const incidentIds = rows.map((r) => r.id)
    const followupRows = incidentIds.length
      ? await tx
          .select({
            displayId: animalObservationFollowups.displayId,
            tenantId: animalObservationFollowups.tenantId,
            biteIncidentId: animalObservationFollowups.biteIncidentId,
            biteIncidentDisplayId: biteIncidents.displayId,
            dueDate: animalObservationFollowups.dueDate,
            status: animalObservationFollowups.status,
            outcome: animalObservationFollowups.outcome,
            fatTestResult: animalObservationFollowups.fatTestResult,
            outcomeRecordedAt: animalObservationFollowups.outcomeRecordedAt,
            outcomeRecordedById: animalObservationFollowups.outcomeRecordedById,
            notes: animalObservationFollowups.notes,
            rowVersion: animalObservationFollowups.rowVersion,
            createdAt: animalObservationFollowups.createdAt,
            updatedAt: animalObservationFollowups.updatedAt,
          })
          .from(animalObservationFollowups)
          .innerJoin(biteIncidents, eq(animalObservationFollowups.biteIncidentId, biteIncidents.id))
          .where(
            and(
              eq(animalObservationFollowups.tenantId, opts.tenantId),
              inArray(animalObservationFollowups.biteIncidentId, incidentIds),
            ),
          )
          .orderBy(animalObservationFollowups.createdAt)
      : []
    const followupByIncident = new Map<number, (typeof followupRows)[number]>()
    for (const f of followupRows) {
      if (!followupByIncident.has(f.biteIncidentId)) followupByIncident.set(f.biteIncidentId, f)
    }

    return rows.map((r) => {
      const f = followupByIncident.get(r.id)
      return {
        ...serializeIncident(r),
        patientFirstName: r.patientFirstName,
        patientLastName: r.patientLastName,
        followup: f ? serializeFollowup(f) : null,
      }
    })
  })
}

// ── Detail ────────────────────────────────────────────────────────────────────

export async function getBiteIncident(tenantId: string, incidentDisplayId: string) {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const [row] = await tx
      .select({
        id: biteIncidents.id,
        displayId: biteIncidents.displayId,
        incidentNo: biteIncidents.incidentNo,
        tenantId: biteIncidents.tenantId,
        patientDisplayId: patients.displayId,
        psoDisplayId: patientStandingOrders.displayId,
        incidentDate: biteIncidents.incidentDate,
        species: biteIncidents.species,
        animalVaccinationStatus: biteIncidents.animalVaccinationStatus,
        animalVaccinationDocDate: biteIncidents.animalVaccinationDocDate,
        animalAgeMonths: biteIncidents.animalAgeMonths,
        exposureCategory: biteIncidents.exposureCategory,
        biteSite: biteIncidents.biteSite,
        requiresObservation: biteIncidents.requiresObservation,
        metadata: biteIncidents.metadata,
        rowVersion: biteIncidents.rowVersion,
        deletedAt: biteIncidents.deletedAt,
        createdAt: biteIncidents.createdAt,
        updatedAt: biteIncidents.updatedAt,
        createdById: biteIncidents.createdById,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
        createdByFirstName: users.firstName,
        createdByLastName: users.lastName,
      })
      .from(biteIncidents)
      .innerJoin(patients, eq(biteIncidents.patientId, patients.id))
      .leftJoin(
        patientStandingOrders,
        eq(biteIncidents.patientStandingOrderId, patientStandingOrders.id),
      )
      .leftJoin(users, eq(biteIncidents.createdById, users.id))
      .where(
        and(
          eq(biteIncidents.tenantId, tenantId),
          eq(biteIncidents.displayId, incidentDisplayId),
          isNull(biteIncidents.deletedAt),
        ),
      )
      .limit(1)

    if (!row) return null

    // Fetch followup (joined on bigint FK)
    const [followupRow] = await tx
      .select({
        displayId: animalObservationFollowups.displayId,
        tenantId: animalObservationFollowups.tenantId,
        biteIncidentDisplayId: biteIncidents.displayId,
        dueDate: animalObservationFollowups.dueDate,
        status: animalObservationFollowups.status,
        outcome: animalObservationFollowups.outcome,
        fatTestResult: animalObservationFollowups.fatTestResult,
        outcomeRecordedAt: animalObservationFollowups.outcomeRecordedAt,
        outcomeRecordedById: animalObservationFollowups.outcomeRecordedById,
        notes: animalObservationFollowups.notes,
        rowVersion: animalObservationFollowups.rowVersion,
        createdAt: animalObservationFollowups.createdAt,
        updatedAt: animalObservationFollowups.updatedAt,
      })
      .from(animalObservationFollowups)
      .innerJoin(biteIncidents, eq(animalObservationFollowups.biteIncidentId, biteIncidents.id))
      .where(
        and(
          eq(animalObservationFollowups.tenantId, tenantId),
          eq(animalObservationFollowups.biteIncidentId, row.id),
        ),
      )
      .orderBy(animalObservationFollowups.createdAt)
      .limit(1)

    return {
      ...serializeIncident(row),
      patientFirstName: row.patientFirstName,
      patientLastName: row.patientLastName,
      createdByName:
        row.createdByFirstName && row.createdByLastName
          ? `${row.createdByLastName}, ${row.createdByFirstName}`
          : null,
      followup: followupRow ? serializeFollowup(followupRow) : null,
    }
  })
}

// ── Create ────────────────────────────────────────────────────────────────────

/**
 * Insert a bite_incidents row + auto-generated Day-14 followup task using an
 * existing transaction. Accepts bigint FKs directly so callers that have
 * already resolved patient / PSO IDs (e.g. /api/arrivals/atomic) don't pay for
 * a second lookup.
 *
 * Returns the new bite incident's display_id; callers can hydrate via
 * `getBiteIncident` outside the tx if they need the full serialized row.
 */
export async function createBiteIncidentInTx(
  tx: Tx,
  ctx: {
    tenantId: string
    userId: number
    /** patients.id (bigint) — already resolved by caller */
    patientBigId: number
    /** patient_standing_orders.id (bigint) — already resolved by caller, or null */
    patientStandingOrderBigId: number | null
  },
  input: Omit<CreateBiteIncidentInput, 'patientId' | 'patientStandingOrderId'>,
): Promise<{ id: string }> {
  const newDisplayId = displayId('BIT')
  const followupDisplayId = displayId('AOF')
  const now = new Date()
  const dueDate = addDays(input.incidentDate, 14)

  const [inserted] = await tx
    .insert(biteIncidents)
    .values({
      displayId: newDisplayId,
      incidentNo: input.incidentNo ?? null,
      tenantId: ctx.tenantId,
      patientId: ctx.patientBigId,
      patientStandingOrderId: ctx.patientStandingOrderBigId,
      incidentDate: input.incidentDate,
      species: input.species as (typeof biteIncidents.$inferInsert)['species'],
      animalVaccinationStatus:
        input.animalVaccinationStatus as (typeof biteIncidents.$inferInsert)['animalVaccinationStatus'],
      animalVaccinationDocDate: input.animalVaccinationDocDate ?? null,
      animalAgeMonths: input.animalAgeMonths ?? null,
      exposureCategory:
        input.exposureCategory as (typeof biteIncidents.$inferInsert)['exposureCategory'],
      biteSite: input.biteSite,
      requiresObservation: input.requiresObservation ?? true,
      metadata: input.metadata != null ? JSON.stringify(input.metadata) : null,
      rowVersion: 0,
      createdAt: now,
      updatedAt: now,
      createdById: ctx.userId,
    })
    .returning({ id: biteIncidents.id })

  if (!inserted) {
    throw new Error('Failed to insert bite incident')
  }

  // Auto-create Day-14 followup task
  await tx.insert(animalObservationFollowups).values({
    displayId: followupDisplayId,
    tenantId: ctx.tenantId,
    biteIncidentId: inserted.id,
    dueDate,
    status: 'Pending',
    outcome: null,
    fatTestResult: null,
    outcomeRecordedAt: null,
    outcomeRecordedById: null,
    notes: null,
    rowVersion: 0,
    createdAt: now,
    updatedAt: now,
  })

  return { id: newDisplayId }
}

export async function createBiteIncident(
  tenantId: string,
  userId: number,
  branchId: number | null,
  input: CreateBiteIncidentInput,
) {
  let newDisplayId: string | null = null

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

    // Resolve optional PSO display_id → bigint
    let psoBigId: number | null = null
    if (input.patientStandingOrderId) {
      const [pso] = await tx
        .select({ id: patientStandingOrders.id })
        .from(patientStandingOrders)
        .where(
          and(
            eq(patientStandingOrders.tenantId, tenantId),
            eq(patientStandingOrders.displayId, input.patientStandingOrderId),
          ),
        )
        .limit(1)
      if (!pso) {
        throw Object.assign(new Error('Patient standing order not found'), {
          statusCode: 404,
          code: 'NOT_FOUND',
        })
      }
      psoBigId = pso.id
    }

    const created = await createBiteIncidentInTx(
      tx,
      { tenantId, userId, patientBigId: pat.id, patientStandingOrderBigId: psoBigId },
      input,
    )
    newDisplayId = created.id
  })

  if (!newDisplayId) {
    throw new Error('Failed to insert bite incident')
  }
  return getBiteIncident(tenantId, newDisplayId)
}

// ── Update ────────────────────────────────────────────────────────────────────

export async function updateBiteIncident(
  tenantId: string,
  userId: number,
  branchId: number | null,
  incidentDisplayId: string,
  input: UpdateBiteIncidentInput,
) {
  const now = new Date()

  const result = await withTenantTx({ tenantId, userId, branchId }, async (tx) => {
    const [existing] = await tx
      .select({ id: biteIncidents.id })
      .from(biteIncidents)
      .where(
        and(
          eq(biteIncidents.tenantId, tenantId),
          eq(biteIncidents.displayId, incidentDisplayId),
          isNull(biteIncidents.deletedAt),
        ),
      )
      .limit(1)

    if (!existing) return null

    const updates: Record<string, unknown> = {
      updatedAt: now,
      rowVersion: sql`${biteIncidents.rowVersion} + 1`,
    }

    if ('incidentNo' in input) updates.incidentNo = input.incidentNo ?? null
    if (input.incidentDate !== undefined) updates.incidentDate = input.incidentDate
    if (input.species !== undefined) updates.species = input.species
    if (input.animalVaccinationStatus !== undefined)
      updates.animalVaccinationStatus = input.animalVaccinationStatus
    if ('animalVaccinationDocDate' in input)
      updates.animalVaccinationDocDate = input.animalVaccinationDocDate ?? null
    if ('animalAgeMonths' in input) updates.animalAgeMonths = input.animalAgeMonths ?? null
    if (input.exposureCategory !== undefined) updates.exposureCategory = input.exposureCategory
    if (input.biteSite !== undefined) updates.biteSite = input.biteSite
    if (input.requiresObservation !== undefined)
      updates.requiresObservation = input.requiresObservation
    if ('metadata' in input)
      updates.metadata = input.metadata != null ? JSON.stringify(input.metadata) : null

    await tx
      .update(biteIncidents)
      .set(updates)
      .where(and(eq(biteIncidents.tenantId, tenantId), eq(biteIncidents.id, existing.id)))

    return { updated: true }
  })

  if (!result) return null
  return getBiteIncident(tenantId, incidentDisplayId)
}

// ── Record outcome ────────────────────────────────────────────────────────────

export type RecordOutcomeResult = {
  followup: ReturnType<typeof serializeFollowup>
  cancelsDay28: boolean
  /** patient display_id — exposed so callers can chase Day-28 cancellation. */
  patientId: string
}

/**
 * Tx-accepting variant of recordFollowupOutcome.
 * CLIN-6: exposed so service.ts can call this AND cancelDay28ArvPepForPatient
 * inside a single outer withTenantTx, making the outcome write + Day-28
 * cancellation atomic.
 */
export async function recordFollowupOutcomeTx(
  tx: Tx,
  tenantId: string,
  userId: number,
  biteIncidentDisplayId: string,
  followupDisplayId: string,
  input: RecordOutcomeInput,
): Promise<RecordOutcomeResult | null> {
  const now = new Date()

  // Validate bite incident exists; capture patient bigint + display_id
  const [incident] = await tx
    .select({
      id: biteIncidents.id,
      patientId: biteIncidents.patientId,
      patientDisplayId: patients.displayId,
    })
    .from(biteIncidents)
    .innerJoin(patients, eq(biteIncidents.patientId, patients.id))
    .where(
      and(
        eq(biteIncidents.tenantId, tenantId),
        eq(biteIncidents.displayId, biteIncidentDisplayId),
        isNull(biteIncidents.deletedAt),
      ),
    )
    .limit(1)

  if (!incident) return null

  // Validate followup belongs to this incident
  const [followup] = await tx
    .select({ id: animalObservationFollowups.id })
    .from(animalObservationFollowups)
    .where(
      and(
        eq(animalObservationFollowups.tenantId, tenantId),
        eq(animalObservationFollowups.displayId, followupDisplayId),
        eq(animalObservationFollowups.biteIncidentId, incident.id),
      ),
    )
    .limit(1)

  if (!followup) return null

  await tx
    .update(animalObservationFollowups)
    .set({
      status: 'Completed',
      outcome: input.outcome as (typeof animalObservationFollowups.$inferInsert)['outcome'],
      fatTestResult:
        (input.fatTestResult as (typeof animalObservationFollowups.$inferInsert)['fatTestResult']) ??
        null,
      outcomeObservedAt: now,
      outcomeRecordedAt: now,
      outcomeRecordedById: userId,
      notes: input.notes ?? null,
      updatedAt: now,
      rowVersion: sql`${animalObservationFollowups.rowVersion} + 1`,
    })
    .where(
      and(
        eq(animalObservationFollowups.tenantId, tenantId),
        eq(animalObservationFollowups.id, followup.id),
      ),
    )

  const [updatedFollowupRow] = await tx
    .select({
      displayId: animalObservationFollowups.displayId,
      tenantId: animalObservationFollowups.tenantId,
      biteIncidentDisplayId: biteIncidents.displayId,
      dueDate: animalObservationFollowups.dueDate,
      status: animalObservationFollowups.status,
      outcome: animalObservationFollowups.outcome,
      fatTestResult: animalObservationFollowups.fatTestResult,
      outcomeRecordedAt: animalObservationFollowups.outcomeRecordedAt,
      outcomeRecordedById: animalObservationFollowups.outcomeRecordedById,
      notes: animalObservationFollowups.notes,
      rowVersion: animalObservationFollowups.rowVersion,
      createdAt: animalObservationFollowups.createdAt,
      updatedAt: animalObservationFollowups.updatedAt,
    })
    .from(animalObservationFollowups)
    .innerJoin(biteIncidents, eq(animalObservationFollowups.biteIncidentId, biteIncidents.id))
    .where(
      and(
        eq(animalObservationFollowups.tenantId, tenantId),
        eq(animalObservationFollowups.id, followup.id),
      ),
    )
    .limit(1)

  const cancelsDay28 = shouldCancelDay28ForAnimalOutcome(input.outcome, input.fatTestResult)

  return {
    followup: serializeFollowup(updatedFollowupRow!),
    cancelsDay28,
    patientId: incident.patientDisplayId,
  }
}
