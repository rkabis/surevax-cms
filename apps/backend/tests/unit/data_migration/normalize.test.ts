import { describe, it, expect } from 'vitest'
import {
  bool,
  dateOnly,
  firstBranchSlug,
  money,
  num,
  sex,
  str,
  truncate,
} from '../../../src/modules/data_migration/normalize.js'

describe('normalize.str', () => {
  it('trims whitespace', () => {
    expect(str('  hi  ')).toBe('hi')
  })
  it('coerces "N/A" sentinels to null', () => {
    expect(str('N/A')).toBeNull()
    expect(str('n/a')).toBeNull()
    expect(str('—')).toBeNull()
  })
  it('returns null for empty / undefined / null', () => {
    expect(str(null)).toBeNull()
    expect(str(undefined)).toBeNull()
    expect(str('')).toBeNull()
  })
})

describe('normalize.num', () => {
  it('strips thousands separators', () => {
    expect(num('1,234.56')).toBe(1234.56)
  })
  it('returns null on garbage strings', () => {
    expect(num('not-a-number')).toBeNull()
    expect(num('N/A')).toBeNull()
  })
})

describe('normalize.money', () => {
  it('always returns 2-decimal string', () => {
    expect(money(2500)).toBe('2500.00')
    expect(money('2500')).toBe('2500.00')
    expect(money(null)).toBe('0.00')
  })
})

describe('normalize.bool', () => {
  it('parses common truthy strings', () => {
    expect(bool('TRUE')).toBe(true)
    expect(bool('yes')).toBe(true)
    expect(bool(1)).toBe(true)
  })
  it('parses common falsy strings', () => {
    expect(bool('FALSE')).toBe(false)
    expect(bool('no')).toBe(false)
    expect(bool(0)).toBe(false)
  })
})

describe('normalize.dateOnly', () => {
  it('formats Date as YYYY-MM-DD', () => {
    expect(dateOnly(new Date('2025-10-01T12:00:00Z'))).toBe('2025-10-01')
  })
  it('returns null on garbage', () => {
    expect(dateOnly('not-a-date')).toBeNull()
  })
})

describe('normalize.firstBranchSlug', () => {
  it('picks the first slug from a comma list', () => {
    expect(firstBranchSlug('HolySpirit, Timog, Aguirre')).toBe('HolySpirit')
  })
  it('handles single-branch values', () => {
    expect(firstBranchSlug('HolySpirit')).toBe('HolySpirit')
  })
  it('returns null on empty', () => {
    expect(firstBranchSlug(null)).toBeNull()
  })
})

describe('normalize.sex', () => {
  it('maps "Male" / "Female" to canonical enum values', () => {
    expect(sex('Male')).toBe('Male')
    expect(sex('Female')).toBe('Female')
  })
  it('falls back to Unknown for unrecognised values', () => {
    expect(sex('asdf')).toBe('Unknown')
  })
})

describe('normalize.truncate', () => {
  it('returns the string unchanged when short enough', () => {
    expect(truncate('hi', 5)).toBe('hi')
  })
  it('cuts at the boundary', () => {
    expect(truncate('hello world', 5)).toBe('hello')
  })
})
