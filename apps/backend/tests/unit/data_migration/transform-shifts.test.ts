import { describe, it, expect } from 'vitest'
import { transformShifts } from '../../../src/modules/data_migration/transform/shifts.js'

describe('transformShifts', () => {
  it('recovers branch from the email local-part', () => {
    const out = transformShifts(
      [
        {
          'Row ID': 'S1',
          ns_BranchEmail: 'surevax.timog@gmail.com',
          ns_NurseRef: 'Lorraine Rosario',
          ns_TimeIn: new Date('2025-11-01T06:48:52Z'),
          ns_TimeOut: new Date('2025-11-01T21:00:24Z'),
          ns_Location: '14.641334, 121.037671',
        },
      ],
      'SVX',
    )
    expect(out).toHaveLength(1)
    expect(out[0]!.branchDisplayId).toBe('Timog')
    expect(Number(out[0]!.totalHours)).toBeCloseTo(14.19, 1)
    expect(out[0]!.notes).toMatch(/@ 14.641334/)
  })

  it('drops rows with no clock-in', () => {
    const out = transformShifts(
      [
        {
          'Row ID': 'S2',
          ns_BranchEmail: 'surevax.hs@gmail.com',
          ns_NurseRef: 'Nobody',
          ns_TimeIn: null,
        },
      ],
      'SVX',
    )
    expect(out).toHaveLength(0)
  })

  it('drops the (0, 0) "no location" geo marker from notes', () => {
    const out = transformShifts(
      [
        {
          'Row ID': 'S3',
          ns_BranchEmail: 'surevax.hs@gmail.com',
          ns_NurseRef: 'X',
          ns_TimeIn: new Date('2025-11-01T07:00:00Z'),
          ns_Location: '0.000000, 0.000000',
        },
      ],
      'SVX',
    )
    expect(out[0]!.notes).toBeNull()
  })
})
