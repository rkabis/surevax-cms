import { describe, expect, it } from 'vitest'
import type { PatientEncounter } from '@/features/patients/api'
import { getOpenEncounterForArrival } from '../Step1Identify'

function encounter(id: string, status: string): PatientEncounter {
  return {
    id,
    specialty: 'General',
    status,
    bundleLabel: 'General consultation',
    chiefComplaint: null,
    startedAt: '2026-08-23T01:00:00.000Z',
    completedAt: null,
    providerFirstName: null,
    providerLastName: null,
  }
}

describe('arrival resume-first selection', () => {
  it('returns an existing Open encounter instead of permitting a new arrival', () => {
    expect(
      getOpenEncounterForArrival([
        encounter('ENC_COMPLETED', 'Completed'),
        encounter('ENC_OPEN', 'Open'),
      ])?.id,
    ).toBe('ENC_OPEN')
  })

  it('treats InProgress as resumable and terminal visits as safe to start after', () => {
    expect(getOpenEncounterForArrival([encounter('ENC_ACTIVE', 'InProgress')])?.id).toBe(
      'ENC_ACTIVE',
    )
    expect(
      getOpenEncounterForArrival([
        encounter('ENC_DONE', 'Completed'),
        encounter('ENC_CANCELLED', 'Cancelled'),
      ]),
    ).toBeUndefined()
  })
})
