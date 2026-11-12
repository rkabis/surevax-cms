// SQL helper fragments for reading user role + branch from the junction tables
// (user_roles + user_branches / users.primary_branch_id). After Phase 4 drops
// the legacy `users.role` and `users.branch_id` columns, consumers that need a
// single "primary" value go through these helpers.

import { sql, type Column, type SQL } from 'drizzle-orm'

// Precedence used by `userPrimaryRoleSql` — highest privilege first.
// Mirror of auth/db.ts ROLE_PRECEDENCE; keep in sync.
// TenantAdmin is canonical; SuperAdmin kept for back-compat.
export const ROLE_PRECEDENCE = [
  'TenantAdmin',
  'SuperAdmin',
  'BranchAdmin',
  'Branch',
  'Physician',
  'Nurse',
  'Cashier',
] as const

/**
 * Inline SQL fragment that returns the highest-precedence role for a given
 * users row. Drop into a select projection:
 *
 *   .select({ role: userPrimaryRoleSql('users.id') })
 *
 * The fragment uses CASE-rank ordering to match ROLE_PRECEDENCE.
 */
export function userPrimaryRoleSql(userIdColumn: Column | SQL | string): SQL<string | null> {
  // Build a CASE expression that ranks each role; lowest rank wins.
  const userIdFragment = typeof userIdColumn === 'string' ? sql.raw(userIdColumn) : userIdColumn
  return sql<string | null>`(
    SELECT role::text FROM user_roles
    WHERE user_id = ${userIdFragment}
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY CASE role::text
      WHEN 'TenantAdmin' THEN 1
      WHEN 'SuperAdmin'  THEN 2
      WHEN 'BranchAdmin' THEN 3
      WHEN 'Branch'      THEN 4
      WHEN 'Physician'   THEN 5
      WHEN 'Nurse'       THEN 6
      WHEN 'Cashier'     THEN 7
      ELSE 99
    END
    LIMIT 1
  )`
}

/**
 * Inline SQL fragment that returns the user's primary branch ID — falls back
 * to users.primary_branch_id (the canonical column post-cutover).
 */
export function userPrimaryBranchIdSql(): SQL<string | null> {
  return sql<string | null>`users.primary_branch_id`
}
