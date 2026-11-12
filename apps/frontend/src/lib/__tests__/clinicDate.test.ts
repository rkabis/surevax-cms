import { describe, expect, it } from 'vitest'

import { manilaCalendarDate } from '../clinicDate'

describe('manilaCalendarDate', () => {
  it('uses the new clinic day before 08:00 PHT even while UTC is still yesterday', () => {
    expect(manilaCalendarDate(new Date('2026-08-22T16:30:00Z'))).toBe('2026-08-23')
  })

  it('keeps the same clinic date after the UTC date rolls over', () => {
    expect(manilaCalendarDate(new Date('2026-08-23T07:00:00Z'))).toBe('2026-08-23')
  })
})
