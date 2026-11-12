import { deterministicMigrationDisplayId } from './deterministicTargets.js'
import { projectCanonicalClinicalHistory } from './canonicalClinicalProjection.js'
import { dateOnly, str } from './normalize.js'
import {
  resolveRabiesClinicalCourses,
  type CourseResolutionBlock,
} from './resolveRabiesClinicalCourses.js'
import type { CanonicalDoseEvent } from './eventLedger.js'
import type { LoadPlan, TargetClinicalOrder, TargetEncounter } from './targets.js'
import type { SourceBundle } from './types.js'

export type CanonicalClinicalPlan = {
  encounters: TargetEncounter[]
  patientStandingOrders: LoadPlan['patientStandingOrders']
  clinicalOrders: LoadPlan['clinicalOrders']
  blocks: CourseResolutionBlock[]
  projectionBlocks: ReturnType<typeof projectCanonicalClinicalHistory>['blocks']
  counts: {
    courses: number
    standingOrders: number
    courseOrders: number
    adHocAdministrationOrders: number
    supplementalEncounters: number
    missedOrders: number
    scheduledOrders: number
    completedOrders: number
    unknownDateExternalOrders: number
    unassignedExternalEventsWithheld: number
    duplicateCanonicalEventsCollapsed: number
    conflictingCanonicalEventIdsWithheld: number
    invalidCanonicalAdministrationDatesWithheld: number
  }
  resolutionCounts: ReturnType<typeof resolveRabiesClinicalCourses>['counts']
}

/** Convert the reconciled dose ledger into loadable clinical domain rows. */
export function buildCanonicalClinicalPlan(input: {
  source: SourceBundle
  ledger: Parameters<typeof resolveRabiesClinicalCourses>[0]['ledger']
  basePlan: LoadPlan
  tenantId: string
  evaluatedAt: Date
}): CanonicalClinicalPlan {
  const consolidated = consolidateCanonicalEvents(input.ledger.events)
  const dateChecked = filterCanonicalEventDates(consolidated.events, input.evaluatedAt)
  const canonicalLedger = {
    events: dateChecked.events,
    exceptions: input.ledger.exceptions,
  }
  const encounterByKey = new Map(
    input.basePlan.encounters.map((encounter) => [encounter.legacyAppsheetId, encounter]),
  )
  const resolution = resolveRabiesClinicalCourses({
    source: input.source,
    ledger: canonicalLedger,
    existingEncounterLegacyIds: new Set(encounterByKey.keys()),
    cutoffAt: input.evaluatedAt,
  })
  const projection = projectCanonicalClinicalHistory({
    tenantId: input.tenantId,
    ledger: resolution.ledger,
    courses: resolution.courses,
    evaluatedAt: input.evaluatedAt,
    missedGuards: resolution.missedGuards,
    idFactory: (kind, stableKey) => deterministicMigrationDisplayId(kind, stableKey),
  })

  const sourceImmunizationById = new Map(
    input.source.Immunization.map((row) => [str(row['Row ID']), row]),
  )
  const supplementalEncounters = new Map<string, TargetEncounter>()
  const ensureEncounter = (event: CanonicalDoseEvent): string | null => {
    if (event.kind !== 'local_administration' || !event.branchLegacyId) return null
    const administeredAt = new Date(event.administeredAt)
    const date = dateOnly(administeredAt)
    if (!date) return null
    const key = `${event.patientLegacyId}::${event.branchLegacyId}::${date}`
    if (encounterByKey.has(key) || supplementalEncounters.has(key)) return key
    const sourceRow = event.evidence
      .map((evidence) => (evidence.rowId ? sourceImmunizationById.get(evidence.rowId) : undefined))
      .find((row) => row !== undefined)
    supplementalEncounters.set(key, {
      displayId: deterministicMigrationDisplayId('ENC', key),
      tenantId: input.tenantId,
      patientLegacyId: event.patientLegacyId,
      branchDisplayId: event.branchLegacyId,
      specialty:
        event.serviceId.startsWith('ARV') || ['ERIG', 'HRIG'].includes(event.serviceId)
          ? 'Rabies'
          : 'Vaccination',
      status: 'Completed',
      startedAt: administeredAt,
      completedAt: administeredAt,
      attendingUserLegacyId: sourceRow ? str(sourceRow.i_NurseRef) : null,
      triageCategory: null,
      clinicalNotes: {
        migration: {
          reason: 'canonical_administration_without_appsheet_encounter',
          sourceEventId: event.eventId,
          branchBasis: event.evidence.some((evidence) => evidence.source === 'manual_sales_tracker')
            ? 'workbook_title'
            : 'appsheet_branch',
        },
      },
      specialtyData: null,
      legacyAppsheetId: key,
    })
    return key
  }

  const eventById = new Map(resolution.ledger.events.map((event) => [event.eventId, event]))
  const assignedEventIds = new Set(resolution.courses.flatMap((course) => course.eventIds))
  const courseOrders = projection.clinicalOrders.map((projected) => {
    const administration = projected.provenance.sourceEventIds
      .map((eventId) => eventById.get(eventId))
      .find((event) => event?.kind === 'local_administration')
    const encounterLegacyId = administration ? ensureEncounter(administration) : null
    return {
      ...projected.target,
      encounterLegacyId,
      notes: clinicalNotes(projected.provenance),
    }
  })

  const adHocOrders: TargetClinicalOrder[] = []
  let unassignedExternalEventsWithheld = 0
  for (const event of resolution.ledger.events) {
    if (assignedEventIds.has(event.eventId) || event.kind === 'scheduled_dose') continue
    if (event.kind === 'external_administration') {
      // Unknown-date E33 facts belong in a resolved rabies course. If course
      // resolution failed, retaining the ledger evidence is safer than an
      // orphan completed order with an invented episode.
      unassignedExternalEventsWithheld += 1
      continue
    }
    const stableKey = `ORD::EVENT::${event.eventId}`
    const sourceRow = event.evidence
      .map((evidence) => (evidence.rowId ? sourceImmunizationById.get(evidence.rowId) : undefined))
      .find((row) => row !== undefined)
    const completedAt = new Date(event.administeredAt)
    adHocOrders.push({
      displayId: deterministicMigrationDisplayId('ORD', stableKey),
      tenantId: input.tenantId,
      serviceId: event.serviceId,
      encounterLegacyId: ensureEncounter(event),
      patientLegacyId: event.patientLegacyId,
      patientStandingOrderLegacyId: null,
      orderType: 'Ad_Hoc',
      status: 'Completed',
      originalScheduledDate: completedAt,
      currentScheduledDate: completedAt,
      completedAt,
      completedAtUnknown: false,
      administeredByUserLegacyId: sourceRow ? str(sourceRow.i_NurseRef) : null,
      quantity: '1.00',
      doseNumber: event.doseNumber,
      administrationRoute: event.route ?? null,
      administrationSite: event.site ?? null,
      indication: null,
      administeredAtExternalClinic: false,
      externalClinicianName: null,
      externalClinicName: null,
      externalNotes: null,
      notes: {
        migration: {
          projection: 'canonical_unassigned_administration',
          sourceEventIds: [event.eventId],
          confidence: event.confidence,
          evidence: event.evidence,
          brandSnapshot: event.brandSnapshot ?? null,
          linkedTransactionLegacyId: event.linkedTransactionLegacyId ?? null,
        },
      },
      legacyAppsheetId: stableKey,
    })
  }

  const clinicalOrders = [...courseOrders, ...adHocOrders]
  return {
    encounters: [...input.basePlan.encounters, ...supplementalEncounters.values()],
    patientStandingOrders: projection.patientStandingOrders.map((projected) => projected.target),
    clinicalOrders,
    blocks: resolution.blocks,
    projectionBlocks: projection.blocks,
    counts: {
      courses: resolution.courses.length,
      standingOrders: projection.patientStandingOrders.length,
      courseOrders: courseOrders.length,
      adHocAdministrationOrders: adHocOrders.length,
      supplementalEncounters: supplementalEncounters.size,
      missedOrders: clinicalOrders.filter((order) => order.status === 'Missed').length,
      scheduledOrders: clinicalOrders.filter((order) => order.status === 'Scheduled').length,
      completedOrders: clinicalOrders.filter((order) => order.status === 'Completed').length,
      unknownDateExternalOrders: clinicalOrders.filter((order) => order.completedAtUnknown).length,
      unassignedExternalEventsWithheld,
      duplicateCanonicalEventsCollapsed: consolidated.duplicateEventsCollapsed,
      conflictingCanonicalEventIdsWithheld: consolidated.conflictingEventsWithheld,
      invalidCanonicalAdministrationDatesWithheld: dateChecked.eventsWithheld,
    },
    resolutionCounts: resolution.counts,
  }
}

function filterCanonicalEventDates(
  events: readonly CanonicalDoseEvent[],
  cutoffAt: Date,
): {
  events: CanonicalDoseEvent[]
  eventsWithheld: number
} {
  const earliest = new Date('1900-01-01T00:00:00.000Z')
  const accepted: CanonicalDoseEvent[] = []
  let eventsWithheld = 0
  for (const event of events) {
    const raw = event.kind === 'scheduled_dose' ? event.scheduledAt : event.administeredAt
    if (raw === null) {
      accepted.push(event)
      continue
    }
    const date = new Date(raw)
    if (Number.isNaN(date.getTime()) || date < earliest || date > cutoffAt) {
      eventsWithheld += 1
      continue
    }
    accepted.push(event)
  }
  return { events: accepted, eventsWithheld }
}

function consolidateCanonicalEvents(events: readonly CanonicalDoseEvent[]): {
  events: CanonicalDoseEvent[]
  duplicateEventsCollapsed: number
  conflictingEventsWithheld: number
} {
  const byId = new Map<string, CanonicalDoseEvent[]>()
  for (const event of events) byId.set(event.eventId, [...(byId.get(event.eventId) ?? []), event])
  const result: CanonicalDoseEvent[] = []
  let duplicateEventsCollapsed = 0
  let conflictingEventsWithheld = 0
  for (const sameId of byId.values()) {
    if (sameId.length === 1) {
      result.push(sameId[0]!)
      continue
    }
    const signatures = new Set(sameId.map(eventFactSignature))
    if (signatures.size !== 1) {
      conflictingEventsWithheld += sameId.length
      continue
    }
    duplicateEventsCollapsed += sameId.length - 1
    const first = sameId[0]!
    const evidence = new Map<string, CanonicalDoseEvent['evidence'][number]>()
    for (const item of sameId.flatMap((event) => event.evidence)) {
      const key = [
        item.source,
        item.fileId ?? '',
        item.sheet ?? '',
        item.rowId ?? '',
        item.rowHash ?? '',
        item.rowNumber ?? '',
      ].join('::')
      evidence.set(key, item)
    }
    result.push({ ...first, evidence: [...evidence.values()] } as CanonicalDoseEvent)
  }
  return { events: result, duplicateEventsCollapsed, conflictingEventsWithheld }
}

function eventFactSignature(event: CanonicalDoseEvent): string {
  const { evidence: _evidence, ...fact } = event
  return JSON.stringify(fact, Object.keys(fact).sort())
}

function clinicalNotes(
  provenance: ReturnType<
    typeof projectCanonicalClinicalHistory
  >['clinicalOrders'][number]['provenance'],
): Record<string, unknown> {
  return {
    migration: {
      projection: 'canonical_course_slot',
      courseId: provenance.courseId,
      sourceEventIds: provenance.sourceEventIds,
      evidence: provenance.evidence,
      planningAnchor: provenance.planningAnchor,
      scheduleBasis: provenance.scheduleBasis,
      statusDerivation: provenance.statusDerivation,
      missedEvaluation: provenance.missedEvaluation ?? null,
      intradermalLegacyRepresentation: 'one_source_row_is_one_two_site_visit',
    },
  }
}
