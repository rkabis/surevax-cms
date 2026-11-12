import { describe, expect, it } from 'vitest'
import { classifyObservationState } from '../../src/modules/scheduled_orders/observation.js'
import {
  administerBody,
  observationActionBody,
} from '../../src/modules/scheduled_orders/contract.js'

const observeUntil = new Date('2026-08-23T02:15:00.000Z')

describe('post-administration observation state', () => {
  it('captures the interim 15-minute default and permits a bounded override', () => {
    const base = {
      consentBy: 'Patient' as const,
      consentObtained: true as const,
      visVersion: 'VIS-1',
      lotId: 'LOT_AAAAAAA1',
    }
    expect(administerBody.parse(base).observationMinutes).toBe(15)
    expect(administerBody.parse({ ...base, observationMinutes: 30 }).observationMinutes).toBe(30)
    expect(administerBody.safeParse({ ...base, observationMinutes: 0 }).success).toBe(false)
  })

  it('models outcome and discharge as separate explicit actions', () => {
    expect(
      observationActionBody.parse({ action: 'record_outcome', outcome: 'NoReaction' }),
    ).toEqual({ action: 'record_outcome', outcome: 'NoReaction' })
    expect(observationActionBody.parse({ action: 'acknowledge_discharge' })).toEqual({
      action: 'acknowledge_discharge',
    })
  })

  it('becomes ready at the deadline without silently becoming discharged', () => {
    expect(
      classifyObservationState(
        { observeUntil, outcome: null, dischargedAt: null },
        new Date('2026-08-23T02:15:00.000Z'),
      ),
    ).toBe('ReadyForDischarge')
  })

  it('keeps reaction and escalation visible until an explicit discharge acknowledgement', () => {
    const now = new Date('2026-08-23T02:05:00.000Z')
    expect(
      classifyObservationState({ observeUntil, outcome: 'Reaction', dischargedAt: null }, now),
    ).toBe('Reaction')
    expect(
      classifyObservationState({ observeUntil, outcome: 'Escalated', dischargedAt: null }, now),
    ).toBe('Escalated')
  })

  it('only reports discharged when dischargedAt was persisted', () => {
    expect(
      classifyObservationState(
        {
          observeUntil,
          outcome: 'NoReaction',
          dischargedAt: new Date('2026-08-23T02:16:00.000Z'),
        },
        new Date('2026-08-23T02:20:00.000Z'),
      ),
    ).toBe('Discharged')
  })
})
