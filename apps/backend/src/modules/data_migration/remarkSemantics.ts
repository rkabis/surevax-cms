export type RemarkDisposition =
  | 'explicit_external_administration'
  | 'contradicts_prior_dose'
  | 'refused'
  | 'cancelled'
  | 'not_administered'
  | 'purchase_or_future_only'
  | 'neutral'

const rules: Array<{ disposition: RemarkDisposition; patterns: RegExp[] }> = [
  {
    disposition: 'contradicts_prior_dose',
    patterns: [
      /\b(no prior|never (?:received|had)|not previously|unvaccinated)\b.*\b(arv|anti[ -]?rabies|dose ?1)\b/i,
      /\b(missed|did not receive)\b.*\b(dose ?1|first dose)\b/i,
    ],
  },
  {
    disposition: 'explicit_external_administration',
    patterns: [
      /\b(dose ?1|first dose|d1)\b.*\b(hospital|outside|other clinic|external|elsewhere)\b/i,
      /\b(hospital|outside|other clinic|external|elsewhere)\b.*\b(dose ?1|first dose|d1)\b/i,
    ],
  },
  {
    disposition: 'refused',
    patterns: [
      /\b(refused|declined)\b.*\b(arv|vaccine|dose|inject)/i,
      /\b(arv|vaccine|dose|inject)\b.*\b(refused|declined)\b/i,
    ],
  },
  {
    disposition: 'cancelled',
    patterns: [
      /\b(cancelled|canceled|voided)\b.*\b(arv|vaccine|dose|inject)/i,
      /\b(arv|vaccine|dose|inject)\b.*\b(cancelled|canceled|voided)\b/i,
    ],
  },
  {
    disposition: 'not_administered',
    patterns: [/\b(not given|not administered|not yet given|not yet administered)\b/i],
  },
  {
    disposition: 'purchase_or_future_only',
    patterns: [
      /\b(deposit|reservation)\b.*\b(arv|vaccine|dose|inject)/i,
      /\b(for next visit|future dose|next dose)\b/i,
    ],
  },
]

export function classifyRemark(raw: string): RemarkDisposition {
  const normalized = raw.normalize('NFKC').replace(/\s+/g, ' ').trim()
  for (const rule of rules) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) return rule.disposition
  }
  return 'neutral'
}

export type ExternalDoseOneDecision =
  | { action: 'none'; reason: 'first_local_is_dose_1_or_unknown' }
  | { action: 'create_external_dose_1'; basis: 'explicit_remark' | 'owner_assumption' }
  | { action: 'manual_review'; priority: 'P1'; reason: 'contradictory_remark' }

/** Owner rule E33: remarks first; absent a contradiction, local ARV D2+ implies external D1. */
export function decideExternalDoseOne(
  firstLocalDoseNumber: number | null,
  remarks: string[],
): ExternalDoseOneDecision {
  if (firstLocalDoseNumber === null || firstLocalDoseNumber < 2) {
    return { action: 'none', reason: 'first_local_is_dose_1_or_unknown' }
  }
  const dispositions = remarks.map(classifyRemark)
  if (dispositions.includes('contradicts_prior_dose')) {
    return { action: 'manual_review', priority: 'P1', reason: 'contradictory_remark' }
  }
  if (dispositions.includes('explicit_external_administration')) {
    return { action: 'create_external_dose_1', basis: 'explicit_remark' }
  }
  return { action: 'create_external_dose_1', basis: 'owner_assumption' }
}

export function trackerRemarkNegatesAdministration(raw: string): boolean {
  return ['refused', 'cancelled', 'not_administered', 'purchase_or_future_only'].includes(
    classifyRemark(raw),
  )
}

export type AnimalDeathRemarkDisposition =
  | 'killed_for_testing'
  | 'died_naturally'
  | 'died_accidentally'
  | 'death_confirmed_unspecified'
  | 'none'

/**
 * Enriches E42 only when a remark explicitly refers to the biting animal.
 * Treatment skin tests (ERIG/ATS) intentionally remain `none`.
 */
export function classifyAnimalDeathRemark(raw: string): AnimalDeathRemarkDisposition {
  const normalized = raw.normalize('NFKC').replace(/\s+/g, ' ').trim()
  const animal = String.raw`(?:animal|pet|dog|cat|aso|pusa|stray)`
  const death = String.raw`(?:dead|died|death|patay|namatay|killed|pinatay|euthani[sz]ed)`

  if (
    new RegExp(
      String.raw`(?:${animal}.*(?:killed|pinatay|euthani[sz]ed).*(?:fat|rabies|test|laboratory|lab)|(?:fat|rabies|test|laboratory|lab).*${animal}.*(?:killed|pinatay|euthani[sz]ed))`,
      'i',
    ).test(normalized)
  ) {
    return 'killed_for_testing'
  }
  if (
    new RegExp(
      String.raw`(?:${animal}.*${death}.*(?:hit by|run over|nasagasaan|accident)|${animal}.*(?:hit by|run over|nasagasaan|accident).*(?:${death})|${death}.*${animal}.*(?:hit by|run over|nasagasaan|accident))`,
      'i',
    ).test(normalized)
  ) {
    return 'died_accidentally'
  }
  if (
    new RegExp(
      String.raw`(?:${animal}.*(?:died naturally|natural death|natural causes)|(?:died naturally|natural death|natural causes).*${animal})`,
      'i',
    ).test(normalized)
  ) {
    return 'died_naturally'
  }
  if (new RegExp(String.raw`(?:${animal}.*${death}|${death}.*${animal})`, 'i').test(normalized)) {
    return 'death_confirmed_unspecified'
  }
  return 'none'
}

export type PendingAnimalIncidentAnchor = 'unique' | 'ambiguous' | 'none'

export type PendingAnimalFollowupDecision = {
  sourceOutcome: 'Pending'
  timing: 'not_yet_due' | 'overdue' | 'date_unknown'
  dueDate: string | null
  queuePriority: 'P1' | 'P3' | null
  migrationAction: 'retain_pending_followup' | 'preserve_raw_pending'
  treatmentAction: 'continue_pep'
  reason:
    | 'unique_incident_not_yet_due'
    | 'unique_incident_overdue'
    | 'incident_ambiguous'
    | 'incident_unavailable'
    | 'first_arv_date_missing_or_invalid'
}

/**
 * Owner rules Q35/Q36 and E42:
 * - p_PetFirstARVDate is the human patient's first ARV date;
 * - Pending means the nurse did not record the Day-14 outcome;
 * - Pending never proves Alive/Dead and never cancels PEP.
 *
 * The legacy AppSheet expression subtracted day-of-month numbers, so it reset
 * across month boundaries. This function uses full UTC calendar dates.
 */
export function classifyPendingAnimalFollowup(input: {
  humanFirstArvDate: string | null
  cutoffDate: string
  incidentAnchor: PendingAnimalIncidentAnchor
}): PendingAnimalFollowupDecision {
  const cutoff = parseIsoDate(input.cutoffDate)
  if (!cutoff) throw new Error('cutoffDate must be a real YYYY-MM-DD date')

  const firstArv = parseIsoDate(input.humanFirstArvDate)
  const due = firstArv ? addUtcDays(firstArv, 14) : null
  const timing = due
    ? cutoff.getTime() >= due.getTime()
      ? 'overdue'
      : 'not_yet_due'
    : 'date_unknown'
  const dueDate = due ? formatIsoDate(due) : null

  if (input.incidentAnchor === 'ambiguous') {
    return {
      sourceOutcome: 'Pending',
      timing,
      dueDate,
      queuePriority: 'P1',
      migrationAction: 'preserve_raw_pending',
      treatmentAction: 'continue_pep',
      reason: 'incident_ambiguous',
    }
  }
  if (input.incidentAnchor === 'none') {
    return {
      sourceOutcome: 'Pending',
      timing,
      dueDate,
      queuePriority: 'P3',
      migrationAction: 'preserve_raw_pending',
      treatmentAction: 'continue_pep',
      reason: 'incident_unavailable',
    }
  }
  if (!due) {
    return {
      sourceOutcome: 'Pending',
      timing,
      dueDate,
      queuePriority: 'P3',
      migrationAction: 'preserve_raw_pending',
      treatmentAction: 'continue_pep',
      reason: 'first_arv_date_missing_or_invalid',
    }
  }

  return {
    sourceOutcome: 'Pending',
    timing,
    dueDate,
    queuePriority: timing === 'overdue' ? 'P3' : null,
    migrationAction: 'retain_pending_followup',
    treatmentAction: 'continue_pep',
    reason: timing === 'overdue' ? 'unique_incident_overdue' : 'unique_incident_not_yet_due',
  }
}

function parseIsoDate(raw: string | null): Date | null {
  if (!raw) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null
  }
  return parsed
}

function addUtcDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime())
  copy.setUTCDate(copy.getUTCDate() + days)
  return copy
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}
