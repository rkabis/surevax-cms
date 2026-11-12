/**
 * Integration tests for the status-history triggers.
 *
 * For each of the 5 tables wired with write_status_history():
 *   - patient_standing_orders → patient_standing_orders_status_history
 *   - clinical_orders         → clinical_orders_status_history
 *   - encounters              → encounters_status_history
 *   - transactions            → transactions_status_history
 *   - lab_orders              → lab_orders_status_history
 *
 * Each suite:
 *   (a) Status change → exactly one history row written with correct fields.
 *   (b) Non-status UPDATE → no history row written.
 *   (c) [shared negative] UPDATE without app.current_user_id → succeeds,
 *       changed_by_id is NULL (trigger does NOT raise).
 *
 * Two-tier IDs (2026-05-19 ID redesign):
 *   - All status_history.entity_id columns are bigint pointing at the
 *     parent row's bigint PK. We capture each parent bigint via
 *     `.returning({ id })` rather than asserting against display IDs.
 *   - `changedById` is bigint pointing at users.id.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { sql, eq, and } from 'drizzle-orm'
import { db } from '../../src/shared/db/index.js'
import { withTenantTx } from '../../src/shared/db/withTenantTx.js'
import { displayId } from '../../src/shared/utils/displayId.js'
import {
  patientStandingOrders,
  patientStandingOrdersStatusHistory,
  clinicalOrders,
  clinicalOrdersStatusHistory,
  encounters,
  encountersStatusHistory,
  transactions,
  transactionsStatusHistory,
  labOrders,
  labOrdersStatusHistory,
  users,
  patients,
  branches,
} from '../../src/shared/db/schema.js'
import {
  PAT_DELACRUZ_DISPLAY_ID,
  SOT_RABIES_PEP_IM,
  SVC_ARVPEP_IM,
} from '../../src/shared/db/seed/constants.js'

const TENANT_ID = 'SVX'

// Runtime-resolved bigints (parent FKs).
let adminUserId = 0
let patientBigintId = 0
let branchBigintId = 0
let parentEncounterBigintId = 0

// Test-owned row bigints (captured at insert via .returning()).
let testPsoId = 0
let testCoId = 0
let testCoNonStatusId = 0
let testEncId = 0
let testTxnId = 0
let testLabId = 0
let testTxnNoUserId = 0

async function countHistory(
  histTable:
    | typeof patientStandingOrdersStatusHistory
    | typeof clinicalOrdersStatusHistory
    | typeof encountersStatusHistory
    | typeof transactionsStatusHistory
    | typeof labOrdersStatusHistory,
  entityBigintId: number,
): Promise<number> {
  const rows = await db
    .select({ entityId: histTable.entityId })
    .from(histTable)
    .where(and(eq(histTable.tenantId, TENANT_ID), eq(histTable.entityId, entityBigintId)))
  return rows.length
}

async function latestHistory<
  T extends
    | typeof patientStandingOrdersStatusHistory
    | typeof clinicalOrdersStatusHistory
    | typeof encountersStatusHistory
    | typeof transactionsStatusHistory
    | typeof labOrdersStatusHistory,
>(histTable: T, entityBigintId: number) {
  const rows = await db
    .select()
    .from(histTable)
    .where(and(eq(histTable.tenantId, TENANT_ID), eq(histTable.entityId, entityBigintId)))
    .orderBy(sql`${histTable.changedAt} desc`)
    .limit(1)
  return rows[0] ?? null
}

beforeAll(async () => {
  // Resolve seeded admin / patient / branch bigints.
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'admin@surevax.com'))
    .limit(1)
  if (!admin) throw new Error('seeded admin user not found')
  adminUserId = admin.id

  const [pat] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.tenantId, TENANT_ID), eq(patients.displayId, PAT_DELACRUZ_DISPLAY_ID)))
    .limit(1)
  if (!pat) throw new Error('seeded De La Cruz patient not found')
  patientBigintId = pat.id

  const [br] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.tenantId, TENANT_ID), eq(branches.code, 'HST')))
    .limit(1)
  if (!br) throw new Error('seeded HST branch not found')
  branchBigintId = br.id

  // Seeded encounter under De La Cruz (any one works as the PSO parent).
  const [enc] = await db
    .select({ id: encounters.id })
    .from(encounters)
    .where(and(eq(encounters.tenantId, TENANT_ID), eq(encounters.patientId, patientBigintId)))
    .limit(1)
  if (!enc) throw new Error('no seeded encounter for De La Cruz')
  parentEncounterBigintId = enc.id

  const ctx = { tenantId: TENANT_ID, userId: adminUserId, branchId: branchBigintId }

  // Test PSO.
  await withTenantTx(ctx, async (tx) => {
    const rows = await tx
      .insert(patientStandingOrders)
      .values({
        displayId: displayId('PSO'),
        tenantId: TENANT_ID,
        patientId: patientBigintId,
        templateId: SOT_RABIES_PEP_IM,
        initiatingEncounterId: parentEncounterBigintId,
        status: 'Active',
        startDate: new Date(),
      })
      .returning({ id: patientStandingOrders.id })
    testPsoId = rows[0]!.id
  })

  // Test CO #1 (drives the status-change suite).
  await withTenantTx(ctx, async (tx) => {
    const rows = await tx
      .insert(clinicalOrders)
      .values({
        displayId: displayId('ORD'),
        tenantId: TENANT_ID,
        patientStandingOrderId: testPsoId,
        serviceId: SVC_ARVPEP_IM,
        patientId: patientBigintId,
        orderType: 'Standing_Order',
        status: 'Scheduled',
      })
      .returning({ id: clinicalOrders.id })
    testCoId = rows[0]!.id
  })

  // Test CO #2 (drives the non-status-update suite — kept Scheduled).
  await withTenantTx(ctx, async (tx) => {
    const rows = await tx
      .insert(clinicalOrders)
      .values({
        displayId: displayId('ORD'),
        tenantId: TENANT_ID,
        patientStandingOrderId: testPsoId,
        serviceId: SVC_ARVPEP_IM,
        patientId: patientBigintId,
        orderType: 'Standing_Order',
        status: 'Scheduled',
      })
      .returning({ id: clinicalOrders.id })
    testCoNonStatusId = rows[0]!.id
  })

  // Test encounter (fresh — Open status).
  await withTenantTx(ctx, async (tx) => {
    const rows = await tx
      .insert(encounters)
      .values({
        displayId: displayId('ENC'),
        tenantId: TENANT_ID,
        patientId: patientBigintId,
        branchId: branchBigintId,
        specialty: 'General',
        status: 'Open',
      })
      .returning({ id: encounters.id })
    testEncId = rows[0]!.id
  })

  // Test transaction.
  await withTenantTx(ctx, async (tx) => {
    const rows = await tx
      .insert(transactions)
      .values({
        displayId: displayId('TXN'),
        tenantId: TENANT_ID,
        branchId: branchBigintId,
        patientId: patientBigintId,
        status: 'Draft',
        grossAmount: '0',
        discountAmount: '0',
        vatAmount: '0',
        vatRate: '0.12',
        netAmount: '0',
        amountPaid: '0',
      })
      .returning({ id: transactions.id })
    testTxnId = rows[0]!.id
  })

  // Test lab order (FK to test CO #1).
  await withTenantTx(ctx, async (tx) => {
    const rows = await tx
      .insert(labOrders)
      .values({
        displayId: displayId('LBO'),
        tenantId: TENANT_ID,
        clinicalOrderId: testCoId,
        branchId: branchBigintId,
        status: 'Pending',
      })
      .returning({ id: labOrders.id })
    testLabId = rows[0]!.id
  })

  // Separate transaction for the "no user GUC" negative suite.
  await withTenantTx(ctx, async (tx) => {
    const rows = await tx
      .insert(transactions)
      .values({
        displayId: displayId('TXN'),
        tenantId: TENANT_ID,
        branchId: branchBigintId,
        patientId: patientBigintId,
        status: 'Draft',
        grossAmount: '0',
        discountAmount: '0',
        vatAmount: '0',
        vatRate: '0.12',
        netAmount: '0',
        amountPaid: '0',
      })
      .returning({ id: transactions.id })
    testTxnNoUserId = rows[0]!.id
  })
})

// ---------------------------------------------------------------------------
// 1. patient_standing_orders
// ---------------------------------------------------------------------------

describe('status-history trigger: patient_standing_orders', () => {
  it('writes a history row when status changes Active → Completed', async () => {
    const before = await countHistory(patientStandingOrdersStatusHistory, testPsoId)

    await withTenantTx(
      { tenantId: TENANT_ID, userId: adminUserId, branchId: branchBigintId },
      async (tx) => {
        await tx
          .update(patientStandingOrders)
          .set({ status: 'Completed' })
          .where(eq(patientStandingOrders.id, testPsoId))
      },
    )

    const after = await countHistory(patientStandingOrdersStatusHistory, testPsoId)
    expect(after).toBe(before + 1)

    const row = await latestHistory(patientStandingOrdersStatusHistory, testPsoId)
    expect(row).not.toBeNull()
    expect(row!.entityId).toBe(testPsoId)
    expect(row!.fromStatus).toBe('Active')
    expect(row!.toStatus).toBe('Completed')
    expect(row!.changedById).toBe(adminUserId)
    expect(new Date().getTime() - new Date(row!.changedAt).getTime()).toBeLessThan(10_000)
  })

  it('does NOT write a history row when a non-status column is updated', async () => {
    const before = await countHistory(patientStandingOrdersStatusHistory, testPsoId)

    await withTenantTx(
      { tenantId: TENANT_ID, userId: adminUserId, branchId: branchBigintId },
      async (tx) => {
        await tx
          .update(patientStandingOrders)
          .set({ notes: 'Touched non-status column' })
          .where(eq(patientStandingOrders.id, testPsoId))
      },
    )

    const after = await countHistory(patientStandingOrdersStatusHistory, testPsoId)
    expect(after).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// 2. clinical_orders
// ---------------------------------------------------------------------------

describe('status-history trigger: clinical_orders', () => {
  it('writes a history row when status changes Scheduled → Completed', async () => {
    const before = await countHistory(clinicalOrdersStatusHistory, testCoId)

    await withTenantTx(
      { tenantId: TENANT_ID, userId: adminUserId, branchId: branchBigintId },
      async (tx) => {
        await tx
          .update(clinicalOrders)
          .set({ status: 'Completed' })
          .where(eq(clinicalOrders.id, testCoId))
      },
    )

    const after = await countHistory(clinicalOrdersStatusHistory, testCoId)
    expect(after).toBe(before + 1)

    const row = await latestHistory(clinicalOrdersStatusHistory, testCoId)
    expect(row).not.toBeNull()
    expect(row!.entityId).toBe(testCoId)
    expect(row!.fromStatus).toBe('Scheduled')
    expect(row!.toStatus).toBe('Completed')
    expect(row!.changedById).toBe(adminUserId)
    expect(new Date().getTime() - new Date(row!.changedAt).getTime()).toBeLessThan(10_000)
  })

  it('does NOT write a history row when a non-status column is updated', async () => {
    const before = await countHistory(clinicalOrdersStatusHistory, testCoNonStatusId)

    await withTenantTx(
      { tenantId: TENANT_ID, userId: adminUserId, branchId: branchBigintId },
      async (tx) => {
        await tx
          .update(clinicalOrders)
          .set({ notes: JSON.stringify({ test: 'non-status update' }) })
          .where(eq(clinicalOrders.id, testCoNonStatusId))
      },
    )

    const after = await countHistory(clinicalOrdersStatusHistory, testCoNonStatusId)
    expect(after).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// 3. encounters
// ---------------------------------------------------------------------------

describe('status-history trigger: encounters', () => {
  it('writes a history row when status changes Open → Completed', async () => {
    const before = await countHistory(encountersStatusHistory, testEncId)

    await withTenantTx(
      { tenantId: TENANT_ID, userId: adminUserId, branchId: branchBigintId },
      async (tx) => {
        await tx.update(encounters).set({ status: 'Completed' }).where(eq(encounters.id, testEncId))
      },
    )

    const after = await countHistory(encountersStatusHistory, testEncId)
    expect(after).toBe(before + 1)

    const row = await latestHistory(encountersStatusHistory, testEncId)
    expect(row).not.toBeNull()
    expect(row!.entityId).toBe(testEncId)
    expect(row!.fromStatus).toBe('Open')
    expect(row!.toStatus).toBe('Completed')
    expect(row!.changedById).toBe(adminUserId)
    expect(new Date().getTime() - new Date(row!.changedAt).getTime()).toBeLessThan(10_000)
  })

  it('does NOT write a history row when a non-status column is updated', async () => {
    const before = await countHistory(encountersStatusHistory, testEncId)

    await withTenantTx(
      { tenantId: TENANT_ID, userId: adminUserId, branchId: branchBigintId },
      async (tx) => {
        await tx
          .update(encounters)
          .set({ chiefComplaint: 'Updated chief complaint only' })
          .where(eq(encounters.id, testEncId))
      },
    )

    const after = await countHistory(encountersStatusHistory, testEncId)
    expect(after).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// 4. transactions
// ---------------------------------------------------------------------------

describe('status-history trigger: transactions', () => {
  it('writes a history row when status changes Draft → Pending', async () => {
    const before = await countHistory(transactionsStatusHistory, testTxnId)

    await withTenantTx(
      { tenantId: TENANT_ID, userId: adminUserId, branchId: branchBigintId },
      async (tx) => {
        await tx
          .update(transactions)
          .set({ status: 'Pending' })
          .where(eq(transactions.id, testTxnId))
      },
    )

    const after = await countHistory(transactionsStatusHistory, testTxnId)
    expect(after).toBe(before + 1)

    const row = await latestHistory(transactionsStatusHistory, testTxnId)
    expect(row).not.toBeNull()
    expect(row!.entityId).toBe(testTxnId)
    expect(row!.fromStatus).toBe('Draft')
    expect(row!.toStatus).toBe('Pending')
    expect(row!.changedById).toBe(adminUserId)
    expect(new Date().getTime() - new Date(row!.changedAt).getTime()).toBeLessThan(10_000)
  })

  it('does NOT write a history row when a non-status column is updated', async () => {
    const before = await countHistory(transactionsStatusHistory, testTxnId)

    await withTenantTx(
      { tenantId: TENANT_ID, userId: adminUserId, branchId: branchBigintId },
      async (tx) => {
        await tx
          .update(transactions)
          .set({ grossAmount: '100.00' })
          .where(eq(transactions.id, testTxnId))
      },
    )

    const after = await countHistory(transactionsStatusHistory, testTxnId)
    expect(after).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// 5. lab_orders
// ---------------------------------------------------------------------------

describe('status-history trigger: lab_orders', () => {
  it('writes a history row when status changes Pending → Sent', async () => {
    const before = await countHistory(labOrdersStatusHistory, testLabId)

    await withTenantTx(
      { tenantId: TENANT_ID, userId: adminUserId, branchId: branchBigintId },
      async (tx) => {
        await tx.update(labOrders).set({ status: 'Sent' }).where(eq(labOrders.id, testLabId))
      },
    )

    const after = await countHistory(labOrdersStatusHistory, testLabId)
    expect(after).toBe(before + 1)

    const row = await latestHistory(labOrdersStatusHistory, testLabId)
    expect(row).not.toBeNull()
    expect(row!.entityId).toBe(testLabId)
    expect(row!.fromStatus).toBe('Pending')
    expect(row!.toStatus).toBe('Sent')
    expect(row!.changedById).toBe(adminUserId)
    expect(new Date().getTime() - new Date(row!.changedAt).getTime()).toBeLessThan(10_000)
  })

  it('does NOT write a history row when a non-status column is updated', async () => {
    const before = await countHistory(labOrdersStatusHistory, testLabId)

    await withTenantTx(
      { tenantId: TENANT_ID, userId: adminUserId, branchId: branchBigintId },
      async (tx) => {
        await tx
          .update(labOrders)
          .set({ notes: 'Updated notes only' })
          .where(eq(labOrders.id, testLabId))
      },
    )

    const after = await countHistory(labOrdersStatusHistory, testLabId)
    expect(after).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// Negative test: UPDATE without app.current_user_id set
// ---------------------------------------------------------------------------

describe('status-history trigger: missing app.current_user_id GUC', () => {
  it('succeeds and writes changed_by_id = null when app.current_user_id is not set', async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_tenant_id', ${TENANT_ID}, true)`)
      await tx.execute(sql`select set_config('app.current_user_id', '', true)`)
      await tx.execute(
        sql`select set_config('app.current_branch_id', ${String(branchBigintId)}, true)`,
      )

      // Must not throw.
      await tx
        .update(transactions)
        .set({ status: 'Pending' })
        .where(eq(transactions.id, testTxnNoUserId))
    })

    const row = await latestHistory(transactionsStatusHistory, testTxnNoUserId)
    expect(row).not.toBeNull()
    expect(row!.fromStatus).toBe('Draft')
    expect(row!.toStatus).toBe('Pending')
    expect(row!.changedById).toBeNull()
  })
})
