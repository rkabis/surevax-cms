/**
 * Canonical clinical-history/course/schedule projection.
 *
 * This is deliberately a pure projection: it neither writes a database nor
 * decides that raw AppSheet observations form a course.  The reconciliation
 * layer must first provide resolved course membership, a template identity,
 * and a planning anchor.  Keeping that boundary explicit prevents the old
 * current-row Immunization transform from silently inventing/cancelling care.
 */

import type { CanonicalDoseEvent, CanonicalEventLedger, ScheduledDoseEvent } from './eventLedger.js'
import type { SourceEnvelope } from './sourceEnvelope.js'
import type { TargetClinicalOrder, TargetPatientStandingOrder } from './targets.js'

export type ClinicalProjectionIdFactory = (kind: 'PSO' | 'ORD', stableKey: string) => string

export type PlanningAnchor = {
  /** The planning date, never an invented external administration timestamp. */
  at: string
  basis: 'known_administration' | 'source_ideal' | 'estimated_regimen_offset'
}

/**
 * A course is an already reconciled episode.  `eventIds` are intentionally
 * explicit: the event ledger has facts, not enough context to infer which two
 * same-patient events are one bite episode versus a later exposure.
 */
export type ResolvedClinicalCourse = {
  courseId: string
  patientLegacyId: string
  templateId: string
  initiatingEncounterLegacyId: string
  planningAnchor: PlanningAnchor
  /** The target does not infer a route from a brand or an external note. */
  route?: TargetClinicalOrder['administrationRoute']
  indication?: string | null
  eventIds: readonly string[]
  /** Only a reconciliation decision can close a course with no remaining slots. */
  completionConfirmed?: boolean
}

/** All affirmative values block an automatic E43 Missed transition. */
export type MissedEvaluationGuard = {
  scheduledEventId: string
  hasAttributableRemark?: boolean
  isRescheduled?: boolean
  isCancelled?: boolean
  isRefused?: boolean
  isDeferred?: boolean
  hasDuplicateOrRecreatedConflict?: boolean
  hasLaterDoseAmbiguity?: boolean
}

export type ClinicalProjectionInput = {
  tenantId: string
  ledger: CanonicalEventLedger
  courses: readonly ResolvedClinicalCourse[]
  /** The migration freeze/evaluation moment.  E43 uses its Manila calendar date. */
  evaluatedAt: Date
  missedGuards?: ReadonlyMap<string, MissedEvaluationGuard>
  idFactory: ClinicalProjectionIdFactory
}

export type ClinicalProjectionBlock = {
  code:
    | 'COURSE_EVENT_MISSING'
    | 'COURSE_EVENT_DUPLICATED'
    | 'COURSE_PATIENT_MISMATCH'
    | 'INVALID_PLANNING_ANCHOR'
    | 'INVALID_EVENT_DATE'
    | 'UNPLACED_EVENT'
    | 'DUPLICATE_ADMINISTRATION_EVIDENCE'
    | 'DUPLICATE_SCHEDULE_EVIDENCE'
    | 'E43_GUARD_MISSING'
    | 'E43_GUARD_BLOCKED'
  courseId: string
  eventIds: string[]
  summary: string
}

export type ClinicalOrderProvenance = {
  courseId: string
  sourceEventIds: string[]
  evidence: SourceEnvelope[]
  planningAnchor: PlanningAnchor
  scheduleBasis: ScheduledDoseEvent['scheduleBasis'] | null
  statusDerivation:
    | 'local_administration'
    | 'external_administration_exact_date'
    | 'external_administration_unknown_date'
    | 'scheduled'
    | 'missed_after_30_full_manila_days'
  missedEvaluation?: {
    reason: 'AUTO_MISSED_30_DAYS_NO_EVIDENCE'
    evaluatedAt: string
    scheduledDate: string
    fullManilaDaysElapsed: number
  }
}

export type ProjectedClinicalOrder = {
  stableKey: string
  target: TargetClinicalOrder
  provenance: ClinicalOrderProvenance
}

export type ProjectedPatientStandingOrder = {
  stableKey: string
  target: TargetPatientStandingOrder
  provenance: {
    courseId: string
    sourceEventIds: string[]
    evidence: SourceEnvelope[]
    planningAnchor: PlanningAnchor
  }
}

export type CanonicalClinicalProjection = {
  patientStandingOrders: ProjectedPatientStandingOrder[]
  clinicalOrders: ProjectedClinicalOrder[]
  blocks: ClinicalProjectionBlock[]
}

type LogicalSlot = {
  serviceId: string
  doseNumber: number
  events: CanonicalDoseEvent[]
}

const MANILA_TIME_ZONE = 'Asia/Manila'
const MS_PER_DAY = 86_400_000

/**
 * Build only the clinical rows supported by canonical facts.  In particular,
 * this function never fills a missing interior dose from a template and never
 * maps a past source date to Cancelled.
 */
export function projectCanonicalClinicalHistory(
  input: ClinicalProjectionInput,
): CanonicalClinicalProjection {
  const eventById = new Map(input.ledger.events.map((event) => [event.eventId, event]))
  const claimedEventCourse = new Map<string, string>()
  const patientStandingOrders: ProjectedPatientStandingOrder[] = []
  const clinicalOrders: ProjectedClinicalOrder[] = []
  const blocks: ClinicalProjectionBlock[] = []

  for (const course of input.courses) {
    const courseEvents = resolveCourseEvents(course, eventById, claimedEventCourse, blocks)
    if (!courseEvents) continue

    const planningAnchor = parseDate(course.planningAnchor.at)
    if (!planningAnchor) {
      blocks.push({
        code: 'INVALID_PLANNING_ANCHOR',
        courseId: course.courseId,
        eventIds: [...course.eventIds],
        summary: 'The course planning anchor is missing or not a valid timestamp.',
      })
      continue
    }

    const slots = groupLogicalSlots(course, courseEvents, blocks)
    const psoStableKey = `PSO::${course.courseId}`
    const courseOrders: ProjectedClinicalOrder[] = []

    for (const slot of slots) {
      const projected = projectSlot(input, course, slot, blocks)
      if (projected) courseOrders.push(projected)
    }

    // A course with no representable facts is not made live merely because a
    // caller supplied a template id.  Its individual blocks retain the reason.
    if (courseOrders.length === 0) continue

    const psoTarget: TargetPatientStandingOrder = {
      displayId: input.idFactory('PSO', psoStableKey),
      tenantId: input.tenantId,
      patientLegacyId: course.patientLegacyId,
      templateId: course.templateId,
      initiatingEncounterLegacyId: course.initiatingEncounterLegacyId,
      status:
        course.completionConfirmed &&
        courseOrders.every((order) => order.target.status === 'Completed')
          ? 'Completed'
          : 'Active',
      startDate: planningAnchor,
      endDate:
        course.completionConfirmed &&
        courseOrders.every((order) => order.target.status === 'Completed')
          ? latestCompletedAt(courseOrders)
          : null,
      legacyAppsheetId: psoStableKey,
    }

    patientStandingOrders.push({
      stableKey: psoStableKey,
      target: psoTarget,
      provenance: {
        courseId: course.courseId,
        sourceEventIds: courseEvents.map((event) => event.eventId),
        evidence: dedupeEvidence(courseEvents),
        planningAnchor: course.planningAnchor,
      },
    })
    clinicalOrders.push(...courseOrders)
  }

  return { patientStandingOrders, clinicalOrders, blocks }
}

function resolveCourseEvents(
  course: ResolvedClinicalCourse,
  eventById: ReadonlyMap<string, CanonicalDoseEvent>,
  claimedEventCourse: Map<string, string>,
  blocks: ClinicalProjectionBlock[],
): CanonicalDoseEvent[] | null {
  const events: CanonicalDoseEvent[] = []
  const seen = new Set<string>()
  const pendingClaims: string[] = []
  for (const eventId of course.eventIds) {
    if (seen.has(eventId)) {
      blocks.push({
        code: 'COURSE_EVENT_DUPLICATED',
        courseId: course.courseId,
        eventIds: [eventId],
        summary: 'A canonical event was listed twice in the same resolved course.',
      })
      return null
    }
    seen.add(eventId)
    const event = eventById.get(eventId)
    if (!event) {
      blocks.push({
        code: 'COURSE_EVENT_MISSING',
        courseId: course.courseId,
        eventIds: [eventId],
        summary: 'The resolved course references a canonical event that is absent from the ledger.',
      })
      return null
    }
    const claimedBy = claimedEventCourse.get(eventId)
    if (claimedBy && claimedBy !== course.courseId) {
      blocks.push({
        code: 'COURSE_EVENT_DUPLICATED',
        courseId: course.courseId,
        eventIds: [eventId],
        summary: `The canonical event is already assigned to resolved course ${claimedBy}.`,
      })
      return null
    }
    if (event.patientLegacyId !== course.patientLegacyId) {
      blocks.push({
        code: 'COURSE_PATIENT_MISMATCH',
        courseId: course.courseId,
        eventIds: [eventId],
        summary: 'A course contains an event belonging to a different patient.',
      })
      return null
    }
    pendingClaims.push(eventId)
    events.push(event)
  }
  for (const eventId of pendingClaims) claimedEventCourse.set(eventId, course.courseId)
  return events
}

function groupLogicalSlots(
  course: ResolvedClinicalCourse,
  events: CanonicalDoseEvent[],
  blocks: ClinicalProjectionBlock[],
): LogicalSlot[] {
  const bySlot = new Map<string, LogicalSlot>()
  for (const event of events) {
    if (event.doseNumber === null || event.doseNumber < 1) {
      blocks.push({
        code: 'UNPLACED_EVENT',
        courseId: course.courseId,
        eventIds: [event.eventId],
        summary:
          'A canonical clinical event has no positive dose position, so it cannot be placed in this course.',
      })
      continue
    }
    const key = `${event.serviceId}::${event.doseNumber}`
    const slot = bySlot.get(key) ?? {
      serviceId: event.serviceId,
      doseNumber: event.doseNumber,
      events: [],
    }
    slot.events.push(event)
    bySlot.set(key, slot)
  }
  return [...bySlot.values()].sort(
    (a, b) => a.doseNumber - b.doseNumber || a.serviceId.localeCompare(b.serviceId),
  )
}

function projectSlot(
  input: ClinicalProjectionInput,
  course: ResolvedClinicalCourse,
  slot: LogicalSlot,
  blocks: ClinicalProjectionBlock[],
): ProjectedClinicalOrder | null {
  const administrations = slot.events.filter((event) => event.kind !== 'scheduled_dose')
  const schedules = slot.events.filter(
    (event): event is ScheduledDoseEvent => event.kind === 'scheduled_dose',
  )
  if (administrations.length > 1) {
    blocks.push({
      code: 'DUPLICATE_ADMINISTRATION_EVIDENCE',
      courseId: course.courseId,
      eventIds: administrations.map((event) => event.eventId),
      summary:
        'More than one administration fact resolves to the same course dose; manual reconciliation is required.',
    })
    return null
  }
  if (schedules.length > 1) {
    blocks.push({
      code: 'DUPLICATE_SCHEDULE_EVIDENCE',
      courseId: course.courseId,
      eventIds: schedules.map((event) => event.eventId),
      summary:
        'More than one planned fact resolves to the same course dose; do not choose one automatically.',
    })
    return null
  }

  const administration = administrations[0]
  const schedule = schedules[0]
  const scheduledAt = schedule ? parseDate(schedule.scheduledAt) : null
  if (schedule && !scheduledAt) {
    blocks.push({
      code: 'INVALID_EVENT_DATE',
      courseId: course.courseId,
      eventIds: [schedule.eventId],
      summary: 'A clean planned slot does not contain a valid scheduled timestamp.',
    })
    return null
  }

  const stableKey = `ORD::${course.courseId}::${slot.serviceId}::${slot.doseNumber}`
  const target: TargetClinicalOrder = {
    displayId: input.idFactory('ORD', stableKey),
    tenantId: input.tenantId,
    serviceId: slot.serviceId,
    encounterLegacyId: null,
    patientLegacyId: course.patientLegacyId,
    patientStandingOrderLegacyId: `PSO::${course.courseId}`,
    orderType: 'Standing_Order',
    status: 'Scheduled',
    originalScheduledDate: scheduledAt,
    currentScheduledDate: scheduledAt,
    completedAt: null,
    completedAtUnknown: false,
    administeredByUserLegacyId: null,
    quantity: '1.00',
    doseNumber: slot.doseNumber,
    administrationRoute: course.route ?? null,
    administrationSite: null,
    indication: course.indication ?? null,
    administeredAtExternalClinic: false,
    externalClinicianName: null,
    externalClinicName: null,
    externalNotes: null,
    legacyAppsheetId: stableKey,
  }

  let statusDerivation: ClinicalOrderProvenance['statusDerivation'] = 'scheduled'
  let missedEvaluation: ClinicalOrderProvenance['missedEvaluation']
  if (administration) {
    if (administration.kind === 'local_administration') {
      const completedAt = parseDate(administration.administeredAt)
      if (!completedAt) {
        blocks.push({
          code: 'INVALID_EVENT_DATE',
          courseId: course.courseId,
          eventIds: [administration.eventId],
          summary: 'A local administration fact does not contain a valid administration timestamp.',
        })
        return null
      }
      target.status = 'Completed'
      target.completedAt = completedAt
      target.administrationRoute = administration.route ?? target.administrationRoute
      target.administrationSite = administration.site ?? null
      statusDerivation = 'local_administration'
    } else {
      target.status = 'Completed'
      target.administeredAtExternalClinic = true
      target.externalClinicianName = administration.externalClinicianName ?? null
      target.externalClinicName = administration.externalClinicName ?? null
      target.externalNotes = administration.externalNotes ?? null
      if (administration.datePrecision === 'unknown') {
        // E37: preserve the unknown-date fact instead of fabricating a date.
        target.completedAtUnknown = true
        statusDerivation = 'external_administration_unknown_date'
      } else {
        const completedAt = administration.administeredAt
          ? parseDate(administration.administeredAt)
          : null
        if (!completedAt) {
          blocks.push({
            code: 'INVALID_EVENT_DATE',
            courseId: course.courseId,
            eventIds: [administration.eventId],
            summary:
              'An exact-date external administration fact has no valid administration timestamp.',
          })
          return null
        }
        target.completedAt = completedAt
        statusDerivation = 'external_administration_exact_date'
      }
    }
  } else if (scheduledAt) {
    const missed = evaluateMissed(input, schedule!, scheduledAt)
    if (missed.kind === 'blocked') {
      blocks.push({
        code: missed.code,
        courseId: course.courseId,
        eventIds: [schedule!.eventId],
        summary: missed.summary,
      })
    } else if (missed.kind === 'missed') {
      target.status = 'Missed'
      statusDerivation = 'missed_after_30_full_manila_days'
      missedEvaluation = missed.evaluation
    }
  }

  return {
    stableKey,
    target,
    provenance: {
      courseId: course.courseId,
      sourceEventIds: slot.events.map((event) => event.eventId),
      evidence: dedupeEvidence(slot.events),
      planningAnchor: course.planningAnchor,
      scheduleBasis: schedule?.scheduleBasis ?? null,
      statusDerivation,
      ...(missedEvaluation ? { missedEvaluation } : {}),
    },
  }
}

type MissedDecision =
  | { kind: 'scheduled' }
  | { kind: 'missed'; evaluation: NonNullable<ClinicalOrderProvenance['missedEvaluation']> }
  | { kind: 'blocked'; code: 'E43_GUARD_MISSING' | 'E43_GUARD_BLOCKED'; summary: string }

function evaluateMissed(
  input: ClinicalProjectionInput,
  schedule: ScheduledDoseEvent,
  scheduledAt: Date,
): MissedDecision {
  const days = fullManilaDaysElapsed(scheduledAt, input.evaluatedAt)
  if (days < 31) return { kind: 'scheduled' }

  const guard = input.missedGuards?.get(schedule.eventId)
  if (!guard) {
    return {
      kind: 'blocked',
      code: 'E43_GUARD_MISSING',
      summary:
        'The slot is at the Day-31 threshold but its E43 evidence checks were not supplied; it remains Scheduled.',
    }
  }
  const blockers: Array<[keyof Omit<MissedEvaluationGuard, 'scheduledEventId'>, string]> = [
    ['hasAttributableRemark', 'attributable remark'],
    ['isRescheduled', 'reschedule'],
    ['isCancelled', 'cancellation'],
    ['isRefused', 'refusal'],
    ['isDeferred', 'deferral'],
    ['hasDuplicateOrRecreatedConflict', 'duplicate or recreated-row conflict'],
    ['hasLaterDoseAmbiguity', 'later-dose ambiguity'],
  ]
  const present = blockers.filter(([field]) => guard[field]).map(([, label]) => label)
  if (present.length > 0) {
    return {
      kind: 'blocked',
      code: 'E43_GUARD_BLOCKED',
      summary: `The Day-31 slot remains Scheduled because E43 found ${present.join(', ')}.`,
    }
  }
  return {
    kind: 'missed',
    evaluation: {
      reason: 'AUTO_MISSED_30_DAYS_NO_EVIDENCE',
      evaluatedAt: input.evaluatedAt.toISOString(),
      scheduledDate: manilaDate(scheduledAt),
      fullManilaDaysElapsed: days,
    },
  }
}

function fullManilaDaysElapsed(from: Date, to: Date): number {
  const fromDay = new Date(`${manilaDate(from)}T00:00:00.000Z`).getTime()
  const toDay = new Date(`${manilaDate(to)}T00:00:00.000Z`).getTime()
  return Math.floor((toDay - fromDay) / MS_PER_DAY)
}

function manilaDate(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MANILA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

function parseDate(value: string): Date | null {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function latestCompletedAt(orders: ProjectedClinicalOrder[]): Date | null {
  const dates = orders
    .map((order) => order.target.completedAt)
    .filter((date): date is Date => date !== null)
  if (dates.length !== orders.length) return null
  return new Date(Math.max(...dates.map((date) => date.getTime())))
}

function dedupeEvidence(events: readonly CanonicalDoseEvent[]): SourceEnvelope[] {
  const seen = new Set<string>()
  const result: SourceEnvelope[] = []
  for (const evidence of events.flatMap((event) => event.evidence)) {
    const key = `${evidence.source}::${evidence.fileId ?? ''}::${evidence.sheet ?? ''}::${evidence.rowId ?? evidence.rowHash ?? evidence.rowNumber ?? ''}`
    if (!seen.has(key)) {
      seen.add(key)
      result.push(evidence)
    }
  }
  return result
}

export const __testing__ = { fullManilaDaysElapsed, manilaDate }
