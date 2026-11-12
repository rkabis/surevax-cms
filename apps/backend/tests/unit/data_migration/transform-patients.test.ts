import { describe, it, expect } from 'vitest'
import { transformPatients } from '../../../src/modules/data_migration/transform/patients.js'

describe('transformPatients', () => {
  it('parses the canonical patient row', () => {
    const out = transformPatients(
      [
        {
          'Row ID': 'IDXsoZqM_w4P2Gha3HLyk8',
          p_FullName: 'Cataleya Evo Hulguin',
          p_FirstName: 'Cataleya',
          p_MiddleName: 'Evo',
          p_LastName: 'Hulguin',
          p_DateOfBirth: new Date('2015-01-02'),
          p_Gender: 'Female',
          p_ContactNumber: 9950141138,
          p_HomeAddress: 'Holy Spirit, QC',
          p_DateFirstVisit: new Date('2024-07-29'),
          p_Branch: 'HolySpirit',
          p_HealthCard: '/data/SureVaxCMS-…/HC2 Cataleya.pdf',
          p_PetStatus: 'N/A',
          p_PetFirstARVDate: new Date('2024-07-29'),
        },
      ],
      'SVX',
    )
    expect(out).toHaveLength(1)
    const p = out[0]!
    expect(p.firstName).toBe('Cataleya')
    expect(p.lastName).toBe('Hulguin')
    expect(p.sex).toBe('Female')
    expect(p.contactNumber).toBe('+639950141138')
    expect(p.homeBranchDisplayId).toBe('HolySpirit')
    // B2 — health-card URL is dropped. Reversed B3 preserves animal-bite facts.
    expect(p.onboardingData).not.toHaveProperty('legacyHealthCardUrl')
    expect(p.onboardingData).toMatchObject({
      legacyBitingAnimal: { status: 'N/A' },
      legacyHumanFirstArvDate: '2024-07-29',
    })
    expect(p.onboardingData).not.toHaveProperty('legacyBiteCategory')
    expect(p.mrnSeq).toBe(1)
  })

  it('assigns MRN sequence in chronological first-visit order', () => {
    const out = transformPatients(
      [
        {
          'Row ID': 'B',
          p_FirstName: 'Later',
          p_LastName: 'Visit',
          p_DateFirstVisit: new Date('2024-10-01'),
        },
        {
          'Row ID': 'A',
          p_FirstName: 'Earlier',
          p_LastName: 'Visit',
          p_DateFirstVisit: new Date('2024-07-29'),
        },
      ],
      'SVX',
    )
    expect(out[0]!.legacyAppsheetId).toBe('A')
    expect(out[0]!.mrnSeq).toBe(1)
    expect(out[1]!.mrnSeq).toBe(2)
  })

  it('takes the first branch when p_Branch is a comma list', () => {
    const out = transformPatients(
      [
        {
          'Row ID': 'k',
          p_FirstName: 'Multi',
          p_LastName: 'Branch',
          p_Branch: 'HolySpirit, Timog, Aguirre',
        },
      ],
      'SVX',
    )
    expect(out[0]!.homeBranchDisplayId).toBe('HolySpirit')
  })

  it('drops rows that have no first or last name', () => {
    const out = transformPatients(
      [{ 'Row ID': 'k', p_FirstName: null, p_LastName: null, p_FullName: 'JustOne' }],
      'SVX',
    )
    expect(out).toHaveLength(0)
  })
})
