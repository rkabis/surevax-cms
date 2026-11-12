import { describe, expect, it } from 'vitest'
import { atomicBodySchema } from '../../src/modules/arrivals/contract.js'

const baseBody = {
  patientId: 'PAT_AAAAAA01',
  templateIds: ['ARVPEP_IM'],
  consentBy: 'Patient' as const,
  consentObtained: true as const,
}

describe('arrivals atomic contract', () => {
  it('rejects an omitted specialty instead of silently creating a Rabies encounter', () => {
    expect(atomicBodySchema.safeParse(baseBody).success).toBe(false)
  })

  it('requires an explicitly attested arrival consent', () => {
    expect(atomicBodySchema.safeParse({ ...baseBody, consentObtained: false }).success).toBe(false)
  })

  it('requires a WHO category for a Rabies arrival', () => {
    expect(atomicBodySchema.safeParse({ ...baseBody, specialty: 'Rabies' }).success).toBe(false)
  })

  it('accepts a Rabies arrival when the WHO category matches triage', () => {
    expect(
      atomicBodySchema.safeParse({
        ...baseBody,
        specialty: 'Rabies',
        triageCategory: 'III',
        specialtyData: { biteAssessment: { whoCategory: 'III' } },
      }).success,
    ).toBe(true)
  })

  it('rejects a triage category that conflicts with the WHO category', () => {
    expect(
      atomicBodySchema.safeParse({
        ...baseBody,
        specialty: 'Rabies',
        triageCategory: 'II',
        specialtyData: { biteAssessment: { whoCategory: 'III' } },
      }).success,
    ).toBe(false)
  })
})
