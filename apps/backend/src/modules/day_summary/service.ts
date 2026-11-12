/**
 * day_summary/service.ts — orchestrates the Day Summary aggregation.
 *
 * All queries run inside a single withTenantTx so the RLS GUCs are set once
 * and the snapshot is consistent.
 *
 * Two-tier IDs (W3.c.4): `branchId` is bigint (branches.id). On the wire
 * we surface `branchId` as the branches.display_id text (slug.CODE), via a
 * lookup at projection time. day_summary_snapshots.id is bigint; the public
 * handle is its DSS_<8 base32> display_id.
 */

import { sql, eq, and } from 'drizzle-orm'
import { withTenantTx, type Tx } from '../../shared/db/withTenantTx.js'
import { displayId } from '../../shared/utils/displayId.js'
import { branches, daySummarySnapshots, users } from '../../shared/db/schema.js'
import {
  getTransactionSummary,
  getAdministrationSummary,
  getEncounterSummary,
  getTodayRoster,
  getInventorySummary,
  getDrawerSummary,
  getBranchName,
  getUnsettledTransactions,
  getOpenPriorDrawers,
  getUndocumentedAdministrations,
  assignTodayEncounterOwner,
} from './db.js'

type DaySummaryCtx = {
  tenantId: string
  userId: number
  branchId: number
  date: string // 'YYYY-MM-DD'
}

async function requireBranchDisplayId(tx: Tx, tenantId: string, branchId: number): Promise<string> {
  const [row] = await tx
    .select({ displayId: branches.displayId })
    .from(branches)
    .where(and(eq(branches.tenantId, tenantId), eq(branches.id, branchId)))
    .limit(1)

  if (!row) {
    throw new Error('day_summary: branch display ID unavailable in tenant scope')
  }
  return row.displayId
}

export async function getDaySummary(opts: DaySummaryCtx) {
  const { tenantId, userId, branchId, date } = opts

  return withTenantTx({ tenantId, userId, branchId }, async (tx) => {
    // Run all aggregation queries in parallel for a single consistent snapshot.
    const [
      branchName,
      branchDisplayId,
      transactionsSummary,
      administrationsSummary,
      encountersSummary,
      inventorySummary,
      drawerSummary,
    ] = await Promise.all([
      getBranchName(tx, tenantId, branchId),
      requireBranchDisplayId(tx, tenantId, branchId),
      getTransactionSummary(tx, tenantId, branchId, date),
      getAdministrationSummary(tx, tenantId, branchId, date),
      getEncounterSummary(tx, tenantId, branchId, date),
      getInventorySummary(tx, tenantId, branchId, date),
      getDrawerSummary(tx, tenantId, branchId, date),
    ])

    return {
      date,
      // Surface branchId as the public display_id (slug.CODE), not bigint.
      branchId: branchDisplayId,
      branchName,
      generatedAt: new Date().toISOString(),
      transactions: transactionsSummary,
      administrations: administrationsSummary,
      encounters: encountersSummary,
      inventory: inventorySummary,
      drawer: drawerSummary,
    }
  })
}

/**
 * Live operational roster for /today. Branch identity, rows, and generatedAt
 * are produced inside one tenant transaction so the client never receives a
 * branch label from one snapshot and patients from another.
 */
export async function getTodayRosterSnapshot(opts: DaySummaryCtx) {
  const { tenantId, userId, branchId, date } = opts

  return withTenantTx({ tenantId, userId, branchId }, async (tx) => {
    const [branchName, branchDisplayId, roster] = await Promise.all([
      getBranchName(tx, tenantId, branchId),
      requireBranchDisplayId(tx, tenantId, branchId),
      getTodayRoster(tx, tenantId, branchId, date),
    ])

    return {
      date,
      branchId: branchDisplayId,
      branchName,
      generatedAt: new Date().toISOString(),
      roster,
    }
  })
}

export async function setTodayEncounterOwner(opts: {
  tenantId: string
  userId: number
  branchId: number
  encounterDisplayId: string
  ownerUserId: number
  expectedRowVersion: number
}) {
  return withTenantTx(
    { tenantId: opts.tenantId, userId: opts.userId, branchId: opts.branchId },
    (tx) => assignTodayEncounterOwner(tx, opts),
  )
}

/**
 * Persist (upsert) the current Day Summary aggregate as a snapshot.
 * Re-snapshotting the same `(tenant, branch, date)` overwrites the payload
 * so the latest-state-of-the-day view is always retrievable.
 */
export async function createDaySnapshot(opts: DaySummaryCtx) {
  const { tenantId, userId, branchId, date } = opts
  const summary = await getDaySummary({ tenantId, userId, branchId, date })

  return withTenantTx({ tenantId, userId, branchId }, async (tx) => {
    const newDisplayId = displayId('DSS')
    const payload = JSON.stringify(summary)
    // Upsert: re-snapshotting the same (tenant, branch, date) reuses the
    // existing row and only overwrites the payload — the original display_id
    // is preserved by ON CONFLICT.
    const [row] = await tx.execute<{
      display_id: string
      created_at: string
    }>(sql`
      INSERT INTO day_summary_snapshots
        (display_id, tenant_id, branch_id, snapshot_date, payload, created_by_id, created_at)
      VALUES
        (${newDisplayId}, ${tenantId}, ${branchId}, ${date}::date, ${payload}::jsonb, ${userId}, now())
      ON CONFLICT (tenant_id, branch_id, snapshot_date)
      DO UPDATE SET
        payload = EXCLUDED.payload,
        created_by_id = EXCLUDED.created_by_id,
        created_at = EXCLUDED.created_at
      RETURNING display_id, created_at
    `)

    return {
      id: row?.display_id ?? newDisplayId,
      date,
      branchId: summary.branchId,
      createdAt: row?.created_at ?? new Date().toISOString(),
      payload: summary,
    }
  })
}

/**
 * Aggregate yesterday's unresolved business for a branch.
 * Three parallel queries: unsettled transactions, open prior drawers, undocumented administrations.
 */
export async function getLooseEnds(opts: DaySummaryCtx) {
  const { tenantId, userId, branchId, date } = opts

  return withTenantTx({ tenantId, userId, branchId }, async (tx) => {
    const [unsettledTransactions, openPriorDrawers, undocumentedAdministrations, branchDisplayId] =
      await Promise.all([
        getUnsettledTransactions(tx, tenantId, branchId, date),
        getOpenPriorDrawers(tx, tenantId, branchId, date),
        getUndocumentedAdministrations(tx, tenantId, branchId, date),
        requireBranchDisplayId(tx, tenantId, branchId),
      ])

    return {
      date,
      branchId: branchDisplayId,
      unsettledTransactions,
      openPriorDrawers,
      undocumentedAdministrations,
    }
  })
}

/**
 * Fetch the most recent snapshot for a (branch, date). Returns null if none.
 */
export async function getDaySnapshot(opts: DaySummaryCtx) {
  const { tenantId, userId, branchId, date } = opts

  return withTenantTx({ tenantId, userId, branchId }, async (tx) => {
    const [row] = await tx
      .select({
        displayId: daySummarySnapshots.displayId,
        branchId: daySummarySnapshots.branchId,
        snapshotDate: daySummarySnapshots.snapshotDate,
        payload: daySummarySnapshots.payload,
        createdById: daySummarySnapshots.createdById,
        createdAt: daySummarySnapshots.createdAt,
      })
      .from(daySummarySnapshots)
      .where(
        and(
          eq(daySummarySnapshots.tenantId, tenantId),
          eq(daySummarySnapshots.branchId, branchId),
          eq(daySummarySnapshots.snapshotDate, date),
        ),
      )
      .limit(1)

    if (!row) return null

    const [createdByRow] = await tx
      .select({ displayId: users.displayId })
      .from(users)
      .where(eq(users.id, row.createdById))
      .limit(1)
    // Resolve the public branch handle inside the same RLS-scoped
    // transaction. A bare `db` lookup has no tenant GUC under FORCE RLS,
    // returns no row, and would leak the internal bigint fallback.
    const branchDisplayId = await requireBranchDisplayId(tx, tenantId, row.branchId)
    return {
      id: row.displayId,
      date: row.snapshotDate,
      branchId: branchDisplayId,
      createdAt:
        row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      createdById: createdByRow?.displayId ?? null,
      payload: row.payload,
    }
  })
}
