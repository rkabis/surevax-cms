import { describe, it, expect } from 'vitest'
import {
  toCents,
  fromCents,
  sumMoney,
  subtractMoney,
  multiplyMoney,
} from '../src/shared/utils/money.js'

describe('toCents', () => {
  it('parses a standard numeric(12,2) string', () => {
    expect(toCents('2500.00')).toBe(250000)
  })

  it('parses a sub-peso value', () => {
    expect(toCents('0.10')).toBe(10)
  })

  it('returns 0 for null', () => {
    expect(toCents(null)).toBe(0)
  })

  it('returns 0 for undefined', () => {
    expect(toCents(undefined)).toBe(0)
  })

  it('returns 0 for empty string', () => {
    expect(toCents('')).toBe(0)
  })

  it('returns 0 for non-numeric string', () => {
    expect(toCents('not-a-number')).toBe(0)
  })
})

describe('fromCents', () => {
  it('formats cents back to a 2-decimal string', () => {
    expect(fromCents(250000)).toBe('2500.00')
  })

  it('formats zero correctly', () => {
    expect(fromCents(0)).toBe('0.00')
  })
})

describe('sumMoney', () => {
  it('accumulates without float drift — the classic 0.1 + 0.2 case', () => {
    // In JS, 0.1 + 0.2 === 0.30000000000000004; cents avoids this.
    expect(sumMoney(['0.10', '0.20'])).toBe('0.30')
  })

  it('handles the classic float drift case with three values', () => {
    expect(sumMoney(['100.01', '99.99', '0.50'])).toBe('200.50')
  })

  it('returns "0.00" for an empty array', () => {
    expect(sumMoney([])).toBe('0.00')
  })

  it('skips null and undefined entries', () => {
    expect(sumMoney([null, '100.00', undefined])).toBe('100.00')
  })
})

describe('subtractMoney', () => {
  it('subtracts correctly', () => {
    expect(subtractMoney('1000.00', '0.10')).toBe('999.90')
  })

  it('returns negative values when b > a', () => {
    expect(subtractMoney('0.10', '1.00')).toBe('-0.90')
  })

  it('treats null as zero', () => {
    expect(subtractMoney(null, '5.00')).toBe('-5.00')
  })
})

describe('multiplyMoney', () => {
  it('multiplies a price string by an integer quantity', () => {
    expect(multiplyMoney('100.50', 3)).toBe('301.50')
  })

  it('multiplies by a string quantity', () => {
    expect(multiplyMoney('100.50', '3')).toBe('301.50')
  })

  it('returns "0.00" for null amount', () => {
    expect(multiplyMoney(null, 3)).toBe('0.00')
  })

  it('returns "0.00" for null quantity', () => {
    expect(multiplyMoney('100.00', null)).toBe('0.00')
  })

  it('returns "0.00" for NaN quantity string', () => {
    expect(multiplyMoney('100.00', 'abc')).toBe('0.00')
  })
})
