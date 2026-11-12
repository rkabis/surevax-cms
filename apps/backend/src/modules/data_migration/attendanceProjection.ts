import { dateOnly, str, ts } from './normalize.js'
import type { LoadPlan, TargetStaffTimeLog, TargetUser } from './targets.js'
import type { SourceBundle, SrcTimeLog } from './types.js'

export type AttendanceProjection = {
  staffTimeLogs: TargetStaffTimeLog[]
  counts: {
    timeLogSourceRows: number
    nurseShiftSourceRows: number
    timeLogPairs: number
    nurseShiftRows: number
    crossSourceDuplicatesCollapsed: number
    unresolvedUserRowsWithheld: number
    unresolvedBranchRowsWithheld: number
    unpairedTimeOutRowsWithheld: number
    invalidDateRowsWithheld: number
    projectedRows: number
  }
}

type Candidate = TargetStaffTimeLog & { source: 'TimeLog' | 'NurseShift' }

/** Conservative C1 union of the two legitimate legacy clocking paths. */
export function projectAttendance(input: {
  source: SourceBundle
  plan: LoadPlan
  tenantId: string
  cutoffAt: Date
}): AttendanceProjection {
  const users = userResolver(input.plan.users)
  let unresolvedUserRowsWithheld = 0
  let unresolvedBranchRowsWithheld = 0
  let unpairedTimeOutRowsWithheld = 0
  let invalidDateRowsWithheld = 0
  let timeLogPairs = 0
  let nurseShiftRows = 0
  const candidates: Candidate[] = []

  const groupedTimeLog = new Map<
    string,
    Array<{ row: SrcTimeLog; at: Date; option: 'in' | 'out'; userId: string; branchId: string }>
  >()
  for (const row of input.source.TimeLog) {
    const rowId = str(row['Row ID'])
    const userId = users(str(row.tl_NurseRef))
    const branchId = branchFromEmail(row.tl_BranchEmail)
    const at = combineDateAndTime(row.tl_Date, row.tl_Time)
    const option = attendanceOption(str(row.tl_Option))
    if (!rowId || !option) continue
    if (!userId) {
      unresolvedUserRowsWithheld += 1
      continue
    }
    if (!branchId) {
      unresolvedBranchRowsWithheld += 1
      continue
    }
    if (!at || !sane(at, input.cutoffAt)) {
      invalidDateRowsWithheld += 1
      continue
    }
    const key = `${userId}::${branchId}::${dateOnly(at)}`
    groupedTimeLog.set(key, [
      ...(groupedTimeLog.get(key) ?? []),
      { row, at, option, userId, branchId },
    ])
  }
  for (const rows of groupedTimeLog.values()) {
    const sorted = [...rows].sort((left, right) => left.at.getTime() - right.at.getTime())
    let open: (typeof sorted)[number] | null = null
    for (const event of sorted) {
      if (event.option === 'in') {
        if (open) candidates.push(timeLogCandidate(input.tenantId, open, null))
        open = event
        continue
      }
      if (!open) {
        unpairedTimeOutRowsWithheld += 1
        continue
      }
      candidates.push(timeLogCandidate(input.tenantId, open, event))
      timeLogPairs += 1
      open = null
    }
    if (open) candidates.push(timeLogCandidate(input.tenantId, open, null))
  }

  for (const row of input.source.NurseShift) {
    const rowId = str(row['Row ID'])
    const userId = users(str(row.ns_NurseRef))
    const branchId = branchFromEmail(row.ns_BranchEmail)
    const clockInAt = combineDateAndTime(row.ns_Date, row.ns_TimeIn)
    const rawOut = combineDateAndTime(row.ns_Date, row.ns_TimeOut)
    const clockOutAt = rawOut && clockInAt && rawOut >= clockInAt ? rawOut : null
    if (!rowId) continue
    if (!userId) {
      unresolvedUserRowsWithheld += 1
      continue
    }
    if (!branchId) {
      unresolvedBranchRowsWithheld += 1
      continue
    }
    if (!clockInAt || !sane(clockInAt, input.cutoffAt)) {
      invalidDateRowsWithheld += 1
      continue
    }
    candidates.push({
      displayId: 'TLG_PENDING',
      tenantId: input.tenantId,
      userLegacyId: userId,
      branchDisplayId: branchId,
      clockInAt,
      clockOutAt,
      totalHours: hours(clockInAt, clockOutAt),
      notes: notes('NurseShift', row.ns_Remarks, row.ns_OvertimeRemarks, row.ns_Location),
      legacyAppsheetId: `ATT::NS::${rowId}`,
      source: 'NurseShift',
    })
    nurseShiftRows += 1
  }

  // Prefer NurseShift when both paths record the same user/branch start within
  // five minutes and compatible end times. Its single row carries the complete
  // shift; TimeLog remains evidence but does not create a second target row.
  const accepted: Candidate[] = []
  let crossSourceDuplicatesCollapsed = 0
  for (const candidate of [...candidates].sort(
    (a, b) =>
      sourceRank(a.source) - sourceRank(b.source) || a.clockInAt.getTime() - b.clockInAt.getTime(),
  )) {
    const duplicate = accepted.find(
      (prior) =>
        prior.source !== candidate.source &&
        prior.userLegacyId === candidate.userLegacyId &&
        prior.branchDisplayId === candidate.branchDisplayId &&
        Math.abs(prior.clockInAt.getTime() - candidate.clockInAt.getTime()) <= 5 * 60_000 &&
        compatibleEnd(prior.clockOutAt, candidate.clockOutAt),
    )
    if (duplicate) {
      crossSourceDuplicatesCollapsed += 1
      continue
    }
    accepted.push(candidate)
  }

  return {
    staffTimeLogs: accepted.map(({ source: _source, ...row }) => row),
    counts: {
      timeLogSourceRows: input.source.TimeLog.length,
      nurseShiftSourceRows: input.source.NurseShift.length,
      timeLogPairs,
      nurseShiftRows,
      crossSourceDuplicatesCollapsed,
      unresolvedUserRowsWithheld,
      unresolvedBranchRowsWithheld,
      unpairedTimeOutRowsWithheld,
      invalidDateRowsWithheld,
      projectedRows: accepted.length,
    },
  }
}

function userResolver(users: readonly TargetUser[]): (value: string | null) => string | null {
  const direct = new Set(users.map((user) => user.legacyAppsheetId))
  const byName = new Map<string, string[]>()
  for (const user of users) {
    const name = normalized(`${user.firstName} ${user.lastName}`)
    byName.set(name, [...(byName.get(name) ?? []), user.legacyAppsheetId])
  }
  return (value) => {
    if (!value) return null
    if (direct.has(value)) return value
    const matches = byName.get(normalized(value)) ?? []
    return matches.length === 1 ? matches[0]! : null
  }
}

function timeLogCandidate(
  tenantId: string,
  start: { row: SrcTimeLog; at: Date; userId: string; branchId: string },
  end: { row: SrcTimeLog; at: Date } | null,
): Candidate {
  const startId = str(start.row['Row ID'])!
  const endId = end ? str(end.row['Row ID']) : null
  return {
    displayId: 'TLG_PENDING',
    tenantId,
    userLegacyId: start.userId,
    branchDisplayId: start.branchId,
    clockInAt: start.at,
    clockOutAt: end?.at ?? null,
    totalHours: hours(start.at, end?.at ?? null),
    notes: notes('TimeLog', start.row.tl_Remarks, end?.row.tl_Remarks, start.row.tl_Location),
    legacyAppsheetId: `ATT::TL::${startId}::${endId ?? 'OPEN'}`,
    source: 'TimeLog',
  }
}

function combineDateAndTime(dateValue: unknown, timeValue: unknown): Date | null {
  const day = dateOnly(dateValue)
  if (!day || timeValue === null || timeValue === undefined || timeValue === '') return null
  const raw = String(timeValue)
  const textual =
    raw.match(/(?:T|\s)(\d{1,2}):(\d{2})(?::(\d{2}))?/) ??
    raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (textual)
    return new Date(
      `${day}T${textual[1]!.padStart(2, '0')}:${textual[2]}:${textual[3] ?? '00'}+08:00`,
    )
  const parsed = ts(timeValue)
  if (!parsed) return null
  const hours = String(parsed.getUTCHours()).padStart(2, '0')
  const minutes = String(parsed.getUTCMinutes()).padStart(2, '0')
  const seconds = String(parsed.getUTCSeconds()).padStart(2, '0')
  return new Date(`${day}T${hours}:${minutes}:${seconds}+08:00`)
}

function branchFromEmail(value: unknown): string | null {
  const raw = str(value)
    ?.split('@')[0]
    ?.replace(/^surevax\.?/i, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
  if (!raw) return null
  return BRANCHES[raw] ?? null
}

const BRANCHES: Record<string, string> = {
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
  stamesa: 'StaMesa',
  cubao: 'Cubao',
  virtual: 'Virtual',
  appsheet: 'TestBranch',
  test: 'TestBranch',
}

function attendanceOption(value: string | null): 'in' | 'out' | null {
  if (/time\s*in/i.test(value ?? '')) return 'in'
  if (/time\s*out/i.test(value ?? '')) return 'out'
  return null
}

function sane(value: Date, cutoffAt: Date): boolean {
  return value >= new Date('2000-01-01T00:00:00.000Z') && value <= cutoffAt
}

function hours(start: Date, end: Date | null): string | null {
  if (!end || end <= start) return null
  return ((end.getTime() - start.getTime()) / 3_600_000).toFixed(2)
}

function notes(source: string, ...values: unknown[]): string {
  const text = values
    .map(str)
    .filter((value): value is string => !!value)
    .join(' | ')
  return text ? `Migration source ${source} | ${text}` : `Migration source ${source}`
}

function normalized(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase()
}

function sourceRank(source: Candidate['source']): number {
  return source === 'NurseShift' ? 0 : 1
}
function compatibleEnd(left: Date | null, right: Date | null): boolean {
  if (!left || !right) return true
  return Math.abs(left.getTime() - right.getTime()) <= 10 * 60_000
}
