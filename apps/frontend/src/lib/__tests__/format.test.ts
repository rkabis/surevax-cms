import { describe, expect, it } from 'vitest'
import { DASH, formatDate, formatLongDate, formatMoney, formatNumber, nullable } from '../format'

/**
 * Canonical display formatters. These are used in nearly every list cell,
 * detail rail, and receipt, so their null-coalescing + peso/date shapes are
 * pinned here. Date inputs use local-component `Date` constructors to stay
 * timezone-stable across dev (darwin) and CI (linux UTC).
 */

describe('formatMoney', () => {
  it('renders a peso amount with separators + 2 decimals', () => {
    expect(formatMoney('4820')).toBe('₱4,820.00')
    expect(formatMoney('1234.5')).toBe('₱1,234.50')
    expect(formatMoney(1000000)).toBe('₱1,000,000.00')
    expect(formatMoney('0')).toBe('₱0.00')
  })

  it('renders a numeric(12,2) string exactly (money arrives as a string)', () => {
    expect(formatMoney('2500.00')).toBe('₱2,500.00')
  })

  it('returns the em dash for null / undefined / empty / NaN', () => {
    expect(formatMoney(null)).toBe(DASH)
    expect(formatMoney(undefined)).toBe(DASH)
    expect(formatMoney('')).toBe(DASH)
    expect(formatMoney('abc')).toBe(DASH)
  })
})

describe('formatNumber', () => {
  it('formats like formatMoney but without the peso prefix', () => {
    expect(formatNumber('4820')).toBe('4,820.00')
    expect(formatNumber(null)).toBe(DASH)
  })
})

describe('formatLongDate', () => {
  it('always renders the long calendar form', () => {
    expect(formatLongDate(new Date(2026, 4, 17))).toBe('May 17, 2026')
    expect(formatLongDate(new Date(2026, 0, 1))).toBe('Jan 1, 2026')
  })

  it('returns the em dash for null / invalid', () => {
    expect(formatLongDate(null)).toBe(DASH)
    expect(formatLongDate('not-a-date')).toBe(DASH)
  })
})

describe('formatDate (relative-then-long)', () => {
  const daysFromNow = (n: number): Date => {
    const d = new Date()
    d.setDate(d.getDate() + n)
    return d
  }

  it('renders recent dates relative', () => {
    expect(formatDate(daysFromNow(0))).toBe('Today')
    expect(formatDate(daysFromNow(-1))).toBe('Yesterday')
    expect(formatDate(daysFromNow(-3))).toBe('3 days ago')
    expect(formatDate(daysFromNow(1))).toBe('Tomorrow')
    expect(formatDate(daysFromNow(2))).toBe('in 2 days')
  })

  it('falls back to the long form beyond 14 days', () => {
    // ~2 years out is safely outside the ±14-day relative window.
    expect(formatDate(new Date(2028, 4, 17))).toBe('May 17, 2028')
  })

  it('returns the em dash for null / invalid', () => {
    expect(formatDate(null)).toBe(DASH)
    expect(formatDate('nonsense')).toBe(DASH)
  })
})

describe('nullable', () => {
  it('coalesces null / undefined / empty string to the fallback', () => {
    expect(nullable(null)).toBe(DASH)
    expect(nullable(undefined)).toBe(DASH)
    expect(nullable('')).toBe(DASH)
    expect(nullable('x')).toBe('x')
    expect(nullable(0)).toBe(0) // 0 is a real value, not nullish
  })
})
