import { describe, it, expect } from 'vitest'
import { transformBranches } from '../../../src/modules/data_migration/transform/branches.js'

describe('transformBranches', () => {
  it('uses b_TransactionInitials as the 3-letter code', () => {
    const out = transformBranches(
      [
        {
          'Row ID': 'HolySpirit',
          b_Name: 'Holy Spirit',
          b_TransactionInitials: 'HST',
          b_Address: '70 Holy Spirit Dr',
          b_BranchEmail: 'surevax.hs@gmail.com',
        },
      ],
      'SVX',
    )
    expect(out).toHaveLength(1)
    expect(out[0]!.code).toBe('HST')
    expect(out[0]!.displayId).toBe('SVX.HST')
    expect(out[0]!.legacyAppsheetId).toBe('HolySpirit')
  })

  it('synthesises a code from the slug when b_TransactionInitials is missing', () => {
    const out = transformBranches([{ 'Row ID': 'Aguirre', b_Name: 'Aguirre' }], 'SVX')
    expect(out[0]!.code).toBe('AGU')
  })

  it('avoids collisions across branches', () => {
    const out = transformBranches(
      [
        { 'Row ID': 'HolySpirit', b_Name: 'Holy Spirit' },
        { 'Row ID': 'Holiday', b_Name: 'Holiday' },
      ],
      'SVX',
    )
    expect(new Set(out.map((b) => b.code)).size).toBe(2)
  })

  it('drops b_AllowAccess (no equivalent in v2)', () => {
    const out = transformBranches(
      [{ 'Row ID': 'Timog', b_Name: 'Timog', b_TransactionInitials: 'TMG', b_AllowAccess: false }],
      'SVX',
    )
    expect(out[0]).not.toHaveProperty('allowAccess')
    expect(out[0]).not.toHaveProperty('b_AllowAccess')
  })
})
