import { describe, expect, it } from 'vitest'
import { __testing__ } from '../../../src/modules/data_migration/extract.js'

describe('XLSX extraction', () => {
  it('restores a date-formatted AppSheet Row ID to its Excel serial', () => {
    const excelSerial = 1_253_939
    const parsedDate = new Date((excelSerial - 25_569) * 86_400_000)

    expect(__testing__.rowIdValue(parsedDate, false)).toBe('1253939')
  })

  it('does not alter normal text Row IDs', () => {
    expect(__testing__.rowIdValue('PAT-123', false)).toBe('PAT-123')
  })

  it('restores Drive UNFORMATTED_VALUE date serials before transformation', () => {
    const serial = 46_520.5
    const restored = __testing__.normalizeDriveValue('t_Timestamp', serial)

    expect(restored).toEqual(new Date(Math.round((serial - 25_569) * 86_400_000)))
  })

  it('keeps non-date numeric source values numeric', () => {
    expect(__testing__.normalizeDriveValue('t_TotalAmount', 800)).toBe(800)
  })
})
