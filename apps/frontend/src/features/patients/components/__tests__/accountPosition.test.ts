import { describe, expect, it } from 'vitest'
import { formatSignedAccountPosition } from '../PatientAccountTab'

describe('signed patient-account position', () => {
  it('labels unapplied credit with a negative sign', () => {
    expect(formatSignedAccountPosition('0.00', '1478.57')).toContain('-')
  })

  it('shows a settled charge as zero rather than a negative receivable', () => {
    expect(formatSignedAccountPosition('0.00', '0.00')).not.toContain('-')
  })
})
