import { describe, expect, it } from 'vitest'
import { shouldCancelDay28ForAnimalOutcome } from '../../src/modules/bite_incidents/outcomeSemantics.js'

describe('animal outcome Day-28 semantics', () => {
  it('cancels only for healthy Day-14 observation or natural death with negative FAT', () => {
    expect(shouldCancelDay28ForAnimalOutcome('AliveHealthy', null)).toBe(true)
    expect(shouldCancelDay28ForAnimalOutcome('DiedNaturally', 'Negative')).toBe(true)
    expect(shouldCancelDay28ForAnimalOutcome('DiedNaturally', 'Pending')).toBe(false)
  })

  it('never cancels for generic confirmed death with unknown cause/testing', () => {
    expect(shouldCancelDay28ForAnimalOutcome('DiedUnknownCause', null)).toBe(false)
    expect(shouldCancelDay28ForAnimalOutcome('DiedUnknownCause', 'Negative')).toBe(false)
  })
})
