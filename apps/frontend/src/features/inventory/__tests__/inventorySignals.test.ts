import { describe, expect, it } from 'vitest'
import { lotRestrictionSignals } from '../inventorySignals'

describe('lotRestrictionSignals', () => {
  it('keeps quarantine and recall as independent, combinable dimensions', () => {
    expect(lotRestrictionSignals({ isQuarantined: true, isRecalled: true })).toEqual([
      'Quarantined',
      'Active recall',
    ])
    expect(lotRestrictionSignals({ isQuarantined: false, isRecalled: true })).toEqual([
      'Active recall',
    ])
    expect(lotRestrictionSignals({ isQuarantined: false, isRecalled: false })).toEqual([])
  })
})
