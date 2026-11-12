/**
 * Weight-based immunoglobulin / antiserum dose calculator (CLIN-1).
 *
 * Patient-safety guardrail for the four services flagged
 * `requires_dose_calculation = true` in the catalog: ERIG, HRIG, HTIG, ATS.
 * Clinicians previously hand-computed these doses with no max-dose ceiling and
 * no zero-weight guard. This module makes the dosing table DATA (so a clinician
 * can adjust per product without touching logic) and returns explicit warnings
 * rather than ever silently producing a dangerous dose.
 *
 * This file is pure (no DB, no Express) so it can be unit-tested without a
 * database. The route layer reads the product concentration from the catalog
 * and may override the table default before calling `calculateDose`.
 *
 * ── Dosing sources (verified 2026-05-28) ───────────────────────────────────
 * - ERIG (equine rabies Ig): 40 IU/kg, infiltrate into/around wound; remainder
 *   IM distant from the vaccine site. The calculated dose must NOT be exceeded —
 *   excess RIG may suppress the active vaccine response.
 *     WHO Rabies vaccines: position paper (2018) — https://www.who.int/teams/control-of-neglected-tropical-diseases/rabies/vaccinations-and-immunization
 *     Philippines DOH A.O. No. 164 s.2002 (Revised Guidelines on Management of
 *       Animal Bite Patients) — https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/10/42188
 *     DOH/PIDSP animal-bite update (Bermal 2019) — https://www.pidsphil.org/home/wp-content/uploads/2019/10/Bermal_PIDSP-2019.pdf
 * - HRIG (human rabies Ig): 20 IU/kg, single dose day 0, infiltration first.
 *     WHO position paper (2018), same source as above.
 *     MSF HRIG monograph — https://medicalguidelines.msf.org/en/viewport/EssDr/english/human-rabies-immunoglobulin-hrig-16688380.html
 * - HTIG (human tetanus Ig): FIXED 250 IU prophylaxis (500 IU for wounds >24 h
 *   old / heavily contaminated); IM, separate site from the tetanus vaccine.
 *     MSF HTIG monograph — https://medicalguidelines.msf.org/en/viewport/EssDr/english/human-tetanus-immunoglobulin-htig-16688425.html
 *     HyperTET 250 Units (DailyMed) — https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=393fa198-7e07-4162-bd0a-9d873f1544a9
 * - ATS (equine anti-tetanus serum): FIXED 1500 IU prophylaxis (range
 *   1000–1500 IU), IM/SC. Equine antitoxin — sensitivity testing per product
 *   label still required clinically.
 *     MSF Tetanus guideline — https://medicalguidelines.msf.org/en/viewport/CG/english/tetanus-16689919.html
 *
 * RIG max-dose caps: the WHO/DOH rule is "do not exceed the weight-calculated
 * dose"; there is no separate absolute IU ceiling in the guidelines. We model a
 * conservative sanity ceiling (`maxDoseIu`) per product to catch an
 * implausible weight entry rather than as a clinical max — it is flagged via
 * `cappedAtMax` + a warning so the clinician is alerted, never silently clipped
 * without notice.
 */

/** Administration route for the calculated dose. */
export type DoseRoute = 'INF' | 'IM' | 'SC'

/** A single product/service dosing rule. Exactly one of `iuPerKg` / `fixedIu`. */
export interface DoseRule {
  /** Weight-based dose in IU per kg (ERIG=40, HRIG=20). Mutually exclusive with `fixedIu`. */
  iuPerKg?: number
  /** Fixed dose in IU irrespective of weight (HTIG=250, ATS=1500). */
  fixedIu?: number
  /** Product concentration in IU per mL — used to convert total IU → volume mL. */
  productConcentrationIuPerMl: number
  /**
   * Conservative absolute IU ceiling used as a sanity guard. When the
   * weight-calculated dose exceeds this, the dose is capped and `cappedAtMax`
   * is set with a warning. Not a clinical maximum — see file header.
   */
  maxDoseIu?: number
  /** Primary route for the calculated dose. */
  route: DoseRoute
  /**
   * For wound-infiltration products (ERIG/HRIG), the fraction of the total dose
   * to infiltrate into/around the wound; the remainder is given IM distant from
   * the vaccine site. Default 1.0 ("infiltrate as much as anatomically
   * feasible"). Clinicians adjust per anatomy; this is the documented default.
   */
  infiltrationFraction?: number
  /** Human-readable clinical notes surfaced to the UI / API consumer. */
  notes: string
}

/**
 * Dosing table keyed by service catalog `code`. Data, not logic — a clinician
 * may tune these (concentration especially, which is product-specific) without
 * editing the calculation. Concentrations below are common commercial
 * presentations; the route layer overrides with the catalog product value when
 * available.
 */
export const DOSE_RULES: Readonly<Record<string, DoseRule>> = Object.freeze({
  // Rabies — wound infiltration (WHO 2018: infiltration only; remainder IM).
  ERIG_INF: {
    iuPerKg: 40,
    productConcentrationIuPerMl: 200, // 1000 IU / 5 mL ampoule (e.g. Equirab/Favirab)
    maxDoseIu: 3000, // sanity ceiling ~ 75 kg @ 40 IU/kg
    route: 'INF',
    infiltrationFraction: 1.0,
    notes:
      'Equine rabies immunoglobulin, 40 IU/kg. Infiltrate as much as anatomically feasible into/around the wound; give any remainder IM at a site distant from the vaccine. Do NOT exceed the calculated dose. Dilute 2–3× with sterile 0.9% saline for multiple/large wounds. Skin sensitivity testing per product label.',
  },
  HRIG_INF: {
    iuPerKg: 20,
    productConcentrationIuPerMl: 150, // 300 IU / 2 mL (e.g. Berirab-P 150 IU/mL)
    maxDoseIu: 1500, // sanity ceiling ~ 75 kg @ 20 IU/kg
    route: 'INF',
    infiltrationFraction: 1.0,
    notes:
      'Human rabies immunoglobulin, 20 IU/kg, single dose on day 0 with the first vaccine dose. Infiltrate into/around the wound; remainder IM distant from the vaccine site. Do NOT exceed the calculated dose.',
  },
  // Tetanus — fixed dose, IM, separate site from the tetanus vaccine.
  HTIG: {
    fixedIu: 250,
    productConcentrationIuPerMl: 250, // 250 IU / 1 mL (e.g. HyperTET / Sero-Tet)
    route: 'IM',
    notes:
      'Human tetanus immunoglobulin, fixed 250 IU prophylaxis (use 500 IU for wounds >24 h old or heavily contaminated). IM only — never IV — in a separate syringe and site from the tetanus vaccine.',
  },
  ATS: {
    fixedIu: 1500,
    productConcentrationIuPerMl: 1500, // 1500 IU / 1 mL equine antitoxin (e.g. Antitet)
    route: 'IM',
    notes:
      'Equine anti-tetanus serum, fixed 1500 IU prophylaxis (range 1000–1500 IU). IM or SC. Equine antitoxin — perform sensitivity testing per product label; HTIG is preferred where available.',
  },
})

/**
 * Resolve a dosing rule from either the clinical catalog `code` (e.g.
 * `ERIG_INF`) OR the catalog `id` the frontend actually sends
 * (`SVC_ERIG_INF` — `order.service.id`).
 *
 * `DOSE_RULES` is keyed by clinical code, but the four seeded dose-calc
 * services follow `service_catalog.id === 'SVC_' + code` (`SVC_ERIG_INF`,
 * `SVC_HRIG_INF`, `SVC_HTIG`, `SVC_ATS`). The Administer dialog passes the
 * `id`, so a raw `DOSE_RULES[id]` lookup misses. Try a direct hit first
 * (handles the code form + unit tests), then the `SVC_`-stripped form
 * (handles the catalog id). Returns undefined when neither matches — the
 * stripped form only resolves if it is itself a known clinical code, so an
 * unrelated `SVC_FOO` id still yields undefined.
 */
export function resolveDoseRule(serviceIdentifier: string): DoseRule | undefined {
  return DOSE_RULES[serviceIdentifier] ?? DOSE_RULES[serviceIdentifier.replace(/^SVC_/, '')]
}

/** Result of a dose calculation. All volumes in mL, all IU amounts integral-ish IU. */
export interface DoseResult {
  serviceCode: string
  weightKg: number | null
  /** Total dose in IU after applying the max-dose ceiling. */
  totalIu: number
  /** Total volume to draw, in mL, rounded to 2 decimals. */
  volumeMl: number
  /** Volume to infiltrate into/around the wound (INF products), in mL. */
  infiltrationMl: number
  /** Volume to give IM (remainder for INF products, or the full dose for IM products), in mL. */
  imMl: number
  route: DoseRoute
  /** True when the weight-calculated dose was clipped to `maxDoseIu`. */
  cappedAtMax: boolean
  /** Whether this rule is weight-based (true) or a fixed dose (false). */
  weightBased: boolean
  /** Non-fatal clinical alerts the UI must surface. */
  warnings: string[]
  notes: string
}

export class DoseCalcError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
    this.name = 'DoseCalcError'
  }
}

/** Plausible adult/paediatric weight envelope. Outside → reject, never compute. */
const MIN_WEIGHT_KG = 0
const MAX_WEIGHT_KG = 500

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export interface CalculateDoseInput {
  /** Service catalog code (ERIG_INF | HRIG_INF | HTIG | ATS). */
  serviceCode: string
  /** Patient weight in kg. Required for weight-based rules; ignored for fixed-dose rules. */
  weightKg?: number | null
  /**
   * Optional override of the product concentration (IU/mL) — the route layer
   * passes the catalog product's real concentration when known.
   */
  productConcentrationIuPerMl?: number | null
  /** Optional override of the dosing rule (e.g. clinician-configured table). */
  rule?: DoseRule
}

/**
 * Compute the weight-based (or fixed) immunoglobulin dose for a service.
 *
 * Guards (NEVER silently produce a dangerous dose):
 *  - unknown service code → throw `DoseCalcError('UNKNOWN_SERVICE')`
 *  - weight-based rule with missing/<=0/absurd weight → throw `DoseCalcError`
 *  - non-positive concentration → throw `DoseCalcError('INVALID_CONCENTRATION')`
 *  - weight-calculated dose above the sanity ceiling → cap + `cappedAtMax` + warning
 */
export function calculateDose(input: CalculateDoseInput): DoseResult {
  const { serviceCode } = input
  // Accept either the clinical code (ERIG_INF) or the catalog id (SVC_ERIG_INF).
  const rule = input.rule ?? resolveDoseRule(serviceCode)
  if (!rule) {
    throw new DoseCalcError(
      `No dosing rule for service "${serviceCode}". Weight-based dosing is only defined for ERIG_INF, HRIG_INF, HTIG, ATS (catalog ids SVC_ERIG_INF, SVC_HRIG_INF, SVC_HTIG, SVC_ATS).`,
      'UNKNOWN_SERVICE',
    )
  }

  const concentration =
    input.productConcentrationIuPerMl != null && input.productConcentrationIuPerMl > 0
      ? input.productConcentrationIuPerMl
      : rule.productConcentrationIuPerMl
  if (!(concentration > 0)) {
    throw new DoseCalcError(
      'Product concentration (IU/mL) must be a positive number.',
      'INVALID_CONCENTRATION',
    )
  }

  const warnings: string[] = []
  const weightBased = rule.iuPerKg != null
  let totalIu: number
  let weightKg: number | null = null
  let cappedAtMax = false

  if (weightBased) {
    const w = input.weightKg
    if (w == null || Number.isNaN(w)) {
      throw new DoseCalcError(
        `Weight (kg) is required for ${serviceCode} — it is dosed at ${rule.iuPerKg} IU/kg.`,
        'WEIGHT_REQUIRED',
      )
    }
    if (w <= MIN_WEIGHT_KG) {
      throw new DoseCalcError('Weight (kg) must be greater than 0.', 'INVALID_WEIGHT')
    }
    if (w > MAX_WEIGHT_KG) {
      throw new DoseCalcError(
        `Weight ${w} kg is implausible (> ${MAX_WEIGHT_KG} kg). Re-check the entry.`,
        'INVALID_WEIGHT',
      )
    }
    weightKg = w
    totalIu = rule.iuPerKg! * w

    if (rule.maxDoseIu != null && totalIu > rule.maxDoseIu) {
      cappedAtMax = true
      warnings.push(
        `Calculated dose ${round2(totalIu)} IU exceeds the configured ceiling of ${rule.maxDoseIu} IU and was capped. Verify the weight (${w} kg) is correct before administering.`,
      )
      totalIu = rule.maxDoseIu
    }
  } else {
    // Fixed-dose rule — weight is irrelevant; warn if one was supplied.
    totalIu = rule.fixedIu!
    if (input.weightKg != null) {
      warnings.push(
        `${serviceCode} is a fixed ${rule.fixedIu} IU dose — patient weight does not change it.`,
      )
    }
  }

  const volumeMl = round2(totalIu / concentration)
  const infiltrationFraction = rule.route === 'INF' ? (rule.infiltrationFraction ?? 1.0) : 0
  const infiltrationMl = round2(volumeMl * infiltrationFraction)
  const imMl = round2(volumeMl - infiltrationMl)

  if (rule.route === 'INF') {
    warnings.push(
      'Infiltrate as much as anatomically feasible into/around the wound; give any remainder IM at a site distant from the vaccine. Do NOT exceed the calculated dose.',
    )
  }

  return {
    serviceCode,
    weightKg,
    totalIu: round2(totalIu),
    volumeMl,
    infiltrationMl,
    imMl,
    route: rule.route,
    cappedAtMax,
    weightBased,
    warnings,
    notes: rule.notes,
  }
}
