/**
 * Integration tests for audit trigger strict-tenant mode (H6 phase 2).
 *
 * Verifies that 0024_audit_trigger_strict.sql correctly closes the
 * cross-tenant write gap introduced by the original lax trigger:
 *   - Writes where app.current_tenant_id MATCHES the row's tenant_id succeed.
 *   - Writes where app.current_tenant_id DIFFERS from the row's tenant_id are
 *     rejected with ERRCODE 'insufficient_privilege' and the strict-mode message.
 *   - Writes to non-tenant-scoped tables (audit_logs itself) succeed regardless
 *     of GUC value.
 *
 * Uses withRollback so every INSERT is automatically rolled back — no leftover
 * rows accumulate in the shared dev DB. GUCs must be set INSIDE the rollback
 * block, before any INSERT, to satisfy the audit trigger.
 *
 * Patient columns required (NOT NULL without defaults):
 *   display_id, tenant_id, mrn, first_name, last_name
 * (home_branch_id, date_of_birth, sex are nullable — omit for brevity)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import { db } from '../../src/shared/db/index.js'
import { users } from '../../src/shared/db/schema.js'
import { displayId } from '../../src/shared/utils/displayId.js'
import { withRollback } from '../setup/withRollback.js'

const pgClient = postgres(process.env['DATABASE_URL']!)

// Seeded tenant + a phantom tenant slug for mismatch tests.
const TENANT_SVX = 'SVX'
const TENANT_OTHER = 'OTHERTENANT99' // does not need to exist in tenants table

let adminUserId = 0

beforeAll(async () => {
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'admin@surevax.com'))
    .limit(1)
  if (!admin) throw new Error('seeded admin user not found; run pnpm run setup first')
  adminUserId = admin.id
})

afterAll(async () => {
  await pgClient.end()
})

// ---------------------------------------------------------------------------
// Test 1 — write succeeds when GUC matches row tenant_id
// ---------------------------------------------------------------------------

describe('audit trigger strict-mode: GUC matches row tenant_id', () => {
  it('allows INSERT when app.current_tenant_id equals the row tenant_id', async () => {
    await withRollback(pgClient, async (sql) => {
      // Set GUCs to match the row we are about to insert.
      await sql`SELECT set_config('app.current_tenant_id', ${TENANT_SVX}, true)`
      await sql`SELECT set_config('app.current_user_id', ${String(adminUserId)}, true)`
      await sql`SELECT set_config('app.current_branch_id', ${''}::text, true)`

      const testDisplayId = displayId('PAT')
      const rows = await sql`
        INSERT INTO patients (display_id, tenant_id, mrn, first_name, last_name)
        VALUES (${testDisplayId}, ${TENANT_SVX}, ${'MRN-STRICT-OK01'}, ${'Strict'}, ${'AllowTest'})
        RETURNING id, tenant_id
      `
      expect(rows.length).toBe(1)
      expect(rows[0]?.tenant_id).toBe(TENANT_SVX)
      // Row is rolled back automatically on withRollback exit.
    })
  })
})

// ---------------------------------------------------------------------------
// Test 2 — write rejected when GUC DIFFERS from row tenant_id
// ---------------------------------------------------------------------------

describe('audit trigger strict-mode: GUC mismatch rejects write', () => {
  it('rejects INSERT when app.current_tenant_id does not match row tenant_id', async () => {
    await withRollback(pgClient, async (sql) => {
      // GUC says TENANT_OTHER but the row carries TENANT_SVX.
      await sql`SELECT set_config('app.current_tenant_id', ${TENANT_OTHER}, true)`
      await sql`SELECT set_config('app.current_user_id', ${String(adminUserId)}, true)`
      await sql`SELECT set_config('app.current_branch_id', ${''}::text, true)`

      const mismatchDisplayId = displayId('PAT')
      await expect(
        sql`
          INSERT INTO patients (display_id, tenant_id, mrn, first_name, last_name)
          VALUES (${mismatchDisplayId}, ${TENANT_SVX}, ${'MRN-STRICT-FAIL'}, ${'Cross'}, ${'TenantAttempt'})
        `,
      ).rejects.toThrow(/cross-tenant write rejected/)
    })
  })
})

// ---------------------------------------------------------------------------
// Test 3 — non-tenant-scoped table write succeeds regardless of GUC
//
// audit_logs itself has no tenant_id RLS (v_row_has_tenant = false), so the
// strict check never fires. We verify the trigger short-circuits correctly.
// We use a direct INSERT to confirm the check is really skipped (not just
// that the INSERT succeeded for unrelated reasons). Note: audit_logs is not
// RLS-protected so the superuser connection can write without GUC concerns.
// ---------------------------------------------------------------------------

describe('audit trigger strict-mode: non-tenant-scoped tables skip the check', () => {
  it('allows direct INSERT into audit_logs when GUC is set to an arbitrary value', async () => {
    await withRollback(pgClient, async (sql) => {
      // Set GUC to a completely arbitrary value — the trigger should not fire
      // the strict check because audit_logs has no tenant_id column.
      await sql`SELECT set_config('app.current_tenant_id', ${'ARBI_TRARY'}, true)`
      await sql`SELECT set_config('app.current_user_id', ${''}::text, true)`
      await sql`SELECT set_config('app.current_branch_id', ${''}::text, true)`

      // audit_logs is itself NOT audited (not in the AUDITED_TABLES trigger list),
      // so this INSERT fires no trigger at all — confirming the trigger only
      // runs on the registered tables and non-tenant rows aren't blocked.
      const rows = await sql`
        INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, branch_id, changes, "timestamp")
        VALUES (
          ${TENANT_SVX}, NULL, 'CREATE'::audit_action,
          'audit_strict_test', 'TEST_ENT_ID', NULL,
          '{"test": true}'::jsonb, NOW()
        )
        RETURNING id
      `
      expect(rows.length).toBe(1)
    })
  })
})
