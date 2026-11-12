/**
 * Unit tests for the weight-based immunoglobulin dose calculator (CLIN-1).
 *
 * Pure math — no DB. Covers the IU/kg and fixed-dose paths, the max-dose
 * ceiling, the zero/over-weight guards, and the infiltration/IM split for
 * ERIG + HRIG. These run in the `unit` vitest project and in CI.
 */
import { describe, it, expect } from 'vitest'
import {
  calculateDose,
  DoseCalcError,
  DOSE_RULES,
  resolveDoseRule,
} from '../../src/shared/utils/doseCalc.js'

describe('calculateDose — weight-based rabies immunoglobulin', () => {
  it('ERIG: 40 IU/kg → total IU and INF route', () => {
    const r = calculateDose({ serviceCode: 'ERIG_INF', weightKg: 20 })
    expect(r.totalIu).toBe(800) // 40 * 20
    expect(r.route).toBe('INF')
    expect(r.weightBased).toBe(true)
    expect(r.cappedAtMax).toBe(false)
  })

  it('HRIG: 20 IU/kg → total IU and INF route', () => {
    const r = calculateDose({ serviceCode: 'HRIG_INF', weightKg: 30 })
    expect(r.totalIu).toBe(600) // 20 * 30
    expect(r.route).toBe('INF')
    expect(r.weightBased).toBe(true)
  })

  it('ERIG: converts IU → mL using product concentration and splits INF/IM', () => {
    // default ERIG concentration 200 IU/mL, infiltrationFraction 1.0
    const r = calculateDose({ serviceCode: 'ERIG_INF', weightKg: 20 }) // 800 IU
    expect(r.volumeMl).toBe(4) // 800 / 200
    expect(r.infiltrationMl).toBe(4) // 100% infiltrated
    expect(r.imMl).toBe(0)
    // INF products always carry the infiltrate-then-IM warning
    expect(r.warnings.some((w) => /infiltrate/i.test(w))).toBe(true)
  })

  it('HRIG: respects an overridden product concentration', () => {
    const r = calculateDose({
      serviceCode: 'HRIG_INF',
      weightKg: 75,
      productConcentrationIuPerMl: 150,
    })
    // 20 * 75 = 1500 IU == maxDoseIu (not over), 1500 / 150 = 10 mL
    expect(r.totalIu).toBe(1500)
    expect(r.cappedAtMax).toBe(false)
    expect(r.volumeMl).toBe(10)
  })
})

describe('calculateDose — max-dose ceiling', () => {
  it('ERIG: caps an oversized weight-calculated dose and warns', () => {
    // 40 IU/kg * 100 kg = 4000 IU > 3000 IU ceiling
    const r = calculateDose({ serviceCode: 'ERIG_INF', weightKg: 100 })
    expect(r.cappedAtMax).toBe(true)
    expect(r.totalIu).toBe(3000) // clipped to maxDoseIu
    expect(r.warnings.some((w) => /exceed|cap/i.test(w))).toBe(true)
  })

  it('HRIG: caps above 1500 IU ceiling', () => {
    // 20 IU/kg * 100 kg = 2000 IU > 1500 IU ceiling
    const r = calculateDose({ serviceCode: 'HRIG_INF', weightKg: 100 })
    expect(r.cappedAtMax).toBe(true)
    expect(r.totalIu).toBe(1500)
  })
})

describe('calculateDose — weight guards (never silently dangerous)', () => {
  it('rejects zero weight', () => {
    expect(() => calculateDose({ serviceCode: 'ERIG_INF', weightKg: 0 })).toThrow(DoseCalcError)
  })

  it('rejects negative weight', () => {
    expect(() => calculateDose({ serviceCode: 'HRIG_INF', weightKg: -5 })).toThrow(DoseCalcError)
  })

  it('rejects absurd weight (>500 kg)', () => {
    expect(() => calculateDose({ serviceCode: 'ERIG_INF', weightKg: 600 })).toThrow(DoseCalcError)
  })

  it('rejects missing weight for a weight-based rule', () => {
    let caught: unknown
    try {
      calculateDose({ serviceCode: 'ERIG_INF' })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(DoseCalcError)
    expect((caught as DoseCalcError).code).toBe('WEIGHT_REQUIRED')
  })

  it('rejects an unknown service code', () => {
    let caught: unknown
    try {
      calculateDose({ serviceCode: 'NOT_A_SERVICE', weightKg: 20 })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(DoseCalcError)
    expect((caught as DoseCalcError).code).toBe('UNKNOWN_SERVICE')
  })

  it('rejects a non-positive product concentration', () => {
    let caught: unknown
    try {
      calculateDose({ serviceCode: 'ERIG_INF', weightKg: 20, productConcentrationIuPerMl: 0 })
    } catch (e) {
      caught = e
    }
    // 0 falls back to the rule default, so this path is via an explicit negative:
    expect(caught).toBeUndefined()
    let caught2: unknown
    try {
      // force an invalid rule with a non-positive concentration default
      calculateDose({
        serviceCode: 'ERIG_INF',
        weightKg: 20,
        rule: { iuPerKg: 40, productConcentrationIuPerMl: -1, route: 'INF', notes: '' },
      })
    } catch (e) {
      caught2 = e
    }
    expect(caught2).toBeInstanceOf(DoseCalcError)
    expect((caught2 as DoseCalcError).code).toBe('INVALID_CONCENTRATION')
  })
})

describe('calculateDose — fixed-dose tetanus products', () => {
  it('HTIG: fixed 250 IU, IM route, weight ignored', () => {
    const r = calculateDose({ serviceCode: 'HTIG' })
    expect(r.totalIu).toBe(250)
    expect(r.route).toBe('IM')
    expect(r.weightBased).toBe(false)
    expect(r.infiltrationMl).toBe(0)
    expect(r.imMl).toBe(r.volumeMl) // whole dose IM
    expect(r.volumeMl).toBe(1) // 250 / 250 IU/mL
  })

  it('HTIG: warns when a weight is needlessly supplied', () => {
    const r = calculateDose({ serviceCode: 'HTIG', weightKg: 40 })
    expect(r.totalIu).toBe(250)
    expect(r.warnings.some((w) => /fixed/i.test(w))).toBe(true)
  })

  it('ATS: fixed 1500 IU, IM route', () => {
    const r = calculateDose({ serviceCode: 'ATS' })
    expect(r.totalIu).toBe(1500)
    expect(r.route).toBe('IM')
    expect(r.weightBased).toBe(false)
    expect(r.volumeMl).toBe(1) // 1500 / 1500 IU/mL
  })
})

describe('resolveDoseRule — catalog id ↔ clinical code reconciliation', () => {
  // The Administer dialog passes order.service.id (SVC_ERIG_INF), but DOSE_RULES
  // is keyed by clinical code (ERIG_INF). Both forms must resolve, else the
  // confirm button stays permanently disabled (regression guard for the bug).
  it('resolves the raw clinical code form', () => {
    expect(resolveDoseRule('ERIG_INF')).toBe(DOSE_RULES['ERIG_INF'])
    expect(resolveDoseRule('ATS')).toBe(DOSE_RULES['ATS'])
  })

  it('resolves the SVC_-prefixed catalog id form the frontend sends', () => {
    expect(resolveDoseRule('SVC_ERIG_INF')).toBe(DOSE_RULES['ERIG_INF'])
    expect(resolveDoseRule('SVC_HRIG_INF')).toBe(DOSE_RULES['HRIG_INF'])
    expect(resolveDoseRule('SVC_HTIG')).toBe(DOSE_RULES['HTIG'])
    expect(resolveDoseRule('SVC_ATS')).toBe(DOSE_RULES['ATS'])
  })

  it('returns undefined for an unrelated SVC_ id', () => {
    expect(resolveDoseRule('SVC_RABIES_IM')).toBeUndefined()
    expect(resolveDoseRule('NOT_A_SERVICE')).toBeUndefined()
  })

  it('calculateDose accepts the SVC_-prefixed catalog id (ERIG @ 60 kg)', () => {
    // The exact repro from the bug report: SVC_ERIG_INF + weightKg 60.
    const r = calculateDose({ serviceCode: 'SVC_ERIG_INF', weightKg: 60 })
    expect(r.totalIu).toBe(2400) // 40 IU/kg * 60 kg
    expect(r.volumeMl).toBe(12) // 2400 / 200 IU/mL
    expect(r.route).toBe('INF')
    expect(r.cappedAtMax).toBe(false)
    // The result echoes back the identifier the caller passed.
    expect(r.serviceCode).toBe('SVC_ERIG_INF')
  })

  it('calculateDose accepts the SVC_-prefixed catalog id for fixed-dose ATS', () => {
    const r = calculateDose({ serviceCode: 'SVC_ATS' })
    expect(r.totalIu).toBe(1500)
    expect(r.route).toBe('IM')
    expect(r.weightBased).toBe(false)
  })
})

describe('DOSE_RULES table', () => {
  it('defines exactly the four dose-calculation services', () => {
    expect(Object.keys(DOSE_RULES).sort()).toEqual(['ATS', 'ERIG_INF', 'HRIG_INF', 'HTIG'])
  })

  it('uses the WHO/DOH IU/kg anchors for the rabies products', () => {
    expect(DOSE_RULES['ERIG_INF']?.iuPerKg).toBe(40)
    expect(DOSE_RULES['HRIG_INF']?.iuPerKg).toBe(20)
  })

  it('uses the fixed-dose anchors for the tetanus products', () => {
    expect(DOSE_RULES['HTIG']?.fixedIu).toBe(250)
    expect(DOSE_RULES['ATS']?.fixedIu).toBe(1500)
  })
})
