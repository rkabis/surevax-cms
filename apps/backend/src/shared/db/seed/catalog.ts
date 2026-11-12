/**
 * Seed section — catalog (products, categories, service_catalog, bundles,
 * eligible products, prices, payer contracts, notification templates, tag
 * definitions).
 *
 * Two-tier IDs (W3.c.6, 2026-05-19):
 *   - `service_catalog.id` stays text (raw code, e.g. `ARVPEP_IM`). NO display_id.
 *   - All other catalog tables are bigserial + `display_id` (PRD/CAT/SBI/SEP/
 *     SVP/PCT/NTP/TGD).
 *   - `service_bundle_items` and `service_eligible_products` are junctions
 *     with composite PKs (no surrogate id, no display_id).
 *
 * Returns:
 *   - `productsByCode`: maker name → bigint id (consumed by `seedInventory`)
 *   - `servicesByCode`: catalog code → catalog code (passthrough; seed
 *     downstream resolves by raw code)
 *   - `categoriesByCode`: category name → bigint id
 *
 * Design principles (carried from the 2026-05-17 cleanup):
 *
 *   1. ONE service per clinical entity. ARV PEP IM is a single catalog row,
 *      not eight brand×partner variants. Clinician picks the brand at
 *      administer time via FEFO + service_eligible_products.
 *
 *   2. Partner pricing lives in `service_prices` keyed by `payerId`. Hati
 *      Health / Forticare / MedAsia / Philbritish / HMO / HPPI / mWell are payer
 *      profiles, not catalog rows. See the note below.
 *
 * ── How a payer profile applies to a vaccine ────────────────────────────────
 *
 * Worth stating plainly, because the legacy system does it the opposite way and
 * a re-import will be tempted to copy that shape.
 *
 * In the AppSheet `Vaccine` sheet, one column (`v_Route`) carries THREE unrelated
 * things: the real administration route (`IM`, `ID`, `SC`, `Oral`, `INF`), a payer
 * tier (`HMO`, `HPPI`, `mWell`, `HatiHealth`, `MedAsia`), a physician for the
 * consultation rows (`Ira Lintag`), and occasionally a route+payer pair
 * (`IM - HMO`, `mWell 0.5`). Each combination is its OWN row with its own price,
 * so a single clinical entity fans out across brand × payer: `ARV PEP` alone is
 * 12 rows, and the sheet totals 271 for what v2 models as ~40 services.
 *
 * Cross-checking every one of those rows against the export produced the finding
 * that justifies the v2 shape: **across all 65 (service, payer) combinations in
 * the sheet, no two brands ever disagree on the payer price.** MMR at the HMO
 * rate is ₱1,600 whether it is MMR 2, Priorix, or Tresivac. The brand × payer
 * explosion is duplication, not information.
 *
 * So the price of a dose resolves along three independent axes, and the nurse
 * only ever picks two of them:
 *
 *   1. WHICH SERVICE: chosen when the standing order is started (`ARVPEP_IM`).
 *   2. WHICH BRAND: chosen by the nurse at the bedside, at administer time
 *      (`service_eligible_products` lists the candidates). Affects price only
 *      where a brand genuinely costs more: `service_prices.product_id`, seeded in
 *      `BRAND_PRICING` below, which is Speeda over Abhayrab and the two premium
 *      flu brands. Every other brand bills the base rate.
 *   3. WHICH PAYER: chosen when the dose is BILLED, not when it is given:
 *      `service_prices.payer_id`. This is the axis the sheet buries in the route
 *      column, and it is the largest one: an HMO card pays ₱2,200 for the same
 *      ARV PEP IM dose that costs a cash patient ₱1,500.
 *
 * Precedence when more than one row matches is weighted in
 * `shared/lib/pricing.ts`: payer 4 > product 2 > branch 1: so a payer contract
 * outranks a brand uplift unless an explicit `(payer_id, product_id)` row exists.
 * That ordering is why the nurse's brand choice never has to wait on knowing the
 * payer, and why the payer can be chosen afterwards at settlement without
 * re-opening the clinical record.
 *
 *   3. Physician attribution lives on `transaction_items.performed_by_id`.
 *      There is one `CONSULTATION` and one `MEDCERT` service — the attending
 *      doctor is recorded on the txn item, not via per-physician catalog rows.
 */

import { and, eq } from 'drizzle-orm'
import * as s from '../schema.js'
import { db } from './db.js'
import { displayId } from '../../utils/displayId.js'
import {
  SVC_FNAT,
  SVC_WOUND,
  SVC_ARVPEP_IM,
  SVC_ARVPEP_ID,
  SVC_ARVPREP_IM,
  SVC_ARVPREP_ID,
  SVC_ARVBOOSTER_IM,
  SVC_ARVBOOSTER_ID,
  SVC_TT,
  SVC_ATS,
  SVC_ERIG_INF,
  SVC_HRIG_INF,
  SVC_HTIG,
  SVC_FLU_QUAD,
  SVC_CHOLERA,
  SVC_TYPHOID,
  SVC_HEPA,
  SVC_HEPB_05,
  SVC_HEPB_10,
  SVC_HPV4,
  SVC_HPV9,
  SVC_MMR,
  SVC_TDAP,
  SVC_SHINGLES,
  SVC_VARICELLA_SC,
  SVC_VARICELLA_IM,
  SVC_P13,
  SVC_P20,
  SVC_P23,
  SVC_CONSULTATION,
  SVC_TELECONSULT,
  SVC_MEDCERT,
  SVC_OTHER,
  PAYER_HATI_HEALTH_DISPLAY_ID,
  PAYER_FORTICARE_DISPLAY_ID,
  PAYER_MEDASIA_DISPLAY_ID,
  PAYER_PHILBRITISH_DISPLAY_ID,
  PAYER_HMO_DISPLAY_ID,
  PAYER_HPPI_DISPLAY_ID,
  PAYER_MWELL_DISPLAY_ID,
} from './constants.js'

export type SeededCatalog = {
  productsByCode: Map<string, number>
  servicesByCode: Map<string, string>
  categoriesByCode: Map<string, number>
}

// ───────────────────────────────────────────────────────────────────────────
// Section 1 — products
// ───────────────────────────────────────────────────────────────────────────

type ProductSeed = { name: string; manufacturer: string }

const PRODUCT_CATALOG: ProductSeed[] = [
  // Anti-Rabies
  { name: 'Abhayrab', manufacturer: 'Abhayrab' },
  { name: 'Speeda', manufacturer: 'Speeda' },
  // Adjuncts
  { name: 'AbhayTox', manufacturer: 'AbhayTox' },
  { name: 'Antitet', manufacturer: 'Antitet' },
  { name: 'Equirab', manufacturer: 'Equirab' },
  { name: 'Berirab', manufacturer: 'Berirab' },
  { name: 'Sero-Tet', manufacturer: 'Sero-Tet' },
  // Flu
  { name: 'Vaxigrip Tetra', manufacturer: 'Vaxigrip Tetra' },
  { name: 'Influvac Tetra', manufacturer: 'Influvac Tetra' },
  { name: 'Fluprevil', manufacturer: 'Fluprevil' },
  { name: 'Fluarix Tetra', manufacturer: 'Fluarix Tetra' },
  // Hep A / Hep B / Cholera / Typhoid
  { name: 'Mevac A', manufacturer: 'Mevac A' },
  { name: 'Havrix JR', manufacturer: 'Havrix JR' },
  { name: 'Avaxim', manufacturer: 'Avaxim' },
  { name: 'GeneVac', manufacturer: 'GeneVac' },
  { name: 'GenVac B Adult', manufacturer: 'GenVac B Adult' },
  { name: 'Hepliv', manufacturer: 'Hepliv' },
  { name: 'Euvichol', manufacturer: 'Euvichol' },
  { name: 'Typbar', manufacturer: 'Typbar' },
  // MMR / Chickenpox / Shingles
  { name: 'MMR 2', manufacturer: 'MMR 2' },
  { name: 'Priorix', manufacturer: 'Priorix' },
  { name: 'Tresivac', manufacturer: 'Tresivac' },
  { name: 'Varivax', manufacturer: 'Varivax' },
  { name: 'Varilrix', manufacturer: 'Varilrix' },
  { name: 'Shingrix', manufacturer: 'Shingrix' },
  // HPV / TDAP / Pneumococcal
  { name: 'Gardasil 4', manufacturer: 'Gardasil 4' },
  { name: 'Gardasil 9', manufacturer: 'Gardasil 9' },
  { name: 'Adacel', manufacturer: 'Adacel' },
  { name: 'Boostrix', manufacturer: 'Boostrix' },
  { name: 'Prevenar 13', manufacturer: 'Prevenar 13' },
  { name: 'Prevenar 20', manufacturer: 'Prevenar 20' },
  { name: 'Pneumovax 23', manufacturer: 'Pneumovax 23' },
  // DTaP-IPV: in the clinic's Vaccine sheet but with no payer rows and no v2
  // service yet. Seeded as products so a lot can be received against them and
  // the brand exists when the service is added.
  { name: 'Tetraxim', manufacturer: 'Tetraxim' },
  { name: 'Imovax', manufacturer: 'Imovax' },
]

async function seedProducts(opts: {
  tenantId: string
  createdById: number
}): Promise<Map<string, number>> {
  const byCode = new Map<string, number>()
  for (const p of PRODUCT_CATALOG) {
    const [inserted] = await db
      .insert(s.products)
      .values({
        displayId: displayId('PRD'),
        tenantId: opts.tenantId,
        name: p.name,
        manufacturer: p.manufacturer,
        createdById: opts.createdById,
      })
      .onConflictDoNothing()
      .returning({ id: s.products.id, manufacturer: s.products.manufacturer })

    if (inserted?.manufacturer) {
      byCode.set(inserted.manufacturer, inserted.id)
      continue
    }

    const [existing] = await db
      .select({ id: s.products.id })
      .from(s.products)
      .where(
        and(eq(s.products.tenantId, opts.tenantId), eq(s.products.manufacturer, p.manufacturer)),
      )
      .limit(1)
    if (!existing) throw new Error(`seedCatalog: failed to resolve product ${p.manufacturer}`)
    byCode.set(p.manufacturer, existing.id)
  }
  console.log(`  ✓ products (${byCode.size})`)
  return byCode
}

// ───────────────────────────────────────────────────────────────────────────
// Service rows (canonical clinical entities + diagnostic tests + panels)
//
// Each entry maps to one `service_catalog` row. The `category` text drives
// the `service_categories` derivation in seedCategories(); after categories
// are inserted, seedServiceCatalog() looks up the FK and clears the text.
// ───────────────────────────────────────────────────────────────────────────

type ServiceSeed = {
  id: string
  code: string
  name: string
  serviceType: 'Vaccine' | 'Lab' | 'Consultation' | 'Procedure'
  category?: string
  basePrice: string
  defaultRoute?: 'IM' | 'SC' | 'ID' | 'IV' | 'PO' | 'IN' | 'Topical' | 'INF'
  requiresStock: boolean
  requiresDoseCalculation?: boolean
  isActive?: boolean
}

const SERVICE_ROWS: ServiceSeed[] = [
  // ── Operational service entries ────────────────────────────────────────────
  {
    id: SVC_FNAT,
    code: 'FNAT',
    name: 'Fluorescent Antibody Neut. Test',
    serviceType: 'Lab',
    basePrice: '3500.00',
    requiresStock: false,
    category: 'Rabies',
  },
  {
    id: SVC_WOUND,
    code: 'WOUND',
    name: 'Wound Care & Debridement',
    serviceType: 'Procedure',
    basePrice: '750.00',
    requiresStock: false,
    category: 'Wound Care',
  },

  // ── Anti-Rabies — abstract per clinical regimen × route ────────────────────
  {
    id: SVC_ARVPEP_IM,
    code: 'ARVPEP_IM',
    name: 'Anti-Rabies PEP — Intramuscular',
    serviceType: 'Vaccine',
    category: 'Anti Rabies - PEP',
    basePrice: '1500.00',
    defaultRoute: 'IM',
    requiresStock: true,
  },
  {
    id: SVC_ARVPEP_ID,
    code: 'ARVPEP_ID',
    name: 'Anti-Rabies PEP — Intradermal',
    serviceType: 'Vaccine',
    category: 'Anti Rabies - PEP',
    basePrice: '800.00',
    defaultRoute: 'ID',
    requiresStock: true,
  },
  {
    id: SVC_ARVPREP_IM,
    code: 'ARVPREP_IM',
    name: 'Anti-Rabies PrEP — Intramuscular',
    serviceType: 'Vaccine',
    category: 'Anti Rabies - PrEP',
    basePrice: '1500.00',
    defaultRoute: 'IM',
    requiresStock: true,
  },
  {
    id: SVC_ARVPREP_ID,
    code: 'ARVPREP_ID',
    name: 'Anti-Rabies PrEP — Intradermal',
    serviceType: 'Vaccine',
    category: 'Anti Rabies - PrEP',
    basePrice: '800.00',
    defaultRoute: 'ID',
    requiresStock: true,
  },
  {
    id: SVC_ARVBOOSTER_IM,
    code: 'ARVBOOSTER_IM',
    name: 'Anti-Rabies Booster — Intramuscular',
    serviceType: 'Vaccine',
    category: 'Anti Rabies - Booster',
    basePrice: '1500.00',
    defaultRoute: 'IM',
    requiresStock: true,
  },
  {
    id: SVC_ARVBOOSTER_ID,
    code: 'ARVBOOSTER_ID',
    name: 'Anti-Rabies Booster — Intradermal',
    serviceType: 'Vaccine',
    category: 'Anti Rabies - Booster',
    basePrice: '800.00',
    defaultRoute: 'ID',
    requiresStock: true,
  },

  // ── Tetanus + passive immunization adjuncts ────────────────────────────────
  {
    id: SVC_TT,
    code: 'TT',
    name: 'Tetanus Toxoid',
    serviceType: 'Vaccine',
    category: 'Tetanus Toxoid',
    basePrice: '300.00',
    defaultRoute: 'IM',
    requiresStock: true,
  },
  {
    id: SVC_ATS,
    code: 'ATS',
    name: 'Anti-Tetanus Serum',
    serviceType: 'Vaccine',
    category: 'ATS',
    basePrice: '400.00',
    defaultRoute: 'IM',
    requiresStock: true,
    requiresDoseCalculation: true,
  },
  {
    id: SVC_ERIG_INF,
    code: 'ERIG_INF',
    name: 'ERIG — Wound Infiltration',
    serviceType: 'Vaccine',
    category: 'ERIG',
    basePrice: '2000.00',
    defaultRoute: 'INF',
    requiresStock: true,
    requiresDoseCalculation: true,
  },
  {
    id: SVC_HRIG_INF,
    code: 'HRIG_INF',
    name: 'HRIG — Wound Infiltration',
    serviceType: 'Vaccine',
    category: 'HRIG',
    basePrice: '10000.00',
    defaultRoute: 'INF',
    requiresStock: true,
    requiresDoseCalculation: true,
  },
  {
    id: SVC_HTIG,
    code: 'HTIG',
    name: 'HTIG (Human Tetanus Ig)',
    serviceType: 'Vaccine',
    category: 'HTIG',
    basePrice: '2000.00',
    defaultRoute: 'IM',
    requiresStock: true,
    requiresDoseCalculation: true,
  },

  // ── Other vaccines (single abstract entry per clinical entity) ─────────────
  {
    id: SVC_CHOLERA,
    code: 'CHOLERA',
    name: 'Cholera Vaccine',
    serviceType: 'Vaccine',
    category: 'Cholera',
    basePrice: '1300.00',
    defaultRoute: 'PO',
    requiresStock: true,
  },
  {
    id: SVC_TYPHOID,
    code: 'TYPHOID',
    name: 'Typhoid Vaccine',
    serviceType: 'Vaccine',
    category: 'Typhoid',
    basePrice: '2000.00',
    defaultRoute: 'IM',
    requiresStock: true,
  },
  {
    id: SVC_HEPA,
    code: 'HEPA',
    name: 'Hepatitis A Vaccine',
    serviceType: 'Vaccine',
    category: 'Hep A',
    basePrice: '2500.00',
    defaultRoute: 'IM',
    requiresStock: true,
  },
  {
    id: SVC_HEPB_05,
    code: 'HEPB_05',
    name: 'Hepatitis B Vaccine — Pediatric (0.5 mL)',
    serviceType: 'Vaccine',
    category: 'Hep B',
    basePrice: '1000.00',
    defaultRoute: 'IM',
    requiresStock: true,
  },
  {
    id: SVC_HEPB_10,
    code: 'HEPB_10',
    name: 'Hepatitis B Vaccine — Adult (1.0 mL)',
    serviceType: 'Vaccine',
    category: 'Hep B',
    basePrice: '2000.00',
    defaultRoute: 'IM',
    requiresStock: true,
  },
  {
    id: SVC_HPV4,
    code: 'HPV4',
    name: 'HPV 4-valent (Gardasil 4)',
    serviceType: 'Vaccine',
    category: 'HPV-4',
    basePrice: '3800.00',
    defaultRoute: 'IM',
    requiresStock: true,
  },
  {
    id: SVC_HPV9,
    code: 'HPV9',
    name: 'HPV 9-valent (Gardasil 9)',
    serviceType: 'Vaccine',
    category: 'HPV-9',
    basePrice: '8000.00',
    defaultRoute: 'IM',
    requiresStock: true,
  },
  {
    id: SVC_MMR,
    code: 'MMR',
    name: 'MMR Vaccine',
    serviceType: 'Vaccine',
    category: 'MMR',
    basePrice: '1200.00',
    defaultRoute: 'SC',
    requiresStock: true,
  },
  {
    id: SVC_TDAP,
    code: 'TDAP',
    name: 'TDAP Vaccine',
    serviceType: 'Vaccine',
    category: 'TDAP',
    basePrice: '2500.00',
    defaultRoute: 'IM',
    requiresStock: true,
  },
  {
    id: SVC_SHINGLES,
    code: 'SHINGLES',
    name: 'Shingles Vaccine (Shingrix)',
    serviceType: 'Vaccine',
    category: 'Shingles',
    basePrice: '10000.00',
    defaultRoute: 'IM',
    requiresStock: true,
  },
  {
    id: SVC_VARICELLA_SC,
    code: 'VARICELLA_SC',
    name: 'Varicella Vaccine — Subcutaneous',
    serviceType: 'Vaccine',
    category: 'Chickenpox',
    basePrice: '3500.00',
    defaultRoute: 'SC',
    requiresStock: true,
  },
  {
    id: SVC_VARICELLA_IM,
    code: 'VARICELLA_IM',
    name: 'Varicella Vaccine — Intramuscular',
    serviceType: 'Vaccine',
    category: 'Chickenpox',
    basePrice: '3500.00',
    defaultRoute: 'IM',
    requiresStock: true,
  },
  {
    id: SVC_P13,
    code: 'P13',
    name: 'Pneumococcal 13-valent (Prevenar 13)',
    serviceType: 'Vaccine',
    category: 'Pneumonia 13',
    basePrice: '4000.00',
    defaultRoute: 'IM',
    requiresStock: true,
  },
  {
    id: SVC_P20,
    code: 'P20',
    name: 'Pneumococcal 20-valent (Prevenar 20)',
    serviceType: 'Vaccine',
    category: 'Pneumonia 20',
    basePrice: '4500.00',
    defaultRoute: 'IM',
    requiresStock: true,
  },
  {
    id: SVC_P23,
    code: 'P23',
    name: 'Pneumococcal 23-valent (Pneumovax 23)',
    serviceType: 'Vaccine',
    category: 'Pneumonia 23',
    basePrice: '3000.00',
    defaultRoute: 'IM',
    requiresStock: true,
  },

  // ── Flu (abstract — 4 eligible brands) ─────────────────────────────────────
  {
    id: SVC_FLU_QUAD,
    code: 'FLU_QUAD',
    name: 'Influenza Vaccine (Quadrivalent)',
    serviceType: 'Vaccine',
    category: 'Flu',
    basePrice: '1200.00',
    defaultRoute: 'IM',
    requiresStock: true,
  },

  // ── Consultations + procedures (attribution via performed_by_id) ───────────
  {
    id: SVC_CONSULTATION,
    code: 'CONSULTATION',
    name: "Doctor's Consultation",
    serviceType: 'Consultation',
    category: 'Service',
    basePrice: '500.00',
    requiresStock: false,
  },
  {
    id: SVC_TELECONSULT,
    code: 'TELECONSULT',
    name: 'Teleconsultation',
    serviceType: 'Consultation',
    category: 'Service',
    basePrice: '500.00',
    requiresStock: false,
  },
  {
    id: SVC_MEDCERT,
    code: 'MEDCERT',
    name: 'Medical Certificate',
    serviceType: 'Procedure',
    category: 'Service',
    basePrice: '500.00',
    requiresStock: false,
  },
  {
    id: SVC_OTHER,
    code: 'OTHER',
    name: 'Other Services',
    serviceType: 'Procedure',
    category: 'Other',
    basePrice: '0.00',
    requiresStock: false,
  },

  // ── Individual diagnostic tests (32) ───────────────────────────────────────
  {
    id: 'LAB_VITAMIN_D',
    code: 'LAB_VITAMIN_D',
    name: 'Vitamin D',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '2795.00',
    requiresStock: false,
  },
  {
    id: 'LAB_PTT_APTT',
    code: 'LAB_PTT_APTT',
    name: 'PTT (APTT)',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '470.00',
    requiresStock: false,
  },
  {
    id: 'LAB_ALP',
    code: 'LAB_ALP',
    name: 'Alkaline Phosphatase (ALP)',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '145.00',
    requiresStock: false,
  },
  {
    id: 'LAB_ABO_RH',
    code: 'LAB_ABO_RH',
    name: 'ABO and Rh',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '280.00',
    requiresStock: false,
  },
  {
    id: 'LAB_UREA',
    code: 'LAB_UREA',
    name: 'Urea',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '125.00',
    requiresStock: false,
  },
  {
    id: 'LAB_CT_NG_URINE',
    code: 'LAB_CT_NG_URINE',
    name: 'CT/NG (Urine Sample)',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '6470.00',
    requiresStock: false,
  },
  {
    id: 'LAB_CBC_14',
    code: 'LAB_CBC_14',
    name: 'Complete Blood Count (14 Panel)',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '275.00',
    requiresStock: false,
  },
  {
    id: 'LAB_CREATININE_EGFR',
    code: 'LAB_CREATININE_EGFR',
    name: 'Creatinine (with EGFR)',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '125.00',
    requiresStock: false,
  },
  {
    id: 'LAB_GLUCOSE_FBS',
    code: 'LAB_GLUCOSE_FBS',
    name: 'Glucose (FBS/RBS)',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '95.00',
    requiresStock: false,
  },
  {
    id: 'LAB_FECALYSIS',
    code: 'LAB_FECALYSIS',
    name: 'Fecalysis',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '95.00',
    requiresStock: false,
  },
  {
    id: 'LAB_FT3',
    code: 'LAB_FT3',
    name: 'Free T3 (FT3)',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '470.00',
    requiresStock: false,
  },
  {
    id: 'LAB_FT4',
    code: 'LAB_FT4',
    name: 'Free T4 (FT4)',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '470.00',
    requiresStock: false,
  },
  {
    id: 'LAB_HBA1C',
    code: 'LAB_HBA1C',
    name: 'HbA1c (with eAG)',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '470.00',
    requiresStock: false,
  },
  {
    id: 'LAB_HEP_B_SAG',
    code: 'LAB_HEP_B_SAG',
    name: 'Hepatitis B Surface Antigen',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '210.00',
    requiresStock: false,
  },
  {
    id: 'LAB_HDL',
    code: 'LAB_HDL',
    name: 'HDL Cholesterol',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '225.00',
    requiresStock: false,
  },
  {
    id: 'LAB_HIV_AGAB',
    code: 'LAB_HIV_AGAB',
    name: 'HIV Ag/Ab 1&2 (TAT: 48hrs)',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '495.00',
    requiresStock: false,
  },
  {
    id: 'LAB_HSV1_IGG',
    code: 'LAB_HSV1_IGG',
    name: 'HSV 1 IgG (Running Day: M/TH)',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '1745.00',
    requiresStock: false,
  },
  {
    id: 'LAB_HSV2_IGG',
    code: 'LAB_HSV2_IGG',
    name: 'HSV 2 IgG (Running Day: M/TH)',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '1745.00',
    requiresStock: false,
  },
  {
    id: 'LAB_IONIZED_CA',
    code: 'LAB_IONIZED_CA',
    name: 'Ionized Calcium',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '495.00',
    requiresStock: false,
  },
  {
    id: 'LAB_LIPID_PROFILE',
    code: 'LAB_LIPID_PROFILE',
    name: 'Lipid Profile',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '525.00',
    requiresStock: false,
  },
  {
    id: 'LAB_MAGNESIUM',
    code: 'LAB_MAGNESIUM',
    name: 'Magnesium',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '355.00',
    requiresStock: false,
  },
  {
    id: 'LAB_HCG_QUAL',
    code: 'LAB_HCG_QUAL',
    name: 'HCG Qualitative',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '270.00',
    requiresStock: false,
  },
  {
    id: 'LAB_URINE_HCG_STRIP',
    code: 'LAB_URINE_HCG_STRIP',
    name: 'Urine hCG (strip)',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '210.00',
    requiresStock: false,
  },
  {
    id: 'LAB_URINALYSIS_10',
    code: 'LAB_URINALYSIS_10',
    name: 'Urinalysis (10 Panel)',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '105.00',
    requiresStock: false,
  },
  {
    id: 'LAB_RPR_QUAL',
    code: 'LAB_RPR_QUAL',
    name: 'RPR Qualitative',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '320.00',
    requiresStock: false,
  },
  {
    id: 'LAB_AST_SGOT',
    code: 'LAB_AST_SGOT',
    name: 'AST (SGOT)',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '135.00',
    requiresStock: false,
  },
  {
    id: 'LAB_ALT_SGPT',
    code: 'LAB_ALT_SGPT',
    name: 'ALT (SGPT)',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '135.00',
    requiresStock: false,
  },
  {
    id: 'LAB_T4',
    code: 'LAB_T4',
    name: 'T4',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '430.00',
    requiresStock: false,
  },
  {
    id: 'LAB_TOTAL_TESTOSTERONE',
    code: 'LAB_TOTAL_TESTOSTERONE',
    name: 'Total Testosterone',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '1330.00',
    requiresStock: false,
  },
  {
    id: 'LAB_CHOLESTEROL',
    code: 'LAB_CHOLESTEROL',
    name: 'Cholesterol',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '125.00',
    requiresStock: false,
  },
  {
    id: 'LAB_TSH',
    code: 'LAB_TSH',
    name: 'TSH',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '595.00',
    requiresStock: false,
  },
  {
    id: 'LAB_URIC_ACID',
    code: 'LAB_URIC_ACID',
    name: 'Uric Acid',
    serviceType: 'Lab',
    category: 'Diagnostics — Individual',
    basePrice: '125.00',
    requiresStock: false,
  },

  // ── Panel constituents (hidden — satisfy service_bundle_items FK only) ─────
  {
    id: 'LAB_ALBUMIN',
    code: 'LAB_ALBUMIN',
    name: 'Albumin',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '210.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_AMH',
    code: 'LAB_AMH',
    name: 'Anti-Mullerian Hormone (AMH)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '3500.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_BICARBONATE',
    code: 'LAB_BICARBONATE',
    name: 'Bicarbonate',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '140.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_BILIRUBIN_TOTAL',
    code: 'LAB_BILIRUBIN_TOTAL',
    name: 'Bilirubin — Total',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '155.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_BILIRUBIN_DIRECT',
    code: 'LAB_BILIRUBIN_DIRECT',
    name: 'Bilirubin — Direct',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '155.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_BILIRUBIN_TBDBIB',
    code: 'LAB_BILIRUBIN_TBDBIB',
    name: 'Bilirubin (TB, DB, IB)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '320.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_CA125',
    code: 'LAB_CA125',
    name: 'CA 125',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '1285.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_CRP_HS',
    code: 'LAB_CRP_HS',
    name: 'CRP (high sensitive)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '700.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_CALCIUM',
    code: 'LAB_CALCIUM',
    name: 'Calcium',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '160.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_CHLORIDE',
    code: 'LAB_CHLORIDE',
    name: 'Chloride',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '120.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_DENGUE_AB',
    code: 'LAB_DENGUE_AB',
    name: 'Dengue Ab (IgG/IgM)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '780.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_DENGUE_NS1',
    code: 'LAB_DENGUE_NS1',
    name: 'Dengue NS1',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '950.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_ESTRADIOL',
    code: 'LAB_ESTRADIOL',
    name: 'Estradiol',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '650.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_FSH',
    code: 'LAB_FSH',
    name: 'FSH',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '780.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_FERRITIN',
    code: 'LAB_FERRITIN',
    name: 'Ferritin',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '780.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_HEP_B_SAB',
    code: 'LAB_HEP_B_SAB',
    name: 'Hepatitis B Surface Antibody',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '395.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_HEP_C_AB',
    code: 'LAB_HEP_C_AB',
    name: 'Hepatitis C Antibody',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '730.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_INSULIN',
    code: 'LAB_INSULIN',
    name: 'Insulin',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '950.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_IRON',
    code: 'LAB_IRON',
    name: 'Iron',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '380.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_LH',
    code: 'LAB_LH',
    name: 'Luteinizing Hormone (LH)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '780.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_PSA_TOTAL',
    code: 'LAB_PSA_TOTAL',
    name: 'PSA — Total',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '1050.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_PT_INR',
    code: 'LAB_PT_INR',
    name: 'PT (INR)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '470.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_POTASSIUM',
    code: 'LAB_POTASSIUM',
    name: 'Potassium',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '120.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_PROLACTIN',
    code: 'LAB_PROLACTIN',
    name: 'Prolactin',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '780.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_RUBELLA_IGG',
    code: 'LAB_RUBELLA_IGG',
    name: 'Rubella IgG (German Measles)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '850.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_SODIUM',
    code: 'LAB_SODIUM',
    name: 'Sodium',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '120.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_SYPHILIS_AB',
    code: 'LAB_SYPHILIS_AB',
    name: 'Syphilis Ab',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '385.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_TPA_G',
    code: 'LAB_TPA_G',
    name: 'Total Protein, Albumin, Globulin (TPA/G)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '320.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_TESTOSTERONE_PROFILE',
    code: 'LAB_TESTOSTERONE_PROFILE',
    name: 'Testosterone Profile (Free & Total)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '2100.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_TOTAL_PROTEIN',
    code: 'LAB_TOTAL_PROTEIN',
    name: 'Total Protein',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '155.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_TROPONIN_I_HS',
    code: 'LAB_TROPONIN_I_HS',
    name: 'Troponin I (high sensitive)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '1280.00',
    requiresStock: false,
    isActive: false,
  },
  {
    id: 'LAB_URINE_MICROALBUMIN',
    code: 'LAB_URINE_MICROALBUMIN',
    name: 'Urine Microalbumin',
    serviceType: 'Lab',
    category: 'Diagnostics — Panel Constituents (hidden)',
    basePrice: '720.00',
    requiresStock: false,
    isActive: false,
  },

  // ── Wellness panels (24 bundles) — composition wired via service_bundle_items
  {
    id: 'PANEL_SV01',
    code: 'PANEL_SV01',
    name: 'Cardiac Panel (SV01)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panels',
    basePrice: '2430.00',
    requiresStock: false,
  },
  {
    id: 'PANEL_SV02',
    code: 'PANEL_SV02',
    name: 'CHEM 10 (SV02)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panels',
    basePrice: '1315.00',
    requiresStock: false,
  },
  {
    id: 'PANEL_SV03',
    code: 'PANEL_SV03',
    name: 'Dengue Duo (SV03)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panels',
    basePrice: '2500.00',
    requiresStock: false,
  },
  {
    id: 'PANEL_SV04',
    code: 'PANEL_SV04',
    name: 'Diabetes Work-Up (SV04)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panels',
    basePrice: '1605.00',
    requiresStock: false,
  },
  {
    id: 'PANEL_SV05',
    code: 'PANEL_SV05',
    name: 'Female Executive Wellness (SV05)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panels',
    basePrice: '2925.00',
    requiresStock: false,
  },
  {
    id: 'PANEL_SV06',
    code: 'PANEL_SV06',
    name: 'Female Wellness (SV06)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panels',
    basePrice: '1220.00',
    requiresStock: false,
  },
  {
    id: 'PANEL_SV07',
    code: 'PANEL_SV07',
    name: 'Fertility Screening — Comprehensive (SV07)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panels',
    basePrice: '10715.00',
    requiresStock: false,
  },
  {
    id: 'PANEL_SV08',
    code: 'PANEL_SV08',
    name: 'General Wellness (SV08)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panels',
    basePrice: '385.00',
    requiresStock: false,
  },
  {
    id: 'PANEL_SV09',
    code: 'PANEL_SV09',
    name: 'Heavy Period Tests (SV09)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panels',
    basePrice: '2455.00',
    requiresStock: false,
  },
  {
    id: 'PANEL_SV10',
    code: 'PANEL_SV10',
    name: 'Liver Function Test — LFT (SV10)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panels',
    basePrice: '1215.00',
    requiresStock: false,
  },
  {
    id: 'PANEL_SV11',
    code: 'PANEL_SV11',
    name: 'Male Executive Wellness (SV11)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panels',
    basePrice: '2040.00',
    requiresStock: false,
  },
  {
    id: 'PANEL_SV12',
    code: 'PANEL_SV12',
    name: 'Male Wellness (SV12)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panels',
    basePrice: '1005.00',
    requiresStock: false,
  },
  {
    id: 'PANEL_SV13',
    code: 'PANEL_SV13',
    name: 'Menopause Basic (SV13)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panels',
    basePrice: '2405.00',
    requiresStock: false,
  },
  {
    id: 'PANEL_SV14',
    code: 'PANEL_SV14',
    name: 'Menopause Comprehensive (SV14)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panels',
    basePrice: '3450.00',
    requiresStock: false,
  },
  {
    id: 'PANEL_SV15',
    code: 'PANEL_SV15',
    name: 'Metabolic Panel (SV15)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panels',
    basePrice: '1275.00',
    requiresStock: false,
  },
  {
    id: 'PANEL_SV16',
    code: 'PANEL_SV16',
    name: 'PCOS Basic (SV16)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panels',
    basePrice: '8740.00',
    requiresStock: false,
  },
  {
    id: 'PANEL_SV17',
    code: 'PANEL_SV17',
    name: 'PCOS Comprehensive (SV17)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panels',
    basePrice: '10645.00',
    requiresStock: false,
  },
  {
    id: 'PANEL_SV18',
    code: 'PANEL_SV18',
    name: 'Sexual Health Basic (SV18)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panels',
    basePrice: '1075.00',
    requiresStock: false,
  },
  {
    id: 'PANEL_SV19',
    code: 'PANEL_SV19',
    name: 'Sexual Health Comprehensive (SV19)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panels',
    basePrice: '9285.00',
    requiresStock: false,
  },
  {
    id: 'PANEL_SV20',
    code: 'PANEL_SV20',
    name: 'SPEC 23 (SV20)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panels',
    basePrice: '2475.00',
    requiresStock: false,
  },
  {
    id: 'PANEL_SV21',
    code: 'PANEL_SV21',
    name: 'STD / Complete STD (SV21)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panels',
    basePrice: '13095.00',
    requiresStock: false,
  },
  {
    id: 'PANEL_SV23',
    code: 'PANEL_SV23',
    name: 'Basic Wellness (SV23)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panels',
    basePrice: '910.00',
    requiresStock: false,
  },
  {
    id: 'PANEL_TFT1',
    code: 'PANEL_TFT1',
    name: 'Thyroid Panel (TFT1)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panels',
    basePrice: '1125.00',
    requiresStock: false,
  },
  {
    id: 'PANEL_CA125',
    code: 'PANEL_CA125',
    name: 'Ovarian Malignancy Screening (CA125)',
    serviceType: 'Lab',
    category: 'Diagnostics — Panels',
    basePrice: '1285.00',
    requiresStock: false,
  },
]

// ───────────────────────────────────────────────────────────────────────────
// Section 2 — service_categories
// ───────────────────────────────────────────────────────────────────────────

async function seedCategories(opts: {
  tenantId: string
  createdById: number
}): Promise<Map<string, number>> {
  const categoryNames = Array.from(
    new Set(SERVICE_ROWS.map((row) => row.category).filter((c): c is string => !!c)),
  ).sort()

  const byCode = new Map<string, number>()
  for (const name of categoryNames) {
    const [inserted] = await db
      .insert(s.serviceCategories)
      .values({
        displayId: displayId('CAT'),
        tenantId: opts.tenantId,
        name,
        parentId: null,
        displayOrder: 0,
        createdById: opts.createdById,
      })
      .onConflictDoNothing()
      .returning({ id: s.serviceCategories.id, name: s.serviceCategories.name })

    if (inserted) {
      byCode.set(inserted.name, inserted.id)
      continue
    }

    const [existing] = await db
      .select({ id: s.serviceCategories.id })
      .from(s.serviceCategories)
      .where(
        and(eq(s.serviceCategories.tenantId, opts.tenantId), eq(s.serviceCategories.name, name)),
      )
      .limit(1)
    if (!existing) throw new Error(`seedCatalog: failed to resolve category ${name}`)
    byCode.set(name, existing.id)
  }
  console.log(`  ✓ service categories (${byCode.size})`)
  return byCode
}

// ───────────────────────────────────────────────────────────────────────────
// Section 3 — service_catalog (raw-code PK) + base service_prices
// ───────────────────────────────────────────────────────────────────────────

async function seedServiceCatalog(opts: {
  tenantId: string
  createdById: number
  categoriesByCode: Map<string, number>
}): Promise<Map<string, string>> {
  const byCode = new Map<string, string>()

  for (const svc of SERVICE_ROWS) {
    const categoryId = svc.category ? (opts.categoriesByCode.get(svc.category) ?? null) : null

    await db
      .insert(s.serviceCatalog)
      .values({
        id: svc.id,
        tenantId: opts.tenantId,
        code: svc.code,
        name: svc.name,
        serviceType: svc.serviceType,
        categoryId,
        productId: null, // abstract — eligible products wired via service_eligible_products
        defaultRoute: svc.defaultRoute ?? null,
        requiresStock: svc.requiresStock,
        requiresDoseCalculation: svc.requiresDoseCalculation ?? false,
        isActive: svc.isActive ?? true,
        createdById: opts.createdById,
      })
      .onConflictDoNothing()

    byCode.set(svc.code, svc.id)

    // Base price row (payer-agnostic, branch-agnostic).
    await db
      .insert(s.servicePrices)
      .values({
        displayId: displayId('SVP'),
        tenantId: opts.tenantId,
        serviceId: svc.id,
        branchId: null,
        payerId: null,
        patientSegment: null,
        unitPrice: svc.basePrice,
        currency: 'PHP',
        effectiveFrom: '-infinity',
        effectiveTo: null,
        createdById: opts.createdById,
      })
      .onConflictDoNothing()
  }

  console.log(`  ✓ service catalog (${SERVICE_ROWS.length}) + base service_prices`)
  return byCode
}

// ───────────────────────────────────────────────────────────────────────────
// Section 4 — service_bundle_items + service_eligible_products
// ───────────────────────────────────────────────────────────────────────────

type EligiblePair = {
  serviceId: string
  manufacturer: string
  isDefault?: boolean
  ranking?: number
}

const ELIGIBLE_PAIRS: EligiblePair[] = [
  // Anti-Rabies — Abhayrab default, Speeda fallback
  { serviceId: SVC_ARVPEP_IM, manufacturer: 'Abhayrab', isDefault: true, ranking: 0 },
  { serviceId: SVC_ARVPEP_IM, manufacturer: 'Speeda', ranking: 1 },
  { serviceId: SVC_ARVPEP_ID, manufacturer: 'Abhayrab', isDefault: true, ranking: 0 },
  { serviceId: SVC_ARVPEP_ID, manufacturer: 'Speeda', ranking: 1 },
  { serviceId: SVC_ARVPREP_IM, manufacturer: 'Abhayrab', isDefault: true, ranking: 0 },
  { serviceId: SVC_ARVPREP_IM, manufacturer: 'Speeda', ranking: 1 },
  { serviceId: SVC_ARVPREP_ID, manufacturer: 'Abhayrab', isDefault: true, ranking: 0 },
  { serviceId: SVC_ARVPREP_ID, manufacturer: 'Speeda', ranking: 1 },
  { serviceId: SVC_ARVBOOSTER_IM, manufacturer: 'Abhayrab', isDefault: true, ranking: 0 },
  { serviceId: SVC_ARVBOOSTER_IM, manufacturer: 'Speeda', ranking: 1 },
  { serviceId: SVC_ARVBOOSTER_ID, manufacturer: 'Abhayrab', isDefault: true, ranking: 0 },
  { serviceId: SVC_ARVBOOSTER_ID, manufacturer: 'Speeda', ranking: 1 },

  // Adjuncts — single brand each
  { serviceId: SVC_TT, manufacturer: 'AbhayTox', isDefault: true },
  { serviceId: SVC_ATS, manufacturer: 'Antitet', isDefault: true },
  { serviceId: SVC_ERIG_INF, manufacturer: 'Equirab', isDefault: true },
  { serviceId: SVC_HRIG_INF, manufacturer: 'Berirab', isDefault: true },
  { serviceId: SVC_HTIG, manufacturer: 'Sero-Tet', isDefault: true },

  // Flu — 4 eligible brands
  { serviceId: SVC_FLU_QUAD, manufacturer: 'Vaxigrip Tetra', isDefault: true, ranking: 0 },
  { serviceId: SVC_FLU_QUAD, manufacturer: 'Influvac Tetra', ranking: 1 },
  { serviceId: SVC_FLU_QUAD, manufacturer: 'Fluprevil', ranking: 2 },
  { serviceId: SVC_FLU_QUAD, manufacturer: 'Fluarix Tetra', ranking: 3 },

  // Other vaccines
  { serviceId: SVC_CHOLERA, manufacturer: 'Euvichol', isDefault: true },
  { serviceId: SVC_TYPHOID, manufacturer: 'Typbar', isDefault: true },
  { serviceId: SVC_HEPA, manufacturer: 'Mevac A', isDefault: true, ranking: 0 },
  { serviceId: SVC_HEPA, manufacturer: 'Havrix JR', ranking: 1 },
  { serviceId: SVC_HEPA, manufacturer: 'Avaxim', ranking: 2 },
  { serviceId: SVC_HEPB_05, manufacturer: 'GeneVac', isDefault: true },
  { serviceId: SVC_HEPB_10, manufacturer: 'GenVac B Adult', isDefault: true, ranking: 0 },
  { serviceId: SVC_HEPB_10, manufacturer: 'GeneVac', ranking: 1 },
  { serviceId: SVC_HPV4, manufacturer: 'Gardasil 4', isDefault: true },
  { serviceId: SVC_HPV9, manufacturer: 'Gardasil 9', isDefault: true },
  { serviceId: SVC_MMR, manufacturer: 'MMR 2', isDefault: true, ranking: 0 },
  { serviceId: SVC_MMR, manufacturer: 'Tresivac', ranking: 1 },
  { serviceId: SVC_TDAP, manufacturer: 'Boostrix', isDefault: true, ranking: 0 },
  { serviceId: SVC_TDAP, manufacturer: 'Adacel', ranking: 1 },
  { serviceId: SVC_SHINGLES, manufacturer: 'Shingrix', isDefault: true },
  { serviceId: SVC_VARICELLA_SC, manufacturer: 'Varivax', isDefault: true, ranking: 0 },
  { serviceId: SVC_VARICELLA_SC, manufacturer: 'Varilrix', ranking: 1 },
  { serviceId: SVC_VARICELLA_IM, manufacturer: 'Varivax', isDefault: true, ranking: 0 },
  { serviceId: SVC_VARICELLA_IM, manufacturer: 'Varilrix', ranking: 1 },
  { serviceId: SVC_P13, manufacturer: 'Prevenar 13', isDefault: true },
  { serviceId: SVC_P20, manufacturer: 'Prevenar 20', isDefault: true },
  { serviceId: SVC_P23, manufacturer: 'Pneumovax 23', isDefault: true },
]

async function seedEligibleProducts(opts: {
  tenantId: string
  productsByCode: Map<string, number>
}): Promise<void> {
  let wired = 0
  for (const pair of ELIGIBLE_PAIRS) {
    const productId = opts.productsByCode.get(pair.manufacturer)
    if (!productId) continue
    await db
      .insert(s.serviceEligibleProducts)
      .values({
        tenantId: opts.tenantId,
        serviceId: pair.serviceId,
        productId,
        isDefault: pair.isDefault ?? false,
        ranking: pair.ranking ?? 0,
      })
      .onConflictDoNothing()
    wired++
  }
  console.log(`  ✓ service eligible products (${wired})`)
}

// Bundle composition: which lab tests make up each wellness panel. Bundle row
// stays the billable unit in service_catalog + service_prices; these enumerate
// the constituent tests for expansion at order time.
const BUNDLE_ITEMS: Array<{ bundleCode: string; itemCode: string }> = [
  { bundleCode: 'PANEL_SV01', itemCode: 'LAB_LIPID_PROFILE' },
  { bundleCode: 'PANEL_SV01', itemCode: 'LAB_CRP_HS' },
  { bundleCode: 'PANEL_SV01', itemCode: 'LAB_TROPONIN_I_HS' },
  { bundleCode: 'PANEL_SV02', itemCode: 'LAB_GLUCOSE_FBS' },
  { bundleCode: 'PANEL_SV02', itemCode: 'LAB_UREA' },
  { bundleCode: 'PANEL_SV02', itemCode: 'LAB_CREATININE_EGFR' },
  { bundleCode: 'PANEL_SV02', itemCode: 'LAB_URIC_ACID' },
  { bundleCode: 'PANEL_SV02', itemCode: 'LAB_LIPID_PROFILE' },
  { bundleCode: 'PANEL_SV02', itemCode: 'LAB_SODIUM' },
  { bundleCode: 'PANEL_SV02', itemCode: 'LAB_POTASSIUM' },
  { bundleCode: 'PANEL_SV02', itemCode: 'LAB_CHLORIDE' },
  { bundleCode: 'PANEL_SV02', itemCode: 'LAB_CALCIUM' },
  { bundleCode: 'PANEL_SV02', itemCode: 'LAB_ALT_SGPT' },
  { bundleCode: 'PANEL_SV03', itemCode: 'LAB_DENGUE_NS1' },
  { bundleCode: 'PANEL_SV03', itemCode: 'LAB_DENGUE_AB' },
  { bundleCode: 'PANEL_SV03', itemCode: 'LAB_CBC_14' },
  { bundleCode: 'PANEL_SV04', itemCode: 'LAB_GLUCOSE_FBS' },
  { bundleCode: 'PANEL_SV04', itemCode: 'LAB_HBA1C' },
  { bundleCode: 'PANEL_SV04', itemCode: 'LAB_LIPID_PROFILE' },
  { bundleCode: 'PANEL_SV04', itemCode: 'LAB_URINE_MICROALBUMIN' },
  { bundleCode: 'PANEL_SV04', itemCode: 'LAB_CREATININE_EGFR' },
  { bundleCode: 'PANEL_SV05', itemCode: 'LAB_CBC_14' },
  { bundleCode: 'PANEL_SV05', itemCode: 'LAB_URINALYSIS_10' },
  { bundleCode: 'PANEL_SV05', itemCode: 'LAB_GLUCOSE_FBS' },
  { bundleCode: 'PANEL_SV05', itemCode: 'LAB_LIPID_PROFILE' },
  { bundleCode: 'PANEL_SV05', itemCode: 'LAB_IRON' },
  { bundleCode: 'PANEL_SV05', itemCode: 'LAB_CA125' },
  { bundleCode: 'PANEL_SV05', itemCode: 'LAB_TSH' },
  { bundleCode: 'PANEL_SV05', itemCode: 'LAB_ALT_SGPT' },
  { bundleCode: 'PANEL_SV05', itemCode: 'LAB_CREATININE_EGFR' },
  { bundleCode: 'PANEL_SV06', itemCode: 'LAB_CBC_14' },
  { bundleCode: 'PANEL_SV06', itemCode: 'LAB_URINALYSIS_10' },
  { bundleCode: 'PANEL_SV06', itemCode: 'LAB_GLUCOSE_FBS' },
  { bundleCode: 'PANEL_SV06', itemCode: 'LAB_LIPID_PROFILE' },
  { bundleCode: 'PANEL_SV06', itemCode: 'LAB_IRON' },
  { bundleCode: 'PANEL_SV07', itemCode: 'LAB_AMH' },
  { bundleCode: 'PANEL_SV07', itemCode: 'LAB_FSH' },
  { bundleCode: 'PANEL_SV07', itemCode: 'LAB_LH' },
  { bundleCode: 'PANEL_SV07', itemCode: 'LAB_PROLACTIN' },
  { bundleCode: 'PANEL_SV07', itemCode: 'LAB_TSH' },
  { bundleCode: 'PANEL_SV07', itemCode: 'LAB_RUBELLA_IGG' },
  { bundleCode: 'PANEL_SV08', itemCode: 'LAB_CBC_14' },
  { bundleCode: 'PANEL_SV08', itemCode: 'LAB_URINALYSIS_10' },
  { bundleCode: 'PANEL_SV08', itemCode: 'LAB_GLUCOSE_FBS' },
  { bundleCode: 'PANEL_SV09', itemCode: 'LAB_CBC_14' },
  { bundleCode: 'PANEL_SV09', itemCode: 'LAB_FERRITIN' },
  { bundleCode: 'PANEL_SV09', itemCode: 'LAB_IRON' },
  { bundleCode: 'PANEL_SV09', itemCode: 'LAB_PT_INR' },
  { bundleCode: 'PANEL_SV09', itemCode: 'LAB_PTT_APTT' },
  { bundleCode: 'PANEL_SV09', itemCode: 'LAB_TSH' },
  { bundleCode: 'PANEL_SV10', itemCode: 'LAB_ALT_SGPT' },
  { bundleCode: 'PANEL_SV10', itemCode: 'LAB_AST_SGOT' },
  { bundleCode: 'PANEL_SV10', itemCode: 'LAB_BILIRUBIN_TOTAL' },
  { bundleCode: 'PANEL_SV10', itemCode: 'LAB_BILIRUBIN_DIRECT' },
  { bundleCode: 'PANEL_SV10', itemCode: 'LAB_BILIRUBIN_TBDBIB' },
  { bundleCode: 'PANEL_SV10', itemCode: 'LAB_ALBUMIN' },
  { bundleCode: 'PANEL_SV10', itemCode: 'LAB_TPA_G' },
  { bundleCode: 'PANEL_SV10', itemCode: 'LAB_ALP' },
  { bundleCode: 'PANEL_SV11', itemCode: 'LAB_CBC_14' },
  { bundleCode: 'PANEL_SV11', itemCode: 'LAB_URINALYSIS_10' },
  { bundleCode: 'PANEL_SV11', itemCode: 'LAB_GLUCOSE_FBS' },
  { bundleCode: 'PANEL_SV11', itemCode: 'LAB_LIPID_PROFILE' },
  { bundleCode: 'PANEL_SV11', itemCode: 'LAB_URIC_ACID' },
  { bundleCode: 'PANEL_SV11', itemCode: 'LAB_PSA_TOTAL' },
  { bundleCode: 'PANEL_SV11', itemCode: 'LAB_ALT_SGPT' },
  { bundleCode: 'PANEL_SV11', itemCode: 'LAB_CREATININE_EGFR' },
  { bundleCode: 'PANEL_SV12', itemCode: 'LAB_CBC_14' },
  { bundleCode: 'PANEL_SV12', itemCode: 'LAB_URINALYSIS_10' },
  { bundleCode: 'PANEL_SV12', itemCode: 'LAB_GLUCOSE_FBS' },
  { bundleCode: 'PANEL_SV12', itemCode: 'LAB_LIPID_PROFILE' },
  { bundleCode: 'PANEL_SV12', itemCode: 'LAB_URIC_ACID' },
  { bundleCode: 'PANEL_SV13', itemCode: 'LAB_FSH' },
  { bundleCode: 'PANEL_SV13', itemCode: 'LAB_LH' },
  { bundleCode: 'PANEL_SV13', itemCode: 'LAB_ESTRADIOL' },
  { bundleCode: 'PANEL_SV14', itemCode: 'LAB_FSH' },
  { bundleCode: 'PANEL_SV14', itemCode: 'LAB_LH' },
  { bundleCode: 'PANEL_SV14', itemCode: 'LAB_ESTRADIOL' },
  { bundleCode: 'PANEL_SV14', itemCode: 'LAB_LIPID_PROFILE' },
  { bundleCode: 'PANEL_SV14', itemCode: 'LAB_CALCIUM' },
  { bundleCode: 'PANEL_SV14', itemCode: 'LAB_TSH' },
  { bundleCode: 'PANEL_SV15', itemCode: 'LAB_GLUCOSE_FBS' },
  { bundleCode: 'PANEL_SV15', itemCode: 'LAB_UREA' },
  { bundleCode: 'PANEL_SV15', itemCode: 'LAB_CREATININE_EGFR' },
  { bundleCode: 'PANEL_SV15', itemCode: 'LAB_SODIUM' },
  { bundleCode: 'PANEL_SV15', itemCode: 'LAB_POTASSIUM' },
  { bundleCode: 'PANEL_SV15', itemCode: 'LAB_CHLORIDE' },
  { bundleCode: 'PANEL_SV15', itemCode: 'LAB_BICARBONATE' },
  { bundleCode: 'PANEL_SV15', itemCode: 'LAB_CALCIUM' },
  { bundleCode: 'PANEL_SV16', itemCode: 'LAB_FSH' },
  { bundleCode: 'PANEL_SV16', itemCode: 'LAB_LH' },
  { bundleCode: 'PANEL_SV16', itemCode: 'LAB_PROLACTIN' },
  { bundleCode: 'PANEL_SV16', itemCode: 'LAB_TESTOSTERONE_PROFILE' },
  { bundleCode: 'PANEL_SV17', itemCode: 'LAB_FSH' },
  { bundleCode: 'PANEL_SV17', itemCode: 'LAB_LH' },
  { bundleCode: 'PANEL_SV17', itemCode: 'LAB_PROLACTIN' },
  { bundleCode: 'PANEL_SV17', itemCode: 'LAB_TESTOSTERONE_PROFILE' },
  { bundleCode: 'PANEL_SV17', itemCode: 'LAB_GLUCOSE_FBS' },
  { bundleCode: 'PANEL_SV17', itemCode: 'LAB_INSULIN' },
  { bundleCode: 'PANEL_SV17', itemCode: 'LAB_HBA1C' },
  { bundleCode: 'PANEL_SV17', itemCode: 'LAB_LIPID_PROFILE' },
  { bundleCode: 'PANEL_SV18', itemCode: 'LAB_HIV_AGAB' },
  { bundleCode: 'PANEL_SV18', itemCode: 'LAB_SYPHILIS_AB' },
  { bundleCode: 'PANEL_SV18', itemCode: 'LAB_HEP_B_SAG' },
  { bundleCode: 'PANEL_SV19', itemCode: 'LAB_HIV_AGAB' },
  { bundleCode: 'PANEL_SV19', itemCode: 'LAB_SYPHILIS_AB' },
  { bundleCode: 'PANEL_SV19', itemCode: 'LAB_HEP_B_SAG' },
  { bundleCode: 'PANEL_SV19', itemCode: 'LAB_HEP_C_AB' },
  { bundleCode: 'PANEL_SV19', itemCode: 'LAB_CT_NG_URINE' },
  { bundleCode: 'PANEL_SV20', itemCode: 'LAB_GLUCOSE_FBS' },
  { bundleCode: 'PANEL_SV20', itemCode: 'LAB_UREA' },
  { bundleCode: 'PANEL_SV20', itemCode: 'LAB_CREATININE_EGFR' },
  { bundleCode: 'PANEL_SV20', itemCode: 'LAB_URIC_ACID' },
  { bundleCode: 'PANEL_SV20', itemCode: 'LAB_AST_SGOT' },
  { bundleCode: 'PANEL_SV20', itemCode: 'LAB_ALT_SGPT' },
  { bundleCode: 'PANEL_SV20', itemCode: 'LAB_ALP' },
  { bundleCode: 'PANEL_SV20', itemCode: 'LAB_BILIRUBIN_TBDBIB' },
  { bundleCode: 'PANEL_SV20', itemCode: 'LAB_TOTAL_PROTEIN' },
  { bundleCode: 'PANEL_SV20', itemCode: 'LAB_ALBUMIN' },
  { bundleCode: 'PANEL_SV20', itemCode: 'LAB_TPA_G' },
  { bundleCode: 'PANEL_SV20', itemCode: 'LAB_LIPID_PROFILE' },
  { bundleCode: 'PANEL_SV20', itemCode: 'LAB_SODIUM' },
  { bundleCode: 'PANEL_SV20', itemCode: 'LAB_POTASSIUM' },
  { bundleCode: 'PANEL_SV20', itemCode: 'LAB_CHLORIDE' },
  { bundleCode: 'PANEL_SV20', itemCode: 'LAB_CALCIUM' },
  { bundleCode: 'PANEL_SV21', itemCode: 'LAB_HIV_AGAB' },
  { bundleCode: 'PANEL_SV21', itemCode: 'LAB_SYPHILIS_AB' },
  { bundleCode: 'PANEL_SV21', itemCode: 'LAB_HEP_B_SAG' },
  { bundleCode: 'PANEL_SV21', itemCode: 'LAB_HEP_B_SAB' },
  { bundleCode: 'PANEL_SV21', itemCode: 'LAB_HEP_C_AB' },
  { bundleCode: 'PANEL_SV21', itemCode: 'LAB_HSV1_IGG' },
  { bundleCode: 'PANEL_SV21', itemCode: 'LAB_HSV2_IGG' },
  { bundleCode: 'PANEL_SV21', itemCode: 'LAB_CT_NG_URINE' },
  { bundleCode: 'PANEL_SV23', itemCode: 'LAB_CBC_14' },
  { bundleCode: 'PANEL_SV23', itemCode: 'LAB_URINALYSIS_10' },
  { bundleCode: 'PANEL_SV23', itemCode: 'LAB_GLUCOSE_FBS' },
  { bundleCode: 'PANEL_SV23', itemCode: 'LAB_LIPID_PROFILE' },
  { bundleCode: 'PANEL_TFT1', itemCode: 'LAB_TSH' },
  { bundleCode: 'PANEL_TFT1', itemCode: 'LAB_FT3' },
  { bundleCode: 'PANEL_TFT1', itemCode: 'LAB_FT4' },
  { bundleCode: 'PANEL_CA125', itemCode: 'LAB_CA125' },
]

async function seedBundleItems(opts: {
  tenantId: string
  createdById: number
  servicesByCode: Map<string, string>
}): Promise<void> {
  let wired = 0
  for (let i = 0; i < BUNDLE_ITEMS.length; i++) {
    const bi = BUNDLE_ITEMS[i]!
    const bundleId = opts.servicesByCode.get(bi.bundleCode)
    const itemId = opts.servicesByCode.get(bi.itemCode)
    if (!bundleId || !itemId) continue
    await db
      .insert(s.serviceBundleItems)
      .values({
        tenantId: opts.tenantId,
        bundleServiceId: bundleId,
        itemServiceId: itemId,
        quantity: 1,
        displayOrder: i,
        createdById: opts.createdById,
      })
      .onConflictDoNothing()
    wired++
  }
  console.log(`  ✓ service bundle items (${wired})`)
}

// ───────────────────────────────────────────────────────────────────────────
// Section 5 — partner-rate service_prices (per-payer overrides)
// ───────────────────────────────────────────────────────────────────────────

// Replaces the old _HH / _FC / _MEDASIA / _PB catalog variants — same abstract
// service, different unitPrice per payer. payerDisplayId resolves through the
// `payers` map passed in from seedPayers().
type PartnerPrice = {
  serviceId: string
  payerDisplayId: string
  unitPrice: string
}

const PARTNER_PRICING: PartnerPrice[] = [
  // ── Derived from the clinic's `Vaccine` sheet, one row per (service, payer) ──
  //
  // 65 rows, replacing the 271-row brand x payer fan-out the sheet uses. Safe to
  // collapse because no two brands anywhere in the export disagree on a payer
  // price (see the payer-profile note at the top of this file). Regenerate by
  // re-reading `Vaccine`, splitting `v_Route` into route-vs-payer, and keying on
  // (v_Type + dose variant) -> service code.
  //
  // Read the tiers as a ladder: HMO is the card rate (highest), HPPI sits just
  // under it on the anti-rabies line only, mWell is a small platform uplift on
  // the base rate, HatiHealth and MedAsia are negotiated corporate rates.
  { serviceId: SVC_ARVPEP_IM, payerDisplayId: PAYER_HMO_DISPLAY_ID, unitPrice: '2200.00' },
  { serviceId: SVC_ARVPEP_IM, payerDisplayId: PAYER_HPPI_DISPLAY_ID, unitPrice: '2000.00' },
  { serviceId: SVC_ARVPEP_ID, payerDisplayId: PAYER_HMO_DISPLAY_ID, unitPrice: '1150.00' },
  { serviceId: SVC_ARVPEP_ID, payerDisplayId: PAYER_HPPI_DISPLAY_ID, unitPrice: '1050.00' },
  { serviceId: SVC_ERIG_INF, payerDisplayId: PAYER_HMO_DISPLAY_ID, unitPrice: '3300.00' },
  { serviceId: SVC_ERIG_INF, payerDisplayId: PAYER_HPPI_DISPLAY_ID, unitPrice: '3000.00' },
  { serviceId: SVC_ERIG_INF, payerDisplayId: PAYER_MWELL_DISPLAY_ID, unitPrice: '2220.00' },
  { serviceId: SVC_HRIG_INF, payerDisplayId: PAYER_HMO_DISPLAY_ID, unitPrice: '15000.00' },
  { serviceId: SVC_HRIG_INF, payerDisplayId: PAYER_HPPI_DISPLAY_ID, unitPrice: '14000.00' },
  { serviceId: SVC_HRIG_INF, payerDisplayId: PAYER_MWELL_DISPLAY_ID, unitPrice: '11110.00' },
  { serviceId: SVC_HTIG, payerDisplayId: PAYER_HMO_DISPLAY_ID, unitPrice: '2700.00' },
  { serviceId: SVC_HTIG, payerDisplayId: PAYER_HPPI_DISPLAY_ID, unitPrice: '2600.00' },
  { serviceId: SVC_ATS, payerDisplayId: PAYER_HMO_DISPLAY_ID, unitPrice: '700.00' },
  { serviceId: SVC_ATS, payerDisplayId: PAYER_HPPI_DISPLAY_ID, unitPrice: '600.00' },
  { serviceId: SVC_ATS, payerDisplayId: PAYER_MWELL_DISPLAY_ID, unitPrice: '445.00' },
  { serviceId: SVC_TT, payerDisplayId: PAYER_HMO_DISPLAY_ID, unitPrice: '550.00' },
  { serviceId: SVC_TT, payerDisplayId: PAYER_HPPI_DISPLAY_ID, unitPrice: '480.00' },
  { serviceId: SVC_TT, payerDisplayId: PAYER_MWELL_DISPLAY_ID, unitPrice: '335.00' },
  { serviceId: SVC_FLU_QUAD, payerDisplayId: PAYER_HMO_DISPLAY_ID, unitPrice: '1600.00' },
  { serviceId: SVC_FLU_QUAD, payerDisplayId: PAYER_MWELL_DISPLAY_ID, unitPrice: '1335.00' },
  { serviceId: SVC_FLU_QUAD, payerDisplayId: PAYER_HATI_HEALTH_DISPLAY_ID, unitPrice: '1350.00' },
  { serviceId: SVC_HEPA, payerDisplayId: PAYER_MWELL_DISPLAY_ID, unitPrice: '2780.00' },
  { serviceId: SVC_HEPB_05, payerDisplayId: PAYER_MWELL_DISPLAY_ID, unitPrice: '1100.00' },
  { serviceId: SVC_HEPB_10, payerDisplayId: PAYER_MWELL_DISPLAY_ID, unitPrice: '2220.00' },
  { serviceId: SVC_HEPB_10, payerDisplayId: PAYER_HATI_HEALTH_DISPLAY_ID, unitPrice: '2300.00' },
  { serviceId: SVC_MMR, payerDisplayId: PAYER_HMO_DISPLAY_ID, unitPrice: '1600.00' },
  { serviceId: SVC_MMR, payerDisplayId: PAYER_MWELL_DISPLAY_ID, unitPrice: '1335.00' },
  { serviceId: SVC_MMR, payerDisplayId: PAYER_HATI_HEALTH_DISPLAY_ID, unitPrice: '1350.00' },
  { serviceId: SVC_MMR, payerDisplayId: PAYER_MEDASIA_DISPLAY_ID, unitPrice: '3400.00' },
  { serviceId: SVC_VARICELLA_SC, payerDisplayId: PAYER_HMO_DISPLAY_ID, unitPrice: '4500.00' },
  { serviceId: SVC_VARICELLA_SC, payerDisplayId: PAYER_MWELL_DISPLAY_ID, unitPrice: '3890.00' },
  {
    serviceId: SVC_VARICELLA_SC,
    payerDisplayId: PAYER_HATI_HEALTH_DISPLAY_ID,
    unitPrice: '3800.00',
  },
  { serviceId: SVC_VARICELLA_SC, payerDisplayId: PAYER_MEDASIA_DISPLAY_ID, unitPrice: '3500.00' },
  { serviceId: SVC_VARICELLA_IM, payerDisplayId: PAYER_HMO_DISPLAY_ID, unitPrice: '4500.00' },
  { serviceId: SVC_VARICELLA_IM, payerDisplayId: PAYER_MWELL_DISPLAY_ID, unitPrice: '3890.00' },
  {
    serviceId: SVC_VARICELLA_IM,
    payerDisplayId: PAYER_HATI_HEALTH_DISPLAY_ID,
    unitPrice: '3800.00',
  },
  { serviceId: SVC_VARICELLA_IM, payerDisplayId: PAYER_MEDASIA_DISPLAY_ID, unitPrice: '3500.00' },
  { serviceId: SVC_TDAP, payerDisplayId: PAYER_HMO_DISPLAY_ID, unitPrice: '3100.00' },
  { serviceId: SVC_TDAP, payerDisplayId: PAYER_MWELL_DISPLAY_ID, unitPrice: '2780.00' },
  { serviceId: SVC_TDAP, payerDisplayId: PAYER_HATI_HEALTH_DISPLAY_ID, unitPrice: '2750.00' },
  { serviceId: SVC_TDAP, payerDisplayId: PAYER_MEDASIA_DISPLAY_ID, unitPrice: '3500.00' },
  { serviceId: SVC_HPV4, payerDisplayId: PAYER_HMO_DISPLAY_ID, unitPrice: '4800.00' },
  { serviceId: SVC_HPV4, payerDisplayId: PAYER_HATI_HEALTH_DISPLAY_ID, unitPrice: '4200.00' },
  { serviceId: SVC_HPV4, payerDisplayId: PAYER_MEDASIA_DISPLAY_ID, unitPrice: '6000.00' },
  { serviceId: SVC_HPV9, payerDisplayId: PAYER_HMO_DISPLAY_ID, unitPrice: '10500.00' },
  { serviceId: SVC_HPV9, payerDisplayId: PAYER_MWELL_DISPLAY_ID, unitPrice: '8890.00' },
  { serviceId: SVC_HPV9, payerDisplayId: PAYER_HATI_HEALTH_DISPLAY_ID, unitPrice: '9000.00' },
  { serviceId: SVC_HPV9, payerDisplayId: PAYER_MEDASIA_DISPLAY_ID, unitPrice: '10000.00' },
  { serviceId: SVC_SHINGLES, payerDisplayId: PAYER_HMO_DISPLAY_ID, unitPrice: '13000.00' },
  { serviceId: SVC_SHINGLES, payerDisplayId: PAYER_MWELL_DISPLAY_ID, unitPrice: '11110.00' },
  { serviceId: SVC_SHINGLES, payerDisplayId: PAYER_HATI_HEALTH_DISPLAY_ID, unitPrice: '11000.00' },
  { serviceId: SVC_SHINGLES, payerDisplayId: PAYER_MEDASIA_DISPLAY_ID, unitPrice: '12000.00' },
  { serviceId: SVC_P13, payerDisplayId: PAYER_HMO_DISPLAY_ID, unitPrice: '5200.00' },
  { serviceId: SVC_P13, payerDisplayId: PAYER_MWELL_DISPLAY_ID, unitPrice: '4445.00' },
  { serviceId: SVC_P13, payerDisplayId: PAYER_HATI_HEALTH_DISPLAY_ID, unitPrice: '4400.00' },
  { serviceId: SVC_P13, payerDisplayId: PAYER_MEDASIA_DISPLAY_ID, unitPrice: '5500.00' },
  { serviceId: SVC_P20, payerDisplayId: PAYER_HATI_HEALTH_DISPLAY_ID, unitPrice: '4950.00' },
  { serviceId: SVC_P23, payerDisplayId: PAYER_HMO_DISPLAY_ID, unitPrice: '3900.00' },
  { serviceId: SVC_P23, payerDisplayId: PAYER_MWELL_DISPLAY_ID, unitPrice: '3335.00' },
  { serviceId: SVC_P23, payerDisplayId: PAYER_HATI_HEALTH_DISPLAY_ID, unitPrice: '3300.00' },
  { serviceId: SVC_P23, payerDisplayId: PAYER_MEDASIA_DISPLAY_ID, unitPrice: '3846.00' },
  { serviceId: SVC_CHOLERA, payerDisplayId: PAYER_HMO_DISPLAY_ID, unitPrice: '1800.00' },
  { serviceId: SVC_CHOLERA, payerDisplayId: PAYER_MWELL_DISPLAY_ID, unitPrice: '1445.00' },
  { serviceId: SVC_CHOLERA, payerDisplayId: PAYER_HATI_HEALTH_DISPLAY_ID, unitPrice: '1450.00' },
  { serviceId: SVC_TYPHOID, payerDisplayId: PAYER_MWELL_DISPLAY_ID, unitPrice: '2220.00' },

  // ── Rates with no Vaccine-sheet row: consultation, priced per payer ────────
  // Philbritish discount, Forticare uplift. Forticare has no vaccine rows of its
  // own in the export: its former vaccine rows here were the sheet's `HMO` tier
  // mislabelled, and now live under the real HMO profile above.
  {
    serviceId: SVC_CONSULTATION,
    payerDisplayId: PAYER_PHILBRITISH_DISPLAY_ID,
    unitPrice: '400.00',
  },
  { serviceId: SVC_CONSULTATION, payerDisplayId: PAYER_FORTICARE_DISPLAY_ID, unitPrice: '600.00' },
]

async function seedPartnerPricing(opts: {
  tenantId: string
  createdById: number
  payers?: Map<string, number>
}): Promise<void> {
  if (!opts.payers || opts.payers.size === 0) {
    console.log('  ↷ partner service_prices skipped (no payers map)')
    return
  }
  let wired = 0
  for (const p of PARTNER_PRICING) {
    const payerId = opts.payers.get(p.payerDisplayId)
    if (!payerId) continue
    await db
      .insert(s.servicePrices)
      .values({
        displayId: displayId('SVP'),
        tenantId: opts.tenantId,
        serviceId: p.serviceId,
        branchId: null,
        payerId,
        patientSegment: null,
        unitPrice: p.unitPrice,
        currency: 'PHP',
        effectiveFrom: '-infinity',
        effectiveTo: null,
        createdById: opts.createdById,
      })
      .onConflictDoNothing()
    wired++
  }
  console.log(`  ✓ partner service_prices (${wired})`)
}

// ───────────────────────────────────────────────────────────────────────────
// Section 6b — brand-specific pricing (service_prices.product_id)
// ───────────────────────────────────────────────────────────────────────────

/**
 * A brand that costs more than the abstract service's base rate.
 *
 * The nurse picks the brand at administer time, so a pricier brand is a real
 * (if uncommon) money event: the clinic's anti-rabies base rate assumes the
 * house brand, and Speeda costs more per vial. Payer rows still outrank these
 * — see the precedence ladder in shared/lib/pricing.ts.
 *
 * Seeded so the picker's "over billed" warning and the BRAND_PRICE_VARIANCE
 * audit path are exercised by a fresh `pnpm run setup`, not only by tests.
 */
const BRAND_PRICING: Array<{ serviceId: string; manufacturer: string; unitPrice: string }> = [
  // Base ARV PEP IM/ID assume Abhayrab; Speeda carries an uplift.
  { serviceId: SVC_ARVPEP_IM, manufacturer: 'Speeda', unitPrice: '1800.00' },
  { serviceId: SVC_ARVPEP_ID, manufacturer: 'Speeda', unitPrice: '950.00' },
  // Flu: the two premium brands sit above the Vaxigrip-based base rate.
  { serviceId: SVC_FLU_QUAD, manufacturer: 'Fluarix Tetra', unitPrice: '1650.00' },
  { serviceId: SVC_FLU_QUAD, manufacturer: 'Influvac Tetra', unitPrice: '1550.00' },
]

async function seedBrandPricing(opts: {
  tenantId: string
  createdById: number
  productsByCode: Map<string, number>
}): Promise<void> {
  let wired = 0
  for (const b of BRAND_PRICING) {
    const productId = opts.productsByCode.get(b.manufacturer)
    if (!productId) continue
    await db.insert(s.servicePrices).values({
      displayId: displayId('SVP'),
      tenantId: opts.tenantId,
      serviceId: b.serviceId,
      branchId: null,
      payerId: null,
      productId,
      patientSegment: null,
      unitPrice: b.unitPrice,
      currency: 'PHP',
      effectiveFrom: '-infinity',
      effectiveTo: null,
      createdById: opts.createdById,
    })
    // Deliberately NO .onConflictDoNothing(): the `service_prices_no_overlap`
    // EXCLUDE constraint originally omitted product_id, so every brand row was
    // silently swallowed as a conflict and the seed still reported success.
    // Failing loudly is what surfaced that. The seed runs on a fresh DB — there
    // is no legitimate conflict to absorb here.
    wired++
  }
  console.log(`  ✓ brand service_prices (${wired})`)
}

// ───────────────────────────────────────────────────────────────────────────
// Section orchestrator
// ───────────────────────────────────────────────────────────────────────────

export async function seedCatalog(opts: {
  tenantId: string
  createdById: number
  payers?: Map<string, number>
}): Promise<SeededCatalog> {
  const productsByCode = await seedProducts(opts)
  const categoriesByCode = await seedCategories(opts)
  const servicesByCode = await seedServiceCatalog({ ...opts, categoriesByCode })
  await seedEligibleProducts({ tenantId: opts.tenantId, productsByCode })
  await seedBundleItems({ ...opts, servicesByCode })
  await seedPartnerPricing(opts)
  await seedBrandPricing({ ...opts, productsByCode })

  return {
    productsByCode,
    servicesByCode,
    categoriesByCode,
  }
}
