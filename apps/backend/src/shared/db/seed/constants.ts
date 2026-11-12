/**
 * Fixed display IDs / slugs / codes used across the seed script.
 *
 * Two-tier ID model (W2, 2026-05-19):
 *   - Internal PKs are `bigserial` — captured at runtime from `.returning()`
 *     chains and passed through function arguments. NOT exported here.
 *   - This module exports only the *public* text handles: tenant slug, branch
 *     codes, display IDs (`{PREFIX}_{8-char Crockford base32}`), and catalog
 *     codes (`ARVPEP_IM` style, used as PKs on service_catalog /
 *     standing_order_templates).
 *
 * See `docs/handovers/2026-05-18-id-redesign.md` for the full spec.
 */

// ── Tenant + Branch ─────────────────────────────────────────────────────────
// Tenant slug IS the PK (text). Default = `SVX` (renamed from `TEN-SUREVAX`).
export const TENANT_SLUG = 'SVX'
// Lowercase form for `mrn_seq_<slug>` sequence name (per
// `provision_tenant_counters('svx')`).
export const TENANT_SLUG_LC = TENANT_SLUG.toLowerCase()

// Branch codes — 3-letter uppercase, unique per tenant. Composite display ID
// is `${tenantSlug}.${code}` (e.g. `SVX.HST`).
//
// These are the clinic's OWN codes, taken from `Branch.b_TransactionInitials` in
// the AppSheet export: the same initials that already print on the clinic's
// paperwork, so they must not be invented here. (`TMG` was seeded as `TIM` until
// the export was cross-checked; the sheet says Timog is `TMG`.)
export const BRANCH_CODE_HST = 'HST' // Holy Spirit branch (default)
export const BRANCH_CODE_TMG = 'TMG' // Timog Avenue
export const BRANCH_CODE_ABF = 'ABF' // Aguirre / Baclaran
export const BRANCH_CODE_TAG = 'TAG' // Taguig
export const BRANCH_CODE_SAL = 'SAL' // Salcedo
export const BRANCH_CODE_MYS = 'MYS' // Maysilo
export const BRANCH_CODE_CNT = 'CNT' // Cainta
export const BRANCH_CODE_SJN = 'SJN' // San Juan
export const BRANCH_CODE_NOV = 'NOV' // Novaliches
export const BRANCH_CODE_MRK = 'MRK' // Marikina
export const BRANCH_CODE_PSG = 'PSG' // Pasig
export const BRANCH_CODE_STM = 'STM' // Sta Mesa
export const BRANCH_CODE_ALB = 'ALB' // Alabang
// Not a physical site: the clinic's teleconsult / home-service book of business.
// `b_AllowAccess` is the only TRUE in the sheet, and 13 nurses are assigned to it.
export const BRANCH_CODE_VRT = 'VRT' // Virtual Branch

// ── Users (display IDs only — bigint PKs flow through .returning() chain) ───
// Format: `USR_<8-char Crockford base32>`. Deterministic in seed so reruns are
// stable and tests can match against a known value.
export const ADMIN_DISPLAY_ID = 'USR_AAAAAAA1'
export const PHYSICIAN_DISPLAY_ID = 'USR_AAAAAAA2'
export const NURSE_DISPLAY_ID = 'USR_AAAAAAA3'
export const NURSE2_DISPLAY_ID = 'USR_AAAAAAA4'
export const CASHIER_DISPLAY_ID = 'USR_AAAAAAA5'
export const NURSE3_DISPLAY_ID = 'USR_AAAAAAA6'
export const BRANCH_USER_DISPLAY_ID = 'USR_AAAAAAA7'

// ── Platform user ───────────────────────────────────────────────────────────
export const PLATFORM_ADMIN_DISPLAY_ID = 'PLU_AAAAAAA1'

// ── Patient display IDs (deterministic for seed) ────────────────────────────
// Format: `PAT_<8-char Crockford base32>`. Per-patient MRNs are allocated from
// `mrn_seq_<slug>` at insert time (NOT exported here — sequence-allocated).
export const PAT_DELACRUZ_DISPLAY_ID = 'PAT_AAAAAAA1'
export const PAT_TORRES_DISPLAY_ID = 'PAT_AAAAAAA2'
export const PAT_LIM_DISPLAY_ID = 'PAT_AAAAAAA3'
export const PAT_VILLANUEVA_DISPLAY_ID = 'PAT_AAAAAAA4'
export const PAT_CRUZ_DISPLAY_ID = 'PAT_AAAAAAA5'
export const PAT_SANTOS_DISPLAY_ID = 'PAT_AAAAAAA6'
export const PAT_REYES_DISPLAY_ID = 'PAT_AAAAAAA7'
export const PAT_GARCIA_DISPLAY_ID = 'PAT_AAAAAAA8'
export const PAT_MENDOZA_DISPLAY_ID = 'PAT_AAAAAAA9'
export const PAT_AGUILAR_DISPLAY_ID = 'PAT_AAAAAAB0'
export const PAT_BAUTISTA_DISPLAY_ID = 'PAT_AAAAAAB1'
export const PAT_FERNANDEZ_DISPLAY_ID = 'PAT_AAAAAAB2'
export const PAT_GONZALES_DISPLAY_ID = 'PAT_AAAAAAB3'
export const PAT_HERRERA_DISPLAY_ID = 'PAT_AAAAAAB4'
export const PAT_ILAGAN_DISPLAY_ID = 'PAT_AAAAAAB5'
export const PAT_JAVIER_DISPLAY_ID = 'PAT_AAAAAAB6'
export const PAT_KATIPUNAN_DISPLAY_ID = 'PAT_AAAAAAB7'
export const PAT_LUNA_DISPLAY_ID = 'PAT_AAAAAAB8'
export const PAT_NAVARRO_DISPLAY_ID = 'PAT_AAAAAAB9'
export const PAT_OCAMPO_DISPLAY_ID = 'PAT_AAAAAAC0'
// Homed at the SECOND branch (TMG); every other seeded patient is homed at
// HST. Fixture for the Cross-Branch PHI RFC masking checks (R3): a Branch
// session at HST viewing this patient must see identity + safety fields only.
export const PAT_RIVERA_DISPLAY_ID = 'PAT_AAAAAAC1'

// One patient per non-HST branch (nurse-testing-readiness R6/R9 gap: every
// branch besides HST had zero patients, zero due-today doses, and zero
// stock, so a nurse logging into any other branch's kiosk saw an empty
// worklist). See `seed/branch-workflows.ts`.
export const PAT_RAMOS_DISPLAY_ID = 'PAT_AAAAAAC2' // TMG
export const PAT_DOMINGO_DISPLAY_ID = 'PAT_AAAAAAC3' // ABF
export const PAT_CASTILLO_DISPLAY_ID = 'PAT_AAAAAAC4' // TAG
export const PAT_SALAZAR_DISPLAY_ID = 'PAT_AAAAAAC5' // SAL
export const PAT_MANALO_DISPLAY_ID = 'PAT_AAAAAAC6' // MYS
export const PAT_PASCUAL_DISPLAY_ID = 'PAT_AAAAAAC7' // CNT
export const PAT_AQUINO_DISPLAY_ID = 'PAT_AAAAAAC8' // SJN
export const PAT_FLORES_DISPLAY_ID = 'PAT_AAAAAAC9' // NOV
export const PAT_MARQUEZ_DISPLAY_ID = 'PAT_AAAAAACA' // MRK
export const PAT_VALDEZ_DISPLAY_ID = 'PAT_AAAAAACB' // PSG
export const PAT_TOLENTINO_DISPLAY_ID = 'PAT_AAAAAACC' // STM
export const PAT_RAMIREZ_DISPLAY_ID = 'PAT_AAAAAACD' // ALB
export const PAT_ESPINO_DISPLAY_ID = 'PAT_AAAAAACE' // VRT

// ── Service catalog codes (PKs — stay text, no display_id) ──────────────────
// service_catalog.id IS the code itself. Same for standing_order_templates.id.
// Operational service entries (not vaccines)
export const SVC_FNAT = 'SVC_FNAT'
export const SVC_WOUND = 'SVC_WOUND'

// Abstract vaccine services (one per clinical entity).
// Each draws from one or more products via service_eligible_products at administer-time.
export const SVC_ARVPEP_IM = 'ARVPEP_IM'
export const SVC_ARVPEP_ID = 'ARVPEP_ID'
export const SVC_ARVPREP_IM = 'ARVPREP_IM'
export const SVC_ARVPREP_ID = 'ARVPREP_ID'
export const SVC_ARVBOOSTER_IM = 'ARVBOOSTER_IM'
export const SVC_ARVBOOSTER_ID = 'ARVBOOSTER_ID'
export const SVC_TT = 'SVC_TT'
export const SVC_ATS = 'SVC_ATS'
export const SVC_ERIG_INF = 'SVC_ERIG_INF'
export const SVC_HRIG_INF = 'SVC_HRIG_INF'
export const SVC_HTIG = 'SVC_HTIG'
export const SVC_FLU_QUAD = 'SVC_FLU_QUAD'

// Other vaccines (SOP appendix). Brand picked at administer-time.
export const SVC_CHOLERA = 'SVC_CHOLERA'
export const SVC_TYPHOID = 'SVC_TYPHOID'
export const SVC_HEPA = 'SVC_HEPA'
export const SVC_HEPB_05 = 'SVC_HEPB_05' // pediatric 0.5 mL dose
export const SVC_HEPB_10 = 'SVC_HEPB_10' // adult 1.0 mL dose
export const SVC_HPV4 = 'SVC_HPV4'
export const SVC_HPV9 = 'SVC_HPV9'
export const SVC_MMR = 'SVC_MMR'
export const SVC_TDAP = 'SVC_TDAP'
export const SVC_SHINGLES = 'SVC_SHINGLES'
export const SVC_VARICELLA_SC = 'SVC_VARICELLA_SC'
export const SVC_VARICELLA_IM = 'SVC_VARICELLA_IM'
export const SVC_P13 = 'SVC_P13'
export const SVC_P20 = 'SVC_P20'
export const SVC_P23 = 'SVC_P23'

export const SVC_CONSULTATION = 'SVC_CONSULTATION'
export const SVC_TELECONSULT = 'SVC_TELECONSULT'
export const SVC_MEDCERT = 'SVC_MEDCERT'
export const SVC_OTHER = 'SVC_OTHER'

// ── Standing Order Templates (PKs — stay text) ──────────────────────────────
export const SOT_RABIES_PEP_IM = 'SOT_RABIES_PEP_IM'
export const SOT_RABIES_PEP_ID = 'SOT_RABIES_PEP_ID'
export const SOT_RABIES_PREP_IM = 'SOT_RABIES_PREP_IM'
export const SOT_RABIES_PREP_ID = 'SOT_RABIES_PREP_ID'
export const SOT_RABIES_BOOSTER_IM = 'SOT_RABIES_BOOSTER_IM'
export const SOT_RABIES_BOOSTER_ID = 'SOT_RABIES_BOOSTER_ID'
// Composite Cat III bundles — one arrival fans out ARV-PEP (ID 4-visit) + RIG +
// tetanus into a single encounter. `code` carries ERIG/HRIG so the CLIN-4
// Cat-III RIG guard recognises the bundle includes RIG.
export const SOT_RABIES_CAT3_ID_ERIG = 'SOT_RABIES_CAT3_ID_ERIG'
export const SOT_RABIES_CAT3_ID_HRIG = 'SOT_RABIES_CAT3_ID_HRIG'
export const SOT_TT_PRIMARY = 'SOT_TT_PRIMARY'
export const SOT_TT_BOOSTER = 'SOT_TT_BOOSTER'
export const SOT_ATS = 'SOT_ATS'
export const SOT_ERIG = 'SOT_ERIG'
export const SOT_HRIG = 'SOT_HRIG'
export const SOT_FLU = 'SOT_FLU_ANNUAL'
export const SOT_CHOLERA = 'SOT_CHOLERA'
export const SOT_HEPA = 'SOT_HEPA'
export const SOT_HEPB_STANDARD = 'SOT_HEPB_STANDARD'
export const SOT_HEPB_ACCELERATED = 'SOT_HEPB_ACCELERATED'
export const SOT_HPV = 'SOT_HPV'
export const SOT_MMR = 'SOT_MMR'
export const SOT_MMR_HIGH_RISK = 'SOT_MMR_HIGH_RISK'
export const SOT_TDAP_PRIMARY = 'SOT_TDAP_PRIMARY'
export const SOT_TDAP_BOOSTER = 'SOT_TDAP_BOOSTER'
export const SOT_SHINGLES = 'SOT_SHINGLES'
export const SOT_VARICELLA = 'SOT_VARICELLA'

// ── Payer profiles (display IDs only) ───────────────────────────────────────
export const PAYER_MAXICARE_DISPLAY_ID = 'PYR_AAAAAAA1'
export const PAYER_INTELLICARE_DISPLAY_ID = 'PYR_AAAAAAA2'
export const PAYER_GLOBE_DISPLAY_ID = 'PYR_AAAAAAA3'
export const PAYER_PHILHEALTH_DISPLAY_ID = 'PYR_AAAAAAA4'
export const PAYER_HATI_HEALTH_DISPLAY_ID = 'PYR_AAAAAAA5'
export const PAYER_FORTICARE_DISPLAY_ID = 'PYR_AAAAAAA6'
export const PAYER_MEDASIA_DISPLAY_ID = 'PYR_AAAAAAA7'
export const PAYER_PHILBRITISH_DISPLAY_ID = 'PYR_AAAAAAA8'
// The three highest-volume payer tiers in the clinic's own `Vaccine` sheet,
// which were missing here (and from the AppSheet migration's payer mapping)
// until the export was cross-checked: `mWell` appears on 24 catalog rows, `HMO`
// on 19, `HPPI` on 5. See the payer-profile note at the top of `catalog.ts`.
export const PAYER_HMO_DISPLAY_ID = 'PYR_AAAAAAA9'
export const PAYER_HPPI_DISPLAY_ID = 'PYR_AAAAAAAA'
export const PAYER_MWELL_DISPLAY_ID = 'PYR_AAAAAAAB'
export const PAYER_AYALA_MALLS_DISPLAY_ID = 'PYR_AAAAAAAC'
export const PAYER_AVEGA_DISPLAY_ID = 'PYR_AAAAAAAD'

// ── Partner labs (display IDs only) ─────────────────────────────────────────
export const LAB_HIPRECISION_DISPLAY_ID = 'LAB_AAAAAAA1'
export const LAB_STLUKES_DISPLAY_ID = 'LAB_AAAAAAA2'
export const LAB_RITM_DISPLAY_ID = 'LAB_AAAAAAA3'
