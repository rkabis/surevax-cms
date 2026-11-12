/**
 * Shared database client + Drizzle instance for the seed script.
 *
 * Lives in its own module so each section file (`seed/*.ts`) can import the
 * same singleton `db` and `client` rather than instantiating its own.
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as s from '../schema.js'

// INFRA-2: pin the seed pool to a single connection. The seed sets session-
// level GUCs (`set_config(..., false)`) outside any transaction, so a multi-
// connection pool could route a later write to a different connection where
// `app.current_tenant_id` is unset — tripping the audit trigger. max:1
// guarantees every seed statement shares the one connection that holds the GUCs.
//
// AUTH-2: prefer DATABASE_MIGRATOR_URL — the seed performs cross-tenant
// inserts and needs BYPASSRLS. Fall back to DATABASE_URL while a worktree is
// still pre-cutover so existing `pnpm db:seed` invocations keep working.
const seedUrl = process.env['DATABASE_MIGRATOR_URL'] ?? process.env['DATABASE_URL']
if (!seedUrl) {
  throw new Error('Neither DATABASE_MIGRATOR_URL nor DATABASE_URL is set for seed')
}
export const client = postgres(seedUrl, { max: 1 })
export const db = drizzle(client, { schema: s })

/**
 * Set the tenant GUC at session level so writes to audited tables
 * (users, branches, etc.) don't trip `audit_log_changes()`'s tenant guard.
 *
 * `app.current_tenant_id` is the tenant slug (text); RLS policies accept it
 * verbatim. `app.current_user_id` and `app.current_branch_id` need bigint
 * casts in RLS, so we keep them empty during the bootstrap window where the
 * first users / branches don't exist yet — individual seed sections override
 * once the IDs are known via `.returning()`.
 */
export async function setSeedTenantContext(tenantSlug: string) {
  await db.execute(sql`select set_config('app.current_tenant_id', ${tenantSlug}, false)`)
  await db.execute(sql`select set_config('app.current_user_id', '', false)`)
  await db.execute(sql`select set_config('app.current_branch_id', '', false)`)
  // INFRA-1: with the M12-inverted branch_isolation policy, an empty
  // `app.current_branch_id` no longer default-opens cross-branch INSERTs.
  // Seed inserts span branches (user_branches, services across branches)
  // and run as the BYPASSRLS migrator role today — but flag explicitly so
  // the seed would still work if accidentally run as a non-superuser.
  await db.execute(sql`select set_config('app.cross_branch_read', 'true', false)`)
}

/**
 * Override the session GUCs once the first admin user + default branch exist.
 * Lets later seed sections write rows whose `created_by_id` resolves to a real
 * bigint without re-opening transactions.
 */
export async function setSeedUserBranchContext(userId: number, branchId: number) {
  await db.execute(sql`select set_config('app.current_user_id', ${String(userId)}, false)`)
  await db.execute(sql`select set_config('app.current_branch_id', ${String(branchId)}, false)`)
}
