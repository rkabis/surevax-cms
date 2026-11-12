import { describe, it, expect } from 'vitest'
import {
  transformEncounters,
  synthKey,
} from '../../../src/modules/data_migration/transform/encounters.js'

describe('transformEncounters', () => {
  it('collapses same-day same-branch immunizations into one encounter', () => {
    const { encounters } = transformEncounters(
      {
        immunizations: [
          {
            'Row ID': 'I1',
            i_PatientRef: 'PAT-A',
            i_BranchRef: 'HolySpirit',
            i_NurseRef: 'NurseA',
            i_VaccineRef: 'ARVPEP_AbhayrabID',
            i_Timestamp_Actual: new Date('2024-07-29T12:00:00Z'),
            'i_IsAdministered?': true,
          },
          {
            'Row ID': 'I2',
            i_PatientRef: 'PAT-A',
            i_BranchRef: 'HolySpirit',
            i_NurseRef: 'NurseA',
            i_VaccineRef: 'ARVPEP_AbhayrabID',
            i_Timestamp_Actual: new Date('2024-07-29T13:00:00Z'),
            'i_IsAdministered?': true,
          },
        ],
        remarks: [],
        vaccineTypeByRef: new Map([['ARVPEP_AbhayrabID', 'Anti Rabies - PEP']]),
        biteCategoryByPatient: new Map([['PAT-A', '2']]),
      },
      'SVX',
    )
    expect(encounters).toHaveLength(1)
    expect(encounters[0]!.legacyAppsheetId).toBe(synthKey('PAT-A', 'HolySpirit', '2024-07-29'))
    expect(encounters[0]!.specialty).toBe('Rabies')
    expect(encounters[0]!.triageCategory).toBe('CAT-2')
    expect(encounters[0]!.status).toBe('Completed')
  })

  it('attaches matching remarks to encounter clinical_notes', () => {
    const { encounters, matchedRemarkIds } = transformEncounters(
      {
        immunizations: [
          {
            'Row ID': 'I1',
            i_PatientRef: 'PAT-A',
            i_BranchRef: 'HolySpirit',
            i_NurseRef: 'NurseA',
            i_VaccineRef: 'ARVPEP_AbhayrabID',
            i_Timestamp_Actual: new Date('2024-07-29T12:00:00Z'),
            'i_IsAdministered?': true,
          },
        ],
        remarks: [
          {
            'Row ID': 'R1',
            r_PatientRef: 'PAT-A',
            r_NurseRef: 'NurseA',
            r_Timestamp: new Date('2024-07-29T13:30:00Z'),
            r_Remarks: 'Patient tolerated well',
          },
        ],
        vaccineTypeByRef: new Map([['ARVPEP_AbhayrabID', 'Anti Rabies - PEP']]),
        biteCategoryByPatient: new Map(),
      },
      'SVX',
    )
    expect(encounters[0]!.clinicalNotes).toMatchObject({ remarks: ['Patient tolerated well'] })
    expect(matchedRemarkIds.has('R1')).toBe(true)
  })

  it('returns unmatched remark ids as orphans', () => {
    const { matchedRemarkIds } = transformEncounters(
      {
        immunizations: [
          {
            'Row ID': 'I1',
            i_PatientRef: 'PAT-A',
            i_BranchRef: 'HolySpirit',
            i_NurseRef: 'NurseA',
            i_VaccineRef: 'ARVPEP_AbhayrabID',
            i_Timestamp_Actual: new Date('2024-07-29T12:00:00Z'),
          },
        ],
        remarks: [
          {
            'Row ID': 'R1',
            r_PatientRef: 'PAT-B',
            r_NurseRef: 'NurseA',
            r_Timestamp: new Date('2024-07-29T13:30:00Z'),
            r_Remarks: 'Note for someone else',
          },
        ],
        vaccineTypeByRef: new Map([['ARVPEP_AbhayrabID', 'Anti Rabies - PEP']]),
        biteCategoryByPatient: new Map(),
      },
      'SVX',
    )
    expect(matchedRemarkIds.has('R1')).toBe(false)
  })

  it('encounter specialty defaults to Vaccination when no rabies type present', () => {
    const { encounters } = transformEncounters(
      {
        immunizations: [
          {
            'Row ID': 'I1',
            i_PatientRef: 'PAT-A',
            i_BranchRef: 'HolySpirit',
            i_NurseRef: 'NurseA',
            i_VaccineRef: 'FLU_VAX',
            i_Timestamp_Actual: new Date('2024-07-29T12:00:00Z'),
            'i_IsAdministered?': true,
          },
        ],
        remarks: [],
        vaccineTypeByRef: new Map([['FLU_VAX', 'Flu']]),
        biteCategoryByPatient: new Map([['PAT-A', '2']]),
      },
      'SVX',
    )
    expect(encounters[0]!.specialty).toBe('Vaccination')
    expect(encounters[0]!.triageCategory).toBeNull()
  })
})
