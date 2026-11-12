import { describe, it, expect } from 'vitest'
import { transformCatalog } from '../../../src/modules/data_migration/transform/catalog.js'

describe('transformCatalog', () => {
  it('collapses (type, brand, route) into product + service + junction', () => {
    const out = transformCatalog(
      [
        {
          'Row ID': 'ARVPEP_AbhayrabID',
          v_Type: 'Anti Rabies - PEP',
          v_Brand: 'Abhayrab',
          v_Route: 'ID',
          v_DosagePrice: 800,
          v_DosageAmount: 0.2,
        },
        {
          'Row ID': 'ARVPEP_SpeedaID',
          v_Type: 'Anti Rabies - PEP',
          v_Brand: 'Speeda',
          v_Route: 'ID',
          v_DosagePrice: 800,
          v_DosageAmount: 0.2,
        },
      ],
      'SVX',
    )
    expect(out.services).toHaveLength(1)
    expect(out.services[0]!.id).toBe('ARVPEP_ID')
    expect(out.products).toHaveLength(2)
    expect(out.serviceEligibleProducts).toHaveLength(2)
    expect(out.serviceEligibleProducts[0]!.isDefault).toBe(true)
    expect(out.serviceEligibleProducts[1]!.isDefault).toBe(false)
  })

  it('maps partner-axis rows to service_prices with payer_code', () => {
    const out = transformCatalog(
      [
        {
          'Row ID': 'ARVPEP_AbhayrabIM_Hati',
          v_Type: 'Anti Rabies - PEP',
          v_Brand: 'Abhayrab',
          v_Route: 'Hati Health',
          v_DosagePrice: 1500,
          v_DosageAmount: 0.5,
        },
      ],
      'SVX',
    )
    const partnerPrice = out.servicePrices.find((p) => p.payerCode === 'PAYER_HATI_HEALTH')
    expect(partnerPrice).toBeTruthy()
    expect(partnerPrice!.unitPrice).toBe('1500.00')
  })

  it('registers EVERY sibling Row ID for collapsed services (Consultation OR/NoOR/per-physician)', () => {
    // Fixes the 1,644-row resolution bug: the catalog transformer must register
    // every source Row ID, not just the first, for collapsed services.
    const out = transformCatalog(
      [
        {
          'Row ID': 'SERVICE_Consultation_NoOR',
          v_Type: 'Service',
          v_Brand: 'Consultation',
          v_Route: 'NoOR',
          v_DosagePrice: 500,
        },
        {
          'Row ID': 'SERVICE_Consultation_OR',
          v_Type: 'Service',
          v_Brand: 'Consultation',
          v_Route: 'OR',
          v_DosagePrice: 500,
        },
        {
          'Row ID': 'SERVICE_Consultation_Lacuarin',
          v_Type: 'Service',
          v_Brand: 'Consultation',
          v_Route: 'Eycee Lacuarin',
          v_DosagePrice: 500,
        },
      ],
      'SVX',
    )
    expect(out.legacyRefToServiceId.get('SERVICE_Consultation_NoOR')).toBe('SVC_CONSULTATION')
    expect(out.legacyRefToServiceId.get('SERVICE_Consultation_OR')).toBe('SVC_CONSULTATION')
    expect(out.legacyRefToServiceId.get('SERVICE_Consultation_Lacuarin')).toBe('SVC_CONSULTATION')
    expect(out.services.filter((s) => s.id === 'SVC_CONSULTATION')).toHaveLength(1)
    expect(out.services.find((s) => s.id === 'SVC_CONSULTATION')!.code).toBe('CONSULTATION')
  })

  it('emits a single Consultation service regardless of physician axis', () => {
    const out = transformCatalog(
      [
        {
          'Row ID': 'CONSULT_LACUARIN',
          v_Type: 'Service',
          v_Brand: 'Consultation',
          v_Route: 'Eycee Lacuarin',
          v_DosagePrice: 500,
        },
        {
          'Row ID': 'CONSULT_LINTAG',
          v_Type: 'Service',
          v_Brand: 'Consultation',
          v_Route: 'Ira Lintag',
          v_DosagePrice: 500,
        },
      ],
      'SVX',
    )
    const consult = out.services.filter((s) => s.id === 'SVC_CONSULTATION')
    expect(consult).toHaveLength(1)
    expect(consult[0]!.serviceType).toBe('Consultation')
    expect(consult[0]!.code).toBe('CONSULTATION')
  })

  it('skips Diagnostics rows (handled by seeded catalog)', () => {
    const out = transformCatalog(
      [
        {
          'Row ID': 'DIAG_FBS',
          v_Type: 'Diagnostics',
          v_Brand: 'Individual',
          v_Route: 'Glucose (FBS/RBS)',
          v_DosagePrice: 200,
        },
      ],
      'SVX',
    )
    expect(out.services).toHaveLength(0)
    expect(out.skipped[0]!.reason).toMatch(/Diagnostics/)
  })

  it('records unmapped vaccine types in skipped', () => {
    const out = transformCatalog(
      [{ 'Row ID': 'UNKNOWN_X', v_Type: 'Mystery Vaccine', v_Brand: 'Xyzab' }],
      'SVX',
    )
    expect(out.skipped[0]!.reason).toMatch(/unmapped/)
  })
})
