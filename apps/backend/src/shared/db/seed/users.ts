/**
 * Seed section — users + user_roles + user_branches.
 *
 * Two-tier IDs (W2, 2026-05-19):
 *   - `users.id` is bigserial, captured via `.returning()`.
 *   - `users.display_id` is the public handle (`USR_<8 base32>`).
 *   - `user_roles` / `user_branches` are junction tables with composite PKs
 *     (no `id` column).
 *
 * Returns the captured bigint user IDs keyed by short name so downstream
 * seeds can FK against them.
 */

import { sql } from 'drizzle-orm'
import * as s from '../schema.js'
import { db } from './db.js'
import { daysAgo, today } from './helpers.js'
import { NURSE_ROSTER } from './roster.js'
import {
  TENANT_SLUG,
  BRANCH_CODE_TMG,
  ADMIN_DISPLAY_ID,
  PHYSICIAN_DISPLAY_ID,
  NURSE_DISPLAY_ID,
  NURSE2_DISPLAY_ID,
  CASHIER_DISPLAY_ID,
  NURSE3_DISPLAY_ID,
  BRANCH_USER_DISPLAY_ID,
} from './constants.js'

export type SeededUsers = {
  admin: number
  physician: number
  nurse: number
  nurse2: number
  cashier: number
  nurse3: number
  branchUser: number
}

type UserRoleEnum = 'TenantAdmin' | 'BranchAdmin' | 'Branch' | 'Physician' | 'Nurse' | 'Cashier'

/**
 * `users.display_id` must be `USR_` + EXACTLY 8 Crockford base32 chars
 * (`DISPLAY_ID_REGEX` / `SUFFIX_LEN` in shared/utils/displayId.ts). Nothing at
 * the DB layer enforces the shape, so malformed ids inserted happily and only
 * failed at the API boundary, where every route taking a user display id
 * validates with `displayIdSchema` / `prefixedDisplayIdSchema('USR')`.
 *
 * `USR_BR${code}` (5 suffix chars) and `USR_R001` (4) both did exactly that:
 * 116 of 123 seeded users were malformed, so `POST /api/auth/verify-pin`
 * answered 400 VALIDATION_ERROR for every roster nurse (the kiosk surfaced
 * only "Something went wrong. Please try again."), and `administeredById` was
 * rejected the same way, so no nurse could be attested as having given a dose
 * on a shared `Branch` login: the core clinical workflow.
 *
 * The branch id is POSITIONAL rather than the branch code, because Crockford
 * base32 omits I, L, O and U: `USR_BRALB000` and `USR_BRSAL000` would still be
 * invalid. The branch is identified by its email anyway
 * (`surevax.<code>@surevax.com`). Index comes from the code-sorted branch list
 * so re-runs stay stable.
 */
function branchKioskDisplayId(sortedIndex: number): string {
  return `USR_B${String(sortedIndex + 1).padStart(7, '0')}`
}

export async function seedUsers(
  passwordHash: string,
  pinHash: string,
  branchId: number,
  branchIdByCode?: Map<string, number>,
): Promise<SeededUsers> {
  // canLogin defaults to true for TenantAdmin/BranchAdmin/Branch and false for
  // Physician/Nurse/Cashier (directory entries only).
  const userRows: Array<{
    displayId: string
    email: string
    firstName: string
    lastName: string
    role: UserRoleEnum
    canLogin: boolean
    licenseNumber?: string
    isActive?: boolean
    lastLoginAt: Date | null
    key: keyof SeededUsers
  }> = [
    {
      displayId: ADMIN_DISPLAY_ID,
      email: 'admin@surevax.com',
      firstName: 'Admin',
      lastName: 'User',
      role: 'TenantAdmin',
      canLogin: true,
      lastLoginAt: today(8, 0),
      key: 'admin',
    },
    {
      displayId: PHYSICIAN_DISPLAY_ID,
      email: 'maria.santos@surevax.com',
      firstName: 'Maria',
      lastName: 'Santos',
      role: 'Physician',
      canLogin: false,
      licenseNumber: 'PRC-0012345',
      lastLoginAt: today(7, 45),
      key: 'physician',
    },
    {
      displayId: NURSE_DISPLAY_ID,
      email: 'juan.dc@surevax.com',
      firstName: 'Juan',
      lastName: 'Dela Cruz',
      role: 'Nurse',
      canLogin: false,
      licenseNumber: 'PRC-0067890',
      lastLoginAt: today(7, 30),
      key: 'nurse',
    },
    {
      displayId: NURSE2_DISPLAY_ID,
      email: 'ana.reyes@surevax.com',
      firstName: 'Ana',
      lastName: 'Reyes',
      role: 'Nurse',
      canLogin: false,
      licenseNumber: 'PRC-0054321',
      lastLoginAt: daysAgo(1),
      key: 'nurse2',
    },
    {
      displayId: CASHIER_DISPLAY_ID,
      email: 'jose.santos@surevax.com',
      firstName: 'Jose',
      lastName: 'Santos',
      role: 'Cashier',
      canLogin: false,
      lastLoginAt: today(8, 15),
      key: 'cashier',
    },
    {
      displayId: NURSE3_DISPLAY_ID,
      email: 'elena.cruz@surevax.com',
      firstName: 'Elena',
      lastName: 'Cruz',
      role: 'Nurse',
      canLogin: false,
      licenseNumber: 'PRC-0099887',
      isActive: false,
      lastLoginAt: daysAgo(46),
      key: 'nurse3',
    },
    {
      displayId: BRANCH_USER_DISPLAY_ID,
      email: 'branch-main@surevax.com',
      firstName: 'Main Branch',
      lastName: 'Account',
      role: 'Branch',
      canLogin: true,
      lastLoginAt: null,
      key: 'branchUser',
    },
  ]

  const ids = {} as SeededUsers

  for (const u of userRows) {
    // Insert user; capture bigint id from .returning() (or look up on conflict).
    const inserted = await db
      .insert(s.users)
      .values({
        displayId: u.displayId,
        tenantId: TENANT_SLUG,
        email: u.email,
        passwordHash,
        pinHash,
        firstName: u.firstName,
        lastName: u.lastName,
        licenseNumber: u.licenseNumber ?? null,
        isActive: u.isActive ?? true,
        canLogin: u.canLogin,
        primaryBranchId: branchId,
        lastLoginAt: u.lastLoginAt,
      })
      .onConflictDoNothing()
      .returning({ id: s.users.id })

    let id = inserted[0]?.id
    if (id === undefined) {
      const [existing] = await db
        .select({ id: s.users.id })
        .from(s.users)
        .where(sql`${s.users.tenantId} = ${TENANT_SLUG} AND ${s.users.displayId} = ${u.displayId}`)
        .limit(1)
      if (!existing) throw new Error(`seedUsers: failed to resolve ${u.displayId}`)
      id = existing.id
    }
    ids[u.key] = id

    // user_roles junction (composite PK on user_id, role).
    await db
      .insert(s.userRoles)
      .values({
        tenantId: TENANT_SLUG,
        userId: id,
        role: u.role,
        branchId,
      })
      .onConflictDoNothing()

    // user_branches junction (composite PK on user_id, branch_id).
    await db
      .insert(s.userBranches)
      .values({
        tenantId: TENANT_SLUG,
        userId: id,
        branchId,
      })
      .onConflictDoNothing()
  }

  console.log('  ✓ users (7) + user_roles + user_branches')

  // ── Second-branch reachability (U5 verification fixture) ──────────────────
  // All seeded users belong only to the default branch passed in (HST). Grant
  // the TenantAdmin membership at a second branch (Timog) via user_branches —
  // per the branch_isolation convention, access IS presence in user_branches
  // (no allowAccess flag) — so cross-branch workflows (branch switcher,
  // break-glass reveal, branch-scoped RLS) are drivable against seed data.
  const [secondBranch] = await db
    .select({ id: s.branches.id })
    .from(s.branches)
    .where(sql`${s.branches.tenantId} = ${TENANT_SLUG} AND ${s.branches.code} = ${BRANCH_CODE_TMG}`)
    .limit(1)
  if (secondBranch && secondBranch.id !== branchId) {
    await db
      .insert(s.userBranches)
      .values({
        tenantId: TENANT_SLUG,
        userId: ids.admin,
        branchId: secondBranch.id,
      })
      .onConflictDoNothing()
    console.log('  ✓ user_branches: TenantAdmin granted second branch (TMG)')
  }

  // ── One `Branch` kiosk login per branch ───────────────────────────────────
  // The clinic works from a shared, day-scoped session on each branch's own
  // machine, and each branch already has its own mailbox in the AppSheet export
  // (`Branch.b_BranchEmail`). Those are the login identities: a nurse at Alabang
  // signs the Alabang terminal in, sees the Alabang roster, and attests doses
  // against Alabang stock. Password is the shared seed password; the PIN that
  // actually names a person on a clinical record is per-nurse, below.
  if (branchIdByCode) {
    const branchRows = await db
      .select({ id: s.branches.id, code: s.branches.code, name: s.branches.name })
      .from(s.branches)
      .where(sql`${s.branches.tenantId} = ${TENANT_SLUG}`)

    // Sort by code so the positional display id is stable across re-runs.
    branchRows.sort((a, b) => a.code.localeCompare(b.code))

    let created = 0
    for (const [branchIdx, branch] of branchRows.entries()) {
      // HST already has `branch-main@surevax.com` from the fixture list above,
      // which several tests and the E2E auth setup log in as. Leave it alone.
      if (branch.id === branchId) continue

      const email = `surevax.${branch.code.toLowerCase()}@surevax.com`
      const inserted = await db
        .insert(s.users)
        .values({
          displayId: branchKioskDisplayId(branchIdx),
          tenantId: TENANT_SLUG,
          email,
          passwordHash,
          pinHash,
          firstName: branch.name.replace(/^SureVax | Branch$/g, ''),
          lastName: 'Branch Account',
          isActive: true,
          canLogin: true,
          primaryBranchId: branch.id,
          lastLoginAt: null,
        })
        .onConflictDoNothing()
        .returning({ id: s.users.id })

      let id = inserted[0]?.id
      if (id === undefined) {
        const [existing] = await db
          .select({ id: s.users.id })
          .from(s.users)
          .where(
            sql`${s.users.tenantId} = ${TENANT_SLUG} AND ${s.users.displayId} = ${branchKioskDisplayId(branchIdx)}`,
          )
          .limit(1)
        if (!existing) continue
        id = existing.id
      } else {
        created += 1
      }

      await db
        .insert(s.userRoles)
        .values({ tenantId: TENANT_SLUG, userId: id, role: 'Branch', branchId: branch.id })
        .onConflictDoNothing()
      await db
        .insert(s.userBranches)
        .values({ tenantId: TENANT_SLUG, userId: id, branchId: branch.id })
        .onConflictDoNothing()
    }
    console.log(`  ✓ branch kiosk logins (${created} new, 1 pre-existing for HST)`)
  }

  // ── The clinic's real nursing roster ─────────────────────────────────────
  // 103 people from `Nurse` in the AppSheet export, each attached to the
  // branches that sheet assigns them to. They exist so the administer
  // attestation picker and the clock-in kiosk show the actual people who work
  // at a branch, instead of three invented fixtures. See `roster.ts` for the
  // import decisions (canLogin, the missing licence numbers, the unassigned 20).
  if (branchIdByCode) {
    let seeded = 0
    for (const [index, member] of NURSE_ROSTER.entries()) {
      // Deterministic display id so reruns are stable and a nurse's `USR_…`
      // does not shuffle when the roster is re-imported. `R` prefix keeps them
      // clear of the `USR_AAAAAAA*` fixture block.
      const displayIdValue = `USR_R${String(index + 1).padStart(7, '0')}`
      const branchIds = member.branches
        .map((code) => branchIdByCode.get(code))
        .filter((id): id is number => id !== undefined)

      const inserted = await db
        .insert(s.users)
        .values({
          displayId: displayIdValue,
          tenantId: TENANT_SLUG,
          // Derived, not from the sheet: the export carries no staff emails.
          email: `${member.firstName.toLowerCase().replace(/[^a-z]/g, '')}.${member.lastName
            .toLowerCase()
            .replace(/[^a-z]/g, '')}@surevax.com`,
          passwordHash,
          pinHash,
          firstName: member.firstName,
          lastName: member.lastName,
          // No PRC number in the export. Left null rather than invented: a
          // fabricated licence on an immunization record is worse than none.
          licenseNumber: null,
          // Nobody assigned to a branch in the source is treated as former staff.
          isActive: branchIds.length > 0,
          // Shared-session clinic: nurses identify by kiosk PIN, not a password.
          canLogin: false,
          primaryBranchId: branchIds[0] ?? null,
          lastLoginAt: null,
        })
        .onConflictDoNothing()
        .returning({ id: s.users.id })

      let id = inserted[0]?.id
      if (id === undefined) {
        const [existing] = await db
          .select({ id: s.users.id })
          .from(s.users)
          .where(
            sql`${s.users.tenantId} = ${TENANT_SLUG} AND ${s.users.displayId} = ${displayIdValue}`,
          )
          .limit(1)
        if (!existing) continue
        id = existing.id
      } else {
        seeded += 1
      }

      // Tenant-wide role row (branch_id NULL), NOT pinned to branchIds[0].
      // `user_roles` PK is (user_id, role), so a nurse can only ever have ONE
      // Nurse row — pinning it to one branch made her invisible as a clinician
      // at every OTHER branch she actually works at, because the RESTRICTIVE
      // branch_isolation policy hides a role row scoped to a different branch.
      // The symptom was the administer step's "Given by" picker reading "No
      // nurses or physicians are assigned to this branch" at 5 of 14 branches
      // (ALB, CNT, PSG, STM, VRT) — so no dose could be recorded there at all.
      // Being a nurse is a tenant-wide qualification; WHERE she works is
      // already expressed by the user_branches rows written just below. See
      // the AUTH-3 note in .claude/rules/gotchas.md on NULL branch_id.
      await db
        .insert(s.userRoles)
        .values({
          tenantId: TENANT_SLUG,
          userId: id,
          role: 'Nurse',
          branchId: null,
        })
        .onConflictDoNothing()

      for (const bid of branchIds) {
        await db
          .insert(s.userBranches)
          .values({ tenantId: TENANT_SLUG, userId: id, branchId: bid })
          .onConflictDoNothing()
      }
    }
    console.log(`  ✓ nursing roster (${seeded} new of ${NURSE_ROSTER.length}) + branch assignments`)
  }

  return ids
}
