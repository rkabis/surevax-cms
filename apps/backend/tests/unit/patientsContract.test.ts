import { describe, expect, it } from 'vitest'
import {
  createPatientBody,
  updatePatientBody,
  verifyExternalImmunizationBody,
} from '../../src/modules/patients/contract.js'

const registration = {
  firstName: 'Maria',
  lastName: 'Santos',
  consentBy: 'Patient' as const,
  consentObtained: true as const,
}

describe('direct patient registration consent contract', () => {
  it('requires explicit patient-or-guardian consent attestation', () => {
    expect(createPatientBody.safeParse(registration).success).toBe(true)
    expect(createPatientBody.safeParse({ firstName: 'Maria', lastName: 'Santos' }).success).toBe(
      false,
    )
    expect(createPatientBody.safeParse({ ...registration, consentObtained: false }).success).toBe(
      false,
    )
    expect(createPatientBody.safeParse({ ...registration, consentBy: 'Staff' }).success).toBe(false)
  })

  it('does not require a fresh consent attestation for demographic edits', () => {
    expect(updatePatientBody.safeParse({ firstName: 'Mariel' }).success).toBe(true)
  })
})

describe('external immunization verification contract', () => {
  it('supports clinician self-attestation and validates a named reviewer PIN', () => {
    expect(verifyExternalImmunizationBody.safeParse({}).success).toBe(true)
    expect(
      verifyExternalImmunizationBody.safeParse({
        reviewedById: 'USR_AAAAAAA1',
        attestationPin: '1234',
      }).success,
    ).toBe(true)
    expect(
      verifyExternalImmunizationBody.safeParse({
        reviewedById: 'USR_AAAAAAA1',
        attestationPin: '12',
      }).success,
    ).toBe(false)
  })
})
