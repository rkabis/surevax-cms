import { branchDisplayId } from '../../../shared/utils/displayId.js'
import { str, truncate } from '../normalize.js'
import type { SrcBranch } from '../types.js'
import type { TargetBranch } from '../targets.js'

/**
 * Branch sheet → branches.
 *
 * AppSheet Row ID is a branch slug (e.g. `HolySpirit`). v2 uses display ids of
 * shape `{tenantSlug}.{3-letter-code}`; `code` is 3 uppercase letters. The
 * legacy `b_TransactionInitials` supplies that code (HST, TMG, AGR…); when
 * missing, fall back to the first three letters of the slug, uppercased.
 *
 * `b_AllowAccess` is intentionally dropped — Wave 2.1 replaced this flag with
 * the `branch_isolation` RLS policy + `user_branches` membership.
 */
export function transformBranches(src: SrcBranch[], tenantSlug: string): TargetBranch[] {
  const out: TargetBranch[] = []
  const seenCodes = new Set<string>()
  for (const row of src) {
    const slug = str(row['Row ID'])
    if (!slug) continue
    const name = str(row.b_Name) ?? slug
    const code = pickBranchCode(row.b_TransactionInitials, slug, seenCodes)
    seenCodes.add(code)
    out.push({
      displayId: branchDisplayId(tenantSlug, code),
      tenantId: tenantSlug,
      code,
      name: truncate(name, 80) ?? slug,
      address: truncate(str(row.b_Address), 500),
      email: str(row.b_BranchEmail),
      isActive: true,
      legacyAppsheetId: slug,
    })
  }
  return out
}

function pickBranchCode(raw: unknown, slug: string, taken: ReadonlySet<string>): string {
  const fromField = str(raw)
    ?.toUpperCase()
    .replace(/[^A-Z]/g, '')
  const candidates = [
    fromField,
    slug
      .replace(/[^A-Za-z]/g, '')
      .slice(0, 3)
      .toUpperCase(),
  ].filter((c): c is string => !!c && /^[A-Z]{3}$/.test(c))
  for (const c of candidates) {
    if (!taken.has(c)) return c
  }
  // Synthesise a unique 3-letter code by appending letters.
  for (let i = 0; i < 26; i++) {
    const c = (slug.slice(0, 2).toUpperCase() + String.fromCharCode(65 + i)).slice(0, 3)
    if (/^[A-Z]{3}$/.test(c) && !taken.has(c)) return c
  }
  throw new Error(`transformBranches: cannot pick unique 3-letter code for "${slug}"`)
}

export const __testing__ = { pickBranchCode }
