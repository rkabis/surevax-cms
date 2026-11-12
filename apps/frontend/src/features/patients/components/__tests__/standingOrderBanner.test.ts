import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getStandingOrderBanner } from '../standingOrderBanner'
import type { StandingOrderProgress } from '../../api'
import type { ScheduledOrder } from '@/features/scheduled-orders/api'

const NOW = new Date('2026-08-16T00:00:00.000Z').getTime()

beforeAll(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterAll(() => vi.useRealTimers())

function progress(overrides: Partial<StandingOrderProgress> = {}): StandingOrderProgress {
  return {
    status: 'in-progress',
    indication: 'Post-Exposure Prophylaxis',
    completedDoses: 1,
    totalDoses: 5,
    doses: [
      {
        doseNumber: 2,
        status: 'pending',
        scheduledDate: '2026-08-17T00:00:00.000Z',
        administeredAt: null,
        label: 'Day 3',
      },
    ],
    ...overrides,
  }
}

describe('getStandingOrderBanner', () => {
  it('uses live patient worklist rows when legacy progress says not started', () => {
    const order: ScheduledOrder = {
      id: 'ORD_AAAAAA01',
      patientName: 'Patrick Herrera',
      patientMrn: 'MRN-000001',
      patientDateOfBirth: '1990-01-01',
      contactNumber: null,
      service: 'Anti-Rabies PEP — Intramuscular',
      doseNumber: 2,
      totalDoses: 5,
      scheduledDate: '2026-08-16',
      status: 'Pending',
      standingOrderName: 'Rabies PEP — Intramuscular (5-dose)',
      indication: null,
      paymentStatus: null,
      hasBlockingOverdue: false,
      priorityState: 'due',
      smsOptIn: true,
      observation: null,
    }

    expect(getStandingOrderBanner(progress({ status: 'not-started' }), NOW, [order])).toEqual({
      variant: 'due',
      label: 'Next dose: Anti-Rabies PEP — Intramuscular — due Today',
    })
  })

  it('fails visibly when the next dose is missing a due date', () => {
    const pendingDose = {
      doseNumber: 2,
      status: 'pending' as const,
      scheduledDate: null,
      administeredAt: null,
      label: 'Day 3',
    }
    const banner = getStandingOrderBanner(progress({ doses: [pendingDose] }), NOW)

    expect(banner).toEqual({
      variant: 'overdue',
      label: 'Schedule details incomplete (due date) — review before administering',
    })
  })

  it('fails visibly when the course indication is missing', () => {
    const banner = getStandingOrderBanner(progress({ indication: null }), NOW)

    expect(banner).toEqual({
      variant: 'overdue',
      label: 'Schedule details incomplete (indication) — review before administering',
    })
  })

  it('reports a completed course without inventing another dose', () => {
    const banner = getStandingOrderBanner(progress({ status: 'completed', doses: [] }), NOW)

    expect(banner).toEqual({ variant: 'ok', label: 'Standing order complete' })
  })

  it('reports no active standing order for an unstarted or absent course', () => {
    expect(getStandingOrderBanner(progress({ status: 'not-started' }), NOW)).toEqual({
      variant: 'secondary',
      label: 'No active standing order',
    })
    expect(getStandingOrderBanner(undefined, NOW)).toEqual({
      variant: 'secondary',
      label: 'No active standing order',
    })
  })
})
