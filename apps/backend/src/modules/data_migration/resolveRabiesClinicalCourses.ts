import { createHash } from 'node:crypto'

import { bool, dateOnly, str, ts } from './normalize.js'
import type { CanonicalDoseEvent, CanonicalEventLedger, ScheduledDoseEvent } from './eventLedger.js'
import type {
  MissedEvaluationGuard,
  ResolvedClinicalCourse,
} from './canonicalClinicalProjection.js'
import type { SourceEnvelope } from './sourceEnvelope.js'
import type { SourceBundle, SrcImmunization } from './types.js'

type RabiesKind = 'PEP' | 'PREP' | 'BOOSTER'
type RabiesRoute = 'IM' | 'ID'

type Observation = {
  row: SrcImmunization
  rowId: string
  patientId: string
  branchId: string
  kind: RabiesKind
  route: RabiesRoute
  serviceId: string
  doseNumber: number | null
  effectiveAt: Date
  actualAt: Date | null
  idealAt: Date | null
  administered: boolean
}

export type CourseResolutionBlock = {
  code:
    | 'RABIES_ROW_UNPLACEABLE'
    | 'RABIES_DUPLICATE_SLOT'
    | 'RABIES_EXTRA_SLOT'
    | 'RABIES_INTERIOR_GAP'
    | 'RABIES_ADMINISTRATION_EVENT_MISSING'
    | 'RABIES_INITIATING_ENCOUNTER_MISSING'
  courseId: string | null
  sourceRowIds: string[]
  summary: string
}

export type RabiesCourseResolution = {
  ledger: CanonicalEventLedger
  courses: ResolvedClinicalCourse[]
  missedGuards: Map<string, MissedEvaluationGuard>
  blocks: CourseResolutionBlock[]
  counts: {
    sourceObservations: number
    courses: number
    explicitScheduled: number
    templateDerivedScheduled: number
    administrationsPlaced: number
    externalUnknownDoseOnePlaced: number
    interiorGapsWithheld: number
    duplicateSlotsWithheld: number
    unplaceableRowsWithheld: number
  }
}

const DAY_MS = 86_400_000
const REGIMENS: Record<`${RabiesKind}_${RabiesRoute}`, readonly number[]> = {
  PEP_IM: [0, 3, 7, 14, 28],
  PEP_ID: [0, 3, 7, 28],
  PREP_IM: [0, 7, 28],
  PREP_ID: [0, 7, 28],
  BOOSTER_IM: [0, 3],
  BOOSTER_ID: [0, 3],
}

const TEMPLATES: Record<`${RabiesKind}_${RabiesRoute}`, string> = {
  PEP_IM: 'SOT_RABIES_PEP_IM',
  PEP_ID: 'SOT_RABIES_PEP_ID',
  PREP_IM: 'SOT_RABIES_PREP_IM',
  PREP_ID: 'SOT_RABIES_PREP_ID',
  BOOSTER_IM: 'SOT_RABIES_BOOSTER_IM',
  BOOSTER_ID: 'SOT_RABIES_BOOSTER_ID',
}

/**
 * Resolve conservative rabies courses from the frozen AppSheet observations.
 *
 * The resolver deliberately does not use payments as administrations. It
 * preserves every canonical local/external fact, stages unique explicit plans,
 * derives only trailing slots, and never fills an interior gap.
 */
export function resolveRabiesClinicalCourses(input: {
  source: SourceBundle
  ledger: CanonicalEventLedger
  existingEncounterLegacyIds: ReadonlySet<string>
  cutoffAt: Date
}): RabiesCourseResolution {
  const blocks: CourseResolutionBlock[] = []
  const events = [...input.ledger.events]
  const eventIds = new Set(events.map((event) => event.eventId))
  const eventByImmunizationRow = new Map<string, CanonicalDoseEvent>()
  for (const event of events) {
    if (event.eventId.startsWith('IMM::')) eventByImmunizationRow.set(event.eventId.slice(5), event)
  }
  const remarksByPatient = new Map<string, number>()
  for (const remark of input.source.Remarks) {
    const patientId = str(remark.r_PatientRef)
    if (patientId && str(remark.r_Remarks))
      remarksByPatient.set(patientId, (remarksByPatient.get(patientId) ?? 0) + 1)
  }

  const observations = input.source.Immunization.map((row) =>
    toObservation(row, input.cutoffAt),
  ).filter((row): row is Observation => row !== null)
  const groups = new Map<string, Observation[]>()
  for (const observation of observations) {
    const key = `${observation.patientId}::${observation.kind}::${observation.route}`
    groups.set(key, [...(groups.get(key) ?? []), observation])
  }

  const courses: ResolvedClinicalCourse[] = []
  const missedGuards = new Map<string, MissedEvaluationGuard>()
  let explicitScheduled = 0
  let templateDerivedScheduled = 0
  let administrationsPlaced = 0
  let externalUnknownDoseOnePlaced = 0
  let interiorGapsWithheld = 0
  let duplicateSlotsWithheld = 0
  let unplaceableRowsWithheld = 0

  for (const grouped of groups.values()) {
    for (const episode of segment(grouped)) {
      const first = episode[0]!
      const regimenKey = `${first.kind}_${first.route}` as const
      const offsets = REGIMENS[regimenKey]
      const courseId = `RABIES::${stableToken([first.patientId, first.kind, first.route, first.rowId])}`
      const slotRows = new Map<number, Observation[]>()
      const unplaceable: Observation[] = []
      for (const observation of episode) {
        if (!observation.doseNumber || observation.doseNumber < 1) {
          unplaceable.push(observation)
          continue
        }
        if (observation.doseNumber > offsets.length) {
          blocks.push({
            code: 'RABIES_EXTRA_SLOT',
            courseId,
            sourceRowIds: [observation.rowId],
            summary:
              'The source dose position is beyond the selected regimen and is retained for manual reconciliation.',
          })
          unplaceableRowsWithheld += 1
          continue
        }
        const atSlot = slotRows.get(observation.doseNumber) ?? []
        atSlot.push(observation)
        slotRows.set(observation.doseNumber, atSlot)
      }
      if (unplaceable.length > 0) {
        blocks.push({
          code: 'RABIES_ROW_UNPLACEABLE',
          courseId,
          sourceRowIds: unplaceable.map((row) => row.rowId),
          summary:
            'A rabies observation has no numeric dose position and is not assigned by date guesswork.',
        })
        unplaceableRowsWithheld += unplaceable.length
      }

      const duplicated = new Set<number>()
      for (const [doseNumber, rows] of slotRows) {
        if (rows.length <= 1) continue
        duplicated.add(doseNumber)
        duplicateSlotsWithheld += rows.length
        blocks.push({
          code: 'RABIES_DUPLICATE_SLOT',
          courseId,
          sourceRowIds: rows.map((row) => row.rowId),
          summary:
            'More than one current source row claims the same course dose; none is selected automatically.',
        })
      }

      const uniquePositions = [...slotRows.entries()]
        .filter(([doseNumber, rows]) => rows.length === 1 && !duplicated.has(doseNumber))
        .map(([doseNumber]) => doseNumber)
        .sort((a, b) => a - b)
      if (uniquePositions.length === 0) continue
      const maxObserved = Math.max(...uniquePositions)
      const missingInterior = Array.from({ length: maxObserved }, (_, index) => index + 1).filter(
        (doseNumber) => !slotRows.has(doseNumber),
      )
      if (missingInterior.length > 0) {
        interiorGapsWithheld += missingInterior.length
        blocks.push({
          code: 'RABIES_INTERIOR_GAP',
          courseId,
          sourceRowIds: episode.map((row) => row.rowId),
          summary: `Interior dose positions ${missingInterior.join(', ')} are absent; no completed or scheduled row is invented for them.`,
        })
      }

      const doseOne = slotRows.get(1)?.length === 1 ? slotRows.get(1)![0]! : null
      const firstUnique = slotRows.get(uniquePositions[0]!)![0]!
      const anchor =
        doseOne?.actualAt ??
        doseOne?.idealAt ??
        new Date(firstUnique.effectiveAt.getTime() - offsets[firstUnique.doseNumber! - 1]! * DAY_MS)
      const initiating = earliestEncounter(episode, input.existingEncounterLegacyIds)
      if (!initiating) {
        blocks.push({
          code: 'RABIES_INITIATING_ENCOUNTER_MISSING',
          courseId,
          sourceRowIds: episode.map((row) => row.rowId),
          summary:
            'The resolved course has no imported encounter anchor and is withheld from the standing-order projection.',
        })
        continue
      }

      const courseEventIds: string[] = []
      for (const doseNumber of uniquePositions) {
        const observation = slotRows.get(doseNumber)![0]!
        if (observation.administered) {
          const canonical = eventByImmunizationRow.get(observation.rowId)
          if (!canonical) {
            blocks.push({
              code: 'RABIES_ADMINISTRATION_EVENT_MISSING',
              courseId,
              sourceRowIds: [observation.rowId],
              summary:
                'An administered source observation did not survive canonical evidence reconciliation.',
            })
            continue
          }
          courseEventIds.push(canonical.eventId)
          administrationsPlaced += 1
          continue
        }
        if (!observation.idealAt) continue
        const eventId = `SCHEDULE::${observation.rowId}`
        if (!eventIds.has(eventId)) {
          events.push(
            scheduleEvent({
              eventId,
              courseId,
              observation,
              scheduledAt: observation.idealAt,
              scheduleBasis: 'source_explicit',
              evidence: [appsheetEvidence(observation.rowId)],
            }),
          )
          eventIds.add(eventId)
        }
        courseEventIds.push(eventId)
        explicitScheduled += 1
        missedGuards.set(eventId, {
          scheduledEventId: eventId,
          hasAttributableRemark:
            !!str(observation.row.i_Remarks) ||
            (remarksByPatient.get(observation.patientId) ?? 0) > 0,
          hasLaterDoseAmbiguity: uniquePositions.some((position) => position > doseNumber),
        })
      }

      // E33 unknown-date external D1 belongs only to the PEP episode whose
      // first verified local row is the event's source evidence.
      if (first.kind === 'PEP' && !courseEventIds.some((id) => eventDose(events, id) === 1)) {
        const external = events.find(
          (event) =>
            event.kind === 'external_administration' &&
            event.patientLegacyId === first.patientId &&
            event.doseNumber === 1 &&
            event.evidence.some((evidence) => evidence.rowId === first.rowId),
        )
        if (external) {
          courseEventIds.push(external.eventId)
          externalUnknownDoseOnePlaced += 1
        }
      }

      const occupied = new Set(
        courseEventIds
          .map((id) => eventDose(events, id))
          .filter((value): value is number => value !== null),
      )
      const contiguousThrough = contiguousPrefix(occupied)
      const safeToDeriveTrailing =
        duplicated.size === 0 && unplaceable.length === 0 && missingInterior.length === 0
      if (safeToDeriveTrailing && contiguousThrough > 0) {
        const anchorEvidence = episode.flatMap((row) => [appsheetEvidence(row.rowId)])
        for (
          let doseNumber = contiguousThrough + 1;
          doseNumber <= offsets.length;
          doseNumber += 1
        ) {
          if (occupied.has(doseNumber)) continue
          const eventId = `DERIVED::${courseId}::${doseNumber}`
          const scheduledAt = new Date(anchor.getTime() + offsets[doseNumber - 1]! * DAY_MS)
          if (!eventIds.has(eventId)) {
            events.push(
              scheduleEvent({
                eventId,
                courseId,
                observation: first,
                doseNumber,
                scheduledAt,
                scheduleBasis: 'template_derived',
                evidence: anchorEvidence,
              }),
            )
            eventIds.add(eventId)
          }
          courseEventIds.push(eventId)
          templateDerivedScheduled += 1
          missedGuards.set(eventId, {
            scheduledEventId: eventId,
            hasAttributableRemark: (remarksByPatient.get(first.patientId) ?? 0) > 0,
            hasLaterDoseAmbiguity: false,
          })
        }
      }

      if (courseEventIds.length === 0) continue
      courses.push({
        courseId,
        patientLegacyId: first.patientId,
        templateId: TEMPLATES[regimenKey],
        initiatingEncounterLegacyId: initiating,
        planningAnchor: {
          at: anchor.toISOString(),
          basis: doseOne
            ? doseOne.actualAt
              ? 'known_administration'
              : 'source_ideal'
            : 'estimated_regimen_offset',
        },
        route: first.route,
        indication:
          first.kind === 'PEP'
            ? 'Post-exposure prophylaxis'
            : first.kind === 'PREP'
              ? 'Pre-exposure prophylaxis'
              : 'Rabies booster',
        eventIds: [...new Set(courseEventIds)],
        completionConfirmed:
          occupied.size === offsets.length && [...occupied].every((dose) => dose <= offsets.length),
      })
    }
  }

  return {
    ledger: { events, exceptions: [...input.ledger.exceptions] },
    courses,
    missedGuards,
    blocks,
    counts: {
      sourceObservations: observations.length,
      courses: courses.length,
      explicitScheduled,
      templateDerivedScheduled,
      administrationsPlaced,
      externalUnknownDoseOnePlaced,
      interiorGapsWithheld,
      duplicateSlotsWithheld,
      unplaceableRowsWithheld,
    },
  }
}

function toObservation(row: SrcImmunization, cutoffAt: Date): Observation | null {
  const rowId = str(row['Row ID'])
  const patientId = str(row.i_PatientRef)
  const branchId = str(row.i_BranchRef)
  const kind = rabiesKind(str(row.i_VaccineType))
  const route = rabiesRoute(str(row.i_VaccineRoute))
  const actualAt = ts(row.i_Timestamp_Actual)
  const idealAt = ts(row.i_Timestamp_Ideal)
  const effectiveAt = actualAt ?? idealAt
  if (
    !rowId ||
    !patientId ||
    !branchId ||
    !kind ||
    !route ||
    !effectiveAt ||
    !isSaneClinicalDate(effectiveAt, cutoffAt)
  )
    return null
  return {
    row,
    rowId,
    patientId,
    branchId,
    kind,
    route,
    serviceId:
      kind === 'PEP'
        ? `ARVPEP_${route}`
        : kind === 'PREP'
          ? `ARVPREP_${route}`
          : `ARVBOOSTER_${route}`,
    doseNumber: doseNumber(row),
    effectiveAt,
    actualAt,
    idealAt,
    administered: bool(row['i_IsAdministered?']) === true,
  }
}

function isSaneClinicalDate(value: Date, cutoffAt: Date): boolean {
  return value >= new Date('1900-01-01T00:00:00.000Z') && value <= cutoffAt
}

function segment(rows: Observation[]): Observation[][] {
  const sorted = [...rows].sort(
    (left, right) =>
      left.effectiveAt.getTime() - right.effectiveAt.getTime() ||
      left.rowId.localeCompare(right.rowId),
  )
  const episodes: Observation[][] = []
  let current: Observation[] = []
  let previous: Observation | null = null
  for (const observation of sorted) {
    const gapDays = observation.kind === 'BOOSTER' ? 30 : 60
    const gap = previous
      ? (observation.effectiveAt.getTime() - previous.effectiveAt.getTime()) / DAY_MS
      : 0
    const reset = observation.doseNumber === 1 && current.some((row) => row.doseNumber !== 1)
    if (current.length > 0 && (gap > gapDays || reset)) {
      episodes.push(current)
      current = []
    }
    current.push(observation)
    previous = observation
  }
  if (current.length > 0) episodes.push(current)
  return episodes
}

function earliestEncounter(rows: Observation[], encounterIds: ReadonlySet<string>): string | null {
  for (const row of [...rows].sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime())) {
    const date = dateOnly(row.actualAt) ?? dateOnly(row.idealAt)
    if (!date) continue
    const id = `${row.patientId}::${row.branchId}::${date}`
    if (encounterIds.has(id)) return id
  }
  return null
}

function scheduleEvent(input: {
  eventId: string
  courseId: string
  observation: Observation
  doseNumber?: number
  scheduledAt: Date
  scheduleBasis: ScheduledDoseEvent['scheduleBasis']
  evidence: SourceEnvelope[]
}): ScheduledDoseEvent {
  return {
    eventId: input.eventId,
    kind: 'scheduled_dose',
    patientLegacyId: input.observation.patientId,
    branchLegacyId: input.observation.branchId,
    serviceId: input.observation.serviceId,
    doseNumber: input.doseNumber ?? input.observation.doseNumber,
    confidence: 'deterministic',
    evidence: input.evidence,
    patientStandingOrderLegacyId: `PSO::${input.courseId}`,
    scheduledAt: input.scheduledAt.toISOString(),
    scheduleBasis: input.scheduleBasis,
  }
}

function eventDose(events: readonly CanonicalDoseEvent[], eventId: string): number | null {
  return events.find((event) => event.eventId === eventId)?.doseNumber ?? null
}

function contiguousPrefix(positions: ReadonlySet<number>): number {
  let result = 0
  while (positions.has(result + 1)) result += 1
  return result
}

function rabiesKind(value: string | null): RabiesKind | null {
  if (value === 'Anti Rabies - PEP') return 'PEP'
  if (value === 'Anti Rabies - PrEP') return 'PREP'
  if (value === 'Anti Rabies - Booster') return 'BOOSTER'
  return null
}

function rabiesRoute(value: string | null): RabiesRoute | null {
  const match = value?.toUpperCase().match(/\b(IM|ID)\b/)?.[1]
  return match === 'IM' || match === 'ID' ? match : null
}

function doseNumber(row: SrcImmunization): number | null {
  const label = str(row.i_Label)
  const labelDose = label?.match(/\b(\d+)(?:st|nd|rd|th)?\s+dose\b/i)?.[1]
  const raw = labelDose ?? str(row.i_DosageCount)
  if (!raw || !/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return Number.isInteger(value) ? value : null
}

function appsheetEvidence(rowId: string): SourceEnvelope {
  return {
    source: 'appsheet_immunization',
    rowId,
    rowHash: stableToken(['appsheet_immunization', rowId]),
  }
}

function stableToken(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u001f')).digest('hex').slice(0, 24)
}
