/**
 * Integration tests for D2 cross-branch transaction-invariant trigger.
 *
 * Verifies that the D2 branch-invariant trigger (0003_invariants.sql, folded from
 * 0025_d2_branch_isolation.sql in the 2026-05-28 consolidation) enforces the rule:
 *   "A transaction's branch_id must match the patient's last-administered
 *    branch (encounters.branch_id of the most-recent Completed clinical_order)."
 *
 * Test matrix:
 *   1. New patient (no Completed clinical_order) → INSERT at any branch is allowed.
 *   2. Patient with a Completed clinical_order at HST → INSERT at HST succeeds.
 *   3. Patient with a Completed clinical_order at HST → INSERT at TMG raises 23514.
 *   4. Soft-deleted Completed clinical_order is ignored → treated as new patient.
 *
 * All writes are wrapped in withRollback — no rows persist to the shared dev DB.
 * GUCs (tenant/user/branch) are set inside each rollback block to satisfy the
 * audit trigger (0024_audit_trigger_strict.sql).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import { db } from '../../src/shared/db/index.js'
import { branches, users } from '../../src/shared/db/schema.js'
import { displayId } from '../../src/shared/utils/displayId.js'
import { withRollback } from '../setup/withRollback.js'

const TENANT = 'SVX'
const SVC_FNAT = 'SVC_FNAT' // seeded service used for clinical_order fixture

const pgClient = postgres(process.env['DATABASE_URL']!)

let hstBranchId = 0
let timBranchId = 0
let adminUserId = 0

beforeAll(async () => {
  // Resolve seeded branch IDs by branch code, HST (Holy Spirit) and TMG (Timog).
  const hstRow = await db
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.code, 'HST'))
    .limit(1)
  if (!hstRow[0]) throw new Error('HST branch not found; run pnpm run setup first')
  hstBranchId = hstRow[0].id

  const timRow = await db
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.code, 'TMG'))
    .limit(1)
  if (!timRow[0]) throw new Error('TMG branch not found: run pnpm run setup first')
  timBranchId = timRow[0].id

  const adminRow = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'admin@surevax.com'))
    .limit(1)
  if (!adminRow[0]) throw new Error('admin user not found; run pnpm run setup first')
  adminUserId = adminRow[0].id
})

afterAll(async () => {
  await pgClient.end()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Insert a minimal patient row inside a `withRollback` tx; returns its id. */
async function insertPatient(
  sql: ReturnType<typeof postgres<Record<string, unknown>[]>>,
  mrn: string,
): Promise<number> {
  const rows = await sql`
    INSERT INTO patients (display_id, tenant_id, mrn, first_name, last_name)
    VALUES (${displayId('PAT')}, ${TENANT}, ${mrn}, ${'D2Test'}, ${'Patient'})
    RETURNING id
  `
  // postgres-js raw tx handle returns bigserial columns as strings — coerce.
  return Number((rows[0] as { id: string | number }).id)
}

/**
 * Insert an encounter at a given branch; returns its id.
 * `specialty` and `status` default to 'Vaccination' / 'Open'.
 */
async function insertEncounter(
  sql: ReturnType<typeof postgres<Record<string, unknown>[]>>,
  patientId: number,
  branchId: number,
): Promise<number> {
  const rows = await sql`
    INSERT INTO encounters (display_id, tenant_id, patient_id, branch_id, specialty, status)
    VALUES (${displayId('ENC')}, ${TENANT}, ${patientId}, ${branchId}, 'Vaccination', 'Completed')
    RETURNING id
  `
  // postgres-js raw tx handle returns bigserial columns as strings — coerce.
  return Number((rows[0] as { id: string | number }).id)
}

/**
 * Insert a clinical_order row with status='Completed' and a non-null completed_at.
 * The encounter_id hop is how the trigger locates the branch.
 */
async function insertCompletedOrder(
  sql: ReturnType<typeof postgres<Record<string, unknown>[]>>,
  {
    patientId,
    encounterId,
    deletedAt = null,
  }: { patientId: number; encounterId: number; deletedAt?: Date | null },
): Promise<void> {
  await sql`
    INSERT INTO clinical_orders (
      display_id, tenant_id, patient_id, encounter_id,
      service_id, order_type, status, completed_at, deleted_at
    )
    VALUES (
      ${displayId('ORD')}, ${TENANT}, ${patientId}, ${encounterId},
      ${SVC_FNAT}, 'Ad_Hoc', 'Completed', NOW(),
      ${deletedAt}
    )
  `
}

/**
 * Attempt to INSERT a minimal transactions row.
 * Returns the inserted id on success, or throws on trigger rejection.
 */
async function insertTransaction(
  sql: ReturnType<typeof postgres<Record<string, unknown>[]>>,
  patientId: number,
  branchId: number,
): Promise<number> {
  const rows = await sql`
    INSERT INTO transactions (
      display_id, tenant_id, branch_id, patient_id, status
    )
    VALUES (
      ${displayId('TXN')}, ${TENANT}, ${branchId}, ${patientId}, 'Draft'
    )
    RETURNING id
  `
  // postgres-js raw tx handle returns bigserial columns as strings — coerce.
  return Number((rows[0] as { id: string | number }).id)
}

// ---------------------------------------------------------------------------
// Test 1 — new patient with NO completed clinical_order → any branch allowed
// ---------------------------------------------------------------------------

describe('D2 trigger: new patient (no Completed order) allows INSERT at any branch', () => {
  it('allows transaction INSERT at HST when patient has no clinical history', async () => {
    await withRollback(pgClient, async (sql) => {
      await sql`SELECT set_config('app.current_tenant_id', ${TENANT}, true)`
      await sql`SELECT set_config('app.current_user_id', ${String(adminUserId)}, true)`
      await sql`SELECT set_config('app.current_branch_id', ${''}::text, true)`

      const patientId = await insertPatient(sql, 'MRN-D2-NEWPAT01')

      const txnId = await insertTransaction(sql, patientId, hstBranchId)
      expect(txnId).toBeGreaterThan(0)
    })
  })

  it('allows transaction INSERT at TMG when patient has no clinical history', async () => {
    await withRollback(pgClient, async (sql) => {
      await sql`SELECT set_config('app.current_tenant_id', ${TENANT}, true)`
      await sql`SELECT set_config('app.current_user_id', ${String(adminUserId)}, true)`
      await sql`SELECT set_config('app.current_branch_id', ${''}::text, true)`

      const patientId = await insertPatient(sql, 'MRN-D2-NEWPAT02')

      const txnId = await insertTransaction(sql, patientId, timBranchId)
      expect(txnId).toBeGreaterThan(0)
    })
  })
})

// ---------------------------------------------------------------------------
// Test 2 — patient last administered at HST → INSERT at HST succeeds
// ---------------------------------------------------------------------------

describe('D2 trigger: branch matches last-administered branch → INSERT allowed', () => {
  it('allows transaction INSERT at HST when patient was last administered at HST', async () => {
    await withRollback(pgClient, async (sql) => {
      await sql`SELECT set_config('app.current_tenant_id', ${TENANT}, true)`
      await sql`SELECT set_config('app.current_user_id', ${String(adminUserId)}, true)`
      await sql`SELECT set_config('app.current_branch_id', ${''}::text, true)`

      const patientId = await insertPatient(sql, 'MRN-D2-MATCH01')
      const encounterId = await insertEncounter(sql, patientId, hstBranchId)
      await insertCompletedOrder(sql, { patientId, encounterId })

      const txnId = await insertTransaction(sql, patientId, hstBranchId)
      expect(txnId).toBeGreaterThan(0)
    })
  })
})

// ---------------------------------------------------------------------------
// Test 3: patient last administered at HST → INSERT at TMG raises 23514
// ---------------------------------------------------------------------------

describe('D2 trigger: branch mismatch rejects INSERT', () => {
  it('rejects transaction INSERT at TMG when patient was last administered at HST', async () => {
    await withRollback(pgClient, async (sql) => {
      await sql`SELECT set_config('app.current_tenant_id', ${TENANT}, true)`
      await sql`SELECT set_config('app.current_user_id', ${String(adminUserId)}, true)`
      await sql`SELECT set_config('app.current_branch_id', ${''}::text, true)`

      const patientId = await insertPatient(sql, 'MRN-D2-MISMATCH01')
      const encounterId = await insertEncounter(sql, patientId, hstBranchId)
      await insertCompletedOrder(sql, { patientId, encounterId })

      await expect(insertTransaction(sql, patientId, timBranchId)).rejects.toMatchObject({
        code: '23514', // check_violation ERRCODE from the trigger
      })
    })
  })

  it('rejects INSERT even when the mismatch is HST→TMG reversed', async () => {
    await withRollback(pgClient, async (sql) => {
      await sql`SELECT set_config('app.current_tenant_id', ${TENANT}, true)`
      await sql`SELECT set_config('app.current_user_id', ${String(adminUserId)}, true)`
      await sql`SELECT set_config('app.current_branch_id', ${''}::text, true)`

      const patientId = await insertPatient(sql, 'MRN-D2-MISMATCH02')
      const encounterId = await insertEncounter(sql, patientId, timBranchId)
      await insertCompletedOrder(sql, { patientId, encounterId })

      await expect(insertTransaction(sql, patientId, hstBranchId)).rejects.toMatchObject({
        code: '23514',
      })
    })
  })
})

// ---------------------------------------------------------------------------
// Test 4 — soft-deleted Completed clinical_order is excluded from lookup
// ---------------------------------------------------------------------------

describe('D2 trigger: soft-deleted clinical_order is ignored (treated as new patient)', () => {
  it('allows INSERT at any branch when the only Completed order is soft-deleted', async () => {
    await withRollback(pgClient, async (sql) => {
      await sql`SELECT set_config('app.current_tenant_id', ${TENANT}, true)`
      await sql`SELECT set_config('app.current_user_id', ${String(adminUserId)}, true)`
      await sql`SELECT set_config('app.current_branch_id', ${''}::text, true)`

      const patientId = await insertPatient(sql, 'MRN-D2-SOFTDEL01')
      const encounterId = await insertEncounter(sql, patientId, hstBranchId)
      // Insert a Completed order that is also soft-deleted.
      await insertCompletedOrder(sql, {
        patientId,
        encounterId,
        deletedAt: new Date(),
      })

      // Because the only Completed order is deleted, trigger sees no history
      // and allows the INSERT at TMG (a different branch from the deleted order).
      const txnId = await insertTransaction(sql, patientId, timBranchId)
      expect(txnId).toBeGreaterThan(0)
    })
  })
})
