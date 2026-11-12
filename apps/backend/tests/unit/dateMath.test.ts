/**
 * Unit tests for scheduled-order downstream projection (dateMath.ts).
 *
 * Pure math — no DB. Regression coverage for the nurse-test §5 off-by-one:
 * the anchor (completedAt) is a UTC timestamp, but scheduled dates are
 * date-only. Administering before 08:00 Manila time put the anchor on the
 * previous UTC date, so every downstream dose shifted one day early.
 */
import { describe, it, expect } from 'vitest'
import {
  projectDownstream,
  clinicCalendarDate,
  clinicDayTimestampWindow,
  upcomingClinicDaysWindow,
  classifyOrderPriority,
  changedDownstreamProjections,
  type TemplateItem,
  type SiblingOrder,
} from '../../src/modules/scheduled_orders/dateMath.js'

// PEP IM 0-3-7-14-28 template, one item per dose.
const PEP_IM_ITEMS: TemplateItem[] = [0, 3, 7, 14, 28].map((dayOffset, i) => ({
  serviceId: 'ARVPEP_IM',
  dayOffset,
  sequence: i + 1,
}))

// Aguilar fixture: started May 30 → original dates May 30 / Jun 2 / Jun 6 / Jun 13 / Jun 27.
function aguilarSiblings(): SiblingOrder[] {
  const dates = ['2026-05-30', '2026-06-02', '2026-06-06', '2026-06-13', '2026-06-27']
  return dates.map((d, i) => ({
    id: i + 1,
    displayId: `ORD_AGUILAR0${i + 1}`,
    doseNumber: i + 1,
    serviceId: 'ARVPEP_IM',
    status: i === 0 ? 'Completed' : 'Pending',
    currentScheduledDate: new Date(`${d}T00:00:00Z`),
  }))
}

const DOSE_2 = { id: 2, displayId: 'ORD_AGUILAR02', doseNumber: 2, serviceId: 'ARVPEP_IM' }

describe('clinicCalendarDate — Manila calendar normalization', () => {
  it('maps a pre-08:00 Manila timestamp (previous UTC date) to the Manila date', () => {
    // 07:00 June 6 Manila = 23:00 June 5 UTC
    expect(clinicCalendarDate(new Date('2026-06-05T23:00:00Z')).toISOString()).toBe(
      '2026-06-06T00:00:00.000Z',
    )
  })

  it('keeps date-only (UTC midnight) values stable', () => {
    expect(clinicCalendarDate(new Date('2026-06-06T00:00:00Z')).toISOString()).toBe(
      '2026-06-06T00:00:00.000Z',
    )
  })
})

describe('classifyOrderPriority — one Manila-local state', () => {
  const now = new Date('2026-08-23T01:00:00Z') // 09:00 PHT

  it.each([
    ['Scheduled', '2026-08-22', 'overdue'],
    ['Pending', '2026-08-23', 'due'],
    ['Scheduled', '2026-08-24', 'upcoming'],
    ['Completed', '2026-08-22', 'completed'],
    ['Missed', '2026-08-23', 'missed'],
    ['Cancelled', '2026-08-24', 'cancelled'],
  ])('classifies %s on %s as %s', (status, date, expected) => {
    expect(classifyOrderPriority(status, new Date(`${date}T00:00:00Z`), now)).toBe(expected)
  })
})

describe('upcomingClinicDaysWindow — nurse reminder bounds', () => {
  it("starts at tomorrow's Manila midnight, including the lower boundary", () => {
    // 23:30 Aug 15 UTC is already Aug 16 in Manila.
    const { startsAt } = upcomingClinicDaysWindow(new Date('2026-08-15T23:30:00Z'))

    expect(startsAt.toISOString()).toBe('2026-08-17T00:00:00.000Z')
  })

  it('excludes the third clinic day at the upper boundary', () => {
    const { endsBefore } = upcomingClinicDaysWindow(new Date('2026-08-15T23:30:00Z'))

    // The window includes Aug 17 and Aug 18 only; Aug 19 is the exclusive end.
    expect(endsBefore.toISOString()).toBe('2026-08-19T00:00:00.000Z')
  })
})

describe('clinicDayTimestampWindow — completed-dose reporting bounds', () => {
  it('covers the whole Manila day rather than the UTC calendar day', () => {
    // 00:30 Aug 16 Manila is still Aug 15 UTC, but belongs in Aug 16's
    // completed-today count at the clinic.
    const { startsAt, endsBefore } = clinicDayTimestampWindow(new Date('2026-08-15T16:30:00Z'))

    expect(startsAt.toISOString()).toBe('2026-08-15T16:00:00.000Z')
    expect(endsBefore.toISOString()).toBe('2026-08-16T16:00:00.000Z')
  })
})

describe('projectDownstream — late Dose 2 backfill (§5 regression)', () => {
  it.each([
    ['morning, 07:00 Manila (previous UTC day)', '2026-06-05T23:00:00Z'],
    ['afternoon, 14:00 Manila (same UTC day)', '2026-06-06T06:00:00Z'],
  ])('administered June 6 Manila %s → doses land Jun 10 / Jun 17 / Jul 1', (_label, anchorIso) => {
    const result = projectDownstream(PEP_IM_ITEMS, DOSE_2, aguilarSiblings(), new Date(anchorIso))

    expect(result.map((r) => r.toDate)).toEqual(['2026-06-10', '2026-06-17', '2026-07-01'])
    expect(result.map((r) => r.deltaDays)).toEqual([4, 4, 4])
    expect(result.map((r) => r.day)).toEqual([3, 4, 5])
  })

  it('on-time administration leaves downstream dates unchanged', () => {
    // Dose 2 given on its scheduled day (June 2, 10:00 Manila = 02:00 UTC).
    const result = projectDownstream(
      PEP_IM_ITEMS,
      DOSE_2,
      aguilarSiblings(),
      new Date('2026-06-02T02:00:00Z'),
    )
    expect(result.map((r) => r.toDate)).toEqual(['2026-06-06', '2026-06-13', '2026-06-27'])
    expect(result.map((r) => r.deltaDays)).toEqual([0, 0, 0])
    expect(changedDownstreamProjections(result)).toEqual([])
  })

  it('skips Completed/Cancelled siblings and upstream doses', () => {
    const siblings = aguilarSiblings()
    siblings[2]!.status = 'Cancelled'
    const result = projectDownstream(
      PEP_IM_ITEMS,
      DOSE_2,
      siblings,
      new Date('2026-06-06T06:00:00Z'),
    )
    expect(result.map((r) => r.day)).toEqual([4, 5])
  })
})
