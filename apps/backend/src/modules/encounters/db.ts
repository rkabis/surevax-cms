/**
 * Encounters module — two-tier IDs (W3.a.2, 2026-05-19).
 *
 * - Internal queries operate on bigint PK (`encounters.id`).
 * - Public surface (API responses, route params) uses `display_id` text
 *   (`ENC_<8 base32>`). Route handlers resolve display_id → bigint before
 *   calling into this module.
 * - `visit_no` is per-patient sequential, populated via a
 *   `MAX(visit_no)+1` subquery within the encounter creation transaction.
 *   No DB sequence (would need per-patient scope; subquery is fine at clinic
 *   scale + serialized inside the txn).
 * - encounters_status_history rows are written by a DB trigger
 *   (`write_status_history('encounters_status_history')`) — no app-side
 *   inserts are needed.
 */
import { and, eq, desc, asc, isNull, sql, type Column } from 'drizzle-orm'
import { displayId } from '../../shared/utils/displayId.js'
import { withTenantTx } from '../../shared/db/withTenantTx.js'
import type { Tx } from '../../shared/db/withTenantTx.js'
import { assertActiveConsent } from '../../shared/utils/consent.js'
import { LifecycleError } from '../transactions/db.js'
import {
  encounters,
  patients,
  users,
  branches,
  encounterVitals,
  encounterDiagnoses,
  clinicalOrders,
} from '../../shared/db/schema.js'
import { userPrimaryRoleSql } from '../../shared/db/userViews.js'

type EncounterSpecialtyLiteral = 'Rabies' | 'Flu' | 'Vaccination' | 'General'

/**
 * Serialize active-encounter admission for one patient, then refuse a second
 * non-terminal visit. The transaction-scoped advisory lock closes the race
 * where two workstations both check before either inserts.
 */
export async function assertNoActiveEncounterTx(
  tx: Tx,
  tenantId: string,
  patientId: number,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${patientId}`}, 0))`,
  )

  const [active] = await tx
    .select({ id: encounters.displayId })
    .from(encounters)
    .where(
      and(
        eq(encounters.tenantId, tenantId),
        eq(encounters.patientId, patientId),
        sql`${encounters.status} IN ('Open', 'InProgress')`,
        isNull(encounters.deletedAt),
      ),
    )
    .orderBy(desc(encounters.startedAt))
    .limit(1)

  if (active) {
    throw new LifecycleError(
      'This patient already has an open encounter. Resume it before starting another arrival.',
      'ACTIVE_ENCOUNTER_EXISTS',
      409,
      { activeEncounterId: active.id },
    )
  }
}

// Phase 1 derivation: specialty → human label.
function deriveBundleLabel(specialty: EncounterSpecialtyLiteral): string {
  switch (specialty) {
    case 'Rabies':
      return 'Rabies PEP bundle'
    case 'Flu':
      return 'Flu vaccination'
    case 'Vaccination':
      return 'Vaccination'
    case 'General':
      return 'General consultation'
  }
}

/**
 * SELECT projection that aliases bigint FKs to their `display_id` strings for
 * the API surface. Internal queries still hit the bigint columns; this
 * projection just shapes the response.
 */
const detailSelect = {
  // Surface display_id as `id`; never leak bigint to clients.
  id: encounters.displayId,
  internalId: encounters.id, // kept for join-construction in callers
  tenantId: encounters.tenantId,
  specialty: encounters.specialty,
  status: encounters.status,
  triageCategory: encounters.triageCategory,
  chiefComplaint: encounters.chiefComplaint,
  visitNo: encounters.visitNo,
  startedAt: encounters.startedAt,
  completedAt: encounters.completedAt,
  specialtyData: encounters.specialtyData,
  clinicalNotes: encounters.clinicalNotes,
  // Phase 2 disposition fields
  dispositionCode: encounters.dispositionCode,
  closedById: encounters.closedById,
  appointmentId: encounters.appointmentId,
  deletedAt: encounters.deletedAt,
  createdAt: encounters.createdAt,
  updatedAt: encounters.updatedAt,
  createdById: encounters.createdById,
  // Patient — surface display_id + bigint kept internal
  patientId: patients.displayId,
  patientFirstName: patients.firstName,
  patientLastName: patients.lastName,
  patientDateOfBirth: patients.dateOfBirth,
  // Provider
  providerId: users.displayId,
  providerFirstName: users.firstName,
  providerLastName: users.lastName,
  providerRole: userPrimaryRoleSql(users.id),
  // Location
  branchId: branches.displayId,
  branchName: branches.name,
} as const

// Map allow-listed sort keys → Drizzle column references.
const ENCOUNTER_SORT_COLS: Record<string, Column> = {
  created_at: encounters.startedAt,
  specialty: encounters.specialty,
}

/**
 * Lists encounters newest-first with joined patient + provider summary.
 *
 * @param opts.patientDisplayId optional `PAT_…` filter; resolved to bigint via
 *   a subselect on `patients.display_id`.
 */
export async function listEncounters(opts: {
  limit?: number
  patientDisplayId?: string
  tenantId: string
  branchId?: number | null
  sort?: string
  order?: 'asc' | 'desc'
}) {
  const { tenantId, branchId = null } = opts
  const limit = Math.min(opts.limit ?? 100, 200)
  const sortCol = ENCOUNTER_SORT_COLS[opts.sort ?? 'created_at'] ?? encounters.startedAt
  const dirFn = opts.order === 'asc' ? asc : desc

  return withTenantTx({ tenantId, userId: 0, branchId }, async (tx) => {
    const baseCond = and(
      eq(encounters.tenantId, tenantId),
      branchId === null ? sql`TRUE` : eq(encounters.branchId, branchId),
    )!
    const whereClause = opts.patientDisplayId
      ? and(
          baseCond,
          sql`${encounters.patientId} = (
            SELECT id FROM patients
            WHERE display_id = ${opts.patientDisplayId} AND tenant_id = ${tenantId}
          )`,
        )
      : baseCond

    const rows = await tx
      .select({
        id: encounters.displayId,
        specialty: encounters.specialty,
        status: encounters.status,
        triageCategory: encounters.triageCategory,
        chiefComplaint: encounters.chiefComplaint,
        visitNo: encounters.visitNo,
        startedAt: encounters.startedAt,
        completedAt: encounters.completedAt,
        patientId: patients.displayId,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
        providerId: users.displayId,
        providerFirstName: users.firstName,
        providerLastName: users.lastName,
        providerRole: userPrimaryRoleSql(users.id),
        branchId: branches.displayId,
        branchName: branches.name,
        createdAt: encounters.createdAt,
      })
      .from(encounters)
      .leftJoin(patients, eq(encounters.patientId, patients.id))
      .leftJoin(users, eq(encounters.providerId, users.id))
      .leftJoin(branches, eq(encounters.branchId, branches.id))
      .where(whereClause)
      .orderBy(dirFn(sortCol))
      .limit(limit)

    return rows.map((row) => ({
      ...row,
      startedAt: row.startedAt.toISOString(),
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      bundleLabel: deriveBundleLabel(row.specialty as EncounterSpecialtyLiteral),
    }))
  })
}

/**
 * Fetches a single encounter with patient/provider/branch joins plus vitals
 * and diagnoses. `encounterDisplayId` is the `ENC_…` form.
 */
export async function getEncounter(encounterDisplayId: string, tenantId: string) {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const [row] = await tx
      .select(detailSelect)
      .from(encounters)
      .leftJoin(patients, eq(encounters.patientId, patients.id))
      .leftJoin(users, eq(encounters.providerId, users.id))
      .leftJoin(branches, eq(encounters.branchId, branches.id))
      .where(and(eq(encounters.displayId, encounterDisplayId), eq(encounters.tenantId, tenantId)))
      .limit(1)

    if (!row) return null

    // Fetch vitals and diagnoses in parallel — keyed by bigint encounter id.
    const [vitals, diagnoses] = await Promise.all([
      tx
        .select()
        .from(encounterVitals)
        .where(
          and(
            eq(encounterVitals.encounterId, row.internalId),
            eq(encounterVitals.tenantId, tenantId),
          ),
        )
        .orderBy(desc(encounterVitals.recordedAt)),
      tx
        .select()
        .from(encounterDiagnoses)
        .where(
          and(
            eq(encounterDiagnoses.encounterId, row.internalId),
            eq(encounterDiagnoses.tenantId, tenantId),
            isNull(encounterDiagnoses.deletedAt),
          ),
        )
        .orderBy(encounterDiagnoses.createdAt),
    ])

    // Strip the internal bigint before returning.
    const { internalId: _internalId, ...rest } = row
    return {
      ...rest,
      startedAt: rest.startedAt.toISOString(),
      completedAt: rest.completedAt ? rest.completedAt.toISOString() : null,
      deletedAt: rest.deletedAt ? rest.deletedAt.toISOString() : null,
      createdAt: rest.createdAt.toISOString(),
      updatedAt: rest.updatedAt.toISOString(),
      bundleLabel: deriveBundleLabel(rest.specialty as EncounterSpecialtyLiteral),
      vitals: vitals.map((v) => ({
        ...v,
        recordedAt: v.recordedAt.toISOString(),
        createdAt: v.createdAt.toISOString(),
        updatedAt: v.updatedAt.toISOString(),
      })),
      diagnoses: diagnoses.map((d) => ({
        ...d,
        deletedAt: d.deletedAt ? d.deletedAt.toISOString() : null,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      })),
    }
  })
}

type EncounterSpecialty = 'Rabies' | 'Flu' | 'Vaccination' | 'General'

/**
 * Inserts a new encounter inside a tenant-scoped transaction with RLS context,
 * then returns the row joined with patient/provider/branch (same shape as
 * getEncounter).
 *
 * Accepts `patientDisplayId` (PAT_…) from the API layer; resolves to bigint
 * inside the transaction so the FK write uses canonical bigint.
 *
 * `visit_no` is allocated as `MAX(visit_no) + 1` over the patient — fine at
 * clinic scale because the txn serialises the read+insert pair, and gaps
 * are acceptable per spec.
 */
export async function createEncounter(input: {
  tenantId: string
  branchId: number
  providerId: number
  createdById: number
  patientDisplayId: string
  specialty: EncounterSpecialty
  triageCategory?: string
  chiefComplaint?: string
  specialtyData?: Record<string, unknown>
  clinicalNotes?: Record<string, unknown>
}) {
  return withTenantTx(
    { tenantId: input.tenantId, userId: input.createdById, branchId: input.branchId },
    async (tx) => {
      // Resolve patient display_id → bigint.
      const [patientRow] = await tx
        .select({ id: patients.id, homeBranchId: patients.homeBranchId })
        .from(patients)
        .where(
          and(
            eq(patients.displayId, input.patientDisplayId),
            eq(patients.tenantId, input.tenantId),
            isNull(patients.deletedAt),
          ),
        )
        .limit(1)

      if (!patientRow)
        throw new LifecycleError(
          `Patient '${input.patientDisplayId}' not found`,
          'PATIENT_NOT_FOUND',
          404,
        )
      if (patientRow.homeBranchId !== null && patientRow.homeBranchId !== input.branchId) {
        throw new LifecycleError(
          'Cross-branch chart reveal is read-only; switch to the patient home branch to write',
          'CROSS_BRANCH_WRITE_FORBIDDEN',
          403,
        )
      }
      const patientBigint = patientRow.id

      await assertNoActiveEncounterTx(tx, input.tenantId, patientBigint)

      // DPA §19 + §34(b): reject encounter creation when patient consent is revoked/absent.
      await assertActiveConsent(tx, input.tenantId, patientBigint)

      // Allocate per-patient visit_no.
      const visitRows = (await tx.execute(
        sql`SELECT COALESCE(MAX(visit_no), 0) + 1 AS "nextVisitNo"
            FROM encounters
            WHERE patient_id = ${patientBigint} AND tenant_id = ${input.tenantId}`,
      )) as unknown as Array<{ nextVisitNo: number | string }>
      const nextVisitNo = Number(visitRows[0]?.nextVisitNo ?? 1)

      const values = {
        displayId: displayId('ENC'),
        tenantId: input.tenantId,
        branchId: input.branchId,
        patientId: patientBigint,
        providerId: input.providerId,
        createdById: input.createdById,
        specialty: input.specialty,
        status: 'Open' as const,
        visitNo: nextVisitNo,
        triageCategory: input.triageCategory ?? null,
        chiefComplaint: input.chiefComplaint ?? null,
        // postgres.js requires JSON-stringified values for jsonb columns —
        // see .claude/rules/gotchas.md ("JSONB columns (seed + writes)").
        specialtyData: input.specialtyData ? JSON.stringify(input.specialtyData) : null,
        clinicalNotes: input.clinicalNotes ? JSON.stringify(input.clinicalNotes) : null,
      }

      const [inserted] = await tx
        .insert(encounters)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .values(values as any)
        .returning({ id: encounters.id, displayId: encounters.displayId })

      if (!inserted) return null

      const [row] = await tx
        .select(detailSelect)
        .from(encounters)
        .leftJoin(patients, eq(encounters.patientId, patients.id))
        .leftJoin(users, eq(encounters.providerId, users.id))
        .leftJoin(branches, eq(encounters.branchId, branches.id))
        .where(and(eq(encounters.id, inserted.id), eq(encounters.tenantId, input.tenantId)))
        .limit(1)

      if (!row) return null
      const { internalId: _internalId, ...rest } = row
      return {
        ...rest,
        startedAt: rest.startedAt.toISOString(),
        completedAt: rest.completedAt ? rest.completedAt.toISOString() : null,
        deletedAt: rest.deletedAt ? rest.deletedAt.toISOString() : null,
        createdAt: rest.createdAt.toISOString(),
        updatedAt: rest.updatedAt.toISOString(),
        bundleLabel: deriveBundleLabel(rest.specialty as EncounterSpecialtyLiteral),
        vitals: [] as {
          id: number
          tenantId: string
          encounterId: number
          patientId: number
          recordedAt: string
          recordedById: number | null
          temperatureC: string | null
          heartRateBpm: number | null
          respiratoryRateBpm: number | null
          systolicBp: number | null
          diastolicBp: number | null
          spo2Percent: string | null
          weightKg: string | null
          heightCm: string | null
          bmi: string | null
          painScore: number | null
          extra: unknown
          rowVersion: number
          createdAt: string
          updatedAt: string
          createdById: number | null
        }[],
        diagnoses: [] as {
          id: number
          tenantId: string
          encounterId: number
          patientId: number
          icd10Code: string
          description: string | null
          isPrimary: boolean
          diagnosisType: string | null
          recordedById: number | null
          notes: string | null
          rowVersion: number
          deletedAt: string | null
          createdAt: string
          updatedAt: string
          createdById: number | null
        }[],
      }
    },
  )
}

// ---------------------------------------------------------------------------
// Status transitions: the only two terminal states an encounter can reach.
//
// `Open` (set at insert, above) and `InProgress` (in the enum, never written
// anywhere in this codebase, see the module-level note near
// ACTIVE_ENCOUNTER_STATUSES) are the only non-terminal states. Both close
// exactly the same way: an explicit, attributable, audited write.
//
// A clinical record must never change state without an actor, so both
// transitions require a real `userId` and run through `withTenantTx` (audit
// trigger, RLS, tenant/branch predicate). `encounters` carries NO
// immutability trigger (unlike `transactions`/`clinical_orders` in
// 0004_immutability_and_generated.sql), so the guard below is the only thing
// stopping a terminal encounter from being silently reopened.
// ---------------------------------------------------------------------------

/**
 * `InProgress` is a real enum member (and `encounters_status_history`'s CHECK
 * constraint even pre-allows four more values, 'CheckedIn', 'Triage',
 * 'OnHold', 'NoShow', that were never added to the Postgres enum itself: the
 * schema.ts comment claiming they were added "via supplemental SQL ALTER
 * TYPE" is stale, no such migration exists). Nothing in this codebase has a
 * "start seeing the patient" step distinct from `createEncounter`, so
 * `InProgress` stays vestigial by design: treating it as a valid non-terminal
 * FROM-state (below) costs nothing and keeps the door open if a real
 * check-in/triage step is added later, but this module never WRITES it,
 * since doing so now would just recreate the unreachable-state defect this
 * file fixes.
 */
const ACTIVE_ENCOUNTER_STATUSES = new Set(['Open', 'InProgress'])

type EncounterCloseInput = {
  tenantId: string
  branchId: number | null
  userId: number
  encounterDisplayId: string
  status: 'Completed' | 'Cancelled'
  /** Required (and enforced by contract.ts Zod) only for Cancelled. */
  reason?: string
}

/**
 * Shared guard + write for the two reachable terminal transitions:
 *   Open | InProgress -> Completed
 *   Open | InProgress -> Cancelled  (only when no dose has been administered)
 *
 * Rejects with a structured `LifecycleError` (never a bare 500) when:
 *   - the encounter doesn't exist / isn't visible to this tenant+branch
 *   - the encounter is already terminal (no reopening a Completed/Cancelled
 *     encounter: the encounter_status_history + audit_logs rows are the
 *     durable record of what happened; the DB has no undo)
 *   - cancelling an encounter that already has a completed
 *     `clinical_orders` row against it (a dose went into the patient; that
 *     cannot be un-administered by flipping a status column)
 */
async function closeEncounter(input: EncounterCloseInput) {
  const { tenantId, branchId, userId, encounterDisplayId, status, reason } = input

  await withTenantTx({ tenantId, userId, branchId }, async (tx) => {
    const [row] = await tx
      .select({ id: encounters.id, status: encounters.status })
      .from(encounters)
      .where(and(eq(encounters.displayId, encounterDisplayId), eq(encounters.tenantId, tenantId)))
      .limit(1)

    if (!row) throw new LifecycleError('Encounter not found', 'NOT_FOUND', 404)

    if (!ACTIVE_ENCOUNTER_STATUSES.has(row.status)) {
      throw new LifecycleError(
        `Encounter is already ${row.status} and cannot transition to ${status}`,
        'INVALID_TRANSITION',
        409,
      )
    }

    if (status === 'Cancelled') {
      const [administered] = await tx
        .select({ id: clinicalOrders.id })
        .from(clinicalOrders)
        .where(
          and(
            eq(clinicalOrders.tenantId, tenantId),
            eq(clinicalOrders.encounterId, row.id),
            eq(clinicalOrders.status, 'Completed'),
            isNull(clinicalOrders.deletedAt),
          ),
        )
        .limit(1)
      if (administered) {
        throw new LifecycleError(
          'Cannot cancel an encounter with an administered dose. Complete it instead.',
          'DOSE_ALREADY_ADMINISTERED',
          409,
        )
      }
    }

    const now = new Date()
    // `disposition_code` doubles as the cancellation-reason field here: it
    // is the Phase-2 "why this encounter closed the way it did" column
    // (already on the table, alongside `closed_by_id`, both unused until
    // this change) and free-text `text`, so it fits without a migration.
    // Left null on a routine Completed close; no product requirement yet for
    // a completion note.
    const setValues: Record<string, unknown> = {
      status,
      closedById: userId,
      updatedAt: now,
    }
    if (status === 'Completed') {
      setValues['completedAt'] = now
    } else {
      setValues['dispositionCode'] = reason
    }

    await tx
      .update(encounters)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(setValues as any)
      .where(and(eq(encounters.id, row.id), eq(encounters.tenantId, tenantId)))
  })

  // Re-fetch through the existing detail path so the response shape matches
  // GET /api/encounters/:id exactly (including vitals/diagnoses).
  return getEncounter(encounterDisplayId, tenantId)
}

export async function completeEncounter(input: {
  tenantId: string
  branchId: number | null
  userId: number
  encounterDisplayId: string
}) {
  return closeEncounter({ ...input, status: 'Completed' })
}

export async function cancelEncounter(input: {
  tenantId: string
  branchId: number | null
  userId: number
  encounterDisplayId: string
  reason: string
}) {
  return closeEncounter({ ...input, status: 'Cancelled' })
}

/**
 * Best-effort convenience close for the administer path. NOT called from
 * anywhere in this module: `scheduled_orders/administerOrderTx` is owned by
 * a sibling module and is the one call site that should invoke this, right
 * after it marks a `clinical_orders` row Completed, passing that row's OWN
 * `encounter_id` (the direct FK already selected in administerOrderTx's
 * `FOR UPDATE OF co` query, e.g. `order.encounterId`), never the
 * PSO-fallback `effectiveEncounterId` used there for consent linking.
 *
 * Why the distinction matters: `clinical_orders.encounter_id` is set
 * directly only for point-of-sale bundle fan-out (Ad_Hoc orders created by
 * `clinical_orders/bundleFanOut.ts`), where administering the order really
 * is the whole purpose of that one-off visit. It is left NULL for every
 * Standing_Order-type dose in a multi-week schedule (rabies PEP Day 0, 3,
 * 7, 14, 28): those only carry `patient_standing_orders.initiating_
 * encounter_id`, a one-time link back to the Day-0 intake encounter, reused
 * on every later dose purely so `administerOrderTx` has an encounter to hang
 * the consent record on. Auto-closing off THAT fallback would flip the Day-0
 * encounter to Completed again (harmless no-op once it's already closed) or,
 * worse, closed for the wrong reason weeks later if a nurse had left it open
 * on purpose. Keying strictly off the order's own `encounter_id` avoids
 * that: it only ever fires for the genuine one-order-one-visit case.
 *
 * Advisory, not authoritative: no-ops (never throws) when `encounterId` is
 * null or the encounter is already terminal, because a failed auto-close
 * must never block a real dose administration. The explicit
 * complete/cancel actions above remain available for every other case
 * (consultation-only visits, multi-item visits, anything auto-close missed).
 */
export async function autoCompleteEncounterOnOrderCompletion(
  tx: Tx,
  opts: { tenantId: string; userId: number; encounterId: number | null },
): Promise<void> {
  const { tenantId, userId, encounterId } = opts
  if (encounterId === null) return

  const [row] = await tx
    .select({ status: encounters.status })
    .from(encounters)
    .where(and(eq(encounters.id, encounterId), eq(encounters.tenantId, tenantId)))
    .limit(1)
  if (!row || !ACTIVE_ENCOUNTER_STATUSES.has(row.status)) return

  const now = new Date()
  await tx
    .update(encounters)
    .set({ status: 'Completed', completedAt: now, closedById: userId, updatedAt: now })
    .where(and(eq(encounters.id, encounterId), eq(encounters.tenantId, tenantId)))
}

// ---------------------------------------------------------------------------
// Vitals sub-resource — bigserial PK, no display_id (scoped via encounterId FK)
// ---------------------------------------------------------------------------

export type CreateVitalInput = {
  encounterBigint: number
  patientBigint: number
  recordedById?: number
  temperatureC?: string
  heartRateBpm?: number
  respiratoryRateBpm?: number
  systolicBp?: number
  diastolicBp?: number
  spo2Percent?: string
  weightKg?: string
  heightCm?: string
  bmi?: string
  painScore?: number
  extra?: Record<string, unknown>
}

/** Lists all vitals for an encounter (by display_id), newest-first. */
export async function listVitals(encounterDisplayId: string, tenantId: string) {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    return tx
      .select()
      .from(encounterVitals)
      .innerJoin(encounters, eq(encounterVitals.encounterId, encounters.id))
      .where(
        and(eq(encounters.displayId, encounterDisplayId), eq(encounterVitals.tenantId, tenantId)),
      )
      .orderBy(desc(encounterVitals.recordedAt))
      .then((rows) =>
        rows.map((r) => ({
          ...r.encounter_vitals,
          recordedAt: r.encounter_vitals.recordedAt.toISOString(),
          createdAt: r.encounter_vitals.createdAt.toISOString(),
          updatedAt: r.encounter_vitals.updatedAt.toISOString(),
        })),
      )
  })
}

/** Records a new vitals observation for an encounter. */
export async function createVital(input: CreateVitalInput, createdById: number, tenantId: string) {
  return withTenantTx({ tenantId, userId: createdById, branchId: null }, async (tx) => {
    const values = {
      tenantId,
      encounterId: input.encounterBigint,
      patientId: input.patientBigint,
      recordedAt: new Date(),
      recordedById: input.recordedById ?? createdById,
      temperatureC: input.temperatureC ?? null,
      heartRateBpm: input.heartRateBpm ?? null,
      respiratoryRateBpm: input.respiratoryRateBpm ?? null,
      systolicBp: input.systolicBp ?? null,
      diastolicBp: input.diastolicBp ?? null,
      spo2Percent: input.spo2Percent ?? null,
      weightKg: input.weightKg ?? null,
      heightCm: input.heightCm ?? null,
      bmi: input.bmi ?? null,
      painScore: input.painScore ?? null,
      extra: input.extra ? JSON.stringify(input.extra) : null,
      createdById,
    }

    const [inserted] = await tx
      .insert(encounterVitals)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values(values as any)
      .returning()

    if (!inserted) return null
    return {
      ...inserted,
      recordedAt: inserted.recordedAt.toISOString(),
      createdAt: inserted.createdAt.toISOString(),
      updatedAt: inserted.updatedAt.toISOString(),
    }
  })
}

// ---------------------------------------------------------------------------
// Diagnoses sub-resource — bigserial PK, no display_id (scoped via encounterId FK)
// ---------------------------------------------------------------------------

export type CreateDiagnosisInput = {
  encounterBigint: number
  patientBigint: number
  icd10Code: string
  description?: string
  isPrimary?: boolean
  diagnosisType?: string
  recordedById?: number
  notes?: string
}

/** Lists active (non-deleted) diagnoses for an encounter (by display_id). */
export async function listDiagnoses(encounterDisplayId: string, tenantId: string) {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    return tx
      .select()
      .from(encounterDiagnoses)
      .innerJoin(encounters, eq(encounterDiagnoses.encounterId, encounters.id))
      .where(
        and(
          eq(encounters.displayId, encounterDisplayId),
          eq(encounterDiagnoses.tenantId, tenantId),
          isNull(encounterDiagnoses.deletedAt),
        ),
      )
      .orderBy(encounterDiagnoses.createdAt)
      .then((rows) =>
        rows.map((r) => ({
          ...r.encounter_diagnoses,
          deletedAt: r.encounter_diagnoses.deletedAt
            ? r.encounter_diagnoses.deletedAt.toISOString()
            : null,
          createdAt: r.encounter_diagnoses.createdAt.toISOString(),
          updatedAt: r.encounter_diagnoses.updatedAt.toISOString(),
        })),
      )
  })
}

/** Records a new diagnosis for an encounter. */
export async function createDiagnosis(
  input: CreateDiagnosisInput,
  createdById: number,
  tenantId: string,
) {
  return withTenantTx({ tenantId, userId: createdById, branchId: null }, async (tx) => {
    const values = {
      tenantId,
      encounterId: input.encounterBigint,
      patientId: input.patientBigint,
      icd10Code: input.icd10Code,
      description: input.description ?? null,
      isPrimary: input.isPrimary ?? false,
      diagnosisType: input.diagnosisType ?? null,
      recordedById: input.recordedById ?? createdById,
      notes: input.notes ?? null,
      createdById,
    }

    const [inserted] = await tx.insert(encounterDiagnoses).values(values).returning()

    if (!inserted) return null
    return {
      ...inserted,
      deletedAt: inserted.deletedAt ? inserted.deletedAt.toISOString() : null,
      createdAt: inserted.createdAt.toISOString(),
      updatedAt: inserted.updatedAt.toISOString(),
    }
  })
}

/**
 * Resolve an `ENC_…` display_id to its bigint `id` + `patient_id` within the
 * tenant. Used by sub-resource routes that need the bigint FK target.
 */
export async function resolveEncounter(
  encounterDisplayId: string,
  tenantId: string,
): Promise<{ id: number; patientId: number } | null> {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const [row] = await tx
      .select({ id: encounters.id, patientId: encounters.patientId })
      .from(encounters)
      .where(and(eq(encounters.displayId, encounterDisplayId), eq(encounters.tenantId, tenantId)))
      .limit(1)
    return row ?? null
  })
}
