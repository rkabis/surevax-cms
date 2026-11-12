import { and, eq, isNull, ilike, or, desc, asc, sql, count, type Column } from 'drizzle-orm'
import { displayId, formatMrn } from '../../shared/utils/displayId.js'
import { withTenantTx, type CrossBranchReason, type Tx } from '../../shared/db/withTenantTx.js'
import {
  patients,
  patientTags,
  patientAllergies,
  patientConditions,
  patientEmergencyContacts,
  patientExternalImmunizations,
  consents,
  tagDefinitions,
  clinicalOrders,
  payerProfiles,
  branches,
  encounters,
  transactions,
  crossBranchAccessGrants,
  users,
} from '../../shared/db/schema.js'

// ---------------------------------------------------------------------------
// Demographic projection types (patients_demographic_v view)
// ---------------------------------------------------------------------------

export type PatientDemographicRow = {
  id: number
  displayId: string
  tenantId: string
  homeBranchId: number | null
  /**
   * The home branch's display_id (e.g. `SVX.TMG`), NOT the bigint above.
   * Break-glass (`POST /:id/break-glass`) takes a branch display_id in
   * `targetBranchId` (breakGlassBody, contract.ts) and resolves it back to a
   * bigint server-side, so this is the field the frontend must pass through,
   * never `homeBranchId` stringified. Null when the patient has no fixed
   * home branch, matching `homeBranchId`.
   */
  homeBranchDisplayId: string | null
  mrn: string
  firstName: string
  middleName: string | null
  lastName: string
  suffix: string | null
  dateOfBirth: string | null
  sex: string | null
  primaryPhone: string | null
  isActive: boolean
  allergies: Array<{ allergen: string; severity: string | null; reaction: string | null }>
  activeConditions: Array<{ icd10: string | null; name: string; status: string }>
  dpaConsentActive: boolean
  // RFC §4.2 + D5 aggregates (Step 8a / 8b)
  activeCourses: Array<{
    displayId: string
    templateId: string
    status: string
    startDate: string
  }>
  recentDoses: Array<{
    displayId: string
    serviceId: string
    doseNumber: number | null
    completedAt: string
    manufacturerSnapshot: string | null
    expiryDateSnapshot: string | null
    batchNumber: string | null
    lotId: number | null
    branchId: number | null
  }>
  activeRecalls: Array<{
    displayId: string
    recallNo: string | null
    recallReason: string
    recallSeverity: string
    issuedAt: string
  }>
  recentCriticalLabResults: Array<{
    displayId: string
    status: string
    hasCriticalValue: boolean
    criticalAcknowledgedAt: string | null
    updatedAt: string
    branchId: number | null
  }>
  createdAt: Date
  updatedAt: Date
}

const PEP_DOSE_LABELS = ['Day 0', 'Day 3', 'Day 7', 'Day 14', 'Day 28']
const PREP_DOSE_LABELS = ['Day 0', 'Day 7', 'Day 21-28']

/**
 * Cursor encoding: base64("<created_at_iso>|<bigint_id>")
 * Ordering: (created_at DESC, id DESC) for stability.
 * id is a bigint (number) stored as a decimal string inside the cursor payload.
 * TODO Phase 2: switch X-Total-Count to estimated count via pg_stat or
 * materialized view if scale warrants.
 */
function encodeCursor(createdAt: Date, id: number): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64')
}

function decodeCursor(cursor: string): { ts: Date; id: number } | null {
  try {
    const raw = Buffer.from(cursor, 'base64').toString('utf8')
    const pipe = raw.lastIndexOf('|')
    if (pipe === -1) return null
    const id = Number(raw.slice(pipe + 1))
    if (!Number.isInteger(id) || id <= 0) return null
    return { ts: new Date(raw.slice(0, pipe)), id }
  } catch {
    return null
  }
}

// Map allow-listed sort keys → Drizzle column references.
// The route layer validates the key; this map provides the column reference.
const PATIENT_SORT_COLS: Record<string, Column> = {
  last_name: patients.lastName,
  created_at: patients.createdAt,
}

// ---------------------------------------------------------------------------
// Cross-Branch PHI RFC: Tier-2 masking (single shared predicate + helpers)
// ---------------------------------------------------------------------------

/**
 * True when the patient is homed at a DIFFERENT branch than the caller's own
 * session branch. `homeBranchId == null` means the patient has no fixed home
 * branch and is never cross-branch. `callerBranchId == null` (platform admin
 * / no branch context) keeps full visibility, matching the `branchId: null`
 * operational-read convention in patterns.md.
 *
 * Single predicate reused by listPatients, getPatient, listPatientAllergies,
 * listPatientConditions, and the allergy/condition write-guards in
 * routes.ts, so there is one cross-branch rule in the codebase, not several
 * that can drift.
 */
export function isCrossBranchPatient(
  homeBranchId: number | null,
  callerBranchId: number | null,
): boolean {
  return homeBranchId != null && callerBranchId != null && homeBranchId !== callerBranchId
}

/**
 * Cross-Branch PHI RFC Tier-2 masking, extended to allergies/conditions
 * (owner decision, nurse-testing-readiness follow-up): the previous pass left
 * these unmasked as tenant-wide Tier-1 safety signals, but the sub-resource
 * endpoints (listPatientAllergies/listPatientConditions below) and the
 * embedded arrays on getPatient's detail response are full clinical detail,
 * not the Tier-1 name+severity summary; they need the same Tier-2 rule as
 * the demographic fields.
 *
 * Masking NULLS the detail fields rather than dropping the row: an empty
 * array must always mean "genuinely none recorded," never "hidden," so the
 * row survives and its presence in the array discloses that an allergy /
 * condition IS recorded (existence-without-detail): a nurse who cannot see
 * that anything is recorded at all may not think to break the glass before
 * administering. This mirrors the existing nulled-not-omitted convention for
 * the demographic fields (same contract shape for every caller).
 */
function maskAllergyRow<T extends { id: number }>(
  row: T,
): {
  id: number
  allergen: null
  allergenCode: null
  reaction: null
  severity: null
  onsetDate: null
  source: null
  notes: null
  resolvedAt: null
} {
  return {
    id: row.id,
    allergen: null,
    allergenCode: null,
    reaction: null,
    severity: null,
    onsetDate: null,
    source: null,
    notes: null,
    resolvedAt: null,
  }
}

function maskConditionRow<T extends { id: number }>(
  row: T,
): {
  id: number
  conditionName: null
  icd10Code: null
  status: null
  onsetDate: null
  resolvedDate: null
  notes: null
} {
  return {
    id: row.id,
    conditionName: null,
    icd10Code: null,
    status: null,
    onsetDate: null,
    resolvedDate: null,
    notes: null,
  }
}

export async function listPatients(opts: {
  q?: string
  cursor?: string
  limit?: number
  tenantId: string
  sort?: string
  order?: 'asc' | 'desc'
  /**
   * Caller's own branch (req.tenant.branchId). Used ONLY to mask detail
   * fields for a patient homed at a DIFFERENT branch (Cross-Branch PHI RFC,
   * docs/specs/cross-branch-phi-access.md, R3 fix); it never narrows which
   * rows are returned; Tier-1 search stays tenant-wide. `null` (platform
   * admin / no branch context) keeps full visibility, matching the
   * established `branchId: null` operational-read convention in patterns.md.
   */
  callerBranchId?: number | null
}) {
  const { tenantId, callerBranchId = null } = opts
  const limit = Math.min(opts.limit ?? 25, 200)

  // Day boundaries for per-dose due/overdue states — mirrors the lane
  // predicates in scheduled_orders/db.ts (local-midnight timestamps bound
  // as ISO params against current_scheduled_date timestamptz).
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const todayIso = today.toISOString()
  const tomorrowIso = tomorrow.toISOString()

  // Resolve sort column — fall back to created_at for unknown keys (safe default)
  const sortColKey = opts.sort ?? 'created_at'
  const sortCol = PATIENT_SORT_COLS[sortColKey] ?? patients.createdAt
  const dirFn = opts.order === 'asc' ? asc : desc

  // Filter conditions (excluding cursor — used for total count)
  const filterConditions = [eq(patients.tenantId, tenantId), isNull(patients.deletedAt)]

  if (opts.q) {
    // Patient names are displayed as "Last, First", so search must accept the
    // same punctuation/order as well as the more usual "First Last". Use
    // unaccent on both sides and normalize phone punctuation; the existing
    // per-column ILIKE checks remain for partial single-name lookup.
    const normalizedQuery = opts.q.trim().replace(/,/g, ' ').replace(/\s+/g, ' ')
    const phoneQuery = normalizedQuery.replace(/\D/g, '')
    filterConditions.push(
      or(
        sql`unaccent(${patients.lastName}) ILIKE ('%' || unaccent(${normalizedQuery}) || '%')`,
        sql`unaccent(${patients.firstName}) ILIKE ('%' || unaccent(${normalizedQuery}) || '%')`,
        sql`unaccent(concat_ws(' ', ${patients.firstName}, ${patients.middleName}, ${patients.lastName}))
            ILIKE ('%' || unaccent(${normalizedQuery}) || '%')`,
        sql`unaccent(concat_ws(' ', ${patients.lastName}, ${patients.firstName}, ${patients.middleName}))
            ILIKE ('%' || unaccent(${normalizedQuery}) || '%')`,
        ilike(patients.mrn, `%${normalizedQuery}%`),
        phoneQuery.length > 0
          ? sql`regexp_replace(coalesce(${patients.contactNumber}, ''), '[^0-9]', '', 'g')
                LIKE ('%' || ${phoneQuery} || '%')`
          : sql`FALSE`,
      )!,
    )
  }

  // Cursor conditions (only applied for the default sort; other sorts return top-N)
  const pageConditions = [...filterConditions]
  if (opts.cursor && sortColKey === 'created_at') {
    const decoded = decodeCursor(opts.cursor)
    if (decoded) {
      pageConditions.push(
        sql`(${patients.createdAt}, ${patients.id}) < (${decoded.ts.toISOString()}::timestamptz, ${decoded.id})`,
      )
    }
  }

  const [rows, [countRow]] = await withTenantTx(
    { tenantId, userId: 0, branchId: null },
    async (tx) =>
      Promise.all([
        tx
          .select({
            // Surface display_id as `id` — clients never see the internal bigint PK.
            id: patients.displayId,
            mrn: patients.mrn,
            firstName: patients.firstName,
            lastName: patients.lastName,
            middleName: patients.middleName,
            dateOfBirth: patients.dateOfBirth,
            sex: patients.sex,
            contactNumber: patients.contactNumber,
            email: patients.email,
            address: patients.address,
            region: patients.region,
            province: patients.province,
            city: patients.city,
            isActive: patients.isActive,
            createdAt: patients.createdAt,
            // Keep internal bigint for cursor encoding only — stripped before return.
            _internalId: patients.id,
            // Caller-side masking input only, never returned to clients. See
            // the isCrossBranch computation in the publicData map below.
            homeBranchId: patients.homeBranchId,
            // Per-dose states for the patient's active standing-order course,
            // ordered by dose sequence. NULL when the patient has no active
            // course. Derived from the course's clinical_orders rather than
            // the `indication` text column — neither the seed nor the
            // standing-order creation path populates `indication`, which is
            // why the previous indication-keyed subqueries returned
            // pepTotal: null for mid-course patients (handover §2 bug).
            // State rules mirror scheduled_orders/db.ts lanes / timeline:
            // Completed → done; past local-midnight → overdue; today → due;
            // future → upcoming. NULL scheduled date reads as today (due),
            // matching the timeline fallback.
            // The outer-row correlation is a qualified literal — Drizzle
            // renders ${patients.id} as unqualified "id" inside sql``, which
            // a nested subquery re-binds to its own scope (co.id / pso.id),
            // silently destroying the correlation.
            doseStates: sql<Array<'done' | 'due' | 'overdue' | 'upcoming'> | null>`(
              SELECT json_agg(ds.state ORDER BY ds.dose_number NULLS LAST, ds.id)
              FROM (
                SELECT co.id, co.dose_number,
                  CASE
                    WHEN co.status = 'Completed' THEN 'done'
                    WHEN co.current_scheduled_date IS NULL THEN 'due'
                    WHEN co.current_scheduled_date < ${todayIso} THEN 'overdue'
                    WHEN co.current_scheduled_date < ${tomorrowIso} THEN 'due'
                    ELSE 'upcoming'
                  END AS state
                FROM clinical_orders co
                WHERE co.tenant_id = ${tenantId}
                  AND co.patient_id = "patients"."id"
                  AND co.deleted_at IS NULL
                  AND co.status <> 'Cancelled'
                  AND co.patient_standing_order_id = (
                    SELECT pso.id
                    FROM patient_standing_orders pso
                    WHERE pso.tenant_id = ${tenantId}
                      AND pso.patient_id = "patients"."id"
                      AND pso.status = 'Active'
                    ORDER BY pso.start_date DESC, pso.id DESC
                    LIMIT 1
                  )
              ) ds
            )`.as('dose_states'),
          })
          .from(patients)
          .where(and(...pageConditions))
          // Secondary sort by id ensures stable ordering when the primary col has ties
          .orderBy(dirFn(sortCol), desc(patients.id))
          .limit(limit + 1),
        tx
          .select({ total: count() })
          .from(patients)
          .where(and(...filterConditions)),
      ]),
  )

  const hasMore = rows.length > limit
  const data = hasMore ? rows.slice(0, limit) : rows
  const last = data[data.length - 1]
  const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last._internalId) : null
  const totalCount = countRow?.total ?? 0

  // Strip internal bigint before returning to callers. pepCompleted/pepTotal
  // derive from the same active-course dose array (keeps the counts and the
  // strip consistent); no active course → pepTotal null (renders as "—").
  //
  // Cross-Branch PHI RFC Tier-2 masking (R3): a patient homed at a branch
  // DIFFERENT from the caller's own branch is identifiable (name, MRN, sex,
  // dose progress: the Tier-1 identity/safety signals) but not detailed
  // (DOB, contact, email, address are nulled). `homeBranchId == null` means
  // the patient has no fixed home branch and is never cross-branch (mirrors
  // PatientDetail.tsx's identical rule). `callerBranchId == null` (platform
  // admin / system reads) keeps full visibility.
  const publicData = data.map(({ _internalId: _drop, homeBranchId, doseStates, ...rest }) => {
    const isCrossBranch = isCrossBranchPatient(homeBranchId, callerBranchId)
    const base = {
      ...rest,
      // Arrival and other write-entry surfaces must be able to fail closed
      // before a user enters a workflow. Expose only the derived access fact,
      // never the internal bigint home_branch_id.
      isCrossBranch,
      doseStates,
      pepCompleted: doseStates ? doseStates.filter((s) => s === 'done').length : 0,
      pepTotal: doseStates ? doseStates.length : null,
    }
    if (!isCrossBranch) return base
    return {
      ...base,
      dateOfBirth: null,
      contactNumber: null,
      email: null,
      address: null,
      region: null,
      province: null,
      city: null,
    }
  })

  return { data: publicData, nextCursor, totalCount }
}

/**
 * Resolve a patient display_id to internal bigint id.
 * Returns null if not found (caller raises 404).
 */
export async function resolvePatientId(
  displayIdStr: string,
  tenantId: string,
): Promise<number | null> {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const [row] = await tx
      .select({ id: patients.id })
      .from(patients)
      .where(
        and(
          eq(patients.tenantId, tenantId),
          eq(patients.displayId, displayIdStr),
          isNull(patients.deletedAt),
        ),
      )
      .limit(1)
    return row?.id ?? null
  })
}

/**
 * Resolve a patient display_id to `{ id, homeBranchId }`, like
 * resolvePatientId, but also returns the home branch so the caller can
 * compute Cross-Branch PHI RFC Tier-2 masking / write-guards
 * (isCrossBranchPatient) for the allergy/condition sub-resource routes
 * without a full getPatient call.
 */
export async function resolvePatientBranchContext(
  displayIdStr: string,
  tenantId: string,
): Promise<{ id: number; homeBranchId: number | null } | null> {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const [row] = await tx
      .select({ id: patients.id, homeBranchId: patients.homeBranchId })
      .from(patients)
      .where(
        and(
          eq(patients.tenantId, tenantId),
          eq(patients.displayId, displayIdStr),
          isNull(patients.deletedAt),
        ),
      )
      .limit(1)
    return row ?? null
  })
}

/**
 * Per-dose states (done/due/overdue/upcoming) for a patient's active
 * standing-order course: the detail-read equivalent of the correlated
 * subquery embedded in `listPatients`' `.select()` (above). That version
 * correlates per row via a qualified literal (`"patients"."id"`) because it
 * scans every patient in one query; here the caller has ALREADY resolved
 * the single patient's bigint id, so this binds it as a plain parameter
 * instead of a column reference. That sidesteps the correlation trap
 * entirely (patterns.md: a nested subquery re-binds an unqualified `${col}`
 * reference to its own scope) by construction: there is no outer row scope
 * for a nested subquery to shadow, since `patientId` is a scalar value, not
 * a column. Still verify against a patient with a partial course, not one
 * that merely renders emptily-correct: a wrong binding here would silently
 * return `null` (reads as "no active course") rather than throwing.
 */
async function getActiveDoseStatesTx(
  tx: Tx,
  tenantId: string,
  patientId: number,
): Promise<Array<'done' | 'due' | 'overdue' | 'upcoming'> | null> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const todayIso = today.toISOString()
  const tomorrowIso = tomorrow.toISOString()

  const [row] = await tx.execute<{
    states: Array<'done' | 'due' | 'overdue' | 'upcoming'> | null
  }>(sql`
    SELECT json_agg(ds.state ORDER BY ds.dose_number NULLS LAST, ds.id) AS states
    FROM (
      SELECT co.id, co.dose_number,
        CASE
          WHEN co.status = 'Completed' THEN 'done'
          WHEN co.current_scheduled_date IS NULL THEN 'due'
          WHEN co.current_scheduled_date < ${todayIso} THEN 'overdue'
          WHEN co.current_scheduled_date < ${tomorrowIso} THEN 'due'
          ELSE 'upcoming'
        END AS state
      FROM clinical_orders co
      WHERE co.tenant_id = ${tenantId}
        AND co.patient_id = ${patientId}
        AND co.deleted_at IS NULL
        AND co.status <> 'Cancelled'
        AND co.patient_standing_order_id = (
          SELECT pso.id
          FROM patient_standing_orders pso
          WHERE pso.tenant_id = ${tenantId}
            AND pso.patient_id = ${patientId}
            AND pso.status = 'Active'
          ORDER BY pso.start_date DESC, pso.id DESC
          LIMIT 1
        )
    ) ds
  `)
  return row?.states ?? null
}

/**
 * @param callerBranchId  The requesting session's own branch
 *   (`req.tenant.branchId`). Used ONLY to mask detail fields when the
 *   patient's home branch differs (Cross-Branch PHI RFC, R3 fix); it does
 *   NOT change which patient is readable; that stays tenant-wide by design
 *   (Tier 1 identity search). `null` (platform admin / no branch context)
 *   keeps full visibility, matching the `branchId: null` operational-read
 *   convention documented in patterns.md.
 */
export async function getPatient(
  displayIdStr: string,
  tenantId: string,
  callerBranchId: number | null = null,
) {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    // Resolve display_id → bigint for all child table joins
    const [header] = await tx
      .select()
      .from(patients)
      .where(
        and(
          eq(patients.tenantId, tenantId),
          eq(patients.displayId, displayIdStr),
          isNull(patients.deletedAt),
        ),
      )
      .limit(1)
    if (!header) return null

    const internalId = header.id

    const [allergyRows, conditionRows, tagRows, onboardingChannelPayer, doseStates] =
      await Promise.all([
        tx
          .select({
            id: patientAllergies.id,
            allergen: patientAllergies.allergen,
            allergenCode: patientAllergies.allergenCode,
            reaction: patientAllergies.reaction,
            severity: patientAllergies.severity,
            onsetDate: patientAllergies.onsetDate,
            source: patientAllergies.source,
            notes: patientAllergies.notes,
            resolvedAt: patientAllergies.resolvedAt,
          })
          .from(patientAllergies)
          .where(
            and(
              eq(patientAllergies.patientId, internalId),
              eq(patientAllergies.tenantId, tenantId),
              isNull(patientAllergies.deletedAt),
            ),
          )
          .orderBy(asc(patientAllergies.allergen)),

        tx
          .select({
            id: patientConditions.id,
            conditionName: patientConditions.conditionName,
            icd10Code: patientConditions.icd10Code,
            status: patientConditions.status,
            onsetDate: patientConditions.onsetDate,
            resolvedDate: patientConditions.resolvedDate,
            notes: patientConditions.notes,
          })
          .from(patientConditions)
          .where(
            and(
              eq(patientConditions.patientId, internalId),
              eq(patientConditions.tenantId, tenantId),
              isNull(patientConditions.deletedAt),
            ),
          )
          .orderBy(asc(patientConditions.conditionName)),

        getPatientTagsTx(tx, internalId, tenantId),

        // Onboarding-channel payer (Partner/HMO) → expose display_id + name, not the bigint.
        header.onboardingChannelPayerId
          ? tx
              .select({ id: payerProfiles.displayId, name: payerProfiles.name })
              .from(payerProfiles)
              .where(
                and(
                  eq(payerProfiles.tenantId, tenantId),
                  eq(payerProfiles.id, header.onboardingChannelPayerId),
                ),
              )
              .limit(1)
              .then((rows) => rows[0] ?? null)
          : Promise.resolve(null),

        getActiveDoseStatesTx(tx, tenantId, internalId),
      ])

    // Surface display_id as `id`; exclude internal bigint PK and the raw payer FK
    // bigint (replaced by the resolved onboardingChannelPayer ref). homeBranchId
    // and createdById are internal bigint FKs — dropped so no bigint crosses the
    // wire (display-id convention — gotchas.md "Display IDs").
    const {
      id: _internalId,
      onboardingChannelPayerId: _payerFk,
      homeBranchId,
      createdById: _createdById,
      ...patientPublic
    } = header
    const result = {
      ...patientPublic,
      id: header.displayId,
      onboardingChannelPayer,
      allergies: allergyRows,
      conditions: conditionRows,
      tags: tagRows,
      // Per-dose states for the active standing-order course, same
      // derivation as listPatients' doseStates (getActiveDoseStatesTx
      // above), so PatientDetail.tsx can render the real DoseStrip instead
      // of the hardcoded D0/D3/D7/D14 fiction it used to show. NULL when
      // there is no active course.
      doseStates,
      pepCompleted: doseStates ? doseStates.filter((s) => s === 'done').length : 0,
      pepTotal: doseStates ? doseStates.length : null,
    }

    // Cross-Branch PHI RFC Tier-2 masking (R3 fix): `home_branch_id IS NULL`
    // means the patient has no fixed home branch and is never treated as
    // cross-branch (mirrors the identical rule in PatientDetail.tsx).
    // `callerBranchId == null` (platform admin / no branch context) keeps
    // full visibility (patterns.md "Cross-branch visibility via
    // user_branches"). Nulled, not omitted: every field below is already
    // `.nullable()` in patientDetailSchema (contract.ts), so no contract
    // change is needed and the shape stays identical for every caller,
    // easier for the frontend to render ("no data" vs "field doesn't exist
    // on this response"). Allergies/conditions are now masked too (owner
    // decision, nurse-testing-readiness follow-up) via the shared
    // maskAllergyRow/maskConditionRow helpers; see their doc comment for
    // why the row survives (existence-without-detail) instead of the array
    // collapsing to empty. Tags are left intact: they carry no clinical
    // detail (just a dictionary label/color/category chip).
    //
    // doseStates/pepCompleted/pepTotal are ALSO masked here, deliberately
    // stricter than listPatients, which keeps dose progress visible
    // cross-branch as a coarse Tier-1 identity/safety signal. The detail
    // endpoint's doseStates is the full per-dose sequence (which dose is
    // due/overdue and when), the same "full clinical detail, not a Tier-1
    // summary" reasoning that got allergies/conditions upgraded to Tier-2
    // here, so it is nulled alongside them rather than left to leak.
    const isCrossBranch = isCrossBranchPatient(homeBranchId, callerBranchId)
    if (!isCrossBranch) return result
    return {
      ...result,
      allergies: allergyRows.map(maskAllergyRow),
      conditions: conditionRows.map(maskConditionRow),
      dateOfBirth: null,
      contactNumber: null,
      email: null,
      address: null,
      region: null,
      province: null,
      city: null,
      barangay: null,
      guardianName: null,
      guardianRelationship: null,
      guardianContact: null,
      insuranceProvider: null,
      insurancePolicyNumber: null,
      civilStatus: null,
      nationality: null,
      onboardingChannel: null,
      onboardingChannelPayer: null,
      onboardingData: null,
      doseStates: null,
      pepCompleted: 0,
      pepTotal: null,
    }
  })
}

/**
 * Internal helper — takes the bigint patientId (already resolved from display_id)
 * and an existing tx handle. Used by getPatient to avoid nested withTenantTx calls.
 */
async function getPatientTagsTx(tx: Tx, patientId: number, tenantId: string) {
  // Phase 4: patient_tags.tag dropped — read tag text from tag_definitions only.
  // patient_tags has no display_id and tagDefinitionId is an internal bigint FK,
  // so neither crosses the wire (display-id convention) — the chip renders from
  // tag/color/category alone.
  const rows = await tx
    .select({
      tag: tagDefinitions.tag,
      color: tagDefinitions.color,
      category: tagDefinitions.category,
    })
    .from(patientTags)
    .innerJoin(
      tagDefinitions,
      and(
        eq(patientTags.tagDefinitionId, tagDefinitions.id),
        eq(tagDefinitions.tenantId, tenantId),
      ),
    )
    .where(and(eq(patientTags.patientId, patientId), eq(patientTags.tenantId, tenantId)))
    .orderBy(asc(tagDefinitions.tag))

  return rows.map((r) => ({
    tag: r.tag,
    color: r.color,
    category: r.category,
  }))
}

/**
 * Public helper — takes the bigint patientId (already resolved from display_id).
 */
export async function getPatientTags(patientId: number, tenantId: string) {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, (tx) =>
    getPatientTagsTx(tx, patientId, tenantId),
  )
}

/**
 * Resolve an onboarding-channel payer (PYR_… display id) to its bigint FK,
 * scoped to the tenant. Returns null when no/invalid display id is supplied —
 * channels other than Partner/HMO carry no payer.
 */
async function resolvePayerProfileId(
  tx: Tx,
  tenantId: string,
  payerDisplayId: string | null | undefined,
): Promise<number | null> {
  if (!payerDisplayId) return null
  const [row] = await tx
    .select({ id: payerProfiles.id })
    .from(payerProfiles)
    .where(and(eq(payerProfiles.tenantId, tenantId), eq(payerProfiles.displayId, payerDisplayId)))
    .limit(1)
  return row?.id ?? null
}

export async function createPatient(data: {
  firstName: string
  lastName: string
  middleName?: string
  dateOfBirth?: string
  sex?: 'Male' | 'Female' | 'Other'
  contactNumber?: string
  email?: string
  address?: string
  region?: string
  province?: string
  city?: string
  barangay?: string
  guardianName?: string
  guardianRelationship?: string
  guardianContact?: string
  allergies?: string[]
  conditions?: string[]
  insuranceProvider?: string
  insurancePolicyNumber?: string
  civilStatus?: string
  onboardingChannel?: string
  // PYR_… display id; resolved to the bigint FK below. NULL for non-Partner/HMO channels.
  onboardingChannelPayerId?: string | null
  // Messaging-consent flag (patients.sms_opt_in), distinct from the clinical
  // consents table. Defaults to the DB column default (false) when omitted;
  // registration must capture this explicitly so R2 (SMS dose reminders)
  // has someone to text.
  smsOptIn?: boolean
  /** Required registration-time clinical consent attestation. */
  consentObtained: true
  consentBy: 'Patient' | 'Guardian'
  tenantId: string
  branchId?: number | null
  createdById?: number | null
}) {
  const {
    tenantId,
    branchId,
    createdById,
    allergies,
    conditions,
    onboardingChannelPayerId: payerDisplayId,
    consentObtained: _consentObtained,
    consentBy,
    ...rest
  } = data

  return withTenantTx(
    { tenantId, userId: createdById ?? 0, branchId: branchId ?? null },
    async (tx) => {
      const patientDisplayId = displayId('PAT')

      // Allocate MRN from per-tenant sequence (same pattern as seed).
      // Tenant slug is the tenantId (text PK). Lowercase for sequence name.
      const seqName = `mrn_seq_${tenantId.toLowerCase()}`
      const [seqRow] = (await tx.execute(
        sql`SELECT nextval(${seqName}) AS next`,
      )) as unknown as Array<{ next: number | string }>
      const mrn = formatMrn(Number(seqRow!.next))

      // Resolve the onboarding-channel payer (PYR display id → bigint FK).
      const onboardingChannelPayerId = await resolvePayerProfileId(tx, tenantId, payerDisplayId)

      const [created] = await tx
        .insert(patients)
        .values({
          displayId: patientDisplayId,
          tenantId,
          homeBranchId: branchId ?? null,
          createdById: createdById ?? null,
          mrn,
          onboardingChannelPayerId,
          ...rest,
        })
        .returning()

      const internalId = created!.id

      // Registration is a fail-whole-commit: never expose a new chart that
      // downstream clinical writes immediately reject for missing consent.
      // This mirrors Arrivals' explicit attestation, scoped to the patient
      // because direct registration has no encounter yet.
      await tx.insert(consents).values({
        displayId: displayId('CNS'),
        tenantId,
        patientId: internalId,
        encounterId: null,
        consentType: 'informed_consent',
        scope: 'patient',
        // Patient scope is represented by consents.patient_id itself. The
        // polymorphic pair is reserved for narrower supported targets such as
        // encounter or clinical_order (0003_invariants.sql allow-list).
        scopeRefType: null,
        scopeRefId: null,
        consenterRelation: consentBy,
        consenterName: null,
        visProvided: false,
        obtainedAt: new Date(),
        obtainedById: createdById ?? null,
        createdById: createdById ?? null,
      })

      // Insert normalized allergy rows (one per entry, source='PatientReported')
      if (allergies && allergies.length > 0) {
        await Promise.all(
          allergies.map((allergen) =>
            tx.insert(patientAllergies).values({
              tenantId,
              patientId: internalId,
              allergen,
              source: 'PatientReported',
              recordedById: createdById ?? null,
              createdById: createdById ?? null,
            }),
          ),
        )
      }

      // Insert normalized condition rows (status='Active' default)
      if (conditions && conditions.length > 0) {
        await Promise.all(
          conditions.map((conditionName) =>
            tx.insert(patientConditions).values({
              tenantId,
              patientId: internalId,
              conditionName,
              status: 'Active',
              recordedById: createdById ?? null,
              createdById: createdById ?? null,
            }),
          ),
        )
      }

      // Return with display_id as `id`; suppress internal bigint PK and the
      // internal bigint FKs (homeBranchId/createdById) so no bigint crosses the
      // wire (display-id convention — gotchas.md "Display IDs").
      const {
        id: _internalId,
        homeBranchId: _homeBranchId,
        createdById: _createdById,
        ...createdPublic
      } = created!
      return { ...createdPublic, id: patientDisplayId }
    },
  )
}

export async function updatePatient(
  displayIdStr: string,
  tenantId: string,
  userId: number | null,
  data: {
    firstName?: string
    lastName?: string
    middleName?: string
    dateOfBirth?: string
    sex?: 'Male' | 'Female' | 'Other'
    contactNumber?: string
    email?: string
    address?: string
    region?: string
    province?: string
    city?: string
    barangay?: string
    guardianName?: string
    guardianRelationship?: string
    guardianContact?: string
    insuranceProvider?: string
    insurancePolicyNumber?: string
    civilStatus?: string
    onboardingChannel?: string
    onboardingChannelPayerId?: string | null
    smsOptIn?: boolean
  },
  // Caller's own branch, threaded through to getPatient below so the
  // PATCH response is masked the same way as GET (Cross-Branch PHI RFC, R3).
  callerBranchId: number | null = null,
) {
  const resolved = await withTenantTx(
    { tenantId, userId: userId ?? 0, branchId: null },
    async (tx) => {
      const [row] = await tx
        .select({ id: patients.id })
        .from(patients)
        .where(and(eq(patients.tenantId, tenantId), eq(patients.displayId, displayIdStr)))
        .limit(1)
      if (!row) return null

      const updates: Record<string, unknown> = { updatedAt: new Date() }
      if (data.firstName !== undefined) updates['firstName'] = data.firstName
      if (data.lastName !== undefined) updates['lastName'] = data.lastName
      if (data.middleName !== undefined) updates['middleName'] = data.middleName || null
      if (data.dateOfBirth !== undefined) updates['dateOfBirth'] = data.dateOfBirth || null
      if (data.sex !== undefined) updates['sex'] = data.sex
      if (data.contactNumber !== undefined) updates['contactNumber'] = data.contactNumber || null
      if (data.email !== undefined) updates['email'] = data.email || null
      if (data.address !== undefined) updates['address'] = data.address || null
      if (data.region !== undefined) updates['region'] = data.region || null
      if (data.province !== undefined) updates['province'] = data.province || null
      if (data.city !== undefined) updates['city'] = data.city || null
      if (data.barangay !== undefined) updates['barangay'] = data.barangay || null
      if (data.guardianName !== undefined) updates['guardianName'] = data.guardianName || null
      if (data.guardianRelationship !== undefined)
        updates['guardianRelationship'] = data.guardianRelationship || null
      if (data.guardianContact !== undefined)
        updates['guardianContact'] = data.guardianContact || null
      if (data.insuranceProvider !== undefined)
        updates['insuranceProvider'] = data.insuranceProvider || null
      if (data.insurancePolicyNumber !== undefined)
        updates['insurancePolicyNumber'] = data.insurancePolicyNumber || null
      if (data.civilStatus !== undefined) updates['civilStatus'] = data.civilStatus
      if (data.onboardingChannel !== undefined)
        updates['onboardingChannel'] = data.onboardingChannel || null
      if (data.onboardingChannelPayerId !== undefined)
        updates['onboardingChannelPayerId'] = await resolvePayerProfileId(
          tx,
          tenantId,
          data.onboardingChannelPayerId,
        )
      if (data.smsOptIn !== undefined) updates['smsOptIn'] = data.smsOptIn

      await tx
        .update(patients)
        .set(updates)
        .where(and(eq(patients.tenantId, tenantId), eq(patients.id, row.id)))
      return row.id
    },
  )
  if (resolved === null) return null

  return getPatient(displayIdStr, tenantId, callerBranchId)
}

export async function softDeletePatient(displayIdStr: string, tenantId: string) {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    // Resolve display_id → bigint for the WHERE clause (defense-in-depth).
    const [row] = await tx
      .select({ id: patients.id })
      .from(patients)
      .where(and(eq(patients.tenantId, tenantId), eq(patients.displayId, displayIdStr)))
      .limit(1)
    if (!row) return null

    await tx
      .update(patients)
      .set({ deletedAt: new Date() })
      .where(and(eq(patients.id, row.id), eq(patients.tenantId, tenantId)))
    return { id: displayIdStr }
  })
}

// ---------------------------------------------------------------------------
// Tags — Phase 3 write switch: dictionary-backed via tag_definitions
// ---------------------------------------------------------------------------

export async function addPatientTag(opts: {
  patientId: number
  tag: string
  tenantId: string
  userId: number | null
  branchId: number | null
}) {
  const { patientId, tag, tenantId, userId, branchId } = opts

  return withTenantTx({ tenantId, userId: userId ?? 0, branchId }, async (tx) => {
    // Upsert tag_definitions — idempotent on (tenant_id, tag)
    await tx
      .insert(tagDefinitions)
      .values({
        displayId: displayId('TGD'),
        tenantId,
        tag,
        createdById: userId,
      })
      .onConflictDoUpdate({
        target: [tagDefinitions.tenantId, tagDefinitions.tag],
        set: { updatedAt: sql`now()` },
      })

    // Fetch the canonical tag_definition id
    const [tagDef] = await tx
      .select({ id: tagDefinitions.id })
      .from(tagDefinitions)
      .where(and(eq(tagDefinitions.tenantId, tenantId), eq(tagDefinitions.tag, tag)))
      .limit(1)

    if (!tagDef) throw new Error(`tag_definition lookup failed for tag="${tag}"`)

    // Phase 4: tag text column dropped — only tag_definition_id is canonical.
    const [created] = await tx
      .insert(patientTags)
      .values({
        tenantId,
        patientId,
        tagDefinitionId: tagDef.id,
        appliedById: userId,
        createdById: userId,
      })
      .returning()

    return created!
  })
}

// ---------------------------------------------------------------------------
// Emergency Contacts
// ---------------------------------------------------------------------------

export async function listEmergencyContacts(patientId: number, tenantId: string) {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) =>
    tx
      .select({
        id: patientEmergencyContacts.id,
        name: patientEmergencyContacts.name,
        // Surface canonical write-shape names (`relation`, `phone`) on read too,
        // so frontend list and write payloads use the same identifiers.
        // DB columns stay `relationship` / `phone_number`.
        relation: patientEmergencyContacts.relationship,
        phone: patientEmergencyContacts.phoneNumber,
        email: patientEmergencyContacts.email,
        isPrimary: patientEmergencyContacts.isPrimary,
        createdAt: patientEmergencyContacts.createdAt,
      })
      .from(patientEmergencyContacts)
      .where(
        and(
          eq(patientEmergencyContacts.patientId, patientId),
          eq(patientEmergencyContacts.tenantId, tenantId),
          isNull(patientEmergencyContacts.deletedAt),
        ),
      )
      .orderBy(desc(patientEmergencyContacts.isPrimary), asc(patientEmergencyContacts.name)),
  )
}

export async function createEmergencyContact(data: {
  patientId: number
  name: string
  relationship: string
  phoneNumber: string
  email?: string
  isPrimary?: boolean
  tenantId: string
  userId: number | null
  branchId: number | null
}) {
  const {
    patientId,
    name,
    relationship,
    phoneNumber,
    email,
    isPrimary,
    tenantId,
    userId,
    branchId,
  } = data

  return withTenantTx({ tenantId, userId: userId ?? 0, branchId }, async (tx) => {
    const [created] = await tx
      .insert(patientEmergencyContacts)
      .values({
        tenantId,
        patientId,
        name,
        relationship,
        phoneNumber,
        email: email ?? null,
        isPrimary: isPrimary ?? false,
        createdById: userId,
      })
      .returning({
        id: patientEmergencyContacts.id,
        name: patientEmergencyContacts.name,
        relation: patientEmergencyContacts.relationship,
        phone: patientEmergencyContacts.phoneNumber,
        email: patientEmergencyContacts.email,
        isPrimary: patientEmergencyContacts.isPrimary,
        createdAt: patientEmergencyContacts.createdAt,
      })
    return created!
  })
}

export async function softDeleteEmergencyContact(
  patientId: number,
  contactId: number,
  tenantId: string,
  userId: number | null,
  branchId: number | null,
) {
  return withTenantTx({ tenantId, userId: userId ?? 0, branchId }, async (tx) => {
    const [updated] = await tx
      .update(patientEmergencyContacts)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(patientEmergencyContacts.id, contactId),
          eq(patientEmergencyContacts.patientId, patientId),
          eq(patientEmergencyContacts.tenantId, tenantId),
          isNull(patientEmergencyContacts.deletedAt),
        ),
      )
      .returning({ id: patientEmergencyContacts.id })
    return updated ?? null
  })
}

// ---------------------------------------------------------------------------
// External Immunizations
// ---------------------------------------------------------------------------

export async function listExternalImmunizations(patientId: number, tenantId: string) {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) =>
    tx
      .select({
        id: patientExternalImmunizations.id,
        vaccineName: patientExternalImmunizations.vaccineName,
        cvxCode: patientExternalImmunizations.cvxCode,
        manufacturer: patientExternalImmunizations.manufacturer,
        lotNumber: patientExternalImmunizations.lotNumber,
        administeredDate: patientExternalImmunizations.administeredDate,
        administeredDatePrecision: patientExternalImmunizations.administeredDatePrecision,
        administeredAtFacility: patientExternalImmunizations.administeredAtFacility,
        doseNumberInSeries: patientExternalImmunizations.doseNumberInSeries,
        source: patientExternalImmunizations.source,
        verifiedAt: patientExternalImmunizations.verifiedAt,
        verifiedByDisplayId: users.displayId,
        verifiedByFirstName: users.firstName,
        verifiedByLastName: users.lastName,
        verifiedByLicenseNumber: users.licenseNumber,
        createdAt: patientExternalImmunizations.createdAt,
      })
      .from(patientExternalImmunizations)
      .leftJoin(users, eq(patientExternalImmunizations.verifiedById, users.id))
      .where(
        and(
          eq(patientExternalImmunizations.patientId, patientId),
          eq(patientExternalImmunizations.tenantId, tenantId),
          isNull(patientExternalImmunizations.deletedAt),
        ),
      )
      .orderBy(
        sql`${patientExternalImmunizations.administeredDate} DESC NULLS LAST`,
        desc(patientExternalImmunizations.createdAt),
      )
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          vaccineName: row.vaccineName,
          cvxCode: row.cvxCode,
          manufacturer: row.manufacturer,
          lotNumber: row.lotNumber,
          administeredDate: row.administeredDate,
          administeredDatePrecision: row.administeredDatePrecision,
          administeredAtFacility: row.administeredAtFacility,
          doseNumberInSeries: row.doseNumberInSeries,
          source: row.source,
          verifiedAt: row.verifiedAt,
          verifiedBy: row.verifiedByDisplayId
            ? {
                displayId: row.verifiedByDisplayId,
                fullName: `${row.verifiedByFirstName ?? ''} ${row.verifiedByLastName ?? ''}`.trim(),
                licenseNumber: row.verifiedByLicenseNumber,
              }
            : null,
          createdAt: row.createdAt,
        })),
      ),
  )
}

export async function createExternalImmunization(data: {
  patientId: number
  vaccineName: string
  cvxCode?: string
  manufacturer?: string
  lotNumber?: string
  administeredDate: string
  administeredAtFacility?: string
  doseNumberInSeries?: number
  source: string
  tenantId: string
  userId: number | null
  branchId: number | null
}) {
  const {
    patientId,
    vaccineName,
    cvxCode,
    manufacturer,
    lotNumber,
    administeredDate,
    administeredAtFacility,
    doseNumberInSeries,
    source,
    tenantId,
    userId,
    branchId,
  } = data

  return withTenantTx({ tenantId, userId: userId ?? 0, branchId }, async (tx) => {
    const [created] = await tx
      .insert(patientExternalImmunizations)
      .values({
        tenantId,
        patientId,
        vaccineName,
        cvxCode: cvxCode ?? null,
        manufacturer: manufacturer ?? null,
        lotNumber: lotNumber ?? null,
        administeredDate,
        administeredDatePrecision: 'Exact',
        administeredAtFacility: administeredAtFacility ?? null,
        doseNumberInSeries: doseNumberInSeries ?? null,
        source,
        createdById: userId,
      })
      .returning({
        id: patientExternalImmunizations.id,
        vaccineName: patientExternalImmunizations.vaccineName,
        cvxCode: patientExternalImmunizations.cvxCode,
        manufacturer: patientExternalImmunizations.manufacturer,
        lotNumber: patientExternalImmunizations.lotNumber,
        administeredDate: patientExternalImmunizations.administeredDate,
        administeredDatePrecision: patientExternalImmunizations.administeredDatePrecision,
        administeredAtFacility: patientExternalImmunizations.administeredAtFacility,
        doseNumberInSeries: patientExternalImmunizations.doseNumberInSeries,
        source: patientExternalImmunizations.source,
        verifiedAt: patientExternalImmunizations.verifiedAt,
        createdAt: patientExternalImmunizations.createdAt,
      })
    return { ...created!, verifiedBy: null }
  })
}

export type VerifyExternalImmunizationResult =
  | {
      ok: true
      immunization: Awaited<ReturnType<typeof listExternalImmunizations>>[number]
    }
  | { ok: false; code: 'NOT_FOUND' | 'ALREADY_VERIFIED' }

export async function verifyExternalImmunization(opts: {
  patientId: number
  immunizationId: number
  tenantId: string
  branchId: number | null
  sessionUserId: number
  reviewerUserId: number
}): Promise<VerifyExternalImmunizationResult> {
  return withTenantTx(
    {
      tenantId: opts.tenantId,
      userId: opts.sessionUserId,
      branchId: opts.branchId,
    },
    async (tx) => {
      const [verified] = await tx
        .update(patientExternalImmunizations)
        .set({
          verifiedById: opts.reviewerUserId,
          verifiedAt: new Date(),
          updatedAt: new Date(),
          rowVersion: sql`${patientExternalImmunizations.rowVersion} + 1`,
        })
        .where(
          and(
            eq(patientExternalImmunizations.id, opts.immunizationId),
            eq(patientExternalImmunizations.patientId, opts.patientId),
            eq(patientExternalImmunizations.tenantId, opts.tenantId),
            isNull(patientExternalImmunizations.deletedAt),
            isNull(patientExternalImmunizations.verifiedAt),
          ),
        )
        .returning({
          id: patientExternalImmunizations.id,
          vaccineName: patientExternalImmunizations.vaccineName,
          cvxCode: patientExternalImmunizations.cvxCode,
          manufacturer: patientExternalImmunizations.manufacturer,
          lotNumber: patientExternalImmunizations.lotNumber,
          administeredDate: patientExternalImmunizations.administeredDate,
          administeredDatePrecision: patientExternalImmunizations.administeredDatePrecision,
          administeredAtFacility: patientExternalImmunizations.administeredAtFacility,
          doseNumberInSeries: patientExternalImmunizations.doseNumberInSeries,
          source: patientExternalImmunizations.source,
          verifiedAt: patientExternalImmunizations.verifiedAt,
          createdAt: patientExternalImmunizations.createdAt,
        })
      if (!verified) {
        const [existing] = await tx
          .select({ verifiedAt: patientExternalImmunizations.verifiedAt })
          .from(patientExternalImmunizations)
          .where(
            and(
              eq(patientExternalImmunizations.id, opts.immunizationId),
              eq(patientExternalImmunizations.patientId, opts.patientId),
              eq(patientExternalImmunizations.tenantId, opts.tenantId),
              isNull(patientExternalImmunizations.deletedAt),
            ),
          )
          .limit(1)
        return existing?.verifiedAt
          ? { ok: false, code: 'ALREADY_VERIFIED' }
          : { ok: false, code: 'NOT_FOUND' }
      }

      const [reviewer] = await tx
        .select({
          displayId: users.displayId,
          firstName: users.firstName,
          lastName: users.lastName,
          licenseNumber: users.licenseNumber,
        })
        .from(users)
        .where(and(eq(users.tenantId, opts.tenantId), eq(users.id, opts.reviewerUserId)))
        .limit(1)

      return {
        ok: true,
        immunization: {
          ...verified,
          verifiedBy: reviewer
            ? {
                displayId: reviewer.displayId,
                fullName: `${reviewer.firstName} ${reviewer.lastName}`.trim(),
                licenseNumber: reviewer.licenseNumber,
              }
            : null,
        },
      }
    },
  )
}

// ---------------------------------------------------------------------------
// Patient Allergies
// ---------------------------------------------------------------------------

/**
 * @param isCrossBranch  Cross-Branch PHI RFC Tier-2 masking (see
 *   isCrossBranchPatient/maskAllergyRow doc comments above). Defaults to
 *   false: callers with no branch context (system reads, break-glass's own
 *   full-detail reveal) get the unmasked rows.
 */
export async function listPatientAllergies(
  patientId: number,
  tenantId: string,
  isCrossBranch = false,
) {
  const rows = await withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) =>
    tx
      .select({
        id: patientAllergies.id,
        allergen: patientAllergies.allergen,
        allergenCode: patientAllergies.allergenCode,
        reaction: patientAllergies.reaction,
        severity: patientAllergies.severity,
        onsetDate: patientAllergies.onsetDate,
        source: patientAllergies.source,
        notes: patientAllergies.notes,
        resolvedAt: patientAllergies.resolvedAt,
      })
      .from(patientAllergies)
      .where(
        and(
          eq(patientAllergies.patientId, patientId),
          eq(patientAllergies.tenantId, tenantId),
          isNull(patientAllergies.deletedAt),
        ),
      )
      .orderBy(asc(patientAllergies.allergen)),
  )
  return isCrossBranch ? rows.map(maskAllergyRow) : rows
}

export async function createPatientAllergy(data: {
  patientId: number
  allergen: string
  allergenCode?: string
  reaction?: string
  severity?: string
  onsetDate?: string
  source?: string
  notes?: string
  tenantId: string
  userId: number | null
  branchId: number | null
}) {
  const { patientId, tenantId, userId, branchId, ...rest } = data

  return withTenantTx({ tenantId, userId: userId ?? 0, branchId }, async (tx) => {
    const [created] = await tx
      .insert(patientAllergies)
      .values({
        tenantId,
        patientId,
        allergen: rest.allergen,
        allergenCode: rest.allergenCode ?? null,
        reaction: rest.reaction ?? null,
        severity: rest.severity ?? null,
        onsetDate: rest.onsetDate ?? null,
        source: rest.source ?? 'PatientReported',
        notes: rest.notes ?? null,
        recordedById: userId,
        createdById: userId,
      })
      .returning({
        id: patientAllergies.id,
        allergen: patientAllergies.allergen,
        allergenCode: patientAllergies.allergenCode,
        reaction: patientAllergies.reaction,
        severity: patientAllergies.severity,
        onsetDate: patientAllergies.onsetDate,
        source: patientAllergies.source,
        notes: patientAllergies.notes,
        resolvedAt: patientAllergies.resolvedAt,
      })
    return created!
  })
}

export async function updatePatientAllergy(data: {
  patientId: number
  allergyId: number
  allergen?: string
  allergenCode?: string
  reaction?: string
  severity?: string
  onsetDate?: string
  source?: string
  notes?: string
  resolvedAt?: string | null
  tenantId: string
  userId: number | null
  branchId: number | null
}) {
  const { patientId, allergyId, tenantId, userId, branchId, ...rest } = data

  return withTenantTx({ tenantId, userId: userId ?? 0, branchId }, async (tx) => {
    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (rest.allergen !== undefined) updates['allergen'] = rest.allergen
    if (rest.allergenCode !== undefined) updates['allergenCode'] = rest.allergenCode || null
    if (rest.reaction !== undefined) updates['reaction'] = rest.reaction || null
    if (rest.severity !== undefined) updates['severity'] = rest.severity || null
    if (rest.onsetDate !== undefined) updates['onsetDate'] = rest.onsetDate || null
    if (rest.source !== undefined) updates['source'] = rest.source
    if (rest.notes !== undefined) updates['notes'] = rest.notes || null
    if (rest.resolvedAt !== undefined) {
      updates['resolvedAt'] = rest.resolvedAt ? new Date(rest.resolvedAt) : null
    }

    const [updated] = await tx
      .update(patientAllergies)
      .set(updates)
      .where(
        and(
          eq(patientAllergies.id, allergyId),
          eq(patientAllergies.patientId, patientId),
          eq(patientAllergies.tenantId, tenantId),
          isNull(patientAllergies.deletedAt),
        ),
      )
      .returning({
        id: patientAllergies.id,
        allergen: patientAllergies.allergen,
        allergenCode: patientAllergies.allergenCode,
        reaction: patientAllergies.reaction,
        severity: patientAllergies.severity,
        onsetDate: patientAllergies.onsetDate,
        source: patientAllergies.source,
        notes: patientAllergies.notes,
        resolvedAt: patientAllergies.resolvedAt,
      })
    return updated ?? null
  })
}

export async function softDeletePatientAllergy(
  patientId: number,
  allergyId: number,
  tenantId: string,
  userId: number | null,
  branchId: number | null,
) {
  return withTenantTx({ tenantId, userId: userId ?? 0, branchId }, async (tx) => {
    const [deleted] = await tx
      .update(patientAllergies)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(patientAllergies.id, allergyId),
          eq(patientAllergies.patientId, patientId),
          eq(patientAllergies.tenantId, tenantId),
          isNull(patientAllergies.deletedAt),
        ),
      )
      .returning({ id: patientAllergies.id })
    return deleted ?? null
  })
}

// ---------------------------------------------------------------------------
// Patient Conditions
// ---------------------------------------------------------------------------

/**
 * @param isCrossBranch  Cross-Branch PHI RFC Tier-2 masking (see
 *   isCrossBranchPatient/maskConditionRow doc comments above). Defaults to
 *   false: callers with no branch context (system reads, break-glass's own
 *   full-detail reveal) get the unmasked rows.
 */
export async function listPatientConditions(
  patientId: number,
  tenantId: string,
  isCrossBranch = false,
) {
  const rows = await withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) =>
    tx
      .select({
        id: patientConditions.id,
        conditionName: patientConditions.conditionName,
        icd10Code: patientConditions.icd10Code,
        status: patientConditions.status,
        onsetDate: patientConditions.onsetDate,
        resolvedDate: patientConditions.resolvedDate,
        notes: patientConditions.notes,
      })
      .from(patientConditions)
      .where(
        and(
          eq(patientConditions.patientId, patientId),
          eq(patientConditions.tenantId, tenantId),
          isNull(patientConditions.deletedAt),
        ),
      )
      .orderBy(asc(patientConditions.conditionName)),
  )
  return isCrossBranch ? rows.map(maskConditionRow) : rows
}

export async function createPatientCondition(data: {
  patientId: number
  conditionName: string
  icd10Code?: string
  status?: string
  onsetDate?: string
  notes?: string
  tenantId: string
  userId: number | null
  branchId: number | null
}) {
  const { patientId, tenantId, userId, branchId, ...rest } = data

  return withTenantTx({ tenantId, userId: userId ?? 0, branchId }, async (tx) => {
    const [created] = await tx
      .insert(patientConditions)
      .values({
        tenantId,
        patientId,
        conditionName: rest.conditionName,
        icd10Code: rest.icd10Code ?? null,
        status: rest.status ?? 'Active',
        onsetDate: rest.onsetDate ?? null,
        notes: rest.notes ?? null,
        recordedById: userId,
        createdById: userId,
      })
      .returning({
        id: patientConditions.id,
        conditionName: patientConditions.conditionName,
        icd10Code: patientConditions.icd10Code,
        status: patientConditions.status,
        onsetDate: patientConditions.onsetDate,
        resolvedDate: patientConditions.resolvedDate,
        notes: patientConditions.notes,
      })
    return created!
  })
}

export async function updatePatientCondition(data: {
  patientId: number
  conditionId: number
  conditionName?: string
  icd10Code?: string
  status?: string
  onsetDate?: string
  notes?: string
  resolvedDate?: string | null
  tenantId: string
  userId: number | null
  branchId: number | null
}) {
  const { patientId, conditionId, tenantId, userId, branchId, ...rest } = data

  return withTenantTx({ tenantId, userId: userId ?? 0, branchId }, async (tx) => {
    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (rest.conditionName !== undefined) updates['conditionName'] = rest.conditionName
    if (rest.icd10Code !== undefined) updates['icd10Code'] = rest.icd10Code || null
    if (rest.status !== undefined) updates['status'] = rest.status
    if (rest.onsetDate !== undefined) updates['onsetDate'] = rest.onsetDate || null
    if (rest.notes !== undefined) updates['notes'] = rest.notes || null
    if (rest.resolvedDate !== undefined) updates['resolvedDate'] = rest.resolvedDate || null

    const [updated] = await tx
      .update(patientConditions)
      .set(updates)
      .where(
        and(
          eq(patientConditions.id, conditionId),
          eq(patientConditions.patientId, patientId),
          eq(patientConditions.tenantId, tenantId),
          isNull(patientConditions.deletedAt),
        ),
      )
      .returning({
        id: patientConditions.id,
        conditionName: patientConditions.conditionName,
        icd10Code: patientConditions.icd10Code,
        status: patientConditions.status,
        onsetDate: patientConditions.onsetDate,
        resolvedDate: patientConditions.resolvedDate,
        notes: patientConditions.notes,
      })
    return updated ?? null
  })
}

export async function softDeletePatientCondition(
  patientId: number,
  conditionId: number,
  tenantId: string,
  userId: number | null,
  branchId: number | null,
) {
  return withTenantTx({ tenantId, userId: userId ?? 0, branchId }, async (tx) => {
    const [deleted] = await tx
      .update(patientConditions)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(patientConditions.id, conditionId),
          eq(patientConditions.patientId, patientId),
          eq(patientConditions.tenantId, tenantId),
          isNull(patientConditions.deletedAt),
        ),
      )
      .returning({ id: patientConditions.id })
    return deleted ?? null
  })
}

// ---------------------------------------------------------------------------
// Consents (read from new `consents` table — schema v2 Phase 2)
// ---------------------------------------------------------------------------

export async function listConsents(patientId: number, tenantId: string) {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) =>
    tx
      .select({
        id: consents.id,
        encounterId: consents.encounterId,
        consentType: consents.consentType,
        scope: consents.scope,
        scopeRefType: consents.scopeRefType,
        scopeRefId: consents.scopeRefId,
        consenterRelation: consents.consenterRelation,
        consenterName: consents.consenterName,
        visProvided: consents.visProvided,
        visVersion: consents.visVersion,
        visDate: consents.visDate,
        visLanguage: consents.visLanguage,
        obtainedAt: consents.obtainedAt,
        consentLanguage: consents.consentLanguage,
        revokedAt: consents.revokedAt,
        revocationReason: consents.revocationReason,
        notes: consents.notes,
        createdAt: consents.createdAt,
      })
      .from(consents)
      .where(
        and(
          eq(consents.patientId, patientId),
          eq(consents.tenantId, tenantId),
          isNull(consents.deletedAt),
        ),
      )
      .orderBy(desc(consents.obtainedAt)),
  )
}

// ---------------------------------------------------------------------------
// PEP Progress
// ---------------------------------------------------------------------------

export type PepProgressDose = {
  doseNumber: number
  status: 'completed' | 'pending' | 'missed'
  scheduledDate: string | null
  administeredAt: string | null
  label: string
}

export type PepProgressResult = {
  status: 'not-started' | 'in-progress' | 'completed' | 'missed'
  doses: PepProgressDose[]
  completedDoses: number
  totalDoses: number
  indication: string | null
}

export async function getPepProgress(
  patientId: number,
  ctx: { tenantId: string; userId: number | null; branchId: number | null },
): Promise<PepProgressResult> {
  return withTenantTx(
    { tenantId: ctx.tenantId, userId: ctx.userId ?? 0, branchId: ctx.branchId },
    async (tx) => {
      const orders = await tx
        .select({
          doseNumber: clinicalOrders.doseNumber,
          indication: clinicalOrders.indication,
          completedAt: clinicalOrders.completedAt,
          currentScheduledDate: clinicalOrders.currentScheduledDate,
        })
        .from(clinicalOrders)
        .where(
          and(
            eq(clinicalOrders.patientId, patientId),
            eq(clinicalOrders.tenantId, ctx.tenantId),
            isNull(clinicalOrders.deletedAt),
          ),
        )

      const pepOrders = orders.filter((o) => o.indication === 'Post-Exposure Prophylaxis')
      const prepOrders = orders.filter((o) => o.indication === 'Pre-Exposure Prophylaxis')
      const isPep = pepOrders.length > 0
      const targetOrders = isPep ? pepOrders : prepOrders
      const labels = isPep ? PEP_DOSE_LABELS : PREP_DOSE_LABELS
      const totalDoses = labels.length
      const indication = isPep
        ? 'Post-Exposure Prophylaxis'
        : prepOrders.length > 0
          ? 'Pre-Exposure Prophylaxis'
          : null

      const doseMap = new Map<number, (typeof targetOrders)[number]>()
      targetOrders.forEach((o) => {
        if (o.doseNumber != null) doseMap.set(o.doseNumber, o)
      })

      const now = new Date()
      const doses: PepProgressDose[] = Array.from({ length: totalDoses }, (_, i) => {
        // doseNumber is 1-based (idx+1 from standing_orders/db.ts CLIN-2 fix).
        // i runs 0..N-1, so doseMap key must be i+1.
        const order = doseMap.get(i + 1)
        let status: 'completed' | 'pending' | 'missed'

        if (order?.completedAt) {
          status = 'completed'
        } else if (order?.currentScheduledDate && new Date(order.currentScheduledDate) < now) {
          status = 'missed'
        } else {
          status = 'pending'
        }

        return {
          doseNumber: i + 1,
          status,
          scheduledDate: order?.currentScheduledDate?.toISOString() ?? null,
          administeredAt: order?.completedAt?.toISOString() ?? null,
          label: labels[i] ?? `Dose ${i + 1}`,
        }
      })

      const completedDoses = doses.filter((d) => d.status === 'completed').length

      let overallStatus: 'not-started' | 'in-progress' | 'completed' | 'missed'
      if (!indication || targetOrders.length === 0) {
        overallStatus = 'not-started'
      } else if (completedDoses === totalDoses) {
        overallStatus = 'completed'
      } else if (completedDoses === 0) {
        overallStatus = 'not-started'
      } else if (doses.some((d) => d.status === 'missed')) {
        overallStatus = 'missed'
      } else {
        overallStatus = 'in-progress'
      }

      return {
        status: overallStatus,
        doses,
        completedDoses,
        totalDoses,
        indication,
      }
    },
  )
}

/**
 * getPatientDemographicProjection
 *
 * Returns the Tier-1 cross-branch demographic projection for a single patient
 * by querying the `patients_demographic_v` view. The view aggregates safe
 * cross-branch columns (demographics + allergies + active conditions + DPA
 * consent status) and inherits `tenant_id` RLS from the underlying `patients`
 * table — cross-tenant leakage is impossible.
 *
 * This function does NOT use withTenantTx because it is a read-only SELECT
 * from a view (no audited writes). The caller's db.transaction / RLS context
 * established upstream is sufficient.
 *
 * @param displayIdStr  Patient display_id (PAT_XXXXXXXX)
 * @param tenantId      Tenant slug from req.tenant.id
 */
export async function getPatientDemographicProjection(
  displayIdStr: string,
  tenantId: string,
): Promise<PatientDemographicRow | null> {
  // The view has no Drizzle schema declaration (views are DDL-only).
  // Use a raw parameterized query to SELECT from it. LEFT JOIN branches for
  // the home branch's display_id: the view only carries the bigint FK, but
  // break-glass (POST /:id/break-glass) needs the display_id to resolve the
  // target branch server-side. See the homeBranchDisplayId doc comment above.
  const rows = await withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) =>
    tx.execute(
      sql`
        SELECT
          v.id,
          v.display_id          AS "displayId",
          v.tenant_id           AS "tenantId",
          v.home_branch_id      AS "homeBranchId",
          b.display_id          AS "homeBranchDisplayId",
          v.mrn,
          v.first_name          AS "firstName",
          v.middle_name         AS "middleName",
          v.last_name           AS "lastName",
          v.suffix,
          v.date_of_birth       AS "dateOfBirth",
          v.sex,
          v.primary_phone       AS "primaryPhone",
          v.is_active           AS "isActive",
          v.allergies,
          v.active_conditions       AS "activeConditions",
          v.dpa_consent_active      AS "dpaConsentActive",
          v.active_courses          AS "activeCourses",
          v.recent_doses            AS "recentDoses",
          v.active_recalls          AS "activeRecalls",
          v.recent_critical_lab_results AS "recentCriticalLabResults",
          v.created_at              AS "createdAt",
          v.updated_at              AS "updatedAt"
        FROM patients_demographic_v v
        LEFT JOIN branches b ON b.id = v.home_branch_id AND b.tenant_id = v.tenant_id
        WHERE v.tenant_id = ${tenantId}
          AND v.display_id = ${displayIdStr}
        LIMIT 1
      `,
    ),
  )

  if (rows.length === 0) return null

  const row = rows[0] as Record<string, unknown>
  return {
    id: row['id'] as number,
    displayId: row['displayId'] as string,
    tenantId: row['tenantId'] as string,
    homeBranchId: (row['homeBranchId'] as number | null) ?? null,
    homeBranchDisplayId: (row['homeBranchDisplayId'] as string | null) ?? null,
    mrn: row['mrn'] as string,
    firstName: row['firstName'] as string,
    middleName: (row['middleName'] as string | null) ?? null,
    lastName: row['lastName'] as string,
    suffix: (row['suffix'] as string | null) ?? null,
    dateOfBirth: row['dateOfBirth'] ? String(row['dateOfBirth']) : null,
    sex: (row['sex'] as string | null) ?? null,
    primaryPhone: (row['primaryPhone'] as string | null) ?? null,
    isActive: row['isActive'] as boolean,
    allergies: (row['allergies'] as PatientDemographicRow['allergies']) ?? [],
    activeConditions: (row['activeConditions'] as PatientDemographicRow['activeConditions']) ?? [],
    dpaConsentActive: row['dpaConsentActive'] as boolean,
    activeCourses: (row['activeCourses'] as PatientDemographicRow['activeCourses']) ?? [],
    recentDoses: (row['recentDoses'] as PatientDemographicRow['recentDoses']) ?? [],
    activeRecalls: (row['activeRecalls'] as PatientDemographicRow['activeRecalls']) ?? [],
    recentCriticalLabResults:
      (row['recentCriticalLabResults'] as PatientDemographicRow['recentCriticalLabResults']) ?? [],
    createdAt: row['createdAt'] as Date,
    updatedAt: row['updatedAt'] as Date,
  }
}

// ---------------------------------------------------------------------------
// Break-glass cross-branch chart — Cross-Branch PHI RFC Step 4c
// ---------------------------------------------------------------------------

export type BreakGlassEncounterRow = {
  id: string
  branchId: number | null
  branch: { displayId: string; name: string } | null
  provider: {
    displayId: string
    firstName: string
    lastName: string
    licenseNumber: string | null
  } | null
  specialty: string
  status: string
  chiefComplaint: string | null
  visitNo: number | null
  startedAt: string
  completedAt: string | null
}

export type BreakGlassTransactionRow = {
  id: string
  branchId: number | null
  status: string
  netAmount: string
  amountPaid: string
  amountOutstanding: string
  receiptNo: string | null
  createdAt: string
}

export type BreakGlassChart = {
  /** CBA_… grant display id — surfaced to the frontend sticky toast. */
  grantId: string
  patientDisplayId: string
  homeBranchId: number | null
  targetBranchId: number
  encounters: BreakGlassEncounterRow[]
  transactions: BreakGlassTransactionRow[]
  /**
   * Full (unmasked) allergy/condition rows: the Tier-2 masking applied by
   * listPatientAllergies/listPatientConditions is for the ordinary
   * sub-resource GET; a successful break-glass reveal is the explicit,
   * audited Tier-3 access that the masking exists to gate, so it returns the
   * real detail here rather than the nulled placeholder rows.
   */
  allergies: Awaited<ReturnType<typeof listPatientAllergies>>
  conditions: Awaited<ReturnType<typeof listPatientConditions>>
}

export type BreakGlassResult =
  | { ok: true; chart: BreakGlassChart }
  | { ok: false; code: 'PATIENT_NOT_FOUND' | 'BRANCH_NOT_FOUND' }

/**
 * Perform a break-glass cross-branch reveal for a single patient.
 *
 * Resolves the patient + target-branch display ids to bigints (tenant-scoped),
 * then opens a `withTenantTx` carrying the typed `crossBranchRead` intent. That
 * forces `app.cross_branch_read='true'` (so the branch_isolation RLS USING
 * clause reveals rows at the target branch) and emits the CROSS_BRANCH_ACCESS
 * audit row + the persistent grant row BEFORE the read runs.
 *
 * The read returns the patient's encounters + transactions across branches
 * (Tier-2 cross-branch data), plus the full (unmasked) allergy/condition rows
 * that listPatientAllergies/listPatientConditions would otherwise mask for a
 * cross-branch caller. The full Tier-1/Tier-2 frontend split (recent doses,
 * recalls, critical labs) lands in RFC Step 8. The reveal is read-only: the
 * branch_isolation WITH CHECK never honors cross_branch_read (Step 7a), and
 * separately, allergy/condition WRITES stay branch-gated at the app layer
 * even after a reveal (routes.ts), since those tables carry no branch_id for
 * the DB to enforce it on their behalf.
 *
 * @param sourceBranchId  the caller's clocked-in branch (recorded on the grant)
 */
export async function breakGlassPatientChart(opts: {
  patientDisplayId: string
  targetBranchDisplayId: string
  reasonCategory: CrossBranchReason
  reasonDetail: string
  tenantId: string
  userId: number
  sourceBranchId: number | null
  correlationId?: string
}): Promise<BreakGlassResult> {
  // Resolve patient + home branch (tenant-scoped, defense-in-depth WHERE).
  const patient = await withTenantTx(
    { tenantId: opts.tenantId, userId: 0, branchId: null },
    async (tx) => {
      const [row] = await tx
        .select({ id: patients.id, homeBranchId: patients.homeBranchId })
        .from(patients)
        .where(
          and(
            eq(patients.tenantId, opts.tenantId),
            eq(patients.displayId, opts.patientDisplayId),
            isNull(patients.deletedAt),
          ),
        )
        .limit(1)
      return row ?? null
    },
  )
  if (!patient) return { ok: false, code: 'PATIENT_NOT_FOUND' }

  // Resolve target branch display_id → bigint (tenant-scoped).
  const targetBranch = await withTenantTx(
    { tenantId: opts.tenantId, userId: 0, branchId: null },
    async (tx) => {
      const [row] = await tx
        .select({ id: branches.id })
        .from(branches)
        .where(
          and(
            eq(branches.tenantId, opts.tenantId),
            eq(branches.displayId, opts.targetBranchDisplayId),
          ),
        )
        .limit(1)
      return row ?? null
    },
  )
  if (!targetBranch) return { ok: false, code: 'BRANCH_NOT_FOUND' }

  const patientId = patient.id
  const targetBranchId = targetBranch.id

  // Break-glass: crossBranchRead emits the audit + grant, then reveals.
  // Allergies/conditions run alongside it: `patient_allergies`/
  // `patient_conditions` carry no branch_id column at all (they are
  // tenant-wide clinical facts, not branch-scoped like encounters/
  // transactions), so they need no crossBranchRead context to read in full;
  // listPatientAllergies/listPatientConditions with isCrossBranch left at its
  // default (false) already returns the unmasked rows for the Tier-3 reveal.
  const [chart, allergies, conditions] = await Promise.all([
    withTenantTx(
      {
        tenantId: opts.tenantId,
        userId: opts.userId,
        branchId: opts.sourceBranchId,
        crossBranchRead: {
          reason: opts.reasonCategory,
          reasonDetail: opts.reasonDetail,
          patientId,
          targetBranchId,
          correlationId: opts.correlationId,
        },
      },
      async (tx) => {
        const [encounterRows, transactionRows] = await Promise.all([
          tx
            .select({
              id: encounters.displayId,
              branchId: encounters.branchId,
              branchDisplayId: branches.displayId,
              branchName: branches.name,
              providerDisplayId: users.displayId,
              providerFirstName: users.firstName,
              providerLastName: users.lastName,
              providerLicenseNumber: users.licenseNumber,
              specialty: encounters.specialty,
              status: encounters.status,
              chiefComplaint: encounters.chiefComplaint,
              visitNo: encounters.visitNo,
              startedAt: encounters.startedAt,
              completedAt: encounters.completedAt,
            })
            .from(encounters)
            .innerJoin(branches, eq(encounters.branchId, branches.id))
            .leftJoin(users, eq(encounters.providerId, users.id))
            .where(
              and(
                eq(encounters.tenantId, opts.tenantId),
                eq(encounters.patientId, patientId),
                isNull(encounters.deletedAt),
              ),
            )
            .orderBy(desc(encounters.startedAt)),
          tx
            .select({
              id: transactions.displayId,
              branchId: transactions.branchId,
              status: transactions.status,
              netAmount: transactions.netAmount,
              amountPaid: transactions.amountPaid,
              amountOutstanding: transactions.amountOutstanding,
              receiptNo: transactions.receiptNo,
              createdAt: transactions.createdAt,
            })
            .from(transactions)
            .where(
              and(eq(transactions.tenantId, opts.tenantId), eq(transactions.patientId, patientId)),
            )
            .orderBy(desc(transactions.createdAt)),
        ])

        return {
          encounters: encounterRows.map((e) => ({
            id: e.id,
            branchId: e.branchId,
            branch: e.branchDisplayId ? { displayId: e.branchDisplayId, name: e.branchName } : null,
            provider: e.providerDisplayId
              ? {
                  displayId: e.providerDisplayId,
                  firstName: e.providerFirstName ?? '',
                  lastName: e.providerLastName ?? '',
                  licenseNumber: e.providerLicenseNumber ?? null,
                }
              : null,
            specialty: String(e.specialty),
            status: String(e.status),
            chiefComplaint: e.chiefComplaint ?? null,
            visitNo: e.visitNo ?? null,
            startedAt: e.startedAt.toISOString(),
            completedAt: e.completedAt ? e.completedAt.toISOString() : null,
          })),
          transactions: transactionRows.map((t) => ({
            id: t.id,
            branchId: t.branchId,
            status: String(t.status),
            netAmount: String(t.netAmount),
            amountPaid: String(t.amountPaid),
            amountOutstanding: String(t.amountOutstanding),
            receiptNo: t.receiptNo ?? null,
            createdAt: t.createdAt.toISOString(),
          })),
        }
      },
    ),
    listPatientAllergies(patientId, opts.tenantId),
    listPatientConditions(patientId, opts.tenantId),
  ])

  // Read back the grant display_id for the (tenant, target_branch, patient)
  // tuple. D1: the grant is persistent, so this returns the row whether it was
  // just inserted or pre-existed (ON CONFLICT DO NOTHING).
  const grant = await withTenantTx(
    { tenantId: opts.tenantId, userId: 0, branchId: null },
    async (tx) => {
      const [row] = await tx
        .select({ grantId: crossBranchAccessGrants.displayId })
        .from(crossBranchAccessGrants)
        .where(
          and(
            eq(crossBranchAccessGrants.tenantId, opts.tenantId),
            eq(crossBranchAccessGrants.targetBranchId, targetBranchId),
            eq(crossBranchAccessGrants.patientId, patientId),
          ),
        )
        .limit(1)
      return row ?? null
    },
  )

  return {
    ok: true,
    chart: {
      grantId: grant?.grantId ?? '',
      patientDisplayId: opts.patientDisplayId,
      homeBranchId: patient.homeBranchId ?? null,
      targetBranchId,
      encounters: chart.encounters,
      transactions: chart.transactions,
      allergies,
      conditions,
    },
  }
}
