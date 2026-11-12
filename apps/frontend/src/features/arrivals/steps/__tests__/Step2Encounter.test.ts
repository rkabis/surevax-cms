import { describe, expect, it } from 'vitest'
import { encounterFormSchema } from '../Step2Encounter'

describe('encounterFormSchema', () => {
  it('requires an explicit specialty for a new arrival', () => {
    const result = encounterFormSchema.safeParse({ chiefComplaint: 'Walk-in assessment' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Select a specialty before continuing.')
    }
  })

  it('requires WHO exposure classification before a rabies encounter can continue', () => {
    const result = encounterFormSchema.safeParse({
      specialty: 'Rabies',
      chiefComplaint: 'Dog bite',
      consentBy: 'Patient',
      consentObtained: true,
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['specialtyData', 'whoCategory'],
            message: 'Select the WHO exposure category before continuing.',
          }),
        ]),
      )
    }
  })

  it('allows a non-rabies specialty without a rabies assessment', () => {
    expect(
      encounterFormSchema.safeParse({
        specialty: 'Flu',
        chiefComplaint: 'Seasonal influenza vaccination',
        consentBy: 'Patient',
        consentObtained: true,
      }).success,
    ).toBe(true)
  })

  it('requires an explicit consent attestation before protocol selection', () => {
    expect(
      encounterFormSchema.safeParse({
        specialty: 'Flu',
        chiefComplaint: 'Seasonal influenza vaccination',
        consentBy: 'Patient',
        consentObtained: false,
      }).success,
    ).toBe(false)
  })
})
