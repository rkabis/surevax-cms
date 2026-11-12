/**
 * Integration tests — Cross-Branch PHI RLS enforcement (the gate for the
 * breaking M12/step-7 RLS flip).
 *
 * These four scenarios mirror RFC §6.5 and gate step 7a (the WITH CHECK fix
 * that makes break-glass read-only). They prove the branch_isolation policy
 * actually enforces:
 *
 *   Scenario 1 (default isolation): a non-superuser `rls_tester` session for
 *     tenant SVX with app.current_branch_id=Branch-A reads ONLY Branch-A rows
 *     of branch-scoped PHI tables (encounters, clinical_orders); Branch-B rows
 *     are invisible. Verifies the M12 flip closed the old default-open hole.
 *
 *   Scenario 2 (break-glass reveal): the same session with
 *     app.cross_branch_read='true' reads Branch-B rows tenant-wide-within-tenant,
 *     but a foreign tenant's rows stay invisible. Verifies cross_branch_read
 *     opens reads within the tenant only — never cross-tenant.
 *
 *   Scenario 3 (write never cross-branch): with app.cross_branch_read='true'
 *     AND app.current_branch_id=Branch-A, an INSERT of a Branch-B row is
 *     REJECTED by the WITH CHECK clause (after step 7a removes cross_branch_read
 *     from WITH CHECK). Proves break-glass is read-only.
 *
 *     ⚠️  RED UNTIL STEP 7a LANDS. The WITH CHECK clause in
 *     0001_extensions_and_rls.sql (~lines 894-899) currently STILL honors
 *     cross_branch_read='true', so today this INSERT WRONGLY SUCCEEDS and the
 *     assertion fails. That failure is the justification for step 7a. After 7a
 *     drops the `cross_branch_read='true'` disjunct from WITH CHECK (keeping
 *     `branch_id IS NULL` + is_platform_admin), the INSERT is rejected and this
 *     test goes green. See the inline note on the test.
 *
 *   Scenario 4 (grant + audit emission): a break-glass call via
 *     withTenantTx({ crossBranchRead }) creates EXACTLY ONE
 *     cross_branch_access_grants row (display_id CBA_, correct source/target
 *     branch + patient + reason) on first access and ZERO additional rows on a
 *     second access for the same (tenant, target_branch, patient) — D1
 *     ON CONFLICT DO NOTHING — while an audit_logs row with
 *     action='CROSS_BRANCH_ACCESS' and the SAME correlation_id fires on EVERY
 *     access.
 *
 * SUPERUSER BYPASS — why this file uses a dedicated role:
 *   PostgreSQL superusers bypass RLS even under FORCE ROW LEVEL SECURITY. The
 *   `surevax` connection role (the Drizzle pool + the raw postgres-js client) is
 *   a superuser, so cross-branch-phi-step23.test.ts cannot prove enforcement
 *   (see its own comment at line 287). Scenarios 1-3 run their read/write
 *   assertions inside `db.transaction()` after `SET LOCAL ROLE rls_tester`, a
 *   NOSUPERUSER/NOBYPASSRLS role created in beforeAll — exactly the pattern
 *   established by rls-multi-tenant.test.ts.
 *
 * ISOLATION (H14):
 *   The Branch-A / Branch-B / patient fixtures are created in beforeAll via
 *   withTenantTx (Drizzle pool, COMMITS) because the rls_tester role reads them
 *   in a separate transaction — they cannot live inside a withRollback tx.
 *   They are torn down explicitly in afterAll. The Scenario-4 grant + audit
 *   rows are written via withTenantTx (also commits) and likewise cleaned up in
 *   afterAll. Per the H14 caveat, withRollback does NOT capture withTenantTx /
 *   db.transaction writes (separate pool connection).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, eq, and, inArray } from 'drizzle-orm'
import { db } from '../../src/shared/db/index.js'
import { withTenantTx } from '../../src/shared/db/withTenantTx.js'
import {
  tenants,
  branches,
  users,
  patients,
  encounters,
  clinicalOrders,
  crossBranchAccessGrants,
  auditLogs,
} from '../../src/shared/db/schema.js'
import { displayId } from '../../src/shared/utils/displayId.js'

// ---------------------------------------------------------------------------
// IDs / role name — timestamped to avoid leftover-row collisions on the
// persistent fixtures (second branch, patient, foreign tenant, Postgres role).
// ---------------------------------------------------------------------------

const TENANT1_ID = 'SVX' // seeded tenant slug
const TS_SUFFIX = Date.now().toString(36).toUpperCase().slice(-6)
const FOREIGN_TENANT_ID = `TENXBR${TS_SUFFIX.toUpperCase()}` // foreign tenant for §2 cross-tenant guard

// Branch codes must match '^[A-Z]{3}$' (branches_code_format CHECK).
const BRANCH_B_CODE = 'XBR'
const BRANCH_B_DISPLAY_ID = `${TENANT1_ID}.${BRANCH_B_CODE}`
const FOREIGN_BRANCH_CODE = 'FOR'
const FOREIGN_BRANCH_DISPLAY_ID = `${FOREIGN_TENANT_ID}.${FOREIGN_BRANCH_CODE}`

// Non-superuser role subject to RLS.
const RLS_ROLE = `rls_tester_cbphi_${TS_SUFFIX.toLowerCase()}`

const SVC_CONSULTATION = 'SVC_CONSULTATION' // stable seeded abstract service

// Runtime-resolved bigints from beforeAll.
let adminUserId = 0
let branchABigintId = 0 // an existing seeded branch (Branch-A)
let branchBBigintId = 0 // a second branch we create (Branch-B)
let foreignBranchBigintId = 0
let patientBigintId = 0 // SVX patient used across scenarios
let foreignPatientBigintId = 0

// Encounter display_ids so we can identify our fixture rows in assertions.
const encounterADisplayId = displayId('ENC')
const encounterBDisplayId = displayId('ENC')
let encounterABigintId = 0
let encounterBBigintId = 0

// clinical_orders fixtures (one per branch via their encounters).
const orderADisplayId = displayId('ORD')
const orderBDisplayId = displayId('ORD')

// ---------------------------------------------------------------------------
// beforeAll — fixtures + non-superuser role
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Resolve seeded admin bigint.
  const [adminRow] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, TENANT1_ID), eq(users.email, 'admin@surevax.com')))
    .limit(1)
  if (!adminRow) throw new Error('seeded admin user not found; run pnpm run setup first')
  adminUserId = adminRow.id

  // Resolve Branch-A (first active seeded branch for SVX).
  const [branchARow] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.tenantId, TENANT1_ID), eq(branches.isActive, true)))
    .orderBy(branches.id)
    .limit(1)
  if (!branchARow) throw new Error('no seeded branch found for SVX')
  branchABigintId = branchARow.id

  // Create Branch-B under SVX (idempotent on re-run).
  const [existingB] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.tenantId, TENANT1_ID), eq(branches.displayId, BRANCH_B_DISPLAY_ID)))
    .limit(1)
  if (existingB) {
    branchBBigintId = existingB.id
  } else {
    const inserted = await withTenantTx(
      { tenantId: TENANT1_ID, userId: adminUserId, branchId: null },
      async (tx) =>
        tx
          .insert(branches)
          .values({
            tenantId: TENANT1_ID,
            displayId: BRANCH_B_DISPLAY_ID,
            name: `CBPHI Branch B ${TS_SUFFIX}`,
            code: BRANCH_B_CODE,
          })
          .returning({ id: branches.id }),
    )
    branchBBigintId = inserted[0]!.id
  }

  // Patient under SVX (home branch A).
  const patDisplayId = displayId('PAT')
  const patInsert = await withTenantTx(
    { tenantId: TENANT1_ID, userId: adminUserId, branchId: branchABigintId },
    async (tx) =>
      tx
        .insert(patients)
        .values({
          displayId: patDisplayId,
          tenantId: TENANT1_ID,
          homeBranchId: branchABigintId,
          mrn: `MRN-CBPHI-${TS_SUFFIX}`,
          firstName: 'CrossBranch',
          lastName: 'PhiPatient',
        })
        .returning({ id: patients.id }),
  )
  patientBigintId = patInsert[0]!.id

  // One encounter + one clinical_order at Branch-A.
  await withTenantTx(
    { tenantId: TENANT1_ID, userId: adminUserId, branchId: branchABigintId },
    async (tx) => {
      const encRows = await tx
        .insert(encounters)
        .values({
          displayId: encounterADisplayId,
          tenantId: TENANT1_ID,
          patientId: patientBigintId,
          branchId: branchABigintId,
          specialty: 'General',
          status: 'Open',
        })
        .returning({ id: encounters.id })
      encounterABigintId = encRows[0]!.id

      await tx.insert(clinicalOrders).values({
        displayId: orderADisplayId,
        tenantId: TENANT1_ID,
        serviceId: SVC_CONSULTATION,
        patientId: patientBigintId,
        encounterId: encounterABigintId,
        orderType: 'Ad_Hoc',
        status: 'Scheduled',
      })
    },
  )

  // One encounter + one clinical_order at Branch-B (the cross-branch target).
  await withTenantTx(
    { tenantId: TENANT1_ID, userId: adminUserId, branchId: branchBBigintId },
    async (tx) => {
      const encRows = await tx
        .insert(encounters)
        .values({
          displayId: encounterBDisplayId,
          tenantId: TENANT1_ID,
          patientId: patientBigintId,
          branchId: branchBBigintId,
          specialty: 'General',
          status: 'Open',
        })
        .returning({ id: encounters.id })
      encounterBBigintId = encRows[0]!.id

      await tx.insert(clinicalOrders).values({
        displayId: orderBDisplayId,
        tenantId: TENANT1_ID,
        serviceId: SVC_CONSULTATION,
        patientId: patientBigintId,
        encounterId: encounterBBigintId,
        orderType: 'Ad_Hoc',
        status: 'Scheduled',
      })
    },
  )

  // Foreign tenant + branch + patient + encounter — used by Scenario 2's
  // cross-tenant guard (cross_branch_read must NOT leak across tenants).
  await db.insert(tenants).values({
    id: FOREIGN_TENANT_ID,
    name: 'CBPHI Foreign Tenant',
    slug: `cbphi-foreign-${TS_SUFFIX.toLowerCase()}`,
    timezone: 'Asia/Manila',
    countryCode: 'PH',
  })
  const fBranch = await withTenantTx(
    { tenantId: FOREIGN_TENANT_ID, userId: adminUserId, branchId: null },
    async (tx) =>
      tx
        .insert(branches)
        .values({
          tenantId: FOREIGN_TENANT_ID,
          displayId: FOREIGN_BRANCH_DISPLAY_ID,
          name: 'Foreign Main',
          code: FOREIGN_BRANCH_CODE,
        })
        .returning({ id: branches.id }),
  )
  foreignBranchBigintId = fBranch[0]!.id
  const fPatient = await withTenantTx(
    { tenantId: FOREIGN_TENANT_ID, userId: adminUserId, branchId: foreignBranchBigintId },
    async (tx) =>
      tx
        .insert(patients)
        .values({
          displayId: displayId('PAT'),
          tenantId: FOREIGN_TENANT_ID,
          homeBranchId: foreignBranchBigintId,
          mrn: `MRN-FOR-${TS_SUFFIX}`,
          firstName: 'Foreign',
          lastName: 'Patient',
        })
        .returning({ id: patients.id }),
  )
  foreignPatientBigintId = fPatient[0]!.id
  await withTenantTx(
    { tenantId: FOREIGN_TENANT_ID, userId: adminUserId, branchId: foreignBranchBigintId },
    async (tx) => {
      await tx.insert(encounters).values({
        displayId: displayId('ENC'),
        tenantId: FOREIGN_TENANT_ID,
        patientId: foreignPatientBigintId,
        branchId: foreignBranchBigintId,
        specialty: 'General',
        status: 'Open',
      })
    },
  )

  // Non-superuser role for RLS read/write assertions. NOSUPERUSER/NOBYPASSRLS
  // so FORCE ROW LEVEL SECURITY actually applies to it.
  await db.execute(
    sql.raw(
      `CREATE ROLE ${RLS_ROLE} NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE LOGIN PASSWORD 'rls_test_only'`,
    ),
  )
  await db.execute(
    sql.raw(
      `GRANT SELECT, INSERT, UPDATE ON encounters, clinical_orders, transactions, lab_orders, patients TO ${RLS_ROLE}`,
    ),
  )
})

// ---------------------------------------------------------------------------
// afterAll — teardown in FK-safe reverse order
// ---------------------------------------------------------------------------

afterAll(async () => {
  // Scenario-4 grant + audit rows (committed via withTenantTx).
  await withTenantTx({ tenantId: TENANT1_ID, userId: adminUserId, branchId: null }, async (tx) => {
    await tx
      .delete(crossBranchAccessGrants)
      .where(eq(crossBranchAccessGrants.patientId, patientBigintId))
    await tx
      .delete(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, TENANT1_ID),
          eq(auditLogs.action, 'CROSS_BRANCH_ACCESS'),
          eq(auditLogs.entityId, String(patientBigintId)),
        ),
      )
  })

  // SVX clinical_orders + encounters for our patient.
  await withTenantTx({ tenantId: TENANT1_ID, userId: adminUserId, branchId: null }, async (tx) => {
    await tx.delete(clinicalOrders).where(eq(clinicalOrders.patientId, patientBigintId))
    await tx.delete(encounters).where(eq(encounters.patientId, patientBigintId))
    await tx.delete(patients).where(eq(patients.id, patientBigintId))
    // Branch-B may carry leftover scenario-3 encounters too — clean the branch.
    await tx
      .delete(encounters)
      .where(
        and(eq(encounters.tenantId, TENANT1_ID), inArray(encounters.branchId, [branchBBigintId])),
      )
    await tx
      .update(branches)
      .set({ isActive: false })
      .where(and(eq(branches.tenantId, TENANT1_ID), eq(branches.id, branchBBigintId)))
  })

  // Foreign tenant teardown.
  await withTenantTx(
    { tenantId: FOREIGN_TENANT_ID, userId: adminUserId, branchId: null },
    async (tx) => {
      await tx.delete(encounters).where(eq(encounters.tenantId, FOREIGN_TENANT_ID))
      await tx.delete(patients).where(eq(patients.tenantId, FOREIGN_TENANT_ID))
      await tx.delete(branches).where(eq(branches.tenantId, FOREIGN_TENANT_ID))
    },
  )
  await db.delete(tenants).where(eq(tenants.id, FOREIGN_TENANT_ID))

  await db.execute(sql.raw(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${RLS_ROLE}`))
  await db.execute(sql.raw(`DROP ROLE IF EXISTS ${RLS_ROLE}`))
})

// ---------------------------------------------------------------------------
// Helper — run a callback as the non-superuser rls_tester role with the given
// branch / cross_branch_read GUCs set inside ONE transaction. SET LOCAL ROLE
// is scoped to the transaction; the GUCs are set with `true` (transaction
// local) so they reset on commit.
// ---------------------------------------------------------------------------

type RlsSession = {
  tenantId: string
  branchId: number | null
  crossBranchRead: boolean
}

async function asRlsTester<T>(
  s: RlsSession,
  run: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_tenant_id', ${s.tenantId}, true)`)
    await tx.execute(sql`select set_config('app.current_user_id', ${String(adminUserId)}, true)`)
    await tx.execute(
      sql`select set_config('app.current_branch_id', ${s.branchId === null ? '' : String(s.branchId)}, true)`,
    )
    await tx.execute(
      sql`select set_config('app.cross_branch_read', ${s.crossBranchRead ? 'true' : 'false'}, true)`,
    )
    await tx.execute(sql`select set_config('app.is_platform_admin', 'false', true)`)
    // Drop superuser privilege for the remainder of this transaction.
    await tx.execute(sql.raw(`SET LOCAL ROLE ${RLS_ROLE}`))
    return run(tx)
  })
}

// ---------------------------------------------------------------------------
// Scenario 1 — default branch isolation (M12 flip closed the default-open hole)
// ---------------------------------------------------------------------------

describe('Scenario 1 — default branch isolation', () => {
  it('Branch-A session sees only Branch-A encounters; Branch-B rows are invisible', async () => {
    const rows = await asRlsTester(
      { tenantId: TENANT1_ID, branchId: branchABigintId, crossBranchRead: false },
      (tx) =>
        tx
          .select({ id: encounters.id, branchId: encounters.branchId })
          .from(encounters)
          .where(
            and(
              eq(encounters.tenantId, TENANT1_ID),
              inArray(encounters.id, [encounterABigintId, encounterBBigintId]),
            ),
          ),
    )

    const ids = rows.map((r) => r.id)
    expect(ids).toContain(encounterABigintId)
    expect(ids).not.toContain(encounterBBigintId)
    // Every visible row must belong to Branch-A.
    expect(rows.every((r) => r.branchId === branchABigintId)).toBe(true)
  })

  it('Branch-A session sees only Branch-A clinical_orders when scoped through their encounter', async () => {
    // clinical_orders has NO branch_id column (verified in schema.ts) — its
    // branch is derived via encounter_id → encounters.branch_id. So the
    // RESTRICTIVE branch_isolation policy does NOT apply to clinical_orders
    // directly (it only carries tenant_isolation). Branch scoping for clinical
    // orders is therefore enforced by JOINing through `encounters`, which IS
    // branch-isolated: under a Branch-A session the Branch-B encounter is
    // invisible, so its clinical_order drops out of the join.
    const rows = await asRlsTester(
      { tenantId: TENANT1_ID, branchId: branchABigintId, crossBranchRead: false },
      (tx) =>
        tx
          .select({ id: clinicalOrders.id, displayId: clinicalOrders.displayId })
          .from(clinicalOrders)
          .innerJoin(encounters, eq(clinicalOrders.encounterId, encounters.id))
          .where(
            and(
              eq(clinicalOrders.tenantId, TENANT1_ID),
              inArray(clinicalOrders.displayId, [orderADisplayId, orderBDisplayId]),
            ),
          ),
    )

    const seen = rows.map((r) => r.displayId)
    expect(seen).toContain(orderADisplayId)
    // Branch-B order is invisible because its Branch-B encounter is filtered out
    // by branch_isolation on `encounters`.
    expect(seen).not.toContain(orderBDisplayId)
  })

  it('clinical_orders carry only tenant_isolation (no branch_id) — a direct unscoped read is NOT branch-filtered by RLS', async () => {
    // Documents the schema reality so a future reader does not assume RLS
    // branch-scopes clinical_orders by itself. A direct select (no encounter
    // join) returns BOTH orders for the tenant regardless of the branch GUC.
    const rows = await asRlsTester(
      { tenantId: TENANT1_ID, branchId: branchABigintId, crossBranchRead: false },
      (tx) =>
        tx
          .select({ displayId: clinicalOrders.displayId })
          .from(clinicalOrders)
          .where(
            and(
              eq(clinicalOrders.tenantId, TENANT1_ID),
              inArray(clinicalOrders.displayId, [orderADisplayId, orderBDisplayId]),
            ),
          ),
    )
    const seen = rows.map((r) => r.displayId)
    expect(seen).toContain(orderADisplayId)
    expect(seen).toContain(orderBDisplayId)
  })
})

// ---------------------------------------------------------------------------
// Scenario 2 — break-glass reveal (cross_branch_read opens reads within tenant,
// never cross-tenant)
// ---------------------------------------------------------------------------

describe('Scenario 2 — cross_branch_read reveal', () => {
  it('Branch-A session WITH cross_branch_read sees Branch-B encounters', async () => {
    const rows = await asRlsTester(
      { tenantId: TENANT1_ID, branchId: branchABigintId, crossBranchRead: true },
      (tx) =>
        tx
          .select({ id: encounters.id, branchId: encounters.branchId })
          .from(encounters)
          .where(
            and(
              eq(encounters.tenantId, TENANT1_ID),
              inArray(encounters.id, [encounterABigintId, encounterBBigintId]),
            ),
          ),
    )

    const ids = rows.map((r) => r.id)
    expect(ids).toContain(encounterABigintId)
    expect(ids).toContain(encounterBBigintId) // Branch-B now visible
  })

  it('cross_branch_read does NOT leak across tenants — foreign tenant rows stay hidden', async () => {
    const rows = await asRlsTester(
      { tenantId: TENANT1_ID, branchId: branchABigintId, crossBranchRead: true },
      (tx) =>
        tx
          .select({ id: encounters.id, tenantId: encounters.tenantId })
          .from(encounters)
          .where(eq(encounters.tenantId, FOREIGN_TENANT_ID)),
    )
    // tenant_isolation (a separate RLS policy) still scopes by tenant; the
    // cross_branch_read GUC only widens the BRANCH dimension.
    expect(rows).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Scenario 3 — write is NEVER cross-branch (WITH CHECK is read-only for
// cross_branch_read after step 7a)
//
// ⚠️  RED UNTIL STEP 7a LANDS.
// Pre-7a, the WITH CHECK clause in 0001_extensions_and_rls.sql still honors
// cross_branch_read='true', so this INSERT WRONGLY SUCCEEDS and the
// `.rejects.toThrow()` assertion fails. That is the intended signal: the test
// is the gate that justifies removing `cross_branch_read='true'` from WITH
// CHECK. After step 7a, the policy rejects the Branch-B INSERT from a Branch-A
// session and this test goes green.
// ---------------------------------------------------------------------------

describe('Scenario 3 — break-glass write is rejected (WITH CHECK read-only)', () => {
  it('INSERT of a Branch-B encounter from a Branch-A break-glass session is rejected', async () => {
    const phantomDisplayId = displayId('ENC')

    await expect(
      asRlsTester(
        { tenantId: TENANT1_ID, branchId: branchABigintId, crossBranchRead: true },
        (tx) =>
          tx.insert(encounters).values({
            displayId: phantomDisplayId,
            tenantId: TENANT1_ID,
            patientId: patientBigintId,
            branchId: branchBBigintId, // cross-branch write — must be blocked by WITH CHECK
            specialty: 'General',
            status: 'Open',
          }),
      ),
    ).rejects.toThrow()

    // Belt-and-suspenders: confirm no Branch-B phantom row survived (the
    // transaction rolls back on the RLS error, so this must be empty).
    const survivors = await withTenantTx(
      { tenantId: TENANT1_ID, userId: adminUserId, branchId: null },
      async (tx) =>
        tx
          .select({ id: encounters.id })
          .from(encounters)
          .where(eq(encounters.displayId, phantomDisplayId)),
    )
    expect(survivors).toHaveLength(0)
  })

  it('UPDATE re-homing a Branch-A encounter to Branch-B is rejected from a break-glass session', async () => {
    await expect(
      asRlsTester(
        { tenantId: TENANT1_ID, branchId: branchABigintId, crossBranchRead: true },
        (tx) =>
          tx
            .update(encounters)
            .set({ branchId: branchBBigintId })
            .where(and(eq(encounters.tenantId, TENANT1_ID), eq(encounters.id, encounterABigintId))),
      ),
    ).rejects.toThrow()

    // Confirm the encounter is still homed at Branch-A.
    const [row] = await withTenantTx(
      { tenantId: TENANT1_ID, userId: adminUserId, branchId: null },
      async (tx) =>
        tx
          .select({ branchId: encounters.branchId })
          .from(encounters)
          .where(eq(encounters.id, encounterABigintId)),
    )
    expect(row?.branchId).toBe(branchABigintId)
  })
})

// ---------------------------------------------------------------------------
// Scenario 4 — grant + audit emission (D1 ON CONFLICT DO NOTHING for the grant;
// audit row on EVERY access; same correlation_id)
//
// Exercises the real break-glass path: withTenantTx({ crossBranchRead }) calls
// emitCrossBranchAccessAudit before fn. Writes commit through the Drizzle pool,
// so afterAll cleans them up.
// ---------------------------------------------------------------------------

describe('Scenario 4 — grant + audit emission', () => {
  it('first access creates exactly one grant + one audit row; second access adds an audit row but no grant', async () => {
    const correlationId = `corr-cbphi-${TS_SUFFIX}`
    const cbr = {
      reason: 'Continuity_of_care' as const,
      reasonDetail: 'Patient continuing PEP series begun at Branch-B',
      patientId: patientBigintId,
      targetBranchId: branchBBigintId,
      correlationId,
    }

    // First break-glass access at Branch-A reading Branch-B's chart.
    await withTenantTx(
      {
        tenantId: TENANT1_ID,
        userId: adminUserId,
        branchId: branchABigintId,
        crossBranchRead: cbr,
      },
      async (tx) =>
        tx
          .select({ id: encounters.id })
          .from(encounters)
          .where(eq(encounters.id, encounterBBigintId)),
    )

    // After the FIRST access: exactly one grant row + one audit row.
    const grantsAfterFirst = await withTenantTx(
      { tenantId: TENANT1_ID, userId: adminUserId, branchId: null },
      async (tx) =>
        tx
          .select({
            displayId: crossBranchAccessGrants.displayId,
            sourceBranchId: crossBranchAccessGrants.sourceBranchId,
            targetBranchId: crossBranchAccessGrants.targetBranchId,
            patientId: crossBranchAccessGrants.patientId,
            reasonCategory: crossBranchAccessGrants.reasonCategory,
            reasonDetail: crossBranchAccessGrants.reasonDetail,
            correlationId: crossBranchAccessGrants.correlationId,
          })
          .from(crossBranchAccessGrants)
          .where(
            and(
              eq(crossBranchAccessGrants.tenantId, TENANT1_ID),
              eq(crossBranchAccessGrants.targetBranchId, branchBBigintId),
              eq(crossBranchAccessGrants.patientId, patientBigintId),
            ),
          ),
    )
    expect(grantsAfterFirst).toHaveLength(1)
    const grant = grantsAfterFirst[0]!
    expect(grant.displayId.startsWith('CBA_')).toBe(true)
    expect(grant.sourceBranchId).toBe(branchABigintId)
    expect(grant.targetBranchId).toBe(branchBBigintId)
    expect(grant.patientId).toBe(patientBigintId)
    expect(grant.reasonCategory).toBe('Continuity_of_care')
    expect(grant.reasonDetail).toBe(cbr.reasonDetail)
    expect(grant.correlationId).toBe(correlationId)

    const auditAfterFirst = await countCrossBranchAuditRows(correlationId)
    expect(auditAfterFirst).toBe(1)

    // SECOND break-glass access for the SAME (tenant, target_branch, patient).
    await withTenantTx(
      {
        tenantId: TENANT1_ID,
        userId: adminUserId,
        branchId: branchABigintId,
        crossBranchRead: cbr,
      },
      async (tx) =>
        tx
          .select({ id: encounters.id })
          .from(encounters)
          .where(eq(encounters.id, encounterBBigintId)),
    )

    // Grant count UNCHANGED (ON CONFLICT DO NOTHING).
    const grantsAfterSecond = await withTenantTx(
      { tenantId: TENANT1_ID, userId: adminUserId, branchId: null },
      async (tx) =>
        tx
          .select({ id: crossBranchAccessGrants.id })
          .from(crossBranchAccessGrants)
          .where(
            and(
              eq(crossBranchAccessGrants.tenantId, TENANT1_ID),
              eq(crossBranchAccessGrants.targetBranchId, branchBBigintId),
              eq(crossBranchAccessGrants.patientId, patientBigintId),
            ),
          ),
    )
    expect(grantsAfterSecond).toHaveLength(1)

    // Audit row fires on EVERY access — now two with the same correlation_id.
    const auditAfterSecond = await countCrossBranchAuditRows(correlationId)
    expect(auditAfterSecond).toBe(2)
  })
})

/** Count audit_logs rows for our break-glass scenario by correlation_id. */
async function countCrossBranchAuditRows(correlationId: string): Promise<number> {
  const rows = await withTenantTx(
    { tenantId: TENANT1_ID, userId: adminUserId, branchId: null },
    async (tx) =>
      tx
        .select({ id: auditLogs.id, entityId: auditLogs.entityId })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, TENANT1_ID),
            eq(auditLogs.action, 'CROSS_BRANCH_ACCESS'),
            eq(auditLogs.correlationId, correlationId),
          ),
        ),
  )
  // Every row must point at our patient (entity_id is the patient bigint text).
  expect(rows.every((r) => r.entityId === String(patientBigintId))).toBe(true)
  return rows.length
}
