import { describe, it, expect } from 'vitest'
import { transformPatients } from '../../../src/modules/data_migration/transform/patients.js'

/**
 * Cross-format duplicate detection — the 15 mixed-format same-person duplicates
 * surfaced by the data analysis. Older row (earlier first-visit) is primary;
 * newer row carries mergedIntoLegacyId. Uses existing patients.merged_into_id.
 */
describe('transformPatients — duplicate detection', () => {
  it('marks the newer duplicate with mergedIntoLegacyId', () => {
    const out = transformPatients(
      [
        {
          'Row ID': '_1buNnajMt4rmg_0nu4Dz3', // UNIQUEID, older
          p_FirstName: 'Jason',
          p_LastName: 'Garganta',
          p_DateOfBirth: new Date('2000-03-11'),
          p_ContactNumber: 9179476214,
          p_DateFirstVisit: new Date('2024-10-15'),
        },
        {
          'Row ID': 'JG10938', // INITIALS_ROWNUM, newer
          p_FirstName: 'Jason',
          p_LastName: 'Garganta',
          p_DateOfBirth: new Date('2000-03-11'),
          p_ContactNumber: '09179476214',
          p_DateFirstVisit: new Date('2025-06-10'),
        },
      ],
      'SVX',
    )
    expect(out).toHaveLength(2)
    const primary = out.find((p) => p.legacyAppsheetId === '_1buNnajMt4rmg_0nu4Dz3')!
    const dup = out.find((p) => p.legacyAppsheetId === 'JG10938')!
    expect(primary.mergedIntoLegacyId).toBeNull()
    expect(dup.mergedIntoLegacyId).toBe('_1buNnajMt4rmg_0nu4Dz3')
  })

  it('does NOT merge same-name patients with different phones (false-positive guard)', () => {
    const out = transformPatients(
      [
        {
          'Row ID': 'A1',
          p_FirstName: 'Maria',
          p_LastName: 'Cruz',
          p_DateOfBirth: new Date('1990-01-01'),
          p_ContactNumber: 9171234567,
          p_DateFirstVisit: new Date('2024-08-01'),
        },
        {
          'Row ID': 'B1',
          p_FirstName: 'Maria',
          p_LastName: 'Cruz',
          p_DateOfBirth: new Date('1990-01-01'),
          p_ContactNumber: 9180000000,
          p_DateFirstVisit: new Date('2025-08-01'),
        },
      ],
      'SVX',
    )
    expect(out.every((p) => p.mergedIntoLegacyId === null)).toBe(true)
  })

  it('does NOT merge when DOB or phone is missing (safety)', () => {
    const out = transformPatients(
      [
        { 'Row ID': 'A1', p_FirstName: 'X', p_LastName: 'Y', p_ContactNumber: 9170000000 },
        { 'Row ID': 'B1', p_FirstName: 'X', p_LastName: 'Y', p_ContactNumber: 9170000000 },
      ],
      'SVX',
    )
    expect(out.every((p) => p.mergedIntoLegacyId === null)).toBe(true)
  })
})
