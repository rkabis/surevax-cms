import { describe, it, expect } from 'vitest'
import { RowIdMap } from '../../../src/modules/data_migration/idMap.js'

describe('RowIdMap', () => {
  it('round-trips put/get', () => {
    const m = new RowIdMap()
    m.put('patient', 'PAT-ABC', 42)
    expect(m.get('patient', 'PAT-ABC')).toBe(42)
  })

  it('partitions by kind — same key in two kinds is fine', () => {
    const m = new RowIdMap()
    m.put('patient', 'XYZ', 1)
    m.put('transaction', 'XYZ', 2)
    expect(m.get('patient', 'XYZ')).toBe(1)
    expect(m.get('transaction', 'XYZ')).toBe(2)
  })

  it('throws on conflicting put within same kind', () => {
    const m = new RowIdMap()
    m.put('patient', 'k', 1)
    expect(() => m.put('patient', 'k', 2)).toThrow(/conflict/)
  })

  it('require throws when key missing', () => {
    const m = new RowIdMap()
    expect(() => m.require('patient', 'missing')).toThrow(/missing/)
  })

  it('rejects empty source key', () => {
    const m = new RowIdMap()
    expect(() => m.put('patient', '', 1)).toThrow()
  })

  it('rejects non-finite dest id', () => {
    const m = new RowIdMap()
    expect(() => m.put('patient', 'k', 0)).toThrow()
    expect(() => m.put('patient', 'k', NaN)).toThrow()
  })

  it('size counts entries per kind', () => {
    const m = new RowIdMap()
    m.put('patient', 'a', 1)
    m.put('patient', 'b', 2)
    m.put('transaction', 'c', 3)
    expect(m.size('patient')).toBe(2)
    expect(m.size('transaction')).toBe(1)
    expect(m.size('user')).toBe(0)
  })
})
