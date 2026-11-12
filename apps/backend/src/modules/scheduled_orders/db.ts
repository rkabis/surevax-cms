import { and, eq, gte, lt, isNull, sql, asc, desc, inArray, or } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import QRCode from 'qrcode'
import { withTenantTx } from '../../shared/db/withTenantTx.js'
import type { Tx } from '../../shared/db/withTenantTx.js'
import {
  clinicalOrders,
  consents,
  encounters,
  patients,
  serviceCatalog,
  patientStandingOrders,
  standingOrderTemplates,
  standingOrderTemplateItems,
  transactionItems,
  transactions,
  inventoryMovements,
  inventoryLots,
  patientAllergies,
  patientConditions,
  users,
  payerProfiles,
  branches,
  postAdministrationObservations,
} from '../../shared/db/schema.js'
import { displayId } from '../../shared/utils/displayId.js'
import {
  projectDownstream,
  toDownstreamWire,
  clinicCalendarDate,
  clinicDayTimestampWindow,
  upcomingClinicDaysWindow,
  classifyOrderPriority,
  changedDownstreamProjections,
  type DownstreamWire,
} from './dateMath.js'
import { writeScheduleChangeAudit } from './auditWrite.js'
import { deductLot } from '../inventory/fefo.js'
import { eligibleProductIdsSql } from '../inventory/eligibility.js'
import { LifecycleError, resolveAdministeredBrands } from '../transactions/db.js'
import { assertActiveConsent } from '../../shared/utils/consent.js'
import { resolveServicePrice } from '../../shared/lib/pricing.js'
import { auditLog } from '../../shared/utils/auditLog.js'
import { autoCompleteEncounterOnOrderCompletion } from '../encounters/db.js'
import { toCents, fromCents } from '../../shared/utils/money.js'
import {
  composeTextDraftBody,
  maskPhoneNumber,
  buildSmsUri,
  type TextDraftBlockedReason,
} from './textDraft.js'
import {
  classifyObservationState,
  type ObservationOutcome,
  type ObservationState,
} from './observation.js'

// Re-export types used by service.ts
export type { DownstreamProjection, DownstreamWire } from './dateMath.js'

// ── Public types ─────────────────────────────────────────────────────────────

export type ScheduledOrdersFilter =
  | 'all'
  | 'today'
  | 'upcoming'
  | 'missed'
  | 'overdue'
  | 'backfill'
  | 'completed_today'

export type ObservationSummary = {
  id: string
  durationMinutes: number
  observeUntil: string
  outcome: ObservationOutcome | null
  outcomeNotes: string | null
  outcomeRecordedAt: string | null
  outcomeRecordedBy: { displayId: string; fullName: string } | null
  dischargedAt: string | null
  dischargedBy: { displayId: string; fullName: string } | null
  state: ObservationState
}

type ObservationProjection = {
  observationId: string | null
  observationDurationMinutes: number | null
  observeUntil: Date | null
  observationOutcome: string | null
  observationNotes: string | null
  outcomeRecordedAt: Date | null
  outcomeByDisplayId: string | null
  outcomeByFirstName: string | null
  outcomeByLastName: string | null
  dischargedAt: Date | null
  dischargedByDisplayId: string | null
  dischargedByFirstName: string | null
  dischargedByLastName: string | null
}

function observationToWire(
  row: ObservationProjection,
  now = new Date(),
): ObservationSummary | null {
  if (!row.observationId || !row.observeUntil || row.observationDurationMinutes === null)
    return null

  const outcome = row.observationOutcome as ObservationOutcome | null
  return {
    id: row.observationId,
    durationMinutes: row.observationDurationMinutes,
    observeUntil: row.observeUntil.toISOString(),
    outcome,
    outcomeNotes: row.observationNotes,
    outcomeRecordedAt: row.outcomeRecordedAt?.toISOString() ?? null,
    outcomeRecordedBy:
      row.outcomeByDisplayId && row.outcomeByFirstName && row.outcomeByLastName
        ? {
            displayId: row.outcomeByDisplayId,
            fullName: `${row.outcomeByFirstName} ${row.outcomeByLastName}`.trim(),
          }
        : null,
    dischargedAt: row.dischargedAt?.toISOString() ?? null,
    dischargedBy:
      row.dischargedByDisplayId && row.dischargedByFirstName && row.dischargedByLastName
        ? {
            displayId: row.dischargedByDisplayId,
            fullName: `${row.dischargedByFirstName} ${row.dischargedByLastName}`.trim(),
          }
        : null,
    state: classifyObservationState(
      { observeUntil: row.observeUntil, outcome, dischargedAt: row.dischargedAt },
      now,
    ),
  }
}

/**
 * Backfill window — past 3 days unadministered. Clinically bounded recovery
 * lane for ARV PEP late-dose catch-up. Distinct from `overdue` (unbounded);
 * the clinical SOP advises restarting the protocol past ~3 days of lapse, so
 * `backfill` surfaces the still-recoverable subset.
 */
const BACKFILL_WINDOW_DAYS = 3

/**
 * Which doses belong on THIS branch's worklist.
 *
 * A dose is this branch's work when either is true:
 *
 *  - the patient is homed here (or has no home branch, which the rest of the
 *    codebase treats as visible everywhere, see the patients module's
 *    cross-branch masking), or
 *  - the dose's encounter happened here.
 *
 * The second arm is not optional. `clinical_orders` carries no `branch_id`, so
 * an earlier version keyed on the patient's home branch alone, and that hid a
 * visiting patient's dose from the branch actually treating them: a patient
 * homed at another branch who walks in here, gets registered and gets a dose
 * scheduled, would never appear on this branch's queue. Caught by the readiness
 * suite when the seeded TMG-homed patient happened to be the one it registered.
 *
 * Conversely the first arm carries the standing-order case: a dose scheduled
 * for a future date usually has no encounter yet (`encounter_id` is null until
 * it is administered), so home branch is the only signal available for it.
 *
 * Returns `undefined` when the caller has no branch context (platform admin,
 * system read, tenant-wide operational read), which leaves counts tenant-wide.
 * Every query that filters rows MUST use this, and so must every query that
 * counts them, or the KPI strip disagrees with the visible list.
 *
 * Every caller MUST left-join `encounters` on `clinicalOrders.encounterId`,
 * because the encounter arm reads `encounters.branchId` directly. A correlated
 * `EXISTS` in a raw `sql` template was tried first and is the wrong tool here:
 * `${clinicalOrders.encounterId}` renders as a qualified `clinical_orders`
 * reference, which blows up with Postgres 42P01 (`errorMissingRTE`) in the
 * stats query, where the table is aliased `co`. See the correlated-subquery
 * entry in `.claude/rules/patterns.md`. The join is 1:1 (an order has at most
 * one encounter), so it cannot duplicate rows.
 */
function patientBranchCond(branchId: number | null) {
  if (branchId === null) return undefined
  return or(isNull(patients.homeBranchId), eq(patients.homeBranchId, branchId))
}

function branchScopeCond(branchId: number | null) {
  if (branchId === null) return undefined
  return or(
    isNull(patients.homeBranchId),
    eq(patients.homeBranchId, branchId),
    eq(encounters.branchId, branchId),
  )
}

/**
 * Direct-order routes must not turn a display ID into a cross-branch escape
 * hatch for the shared Branch kiosk. The list route already applies this same
 * scope, but detail, timeline, preview, and write routes receive an order ID
 * directly and therefore need an explicit preflight before their tenant-wide
 * read/write helpers run.
 *
 * This intentionally uses the identical home-branch-or-encounter predicate as
 * {@link listScheduledOrders}. A future course dose may have no encounter of
 * its own yet, so the patient's home branch remains the visibility anchor.
 */
export async function canBranchAccessScheduledOrder(opts: {
  tenantId: string
  branchId: number
  id: string
}): Promise<boolean> {
  return withTenantTx(
    { tenantId: opts.tenantId, userId: 0, branchId: opts.branchId },
    async (tx) => {
      const [row] = await tx
        .select({ id: clinicalOrders.id })
        .from(clinicalOrders)
        .leftJoin(
          patientStandingOrders,
          eq(clinicalOrders.patientStandingOrderId, patientStandingOrders.id),
        )
        .leftJoin(patients, eq(patientStandingOrders.patientId, patients.id))
        .leftJoin(encounters, eq(clinicalOrders.encounterId, encounters.id))
        .where(
          and(
            eq(clinicalOrders.tenantId, opts.tenantId),
            eq(clinicalOrders.displayId, opts.id),
            isNull(clinicalOrders.deletedAt),
            branchScopeCond(opts.branchId),
          ),
        )
        .limit(1)
      return row !== undefined
    },
  )
}

export type TimelineEntry = {
  id: string // display_id
  day: number
  scheduledAt: string
  administeredAt: string | null
  state: 'completed' | 'overdue' | 'due' | 'upcoming' | 'cancelled'
  byClinician: string | null
  lotNumber: string | null
  doseSize: string
  note?: string
}

export type AdministerDto = {
  consentBy: 'Patient' | 'Guardian'
  consentObtained: true
  visVersion: string
  visProvided?: boolean
  /** inventory_lots.display_id — the brand the nurse picked. Required. */
  lotId: string
  brandPriceVarianceAcknowledged?: boolean
  /**
   * `USR_…` of the clinician who gave the dose, plus their kiosk PIN. Consumed
   * by `resolveAdministeringClinician` in the service layer, BEFORE the
   * transaction opens: `administerOrderTx` itself never reads these two, it
   * takes the already-resolved `administeredById` bigint instead.
   */
  administeredById?: string | undefined
  attestationPin?: string | undefined
  observationMinutes: number
}

export type AdministerResult = {
  id: string // clinical_order display_id
  status: string
  completedAt: string
  patientId: string | null // patient display_id
  serviceId: string
  lot: { lotId: string; batchNumber: string; expiryDate: string }
  /** Who the dose was recorded under: the PIN-attested clinician, not the login. */
  administeredBy: { displayId: string; fullName: string; licenseNumber: string | null } | null
  downstream: DownstreamWire[]
  observation: ObservationSummary
}

// ── Resolver helpers ──────────────────────────────────────────────────────────

async function resolveClinicalOrderId(
  tx: Tx,
  tenantId: string,
  orderDisplayId: string,
): Promise<number | null> {
  const [row] = await tx
    .select({ id: clinicalOrders.id })
    .from(clinicalOrders)
    .where(and(eq(clinicalOrders.tenantId, tenantId), eq(clinicalOrders.displayId, orderDisplayId)))
    .limit(1)
  return row?.id ?? null
}

// ── List ─────────────────────────────────────────────────────────────────────

export async function listScheduledOrders(opts: {
  tenantId: string
  q?: string
  filter?: ScheduledOrdersFilter
  /** Patient display_id (PAT_…) — scopes the list to one patient's orders. */
  patientId?: string
  /**
   * Caller's session branch (`req.user.branchId`), NEVER a client-supplied
   * param. Null means no branch context (platform admin / tenant-wide
   * operational read) and keeps the old tenant-wide visibility. `clinical_orders`
   * carries no branch_id of its own (encounter_id is frequently null for a
   * standing-order dose not yet administered), so scoping goes through
   * `patients.homeBranchId` instead, using the same convention as the patients
   * module's cross-branch masking. A null homeBranchId means the patient has
   * no fixed home branch and is visible from every branch, matching that
   * convention.
   */
  branchId: number | null
}) {
  const now = new Date()
  const observationOutcomeBy = alias(users, 'list_observation_outcome_by')
  const observationDischargedBy = alias(users, 'list_observation_discharged_by')
  // Scheduled dates are date-only UTC-midnight values. Always construct their
  // bounds from the clinic calendar, never the server process timezone.
  const today = clinicCalendarDate(now)
  const tomorrow = new Date(today)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const upcomingWindow = upcomingClinicDaysWindow(now)

  const conditions = [
    eq(clinicalOrders.tenantId, opts.tenantId),
    isNull(clinicalOrders.deletedAt),
    // Nurse worklist scoping: see branchScopeCond.
    branchScopeCond(opts.branchId),
    sql`${clinicalOrders.status} IN ('Scheduled', 'Pending', 'Completed', 'Missed')`,
  ]

  if (opts.q) {
    const q = `%${opts.q}%`
    conditions.push(
      sql`(${patients.lastName} ILIKE ${q} OR ${patients.firstName} ILIKE ${q} OR ${serviceCatalog.name} ILIKE ${q})`,
    )
  }

  if (opts.patientId) {
    conditions.push(eq(patients.displayId, opts.patientId))
  }

  if (opts.filter === 'today') {
    conditions.push(
      gte(clinicalOrders.currentScheduledDate, today),
      lt(clinicalOrders.currentScheduledDate, tomorrow),
      sql`${clinicalOrders.status} IN ('Scheduled', 'Pending')`,
    )
  } else if (opts.filter === 'upcoming') {
    conditions.push(
      gte(clinicalOrders.currentScheduledDate, upcomingWindow.startsAt),
      lt(clinicalOrders.currentScheduledDate, upcomingWindow.endsBefore),
      sql`${clinicalOrders.status} IN ('Scheduled', 'Pending')`,
    )
  } else if (opts.filter === 'missed') {
    conditions.push(eq(clinicalOrders.status, 'Missed'))
  } else if (opts.filter === 'overdue') {
    // Pending + past date = needs recompute; Scheduled + past date = newly overdue.
    // Both are clinically unresolved and belong in the overdue worklist.
    conditions.push(
      lt(clinicalOrders.currentScheduledDate, today),
      sql`${clinicalOrders.status} IN ('Scheduled', 'Pending')`,
    )
  } else if (opts.filter === 'backfill') {
    // V6/S1 — past N days unadministered (clinically still recoverable).
    const backfillStart = new Date(today)
    backfillStart.setDate(backfillStart.getDate() - BACKFILL_WINDOW_DAYS)
    conditions.push(
      gte(clinicalOrders.currentScheduledDate, backfillStart),
      lt(clinicalOrders.currentScheduledDate, today),
      sql`${clinicalOrders.status} IN ('Scheduled', 'Pending')`,
    )
  } else if (opts.filter === 'completed_today') {
    conditions.push(
      eq(clinicalOrders.status, 'Completed'),
      gte(clinicalOrders.completedAt, today),
      lt(clinicalOrders.completedAt, tomorrow),
    )
  }

  const rows = await withTenantTx(
    { tenantId: opts.tenantId, userId: 0, branchId: null },
    async (tx) =>
      tx
        .select({
          // Surface display_id as the public `id`.
          id: clinicalOrders.displayId,
          patientFirstName: patients.firstName,
          patientLastName: patients.lastName,
          patientMrn: patients.mrn,
          patientDateOfBirth: patients.dateOfBirth,
          contactNumber: patients.contactNumber,
          // Messaging-consent flag, distinct from the clinical `consents`
          // table. Lets the "Text patient" action render disabled with a
          // reason straight from the worklist row (no per-row round trip to
          // /text-draft just to learn it's blocked).
          smsOptIn: patients.smsOptIn,
          serviceName: serviceCatalog.name,
          doseNumber: clinicalOrders.doseNumber,
          scheduledDate: clinicalOrders.currentScheduledDate,
          status: clinicalOrders.status,
          standingOrderName: standingOrderTemplates.name,
          indication: clinicalOrders.indication,
          totalDoses: sql<number>`(SELECT COUNT(*)::int FROM ${standingOrderTemplateItems} WHERE ${standingOrderTemplateItems.templateId} = ${standingOrderTemplates.id})`,
          // Resolve paymentStatus per order: prefer 'Paid' over any other linked tx status.
          paymentStatus: sql<'Draft' | 'Pending' | 'Paid' | 'Voided' | 'Refunded' | null>`(
          SELECT CASE
            WHEN BOOL_OR(${transactions.status} = 'Paid') THEN 'Paid'
            ELSE MIN(${transactions.status})
          END
          FROM ${transactionItems}
          INNER JOIN ${transactions} ON ${transactionItems.transactionId} = ${transactions.id}
          WHERE ${transactionItems.clinicalOrderId} = ${clinicalOrders.id}
            AND ${transactionItems.tenantId} = ${clinicalOrders.tenantId}
        )`,
          // True when an earlier dose in the same course is still unresolved (Missed or
          // past-due Scheduled). Today-lane orders with this flag are not yet administrable.
          // SCHED-1: co2.dose_number < NULL is never true in SQL (NULL comparison always
          // yields NULL). Guard with COALESCE so NULL doseNumber rows are treated as dose 1;
          // the comparison then fires correctly for multi-dose courses.
          hasBlockingOverdue: sql<boolean>`EXISTS (
          SELECT 1 FROM clinical_orders co2
          WHERE co2.patient_standing_order_id = ${clinicalOrders.patientStandingOrderId}
            AND COALESCE(co2.dose_number, 1) < COALESCE(${clinicalOrders.doseNumber}, 1)
            AND co2.deleted_at IS NULL
            AND co2.tenant_id = ${clinicalOrders.tenantId}
            AND (
              co2.status = 'Missed'
              OR (co2.status IN ('Scheduled', 'Pending') AND co2.current_scheduled_date < ${today.toISOString()})
            )
        )`,
          observationId: postAdministrationObservations.displayId,
          observationDurationMinutes: postAdministrationObservations.durationMinutes,
          observeUntil: postAdministrationObservations.observeUntil,
          observationOutcome: postAdministrationObservations.outcome,
          observationNotes: postAdministrationObservations.outcomeNotes,
          outcomeRecordedAt: postAdministrationObservations.outcomeRecordedAt,
          outcomeByDisplayId: observationOutcomeBy.displayId,
          outcomeByFirstName: observationOutcomeBy.firstName,
          outcomeByLastName: observationOutcomeBy.lastName,
          dischargedAt: postAdministrationObservations.dischargedAt,
          dischargedByDisplayId: observationDischargedBy.displayId,
          dischargedByFirstName: observationDischargedBy.firstName,
          dischargedByLastName: observationDischargedBy.lastName,
        })
        .from(clinicalOrders)
        .innerJoin(
          patientStandingOrders,
          eq(clinicalOrders.patientStandingOrderId, patientStandingOrders.id),
        )
        .innerJoin(patients, eq(patientStandingOrders.patientId, patients.id))
        .innerJoin(serviceCatalog, eq(clinicalOrders.serviceId, serviceCatalog.id))
        .innerJoin(
          standingOrderTemplates,
          eq(patientStandingOrders.templateId, standingOrderTemplates.id),
        )
        // Required by branchScopeCond's encounter arm. 1:1, so no row fan-out.
        .leftJoin(encounters, eq(clinicalOrders.encounterId, encounters.id))
        .leftJoin(
          postAdministrationObservations,
          eq(postAdministrationObservations.clinicalOrderId, clinicalOrders.id),
        )
        .leftJoin(
          observationOutcomeBy,
          eq(postAdministrationObservations.outcomeRecordedById, observationOutcomeBy.id),
        )
        .leftJoin(
          observationDischargedBy,
          eq(postAdministrationObservations.dischargedById, observationDischargedBy.id),
        )
        .where(and(...conditions))
        .orderBy(asc(clinicalOrders.currentScheduledDate)),
  )

  return rows.map((r) => ({
    id: r.id,
    patientName: `${r.patientLastName}, ${r.patientFirstName}`,
    patientMrn: r.patientMrn,
    patientDateOfBirth: r.patientDateOfBirth,
    contactNumber: r.contactNumber,
    smsOptIn: r.smsOptIn,
    service: r.serviceName,
    doseNumber: r.doseNumber ?? 1,
    scheduledDate: r.scheduledDate ? r.scheduledDate.toISOString().slice(0, 10) : null,
    status: r.status,
    standingOrderName: r.standingOrderName,
    indication: r.indication,
    totalDoses: r.totalDoses,
    paymentStatus: r.paymentStatus,
    hasBlockingOverdue: Boolean(r.hasBlockingOverdue),
    priorityState: classifyOrderPriority(r.status, r.scheduledDate, now),
    observation: observationToWire(r, now),
  }))
}

// ── Administered log (date-scoped) ────────────────────────────────────────────

export type AdministeredOrderRow = {
  id: string // order display_id
  patientId: string // patient display_id
  patientName: string
  serviceName: string
  lotNumber: string | null
  administeredAt: string
  administeredByName: string | null
  encounterId: string | null // encounter display_id (or null)
}

/**
 * List completed (administered) clinical orders for a given calendar day.
 * Date comparison uses ::date cast — Railway Postgres runs UTC; Phase 1 caveat
 * documented here. No timezone params for now; acceptable for single-clinic MVP.
 *
 * Joins encounters table to surface display_id (was bigint FK on clinical_orders).
 */
export async function listAdministeredOrders(opts: {
  tenantId: string
  branchId: number | null
  date: string // YYYY-MM-DD
}): Promise<AdministeredOrderRow[]> {
  // Need encounters table for display_id surfacing.
  const { encounters } = await import('../../shared/db/schema.js')

  const rows = await withTenantTx(
    { tenantId: opts.tenantId, userId: 0, branchId: opts.branchId },
    async (tx) =>
      tx
        .select({
          id: clinicalOrders.displayId,
          patientId: patients.displayId,
          patientFirstName: patients.firstName,
          patientLastName: patients.lastName,
          serviceName: serviceCatalog.name,
          lotBatchNumber: inventoryLots.batchNumber,
          administeredAt: clinicalOrders.completedAt,
          adminFirstName: users.firstName,
          adminLastName: users.lastName,
          encounterDisplayId: encounters.displayId,
        })
        .from(clinicalOrders)
        .innerJoin(patients, eq(clinicalOrders.patientId, patients.id))
        .innerJoin(serviceCatalog, eq(clinicalOrders.serviceId, serviceCatalog.id))
        .leftJoin(inventoryLots, eq(clinicalOrders.lotId, inventoryLots.id))
        .leftJoin(users, eq(clinicalOrders.administeredById, users.id))
        .leftJoin(encounters, eq(clinicalOrders.encounterId, encounters.id))
        .where(
          and(
            eq(clinicalOrders.tenantId, opts.tenantId),
            isNull(clinicalOrders.deletedAt),
            eq(clinicalOrders.status, 'Completed'),
            sql`${clinicalOrders.completedAt}::date = ${opts.date}::date`,
            // CLIN-7: scope by branch when the caller has a branch context.
            // encounters.branch_id carries the administering branch; a null branchId
            // opt means a cross-branch user — return all branches.
            opts.branchId !== null ? eq(encounters.branchId, opts.branchId) : undefined,
          ),
        )
        .orderBy(desc(clinicalOrders.completedAt)),
  )

  return rows.map((r) => ({
    id: r.id,
    patientId: r.patientId,
    patientName: `${r.patientLastName}, ${r.patientFirstName}`,
    serviceName: r.serviceName,
    lotNumber: r.lotBatchNumber ?? null,
    administeredAt: r.administeredAt ? r.administeredAt.toISOString() : '',
    administeredByName:
      r.adminFirstName && r.adminLastName ? `${r.adminFirstName} ${r.adminLastName}` : null,
    encounterId: r.encounterDisplayId ?? null,
  }))
}

// ── Detail ────────────────────────────────────────────────────────────────────

export async function getScheduledOrder(opts: { tenantId: string; id: string }) {
  // `opts.id` is the order display_id (`ORD_…`). Resolve in the SELECT WHERE.
  const { encounters } = await import('../../shared/db/schema.js')

  // Resolve the three user FK columns to USR_ display_ids so the bigint PK never
  // crosses the wire (display-id convention — gotchas.md "Display IDs").
  const documentedByUser = alias(users, 'documented_by_user')
  const administeredByUser = alias(users, 'administered_by_user')
  const createdByUser = alias(users, 'created_by_user')
  const observationOutcomeBy = alias(users, 'detail_observation_outcome_by')
  const observationDischargedBy = alias(users, 'detail_observation_discharged_by')

  return withTenantTx({ tenantId: opts.tenantId, userId: 0, branchId: null }, async (tx) => {
    const [row] = await tx
      .select({
        id: clinicalOrders.id, // bigint — needed for sub-queries
        displayId: clinicalOrders.displayId,
        tenantId: clinicalOrders.tenantId,
        // Surface PSO display_id (joined below); we capture both bigint + display_id.
        patientStandingOrderInternalId: clinicalOrders.patientStandingOrderId,
        patientStandingOrderDisplayId: patientStandingOrders.displayId,
        serviceId: clinicalOrders.serviceId,
        encounterDisplayId: encounters.displayId,
        orderType: clinicalOrders.orderType,
        status: clinicalOrders.status,
        originalScheduledDate: clinicalOrders.originalScheduledDate,
        currentScheduledDate: clinicalOrders.currentScheduledDate,
        completedAt: clinicalOrders.completedAt,
        documentedById: documentedByUser.displayId,
        administeredById: administeredByUser.displayId,
        quantity: clinicalOrders.quantity,
        doseNumber: clinicalOrders.doseNumber,
        administrationRoute: clinicalOrders.administrationRoute,
        administrationSite: clinicalOrders.administrationSite,
        indication: clinicalOrders.indication,
        notes: clinicalOrders.notes,
        deletedAt: clinicalOrders.deletedAt,
        createdAt: clinicalOrders.createdAt,
        updatedAt: clinicalOrders.updatedAt,
        createdById: createdByUser.displayId,
        serviceName: serviceCatalog.name,
        requiresDoseCalculation: serviceCatalog.requiresDoseCalculation,
        patientDisplayId: patients.displayId,
        patientInternalId: patients.id,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
        patientDateOfBirth: patients.dateOfBirth,
        patientMrn: patients.mrn,
        standingOrderTemplateName: standingOrderTemplates.name,
        standingOrderStatus: patientStandingOrders.status,
        observationId: postAdministrationObservations.displayId,
        observationDurationMinutes: postAdministrationObservations.durationMinutes,
        observeUntil: postAdministrationObservations.observeUntil,
        observationOutcome: postAdministrationObservations.outcome,
        observationNotes: postAdministrationObservations.outcomeNotes,
        outcomeRecordedAt: postAdministrationObservations.outcomeRecordedAt,
        outcomeByDisplayId: observationOutcomeBy.displayId,
        outcomeByFirstName: observationOutcomeBy.firstName,
        outcomeByLastName: observationOutcomeBy.lastName,
        dischargedAt: postAdministrationObservations.dischargedAt,
        dischargedByDisplayId: observationDischargedBy.displayId,
        dischargedByFirstName: observationDischargedBy.firstName,
        dischargedByLastName: observationDischargedBy.lastName,
      })
      .from(clinicalOrders)
      .leftJoin(
        patientStandingOrders,
        eq(clinicalOrders.patientStandingOrderId, patientStandingOrders.id),
      )
      .leftJoin(patients, eq(patientStandingOrders.patientId, patients.id))
      .leftJoin(serviceCatalog, eq(clinicalOrders.serviceId, serviceCatalog.id))
      .leftJoin(
        standingOrderTemplates,
        eq(patientStandingOrders.templateId, standingOrderTemplates.id),
      )
      .leftJoin(encounters, eq(clinicalOrders.encounterId, encounters.id))
      .leftJoin(documentedByUser, eq(clinicalOrders.documentedById, documentedByUser.id))
      .leftJoin(administeredByUser, eq(clinicalOrders.administeredById, administeredByUser.id))
      .leftJoin(createdByUser, eq(clinicalOrders.createdById, createdByUser.id))
      .leftJoin(
        postAdministrationObservations,
        eq(postAdministrationObservations.clinicalOrderId, clinicalOrders.id),
      )
      .leftJoin(
        observationOutcomeBy,
        eq(postAdministrationObservations.outcomeRecordedById, observationOutcomeBy.id),
      )
      .leftJoin(
        observationDischargedBy,
        eq(postAdministrationObservations.dischargedById, observationDischargedBy.id),
      )
      .where(
        and(
          eq(clinicalOrders.displayId, opts.id),
          eq(clinicalOrders.tenantId, opts.tenantId),
          isNull(clinicalOrders.deletedAt),
        ),
      )
      .limit(1)

    if (!row) return null

    // Parallel fetches: consent record, payment status, and concise clinical
    // flags used at the final administration checkpoint.
    // `consents.scopeRefId` stores the clinical_order display_id (text, per spec #9).
    const [consentResult, paymentResult, allergyRows, conditionRows] = await Promise.all([
      tx
        .select({
          id: consents.displayId,
          visProvided: consents.visProvided,
          visDate: consents.visDate,
          visVersion: consents.visVersion,
          // DEVIATION: consentObtained inferred from revokedAt === null.
          revokedAt: consents.revokedAt,
          consenterRelation: consents.consenterRelation,
          obtainedAt: consents.obtainedAt,
          notes: consents.notes,
        })
        .from(consents)
        .where(
          and(
            eq(consents.scopeRefType, 'clinical_order'),
            eq(consents.scopeRefId, opts.id),
            eq(consents.tenantId, opts.tenantId),
            isNull(consents.deletedAt),
          ),
        )
        .limit(1),
      tx
        .select({
          txStatus: transactions.status,
        })
        .from(transactionItems)
        .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
        .where(
          and(
            eq(transactionItems.clinicalOrderId, row.id),
            eq(transactionItems.tenantId, opts.tenantId),
          ),
        ),
      row.patientInternalId === null
        ? Promise.resolve([])
        : tx
            .select({ allergen: patientAllergies.allergen })
            .from(patientAllergies)
            .where(
              and(
                eq(patientAllergies.patientId, row.patientInternalId),
                eq(patientAllergies.tenantId, opts.tenantId),
                isNull(patientAllergies.deletedAt),
                isNull(patientAllergies.resolvedAt),
              ),
            )
            .orderBy(asc(patientAllergies.allergen)),
      row.patientInternalId === null
        ? Promise.resolve([])
        : tx
            .select({ conditionName: patientConditions.conditionName })
            .from(patientConditions)
            .where(
              and(
                eq(patientConditions.patientId, row.patientInternalId),
                eq(patientConditions.tenantId, opts.tenantId),
                eq(patientConditions.status, 'Active'),
                isNull(patientConditions.deletedAt),
              ),
            )
            .orderBy(asc(patientConditions.conditionName)),
    ])

    const [consent] = consentResult

    // Resolve paymentStatus: prefer 'Paid' if any linked transaction is paid.
    type TxStatus = 'Draft' | 'Pending' | 'Paid' | 'Voided' | 'Refunded'
    let paymentStatus: TxStatus | null = null
    if (paymentResult.length > 0) {
      const statuses = paymentResult.map((r) => r.txStatus as TxStatus)
      if (statuses.includes('Paid')) {
        paymentStatus = 'Paid'
      } else {
        paymentStatus = statuses[0] ?? null
      }
    }

    return {
      id: row.displayId,
      tenantId: row.tenantId,
      patientStandingOrderId: row.patientStandingOrderDisplayId,
      serviceId: row.serviceId,
      encounterId: row.encounterDisplayId,
      orderType: row.orderType,
      status: row.status,
      originalScheduledDate: row.originalScheduledDate
        ? row.originalScheduledDate.toISOString()
        : null,
      currentScheduledDate: row.currentScheduledDate
        ? row.currentScheduledDate.toISOString()
        : null,
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      observation: observationToWire(row),
      documentedById: row.documentedById,
      administeredById: row.administeredById,
      quantity: row.quantity,
      doseNumber: row.doseNumber,
      administrationRoute: row.administrationRoute,
      administrationSite: row.administrationSite,
      indication: row.indication,
      notes: row.notes,
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
      createdAt: row.createdAt ? row.createdAt.toISOString() : null,
      updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
      createdById: row.createdById,
      paymentStatus,
      service: row.serviceName
        ? {
            id: row.serviceId,
            name: row.serviceName,
            requiresDoseCalculation: row.requiresDoseCalculation ?? false,
          }
        : null,
      patient: row.patientDisplayId
        ? {
            id: row.patientDisplayId,
            firstName: row.patientFirstName,
            lastName: row.patientLastName,
            dateOfBirth: row.patientDateOfBirth ?? null,
            mrn: row.patientMrn ?? null,
            allergies: allergyRows.map((allergy) => allergy.allergen),
            activeConditions: conditionRows.map((condition) => condition.conditionName),
          }
        : null,
      standingOrder: row.patientStandingOrderDisplayId
        ? {
            id: row.patientStandingOrderDisplayId,
            status: row.standingOrderStatus,
            template: row.standingOrderTemplateName
              ? { name: row.standingOrderTemplateName }
              : null,
          }
        : null,
      consent: consent
        ? {
            id: consent.id,
            visProvided: consent.visProvided,
            visDate: consent.visDate ?? null,
            visVersion: consent.visVersion,
            consentObtained: consent.revokedAt === null,
            consentBy: consent.consenterRelation,
            consentTimestamp: consent.obtainedAt ? consent.obtainedAt.toISOString() : null,
            notes: consent.notes,
          }
        : null,
    }
  })
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export async function getScheduledOrdersStats(tenantId: string, branchId: number | null) {
  const now = new Date()
  // Scheduled dates use date-only values, while completed_at is a real
  // timestamp. Keep the two boundary types separate so an early-morning Manila
  // administration lands in the correct clinic day.
  const today = clinicCalendarDate(now)
  const tomorrow = new Date(today)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const backfillStart = new Date(today)
  backfillStart.setUTCDate(backfillStart.getUTCDate() - BACKFILL_WINDOW_DAYS)
  const completedTodayWindow = clinicDayTimestampWindow(now)
  const upcomingWindow = upcomingClinicDaysWindow(now)
  const seriesStart = new Date(completedTodayWindow.startsAt)
  seriesStart.setUTCDate(seriesStart.getUTCDate() - 6)
  const todayIso = today.toISOString()
  const tomorrowIso = tomorrow.toISOString()
  const backfillStartIso = backfillStart.toISOString()
  const seriesStartIso = seriesStart.toISOString()
  const completedTodayStartIso = completedTodayWindow.startsAt.toISOString()
  const completedTodayEndIso = completedTodayWindow.endsBefore.toISOString()
  const upcomingStartIso = upcomingWindow.startsAt.toISOString()
  const upcomingEndIso = upcomingWindow.endsBefore.toISOString()

  // Nurse worklist privacy scoping (2026-07-26): must match listScheduledOrders'
  // predicate exactly, else the KPI strip / tab counts disagree with the rows
  // the nurse can actually see. Same home-branch convention: null branchId
  // (no branch context) keeps tenant-wide counts; a null patients.homeBranchId
  // is never treated as cross-branch.
  const homeBranchCond = branchScopeCond(branchId)
  const branchExistsSql =
    branchId === null
      ? sql``
      : sql` AND EXISTS (
          SELECT 1 FROM patient_standing_orders pso
          INNER JOIN patients p ON p.id = pso.patient_id
          WHERE pso.id = co.patient_standing_order_id
            AND (p.home_branch_id IS NULL OR p.home_branch_id = ${branchId})
        ) OR EXISTS (
          SELECT 1 FROM encounters e
          WHERE e.id = co.encounter_id AND e.branch_id = ${branchId}
        )`

  const [[result], [activeCoursesResult], seriesRows] = await withTenantTx(
    { tenantId, userId: 0, branchId },
    async (tx) =>
      Promise.all([
        tx
          .select({
            todayCount: sql<number>`COUNT(*) FILTER (WHERE ${clinicalOrders.currentScheduledDate} >= ${todayIso} AND ${clinicalOrders.currentScheduledDate} < ${tomorrowIso} AND ${clinicalOrders.status} IN ('Scheduled', 'Pending'))`,
            missedCount: sql<number>`COUNT(*) FILTER (WHERE ${clinicalOrders.status} = 'Missed')`,
            completedToday: sql<number>`COUNT(*) FILTER (WHERE ${clinicalOrders.status} = 'Completed' AND ${clinicalOrders.completedAt} >= ${completedTodayStartIso} AND ${clinicalOrders.completedAt} < ${completedTodayEndIso})`,
            overdueCount: sql<number>`COUNT(*) FILTER (WHERE ${clinicalOrders.currentScheduledDate} < ${todayIso} AND ${clinicalOrders.status} IN ('Scheduled', 'Pending'))`,
            backfillCount: sql<number>`COUNT(*) FILTER (WHERE ${clinicalOrders.currentScheduledDate} >= ${backfillStartIso} AND ${clinicalOrders.currentScheduledDate} < ${todayIso} AND ${clinicalOrders.status} IN ('Scheduled', 'Pending'))`,
            upcomingCount: sql<number>`COUNT(*) FILTER (WHERE ${clinicalOrders.currentScheduledDate} >= ${upcomingStartIso} AND ${clinicalOrders.currentScheduledDate} < ${upcomingEndIso} AND ${clinicalOrders.status} IN ('Scheduled', 'Pending'))`,
            recomputeNeededCount: sql<number>`COUNT(*) FILTER (WHERE ${clinicalOrders.status} = 'Pending' AND ${clinicalOrders.currentScheduledDate} < ${todayIso})`,
          })
          .from(clinicalOrders)
          .leftJoin(
            patientStandingOrders,
            eq(clinicalOrders.patientStandingOrderId, patientStandingOrders.id),
          )
          .leftJoin(patients, eq(patientStandingOrders.patientId, patients.id))
          // Required by branchScopeCond's encounter arm. 1:1, so no row fan-out
          // and therefore no effect on these COUNT(*) FILTER aggregates.
          .leftJoin(encounters, eq(clinicalOrders.encounterId, encounters.id))
          .where(
            and(
              eq(clinicalOrders.tenantId, tenantId),
              isNull(clinicalOrders.deletedAt),
              homeBranchCond,
            ),
          ),
        tx
          .select({ count: sql<number>`COUNT(*)` })
          .from(patientStandingOrders)
          .innerJoin(patients, eq(patientStandingOrders.patientId, patients.id))
          .where(
            and(
              eq(patientStandingOrders.tenantId, tenantId),
              eq(patientStandingOrders.status, 'Active'),
              // A COURSE, not a dose: this select is FROM patient_standing_orders
              // and has no encounter to read, so scope it by home branch only.
              patientBranchCond(branchId),
            ),
          ),
        // 7-day administered series (oldest → newest, today inclusive).
        // Mirrors the completedToday predicate above: status='Completed' +
        // completed_at within the day, tenant-scoped, soft-delete filtered.
        // generate_series guarantees a row (0) for empty days.
        tx.execute(
          sql`
            SELECT COUNT(co.id)::int AS "count"
            FROM generate_series(
              ${seriesStartIso}::timestamptz,
              ${completedTodayStartIso}::timestamptz,
              interval '1 day'
            ) AS d(day)
            LEFT JOIN clinical_orders co
              ON co.tenant_id = ${tenantId}
              AND co.deleted_at IS NULL
              AND co.status = 'Completed'
              AND co.completed_at >= d.day
              AND co.completed_at < d.day + interval '1 day'
              ${branchExistsSql}
            GROUP BY d.day
            ORDER BY d.day ASC
          `,
        ),
      ]),
  )

  const administered7d = (seriesRows as unknown as Array<{ count: number }>).map((r) =>
    Number(r.count ?? 0),
  )

  return {
    todayCount: Number(result?.todayCount ?? 0),
    missedCount: Number(result?.missedCount ?? 0),
    completedToday: Number(result?.completedToday ?? 0),
    overdueCount: Number(result?.overdueCount ?? 0),
    backfillCount: Number(result?.backfillCount ?? 0),
    upcomingCount: Number(result?.upcomingCount ?? 0),
    activeCoursesCount: Number(activeCoursesResult?.count ?? 0),
    recomputeNeededCount: Number(result?.recomputeNeededCount ?? 0),
    administered7d,
  }
}

// ── Timeline ──────────────────────────────────────────────────────────────────

export async function getOrderTimeline(opts: {
  tenantId: string
  id: string // order display_id
}): Promise<TimelineEntry[]> {
  return withTenantTx({ tenantId: opts.tenantId, userId: 0, branchId: null }, async (tx) => {
    // 1. Resolve the source order display_id → bigint, find its patientStandingOrderId.
    const [source] = await tx
      .select({
        id: clinicalOrders.id,
        displayId: clinicalOrders.displayId,
        patientStandingOrderId: clinicalOrders.patientStandingOrderId,
      })
      .from(clinicalOrders)
      .where(
        and(
          eq(clinicalOrders.displayId, opts.id),
          eq(clinicalOrders.tenantId, opts.tenantId),
          isNull(clinicalOrders.deletedAt),
        ),
      )
      .limit(1)

    if (!source || !source.patientStandingOrderId) {
      return []
    }

    // 2. Load all sibling clinical orders in the same PSO chain.
    const siblings = await tx
      .select({
        id: clinicalOrders.id, // bigint
        displayId: clinicalOrders.displayId,
        doseNumber: clinicalOrders.doseNumber,
        serviceId: clinicalOrders.serviceId,
        status: clinicalOrders.status,
        currentScheduledDate: clinicalOrders.currentScheduledDate,
        completedAt: clinicalOrders.completedAt,
        notes: clinicalOrders.notes,
        serviceName: serviceCatalog.name,
      })
      .from(clinicalOrders)
      .innerJoin(serviceCatalog, eq(clinicalOrders.serviceId, serviceCatalog.id))
      .where(
        and(
          eq(clinicalOrders.patientStandingOrderId, source.patientStandingOrderId),
          eq(clinicalOrders.tenantId, opts.tenantId),
          isNull(clinicalOrders.deletedAt),
        ),
      )
      .orderBy(asc(clinicalOrders.currentScheduledDate))

    if (siblings.length === 0) return []

    // 3. Load inventory_movements for completed orders to get lot + clinician.
    // inventory_movements.clinical_order_id is bigint FK.
    const completedIds = siblings.filter((s) => s.status === 'Completed').map((s) => s.id)

    const invTxMap = new Map<number, { clinician: string | null; lotNumber: string | null }>()

    if (completedIds.length > 0) {
      const invRows = await tx
        .select({
          clinicalOrderId: inventoryMovements.clinicalOrderId,
          lotBatchNumber: inventoryLots.batchNumber,
          performerFirstName: users.firstName,
          performerLastName: users.lastName,
        })
        .from(inventoryMovements)
        .innerJoin(inventoryLots, eq(inventoryMovements.lotId, inventoryLots.id))
        .leftJoin(users, eq(inventoryMovements.performedById, users.id))
        .where(
          and(
            inArray(inventoryMovements.clinicalOrderId, completedIds),
            eq(inventoryMovements.tenantId, opts.tenantId),
          ),
        )

      for (const row of invRows) {
        if (row.clinicalOrderId !== null && row.clinicalOrderId !== undefined) {
          invTxMap.set(row.clinicalOrderId, {
            clinician:
              row.performerFirstName && row.performerLastName
                ? `${row.performerFirstName} ${row.performerLastName}`
                : null,
            lotNumber: row.lotBatchNumber ?? null,
          })
        }
      }
    }

    const todayStr = new Date().toISOString().slice(0, 10)

    return siblings.map((sib): TimelineEntry => {
      const scheduledStr = sib.currentScheduledDate
        ? sib.currentScheduledDate.toISOString().slice(0, 10)
        : todayStr
      const administeredAt = sib.completedAt ? sib.completedAt.toISOString() : null
      const inv = invTxMap.get(sib.id)

      let state: TimelineEntry['state']
      if (sib.status === 'Completed') {
        state = 'completed'
      } else if (sib.status === 'Cancelled') {
        state = 'cancelled'
      } else if (scheduledStr < todayStr) {
        state = 'overdue'
      } else if (scheduledStr === todayStr) {
        state = 'due'
      } else {
        state = 'upcoming'
      }

      const notesObj = sib.notes as Record<string, unknown> | null
      const doseSize =
        notesObj && typeof notesObj['doseSize'] === 'string' ? notesObj['doseSize'] : '1 dose'

      const entry: TimelineEntry = {
        id: sib.displayId,
        day: sib.doseNumber ?? 1,
        scheduledAt: scheduledStr,
        administeredAt,
        state,
        byClinician: inv?.clinician ?? null,
        lotNumber: inv?.lotNumber ?? null,
        doseSize,
      }

      return entry
    })
  })
}

// ── Prepayable doses (for the Collect/Prepay picker) ──────────────────────────

export type PrepayableDose = {
  /** clinical_order display_id (ORD_…). */
  orderId: string
  doseNumber: number
  /** service_catalog code (e.g. ARVPEP_IM). */
  serviceId: string
  serviceName: string
  /** YYYY-MM-DD. */
  scheduledAt: string
  state: 'upcoming' | 'due' | 'overdue' | 'completed' | 'cancelled'
  /**
   * Payment status derived from non-voided transaction lines linked to this
   * dose; null when the dose has not been billed yet. A dose is offerable for
   * prepayment when this is null (no open/settled bill) and it is not completed
   * or cancelled.
   * @see unitPrice below for what the dose bills at.
   */
  paymentStatus: 'Draft' | 'Pending' | 'Paid' | null
  /**
   * Resolved unit price for the requested payer, and for the administered brand
   * when the dose has already been given. Server-resolved so the picker's total
   * matches what `createTransaction` will bill, instead of approximating from
   * the catalog base price and ignoring every payer contract.
   */
  unitPrice: string
}

/**
 * List the doses of a scheduled order (the whole standing-order chain when the
 * order belongs to one, else the single ad-hoc order) with their billing
 * status, so the cashier can pick which doses to prepay. SELECT-only —
 * tenant-wide read (branchId: null).
 */
export async function getPrepayableDoses(opts: {
  tenantId: string
  id: string // order display_id
  /** payer_profiles display_id (PYR_…) whose contracted rate should apply. */
  payerId?: string | undefined
  /** Caller's branch, for branch-specific price rows. */
  branchId?: number | null
}): Promise<PrepayableDose[]> {
  return withTenantTx({ tenantId: opts.tenantId, userId: 0, branchId: null }, async (tx) => {
    const [source] = await tx
      .select({
        id: clinicalOrders.id,
        patientStandingOrderId: clinicalOrders.patientStandingOrderId,
      })
      .from(clinicalOrders)
      .where(
        and(
          eq(clinicalOrders.displayId, opts.id),
          eq(clinicalOrders.tenantId, opts.tenantId),
          isNull(clinicalOrders.deletedAt),
        ),
      )
      .limit(1)
    if (!source) return []

    // Whole chain when part of a standing order; otherwise just this order.
    const chainFilter = source.patientStandingOrderId
      ? eq(clinicalOrders.patientStandingOrderId, source.patientStandingOrderId)
      : eq(clinicalOrders.id, source.id)

    const rows = await tx
      .select({
        displayId: clinicalOrders.displayId,
        doseNumber: clinicalOrders.doseNumber,
        serviceId: clinicalOrders.serviceId,
        status: clinicalOrders.status,
        currentScheduledDate: clinicalOrders.currentScheduledDate,
        serviceName: serviceCatalog.name,
        // Per-dose payment status from non-voided/refunded linked txns; prefer Paid.
        paymentStatus: sql<'Draft' | 'Pending' | 'Paid' | null>`(
          SELECT CASE
            WHEN BOOL_OR(${transactions.status} = 'Paid') THEN 'Paid'
            ELSE MIN(${transactions.status})
          END
          FROM ${transactionItems}
          INNER JOIN ${transactions} ON ${transactionItems.transactionId} = ${transactions.id}
          WHERE ${transactionItems.clinicalOrderId} = ${clinicalOrders.id}
            AND ${transactionItems.tenantId} = ${clinicalOrders.tenantId}
            AND ${transactions.deletedAt} IS NULL
            AND ${transactions.status} NOT IN ('Voided', 'Refunded')
        )`,
      })
      .from(clinicalOrders)
      .innerJoin(serviceCatalog, eq(clinicalOrders.serviceId, serviceCatalog.id))
      .where(
        and(
          chainFilter,
          eq(clinicalOrders.tenantId, opts.tenantId),
          isNull(clinicalOrders.deletedAt),
        ),
      )
      .orderBy(asc(clinicalOrders.currentScheduledDate))

    const todayStr = new Date().toISOString().slice(0, 10)

    // ── Price each dose the way the transaction actually will ────────────────
    // Same resolver, same precedence ladder (payer 4 > product 2 > branch 1) as
    // `createTransaction`, so the figure the nurse is shown before collecting is
    // the figure that gets billed. Resolve the payer display_id once.
    let payerBigint: number | null = null
    if (opts.payerId) {
      const [payerRow] = await tx
        .select({ id: payerProfiles.id })
        .from(payerProfiles)
        .where(
          and(eq(payerProfiles.tenantId, opts.tenantId), eq(payerProfiles.displayId, opts.payerId)),
        )
        .limit(1)
      payerBigint = payerRow?.id ?? null
    }

    // A dose already given has a brand on it, which can carry its own price. One
    // lookup for the whole chain rather than per row.
    const administeredBrands = await resolveAdministeredBrands(
      tx,
      opts.tenantId,
      rows.filter((r) => r.status === 'Completed').map((r) => r.displayId),
    )

    const priceCache = new Map<string, string>()
    const priceFor = async (serviceId: string, productId: number | null): Promise<string> => {
      const key = `${serviceId}|${productId ?? ''}`
      const cached = priceCache.get(key)
      if (cached !== undefined) return cached
      const resolved = await resolveServicePrice(tx, {
        tenantId: opts.tenantId,
        serviceId,
        branchId: opts.branchId ?? null,
        payerId: payerBigint,
        productId,
      })
      priceCache.set(key, resolved)
      return resolved
    }
    const unitPrices = new Map<string, string>()
    for (const r of rows) {
      const brand = administeredBrands.get(r.displayId)
      unitPrices.set(r.displayId, await priceFor(r.serviceId, brand?.productId ?? null))
    }

    return rows.map((r): PrepayableDose => {
      const scheduledStr = r.currentScheduledDate
        ? r.currentScheduledDate.toISOString().slice(0, 10)
        : todayStr
      let state: PrepayableDose['state']
      if (r.status === 'Completed') state = 'completed'
      else if (r.status === 'Cancelled') state = 'cancelled'
      else if (scheduledStr < todayStr) state = 'overdue'
      else if (scheduledStr === todayStr) state = 'due'
      else state = 'upcoming'

      return {
        orderId: r.displayId,
        doseNumber: r.doseNumber ?? 1,
        serviceId: r.serviceId,
        serviceName: r.serviceName,
        scheduledAt: scheduledStr,
        state,
        paymentStatus: r.paymentStatus ?? null,
        unitPrice: unitPrices.get(r.displayId) ?? '0.00',
      }
    })
  })
}

// ── Manual text-patient draft (R2) ────────────────────────────────────────────

export type TextDraftResult = {
  blocked: boolean
  blockedReason: TextDraftBlockedReason | null
  maskedNumber: string | null
  smsUri: string | null
  messageBody: string | null
  qrDataUrl: string | null
}

/**
 * Manual "text patient" draft for a nurse to send from THEIR OWN phone (R2,
 * docs/nurse-testing-readiness.md). Nothing here is sent by our
 * infrastructure: this composes the message + QR, the nurse scans it, and
 * presses send themselves. Deliberately NOT the automated reminder pipeline:
 * no domain event, no job, no provider, no notification queue.
 *
 * Two hard blocks, checked in that order (no number on file is the more
 * fundamental reason: there is nowhere to send it regardless of consent):
 *   1. `patients.contact_number` is null.
 *   2. `patients.sms_opt_in` is false (messaging consent, distinct from the
 *      clinical `consents` table).
 */
export async function getTextDraft(opts: {
  tenantId: string
  id: string // clinical_order display_id
  /**
   * Caller's session branch (`req.user.branchId`), never a client-supplied
   * param. A nurse must not text a patient homed at a different branch, so
   * this uses the same `patients.homeBranchId` scoping as
   * `listScheduledOrders`, including the null-home-branch-is-visible-everywhere
   * convention. A mismatch resolves this to "order not found" (404) rather
   * than a `blocked` reason: the order was never surfaced in this branch's
   * worklist in the first place.
   */
  branchId: number | null
}): Promise<TextDraftResult | null> {
  return withTenantTx({ tenantId: opts.tenantId, userId: 0, branchId: null }, async (tx) => {
    const [row] = await tx
      .select({
        contactNumber: patients.contactNumber,
        smsOptIn: patients.smsOptIn,
        patientFirstName: patients.firstName,
        serviceName: serviceCatalog.name,
        doseNumber: clinicalOrders.doseNumber,
        scheduledDate: clinicalOrders.currentScheduledDate,
        totalDoses: sql<number>`(SELECT COUNT(*)::int FROM ${standingOrderTemplateItems} WHERE ${standingOrderTemplateItems.templateId} = ${standingOrderTemplates.id})`,
        // Branch via patients.home_branch_id, NOT encounters.branch_id:
        // clinical_orders carries no branch_id of its own, and
        // clinical_orders.encounter_id is frequently null for a
        // standing-order dose that has not been administered yet: the exact
        // population this endpoint serves (reminding someone BEFORE their
        // dose day). home_branch_id is set once at registration and does not
        // depend on whether an encounter exists yet for this specific dose.
        branchName: branches.name,
      })
      .from(clinicalOrders)
      .innerJoin(
        patientStandingOrders,
        eq(clinicalOrders.patientStandingOrderId, patientStandingOrders.id),
      )
      .innerJoin(patients, eq(patientStandingOrders.patientId, patients.id))
      .innerJoin(serviceCatalog, eq(clinicalOrders.serviceId, serviceCatalog.id))
      .innerJoin(
        standingOrderTemplates,
        eq(patientStandingOrders.templateId, standingOrderTemplates.id),
      )
      .leftJoin(branches, eq(patients.homeBranchId, branches.id))
      // Required by branchScopeCond's encounter arm. 1:1, so no row fan-out.
      .leftJoin(encounters, eq(clinicalOrders.encounterId, encounters.id))
      .where(
        and(
          eq(clinicalOrders.displayId, opts.id),
          eq(clinicalOrders.tenantId, opts.tenantId),
          isNull(clinicalOrders.deletedAt),
          branchScopeCond(opts.branchId),
        ),
      )
      .limit(1)

    if (!row) return null

    if (!row.contactNumber) {
      return {
        blocked: true,
        blockedReason: 'no_contact_number',
        maskedNumber: null,
        smsUri: null,
        messageBody: null,
        qrDataUrl: null,
      }
    }

    if (!row.smsOptIn) {
      return {
        blocked: true,
        blockedReason: 'sms_opt_in_false',
        maskedNumber: maskPhoneNumber(row.contactNumber),
        smsUri: null,
        messageBody: null,
        qrDataUrl: null,
      }
    }

    // Defensive fallback only: every order this endpoint is meant for
    // carries a currentScheduledDate; today's date keeps the message
    // sensible if one somehow doesn't.
    const scheduledDateStr = row.scheduledDate
      ? row.scheduledDate.toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10)

    const messageBody = composeTextDraftBody({
      patientFirstName: row.patientFirstName,
      serviceName: row.serviceName,
      doseNumber: row.doseNumber ?? 1,
      totalDoses: row.totalDoses,
      scheduledDate: scheduledDateStr,
      branchName: row.branchName ?? null,
    })

    const smsUri = buildSmsUri(row.contactNumber, messageBody)
    const qrDataUrl = await QRCode.toDataURL(smsUri)

    return {
      blocked: false,
      blockedReason: null,
      maskedNumber: maskPhoneNumber(row.contactNumber),
      smsUri,
      messageBody,
      qrDataUrl,
    }
  })
}

// ── Eligible brands / lots for a dose ────────────────────────────────────────

export type EligibleLot = {
  id: string
  batchNumber: string
  expiryDate: string
  quantityOnHand: string
  product: { id: string; name: string; manufacturer: string | null }
  isHouseBrand: boolean
  unitPrice: string
  isRecalled: boolean
}

/**
 * Eligible inventory for the brands a nurse may pick for this dose, at THIS
 * branch, right now. The administration UI groups this into one explicit brand
 * choice and submits the chosen brand's FEFO representative lot internally.
 *
 * Ordering is the whole point: house brand first (`service_eligible_products`
 * .is_default / .ranking), then earliest-expiring within that brand. Ordering
 * determines the internal representative after an explicit brand choice; the
 * UI never preselects a brand.
 *
 * `unitPrice` is the brand-resolved price under the payer already on the dose's
 * bill (or retail when nothing is billed yet). Indicative: if the dose is billed
 * LATER under a different payer, that bill re-resolves the price itself.
 */
export async function getEligibleLots(opts: {
  tenantId: string
  branchId: number
  id: string // order display_id
}): Promise<{ data: EligibleLot[]; billedUnitPrice: string | null }> {
  const { tenantId, branchId, id } = opts
  return withTenantTx({ tenantId, userId: 0, branchId }, async (tx) => {
    const [order] = await tx
      .select({ id: clinicalOrders.id, serviceId: clinicalOrders.serviceId })
      .from(clinicalOrders)
      .where(
        and(
          eq(clinicalOrders.displayId, id),
          eq(clinicalOrders.tenantId, tenantId),
          isNull(clinicalOrders.deletedAt),
        ),
      )
      .limit(1)
    if (!order) throw new LifecycleError('Scheduled order not found', 'NOT_FOUND', 404)

    // Already-billed line for this dose: its snapshotted unit price is what a
    // pricier brand would deviate from, and its payer is the pricing context.
    const [billed] = await tx
      .select({ unitPrice: transactionItems.unitPrice, payerId: transactions.payerId })
      .from(transactionItems)
      .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
      .where(
        and(
          eq(transactionItems.tenantId, tenantId),
          eq(transactionItems.clinicalOrderId, order.id),
          isNull(transactions.deletedAt),
          sql`${transactions.status} NOT IN ('Voided', 'Refunded')`,
        ),
      )
      .limit(1)

    const rows = await tx.execute(
      sql`
        SELECT
          il.display_id                     AS lot_display_id,
          il.batch_number                   AS batch_number,
          il.expiry_date                    AS expiry_date,
          il.quantity_on_hand               AS quantity_on_hand,
          p.id                              AS product_id,
          p.display_id                      AS product_display_id,
          p.name                            AS product_name,
          COALESCE(il.manufacturer, p.manufacturer) AS manufacturer,
          COALESCE(sep.is_default, false)    AS is_default,
          COALESCE(sep.ranking, 0)           AS ranking,
          EXISTS (
            SELECT 1
            FROM product_recalls pr
            WHERE pr.tenant_id             = ${tenantId}
              AND pr.resolved_at           IS NULL
              AND pr.deleted_at            IS NULL
              AND (
                -- A product-only recall affects every lot for that product.
                (pr.affected_lots_pattern IS NULL AND pr.product_id = il.product_id)
                OR (
                  pr.affected_lots_pattern IS NOT NULL
                  AND (pr.product_id IS NULL OR pr.product_id = il.product_id)
                  -- starts_with mirrors the JS startsWith() in
                  -- product_recalls/db.ts getRecallMatchesForLot (INV-4), and
                  -- unlike LIKE it treats %/_ in the pattern literally.
                  AND starts_with(lower(il.batch_number), lower(pr.affected_lots_pattern))
                )
              )
          )                                 AS is_recalled
        FROM inventory_lots il
        INNER JOIN products p ON p.id = il.product_id
        LEFT JOIN service_eligible_products sep
          ON  sep.tenant_id  = ${tenantId}
          AND sep.service_id = ${order.serviceId}
          AND sep.product_id = il.product_id
        WHERE
          il.tenant_id          = ${tenantId}
          AND il.branch_id      = ${branchId}
          AND il.is_quarantined = false
          AND il.expiry_date   >= CURRENT_DATE
          AND il.quantity_on_hand::numeric > 0
          AND il.product_id IN ${eligibleProductIdsSql(tenantId, order.serviceId)}
        ORDER BY
          COALESCE(sep.is_default, false) DESC,
          COALESCE(sep.ranking, 0) ASC,
          il.expiry_date ASC,
          il.received_at ASC,
          il.id ASC
      `,
    )

    const lotRows = rows as unknown as Array<{
      lot_display_id: string
      batch_number: string
      expiry_date: string | Date
      quantity_on_hand: string
      product_id: number | string
      product_display_id: string
      product_name: string
      manufacturer: string | null
      is_default: boolean
      is_recalled: boolean
    }>

    // One price lookup per distinct brand, not per lot.
    const priceByProduct = new Map<number, string>()
    for (const r of lotRows) {
      const productId = Number(r.product_id)
      if (priceByProduct.has(productId)) continue
      priceByProduct.set(
        productId,
        await resolveServicePrice(tx, {
          tenantId,
          serviceId: order.serviceId,
          branchId,
          payerId: billed?.payerId ?? null,
          productId,
        }),
      )
    }

    return {
      data: lotRows.map((r): EligibleLot => {
        const expiry =
          typeof r.expiry_date === 'string'
            ? r.expiry_date.slice(0, 10)
            : r.expiry_date.toISOString().slice(0, 10)
        return {
          id: r.lot_display_id,
          batchNumber: r.batch_number,
          expiryDate: expiry,
          quantityOnHand: r.quantity_on_hand,
          product: {
            id: r.product_display_id,
            name: r.product_name,
            manufacturer: r.manufacturer,
          },
          isHouseBrand: r.is_default === true,
          unitPrice: priceByProduct.get(Number(r.product_id)) ?? '0.00',
          isRecalled: r.is_recalled === true,
        }
      }),
      billedUnitPrice: billed?.unitPrice ?? null,
    }
  })
}

// ── Recompute preview ─────────────────────────────────────────────────────────

export async function previewRecompute(opts: {
  tenantId: string
  id: string // order display_id
}): Promise<{
  current: { id: string; currentScheduledDate: string | null }
  downstream: DownstreamWire[]
}> {
  return withTenantTx({ tenantId: opts.tenantId, userId: 0, branchId: null }, async (tx) => {
    const [source] = await tx
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
          eq(clinicalOrders.displayId, opts.id),
          eq(clinicalOrders.tenantId, opts.tenantId),
          isNull(clinicalOrders.deletedAt),
        ),
      )
      .limit(1)

    if (!source) {
      return { current: { id: opts.id, currentScheduledDate: null }, downstream: [] }
    }

    const currentScheduledDate = source.currentScheduledDate
      ? source.currentScheduledDate.toISOString()
      : null

    if (!source.patientStandingOrderId) {
      return { current: { id: source.displayId, currentScheduledDate }, downstream: [] }
    }

    const { items, siblings, anchor } = await loadRecomputeData(tx, opts.tenantId, source)
    const downstream = projectDownstream(items, source, siblings, anchor).map(toDownstreamWire)

    return { current: { id: source.displayId, currentScheduledDate }, downstream }
  })
}

// ── Internal helper: load template items + siblings for recompute ─────────────

export type RecomputeSource = {
  id: number // bigint PK
  displayId: string
  patientStandingOrderId: number | null
  doseNumber: number | null
  serviceId: string
  status: string
  completedAt: Date | null
  currentScheduledDate: Date | null
}

async function loadRecomputeData(tx: Tx, tenantId: string, source: RecomputeSource) {
  const [pso] = await tx
    .select({ templateId: patientStandingOrders.templateId })
    .from(patientStandingOrders)
    .where(eq(patientStandingOrders.id, source.patientStandingOrderId!))
    .limit(1)

  const templateId = pso?.templateId ?? null

  const items = templateId
    ? await tx
        .select({
          serviceId: standingOrderTemplateItems.serviceId,
          dayOffset: standingOrderTemplateItems.dayOffset,
          sequence: standingOrderTemplateItems.sequence,
        })
        .from(standingOrderTemplateItems)
        .where(
          and(
            eq(standingOrderTemplateItems.templateId, templateId),
            eq(standingOrderTemplateItems.tenantId, tenantId),
          ),
        )
        .orderBy(asc(standingOrderTemplateItems.dayOffset))
    : []

  const siblings = await tx
    .select({
      id: clinicalOrders.id,
      displayId: clinicalOrders.displayId,
      doseNumber: clinicalOrders.doseNumber,
      serviceId: clinicalOrders.serviceId,
      status: clinicalOrders.status,
      currentScheduledDate: clinicalOrders.currentScheduledDate,
    })
    .from(clinicalOrders)
    .where(
      and(
        eq(clinicalOrders.patientStandingOrderId, source.patientStandingOrderId!),
        eq(clinicalOrders.tenantId, tenantId),
        isNull(clinicalOrders.deletedAt),
      ),
    )

  const anchor =
    source.status === 'Completed' && source.completedAt ? source.completedAt : new Date()

  return { items, siblings, anchor }
}

// ── Apply recompute ────────────────────────────────────────────────────────────

export async function applyRecomputeTx(
  tx: Tx,
  opts: {
    tenantId: string
    userId: number
    /** clinical_order display_id of the source */
    id: string
    sourceData: RecomputeSource
  },
): Promise<{ updated: number; downstream: DownstreamWire[] }> {
  if (!opts.sourceData.patientStandingOrderId) {
    return { updated: 0, downstream: [] }
  }

  const { items, siblings, anchor } = await loadRecomputeData(tx, opts.tenantId, opts.sourceData)
  // projectDownstream returns the internal projection (carries the bigint PK for
  // the UPDATE below); strip it to the wire shape before returning.
  const downstream = projectDownstream(items, opts.sourceData, siblings, anchor)

  let updated = 0
  for (const proj of changedDownstreamProjections(downstream)) {
    const newDate = new Date(proj.toDate + 'T00:00:00Z')
    // UPDATE by bigint internal id (proj.internalId).
    await tx.execute(
      sql`
        UPDATE clinical_orders
        SET current_scheduled_date = ${newDate.toISOString()},
            updated_at = NOW()
        WHERE id = ${proj.internalId}
          AND tenant_id = ${opts.tenantId}
          AND deleted_at IS NULL
      `,
    )
    updated++
  }

  return { updated, downstream: downstream.map(toDownstreamWire) }
}

// ── Reschedule ────────────────────────────────────────────────────────────────

export async function rescheduleOrderTx(
  tx: Tx,
  opts: {
    tenantId: string
    /** clinical_order display_id. */
    id: string
    newDate: string // YYYY-MM-DD
    reason: string
    userId: number
  },
): Promise<{ id: string; currentScheduledDate: string }> {
  const [before] = await tx
    .select({
      id: clinicalOrders.id,
      displayId: clinicalOrders.displayId,
      currentScheduledDate: clinicalOrders.currentScheduledDate,
    })
    .from(clinicalOrders)
    .where(
      and(
        eq(clinicalOrders.displayId, opts.id),
        eq(clinicalOrders.tenantId, opts.tenantId),
        isNull(clinicalOrders.deletedAt),
      ),
    )
    .limit(1)

  if (!before) {
    throw new Error('ORDER_NOT_FOUND')
  }

  const prevDate = before.currentScheduledDate
    ? before.currentScheduledDate.toISOString().slice(0, 10)
    : null

  const newDateObj = new Date(opts.newDate + 'T00:00:00Z')

  await tx.execute(
    sql`
      UPDATE clinical_orders
      SET current_scheduled_date = ${newDateObj.toISOString()},
          updated_at = NOW()
      WHERE id = ${before.id}
        AND tenant_id = ${opts.tenantId}
        AND deleted_at IS NULL
    `,
  )

  await writeScheduleChangeAudit(tx, {
    tenantId: opts.tenantId,
    userId: opts.userId,
    recordId: before.displayId,
    action: 'SCHEDULE_CHANGE',
    changes: {
      before: prevDate,
      after: opts.newDate,
      reason: opts.reason,
    },
  })

  return { id: before.displayId, currentScheduledDate: opts.newDate }
}

// ── Administer ────────────────────────────────────────────────────────────────

/**
 * Stamp the administered brand onto this dose's already-billed line, and record
 * a variance when that brand costs more than the snapshotted `unit_price`.
 *
 * Only relevant for the PREPAY shape (bill raised before administration). When
 * nothing is billed yet this returns immediately: the eventual bill resolves the
 * brand price itself (see `resolveAdministeredBrands` in transactions/db.ts), so
 * there is no gap to record.
 *
 * The variance is an `audit_logs` row, NOT a re-bill: a Paid transaction is
 * immutable at the DB layer and a clinical decision must not be gated on money.
 * Query them with
 *   `action = 'TRANSACTION_MODIFY' AND metadata->>'reason' = 'brand_price_variance'`
 * (same metadata-discriminated convention as `dpa_erasure` deletes — it keeps
 * the `audit_action` enum stable, since Postgres cannot remove enum values).
 */
async function recordBrandPriceVariance(
  tx: Tx,
  opts: {
    tenantId: string
    userId: number
    branchId: number
    clinicalOrderId: number
    orderDisplayId: string
    serviceId: string
    lotId: number
    lotDisplayId: string
    productId: number
    acknowledged: boolean
  },
): Promise<void> {
  const { tenantId, userId, branchId, serviceId, productId } = opts

  const [billed] = await tx
    .select({
      id: transactionItems.id,
      displayId: transactionItems.displayId,
      unitPrice: transactionItems.unitPrice,
      payerId: transactions.payerId,
      transactionDisplayId: transactions.displayId,
    })
    .from(transactionItems)
    .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
    .where(
      and(
        eq(transactionItems.tenantId, tenantId),
        eq(transactionItems.clinicalOrderId, opts.clinicalOrderId),
        isNull(transactions.deletedAt),
        sql`${transactions.status} NOT IN ('Voided', 'Refunded')`,
      ),
    )
    .limit(1)

  if (!billed) return

  // transaction_items carries no immutability trigger (0004 guards
  // `transactions` and `clinical_orders` only), so recording which brand the
  // line actually paid for is allowed even on a settled bill.
  await tx
    .update(transactionItems)
    .set({ lotId: opts.lotId })
    .where(and(eq(transactionItems.id, billed.id), eq(transactionItems.tenantId, tenantId)))

  const brandUnitPrice = await resolveServicePrice(tx, {
    tenantId,
    serviceId,
    branchId,
    payerId: billed.payerId,
    productId,
  })

  const deltaCents = toCents(brandUnitPrice) - toCents(billed.unitPrice)
  if (deltaCents <= 0) return

  await auditLog(tx, {
    tenantId,
    userId,
    branchId,
    action: 'TRANSACTION_MODIFY',
    entityType: 'transaction_items',
    entityId: billed.displayId,
    metadata: {
      reason: 'brand_price_variance',
      clinicalOrderId: opts.orderDisplayId,
      transactionId: billed.transactionDisplayId,
      serviceId,
      lotId: opts.lotDisplayId,
      billedUnitPrice: billed.unitPrice,
      brandUnitPrice,
      delta: fromCents(deltaCents),
      acknowledgedByOperator: opts.acknowledged,
    },
  })
}

export async function administerOrderTx(
  tx: Tx,
  opts: {
    tenantId: string
    branchId: number | null
    /** The session principal: recorded as `documented_by_id`. */
    userId: number
    /**
     * The clinician who physically gave the dose: recorded as
     * `administered_by_id`. Resolved (and PIN-attested on a shared kiosk) by
     * `resolveAdministeringClinician` before this transaction opens. Distinct
     * from `userId`: on the shared Branch login they are never the same person.
     */
    administeredById: number
    /** clinical_order display_id. */
    id: string
    dto: AdministerDto
    idempotencyKey?: string
  },
): Promise<AdministerResult> {
  const { tenantId, branchId, userId, administeredById, id, dto, idempotencyKey } = opts

  // 1. Load the order (joins PSO to get patientId). Resolve display_id WHERE.
  //    FOR UPDATE locks the clinical_orders row so two concurrent administer
  //    calls cannot both see status='Scheduled' and double-complete/double-deduct
  //    (CONC-2 fix). Drizzle's .select() chain doesn't support FOR UPDATE, so
  //    we fall back to raw sql — same pattern as inventory_transfers/db.ts.
  const orderRows = await tx.execute(
    sql`
      SELECT
        co.id,
        co.display_id             AS "displayId",
        co.status,
        co.order_type             AS "orderType",
        co.patient_standing_order_id AS "patientStandingOrderId",
        pso.display_id            AS "psoDisplayId",
        co.service_id             AS "serviceId",
        co.dose_number            AS "doseNumber",
        co.encounter_id           AS "encounterId",
        co.current_scheduled_date AS "currentScheduledDate",
        co.completed_at           AS "completedAt",
        co.quantity               AS "quantity",
        co.patient_id             AS "orderPatientId",
        pso.patient_id            AS "psoPatientId",
        pso.initiating_encounter_id AS "psoInitiatingEncounterId"
      FROM clinical_orders co
      LEFT JOIN patient_standing_orders pso
        ON co.patient_standing_order_id = pso.id
      WHERE co.display_id  = ${id}
        AND co.tenant_id   = ${tenantId}
        AND co.deleted_at  IS NULL
      LIMIT 1
      FOR UPDATE OF co
    `,
  )
  const [order] = orderRows as unknown as Array<{
    id: number
    displayId: string
    status: string
    orderType: string
    patientStandingOrderId: number | null
    psoDisplayId: string | null
    serviceId: string
    doseNumber: number | null
    encounterId: number | null
    currentScheduledDate: Date | null
    completedAt: Date | null
    quantity: string
    orderPatientId: number
    psoPatientId: number | null
    psoInitiatingEncounterId: number | null
  }>

  if (!order) {
    throw new LifecycleError('Scheduled order not found', 'NOT_FOUND', 404)
  }

  if (order.status === 'Completed') {
    throw new LifecycleError('Order already completed', 'ALREADY_COMPLETED', 400)
  }

  // 1b. DPA §19 + §34(b): reject clinical writes when patient consent is revoked/absent.
  if (order.psoPatientId !== null) {
    await assertActiveConsent(tx, tenantId, order.psoPatientId)
  }

  // 2. Deduct the lot the NURSE picked (dto.lotId). deductLot re-validates
  //    tenant/branch/quarantine/expiry/quantity AND product eligibility, so a
  //    stale or hand-crafted lot id cannot slip a wrong brand through. It
  //    returns `{ lotId, deducted }` — we follow up with a single SELECT for the
  //    lot's display_id / batch_number / expiry_date / product so the API can
  //    surface the human-readable handle and price the brand.
  if (branchId === null) {
    throw new LifecycleError('Branch context required for administer', 'BRANCH_REQUIRED', 400)
  }
  // A clinical order's quantity is the administered inventory quantity. It is
  // numeric(8,2), so parse the database string once at the clinical boundary
  // rather than silently treating every order as one vial.
  const quantityNeeded = Number(order.quantity)
  if (!Number.isFinite(quantityNeeded) || quantityNeeded <= 0) {
    throw new LifecycleError('Order quantity is invalid', 'INVALID_ORDER_QUANTITY', 409)
  }
  const { lotId: pickedLotId } = await deductLot(
    tx,
    {
      tenantId,
      branchId,
      serviceId: order.serviceId,
      clinicalOrderId: order.id,
      userId,
    },
    quantityNeeded,
    dto.lotId,
  )
  const [lotRow] = await tx
    .select({
      displayId: inventoryLots.displayId,
      batchNumber: inventoryLots.batchNumber,
      expiryDate: inventoryLots.expiryDate,
      productId: inventoryLots.productId,
    })
    .from(inventoryLots)
    .where(and(eq(inventoryLots.id, pickedLotId), eq(inventoryLots.tenantId, tenantId)))
    .limit(1)
  // Postgres `date` round-trips as 'YYYY-MM-DD' string via postgres.js.
  const lot = {
    lotId: lotRow?.displayId ?? '',
    batchNumber: lotRow?.batchNumber ?? '',
    expiryDate: typeof lotRow?.expiryDate === 'string' ? lotRow.expiryDate.slice(0, 10) : '',
  }

  // 3. Consent insert — writes `consents` table.
  //    Fallback to PSO's initiatingEncounterId if the clinical_order itself has no encounterId.
  const effectiveEncounterId = order.encounterId ?? order.psoInitiatingEncounterId
  const effectivePatientId = order.psoPatientId ?? order.orderPatientId

  if (!effectiveEncounterId) {
    throw new LifecycleError('Encounter required for consent', 'CONSENT_BLOCKED', 409)
  }

  // Resolve patient display_id for the response.
  let patientDisplayId: string | null = null
  if (effectivePatientId !== null && effectivePatientId !== undefined) {
    const [pat] = await tx
      .select({ displayId: patients.displayId })
      .from(patients)
      .where(and(eq(patients.tenantId, tenantId), eq(patients.id, effectivePatientId)))
      .limit(1)
    patientDisplayId = pat?.displayId ?? null
  }

  if (effectiveEncounterId !== null && effectiveEncounterId !== undefined && effectivePatientId) {
    await tx
      .insert(consents)
      .values({
        displayId: displayId('CNS'),
        tenantId,
        patientId: effectivePatientId,
        encounterId: effectiveEncounterId,
        consentType: 'Vaccination',
        scope: 'SingleOrder',
        scopeRefType: 'clinical_order',
        // Polymorphic ref stores display_id (per spec #9).
        scopeRefId: order.displayId,
        consenterRelation: dto.consentBy as 'Patient' | 'Guardian',
        consenterName: null,
        visProvided: dto.visProvided ?? false,
        visVersion: dto.visVersion,
        obtainedAt: new Date(),
        obtainedById: userId,
        createdById: userId,
      })
      .onConflictDoNothing()
  }

  // 4. Mark order Completed — persist idempotency_key when present.
  //    `lot_id` records WHICH BRAND went into the patient. It must be written in
  //    THIS statement: the immutability trigger (0004) freezes the row once
  //    status = 'Completed', and it reads OLD.status, so the transition itself is
  //    the only chance. Two consumers depend on it — the detail rail's lot join,
  //    and `resolveAdministeredBrands` (transactions/db.ts), which prices the
  //    administered brand when the dose is billed afterwards.
  const now = new Date()
  const observeUntil = new Date(now.getTime() + dto.observationMinutes * 60_000)
  await tx.execute(
    sql`
      UPDATE clinical_orders
      SET status = 'Completed',
          completed_at = ${now.toISOString()},
          lot_id = ${pickedLotId},
          -- Two different facts: who injected vs which login typed it in. On
          -- the shared Branch kiosk these differ (see clinicianAttestation.ts).
          administered_by_id = ${administeredById},
          documented_by_id = ${userId},
          updated_at = ${now.toISOString()},
          idempotency_key = COALESCE(${idempotencyKey ?? null}, idempotency_key)
      WHERE id = ${order.id}
        AND tenant_id = ${tenantId}
        AND deleted_at IS NULL
    `,
  )

  const observationDisplayId = displayId('OBS')
  await tx.insert(postAdministrationObservations).values({
    displayId: observationDisplayId,
    tenantId,
    clinicalOrderId: order.id,
    patientId: effectivePatientId,
    branchId,
    durationMinutes: dto.observationMinutes,
    observeUntil,
    createdById: userId,
  })

  // 4a. Close the visit this dose belonged to, if it has one.
  //
  //     `encounters.status` had no update path at all until now, so every
  //     encounter sat at 'Open' forever and the "in clinic" count only ever grew.
  //     Administering the dose is the visit's purpose, so it is the honest
  //     trigger. The helper no-ops on a null encounter or an already-terminal
  //     one, so a failed auto-close can never block a real administration.
  //
  //     Uses `order.encounterId`, the row's OWN foreign key, NOT
  //     `effectiveEncounterId` above: that falls back to the standing order's
  //     initiating encounter, which every dose in the course shares, so closing
  //     on it would mark the Day-0 visit complete when Day 28 is given weeks
  //     later. Consultation-only and multi-dose visits still close explicitly.
  await autoCompleteEncounterOnOrderCompletion(tx, {
    tenantId,
    userId,
    encounterId: order.encounterId,
  })

  // 4b. Stamp the brand onto any already-billed line for this dose, and record a
  //     variance when the brand costs more than what was billed.
  //
  //     Why not re-bill: a Paid transaction is immutable at the DB layer
  //     (0004_immutability_and_generated.sql), and a clinical decision must not
  //     be blocked on money. The audit row is the durable record; recovering the
  //     difference is a front-desk decision, not an automatic charge.
  if (lotRow) {
    await recordBrandPriceVariance(tx, {
      tenantId,
      userId,
      branchId,
      clinicalOrderId: order.id,
      orderDisplayId: order.displayId,
      serviceId: order.serviceId,
      lotId: pickedLotId,
      lotDisplayId: lot.lotId,
      productId: lotRow.productId,
      acknowledged: dto.brandPriceVarianceAcknowledged === true,
    })
  }

  // 5. Downstream recompute (uses completedAt = now as anchor).
  const sourceForRecompute: RecomputeSource = {
    id: order.id,
    displayId: order.displayId,
    patientStandingOrderId: order.patientStandingOrderId,
    doseNumber: order.doseNumber,
    serviceId: order.serviceId,
    status: 'Completed',
    completedAt: now,
    currentScheduledDate: order.currentScheduledDate,
  }

  const { downstream } = await applyRecomputeTx(tx, {
    tenantId,
    userId,
    id: order.displayId,
    sourceData: sourceForRecompute,
  })

  // Echo back who the dose was recorded under. The nurse needs to SEE the name
  // that landed on the record, not trust that the PIN they typed picked the
  // right person: a mis-typed roster row is otherwise invisible until an audit.
  const [administeredByRow] = await tx
    .select({
      displayId: users.displayId,
      firstName: users.firstName,
      lastName: users.lastName,
      licenseNumber: users.licenseNumber,
    })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.id, administeredById)))
    .limit(1)

  return {
    id: order.displayId,
    status: 'Completed',
    completedAt: now.toISOString(),
    patientId: patientDisplayId,
    serviceId: order.serviceId,
    lot,
    administeredBy: administeredByRow
      ? {
          displayId: administeredByRow.displayId,
          fullName: `${administeredByRow.firstName} ${administeredByRow.lastName}`.trim(),
          licenseNumber: administeredByRow.licenseNumber ?? null,
        }
      : null,
    downstream,
    observation: {
      id: observationDisplayId,
      durationMinutes: dto.observationMinutes,
      observeUntil: observeUntil.toISOString(),
      outcome: null,
      outcomeNotes: null,
      outcomeRecordedAt: null,
      outcomeRecordedBy: null,
      dischargedAt: null,
      dischargedBy: null,
      state: 'Observing',
    },
  }
}

export type ObservationActionDto =
  | { action: 'record_outcome'; outcome: ObservationOutcome; notes?: string | undefined }
  | { action: 'acknowledge_discharge' }

/** Update the mutable observation companion, never the immutable Completed dose. */
export async function recordObservationActionTx(
  tx: Tx,
  opts: {
    tenantId: string
    branchId: number
    orderDisplayId: string
    attestedById: number
    dto: ObservationActionDto
    now?: Date
  },
): Promise<ObservationSummary> {
  const now = opts.now ?? new Date()
  const rows = await tx.execute(sql`
    SELECT
      o.id,
      o.display_id AS "displayId",
      o.duration_minutes AS "durationMinutes",
      o.observe_until AS "observeUntil",
      o.outcome,
      o.outcome_notes AS "outcomeNotes",
      o.outcome_recorded_at AS "outcomeRecordedAt",
      o.discharged_at AS "dischargedAt"
    FROM post_administration_observations o
    JOIN clinical_orders co ON co.id = o.clinical_order_id
    WHERE co.display_id = ${opts.orderDisplayId}
      AND o.tenant_id = ${opts.tenantId}
      AND o.branch_id = ${opts.branchId}
      AND co.deleted_at IS NULL
    LIMIT 1
    FOR UPDATE OF o
  `)
  const [observation] = rows as unknown as Array<{
    id: number
    displayId: string
    durationMinutes: number
    observeUntil: Date
    outcome: ObservationOutcome | null
    outcomeNotes: string | null
    outcomeRecordedAt: Date | null
    dischargedAt: Date | null
  }>

  if (!observation) {
    throw new LifecycleError('Observation record not found', 'OBSERVATION_NOT_FOUND', 404)
  }
  if (observation.dischargedAt) {
    throw new LifecycleError('Patient discharge is already acknowledged', 'ALREADY_DISCHARGED', 409)
  }

  if (opts.dto.action === 'record_outcome') {
    if (observation.outcome) {
      throw new LifecycleError(
        'Observation outcome is already recorded',
        'OUTCOME_ALREADY_RECORDED',
        409,
      )
    }
    if (
      (opts.dto.outcome === 'Reaction' || opts.dto.outcome === 'Escalated') &&
      (opts.dto.notes?.trim().length ?? 0) < 5
    ) {
      throw new LifecycleError(
        'Document at least 5 characters for a reaction or escalation',
        'OBSERVATION_NOTES_REQUIRED',
        422,
      )
    }
    if (opts.dto.outcome === 'NoReaction' && now < observation.observeUntil) {
      throw new LifecycleError(
        'The observation period is still in progress',
        'OBSERVATION_STILL_ACTIVE',
        409,
        { observeUntil: observation.observeUntil.toISOString() },
      )
    }

    await tx
      .update(postAdministrationObservations)
      .set({
        outcome: opts.dto.outcome,
        outcomeNotes: opts.dto.notes?.trim() || null,
        outcomeRecordedAt: now,
        outcomeRecordedById: opts.attestedById,
      })
      .where(eq(postAdministrationObservations.id, observation.id))
  } else {
    if (!observation.outcome) {
      throw new LifecycleError(
        'Record the observation outcome before discharge',
        'OBSERVATION_OUTCOME_REQUIRED',
        409,
      )
    }
    await tx
      .update(postAdministrationObservations)
      .set({ dischargedAt: now, dischargedById: opts.attestedById })
      .where(eq(postAdministrationObservations.id, observation.id))
  }

  const outcomeBy = alias(users, 'observation_action_outcome_by')
  const dischargedBy = alias(users, 'observation_action_discharged_by')
  const [updated] = await tx
    .select({
      observationId: postAdministrationObservations.displayId,
      observationDurationMinutes: postAdministrationObservations.durationMinutes,
      observeUntil: postAdministrationObservations.observeUntil,
      observationOutcome: postAdministrationObservations.outcome,
      observationNotes: postAdministrationObservations.outcomeNotes,
      outcomeRecordedAt: postAdministrationObservations.outcomeRecordedAt,
      outcomeByDisplayId: outcomeBy.displayId,
      outcomeByFirstName: outcomeBy.firstName,
      outcomeByLastName: outcomeBy.lastName,
      dischargedAt: postAdministrationObservations.dischargedAt,
      dischargedByDisplayId: dischargedBy.displayId,
      dischargedByFirstName: dischargedBy.firstName,
      dischargedByLastName: dischargedBy.lastName,
    })
    .from(postAdministrationObservations)
    .leftJoin(outcomeBy, eq(postAdministrationObservations.outcomeRecordedById, outcomeBy.id))
    .leftJoin(dischargedBy, eq(postAdministrationObservations.dischargedById, dischargedBy.id))
    .where(eq(postAdministrationObservations.id, observation.id))
    .limit(1)

  const wire = updated ? observationToWire(updated, now) : null
  if (!wire) throw new Error('OBSERVATION_UPDATE_FAILED')
  return wire
}

// ── Bite-incident Day-28 cancellation ─────────────────────────────────────────

/**
 * Called when the 14-day animal observation followup records an outcome that
 * proves the animal non-rabid (AliveHealthy, or DiedNaturally + FAT=Negative).
 *
 * Finds the patient's most recent Active PSO on a Rabies PEP protocol
 * (SOT with specialty='Rabies' and code starting with 'RABIES_PEP') — note
 * catalog codes use underscores (CATALOG_CODE_REGEX rejects dashes).
 * Locates the highest dose_number clinical_order in status Scheduled or
 * Pending and cancels it, citing the bite-incident display_id.
 *
 * Must be called INSIDE an existing withTenantTx (caller provides tx).
 *
 * @param patientId Patient display_id (`PAT_…`).
 * @param biteIncidentId Bite incident display_id (`BIT_…`).
 *
 * Returns the cancelled order's display_id, or null if no cancellable order
 * was found.
 */
export async function cancelDay28ArvPepForPatient(
  tx: Tx,
  opts: {
    tenantId: string
    /** Patient display_id (`PAT_…`). */
    patientId: string
    /** Bite incident display_id (used only in the deferralReason note). */
    biteIncidentId: string
  },
): Promise<{ cancelledOrderId: string } | null> {
  const { tenantId, patientId: patientDisplayId, biteIncidentId } = opts
  const now = new Date()

  // 0. Resolve the patient display_id → bigint.
  const [patientRow] = await tx
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.tenantId, tenantId), eq(patients.displayId, patientDisplayId)))
    .limit(1)
  if (!patientRow) return null

  // 1. Find the patient's most recent Active Rabies PEP PSO.
  //    Catalog codes use underscores; the seed names the templates
  //    `RABIES_PEP_IM` / `RABIES_PEP_ID`.
  const [pso] = await tx
    .select({
      id: patientStandingOrders.id,
      templateId: patientStandingOrders.templateId,
      templateCode: standingOrderTemplates.code,
    })
    .from(patientStandingOrders)
    .innerJoin(
      standingOrderTemplates,
      eq(patientStandingOrders.templateId, standingOrderTemplates.id),
    )
    .where(
      and(
        eq(patientStandingOrders.tenantId, tenantId),
        eq(patientStandingOrders.patientId, patientRow.id),
        eq(patientStandingOrders.status, 'Active'),
        eq(standingOrderTemplates.specialty, 'Rabies'),
        // Match PEP protocols (IM or ID), not PrEP / Booster
        sql`${standingOrderTemplates.code} LIKE 'RABIES_PEP_%'`,
      ),
    )
    .orderBy(desc(patientStandingOrders.createdAt))
    .limit(1)

  if (!pso) return null

  // 2a. CLIN-cancel fix: resolve the *terminal* dose from the template — the
  //     clinical order whose dose_number equals the total item count for the
  //     template. "Highest unadministered" could be a mid-course dose if the
  //     patient missed dose N while N+1 and N+2 are still scheduled.
  const [templateTailRow] = await tx
    .select({
      totalDoses: sql<number>`COUNT(*)::int`,
    })
    .from(standingOrderTemplateItems)
    .where(
      and(
        eq(standingOrderTemplateItems.templateId, pso.templateId),
        isNull(standingOrderTemplateItems.deletedAt),
      ),
    )
  const totalDoses = templateTailRow?.totalDoses ?? 0
  if (totalDoses === 0) return null

  // 2b. Fetch the clinical order for the terminal dose.
  const [order] = await tx
    .select({
      id: clinicalOrders.id,
      displayId: clinicalOrders.displayId,
      doseNumber: clinicalOrders.doseNumber,
    })
    .from(clinicalOrders)
    .where(
      and(
        eq(clinicalOrders.tenantId, tenantId),
        eq(clinicalOrders.patientStandingOrderId, pso.id),
        eq(clinicalOrders.doseNumber, totalDoses),
        or(eq(clinicalOrders.status, 'Scheduled'), eq(clinicalOrders.status, 'Pending')),
        isNull(clinicalOrders.deletedAt),
      ),
    )
    .limit(1)

  if (!order) return null

  // 2c. Guard: all intervening doses (dose_number < totalDoses) must be
  //     resolved before we cancel the terminal dose. An unresolved mid-course
  //     dose means the course is still active and the Day-28 SOP cancel is
  //     premature.
  const [unresolvedRow] = await tx
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(clinicalOrders)
    .where(
      and(
        eq(clinicalOrders.tenantId, tenantId),
        eq(clinicalOrders.patientStandingOrderId, pso.id),
        sql`${clinicalOrders.doseNumber} < ${totalDoses}`,
        isNull(clinicalOrders.deletedAt),
        sql`${clinicalOrders.status} IN ('Scheduled', 'Pending')`,
      ),
    )

  if ((unresolvedRow?.count ?? 0) > 0) {
    // Mid-course doses are still unresolved — do not cancel the terminal dose.
    return null
  }

  // 3. Cancel the terminal order.
  await tx
    .update(clinicalOrders)
    .set({
      status: 'Cancelled',
      deferralReason: `Animal observation outcome: non-rabid. Bite incident: ${biteIncidentId}. Day-28 dose cancelled per DOH/WHO SOP.`,
      updatedAt: now,
      rowVersion: sql`${clinicalOrders.rowVersion} + 1`,
    })
    .where(and(eq(clinicalOrders.tenantId, tenantId), eq(clinicalOrders.id, order.id)))

  return { cancelledOrderId: order.displayId }
}

// Avoid unused-import warning until something else references this.
void resolveClinicalOrderId
