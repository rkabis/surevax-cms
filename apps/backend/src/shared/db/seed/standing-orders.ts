/**
 * Seed section — standing order templates + items.
 *
 * Two-tier IDs (W3.a.4, 2026-05-19):
 *   - `standing_order_templates.id` = raw catalog code (text PK, e.g.
 *     `RABIES_PEP_IM`). No display_id surfacing on templates.
 *   - `standing_order_template_items.id` = bigserial; `display_id` is
 *     auto-generated `STI_<8 base32>`.
 *   - Catalog codes use underscores per `CATALOG_CODE_REGEX`
 *     (`/^[A-Z][A-Z0-9_]{1,30}[A-Z0-9]$/`) — dashes are rejected.
 *
 * Independent of patients — runs after catalog + users land in the seed
 * orchestrator.
 */

import * as s from '../schema.js'
import { db } from './db.js'
import { displayId } from '../../utils/displayId.js'
import {
  TENANT_SLUG,
  SVC_FLU_QUAD,
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
  SVC_CHOLERA,
  SVC_HEPA,
  SVC_HEPB_10,
  SVC_HPV9,
  SVC_MMR,
  SVC_TDAP,
  SVC_SHINGLES,
  SVC_VARICELLA_SC,
  SOT_RABIES_PEP_IM,
  SOT_RABIES_PEP_ID,
  SOT_RABIES_PREP_IM,
  SOT_RABIES_PREP_ID,
  SOT_RABIES_BOOSTER_IM,
  SOT_RABIES_BOOSTER_ID,
  SOT_RABIES_CAT3_ID_ERIG,
  SOT_RABIES_CAT3_ID_HRIG,
  SOT_TT_PRIMARY,
  SOT_TT_BOOSTER,
  SOT_ATS,
  SOT_ERIG,
  SOT_HRIG,
  SOT_FLU,
  SOT_CHOLERA,
  SOT_HEPA,
  SOT_HEPB_STANDARD,
  SOT_HEPB_ACCELERATED,
  SOT_HPV,
  SOT_MMR,
  SOT_MMR_HIGH_RISK,
  SOT_TDAP_PRIMARY,
  SOT_TDAP_BOOSTER,
  SOT_SHINGLES,
  SOT_VARICELLA,
} from './constants.js'

export async function seedStandingOrders(args: {
  tenantId: string
  createdById: number
}): Promise<void> {
  void args.tenantId // accepted for symmetry with sibling seeds; TENANT_SLUG is the live tenant slug.

  // ── Standing Order Templates ──────────────────────────────────────────────
  // PK = raw catalog code (text). `code` column duplicates the id for back-compat
  // with code-keyed lookups elsewhere. Catalog codes use underscores.
  const templates = [
    // ── Anti-Rabies Vaccine (ARV) ────────────────────────────────────────────
    {
      id: SOT_RABIES_PEP_IM,
      code: 'RABIES_PEP_IM',
      name: 'Rabies PEP — Intramuscular (5-dose)',
      description:
        'Post-Exposure Prophylaxis, IM regimen — days 0, 3, 7, 14, 28. Day 28 may be omitted if biting animal is alive/healthy after 14-day observation. Category II and III exposures (DOH/WHO).',
      requiresPhysicianAuth: true,
      specialty: 'Rabies',
    },
    {
      id: SOT_RABIES_PEP_ID,
      code: 'RABIES_PEP_ID',
      name: 'Rabies PEP — Intradermal (4-dose, 2 sites/day)',
      description:
        'Post-Exposure Prophylaxis, ID regimen — days 0, 3, 7, 28; 0.1 mL × 2 sites each visit. Day 28 may be omitted if biting animal is alive/healthy after 14-day observation. Category II and III exposures (DOH/WHO).',
      requiresPhysicianAuth: true,
      specialty: 'Rabies',
    },

    // ── Cat III composite bundles — ARV-PEP (ID) + RIG + Tetanus in one arrival ─
    {
      id: SOT_RABIES_CAT3_ID_ERIG,
      code: 'RABIES_CAT3_ID_ERIG',
      name: 'Rabies Cat III bundle — PEP-ID + ERIG + Tetanus',
      description:
        'WHO Category III one-visit bundle: Anti-Rabies PEP intradermal (days 0, 3, 7, 28 · 2 sites/visit) + Equine Rabies Immunoglobulin (ERIG, weight-based, Day 0) + Tetanus Toxoid (days 0, 28). Use for transdermal bites with no ERIG (horse-serum) allergy.',
      requiresPhysicianAuth: true,
      specialty: 'Rabies',
    },
    {
      id: SOT_RABIES_CAT3_ID_HRIG,
      code: 'RABIES_CAT3_ID_HRIG',
      name: 'Rabies Cat III bundle — PEP-ID + HRIG + Tetanus',
      description:
        'WHO Category III one-visit bundle: Anti-Rabies PEP intradermal (days 0, 3, 7, 28 · 2 sites/visit) + Human Rabies Immunoglobulin (HRIG, weight-based, Day 0) + Tetanus Toxoid (days 0, 28). Use when the patient has a known ERIG (horse-serum) allergy.',
      requiresPhysicianAuth: true,
      specialty: 'Rabies',
    },
    {
      id: SOT_RABIES_PREP_IM,
      code: 'RABIES_PREP_IM',
      name: 'Rabies PrEP — Intramuscular (3-dose)',
      description:
        'Pre-Exposure Prophylaxis, IM regimen — days 0, 7, 28; 1 site (0.5 mL). For high-risk individuals (HCWs, vets, animal handlers, lab workers).',
      requiresPhysicianAuth: true,
      specialty: 'Rabies',
    },
    {
      id: SOT_RABIES_PREP_ID,
      code: 'RABIES_PREP_ID',
      name: 'Rabies PrEP — Intradermal (3-dose, 2 sites/day)',
      description:
        'Pre-Exposure Prophylaxis, ID regimen — days 0, 7, 28; 0.1 mL × 2 sites each visit. For high-risk individuals (HCWs, vets, animal handlers, lab workers).',
      requiresPhysicianAuth: true,
      specialty: 'Rabies',
    },
    {
      id: SOT_RABIES_BOOSTER_IM,
      code: 'RABIES_BOOSTER_IM',
      name: 'Rabies Booster — Intramuscular (2-dose)',
      description:
        'Booster for previously-vaccinated animal-bite victims — days 0, 3; 1 site (0.5 mL). Indicated for high-risk re-exposure with prior PEP or complete PrEP.',
      requiresPhysicianAuth: true,
      specialty: 'Rabies',
    },
    {
      id: SOT_RABIES_BOOSTER_ID,
      code: 'RABIES_BOOSTER_ID',
      name: 'Rabies Booster — Intradermal (2-dose)',
      description:
        'Booster for previously-vaccinated animal-bite victims — days 0, 3; 1 site (0.1 mL). Indicated for high-risk re-exposure with prior PEP or complete PrEP.',
      requiresPhysicianAuth: true,
      specialty: 'Rabies',
    },

    // ── Tetanus ──────────────────────────────────────────────────────────────
    {
      id: SOT_TT_PRIMARY,
      code: 'TT_PRIMARY',
      name: 'Tetanus Primary Series (3-dose catch-up)',
      description:
        'Primary tetanus series for unvaccinated patients / patients with <3 prior doses — days 0, 28, 180 (0.5 mL IM each). Catch-up schedule per DOH Td/Tdap guidance.',
      requiresPhysicianAuth: false,
      specialty: 'Vaccination',
    },
    {
      id: SOT_TT_BOOSTER,
      code: 'TT_BOOSTER',
      name: 'Tetanus Booster (single dose)',
      description:
        'Single 0.5 mL IM dose for patients with 3+ prior tetanus doses and >10 years since last (clean wounds) or >5 years (all other wounds).',
      requiresPhysicianAuth: false,
      specialty: 'Vaccination',
    },

    // ── Passive immunization adjuncts (single-dose, weight/age-based) ────────
    {
      id: SOT_ATS,
      code: 'ATS',
      name: 'Anti-Tetanus Serum (ATS) — single dose',
      description:
        'Age-based ATS administered within 24 hours of injury. Dosing: 1–5 yo with incomplete/unknown DPT — 1,500 IU; 6–10 yo — 3,000 IU; 11–16 yo — 4,500 IU; >16 yo & adult — 6,000 IU.',
      requiresPhysicianAuth: true,
      specialty: 'Rabies',
    },
    {
      id: SOT_ERIG,
      code: 'ERIG',
      name: 'Equine Rabies Immunoglobulin (ERIG) — wound infiltration',
      description:
        'Single weight-based dose at 40 IU/kg. Infiltrate around the wound; needle directed away from cranial vault. Default RIG for most patients. Indicated for Category III exposures and immunocompromised Category II. Must be given on or before Day 7 of vaccine series.',
      requiresPhysicianAuth: true,
      specialty: 'Rabies',
    },
    {
      id: SOT_HRIG,
      code: 'HRIG',
      name: 'Human Rabies Immunoglobulin (HRIG) — wound infiltration',
      description:
        'Single weight-based dose at 20 IU/kg. Infiltrate around the wound. Use when patient has known allergy to ERIG (horse serum). Same indications as ERIG.',
      requiresPhysicianAuth: true,
      specialty: 'Rabies',
    },

    // ── Other vaccines (SOP appendix, pages 14-16) ───────────────────────────
    {
      id: SOT_FLU,
      code: 'FLU_ANNUAL',
      name: 'Annual Flu Vaccination',
      description: 'Single-dose annual influenza vaccine (IM, deltoid).',
      requiresPhysicianAuth: false,
      specialty: 'Flu',
    },
    {
      id: SOT_CHOLERA,
      code: 'CHOLERA',
      name: 'Cholera Vaccine (2-dose)',
      description:
        '2 oral doses, 2 weeks apart (Days 0, 14). For high-risk individuals — travellers to outbreak areas. If 2nd dose delayed >6 weeks, restart series.',
      requiresPhysicianAuth: false,
      specialty: 'Vaccination',
    },
    {
      id: SOT_HEPA,
      code: 'HEPA',
      name: 'Hepatitis A Vaccine (single dose)',
      description:
        'Single 1 mL IM dose for immunocompetent adults. Optional booster 6–12 months later for sustained immunity. Indicated for chronic liver disease patients and high-risk travellers.',
      requiresPhysicianAuth: false,
      specialty: 'Vaccination',
    },
    {
      id: SOT_HEPB_STANDARD,
      code: 'HEPB_STANDARD',
      name: 'Hepatitis B Vaccine — Standard (3-dose)',
      description:
        'Standard schedule: 3 doses at Days 0, 30, 180 (months 0, 1, 6). For routine adult Hep B prevention.',
      requiresPhysicianAuth: false,
      specialty: 'Vaccination',
    },
    {
      id: SOT_HEPB_ACCELERATED,
      code: 'HEPB_ACCELERATED',
      name: 'Hepatitis B Vaccine — Accelerated (3-dose + booster)',
      description:
        'Accelerated schedule for rapid seroconversion (high-risk / immediate-protection): Days 0, 14, 42 (weeks 0, 2, 6) plus booster at Day 365.',
      requiresPhysicianAuth: true,
      specialty: 'Vaccination',
    },
    {
      id: SOT_HPV,
      code: 'HPV',
      name: 'HPV Vaccine (3-dose)',
      description:
        '3 doses at Days 0, 60, 180 (0, 2, 6 months). Default: Gardasil 9 (covers HPV 6, 11, 16, 18, 31, 33, 45, 52, 58).',
      requiresPhysicianAuth: false,
      specialty: 'Vaccination',
    },
    {
      id: SOT_MMR,
      code: 'MMR',
      name: 'MMR Vaccine (single dose)',
      description:
        'Single 0.5 mL SC dose for immunocompetent adults. Avoid pregnancy for 28 days post-vaccination. Post-exposure prophylaxis within 72 hours.',
      requiresPhysicianAuth: false,
      specialty: 'Vaccination',
    },
    {
      id: SOT_MMR_HIGH_RISK,
      code: 'MMR_HIGH_RISK',
      name: 'MMR Vaccine — High Risk (2-dose)',
      description:
        '2 doses at least 28 days apart (Days 0, 28). For high-risk individuals — HCWs, international travellers, post-exposure prophylaxis with prior incomplete vaccination.',
      requiresPhysicianAuth: true,
      specialty: 'Vaccination',
    },
    {
      id: SOT_TDAP_PRIMARY,
      code: 'TDAP_PRIMARY',
      name: 'Tdap Primary Series (3-dose)',
      description:
        '0.5 mL IM at Days 0, 42, 270 (0 / 4–8 weeks / 6–12 months after 2nd dose). For adults with no prior Tdap or unknown vaccine status — Tdap as first dose, then Td to complete primary series.',
      requiresPhysicianAuth: false,
      specialty: 'Vaccination',
    },
    {
      id: SOT_TDAP_BOOSTER,
      code: 'TDAP_BOOSTER',
      name: 'Tdap Booster (single dose)',
      description:
        'Single 0.5 mL IM booster. For pregnant women at 27–36 weeks AOG (maximises antibody transfer), or 10-year routine booster for adults with complete primary series.',
      requiresPhysicianAuth: false,
      specialty: 'Vaccination',
    },
    {
      id: SOT_SHINGLES,
      code: 'SHINGLES',
      name: 'Shingles Vaccine — Shingrix (2-dose)',
      description:
        'Recombinant zoster vaccine (RZV/Shingrix), 2 doses 0.5 mL IM at Days 0, 60 (2 months apart). If 2nd dose given <4 weeks early, repeat. 2 doses required regardless of prior varicella vaccine or ZVL.',
      requiresPhysicianAuth: false,
      specialty: 'Vaccination',
    },
    {
      id: SOT_VARICELLA,
      code: 'VARICELLA',
      name: 'Varicella Vaccine (2-dose)',
      description:
        '2 doses 0.5 mL SC at Days 0, 28 (0, 1 month). For HCWs without history of varicella infection, and post-exposure prophylaxis within 72 hours of exposure.',
      requiresPhysicianAuth: false,
      specialty: 'Vaccination',
    },
  ]

  for (const t of templates) {
    await db
      .insert(s.standingOrderTemplates)
      .values({
        ...t,
        tenantId: TENANT_SLUG,
        createdById: args.createdById,
      })
      .onConflictDoNothing()
  }

  // Template items — sites/day modelled as multiple sequence rows on the same
  // day_offset. bigserial PK; display_id is fresh per row.
  const templateItems = [
    // Rabies PEP IM — 5 doses, 1 site/day
    { templateId: SOT_RABIES_PEP_IM, serviceId: SVC_ARVPEP_IM, dayOffset: 0, sequence: 1 },
    { templateId: SOT_RABIES_PEP_IM, serviceId: SVC_ARVPEP_IM, dayOffset: 3, sequence: 1 },
    { templateId: SOT_RABIES_PEP_IM, serviceId: SVC_ARVPEP_IM, dayOffset: 7, sequence: 1 },
    { templateId: SOT_RABIES_PEP_IM, serviceId: SVC_ARVPEP_IM, dayOffset: 14, sequence: 1 },
    { templateId: SOT_RABIES_PEP_IM, serviceId: SVC_ARVPEP_IM, dayOffset: 28, sequence: 1 },

    // Rabies PEP ID — 4 visits, 2 sites/visit = 8 items
    { templateId: SOT_RABIES_PEP_ID, serviceId: SVC_ARVPEP_ID, dayOffset: 0, sequence: 1 },
    { templateId: SOT_RABIES_PEP_ID, serviceId: SVC_ARVPEP_ID, dayOffset: 0, sequence: 2 },
    { templateId: SOT_RABIES_PEP_ID, serviceId: SVC_ARVPEP_ID, dayOffset: 3, sequence: 1 },
    { templateId: SOT_RABIES_PEP_ID, serviceId: SVC_ARVPEP_ID, dayOffset: 3, sequence: 2 },
    { templateId: SOT_RABIES_PEP_ID, serviceId: SVC_ARVPEP_ID, dayOffset: 7, sequence: 1 },
    { templateId: SOT_RABIES_PEP_ID, serviceId: SVC_ARVPEP_ID, dayOffset: 7, sequence: 2 },
    { templateId: SOT_RABIES_PEP_ID, serviceId: SVC_ARVPEP_ID, dayOffset: 28, sequence: 1 },
    { templateId: SOT_RABIES_PEP_ID, serviceId: SVC_ARVPEP_ID, dayOffset: 28, sequence: 2 },

    // Rabies PrEP IM — 3 visits, 1 site/visit
    { templateId: SOT_RABIES_PREP_IM, serviceId: SVC_ARVPREP_IM, dayOffset: 0, sequence: 1 },
    { templateId: SOT_RABIES_PREP_IM, serviceId: SVC_ARVPREP_IM, dayOffset: 7, sequence: 1 },
    { templateId: SOT_RABIES_PREP_IM, serviceId: SVC_ARVPREP_IM, dayOffset: 28, sequence: 1 },

    // Rabies PrEP ID — 3 visits, 2 sites/visit
    { templateId: SOT_RABIES_PREP_ID, serviceId: SVC_ARVPREP_ID, dayOffset: 0, sequence: 1 },
    { templateId: SOT_RABIES_PREP_ID, serviceId: SVC_ARVPREP_ID, dayOffset: 0, sequence: 2 },
    { templateId: SOT_RABIES_PREP_ID, serviceId: SVC_ARVPREP_ID, dayOffset: 7, sequence: 1 },
    { templateId: SOT_RABIES_PREP_ID, serviceId: SVC_ARVPREP_ID, dayOffset: 7, sequence: 2 },
    { templateId: SOT_RABIES_PREP_ID, serviceId: SVC_ARVPREP_ID, dayOffset: 28, sequence: 1 },
    { templateId: SOT_RABIES_PREP_ID, serviceId: SVC_ARVPREP_ID, dayOffset: 28, sequence: 2 },

    // Rabies Booster IM — 2 visits, 1 site/visit
    { templateId: SOT_RABIES_BOOSTER_IM, serviceId: SVC_ARVBOOSTER_IM, dayOffset: 0, sequence: 1 },
    { templateId: SOT_RABIES_BOOSTER_IM, serviceId: SVC_ARVBOOSTER_IM, dayOffset: 3, sequence: 1 },

    // Rabies Booster ID — 2 visits, 1 site/visit
    { templateId: SOT_RABIES_BOOSTER_ID, serviceId: SVC_ARVBOOSTER_ID, dayOffset: 0, sequence: 1 },
    { templateId: SOT_RABIES_BOOSTER_ID, serviceId: SVC_ARVBOOSTER_ID, dayOffset: 3, sequence: 1 },

    // Cat III bundle (ERIG): ARV-PEP-ID (d0/3/7/28 ×2 sites) + ERIG (d0) + TT (d0, d28)
    { templateId: SOT_RABIES_CAT3_ID_ERIG, serviceId: SVC_ARVPEP_ID, dayOffset: 0, sequence: 1 },
    { templateId: SOT_RABIES_CAT3_ID_ERIG, serviceId: SVC_ARVPEP_ID, dayOffset: 0, sequence: 2 },
    { templateId: SOT_RABIES_CAT3_ID_ERIG, serviceId: SVC_ERIG_INF, dayOffset: 0, sequence: 3 },
    { templateId: SOT_RABIES_CAT3_ID_ERIG, serviceId: SVC_TT, dayOffset: 0, sequence: 4 },
    { templateId: SOT_RABIES_CAT3_ID_ERIG, serviceId: SVC_ARVPEP_ID, dayOffset: 3, sequence: 1 },
    { templateId: SOT_RABIES_CAT3_ID_ERIG, serviceId: SVC_ARVPEP_ID, dayOffset: 3, sequence: 2 },
    { templateId: SOT_RABIES_CAT3_ID_ERIG, serviceId: SVC_ARVPEP_ID, dayOffset: 7, sequence: 1 },
    { templateId: SOT_RABIES_CAT3_ID_ERIG, serviceId: SVC_ARVPEP_ID, dayOffset: 7, sequence: 2 },
    { templateId: SOT_RABIES_CAT3_ID_ERIG, serviceId: SVC_ARVPEP_ID, dayOffset: 28, sequence: 1 },
    { templateId: SOT_RABIES_CAT3_ID_ERIG, serviceId: SVC_ARVPEP_ID, dayOffset: 28, sequence: 2 },
    { templateId: SOT_RABIES_CAT3_ID_ERIG, serviceId: SVC_TT, dayOffset: 28, sequence: 3 },

    // Cat III bundle (HRIG): same as ERIG variant, HRIG instead of ERIG (ERIG-allergic)
    { templateId: SOT_RABIES_CAT3_ID_HRIG, serviceId: SVC_ARVPEP_ID, dayOffset: 0, sequence: 1 },
    { templateId: SOT_RABIES_CAT3_ID_HRIG, serviceId: SVC_ARVPEP_ID, dayOffset: 0, sequence: 2 },
    { templateId: SOT_RABIES_CAT3_ID_HRIG, serviceId: SVC_HRIG_INF, dayOffset: 0, sequence: 3 },
    { templateId: SOT_RABIES_CAT3_ID_HRIG, serviceId: SVC_TT, dayOffset: 0, sequence: 4 },
    { templateId: SOT_RABIES_CAT3_ID_HRIG, serviceId: SVC_ARVPEP_ID, dayOffset: 3, sequence: 1 },
    { templateId: SOT_RABIES_CAT3_ID_HRIG, serviceId: SVC_ARVPEP_ID, dayOffset: 3, sequence: 2 },
    { templateId: SOT_RABIES_CAT3_ID_HRIG, serviceId: SVC_ARVPEP_ID, dayOffset: 7, sequence: 1 },
    { templateId: SOT_RABIES_CAT3_ID_HRIG, serviceId: SVC_ARVPEP_ID, dayOffset: 7, sequence: 2 },
    { templateId: SOT_RABIES_CAT3_ID_HRIG, serviceId: SVC_ARVPEP_ID, dayOffset: 28, sequence: 1 },
    { templateId: SOT_RABIES_CAT3_ID_HRIG, serviceId: SVC_ARVPEP_ID, dayOffset: 28, sequence: 2 },
    { templateId: SOT_RABIES_CAT3_ID_HRIG, serviceId: SVC_TT, dayOffset: 28, sequence: 3 },

    // Tetanus Primary — 3 doses
    { templateId: SOT_TT_PRIMARY, serviceId: SVC_TT, dayOffset: 0, sequence: 1 },
    { templateId: SOT_TT_PRIMARY, serviceId: SVC_TT, dayOffset: 28, sequence: 1 },
    { templateId: SOT_TT_PRIMARY, serviceId: SVC_TT, dayOffset: 180, sequence: 1 },

    // Tetanus Booster — single dose
    { templateId: SOT_TT_BOOSTER, serviceId: SVC_TT, dayOffset: 0, sequence: 1 },

    // ATS — single age-based dose
    { templateId: SOT_ATS, serviceId: SVC_ATS, dayOffset: 0, sequence: 1 },

    // ERIG — single weight-based wound infiltration
    { templateId: SOT_ERIG, serviceId: SVC_ERIG_INF, dayOffset: 0, sequence: 1 },

    // HRIG — single weight-based wound infiltration
    { templateId: SOT_HRIG, serviceId: SVC_HRIG_INF, dayOffset: 0, sequence: 1 },

    // Flu — single annual dose
    { templateId: SOT_FLU, serviceId: SVC_FLU_QUAD, dayOffset: 0, sequence: 1 },

    // ── Other vaccines (SOP appendix) ────────────────────────────────────────
    // Cholera — 2 oral doses, 2 weeks apart
    { templateId: SOT_CHOLERA, serviceId: SVC_CHOLERA, dayOffset: 0, sequence: 1 },
    { templateId: SOT_CHOLERA, serviceId: SVC_CHOLERA, dayOffset: 14, sequence: 1 },

    // Hep A — single dose
    { templateId: SOT_HEPA, serviceId: SVC_HEPA, dayOffset: 0, sequence: 1 },

    // Hep B Standard — 0, 1mo, 6mo
    { templateId: SOT_HEPB_STANDARD, serviceId: SVC_HEPB_10, dayOffset: 0, sequence: 1 },
    { templateId: SOT_HEPB_STANDARD, serviceId: SVC_HEPB_10, dayOffset: 30, sequence: 1 },
    { templateId: SOT_HEPB_STANDARD, serviceId: SVC_HEPB_10, dayOffset: 180, sequence: 1 },

    // Hep B Accelerated — 0, 2wk, 6wk + 1yr booster
    { templateId: SOT_HEPB_ACCELERATED, serviceId: SVC_HEPB_10, dayOffset: 0, sequence: 1 },
    { templateId: SOT_HEPB_ACCELERATED, serviceId: SVC_HEPB_10, dayOffset: 14, sequence: 1 },
    { templateId: SOT_HEPB_ACCELERATED, serviceId: SVC_HEPB_10, dayOffset: 42, sequence: 1 },
    { templateId: SOT_HEPB_ACCELERATED, serviceId: SVC_HEPB_10, dayOffset: 365, sequence: 1 },

    // HPV — 0, 2mo, 6mo
    { templateId: SOT_HPV, serviceId: SVC_HPV9, dayOffset: 0, sequence: 1 },
    { templateId: SOT_HPV, serviceId: SVC_HPV9, dayOffset: 60, sequence: 1 },
    { templateId: SOT_HPV, serviceId: SVC_HPV9, dayOffset: 180, sequence: 1 },

    // MMR — single dose
    { templateId: SOT_MMR, serviceId: SVC_MMR, dayOffset: 0, sequence: 1 },

    // MMR High Risk — 2 doses ≥28d apart
    { templateId: SOT_MMR_HIGH_RISK, serviceId: SVC_MMR, dayOffset: 0, sequence: 1 },
    { templateId: SOT_MMR_HIGH_RISK, serviceId: SVC_MMR, dayOffset: 28, sequence: 1 },

    // Tdap Primary — 0 / 4-8wk / 6-12mo after 2nd
    { templateId: SOT_TDAP_PRIMARY, serviceId: SVC_TDAP, dayOffset: 0, sequence: 1 },
    { templateId: SOT_TDAP_PRIMARY, serviceId: SVC_TDAP, dayOffset: 42, sequence: 1 },
    { templateId: SOT_TDAP_PRIMARY, serviceId: SVC_TDAP, dayOffset: 270, sequence: 1 },

    // Tdap Booster — single dose
    { templateId: SOT_TDAP_BOOSTER, serviceId: SVC_TDAP, dayOffset: 0, sequence: 1 },

    // Shingles (Shingrix) — 2 doses 2 months apart
    { templateId: SOT_SHINGLES, serviceId: SVC_SHINGLES, dayOffset: 0, sequence: 1 },
    { templateId: SOT_SHINGLES, serviceId: SVC_SHINGLES, dayOffset: 60, sequence: 1 },

    // Varicella — 2 doses 1 month apart
    { templateId: SOT_VARICELLA, serviceId: SVC_VARICELLA_SC, dayOffset: 0, sequence: 1 },
    { templateId: SOT_VARICELLA, serviceId: SVC_VARICELLA_SC, dayOffset: 28, sequence: 1 },
  ]

  for (const item of templateItems) {
    await db
      .insert(s.standingOrderTemplateItems)
      .values({
        displayId: displayId('STI'),
        tenantId: TENANT_SLUG,
        templateId: item.templateId,
        serviceId: item.serviceId,
        dayOffset: item.dayOffset,
        sequence: item.sequence,
      })
      .onConflictDoNothing()
  }

  console.log(
    `  ✓ standing order templates (${templates.length}) + items (${templateItems.length})`,
  )
}
