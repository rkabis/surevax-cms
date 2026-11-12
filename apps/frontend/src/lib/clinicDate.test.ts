import { describe, expect, it } from 'vitest'
import { clinicCalendarDateString } from './clinicDate'

describe('clinicCalendarDateString', () => {
  it('uses the Manila day before 08:00 PHT rather than the previous UTC date', () => {
    expect(clinicCalendarDateString(new Date('2026-08-22T16:30:00.000Z'))).toBe('2026-08-23')
  })
})
