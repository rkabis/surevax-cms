import { describe, expect, it } from 'vitest'
import {
  importedEligibilityDefault,
  importedPriceOverlapsExisting,
  serviceCatalogReuseDecision,
} from '../../../src/modules/data_migration/adapter.js'

describe('migration catalog collision rules', () => {
  const source = {
    id: 'ARVPEP_ID',
    code: 'ARVPEP_ID',
    serviceType: 'Vaccine',
    defaultRoute: 'ID',
    requiresStock: true,
    isActive: true,
  }

  it('reuses a seeded service when its clinical semantics agree', () => {
    expect(serviceCatalogReuseDecision(source, { ...source, id: 'seeded-ARVPEP-ID' })).toEqual({
      compatible: true,
    })
  })

  it('refuses a code collision when service type, route, or stock semantics differ', () => {
    const decision = serviceCatalogReuseDecision(source, {
      ...source,
      serviceType: 'Procedure',
      defaultRoute: 'IM',
      requiresStock: false,
    })
    expect(decision.compatible).toBe(false)
    if (!decision.compatible) {
      expect(decision.reason).toContain('service type')
      expect(decision.reason).toContain('default route')
      expect(decision.reason).toContain('stock requirement')
    }
  })

  it('treats MedicalCertificate as the persisted Procedure service type', () => {
    expect(
      serviceCatalogReuseDecision(
        { ...source, serviceType: 'MedicalCertificate', defaultRoute: null, requiresStock: false },
        { ...source, serviceType: 'Procedure', defaultRoute: null, requiresStock: false },
      ),
    ).toEqual({ compatible: true })
  })

  it('allows a seeded route to enrich a legacy row whose route is absent', () => {
    expect(serviceCatalogReuseDecision({ ...source, defaultRoute: null }, source)).toEqual({
      compatible: true,
    })
  })

  it('keeps an existing curated default product while adding a legacy eligible alternative', () => {
    expect(importedEligibilityDefault(true, true)).toBe(false)
    expect(importedEligibilityDefault(false, true)).toBe(true)
    expect(importedEligibilityDefault(true, false)).toBe(false)
  })

  it('uses half-open date intervals when detecting an imported price collision', () => {
    expect(importedPriceOverlapsExisting('2026-08-17', '2026-08-17')).toBe(false)
    expect(importedPriceOverlapsExisting('2026-08-17', '2026-08-18')).toBe(true)
    expect(importedPriceOverlapsExisting('2026-08-17', null)).toBe(true)
  })
})
