import { displayId } from '../../../shared/utils/displayId.js'
import { str, ts } from '../normalize.js'
import type { SrcNurseShift } from '../types.js'
import type { TargetStaffTimeLog } from '../targets.js'

/**
 * NurseShift sheet → staff_time_logs.
 *
 * NurseShift-side normalizer retained for the future C1 union. It is not a
 * complete attendance import by itself: TimeLog was another valid clock-in /
 * clock-out path and must be paired/deduplicated with NurseShift if historical
 * staffing data is imported. Branch is recovered from the legacy email column
 * (`surevax.timog@gmail.com` → `Timog`). `ns_NurseRef` here is the full display
 * name, NOT the Nurse-sheet slug — the loader resolves by name.
 */
export function transformShifts(src: SrcNurseShift[], tenantSlug: string): TargetStaffTimeLog[] {
  const out: TargetStaffTimeLog[] = []
  for (const row of src) {
    const rowId = str(row['Row ID'])
    const nurseRef = str(row.ns_NurseRef)
    const clockIn = ts(row.ns_TimeIn)
    if (!rowId || !nurseRef || !clockIn) continue
    const branchSlug = branchFromEmail(row.ns_BranchEmail)
    if (!branchSlug) continue
    const clockOut = ts(row.ns_TimeOut)
    out.push({
      displayId: displayId('TLG'),
      tenantId: tenantSlug,
      userLegacyId: nurseRef, // resolved by full name at load
      branchDisplayId: branchSlug,
      clockInAt: clockIn,
      clockOutAt: clockOut,
      totalHours: computeHours(clockIn, clockOut),
      notes: composeNotes(row.ns_Remarks, row.ns_OvertimeRemarks, row.ns_Location),
      legacyAppsheetId: rowId,
    })
  }
  return out
}

const BRANCH_BY_EMAIL_SUFFIX: Record<string, string> = {
  hs: 'HolySpirit',
  holyspirit: 'HolySpirit',
  timog: 'Timog',
  taguig: 'Taguig',
  salcedo: 'Salcedo',
  aguirre: 'Aguirre',
  maysilo: 'Maysilo',
  sanjuan: 'SanJuan',
  cainta: 'Cainta',
  marikina: 'Marikina',
  novaliches: 'Novaliches',
  pasig: 'Pasig',
  alabang: 'Alabang',
  virtual: 'Virtual',
  appsheet: 'TestBranch',
}

function branchFromEmail(v: unknown): string | null {
  const s = str(v)
  if (!s) return null
  const local = s.split('@')[0] ?? ''
  const suffix = local.replace(/^surevax\.?/i, '').toLowerCase()
  if (!suffix) return null
  return BRANCH_BY_EMAIL_SUFFIX[suffix] ?? null
}

function computeHours(start: Date, end: Date | null): string | null {
  if (!end) return null
  const ms = end.getTime() - start.getTime()
  if (ms <= 0) return null
  return (ms / 3_600_000).toFixed(2)
}

function composeNotes(
  remarks: unknown,
  overtimeRemarks: unknown,
  location: unknown,
): string | null {
  const parts: string[] = []
  const r = str(remarks)
  if (r) parts.push(r)
  const o = str(overtimeRemarks)
  if (o) parts.push(`OT: ${o}`)
  const l = str(location)
  if (l && l !== '0.000000, 0.000000') parts.push(`@ ${l}`)
  return parts.length ? parts.join(' | ') : null
}

export const __testing__ = { branchFromEmail, computeHours, BRANCH_BY_EMAIL_SUFFIX }
