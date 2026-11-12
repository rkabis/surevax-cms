import { displayId } from '../../../shared/utils/displayId.js'
import { dateOnly, str, ts } from '../normalize.js'
import type { SrcImmunization, SrcRemark } from '../types.js'
import type { TargetEncounter } from '../targets.js'

/**
 * Synthesise encounters from Immunization + Remarks.
 *
 * Field placement (existing schema, no new infra):
 *   • encounters.specialty       = 'Rabies' when any same-visit imm is
 *                                   anti-rabies; else 'Vaccination'; else 'General'
 *   • encounters.triage_category = 'CAT-1/2/3' from the patient's bite category,
 *                                   set when specialty='Rabies'
 *   • encounters.clinical_notes  = { remarks: [...] } from matched Remarks
 *   • encounters.status          = Completed (all imms administered) / Open
 *                                   (some pending) / Cancelled (none)
 *
 * Encounter key: (patientLegacyId, branchSlug, YYYY-MM-DD). Orphan remarks are
 * surfaced via `matchedRemarkIds` (set-difference → orphans).
 */

export type EncounterTransformInput = {
  immunizations: SrcImmunization[]
  remarks: SrcRemark[]
  vaccineTypeByRef: ReadonlyMap<string, string>
  biteCategoryByPatient: ReadonlyMap<string, string>
}

export type EncounterTransformResult = {
  encounters: TargetEncounter[]
  matchedRemarkIds: Set<string>
}

type Aggregate = {
  hasRabies: boolean
  hasNonRabies: boolean
  anyAdministered: boolean
  allAdministered: boolean
  earliestStart: Date
  latestComplete: Date | null
}

export function transformEncounters(
  input: EncounterTransformInput,
  tenantSlug: string,
): EncounterTransformResult {
  const encounters = new Map<string, TargetEncounter>()
  const aggregates = new Map<string, Aggregate>()
  const dateByKey = new Map<string, string>()

  for (const row of input.immunizations) {
    const patientRef = str(row.i_PatientRef)
    const branchRef = str(row.i_BranchRef)
    const date = dateOnly(row.i_Timestamp_Actual) ?? dateOnly(row.i_Timestamp_Ideal)
    if (!patientRef || !branchRef || !date) continue

    const key = synthKey(patientRef, branchRef, date)
    const vaccineRef = str(row.i_VaccineRef)
    const vaccineType = vaccineRef ? input.vaccineTypeByRef.get(vaccineRef) : undefined
    const isRabies = vaccineType?.startsWith('Anti Rabies') ?? false
    const administered = row['i_IsAdministered?'] === true
    const startedAt = ts(row.i_Timestamp_Actual) ?? ts(row.i_Timestamp_Ideal)!
    const completedAt = administered ? ts(row.i_Timestamp_Actual) : null

    let agg = aggregates.get(key)
    if (!agg) {
      agg = {
        hasRabies: false,
        hasNonRabies: false,
        anyAdministered: false,
        allAdministered: true,
        earliestStart: startedAt,
        latestComplete: null,
      }
      aggregates.set(key, agg)
      dateByKey.set(key, date)
      encounters.set(key, {
        displayId: displayId('ENC'),
        tenantId: tenantSlug,
        patientLegacyId: patientRef,
        branchDisplayId: branchRef,
        specialty: 'General',
        status: 'Open',
        startedAt,
        completedAt: null,
        attendingUserLegacyId: str(row.i_NurseRef),
        triageCategory: null,
        clinicalNotes: null,
        specialtyData: null,
        legacyAppsheetId: key,
      })
    }
    if (isRabies) agg.hasRabies = true
    else agg.hasNonRabies = true
    if (administered) {
      agg.anyAdministered = true
      if (completedAt && (!agg.latestComplete || completedAt > agg.latestComplete)) {
        agg.latestComplete = completedAt
      }
    } else {
      agg.allAdministered = false
    }
    if (startedAt < agg.earliestStart) agg.earliestStart = startedAt
  }

  for (const [key, enc] of encounters) {
    const agg = aggregates.get(key)!
    enc.specialty = agg.hasRabies ? 'Rabies' : agg.hasNonRabies ? 'Vaccination' : 'General'
    enc.startedAt = agg.earliestStart
    if (agg.allAdministered && agg.anyAdministered) {
      enc.status = 'Completed'
      enc.completedAt = agg.latestComplete
    } else if (agg.anyAdministered) {
      enc.status = 'Open'
    } else {
      enc.status = 'Cancelled'
    }
    if (enc.specialty === 'Rabies') {
      const raw = input.biteCategoryByPatient.get(enc.patientLegacyId)
      if (raw && /^[123]$/.test(raw)) {
        enc.triageCategory = `CAT-${raw}` as 'CAT-1' | 'CAT-2' | 'CAT-3'
      }
    }
  }

  const matchedRemarkIds = new Set<string>()
  const encByPatient = new Map<string, TargetEncounter[]>()
  for (const enc of encounters.values()) {
    const list = encByPatient.get(enc.patientLegacyId) ?? []
    list.push(enc)
    encByPatient.set(enc.patientLegacyId, list)
  }
  for (const r of input.remarks) {
    const rid = str(r['Row ID'])
    const patient = str(r.r_PatientRef)
    const nurse = str(r.r_NurseRef)
    const date = dateOnly(r.r_Timestamp)
    const text = str(r.r_Remarks)
    if (!rid || !patient || !nurse || !date || !text) continue
    const candidates = encByPatient.get(patient) ?? []
    let matched = false
    for (const enc of candidates) {
      if (enc.attendingUserLegacyId === nurse && dateByKey.get(enc.legacyAppsheetId) === date) {
        const notes = (enc.clinicalNotes ?? {}) as Record<string, unknown>
        const list = ((notes.remarks as string[] | undefined) ?? []).concat(text)
        notes.remarks = list
        enc.clinicalNotes = notes
        matched = true
      }
    }
    if (matched) matchedRemarkIds.add(rid)
  }

  return { encounters: [...encounters.values()], matchedRemarkIds }
}

export function synthKey(patientRef: string, branchRef: string, date: string): string {
  return `${patientRef}::${branchRef}::${date}`
}

export const __testing__ = { synthKey }
