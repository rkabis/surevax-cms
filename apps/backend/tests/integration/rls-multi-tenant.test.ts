/**
 * Integration tests for multi-tenant RLS isolation.
 *
 * Proves three guarantees enforced at the DB layer:
 *   1. RLS BLOCKS cross-tenant reads — a GUC set to tenant A cannot see tenant B rows.
 *   2. Audit trigger RAISES when app.current_tenant_id is unset on a tenant-scoped write.
 *   3. RLS WITH CHECK rejects INSERTs whose tenant_id differs from the active GUC.
 *
 * IMPORTANT — superuser bypass:
 *   PostgreSQL superusers bypass RLS even with FORCE ROW LEVEL SECURITY. The
 *   `surevax` connection role is a superuser. To exercise the USING policy we
 *   run read assertions via a non-superuser `rls_tester` role created in
 *   beforeAll and dropped in afterAll.
 *
 * Two-tier IDs (2026-05-19 ID redesign):
 *   - `tenants.id` is the slug text PK (e.g. `'SVX'`, `'TENRLS_<suffix>'`).
 *   - `branches.id` / `patients.id` are bigserial; display_id is `^PREFIX_<8 Crockford B32>$`.
 *   - All entity FKs are bigint. We capture `.returning({ id, displayId })`
 *     to thread bigints forward and surface display_ids for assertions.
 *
 * BEGIN/ROLLBACK isolation (H14):
 *   Each `it()` block that creates ephemeral test data is wrapped in
 *   `withRollback` so inserted rows are automatically discarded after the
 *   test completes. This eliminates the need for `Date.now()` suffixes on
 *   MRNs and display_ids inside individual test bodies.
 *
 *   The TENANT2 fixture (tenant row, branch, patient) is created in
 *   `beforeAll` via `withTenantTx` (Drizzle pool) and deleted in `afterAll`.
 *   Because `withTenantTx` opens its own pool connection, that data is
 *   OUTSIDE any `withRollback` transaction and must be cleaned up explicitly.
 *   `beforeAll` still uses a `Date.now()` suffix for TENANT2_ID and RLS_ROLE
 *   because those are DDL / persistent rows — not eligible for per-test rollback.
 *
 *   Tests 2 and 3 use `withRollback` with a raw postgres-js client so their
 *   ephemeral phantom/cross-tenant patient rows disappear on exit.
 *   Test 1 reads only (no INSERT inside the it() body) — no rollback needed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { sql, eq } from 'drizzle-orm'
import { db } from '../../src/shared/db/index.js'
import { withTenantTx } from '../../src/shared/db/withTenantTx.js'
import { tenants, branches, patients, users } from '../../src/shared/db/schema.js'
import { displayId } from '../../src/shared/utils/displayId.js'
import { withRollback } from '../setup/withRollback.js'

// ---------------------------------------------------------------------------
// IDs / role names — timestamped to avoid leftover-row collisions on TENANT2
// and the non-superuser Postgres role (both are persistent, not rolled back).
// Individual test bodies use withRollback instead of Date.now() suffixes.
// ---------------------------------------------------------------------------

const RUN_SEED = Date.now()
const TS_SUFFIX = RUN_SEED.toString(36).toUpperCase().slice(-6)

const TENANT1_ID = 'SVX' // seeded tenant slug
const TENANT2_ID = `TENRLS${TS_SUFFIX.toUpperCase()}` // e.g. TENRLSLJK3F2

// Branch display_ids: `<tenantSlug>.<3-letter-code>` (branches_display_id_format).
const BRANCH2_CODE = 'MAI'
const BRANCH2_DISPLAY_ID = `${TENANT2_ID}.${BRANCH2_CODE}`

// Non-superuser role used for read isolation tests. Name uses TS_SUFFIX to
// avoid clashing with leftover roles from prior runs.
const RLS_ROLE = `rls_tester_${TS_SUFFIX.toLowerCase()}`

// Raw postgres-js client for withRollback (tests 2 & 3).
// Uses the same DATABASE_URL as the app's Drizzle pool.
const pgClient = postgres(process.env['DATABASE_URL']!)

// Runtime-resolved bigints from beforeAll.
let adminUserId = 0
let branch2BigintId = 0
let patient2BigintId = 0
const patient2DisplayId = displayId('PAT')

// ---------------------------------------------------------------------------
// beforeAll — create the second tenant + a non-superuser role for RLS reads
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Resolve seeded SuperAdmin bigint by email.
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'admin@surevax.com'))
    .limit(1)
  if (!admin) throw new Error('seeded admin user not found')
  adminUserId = admin.id

  // Create a non-superuser role subject to RLS, with SELECT on patients so
  // it can run the read assertions.
  await db.execute(
    sql.raw(
      `CREATE ROLE ${RLS_ROLE} NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE LOGIN PASSWORD 'rls_test_only'`,
    ),
  )
  await db.execute(sql.raw(`GRANT SELECT ON patients TO ${RLS_ROLE}`))

  // Insert tenant row — tenants table has no RLS.
  await db.insert(tenants).values({
    id: TENANT2_ID,
    name: 'RLS Test Tenant',
    slug: `rls-test-${TS_SUFFIX.toLowerCase()}`,
    timezone: 'Asia/Manila',
    countryCode: 'PH',
  })

  // Insert branch under TENANT2 — branches IS tenant-scoped, .returning() to
  // capture the bigint id for downstream patient FK.
  await withTenantTx({ tenantId: TENANT2_ID, userId: adminUserId, branchId: null }, async (tx) => {
    const rows = await tx
      .insert(branches)
      .values({
        displayId: BRANCH2_DISPLAY_ID,
        tenantId: TENANT2_ID,
        code: BRANCH2_CODE,
        name: 'Main Branch',
      })
      .returning({ id: branches.id })
    const row = rows[0]
    if (!row) throw new Error('branch insert returned no row')
    branch2BigintId = row.id
  })

  // Insert a patient under TENANT2.
  await withTenantTx(
    { tenantId: TENANT2_ID, userId: adminUserId, branchId: branch2BigintId },
    async (tx) => {
      const rows = await tx
        .insert(patients)
        .values({
          displayId: patient2DisplayId,
          tenantId: TENANT2_ID,
          homeBranchId: branch2BigintId,
          mrn: `MRN-RLS-${TS_SUFFIX}`,
          firstName: 'RLS',
          lastName: 'TestPatient',
        })
        .returning({ id: patients.id })
      const row = rows[0]
      if (!row) throw new Error('patient insert returned no row')
      patient2BigintId = row.id
    },
  )
})

// ---------------------------------------------------------------------------
// afterAll — delete test rows + role in FK-safe reverse order
// ---------------------------------------------------------------------------

afterAll(async () => {
  await pgClient.end()

  await withTenantTx(
    { tenantId: TENANT2_ID, userId: adminUserId, branchId: branch2BigintId },
    async (tx) => {
      await tx.delete(patients).where(eq(patients.tenantId, TENANT2_ID))
      await tx.delete(branches).where(eq(branches.tenantId, TENANT2_ID))
    },
  )
  await db.delete(tenants).where(eq(tenants.id, TENANT2_ID))
  await db.execute(sql.raw(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${RLS_ROLE}`))
  await db.execute(sql.raw(`DROP ROLE IF EXISTS ${RLS_ROLE}`))
})

// ---------------------------------------------------------------------------
// Test 1 — RLS BLOCKS cross-tenant reads
// (read-only assertions — no INSERT inside the test body; no withRollback needed)
// ---------------------------------------------------------------------------

describe('RLS isolation: cross-tenant reads are blocked', () => {
  it('tenant A GUC cannot see tenant B rows, and vice-versa', async () => {
    // Read as rls_tester with TENANT1 GUC — TENANT2 patient must NOT appear.
    const rowsAsPrimary = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_tenant_id', ${TENANT1_ID}, true)`)
      await tx.execute(sql`select set_config('app.current_user_id', ${String(adminUserId)}, true)`)
      await tx.execute(sql`select set_config('app.current_branch_id', '', true)`)
      await tx.execute(sql.raw(`SET LOCAL ROLE ${RLS_ROLE}`))
      return tx
        .select({ id: patients.id, tenantId: patients.tenantId })
        .from(patients)
        .where(eq(patients.id, patient2BigintId))
    })

    expect(rowsAsPrimary).toHaveLength(0)

    // Read as rls_tester with TENANT2 GUC — TENANT2 patient MUST appear; TENANT1 must NOT.
    const rowsAsTest = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_tenant_id', ${TENANT2_ID}, true)`)
      await tx.execute(sql`select set_config('app.current_user_id', ${String(adminUserId)}, true)`)
      await tx.execute(
        sql`select set_config('app.current_branch_id', ${String(branch2BigintId)}, true)`,
      )
      await tx.execute(sql.raw(`SET LOCAL ROLE ${RLS_ROLE}`))
      return tx.select({ id: patients.id, tenantId: patients.tenantId }).from(patients)
    })

    const t2PatientIds = rowsAsTest.map((r) => r.id)
    expect(t2PatientIds).toContain(patient2BigintId)

    const leakedTenant1Rows = rowsAsTest.filter((r) => r.tenantId === TENANT1_ID)
    expect(leakedTenant1Rows).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Test 2 — Audit trigger RAISES when app.current_tenant_id is unset
//
// Uses withRollback so the phantom patient row (if any) is always cleaned up,
// even if the test framework reorders execution or the audit trigger is
// temporarily disabled. The deterministic displayId avoids Date.now() suffix.
// ---------------------------------------------------------------------------

describe('Audit trigger: raises when app.current_tenant_id is unset', () => {
  it('INSERT into patients without GUC throws a PostgresError', async () => {
    // Fixed display_id: this test always rolls back so no collision risk.
    const phantomDisplayId = 'PAT_PHANTOM00'

    // The INSERT should throw (audit trigger raises). withRollback ensures the
    // row is gone regardless — whether the trigger fired or not.
    await withRollback(pgClient, async (sql) => {
      // Deliberately do NOT set app.current_tenant_id — audit trigger must RAISE.
      await expect(
        sql`INSERT INTO patients (display_id, tenant_id, mrn, first_name, last_name)
            VALUES (${phantomDisplayId}, ${TENANT1_ID}, 'MRN-PHANTOM-H14', 'Phantom', 'ShouldNotExist')`,
      ).rejects.toThrow()
    })

    // Confirm no row landed (use a proper tenant tx for the check).
    const check = await withTenantTx(
      { tenantId: TENANT1_ID, userId: adminUserId, branchId: null },
      async (tx) =>
        tx
          .select({ id: patients.id })
          .from(patients)
          .where(eq(patients.displayId, phantomDisplayId)),
    )
    expect(check).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Test 3 — RLS WITH CHECK rejects cross-tenant INSERTs
//
// Uses withRollback so the cross-tenant patient row is always cleaned up.
// Fixed display_id instead of Date.now() suffix — rollback guarantees no
// collision between runs.
// ---------------------------------------------------------------------------

describe('RLS WITH CHECK: cross-tenant INSERT is rejected', () => {
  it('INSERT with mismatched tenant_id is rejected by RLS policy', async () => {
    // Fixed display_id: this test always rolls back so no collision risk.
    const crossDisplayId = 'PAT_CROSSTEN0'

    await db.execute(sql.raw(`GRANT INSERT ON patients TO ${RLS_ROLE}`))

    await withRollback(pgClient, async (sql) => {
      // GUC says TENANT1 but row claims TENANT2 — WITH CHECK must block.
      await expect(
        sql`
          SELECT set_config('app.current_tenant_id', ${TENANT1_ID}, true),
                 set_config('app.current_user_id', ${String(adminUserId)}, true),
                 set_config('app.current_branch_id', '', true)
        `,
      ).resolves.toBeDefined()

      await expect(
        // SET LOCAL ROLE inside a raw sql`` tag
        sql`SET LOCAL ROLE ${sql(RLS_ROLE)}`,
      ).resolves.toBeDefined()

      await expect(
        sql`INSERT INTO patients (display_id, tenant_id, mrn, first_name, last_name)
            VALUES (${crossDisplayId}, ${TENANT2_ID}, 'MRN-CROSS-H14', 'Cross', 'TenantAttempt')`,
      ).rejects.toThrow()
    })

    // Confirm the row never landed in either tenant.
    const checkT1 = await withTenantTx(
      { tenantId: TENANT1_ID, userId: adminUserId, branchId: null },
      async (tx) =>
        tx.select({ id: patients.id }).from(patients).where(eq(patients.displayId, crossDisplayId)),
    )
    expect(checkT1).toHaveLength(0)

    const checkT2 = await withTenantTx(
      { tenantId: TENANT2_ID, userId: adminUserId, branchId: branch2BigintId },
      async (tx) =>
        tx.select({ id: patients.id }).from(patients).where(eq(patients.displayId, crossDisplayId)),
    )
    expect(checkT2).toHaveLength(0)
  })
})
