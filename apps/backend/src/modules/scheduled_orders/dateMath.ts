/**
 * Pure date-math helpers for scheduled-order downstream projection.
 * No DB calls — kept pure so unit tests can cover these without a DB fixture.
 *
 * Two-tier IDs (W3.a.4):
 *   - `SiblingOrder.id` is the internal bigint PK (used for UPDATE WHERE).
 *   - `SiblingOrder.displayId` is the public `ORD_…` string (carried through
 *      to the projection for response/audit payloads).
 *   - `DownstreamProjection.id` carries the public display_id.
 *   - `DownstreamProjection.internalId` carries the bigint for the UPDATE.
 *
 * Sibling-by-index pairing rationale: PSO siblings are sorted by `doseNumber`
 * (1, 2, 3, …) and template items by (dayOffset, sequence). The seed shape is
 * one item per dose so matching by index is the stable invariant — text PK
 * embedding never came into the equation here, the pairing is pure array
 * position. The bigint migration preserves this exact algorithm.
 */

export type TemplateItem = {
  serviceId: string
  dayOffset: number
  sequence: number
}

export type SiblingOrder = {
  id: number // bigint PK
  displayId: string // ORD_…
  doseNumber: number | null
  serviceId: string
  status: string
  currentScheduledDate: Date | null
}

export type DownstreamProjection = {
  /** Public display_id of the clinical order. */
  id: string
  /** Internal bigint PK — used by `applyRecomputeTx` for the WHERE. */
  internalId: number
  day: number
  fromDate: string // ISO date YYYY-MM-DD
  toDate: string // ISO date YYYY-MM-DD
  deltaDays: number
}

/**
 * Wire-facing projection — `internalId` stripped. The bigint PK is needed only
 * internally (by `applyRecomputeTx` for the UPDATE WHERE); it must never cross
 * the wire (display-id convention — see gotchas.md "Display IDs"). Response
 * payloads carry this shape; the internal `DownstreamProjection` stays in-process.
 */
export type DownstreamWire = Omit<DownstreamProjection, 'internalId'>

export type OrderPriorityState =
  | 'due'
  | 'overdue'
  | 'upcoming'
  | 'completed'
  | 'missed'
  | 'cancelled'
  | 'unscheduled'

/**
 * Canonical, mutually-exclusive worklist state for an order. Backfill is not
 * another state: it is the documented three-clinic-day subset of `overdue`.
 * Keeping this pure lets every API row and UI surface use the server's Manila
 * clinic day instead of reclassifying dates in the browser timezone.
 */
export function classifyOrderPriority(
  status: string,
  scheduledDate: Date | null,
  now = new Date(),
): OrderPriorityState {
  if (status === 'Completed') return 'completed'
  if (status === 'Missed') return 'missed'
  if (status === 'Cancelled') return 'cancelled'
  if (!scheduledDate) return 'unscheduled'

  const today = clinicCalendarDate(now).getTime()
  const scheduled = clinicCalendarDate(scheduledDate).getTime()
  if (scheduled < today) return 'overdue'
  if (scheduled === today) return 'due'
  return 'upcoming'
}

/** Drop the internal bigint PK before a projection goes on the wire. */
export function toDownstreamWire(p: DownstreamProjection): DownstreamWire {
  const { internalId: _internalId, ...wire } = p
  return wire
}

/** Only projections that actually move a date may be persisted as shifts. */
export function changedDownstreamProjections(
  projections: DownstreamProjection[],
): DownstreamProjection[] {
  return projections.filter((projection) => projection.deltaDays !== 0)
}

const MANILA_TZ = 'Asia/Manila'

/**
 * Normalize a point-in-time to the clinic-local (Asia/Manila) calendar date,
 * represented as UTC midnight of that date.
 *
 * The anchor for downstream projection is `completedAt` — a UTC timestamp.
 * `scheduled_date` values are date-only (midnight UTC). Mixing the two and
 * extracting dates with `toISOString().slice(0, 10)` reads the UTC calendar
 * date, so any administration before 08:00 Manila time fell on the *previous*
 * UTC date and every downstream dose landed one day early (nurse-test §5:
 * Dose 2 given June 6 produced June 9/16/30 instead of June 10/17/Jul 1).
 */
export function clinicCalendarDate(d: Date): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: MANILA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
  return new Date(`${ymd}T00:00:00Z`)
}

/**
 * Physical timestamp bounds for one Manila clinic day.
 *
 * `clinicCalendarDate` deliberately returns a UTC-midnight *date-only* value,
 * because that is how scheduled dates are persisted. Completed administrations
 * are real timestamps, however: comparing them to date-only UTC midnight
 * would exclude doses given from midnight to 08:00 Manila time. Manila has a
 * fixed +08:00 offset (no daylight saving), so use the local midnight instant
 * for timestamp filters and generated daily series.
 */
export function clinicDayTimestampWindow(now = new Date()): {
  startsAt: Date
  endsBefore: Date
} {
  const ymd = clinicCalendarDate(now).toISOString().slice(0, 10)
  const startsAt = new Date(`${ymd}T00:00:00+08:00`)
  const endsBefore = new Date(startsAt)
  endsBefore.setUTCDate(endsBefore.getUTCDate() + 1)
  return { startsAt, endsBefore }
}

/**
 * The nurse-facing reminder window: tomorrow and the following clinic day.
 *
 * `current_scheduled_date` is a date-only value represented at UTC midnight.
 * Derive both bounds from the Manila calendar, rather than the host's local
 * timezone, so a server running outside the Philippines cannot prematurely
 * add or remove a dose from the reminder worklist. The upper bound is
 * exclusive: a dose three clinic days away is not an upcoming reminder yet.
 */
export function upcomingClinicDaysWindow(now = new Date()): {
  startsAt: Date
  endsBefore: Date
} {
  const clinicToday = clinicCalendarDate(now)
  const startsAt = new Date(clinicToday)
  startsAt.setUTCDate(startsAt.getUTCDate() + 1)
  const endsBefore = new Date(clinicToday)
  endsBefore.setUTCDate(endsBefore.getUTCDate() + 3)
  return { startsAt, endsBefore }
}

/**
 * Project new `currentScheduledDate` values for all downstream siblings after
 * dose `source` is administered/anchored at `anchor`.
 *
 * Algorithm: pair the (doseNumber-sorted) siblings with the
 * (dayOffset, sequence)-sorted template items by index — the seed shape is
 * one item per dose with `sequence=1` repeated, so matching by sequence
 * alone collapses every dose onto the first item. Position-in-chain is the
 * stable invariant.
 *
 *   newDate(M) = anchor + (item[M].dayOffset - item[K].dayOffset) days
 *
 * @param items   Template items, ANY order (will be sorted internally).
 * @param source  The clinical order being anchored (bigint id + display_id).
 * @param siblings All clinical orders sharing the same patientStandingOrderId, ANY order.
 * @param anchor  The anchor date (completedAt if Completed, else currentScheduledDate).
 */
export function projectDownstream(
  items: TemplateItem[],
  source: { id: number; displayId: string; doseNumber: number | null; serviceId: string },
  siblings: SiblingOrder[],
  anchor: Date,
): DownstreamProjection[] {
  const sortedItems = [...items].sort(
    (a, b) => a.dayOffset - b.dayOffset || a.sequence - b.sequence,
  )
  // SCHED-2: pair each sibling to its template item by its 1-based doseNumber
  // (the CLIN-2 invariant — doseNumber = position in the (dayOffset, sequence)-
  // sorted schedule), NOT by array index. Index-pairing broke whenever a
  // sibling was soft-deleted/missing (every downstream pairing shifted by one)
  // and for ID 2-site regimens (which do not pair 1:1 against the raw array
  // index). Mapping each dose to sortedItems[doseNumber - 1] is gap-robust.
  const itemForDose = (doseNumber: number | null): TemplateItem | undefined =>
    doseNumber != null && doseNumber >= 1 ? sortedItems[doseNumber - 1] : undefined

  const sourceItem = itemForDose(source.doseNumber)
  if (!sourceItem) return []
  const sourceDose = source.doseNumber as number // non-null: itemForDose succeeded

  const sourceOffset = sourceItem.dayOffset
  const MS_PER_DAY = 86_400_000
  const results: DownstreamProjection[] = []

  // Project from the clinic-local calendar date of the anchor so date-only
  // arithmetic below stays on UTC-midnight values (see clinicCalendarDate).
  const anchorDay = clinicCalendarDate(anchor)

  const downstream = [...siblings]
    .filter((s) => (s.doseNumber ?? 0) > sourceDose)
    .sort((a, b) => (a.doseNumber ?? 0) - (b.doseNumber ?? 0))

  for (const sibling of downstream) {
    const sibItem = itemForDose(sibling.doseNumber)
    if (!sibItem) continue
    if (sibling.status === 'Completed' || sibling.status === 'Cancelled') continue

    const deltaMs = (sibItem.dayOffset - sourceOffset) * MS_PER_DAY
    const newDate = new Date(anchorDay.getTime() + deltaMs)
    const newDateStr = newDate.toISOString().slice(0, 10)
    const fromDateStr = sibling.currentScheduledDate
      ? sibling.currentScheduledDate.toISOString().slice(0, 10)
      : newDateStr
    const deltaDays = Math.round(
      (newDate.getTime() -
        (sibling.currentScheduledDate
          ? sibling.currentScheduledDate.getTime()
          : newDate.getTime())) /
        MS_PER_DAY,
    )

    results.push({
      id: sibling.displayId,
      internalId: sibling.id,
      day: sibling.doseNumber ?? 0,
      fromDate: fromDateStr,
      toDate: newDateStr,
      deltaDays,
    })
  }

  return results
}
