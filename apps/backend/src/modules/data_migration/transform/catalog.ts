import { displayId } from '../../../shared/utils/displayId.js'
import { num, str } from '../normalize.js'
import type { SrcVaccine } from '../types.js'
import type {
  TargetProduct,
  TargetServiceCatalog,
  TargetServiceEligibleProduct,
  TargetServicePrice,
} from '../targets.js'

/**
 * Vaccine sheet → products + service_catalog + service_eligible_products + service_prices.
 *
 * Routes the four legacy axes into the right v2 table:
 *   • brand          → products
 *   • (type, route)  → service_catalog code (e.g. ARVPEP_IM)
 *   • brand × svc    → service_eligible_products junction
 *   • payer × svc    → service_prices row with payer_id
 *   • physician      → NOT a catalog row (attribution via performed_by_id)
 *
 * Consultation / MedCert OR/NoOR axis (A1): collapsed to one SVC_CONSULTATION +
 * one SVC_MEDCERT. Critical: every source Row ID gets its own entry in
 * `legacyRefToServiceId` — recovers the 1,644 immunizations that point at
 * SERVICE_Consultation_NoOR / sibling ids.
 *
 * Diagnostics rows: skipped (seed.ts already has the SV01-SV23 bundles + the 32
 * hidden panel constituents; matched by name at load).
 */

const VALID_ROUTES = new Set(['IM', 'SC', 'ID', 'IV', 'PO', 'IN', 'Topical', 'INF', 'Oral'])

// A `v_Route` value that is really a payer tier, not a route. Anything here
// collapses to the abstract service and contributes a `service_prices` row for
// that payer instead of its own catalog row.
//
// The `HMO` / `HPPI` / `mWell` / `HatiHealth` / `MedAsia` spellings (and their
// `IM - X` / `ID - X` / `X 0.5` variants) were missing until the export was
// cross-checked against the seed: between them they cover 80 of the 159
// non-diagnostic Vaccine rows, so every one of those was previously falling
// through as an unrecognised route.
const PARTNER_PAYER_CODES: Record<string, string> = {
  'Hati Health': 'PAYER_HATI_HEALTH',
  HatiHealth: 'PAYER_HATI_HEALTH',
  Forticare: 'PAYER_FORTICARE',
  'MedAsia/Forticare/LLBI': 'PAYER_MEDASIA',
  'IM - MedAsia/Forticare/LLBI': 'PAYER_MEDASIA',
  'ID - MedAsia/Forticare/LLBI': 'PAYER_MEDASIA',
  MedAsia: 'PAYER_MEDASIA',
  Philbritish: 'PAYER_PHILBRITISH',
  HMO: 'PAYER_HMO',
  'IM - HMO': 'PAYER_HMO',
  'ID - HMO': 'PAYER_HMO',
  HPPI: 'PAYER_HPPI',
  'IM - HPPI': 'PAYER_HPPI',
  'ID - HPPI': 'PAYER_HPPI',
  mWell: 'PAYER_MWELL',
  'IM - mWell': 'PAYER_MWELL',
  'mWell 0.5': 'PAYER_MWELL',
  'mWell 1.0': 'PAYER_MWELL',
}

const PHYSICIAN_AXIS_VALUES = new Set([
  'Eycee Lacuarin',
  'Ira Lintag',
  'Miguel Tecson',
  'Riana Uy',
  'Rois Bautista',
  // OR/NoOR (A1) also masquerade as v_Route on Consultation/MedCert — treat as
  // physician-like: collapse to the canonical service, never a separate row.
  'NoOR',
  'OR',
  'Lacuarin',
  'Lintag',
  'Tecson',
  'Uy',
  'Bautista',
])

const TYPE_TO_SERVICE_CODE: Record<string, string> = {
  'Anti Rabies - PEP': 'ARVPEP',
  'Anti Rabies - PrEP': 'ARVPREP',
  'Anti Rabies - Booster': 'ARVBOOSTER',
  ERIG: 'ERIG',
  HRIG: 'HRIG',
  HTIG: 'HTIG',
  ATS: 'ATS',
  'Tetanus Toxoid': 'TT',
  TDAP: 'TDAP',
  Flu: 'FLU',
  'Pneumonia 13': 'PCV13',
  'Pneumonia 20': 'PCV20',
  'Pneumonia 23': 'PPSV23',
  'HPV-4': 'HPV4',
  'HPV-9': 'HPV9',
  Shingles: 'SHINGRIX',
  Chickenpox: 'VARICELLA',
  Cholera: 'CHOLERA',
  'Hep A': 'HEPA',
  'Hep B': 'HEPB',
  MMR: 'MMR',
  Typhoid: 'TYPHOID',
}

export type CatalogTransformResult = {
  products: TargetProduct[]
  services: TargetServiceCatalog[]
  serviceEligibleProducts: TargetServiceEligibleProduct[]
  servicePrices: TargetServicePrice[]
  /** Every legacy Vaccine Row ID → v2 service id. */
  legacyRefToServiceId: Map<string, string>
  /** Per-Row-ID v_Type, for encounter rabies detection. */
  vaccineTypeByLegacyRef: Map<string, string>
  skipped: Array<{ rowId: string; reason: string }>
}

const TODAY_ISO = new Date().toISOString().slice(0, 10)

export function transformCatalog(src: SrcVaccine[], tenantSlug: string): CatalogTransformResult {
  const products = new Map<string, TargetProduct>()
  const services = new Map<string, TargetServiceCatalog>()
  const eligibleKey = new Set<string>()
  const legacyRefToServiceId = new Map<string, string>()
  const vaccineTypeByLegacyRef = new Map<string, string>()
  const out: CatalogTransformResult = {
    products: [],
    services: [],
    serviceEligibleProducts: [],
    servicePrices: [],
    legacyRefToServiceId,
    vaccineTypeByLegacyRef,
    skipped: [],
  }

  for (const row of src) {
    const rowId = str(row['Row ID'])
    if (!rowId) continue
    const type = str(row.v_Type)
    const brand = str(row.v_Brand)
    const route = str(row.v_Route)
    const price = num(row.v_DosagePrice)
    const dose = num(row.v_DosageAmount)
    if (type) vaccineTypeByLegacyRef.set(rowId, type)

    if (type === 'Service') {
      const isConsult = brand === 'Consultation'
      const isMedcert = brand === 'Medical Certificate'
      if (isConsult || isMedcert) {
        // The seeded physical IDs retain the SVC_ prefix, but their unique
        // catalog codes are the user-facing canonical values. Keeping those
        // separate lets the loader reuse the seed instead of attempting a
        // duplicate primary-key insert for service records from AppSheet.
        const id = isConsult ? 'SVC_CONSULTATION' : 'SVC_MEDCERT'
        const code = isConsult ? 'CONSULTATION' : 'MEDCERT'
        upsertService(services, {
          id,
          tenantId: tenantSlug,
          code,
          name: brand ?? code,
          serviceType: isConsult ? 'Consultation' : 'MedicalCertificate',
          defaultRoute: null,
          defaultDoseVolumeMl: null,
          isVatExempt: false,
          requiresStock: false,
          isActive: true,
          legacyAppsheetId: rowId,
        })
        legacyRefToServiceId.set(rowId, id)
        continue
      }
      out.skipped.push({ rowId, reason: `Service-type row with unknown brand "${brand}"` })
      continue
    }

    if (type === 'Diagnostics') {
      out.skipped.push({ rowId, reason: 'Diagnostics — matched by seeded catalog name' })
      continue
    }

    const serviceCodeBase = type ? TYPE_TO_SERVICE_CODE[type] : null
    if (!serviceCodeBase) {
      out.skipped.push({ rowId, reason: `unmapped v_Type "${type ?? ''}"` })
      continue
    }

    const payerCode = route ? PARTNER_PAYER_CODES[route] : null
    const isPhysicianRoute = route ? PHYSICIAN_AXIS_VALUES.has(route) : false
    const cleanRoute = route && VALID_ROUTES.has(route) ? route : null

    const serviceCode = cleanRoute ? `${serviceCodeBase}_${cleanRoute}` : serviceCodeBase
    const serviceName = `${type}${cleanRoute ? ` (${cleanRoute})` : ''}`

    upsertService(services, {
      id: serviceCode,
      tenantId: tenantSlug,
      code: serviceCode,
      name: serviceName,
      serviceType: 'Vaccine',
      defaultRoute: normalizeRoute(cleanRoute),
      defaultDoseVolumeMl: dose !== null ? dose.toFixed(2) : null,
      isVatExempt: false,
      requiresStock: true,
      isActive: true,
      legacyAppsheetId: rowId,
    })
    legacyRefToServiceId.set(rowId, serviceCode)

    if (brand) {
      const product = upsertProduct(products, brand, tenantSlug, normalizeRoute(cleanRoute), dose)
      const key = `${serviceCode}::${product.legacyAppsheetId}`
      if (!eligibleKey.has(key)) {
        eligibleKey.add(key)
        out.serviceEligibleProducts.push({
          tenantId: tenantSlug,
          serviceId: serviceCode,
          productLegacyId: product.legacyAppsheetId,
          ranking: out.serviceEligibleProducts.filter((p) => p.serviceId === serviceCode).length,
          isDefault: false,
        })
      }
    }

    if (payerCode && price !== null) {
      out.servicePrices.push({
        tenantId: tenantSlug,
        serviceId: serviceCode,
        payerCode,
        unitPrice: price.toFixed(2),
        effectiveFrom: TODAY_ISO,
      })
    } else if (price !== null && !isPhysicianRoute) {
      out.servicePrices.push({
        tenantId: tenantSlug,
        serviceId: serviceCode,
        payerCode: null,
        unitPrice: price.toFixed(2),
        effectiveFrom: TODAY_ISO,
      })
    }
  }

  out.products = [...products.values()]
  out.services = [...services.values()]
  const seenDefault = new Set<string>()
  for (const ep of out.serviceEligibleProducts) {
    if (!seenDefault.has(ep.serviceId)) {
      ep.isDefault = true
      seenDefault.add(ep.serviceId)
    }
  }
  return out
}

function upsertProduct(
  products: Map<string, TargetProduct>,
  brand: string,
  tenantSlug: string,
  defaultRoute: TargetProduct['defaultRoute'],
  vialVolumeMl: number | null,
): TargetProduct {
  const existing = products.get(brand)
  if (existing) return existing
  const created: TargetProduct = {
    displayId: displayId('PRD'),
    tenantId: tenantSlug,
    name: brand,
    manufacturer: brand,
    defaultRoute,
    vialVolumeMl: vialVolumeMl !== null ? vialVolumeMl.toFixed(2) : null,
    isActive: true,
    legacyAppsheetId: brand,
  }
  products.set(brand, created)
  return created
}

function upsertService(services: Map<string, TargetServiceCatalog>, s: TargetServiceCatalog): void {
  if (!services.has(s.id)) services.set(s.id, s)
}

function normalizeRoute(r: string | null): TargetProduct['defaultRoute'] {
  if (!r) return null
  if (r === 'Oral') return 'PO'
  if (
    r === 'IM' ||
    r === 'SC' ||
    r === 'ID' ||
    r === 'IV' ||
    r === 'PO' ||
    r === 'IN' ||
    r === 'Topical' ||
    r === 'INF'
  )
    return r
  return null
}

export const __testing__ = {
  TYPE_TO_SERVICE_CODE,
  PARTNER_PAYER_CODES,
  PHYSICIAN_AXIS_VALUES,
  normalizeRoute,
}
