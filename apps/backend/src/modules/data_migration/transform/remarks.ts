import { dateOnly, str } from '../normalize.js'
import type { SrcRemark } from '../types.js'

/**
 * Orphan-Remarks → patients.onboarding_data.legacyNotes
 *
 * Most Remarks attach to a matching encounter (transformEncounters). The
 * orphans — rows whose (patient, nurse, date) matches no encounter — get
 * appended to the patient's `onboarding_data.legacyNotes` jsonb array. No new
 * column / table; uses the existing patients.onboarding_data.
 *
 * Loader path: after patients are inserted, the loader iterates this map and
 * runs one UPDATE per patient that jsonb-concats `legacyNotes`.
 */

export type RemarkOverlay = Map<
  string,
  Array<{ date: string | null; nurseRef: string | null; text: string }>
>

export function transformOrphanRemarks(
  remarks: SrcRemark[],
  matchedRemarkIds: ReadonlySet<string>,
): RemarkOverlay {
  const out: RemarkOverlay = new Map()
  for (const r of remarks) {
    const rowId = str(r['Row ID'])
    if (!rowId || matchedRemarkIds.has(rowId)) continue
    const patient = str(r.r_PatientRef)
    const text = str(r.r_Remarks)
    if (!patient || !text) continue
    const list = out.get(patient) ?? []
    list.push({ date: dateOnly(r.r_Timestamp), nurseRef: str(r.r_NurseRef), text })
    out.set(patient, list)
  }
  return out
}
