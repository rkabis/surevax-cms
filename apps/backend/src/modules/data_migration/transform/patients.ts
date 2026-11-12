import { displayId } from '../../../shared/utils/displayId.js'
import { dateOnly, firstBranchSlug, sex, str, truncate, ts } from '../normalize.js'
import type { SrcPatient } from '../types.js'
import type { TargetPatient } from '../targets.js'

/**
 * Patient sheet → patients.
 *
 * Field placement (existing-schema decision):
 *   • p_OnboardingChannel        → onboarding_data.channel
 *   • p_SourceOfConcern          → onboarding_data.sourceOfConcern
 *   • p_Categorization 1/2/3     → DEFERRED to encounters.triage_category
 *   • p_PetStatus              → preserve raw biting-animal Day-14 outcome
 *   • p_PetFirstARVDate        → preserve the human patient's first ARV date
 *   • health card URL             → DROPPED (B2)
 *   • Patient.Row ID             → NOT persisted (A3); RowIdMap in-memory only
 *   • p_Branch CSV               → first slug → home_branch_id
 *
 * Duplicate detection: when two rows share normalised (firstName, lastName,
 * dateOfBirth, phone), the OLDER row (earlier createdAt) is primary; the newer
 * carries `mergedIntoLegacyId`. Loader sets `merged_into_id` after both insert.
 * Phone+DOB+name triple required (phone alone = 501 false-positive groups).
 */
export function transformPatients(src: SrcPatient[], tenantSlug: string): TargetPatient[] {
  const sorted = [...src]
    .filter((r) => str(r['Row ID']))
    .sort((a, b) => {
      const ta = ts(a.p_DateFirstVisit)?.getTime() ?? Number.MAX_SAFE_INTEGER
      const tb = ts(b.p_DateFirstVisit)?.getTime() ?? Number.MAX_SAFE_INTEGER
      return ta - tb
    })

  const out: TargetPatient[] = []
  let mrnSeq = 0
  for (const row of sorted) {
    const rowId = str(row['Row ID'])!
    const { firstName, lastName } = splitName(
      str(row.p_FirstName),
      str(row.p_LastName),
      str(row.p_FullName),
    )
    if (!firstName || !lastName) continue
    mrnSeq += 1

    const onboardingData: Record<string, unknown> = {}
    const channel = str(row.p_OnboardingChannel)
    if (channel) onboardingData.channel = channel
    const concern = str(row.p_SourceOfConcern)
    if (concern) onboardingData.sourceOfConcern = concern
    const bitingAnimalStatus = rawString(row.p_PetStatus)
    if (bitingAnimalStatus) onboardingData.legacyBitingAnimal = { status: bitingAnimalStatus }
    const humanFirstArvDate = dateOnly(row.p_PetFirstARVDate)
    if (humanFirstArvDate) onboardingData.legacyHumanFirstArvDate = humanFirstArvDate

    out.push({
      displayId: displayId('PAT'),
      tenantId: tenantSlug,
      mrnSeq,
      homeBranchDisplayId: firstBranchSlug(row.p_Branch),
      firstName: truncate(firstName, 80)!,
      lastName: truncate(lastName, 80)!,
      middleName: truncate(str(row.p_MiddleName), 80),
      dateOfBirth: dateOnly(row.p_DateOfBirth),
      sex: sex(row.p_Gender),
      contactNumber: normalizePhone(row.p_ContactNumber),
      email: normalizeEmail(row.p_EmailAddress),
      address: truncate(str(row.p_HomeAddress), 500),
      onboardingData,
      isActive: true,
      createdAt: ts(row.p_DateFirstVisit),
      legacyAppsheetId: rowId,
      mergedIntoLegacyId: null,
    })
  }

  // Cross-format duplicate detection (name + DOB + phone triple).
  const byKey = new Map<string, TargetPatient[]>()
  for (const p of out) {
    if (!p.dateOfBirth || !p.contactNumber) continue
    const key = `${p.firstName.toLowerCase()}::${p.lastName.toLowerCase()}::${p.dateOfBirth}::${p.contactNumber}`
    const list = byKey.get(key) ?? []
    list.push(p)
    byKey.set(key, list)
  }
  for (const [, list] of byKey) {
    if (list.length < 2) continue
    const sortedByDate = [...list].sort((a, b) => {
      const ta = a.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER
      const tb = b.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER
      return ta - tb
    })
    const primary = sortedByDate[0]!
    for (let i = 1; i < sortedByDate.length; i++) {
      sortedByDate[i]!.mergedIntoLegacyId = primary.legacyAppsheetId
    }
  }

  return out
}

function splitName(
  first: string | null,
  last: string | null,
  full: string | null,
): { firstName: string | null; lastName: string | null } {
  if (first && last) return { firstName: first, lastName: last }
  if (full) {
    const parts = full.trim().split(/\s+/)
    if (parts.length >= 2) {
      return { firstName: first ?? parts[0]!, lastName: last ?? parts[parts.length - 1]! }
    }
  }
  return { firstName: first, lastName: last }
}

function normalizePhone(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number' && Number.isFinite(v)) {
    const s = Math.round(v).toString()
    return s.length === 10 ? `+63${s}` : s
  }
  const s = str(v)
  if (!s) return null
  const digits = s
    .replace(/[^\d+]/g, '')
    .replace(/^\+?63/, '')
    .replace(/^0/, '')
  return /^\d{10}$/.test(digits) ? `+63${digits}` : digits || null
}

function normalizeEmail(v: unknown): string | null {
  const s = str(v)
  if (!s) return null
  const lower = s.toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lower)) return null
  return lower
}

/** Preserve legacy animal-status vocabulary, including the meaningful N/A sentinel. */
function rawString(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const value = String(v).trim()
  return value || null
}

export const __testing__ = { splitName, normalizePhone, normalizeEmail, rawString }
