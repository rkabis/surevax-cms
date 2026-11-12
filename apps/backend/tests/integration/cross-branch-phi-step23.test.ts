/**
 * Integration tests for Cross-Branch PHI RFC Steps 2 + 3 + 7 (RLS enforcement).
 *
 * Step 2: patients_demographic_v — Tier-1 safe cross-branch projection.
 * Step 3: cross_branch_access_grants — break-glass audit table with D1
 *         persistent-grant model (unique per tenant+branch+patient).
 * Step 7: branch_isolation RLS policy — the M12 default-closed flip + the 7a
 *         WITH-CHECK tightening (writes are NEVER cross-branch).
 *
 * Tests:
 *   1. View returns allergies + active conditions populated for a patient.
 *   2. View correctly reflects dpa_consent_active flag.
 *   3. Tenant isolation: patient from tenant A is not visible as tenant B.
 *   4. Grants UNIQUE constraint: second INSERT with same
 *      (tenant_id, target_branch_id, patient_id) fails with unique violation.
 *
 *   RFC §6.5 RLS enforcement scenarios (Step 7b) — run under a REAL
 *   non-superuser `rls_tester` role so FORCE ROW LEVEL SECURITY actually
 *   applies (the superuser `surevax` connection bypasses RLS, see the
 *   tenant-isolation note at the patients_demographic_v block below):
 *     Scenario 1 — default branch-scoped read isolation (Branch-A session
 *                  cannot see Branch-B encounters).
 *     Scenario 2 — cross_branch_read='true' reveals Branch-B encounters
 *                  tenant-wide-within-tenant.
 *     Scenario 3 — WRITE-NEVER-CROSS-BRANCH: with cross_branch_read='true'
 *                  AND current_branch_id=Branch-A, INSERTing a Branch-B
 *                  encounter is REJECTED by WITH CHECK (the 7a guardrail).
 *     Scenario 4 — break-glass emits exactly one grant row on first access
 *                  (zero on the second) + one CROSS_BRANCH_ACCESS audit row
 *                  per access, both carrying the same correlation_id.
 *
 * Uses withRollback for all test-local inserts so the DB returns to seed
 * state automatically. beforeAll resolves live IDs from the seeded fixture.
 *
 * H14 note: withRollback uses raw postgres-js, not the Drizzle pool. GUCs
 * must be SET explicitly before any audited write.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import { db } from '../../src/shared/db/index.js'
import { withTenantTx } from '../../src/shared/db/withTenantTx.js'
import {
  branches,
  users,
  patients,
  encounters,
  crossBranchAccessGrants,
} from '../../src/shared/db/schema.js'
import { displayId } from '../../src/shared/utils/displayId.js'
import { withRollback } from '../setup/withRollback.js'
import { eq, and } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TENANT_ID = 'SVX' // seeded tenant slug
const RUN = Date.now().toString(36).toUpperCase().slice(-6)

// Raw postgres-js client for withRollback (bypasses Drizzle pool).
const pgClient = postgres(process.env['DATABASE_URL']!)

// Non-superuser Postgres role used by the Step 7b RLS enforcement scenarios.
// PostgreSQL superusers (and BYPASSRLS roles) ignore RLS even under FORCE ROW
// LEVEL SECURITY — the `surevax` connection is a superuser, so it cannot prove
// the policy. `SET LOCAL ROLE` to this role inside a transaction makes RLS
// actually apply. Name uses RUN to avoid clashing with leftover roles.
const RLS_ROLE = `rls_tester_${RUN.toLowerCase()}`

// IDs resolved from seed in beforeAll.
let adminUserId = 0
let branchBigintId = 0
let branch2BigintId = 0 // a second branch for cross-branch isolation tests

// Persistent encounter fixture for the Step 7b scenarios: one PHI row (encounters
// has branch_id NOT NULL) at each branch, sharing one patient.
// (let — reassigned at the top level of beforeAll below.)
let phiPatientId = 0
let encBranchAId = 0 // encounter at branchBigintId (Branch-A)
let encBranchBId = 0 // encounter at branch2BigintId (Branch-B)

// ---------------------------------------------------------------------------
// beforeAll — resolve seeded fixture IDs
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Resolve admin user (users table has no deleted_at column)
  const [adminRow] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, TENANT_ID), eq(users.email, 'admin@surevax.com')))
    .limit(1)
  if (!adminRow) throw new Error('Seed admin user not found; run pnpm run setup first')
  adminUserId = adminRow.id

  // Resolve first seeded branch (branches table has no deleted_at column)
  const [branchRow] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.tenantId, TENANT_ID), eq(branches.isActive, true)))
    .orderBy(branches.id)
    .limit(1)
  if (!branchRow) throw new Error('No seeded branch found')
  branchBigintId = branchRow.id

  // Create a second branch for cross-branch isolation tests (persistent for this run).
  // Branch code must match '^[A-Z]{3}$' (branches_code_format CHECK constraint).
  // Use last 3 chars of RUN (alphanumeric) uppercased, padded if needed.
  const rawSuffix = RUN.slice(-3)
    .toUpperCase()
    .replace(/[^A-Z]/g, 'X')
  const b2Code = rawSuffix.padEnd(3, 'X').slice(0, 3) // e.g. 'XBT'
  const b2DisplayId = `${TENANT_ID}.${b2Code}`
  const [existingB2] = await db
    .select({ id: branches.id, displayId: branches.displayId })
    .from(branches)
    .where(and(eq(branches.tenantId, TENANT_ID), eq(branches.displayId, b2DisplayId)))
    .limit(1)

  if (existingB2) {
    branch2BigintId = existingB2.id
  } else {
    const inserted = await withTenantTx(
      { tenantId: TENANT_ID, userId: adminUserId, branchId: null },
      async (tx) => {
        return tx
          .insert(branches)
          .values({
            tenantId: TENANT_ID,
            displayId: b2DisplayId,
            name: `Test Branch ${RUN}`,
            code: b2Code,
          })
          .returning({ id: branches.id })
      },
    )
    branch2BigintId = inserted[0]!.id
  }

  // ── Step 7b fixture: non-superuser role + a PHI encounter at each branch ──
  // Create a NOSUPERUSER role so FORCE ROW LEVEL SECURITY actually applies.
  // Grant exactly the privileges the scenarios touch (SELECT on the FK parents,
  // SELECT/INSERT/UPDATE on encounters). NOINHERIT so it never silently picks
  // up the superuser owner's BYPASSRLS.
  await db.execute(
    sql.raw(
      `CREATE ROLE ${RLS_ROLE} NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE LOGIN PASSWORD 'rls_test_only'`,
    ),
  )
  await db.execute(sql.raw(`GRANT SELECT ON patients TO ${RLS_ROLE}`))
  await db.execute(sql.raw(`GRANT SELECT ON branches TO ${RLS_ROLE}`))
  await db.execute(sql.raw(`GRANT SELECT, INSERT, UPDATE ON encounters TO ${RLS_ROLE}`))
  // encounters.id is bigserial — the role needs USAGE on its sequence to INSERT.
  await db.execute(sql.raw(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${RLS_ROLE}`))

  // Create the shared patient + one encounter per branch (as the superuser
  // Drizzle pool — RLS does not impede the fixture; the scenarios re-read it
  // under the rls_tester role). These are persistent for the run and cleaned
  // up in afterAll (encounters are audited but NOT subject to the immutability
  // trigger until Completed, so the afterAll DELETE works).
  // Note: assign module-level fixture ids at the TOP LEVEL of beforeAll (not
  // inside the callbacks) so `eslint --fix prefer-const` doesn't flip the
  // `let` declarations to `const` — it only treats a top-level reassignment as
  // preventing const (mirrors the branch2BigintId pattern above).
  const fixtureA = await withTenantTx(
    { tenantId: TENANT_ID, userId: adminUserId, branchId: branchBigintId },
    async (tx) => {
      const [pat] = await tx
        .insert(patients)
        .values({
          tenantId: TENANT_ID,
          displayId: displayId('PAT'),
          homeBranchId: branchBigintId,
          mrn: `MRN-S7B-${RUN}`,
          firstName: 'Step7b',
          lastName: 'PhiFixture',
        })
        .returning({ id: patients.id })
      const patientId = pat!.id

      const [encA] = await tx
        .insert(encounters)
        .values({
          tenantId: TENANT_ID,
          displayId: displayId('ENC'),
          patientId,
          branchId: branchBigintId,
          specialty: 'General',
          status: 'Open',
          chiefComplaint: 'Step7b Branch-A encounter',
        })
        .returning({ id: encounters.id })
      return { patientId, encounterId: encA!.id }
    },
  )
  phiPatientId = fixtureA.patientId
  encBranchAId = fixtureA.encounterId

  // Branch-B encounter — created in a tx scoped to Branch-B (legitimate: a
  // clinician clocked in at Branch-B). This is the row the cross-branch
  // scenarios reveal.
  const fixtureB = await withTenantTx(
    { tenantId: TENANT_ID, userId: adminUserId, branchId: branch2BigintId },
    async (tx) => {
      const [encB] = await tx
        .insert(encounters)
        .values({
          tenantId: TENANT_ID,
          displayId: displayId('ENC'),
          patientId: phiPatientId,
          branchId: branch2BigintId,
          specialty: 'General',
          status: 'Open',
          chiefComplaint: 'Step7b Branch-B encounter',
        })
        .returning({ id: encounters.id })
      return encB!.id
    },
  )
  encBranchBId = fixtureB
})

afterAll(async () => {
  // Clean up the Step 7b PHI fixture (encounters → patient) in FK-safe order,
  // plus any grants the scenarios created, then mark the test branch inactive.
  if (branch2BigintId) {
    await withTenantTx({ tenantId: TENANT_ID, userId: adminUserId, branchId: null }, async (tx) => {
      if (phiPatientId) {
        await tx
          .delete(encounters)
          .where(and(eq(encounters.tenantId, TENANT_ID), eq(encounters.patientId, phiPatientId)))
        await tx
          .delete(patients)
          .where(and(eq(patients.tenantId, TENANT_ID), eq(patients.id, phiPatientId)))
      }
      await tx
        .delete(crossBranchAccessGrants)
        .where(
          and(
            eq(crossBranchAccessGrants.tenantId, TENANT_ID),
            eq(crossBranchAccessGrants.targetBranchId, branch2BigintId),
          ),
        )
      // branches has no deleted_at column — mark inactive instead
      await tx
        .update(branches)
        .set({ isActive: false })
        .where(and(eq(branches.tenantId, TENANT_ID), eq(branches.id, branch2BigintId)))
    })
  }

  // Drop the non-superuser RLS role (revoke grants first — Postgres refuses to
  // DROP a role that still owns privileges).
  await db.execute(sql.raw(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${RLS_ROLE}`))
  await db.execute(
    sql.raw(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${RLS_ROLE}`),
  )
  await db.execute(sql.raw(`DROP ROLE IF EXISTS ${RLS_ROLE}`))

  await pgClient.end()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a unique MRN for test patients (rolled back by withRollback). */
function testMrn() {
  return `MRN-TST${Date.now().toString(36).toUpperCase().slice(-5)}`
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('patients_demographic_v — Tier-1 safe projection', () => {
  it('returns allergies and active_conditions populated for a seeded patient', async () => {
    await withRollback(pgClient, async (sql) => {
      // Set RLS GUCs before any audited write
      await sql`SELECT set_config('app.current_tenant_id', ${TENANT_ID}, true)`
      await sql`SELECT set_config('app.current_user_id', ${String(adminUserId)}, true)`
      await sql`SELECT set_config('app.current_branch_id', '', true)`

      // Insert a test patient
      const patDisplayId = displayId('PAT')
      const mrn = testMrn()
      const [patRow] = await sql`
        INSERT INTO patients (tenant_id, display_id, mrn, first_name, last_name)
        VALUES (${TENANT_ID}, ${patDisplayId}, ${mrn}, 'Test', 'Patient')
        RETURNING id
      `
      const patId = (patRow as { id: number }).id

      // Insert one allergy
      await sql`
        INSERT INTO patient_allergies (tenant_id, patient_id, allergen, severity, reaction, source)
        VALUES (${TENANT_ID}, ${patId}, 'Penicillin', 'Severe', 'Hives', 'PatientReported')
      `

      // Insert one active condition
      await sql`
        INSERT INTO patient_conditions (tenant_id, patient_id, condition_name, icd10_code, status)
        VALUES (${TENANT_ID}, ${patId}, 'Hypertension', 'I10', 'Active')
      `

      // Query the view
      const rows = await sql`
        SELECT
          display_id   AS "displayId",
          allergies,
          active_conditions AS "activeConditions",
          dpa_consent_active AS "dpaConsentActive"
        FROM patients_demographic_v
        WHERE tenant_id = ${TENANT_ID}
          AND display_id = ${patDisplayId}
      `
      expect(rows.length).toBe(1)
      const row = rows[0] as {
        displayId: string
        allergies: Array<{ allergen: string; severity: string; reaction: string }>
        activeConditions: Array<{ icd10: string; name: string; status: string }>
        dpaConsentActive: boolean
      }

      expect(row.displayId).toBe(patDisplayId)

      // Allergies
      expect(Array.isArray(row.allergies)).toBe(true)
      expect(row.allergies.length).toBe(1)
      expect(row.allergies[0]!.allergen).toBe('Penicillin')
      expect(row.allergies[0]!.severity).toBe('Severe')

      // Active conditions
      expect(Array.isArray(row.activeConditions)).toBe(true)
      expect(row.activeConditions.length).toBe(1)
      expect(row.activeConditions[0]!.name).toBe('Hypertension')
      expect(row.activeConditions[0]!.icd10).toBe('I10')
      expect(row.activeConditions[0]!.status).toBe('Active')

      // No DPA consent yet
      expect(row.dpaConsentActive).toBe(false)
    })
  })

  it('reflects dpa_consent_active = true when an active consent row exists', async () => {
    await withRollback(pgClient, async (sql) => {
      await sql`SELECT set_config('app.current_tenant_id', ${TENANT_ID}, true)`
      await sql`SELECT set_config('app.current_user_id', ${String(adminUserId)}, true)`
      await sql`SELECT set_config('app.current_branch_id', '', true)`

      const patDisplayId = displayId('PAT')
      const mrn = testMrn()
      const [patRow] = await sql`
        INSERT INTO patients (tenant_id, display_id, mrn, first_name, last_name)
        VALUES (${TENANT_ID}, ${patDisplayId}, ${mrn}, 'Consent', 'TestPat')
        RETURNING id
      `
      const patId = (patRow as { id: number }).id

      // Insert a DPA consent row
      const cnsDisplayId = displayId('CNS')
      await sql`
        INSERT INTO consents (
          tenant_id, display_id, patient_id, consent_type, scope,
          consenter_relation, obtained_at
        )
        VALUES (
          ${TENANT_ID}, ${cnsDisplayId}, ${patId},
          'DPA_DATA_PROCESSING', 'tenant',
          'Patient', now()
        )
      `

      const rows = await sql`
        SELECT dpa_consent_active AS "dpaConsentActive"
        FROM patients_demographic_v
        WHERE tenant_id = ${TENANT_ID} AND display_id = ${patDisplayId}
      `
      expect(rows.length).toBe(1)
      expect((rows[0] as { dpaConsentActive: boolean }).dpaConsentActive).toBe(true)
    })
  })

  it('resolves active_conditions to empty array when a condition is deleted', async () => {
    await withRollback(pgClient, async (sql) => {
      await sql`SELECT set_config('app.current_tenant_id', ${TENANT_ID}, true)`
      await sql`SELECT set_config('app.current_user_id', ${String(adminUserId)}, true)`
      await sql`SELECT set_config('app.current_branch_id', '', true)`

      const patDisplayId = displayId('PAT')
      const mrn = testMrn()
      const [patRow] = await sql`
        INSERT INTO patients (tenant_id, display_id, mrn, first_name, last_name)
        VALUES (${TENANT_ID}, ${patDisplayId}, ${mrn}, 'Deleted', 'Cond')
        RETURNING id
      `
      const patId = (patRow as { id: number }).id

      // Insert condition then soft-delete it
      const [condRow] = await sql`
        INSERT INTO patient_conditions (tenant_id, patient_id, condition_name, status)
        VALUES (${TENANT_ID}, ${patId}, 'Old Condition', 'Active')
        RETURNING id
      `
      await sql`
        UPDATE patient_conditions SET deleted_at = now() WHERE id = ${(condRow as { id: number }).id}
      `

      const rows = await sql`
        SELECT active_conditions AS "activeConditions"
        FROM patients_demographic_v
        WHERE tenant_id = ${TENANT_ID} AND display_id = ${patDisplayId}
      `
      expect(rows.length).toBe(1)
      const activeConditions = (rows[0] as { activeConditions: unknown[] }).activeConditions
      // Deleted condition should not appear; view returns '[]'::json
      expect(activeConditions).toEqual([])
    })
  })
})

describe('patients_demographic_v — tenant isolation', () => {
  it('view includes tenant_id column and only returns rows matching the scoped tenant_id', async () => {
    // NOTE: The raw pgClient connects as the `surevax` superuser, which bypasses RLS
    // even with FORCE ROW LEVEL SECURITY. For true RLS enforcement testing against
    // a non-superuser role, see rls-multi-tenant.test.ts which creates a dedicated
    // rls_tester role. Here we verify the structural guarantee: the view exposes
    // a tenant_id column so that the upstream RLS policy on `patients` can propagate,
    // and a WHERE tenant_id filter returns exactly the right rows.
    await withRollback(pgClient, async (sql) => {
      await sql`SELECT set_config('app.current_tenant_id', ${TENANT_ID}, true)`
      await sql`SELECT set_config('app.current_user_id', ${String(adminUserId)}, true)`
      await sql`SELECT set_config('app.current_branch_id', '', true)`

      const patDisplayId = displayId('PAT')
      const mrn = testMrn()
      await sql`
        INSERT INTO patients (tenant_id, display_id, mrn, first_name, last_name)
        VALUES (${TENANT_ID}, ${patDisplayId}, ${mrn}, 'Tenant', 'IsolTest')
      `

      // Querying with the correct tenant_id returns the row
      const rows = await sql`
        SELECT display_id AS "displayId", tenant_id AS "tenantId"
        FROM patients_demographic_v
        WHERE tenant_id = ${TENANT_ID} AND display_id = ${patDisplayId}
      `
      expect(rows.length).toBe(1)
      expect((rows[0] as { tenantId: string }).tenantId).toBe(TENANT_ID)

      // Querying with a different tenant_id returns nothing (WHERE clause filter)
      const otherRows = await sql`
        SELECT display_id FROM patients_demographic_v
        WHERE tenant_id = 'PHANTOM_TENANT' AND display_id = ${patDisplayId}
      `
      expect(otherRows.length).toBe(0)
    })
  })
})

describe('cross_branch_access_grants — D1 persistent-grant UNIQUE constraint', () => {
  it('allows inserting a grant row', async () => {
    await withRollback(pgClient, async (sql) => {
      await sql`SELECT set_config('app.current_tenant_id', ${TENANT_ID}, true)`
      await sql`SELECT set_config('app.current_user_id', ${String(adminUserId)}, true)`
      await sql`SELECT set_config('app.current_branch_id', '', true)`

      // Create a test patient for the grant
      const patDisplayId = displayId('PAT')
      const mrn = testMrn()
      const [patRow] = await sql`
        INSERT INTO patients (tenant_id, display_id, mrn, first_name, last_name)
        VALUES (${TENANT_ID}, ${patDisplayId}, ${mrn}, 'Grant', 'TestPat')
        RETURNING id
      `
      const patId = (patRow as { id: number }).id

      const grantDisplayId = displayId('CBA')
      const [grantRow] = await sql`
        INSERT INTO cross_branch_access_grants (
          tenant_id, display_id, user_id,
          source_branch_id, target_branch_id, patient_id,
          reason_category, reason_detail
        )
        VALUES (
          ${TENANT_ID}, ${grantDisplayId}, ${adminUserId},
          ${branchBigintId}, ${branch2BigintId}, ${patId},
          'Continuity_of_care', 'Patient continuing PEP series from another branch'
        )
        RETURNING id, display_id AS "displayId"
      `
      // postgres-js returns bigserial as string without the OID-20 coerce
      // configured in the app's db/index.ts — parse explicitly.
      const insertedRow = grantRow as { id: string | number; displayId: string }
      expect(Number(insertedRow.id)).toBeGreaterThan(0)
      expect(insertedRow.displayId).toBe(grantDisplayId)
    })
  })

  it('rejects a second INSERT with same (tenant_id, target_branch_id, patient_id) — unique violation', async () => {
    await withRollback(pgClient, async (sql) => {
      await sql`SELECT set_config('app.current_tenant_id', ${TENANT_ID}, true)`
      await sql`SELECT set_config('app.current_user_id', ${String(adminUserId)}, true)`
      await sql`SELECT set_config('app.current_branch_id', '', true)`

      // Create a test patient
      const patDisplayId = displayId('PAT')
      const mrn = testMrn()
      const [patRow] = await sql`
        INSERT INTO patients (tenant_id, display_id, mrn, first_name, last_name)
        VALUES (${TENANT_ID}, ${patDisplayId}, ${mrn}, 'Dup', 'Grant')
        RETURNING id
      `
      const patId = (patRow as { id: number }).id

      // First insert — should succeed
      await sql`
        INSERT INTO cross_branch_access_grants (
          tenant_id, display_id, user_id,
          source_branch_id, target_branch_id, patient_id,
          reason_category, reason_detail
        )
        VALUES (
          ${TENANT_ID}, ${displayId('CBA')}, ${adminUserId},
          ${branchBigintId}, ${branch2BigintId}, ${patId},
          'Emergency', 'First grant'
        )
      `

      // Second insert with same (tenant_id, target_branch_id, patient_id) — must fail
      await expect(
        sql`
          INSERT INTO cross_branch_access_grants (
            tenant_id, display_id, user_id,
            source_branch_id, target_branch_id, patient_id,
            reason_category, reason_detail
          )
          VALUES (
            ${TENANT_ID}, ${displayId('CBA')}, ${adminUserId},
            ${branchBigintId}, ${branch2BigintId}, ${patId},
            'Continuity_of_care', 'Duplicate grant'
          )
        `,
      ).rejects.toThrow(/unique/i)
    })
  })

  it('enforces reason_category CHECK constraint — rejects unknown category', async () => {
    await withRollback(pgClient, async (sql) => {
      await sql`SELECT set_config('app.current_tenant_id', ${TENANT_ID}, true)`
      await sql`SELECT set_config('app.current_user_id', ${String(adminUserId)}, true)`
      await sql`SELECT set_config('app.current_branch_id', '', true)`

      const patDisplayId = displayId('PAT')
      const mrn = testMrn()
      const [patRow] = await sql`
        INSERT INTO patients (tenant_id, display_id, mrn, first_name, last_name)
        VALUES (${TENANT_ID}, ${patDisplayId}, ${mrn}, 'Check', 'TestPat')
        RETURNING id
      `
      const patId = (patRow as { id: number }).id

      await expect(
        sql`
          INSERT INTO cross_branch_access_grants (
            tenant_id, display_id, user_id,
            source_branch_id, target_branch_id, patient_id,
            reason_category, reason_detail
          )
          VALUES (
            ${TENANT_ID}, ${displayId('CBA')}, ${adminUserId},
            ${branchBigintId}, ${branch2BigintId}, ${patId},
            'INVALID_REASON', 'Should fail CHECK'
          )
        `,
      ).rejects.toThrow(/check/i)
    })
  })
})

// ===========================================================================
// Step 7b — RFC §6.5 RLS enforcement scenarios (non-superuser rls_tester role)
//
// These run inside withRollback (raw postgres-js) and `SET LOCAL ROLE
// ${RLS_ROLE}` so FORCE ROW LEVEL SECURITY actually applies on the `encounters`
// table (a branch_id NOT NULL PHI table). The fixture (one encounter per
// branch, shared patient) is created in beforeAll.
//
// IMPORTANT — why a non-superuser role is mandatory: PostgreSQL superusers and
// BYPASSRLS roles ignore RLS even under FORCE ROW LEVEL SECURITY. The test
// suite routes DATABASE_URL through the BYPASSRLS migrator role (see
// tests/setup/global-setup.ts), so a plain query would NOT exercise the policy.
// `SET LOCAL ROLE ${RLS_ROLE}` drops to a NOBYPASSRLS role inside the rolled-back
// transaction so the policy is genuinely enforced.
//
// branch_isolation is declared `AS RESTRICTIVE` (Step 7a), so it AND-combines
// with the permissive tenant_isolation policy and actually narrows visibility/
// writability by branch. (A plain PERMISSIVE branch_isolation would be inert —
// tenant_isolation alone would OR-grant every same-tenant row.)
// ===========================================================================

describe('Step 7b — branch_isolation RLS enforcement (rls_tester role)', () => {
  it('Scenario 1: default isolation — a Branch-A session cannot read Branch-B encounters', async () => {
    await withRollback(pgClient, async (sql) => {
      await sql`SELECT set_config('app.current_tenant_id', ${TENANT_ID}, true)`
      await sql`SELECT set_config('app.current_user_id', ${String(adminUserId)}, true)`
      await sql`SELECT set_config('app.current_branch_id', ${String(branchBigintId)}, true)`
      // No cross_branch_read — default branch-scoped read.
      await sql`SELECT set_config('app.cross_branch_read', 'false', true)`
      await sql`SET LOCAL ROLE ${sql(RLS_ROLE)}`

      // Sanity: we are genuinely running as the non-superuser role (RLS applies).
      const [who] = await sql`SELECT current_user AS u`
      expect((who as { u: string }).u).toBe(RLS_ROLE)

      const rows = await sql`
        SELECT id, branch_id AS "branchId"
        FROM encounters
        WHERE id IN (${encBranchAId}, ${encBranchBId})
      `
      const ids = rows.map((r) => Number((r as { id: number }).id))
      // Branch-A encounter visible; Branch-B encounter hidden by the RESTRICTIVE
      // branch_isolation policy (M12 default-closed reads).
      expect(ids).toContain(encBranchAId)
      expect(ids).not.toContain(encBranchBId)
    })
  })

  it('Scenario 2: cross_branch_read reveals Branch-B encounters (within the tenant, never across)', async () => {
    await withRollback(pgClient, async (sql) => {
      await sql`SELECT set_config('app.current_tenant_id', ${TENANT_ID}, true)`
      await sql`SELECT set_config('app.current_user_id', ${String(adminUserId)}, true)`
      await sql`SELECT set_config('app.current_branch_id', ${String(branchBigintId)}, true)`
      // Break-glass read: the cross_branch_read GUC opens the USING clause.
      await sql`SELECT set_config('app.cross_branch_read', 'true', true)`
      await sql`SET LOCAL ROLE ${sql(RLS_ROLE)}`

      const rows = await sql`
        SELECT id, branch_id AS "branchId"
        FROM encounters
        WHERE id IN (${encBranchAId}, ${encBranchBId})
      `
      const ids = rows.map((r) => Number((r as { id: number }).id))
      expect(ids).toContain(encBranchAId)
      expect(ids).toContain(encBranchBId)

      // tenant_isolation still scopes to the tenant — cross_branch_read NEVER
      // crosses tenants. No SVX row should carry a foreign tenant_id.
      const foreign = await sql`
        SELECT count(*)::int AS c FROM encounters WHERE tenant_id <> ${TENANT_ID}
      `
      expect((foreign[0] as { c: number }).c).toBe(0)
    })
  })

  it('Scenario 3: WRITE NEVER cross-branch — cross_branch_read does NOT authorize a Branch-B write (the 7a guardrail)', async () => {
    await withRollback(pgClient, async (sql) => {
      await sql`SELECT set_config('app.current_tenant_id', ${TENANT_ID}, true)`
      await sql`SELECT set_config('app.current_user_id', ${String(adminUserId)}, true)`
      await sql`SELECT set_config('app.current_branch_id', ${String(branchBigintId)}, true)`
      // Break-glass READ is open, but writes must remain branch-local.
      await sql`SELECT set_config('app.cross_branch_read', 'true', true)`
      await sql`SET LOCAL ROLE ${sql(RLS_ROLE)}`

      // Positive control: a Branch-A write (matches current_branch_id) succeeds.
      const okEnc = await sql`
        INSERT INTO encounters (tenant_id, display_id, patient_id, branch_id, specialty, status, chief_complaint)
        VALUES (${TENANT_ID}, ${displayId('ENC')}, ${phiPatientId}, ${branchBigintId}, 'General', 'Open', 'S3 same-branch write')
        RETURNING id
      `
      expect(okEnc.length).toBe(1)

      // The breaking guardrail (7a): writing a Branch-B row while only
      // cross_branch_read='true' is set is REJECTED by the RESTRICTIVE WITH
      // CHECK. Postgres raises "new row violates row-level security policy"
      // (ERRCODE 42501).
      await expect(
        sql`
          INSERT INTO encounters (tenant_id, display_id, patient_id, branch_id, specialty, status, chief_complaint)
          VALUES (${TENANT_ID}, ${displayId('ENC')}, ${phiPatientId}, ${branch2BigintId}, 'General', 'Open', 'S3 cross-branch write must fail')
        `,
      ).rejects.toThrow(/row-level security|row level security|policy/i)
    })
  })

  it('Scenario 4: break-glass emits one grant on first access (none on second) + one audit row per access with matching correlation_id', async () => {
    // Uses the real Drizzle pool (withTenantTx) — NOT withRollback — because the
    // emitCrossBranchAccessAudit writes go through the app helper. Self-cleans.
    const corr1 = `corr-s4-a-${RUN}`
    const corr2 = `corr-s4-b-${RUN}`
    // Dedicated patient so the grant UNIQUE key (tenant,target_branch,patient)
    // is isolated from the rest of the suite.
    const s4PatientId = await withTenantTx(
      { tenantId: TENANT_ID, userId: adminUserId, branchId: branchBigintId },
      async (tx) => {
        const [pat] = await tx
          .insert(patients)
          .values({
            tenantId: TENANT_ID,
            displayId: displayId('PAT'),
            homeBranchId: branchBigintId,
            mrn: `MRN-S4-${RUN}`,
            firstName: 'Scenario4',
            lastName: 'BreakGlass',
          })
          .returning({ id: patients.id })
        return pat!.id
      },
    )
    try {
      // First break-glass access (correlation corr1): reads cross-branch + emits
      // one grant + one audit row.
      await withTenantTx(
        {
          tenantId: TENANT_ID,
          userId: adminUserId,
          branchId: branchBigintId,
          crossBranchRead: {
            reason: 'Continuity_of_care',
            reasonDetail: 'Patient continuing care across branches — scenario 4',
            patientId: s4PatientId,
            targetBranchId: branch2BigintId,
            correlationId: corr1,
          },
        },
        async (tx) => {
          await tx
            .select({ id: encounters.id })
            .from(encounters)
            .where(eq(encounters.id, encBranchBId))
        },
      )

      // Second break-glass access (correlation corr2): same (tenant,branch,patient)
      // → grant ON CONFLICT DO NOTHING (no new grant) but a NEW audit row.
      await withTenantTx(
        {
          tenantId: TENANT_ID,
          userId: adminUserId,
          branchId: branchBigintId,
          crossBranchRead: {
            reason: 'Continuity_of_care',
            reasonDetail: 'Second access — should not create a second grant',
            patientId: s4PatientId,
            targetBranchId: branch2BigintId,
            correlationId: corr2,
          },
        },
        async (tx) => {
          await tx
            .select({ id: encounters.id })
            .from(encounters)
            .where(eq(encounters.id, encBranchBId))
        },
      )

      // Exactly ONE grant row for (tenant, target_branch, patient) — D1 persistent.
      const grantRows = await withTenantTx(
        { tenantId: TENANT_ID, userId: adminUserId, branchId: null },
        async (tx) =>
          tx
            .select({
              id: crossBranchAccessGrants.id,
              sourceBranchId: crossBranchAccessGrants.sourceBranchId,
              targetBranchId: crossBranchAccessGrants.targetBranchId,
              patientId: crossBranchAccessGrants.patientId,
              reasonCategory: crossBranchAccessGrants.reasonCategory,
            })
            .from(crossBranchAccessGrants)
            .where(
              and(
                eq(crossBranchAccessGrants.tenantId, TENANT_ID),
                eq(crossBranchAccessGrants.patientId, s4PatientId),
              ),
            ),
      )
      expect(grantRows.length).toBe(1)
      expect(grantRows[0]!.sourceBranchId).toBe(branchBigintId)
      expect(grantRows[0]!.targetBranchId).toBe(branch2BigintId)
      expect(grantRows[0]!.reasonCategory).toBe('Continuity_of_care')

      // TWO audit rows — one per access — each carrying its own correlation_id.
      const auditRows = await withTenantTx(
        { tenantId: TENANT_ID, userId: adminUserId, branchId: null },
        async (tx) =>
          tx.execute(sql`
            SELECT correlation_id AS "correlationId", entity_id AS "entityId", action
            FROM audit_logs
            WHERE tenant_id = ${TENANT_ID}
              AND action = 'CROSS_BRANCH_ACCESS'
              AND correlation_id IN (${corr1}, ${corr2})
            ORDER BY correlation_id
          `),
      )
      const auditList = auditRows as unknown as Array<{
        correlationId: string
        entityId: string
        action: string
      }>
      expect(auditList.length).toBe(2)
      const corrs = auditList.map((r) => r.correlationId).sort()
      expect(corrs).toEqual([corr1, corr2].sort())
      // Each audit row points at the cross-branch patient.
      for (const row of auditList) {
        expect(String(row.entityId)).toBe(String(s4PatientId))
        expect(row.action).toBe('CROSS_BRANCH_ACCESS')
      }
    } finally {
      // Self-clean: grants → patient (FK-safe). The two CROSS_BRANCH_ACCESS
      // audit rows are intentionally LEFT in place — `audit_logs_no_delete`
      // (RESTRICTIVE FOR DELETE USING (false)) makes the audit trail
      // append-only for the app role, so a DELETE here would be a silent no-op.
      // The rows are correlation-id-scoped to this RUN and harmless.
      if (s4PatientId) {
        await withTenantTx(
          { tenantId: TENANT_ID, userId: adminUserId, branchId: null },
          async (tx) => {
            await tx
              .delete(crossBranchAccessGrants)
              .where(
                and(
                  eq(crossBranchAccessGrants.tenantId, TENANT_ID),
                  eq(crossBranchAccessGrants.patientId, s4PatientId),
                ),
              )
            await tx
              .delete(patients)
              .where(and(eq(patients.tenantId, TENANT_ID), eq(patients.id, s4PatientId)))
          },
        )
      }
    }
  })
})
