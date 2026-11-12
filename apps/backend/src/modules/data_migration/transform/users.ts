import { displayId } from '../../../shared/utils/displayId.js'
import { str } from '../normalize.js'
import type { SrcAdminEmail, SrcNurse } from '../types.js'
import type { TargetUser } from '../targets.js'

/**
 * Nurse + AdminEmails sheets → users (+ user_roles).
 *
 *   - One v2 `users` row per Nurse Row ID; role inferred from name
 *     (`Dr. Lacuarin` → Physician; else Nurse).
 *   - `AppSheetAdmin` → `migration-bot@surevax.internal` service account
 *     (Branch role, can_login=false) used as created_by for imported rows.
 *   - AdminEmails entries grant TenantAdmin.
 *
 * Email is NOT NULL in schema; synthesise `<slug>@<tenant>.migration.local`
 * when the Nurse sheet has no email. Ops rotates these post-cutover.
 */

export const MIGRATION_BOT_LEGACY_ID = 'AppSheetAdmin'
export const MIGRATION_BOT_EMAIL = 'migration-bot@surevax.internal'

/**
 * Bcrypt-shaped placeholder for "MIGRATION_PLACEHOLDER". Importer never logs in
 * with it; ops resets every imported staff password on first cutover. Constant
 * so we don't run bcrypt 90+ times during a migration.
 */
const PLACEHOLDER_PASSWORD_HASH =
  '$2b$12$abcdefghijklmnopqrstuv0placeholder000hashWillBeRotated00000abc'

export function transformUsers(
  nurses: SrcNurse[],
  adminEmails: SrcAdminEmail[],
  tenantSlug: string,
): TargetUser[] {
  const adminEmailSet = new Set(
    adminEmails.map((r) => str(r.Email)?.toLowerCase()).filter(Boolean) as string[],
  )
  const out: TargetUser[] = []
  let sawBot = false
  for (const row of nurses) {
    const slug = str(row['Row ID'])
    if (!slug) continue
    const isBot = slug === MIGRATION_BOT_LEGACY_ID
    if (isBot) sawBot = true
    const firstName = str(row.n_FirstName) ?? slug
    const lastName = str(row.n_LastName) ?? '—'
    const fullName = str(row.n_FullName) ?? `${firstName} ${lastName}`
    const email = isBot ? MIGRATION_BOT_EMAIL : synthesiseEmail(slug, tenantSlug)
    const roles = pickRoles(fullName, adminEmailSet.has(email.toLowerCase()), isBot)
    out.push({
      displayId: displayId('USR'),
      tenantId: tenantSlug,
      email,
      passwordHash: PLACEHOLDER_PASSWORD_HASH,
      firstName,
      lastName,
      primaryBranchDisplayId: str(row.n_BranchRef),
      canLogin: !isBot,
      status: 'Active',
      legacyAppsheetId: slug,
      roles,
    })
  }
  if (!sawBot) {
    out.push({
      displayId: displayId('USR'),
      tenantId: tenantSlug,
      email: MIGRATION_BOT_EMAIL,
      passwordHash: PLACEHOLDER_PASSWORD_HASH,
      firstName: 'Migration',
      lastName: 'Bot',
      primaryBranchDisplayId: null,
      canLogin: false,
      status: 'Active',
      legacyAppsheetId: MIGRATION_BOT_LEGACY_ID,
      roles: ['Branch'],
    })
  }
  const nurseEmails = new Set(out.map((u) => u.email.toLowerCase()))
  for (const adminEmail of adminEmailSet) {
    if (!adminEmail || nurseEmails.has(adminEmail)) continue
    out.push({
      displayId: displayId('USR'),
      tenantId: tenantSlug,
      email: adminEmail,
      passwordHash: PLACEHOLDER_PASSWORD_HASH,
      firstName: 'Admin',
      lastName: 'User',
      primaryBranchDisplayId: null,
      canLogin: true,
      status: 'Active',
      legacyAppsheetId: `ADMIN_${adminEmail}`,
      roles: ['TenantAdmin'],
    })
  }
  return out
}

function synthesiseEmail(slug: string, tenantSlug: string): string {
  const safe = slug.replace(/[^A-Za-z0-9]/g, '').toLowerCase()
  return `${safe}@${tenantSlug.toLowerCase()}.migration.local`
}

function pickRoles(fullName: string, isAdmin: boolean, isBot: boolean): TargetUser['roles'] {
  if (isBot) return ['Branch']
  const roles: TargetUser['roles'] = []
  if (/^Dr\.?\s/i.test(fullName) || /\bMD\b/.test(fullName)) roles.push('Physician')
  else roles.push('Nurse')
  if (isAdmin) roles.unshift('TenantAdmin')
  return roles
}

export const __testing__ = { synthesiseEmail, pickRoles }
