/**
 * day_summary/db.ts — Drizzle queries for the Day Summary endpoint.
 *
 * Two-tier IDs (W3.c.4): all primary keys / foreign keys are bigint internals.
 * Public surfaces (orderId, sessionId, movementId, lotId, patientId) project
 * the `display_id` text column from the underlying tables — never leak bigint.
 * The `branchId` filter is the caller's bigint branches.id.
 *
 * DATE SEMANTICS: All timestamp columns are timestamptz. Calendar-day filters
 * explicitly project them through Asia/Manila so results do not depend on the
 * PostgreSQL server timezone.
 */

import { sql } from 'drizzle-orm'
import type { Tx } from '../../shared/db/withTenantTx.js'

// ── Transactions ─────────────────────────────────────────────────────────────

export async function getTransactionSummary(
  tx: Tx,
  tenantId: string,
  branchId: number,
  date: string,
) {
  // Aggregate counts + totals for transactions on the given date for this branch.
  // Revenue excludes Voided rows (a voided txn collected nothing) and Refunded
  // rows (the matching refund line nets to zero — counting both sides would
  // double-deduct). Draft is included because the cashier intends to collect.
  // Outstanding (amount_outstanding) excludes Voided so the dashboard doesn't
  // show a fake AR balance for txns that were nulled out.
  const [agg] = await tx.execute<{
    count: string
    totalRevenue: string
    totalUnsettled: string
  }>(sql`
    SELECT
      COUNT(*)::text                              AS count,
      COALESCE(SUM(net_amount) FILTER (
        WHERE status NOT IN ('Voided', 'Refunded') AND is_prepayment = false
      ), 0)::numeric(12,2)::text                  AS "totalRevenue",
      COALESCE(SUM(amount_outstanding) FILTER (
        WHERE status NOT IN ('Voided', 'Refunded') AND is_prepayment = false
      ), 0)::numeric(12,2)::text                  AS "totalUnsettled"
    FROM transactions
    WHERE tenant_id = ${tenantId}
      AND branch_id = ${branchId}
      AND (transacted_at AT TIME ZONE 'Asia/Manila')::date = ${date}::date
      AND deleted_at IS NULL
  `)

  // Breakdown by payment method — join through payments table. Deposits
  // (is_prepayment) are excluded: their funding cash is a liability, recognized
  // only when drawn as a 'Credit' payment on the real consuming transaction.
  // A voided payment is a corrected-and-replaced row (the original stays on
  // the table for audit, a new row carries the fixed method/amount); counting
  // it here would double the total against its replacement and would
  // misattribute the corrected amount to the wrong method's bucket.
  const byMethod = await tx.execute<{ method: string; count: string; total: string }>(sql`
    SELECT
      p.method,
      COUNT(*)::text        AS count,
      SUM(p.amount)::numeric(12,2)::text AS total
    FROM payments p
    JOIN transactions t ON t.id = p.transaction_id
    WHERE t.tenant_id = ${tenantId}
      AND t.branch_id = ${branchId}
      AND (t.transacted_at AT TIME ZONE 'Asia/Manila')::date = ${date}::date
      AND t.deleted_at IS NULL
      AND t.status NOT IN ('Voided', 'Refunded')
      AND t.is_prepayment = false
      AND p.voided_at IS NULL
    GROUP BY p.method
    ORDER BY p.method
  `)

  // Breakdown by status.
  const byStatus = await tx.execute<{ status: string; count: string; total: string }>(sql`
    SELECT
      status,
      COUNT(*)::text                              AS count,
      COALESCE(SUM(net_amount), 0)::numeric(12,2)::text AS total
    FROM transactions
    WHERE tenant_id = ${tenantId}
      AND branch_id = ${branchId}
      AND (transacted_at AT TIME ZONE 'Asia/Manila')::date = ${date}::date
      AND deleted_at IS NULL
    GROUP BY status
    ORDER BY status
  `)

  return {
    count: parseInt(agg?.count ?? '0', 10),
    totalRevenue: agg?.totalRevenue ?? '0.00',
    totalUnsettled: agg?.totalUnsettled ?? '0.00',
    byMethod: byMethod.map((r) => ({
      method: r.method,
      count: parseInt(r.count, 10),
      total: r.total,
    })),
    byStatus: byStatus.map((r) => ({
      status: r.status,
      count: parseInt(r.count, 10),
      total: r.total,
    })),
  }
}

// ── Administrations ───────────────────────────────────────────────────────────
// Clinical orders that were completed on the given date, scoped to this branch
// via their linked encounter's branch_id (clinical_orders has no direct branch_id).

export async function getAdministrationSummary(
  tx: Tx,
  tenantId: string,
  branchId: number,
  date: string,
) {
  const rows = await tx.execute<{
    orderId: string
    patientId: string
    patientFirstName: string
    patientLastName: string
    serviceName: string
    lotNumber: string | null
    completedAt: string
    administeredByFirstName: string | null
    administeredByLastName: string | null
  }>(sql`
    SELECT
      co.display_id                 AS "orderId",
      p.display_id                  AS "patientId",
      p.first_name                  AS "patientFirstName",
      p.last_name                   AS "patientLastName",
      sc.name                       AS "serviceName",
      il.batch_number               AS "lotNumber",
      co.completed_at               AS "completedAt",
      u.first_name                  AS "administeredByFirstName",
      u.last_name                   AS "administeredByLastName"
    FROM clinical_orders co
    JOIN encounters e ON e.id = co.encounter_id
    JOIN patients p ON p.id = co.patient_id AND p.tenant_id = ${tenantId}
    JOIN service_catalog sc ON sc.id = co.service_id AND sc.tenant_id = ${tenantId}
    LEFT JOIN inventory_lots il ON il.id = co.lot_id AND il.tenant_id = ${tenantId}
    LEFT JOIN users u ON u.id = co.administered_by_id AND u.tenant_id = ${tenantId}
    WHERE co.tenant_id = ${tenantId}
      AND e.branch_id = ${branchId}
      AND e.tenant_id = ${tenantId}
      AND co.status = 'Completed'
      AND (co.completed_at AT TIME ZONE 'Asia/Manila')::date = ${date}::date
      AND co.deleted_at IS NULL
    ORDER BY co.completed_at ASC
  `)

  return {
    count: rows.length,
    rows: rows.map((r) => ({
      orderId: r.orderId,
      patientId: r.patientId,
      patientName: `${r.patientFirstName} ${r.patientLastName}`.trim(),
      serviceName: r.serviceName,
      lotNumber: r.lotNumber ?? null,
      administeredAt: r.completedAt,
      administeredByName:
        r.administeredByFirstName || r.administeredByLastName
          ? `${r.administeredByFirstName ?? ''} ${r.administeredByLastName ?? ''}`.trim()
          : null,
    })),
  }
}

// ── Encounters ───────────────────────────────────────────────────────────────

export async function getEncounterSummary(
  tx: Tx,
  tenantId: string,
  branchId: number,
  date: string,
) {
  const [countRow] = await tx.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM encounters
    WHERE tenant_id = ${tenantId}
      AND branch_id = ${branchId}
      AND (started_at AT TIME ZONE 'Asia/Manila')::date = ${date}::date
      AND deleted_at IS NULL
  `)

  // Group by specialty (maps to spec's bundleLabel).
  const byBundle = await tx.execute<{ bundleLabel: string; count: string }>(sql`
    SELECT
      specialty AS "bundleLabel",
      COUNT(*)::text AS count
    FROM encounters
    WHERE tenant_id = ${tenantId}
      AND branch_id = ${branchId}
      AND (started_at AT TIME ZONE 'Asia/Manila')::date = ${date}::date
      AND deleted_at IS NULL
    GROUP BY specialty
    ORDER BY specialty
  `)

  // WHO triage categories — only populated for rabies specialty encounters.
  const byWhoCategory = await tx.execute<{ category: string; count: string }>(sql`
    SELECT
      triage_category AS category,
      COUNT(*)::text AS count
    FROM encounters
    WHERE tenant_id = ${tenantId}
      AND branch_id = ${branchId}
      AND (started_at AT TIME ZONE 'Asia/Manila')::date = ${date}::date
      AND deleted_at IS NULL
      AND specialty = 'Rabies'
      AND triage_category IS NOT NULL
    GROUP BY triage_category
    ORDER BY triage_category
  `)

  return {
    count: parseInt(countRow?.count ?? '0', 10),
    byBundle: byBundle.map((r) => ({ bundleLabel: r.bundleLabel, count: parseInt(r.count, 10) })),
    byWhoCategory: byWhoCategory.map((r) => ({
      category: r.category,
      count: parseInt(r.count, 10),
    })),
  }
}

// ── Today roster ─────────────────────────────────────────────────────────────

type TodayRosterDbRow = {
  id: string
  patientId: string
  patientFirstName: string
  patientLastName: string
  patientMrn: string
  specialty: string
  status: string
  startedAt: string | Date
  completedAt: string | Date | null
  updatedAt: string | Date
  rowVersion: number
  providerId: string | null
  providerFirstName: string | null
  providerLastName: string | null
  providerRole: string | null
  pendingTransactionId: string | null
}

/**
 * Complete branch roster for one Philippine clinic day. There is deliberately
 * no LIMIT: this endpoint is the operational source for /today, where silently
 * dropping the sixth patient is a safety failure rather than pagination.
 */
export async function getTodayRoster(tx: Tx, tenantId: string, branchId: number, date: string) {
  const rows = await tx.execute<TodayRosterDbRow>(sql`
    SELECT
      e.display_id                                      AS id,
      p.display_id                                      AS "patientId",
      p.first_name                                      AS "patientFirstName",
      p.last_name                                       AS "patientLastName",
      p.mrn                                             AS "patientMrn",
      e.specialty::text                                 AS specialty,
      e.status::text                                    AS status,
      e.started_at                                      AS "startedAt",
      e.completed_at                                    AS "completedAt",
      e.updated_at                                      AS "updatedAt",
      e.row_version                                     AS "rowVersion",
      u.display_id                                      AS "providerId",
      u.first_name                                      AS "providerFirstName",
      u.last_name                                       AS "providerLastName",
      (
        SELECT ur.role::text
        FROM user_roles ur
        WHERE ur.user_id = u.id
          AND (ur.expires_at IS NULL OR ur.expires_at > now())
        ORDER BY CASE ur.role::text
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
      )                                                 AS "providerRole",
      pending_tx.display_id                             AS "pendingTransactionId"
    FROM encounters e
    JOIN patients p
      ON p.id = e.patient_id AND p.tenant_id = ${tenantId}
    LEFT JOIN users u
      ON u.id = e.provider_id AND u.tenant_id = ${tenantId}
    LEFT JOIN LATERAL (
      SELECT t.display_id
      FROM transactions t
      WHERE t.tenant_id = ${tenantId}
        AND t.branch_id = ${branchId}
        AND t.encounter_id = e.id
        AND t.status IN ('Draft', 'Pending')
        AND t.is_prepayment = false
        AND t.amount_outstanding > 0
        AND t.deleted_at IS NULL
      ORDER BY t.transacted_at DESC, t.id DESC
      LIMIT 1
    ) pending_tx ON TRUE
    WHERE e.tenant_id = ${tenantId}
      AND e.branch_id = ${branchId}
      AND (e.started_at AT TIME ZONE 'Asia/Manila')::date = ${date}::date
      AND e.deleted_at IS NULL
    ORDER BY
      CASE WHEN e.status::text IN ('Completed', 'Cancelled', 'NoShow') THEN 1 ELSE 0 END,
      e.started_at ASC,
      e.id ASC
  `)

  return rows.map((row) => {
    const startedAt = new Date(row.startedAt).toISOString()
    const completedAt = row.completedAt ? new Date(row.completedAt).toISOString() : null
    const updatedAt = new Date(row.updatedAt).toISOString()
    const providerName =
      row.providerFirstName || row.providerLastName
        ? `${row.providerFirstName ?? ''} ${row.providerLastName ?? ''}`.trim()
        : null
    const claimedBy =
      row.providerId && providerName
        ? { id: row.providerId, name: providerName, role: row.providerRole }
        : null

    let handoffState:
      | 'waiting_clinical'
      | 'in_care'
      | 'on_hold'
      | 'awaiting_payment'
      | 'complete'
      | 'closed'
    let nextOwner: { role: string; label: string } | null

    if (row.status === 'Completed') {
      handoffState = row.pendingTransactionId ? 'awaiting_payment' : 'complete'
      nextOwner = row.pendingTransactionId ? { role: 'Cashier', label: 'Cashier' } : null
    } else if (row.status === 'Cancelled' || row.status === 'NoShow') {
      handoffState = 'closed'
      nextOwner = null
    } else if (row.status === 'OnHold') {
      handoffState = 'on_hold'
      nextOwner = { role: 'ClinicalTeam', label: 'Clinical team' }
    } else if (claimedBy) {
      handoffState = 'in_care'
      nextOwner = { role: claimedBy.role ?? 'ClinicalTeam', label: claimedBy.name }
    } else {
      handoffState = 'waiting_clinical'
      nextOwner = { role: 'ClinicalTeam', label: 'Clinical team' }
    }

    return {
      id: row.id,
      patientId: row.patientId,
      patientName: `${row.patientLastName}, ${row.patientFirstName}`,
      patientMrn: row.patientMrn,
      specialty: row.specialty,
      status: row.status,
      startedAt,
      completedAt,
      claimedBy,
      waitingSince: startedAt,
      lastActionAt: updatedAt,
      rowVersion: row.rowVersion,
      nextOwner,
      handoffState,
      pendingTransactionId: row.pendingTransactionId,
    }
  })
}

/**
 * Claim or hand off an active encounter. `expectedRowVersion` is the roster
 * snapshot's concurrency token: another clinical action or handoff wins, and
 * this stale submit returns false instead of overwriting ownership.
 */
export async function assignTodayEncounterOwner(
  tx: Tx,
  opts: {
    tenantId: string
    branchId: number
    encounterDisplayId: string
    ownerUserId: number
    expectedRowVersion: number
  },
): Promise<boolean> {
  const rows = await tx.execute<{ id: string }>(sql`
    UPDATE encounters
    SET
      provider_id = ${opts.ownerUserId},
      updated_at = now(),
      row_version = row_version + 1
    WHERE tenant_id = ${opts.tenantId}
      AND branch_id = ${opts.branchId}
      AND display_id = ${opts.encounterDisplayId}
      AND status::text NOT IN ('Completed', 'Cancelled', 'NoShow')
      AND row_version = ${opts.expectedRowVersion}
      AND deleted_at IS NULL
    RETURNING display_id AS id
  `)
  return rows.length === 1
}

// ── Inventory ─────────────────────────────────────────────────────────────────
// inventory_movements uses movementType / quantityDelta / performedAt / notes.
// The spec references direction/quantity/reason_code/occurred_at — these are
// the actual column names in the schema; we map to the documented response shape.

export async function getInventorySummary(
  tx: Tx,
  tenantId: string,
  branchId: number,
  date: string,
) {
  const rows = await tx.execute<{
    movementId: string
    lotNumber: string
    serviceName: string
    movementType: string
    quantityDelta: string
    notes: string | null
    performedAt: string
  }>(sql`
    SELECT
      im.display_id          AS "movementId",
      il.batch_number        AS "lotNumber",
      p.name                 AS "serviceName",
      im.movement_type       AS "movementType",
      im.quantity_delta      AS "quantityDelta",
      im.notes               AS notes,
      im.performed_at        AS "performedAt"
    FROM inventory_movements im
    JOIN inventory_lots il ON il.id = im.lot_id AND il.tenant_id = ${tenantId}
    JOIN products p ON p.id = il.product_id AND p.tenant_id = ${tenantId}
    WHERE im.tenant_id = ${tenantId}
      AND im.branch_id = ${branchId}
      AND (im.performed_at AT TIME ZONE 'Asia/Manila')::date = ${date}::date
    ORDER BY im.performed_at ASC
  `)

  // Map movementType to direction: Dispense/Use → 'out', Restock/Receive → 'in', Adjustment/Transfer → 'adjust'
  function toDirection(movementType: string): 'in' | 'out' | 'adjust' {
    const lower = movementType.toLowerCase()
    if (lower.includes('dispense') || lower.includes('use') || lower.includes('out')) return 'out'
    if (lower.includes('restock') || lower.includes('receive') || lower.includes('in')) return 'in'
    return 'adjust'
  }

  return {
    movementCount: rows.length,
    rows: rows.map((r) => ({
      movementId: r.movementId,
      lotNumber: r.lotNumber,
      serviceName: r.serviceName,
      direction: toDirection(r.movementType),
      quantity: parseFloat(r.quantityDelta),
      reasonCode: r.notes ?? null,
      occurredAt: r.performedAt,
    })),
  }
}

// ── Cash Drawer ───────────────────────────────────────────────────────────────

export async function getDrawerSummary(tx: Tx, tenantId: string, branchId: number, date: string) {
  const rows = await tx.execute<{
    sessionId: string
    state: string
    openedAt: string
    closedAt: string | null
    openingFloat: string
    closingTotalDeclared: string | null
    variance: string | null
    depositCount: number
    depositsTotal: string
  }>(sql`
    SELECT
      display_id        AS "sessionId",
      state,
      opened_at         AS "openedAt",
      closed_at         AS "closedAt",
      opening_float     AS "openingFloat",
      closing_total_declared AS "closingTotalDeclared",
      variance,
      (SELECT COUNT(*)::int FROM cash_deposits cd
        WHERE cd.tenant_id = cash_drawer_sessions.tenant_id
          AND cd.cash_drawer_session_id = cash_drawer_sessions.id
          AND cd.voided_at IS NULL) AS "depositCount",
      COALESCE((SELECT SUM(cd.amount) FROM cash_deposits cd
        WHERE cd.tenant_id = cash_drawer_sessions.tenant_id
          AND cd.cash_drawer_session_id = cash_drawer_sessions.id
          AND cd.voided_at IS NULL), 0)::numeric(12,2)::text AS "depositsTotal"
    FROM cash_drawer_sessions
    WHERE tenant_id = ${tenantId}
      AND branch_id = ${branchId}
      AND (opened_at AT TIME ZONE 'Asia/Manila')::date = ${date}::date
    ORDER BY opened_at ASC
  `)

  const openingFloatTotal = rows
    .reduce((acc, r) => acc + parseFloat(r.openingFloat ?? '0'), 0)
    .toFixed(2)

  const declaredTotalTotal = rows
    .filter((r) => r.closingTotalDeclared != null)
    .reduce((acc, r) => acc + parseFloat(r.closingTotalDeclared!), 0)
    .toFixed(2)

  const varianceTotal = rows
    .filter((r) => r.variance != null)
    .reduce((acc, r) => acc + parseFloat(r.variance!), 0)
    .toFixed(2)

  const depositCount = rows.reduce((acc, r) => acc + r.depositCount, 0)
  const depositsTotal = rows.reduce((acc, r) => acc + parseFloat(r.depositsTotal), 0).toFixed(2)

  return {
    sessionCount: rows.length,
    openingFloatTotal,
    declaredTotalTotal,
    varianceTotal,
    depositCount,
    depositsTotal,
    rows: rows.map((r) => ({
      sessionId: r.sessionId,
      state: r.state as 'Open' | 'Closed',
      openedAt: r.openedAt,
      closedAt: r.closedAt ?? null,
      openingFloat: r.openingFloat,
      declaredTotal: r.closingTotalDeclared ?? null,
      variance: r.variance ?? null,
      depositCount: r.depositCount,
      depositsTotal: r.depositsTotal,
    })),
  }
}

// ── Branch name lookup ────────────────────────────────────────────────────────

export async function getBranchName(tx: Tx, tenantId: string, branchId: number): Promise<string> {
  const [row] = await tx.execute<{ name: string }>(sql`
    SELECT name FROM branches
    WHERE tenant_id = ${tenantId} AND id = ${branchId}
    LIMIT 1
  `)
  return row?.name ?? String(branchId)
}

// ── Loose-ends aggregations ──────────────────────────────────────────────────

/**
 * Transactions that are Pending or Paid but still have amount_outstanding > 0,
 * created on or before the day before `date`.
 */
export async function getUnsettledTransactions(
  tx: Tx,
  tenantId: string,
  branchId: number,
  date: string,
) {
  const [row] = await tx.execute<{ count: string; totalOutstanding: string }>(sql`
    SELECT
      COUNT(*)::text                                                AS count,
      COALESCE(SUM(amount_outstanding), 0)::numeric(12,2)::text   AS "totalOutstanding"
    FROM transactions
    WHERE tenant_id          = ${tenantId}
      AND branch_id          = ${branchId}
      AND status             IN ('Pending', 'Paid')
      AND amount_outstanding > 0
      -- A partly-funded patient-credit deposit sits Pending with a positive
      -- amount_outstanding, but it is deferred revenue the clinic HOLDS, not a
      -- carried-over debt. Excluding it keeps this figure consistent with the
      -- dashboard AR and /api/accounts-receivable.
      AND is_prepayment      = false
      AND (created_at AT TIME ZONE 'Asia/Manila')::date <= (${date}::date - INTERVAL '1 day')
      AND deleted_at         IS NULL
  `)
  return {
    count: parseInt(row?.count ?? '0', 10),
    totalOutstanding: row?.totalOutstanding ?? '0.00',
    asOfDate: (() => {
      const d = new Date(date)
      d.setUTCDate(d.getUTCDate() - 1)
      return d.toISOString().slice(0, 10)
    })(),
  }
}

/**
 * Cash drawer sessions that are still Open and were opened before `date`.
 * Joined to users for display names. Limited to 10 rows (badge display only).
 */
export async function getOpenPriorDrawers(
  tx: Tx,
  tenantId: string,
  branchId: number,
  date: string,
) {
  const countRow = await tx.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM cash_drawer_sessions
    WHERE tenant_id    = ${tenantId}
      AND branch_id    = ${branchId}
      AND state        = 'Open'
      AND (opened_at AT TIME ZONE 'Asia/Manila')::date < ${date}::date
  `)

  const rows = await tx.execute<{
    sessionId: string
    openedAt: string
    userName: string | null
    openingFloat: string
  }>(sql`
    SELECT
      cds.display_id      AS "sessionId",
      cds.opened_at       AS "openedAt",
      CASE
        WHEN u.first_name IS NOT NULL OR u.last_name IS NOT NULL
        THEN TRIM(CONCAT(u.first_name, ' ', u.last_name))
        ELSE NULL
      END                 AS "userName",
      cds.opening_float   AS "openingFloat"
    FROM cash_drawer_sessions cds
    LEFT JOIN users u ON u.id = cds.user_id AND u.tenant_id = ${tenantId}
    WHERE cds.tenant_id    = ${tenantId}
      AND cds.branch_id    = ${branchId}
      AND cds.state        = 'Open'
      AND (cds.opened_at AT TIME ZONE 'Asia/Manila')::date < ${date}::date
    ORDER BY cds.opened_at ASC
    LIMIT 10
  `)

  return {
    count: parseInt(countRow[0]?.count ?? '0', 10),
    rows: rows.map((r) => ({
      sessionId: r.sessionId,
      openedAt: r.openedAt,
      userName: r.userName ?? null,
      openingFloat: r.openingFloat,
    })),
  }
}

/**
 * Clinical orders that are Completed, have no documented_by_id, and whose
 * completed_at is before `date`. Branch-scoped via encounter join.
 *
 * NOTE: clinical_orders has no direct branch_id column; branch is resolved
 * through the linked encounter (same pattern as getAdministrationSummary).
 * The spec referenced `administered_at` which does not exist in the schema;
 * `completed_at` is the equivalent completion timestamp.
 */
export async function getUndocumentedAdministrations(
  tx: Tx,
  tenantId: string,
  branchId: number,
  date: string,
) {
  const [row] = await tx.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM clinical_orders co
    JOIN encounters e ON e.id = co.encounter_id AND e.tenant_id = ${tenantId}
    WHERE co.tenant_id         = ${tenantId}
      AND e.branch_id          = ${branchId}
      AND co.status            = 'Completed'
      AND co.completed_at      IS NOT NULL
      AND (co.completed_at AT TIME ZONE 'Asia/Manila')::date < ${date}::date
      AND co.documented_by_id  IS NULL
      AND co.deleted_at        IS NULL
  `)

  return {
    count: parseInt(row?.count ?? '0', 10),
    asOfDate: (() => {
      const d = new Date(date)
      d.setUTCDate(d.getUTCDate() - 1)
      return d.toISOString().slice(0, 10)
    })(),
  }
}
