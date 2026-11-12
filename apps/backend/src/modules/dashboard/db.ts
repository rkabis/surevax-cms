import { and, eq, lt, isNull, sql, count, desc, inArray, or } from 'drizzle-orm'
import { withTenantTx } from '../../shared/db/withTenantTx.js'
import { clinicCalendarDateString } from '../../shared/utils/clinicDate.js'
import {
  patients,
  encounters,
  clinicalOrders,
  patientStandingOrders,
  transactions,
  payments,
  inventoryLots,
  serviceCatalog,
  products,
  users,
} from '../../shared/db/schema.js'

export type DashboardScope = {
  tenantId: string
  /** Null is reserved for the established tenant-wide TenantAdmin view. */
  branchId: number | null
}

function orderBranchCondition(branchId: number | null) {
  if (branchId === null) return undefined
  return or(
    isNull(patients.homeBranchId),
    eq(patients.homeBranchId, branchId),
    eq(encounters.branchId, branchId),
  )
}

export async function getDashboardStats({ tenantId, branchId }: DashboardScope) {
  const today = clinicCalendarDateString()

  return withTenantTx({ tenantId, userId: 0, branchId }, async (tx) => {
    // Patients seen today (encounters created today)
    const [encounterStats] = await tx
      .select({ count: count() })
      .from(encounters)
      .where(
        and(
          eq(encounters.tenantId, tenantId),
          sql`(${encounters.startedAt} AT TIME ZONE 'Asia/Manila')::date = ${today}::date`,
          isNull(encounters.deletedAt),
          branchId !== null ? eq(encounters.branchId, branchId) : undefined,
        ),
      )

    // Scheduled orders due today
    const [scheduledOrdersStats] = await tx
      .select({ count: count() })
      .from(clinicalOrders)
      .innerJoin(patients, eq(clinicalOrders.patientId, patients.id))
      .leftJoin(encounters, eq(clinicalOrders.encounterId, encounters.id))
      .where(
        and(
          eq(clinicalOrders.tenantId, tenantId),
          eq(clinicalOrders.status, 'Scheduled'),
          sql`${clinicalOrders.currentScheduledDate}::date = ${today}::date`,
          isNull(clinicalOrders.deletedAt),
          orderBranchCondition(branchId),
        ),
      )

    // Pending / partial transactions (unsettled). Count the SAME predicate as
    // the unsettledTotal sum below so the KPI's count and amount agree: a Draft
    // Day-0 bill is unsettled money awaiting the cashier.
    const [paymentStats] = await tx
      .select({ count: count() })
      .from(transactions)
      .where(
        and(
          eq(transactions.tenantId, tenantId),
          inArray(transactions.status, ['Pending', 'Draft']),
          isNull(transactions.deletedAt),
          // A patient-credit deposit is money HELD, not money owed.
          eq(transactions.isPrepayment, false),
          branchId !== null ? eq(transactions.branchId, branchId) : undefined,
        ),
      )

    // MONEY-4: outstanding AR for unsettled transactions — sum amount_outstanding,
    // not net_amount. A partially-paid Pending txn still owes only
    // (net − paid); summing net_amount overstated AR by the amount already paid.
    //
    // `is_prepayment = false` matters: an item-less patient-credit deposit that is
    // only PARTLY funded sits Pending with a positive amount_outstanding, but it is
    // deferred revenue the clinic is holding, not a debt the patient owes. Without
    // this clause such a deposit inflated dashboard AR, and it disagreed with
    // /api/accounts-receivable, which has always filtered it. Keep this predicate
    // identical to the one in patient_accounts/db.ts (OPEN_PREDICATE): the
    // integration suite asserts the two surfaces agree to the centavo.
    const [unsettledRow] = await tx
      .select({
        total: sql<string>`COALESCE(SUM(CAST(${transactions.amountOutstanding} AS numeric)), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.tenantId, tenantId),
          inArray(transactions.status, ['Pending', 'Draft']),
          isNull(transactions.deletedAt),
          eq(transactions.isPrepayment, false),
          branchId !== null ? eq(transactions.branchId, branchId) : undefined,
        ),
      )

    // Cash vs non-cash collected today (drawer reconciliation surface).
    // Cash = physical cash held in the drawer; everything else (GCash, Maya,
    // BankTransfer, Card, HMO, Corporate) is non-cash. Sums payment amounts on
    // today's transactions, excluding Voided/Refunded txns (a voided txn
    // collected nothing; a refund line nets to zero). Tenant-wide (branchId
    // null) — matches the other dashboard aggregates; Phase 1 is single-branch.
    const [cashSplitRow] = await tx
      .select({
        cash: sql<string>`COALESCE(SUM(${payments.amount}) FILTER (WHERE ${payments.method} = 'Cash'), 0)`,
        // 'Credit' is excluded from BOTH sides: it is the internal method minted
        // by a patient-credit draw, which reallocates money already collected on
        // a deposit. Counting it here would report cash that never arrived today
        // (and would double-count the deposit's own funding payment).
        nonCash: sql<string>`COALESCE(SUM(${payments.amount}) FILTER (WHERE ${payments.method} NOT IN ('Cash', 'Credit')), 0)`,
      })
      .from(payments)
      .innerJoin(transactions, eq(transactions.id, payments.transactionId))
      .where(
        and(
          eq(transactions.tenantId, tenantId),
          sql`(${transactions.transactedAt} AT TIME ZONE 'Asia/Manila')::date = ${today}::date`,
          isNull(transactions.deletedAt),
          sql`${transactions.status} NOT IN ('Voided', 'Refunded')`,
          // A voided payment is a corrected-and-replaced row (the original
          // stays for audit); counting it here would double it against its
          // replacement and could even attribute cash to the wrong method.
          isNull(payments.voidedAt),
          branchId !== null ? eq(transactions.branchId, branchId) : undefined,
        ),
      )

    // Unique patients today
    const [patientStats] = await tx
      .select({ count: sql<number>`count(distinct ${encounters.patientId})` })
      .from(encounters)
      .where(
        and(
          eq(encounters.tenantId, tenantId),
          sql`(${encounters.startedAt} AT TIME ZONE 'Asia/Manila')::date = ${today}::date`,
          isNull(encounters.deletedAt),
          branchId !== null ? eq(encounters.branchId, branchId) : undefined,
        ),
      )

    // Walk-in vs booked split for today's encounters
    // Walk-in = no patientStandingOrderId on any of their clinical orders (heuristic: encounter specialty)
    // Simpler Phase 1 approach: encounters today split by whether a patientStandingOrderId exists
    // in clinical_orders for that encounter. If >=1 clinical order has a PSO → booked, else walk-in.
    const bookedEncounterRows = await tx
      .selectDistinct({ encounterId: clinicalOrders.encounterId })
      .from(clinicalOrders)
      .innerJoin(encounters, eq(clinicalOrders.encounterId, encounters.id))
      .where(
        and(
          eq(clinicalOrders.tenantId, tenantId),
          isNull(clinicalOrders.deletedAt),
          sql`${clinicalOrders.patientStandingOrderId} IS NOT NULL`,
          sql`${clinicalOrders.encounterId} IS NOT NULL`,
          branchId !== null ? eq(encounters.branchId, branchId) : undefined,
        ),
      )

    const bookedEncounterIds = new Set(bookedEncounterRows.map((r) => r.encounterId))

    // All encounter IDs today
    const todayEncounterRows = await tx
      .select({ id: encounters.id })
      .from(encounters)
      .where(
        and(
          eq(encounters.tenantId, tenantId),
          sql`(${encounters.startedAt} AT TIME ZONE 'Asia/Manila')::date = ${today}::date`,
          isNull(encounters.deletedAt),
          branchId !== null ? eq(encounters.branchId, branchId) : undefined,
        ),
      )

    let walkInCount = 0
    let bookedCount = 0
    for (const enc of todayEncounterRows) {
      if (bookedEncounterIds.has(enc.id)) bookedCount++
      else walkInCount++
    }

    // 7-day daily trend series (oldest → newest, today inclusive) for the
    // KpiCell sparklines (Pattern 18/32). One grouped query per source table
    // joined onto a generate_series spine — never 7 round-trips. Revenue
    // follows the canonical aggregate rule (patterns.md "Revenue + AR
    // aggregates"): exclude Voided/Refunded AND is_prepayment deposits.
    // Tenant-scoped in WHERE (defense-in-depth on top of RLS); tenant-wide
    // across branches like the other dashboard aggregates (Phase 1).
    const trendRows = (await tx.execute(sql`
      WITH days AS (
        SELECT generate_series(${today}::date - 6, ${today}::date, interval '1 day')::date AS day
      ),
      enc AS (
        SELECT (started_at AT TIME ZONE 'Asia/Manila')::date AS day, COUNT(*)::int AS arrivals
        FROM encounters
        WHERE tenant_id = ${tenantId}
          ${branchId !== null ? sql`AND branch_id = ${branchId}` : sql``}
          AND deleted_at IS NULL
          AND (started_at AT TIME ZONE 'Asia/Manila')::date >= ${today}::date - 6
        GROUP BY 1
      ),
      txn AS (
        SELECT (transacted_at AT TIME ZONE 'Asia/Manila')::date AS day,
          COALESCE(SUM(net_amount) FILTER (
            WHERE status NOT IN ('Voided', 'Refunded') AND is_prepayment = false
          ), 0) AS revenue,
          COUNT(*) FILTER (
            WHERE status IN ('Pending', 'Draft') AND is_prepayment = false
          )::int AS unsettled
        FROM transactions
        WHERE tenant_id = ${tenantId}
          ${branchId !== null ? sql`AND branch_id = ${branchId}` : sql``}
          AND deleted_at IS NULL
          AND (transacted_at AT TIME ZONE 'Asia/Manila')::date >= ${today}::date - 6
        GROUP BY 1
      )
      SELECT
        COALESCE(enc.arrivals, 0)::int AS "arrivals",
        COALESCE(txn.revenue, 0)::numeric(12,2)::text AS "revenue",
        COALESCE(txn.unsettled, 0)::int AS "unsettled"
      FROM days d
      LEFT JOIN enc ON enc.day = d.day
      LEFT JOIN txn ON txn.day = d.day
      ORDER BY d.day
    `)) as unknown as Array<{ arrivals: number; revenue: string; unsettled: number }>

    return {
      patientsToday: Number(patientStats?.count ?? 0),
      encountersToday: Number(encounterStats?.count ?? 0),
      scheduledOrdersDueToday: Number(scheduledOrdersStats?.count ?? 0),
      pendingPayments: Number(paymentStats?.count ?? 0),
      walkInCount,
      bookedCount,
      unsettledTotal: parseFloat(unsettledRow?.total ?? '0').toFixed(2),
      cashCollectedToday: parseFloat(cashSplitRow?.cash ?? '0').toFixed(2),
      nonCashCollectedToday: parseFloat(cashSplitRow?.nonCash ?? '0').toFixed(2),
      // numeric(12,2) crosses the API as a string — frontend parses for charts.
      trend7d: {
        arrivals: trendRows.map((r) => Number(r.arrivals)),
        revenue: trendRows.map((r) => String(r.revenue)),
        unsettled: trendRows.map((r) => Number(r.unsettled)),
      },
    }
  })
}

export async function getRecentEncounters({ tenantId, branchId }: DashboardScope, limit = 5) {
  const rows = await withTenantTx({ tenantId, userId: 0, branchId }, async (tx) =>
    tx
      .select({
        id: encounters.displayId,
        patientDisplayId: patients.displayId,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
        specialty: encounters.specialty,
        status: encounters.status,
        startedAt: encounters.startedAt,
        completedAt: encounters.completedAt,
        providerFirstName: users.firstName,
        providerLastName: users.lastName,
      })
      .from(encounters)
      .innerJoin(patients, eq(encounters.patientId, patients.id))
      .leftJoin(users, eq(encounters.providerId, users.id))
      .where(
        and(
          eq(encounters.tenantId, tenantId),
          isNull(encounters.deletedAt),
          branchId !== null ? eq(encounters.branchId, branchId) : undefined,
        ),
      )
      .orderBy(desc(encounters.startedAt))
      .limit(limit),
  )

  return rows.map((r) => ({
    id: r.id,
    patientDisplayId: r.patientDisplayId,
    patientName: `${r.patientLastName}, ${r.patientFirstName}`,
    specialty: r.specialty,
    status: r.status,
    attendingClinicianName:
      r.providerFirstName && r.providerLastName
        ? `${r.providerFirstName} ${r.providerLastName}`
        : null,
    time: r.startedAt.toLocaleTimeString('en-PH', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }),
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
  }))
}

export async function getScheduledOrdersDue({ tenantId, branchId }: DashboardScope, limit = 5) {
  const today = clinicCalendarDateString()

  const rows = await withTenantTx({ tenantId, userId: 0, branchId }, async (tx) =>
    tx
      .select({
        id: clinicalOrders.displayId,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
        serviceName: serviceCatalog.name,
        doseNumber: clinicalOrders.doseNumber,
        scheduledDate: clinicalOrders.currentScheduledDate,
      })
      .from(clinicalOrders)
      .innerJoin(patients, eq(clinicalOrders.patientId, patients.id))
      .innerJoin(serviceCatalog, eq(clinicalOrders.serviceId, serviceCatalog.id))
      .leftJoin(encounters, eq(clinicalOrders.encounterId, encounters.id))
      .where(
        and(
          eq(clinicalOrders.tenantId, tenantId),
          eq(clinicalOrders.status, 'Scheduled'),
          sql`${clinicalOrders.currentScheduledDate}::date >= ${today}::date`,
          sql`${clinicalOrders.currentScheduledDate}::date < ${today}::date + 2`,
          isNull(clinicalOrders.deletedAt),
          orderBranchCondition(branchId),
        ),
      )
      .orderBy(clinicalOrders.currentScheduledDate, clinicalOrders.displayId)
      .limit(limit),
  )

  return rows.map((r) => {
    const scheduled = r.scheduledDate ? clinicCalendarDateString(new Date(r.scheduledDate)) : null
    let dateLabel = 'Upcoming'
    if (scheduled) {
      const tomorrow = new Date(`${today}T00:00:00Z`)
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
      if (scheduled === today) dateLabel = 'Today'
      else if (scheduled === tomorrow.toISOString().slice(0, 10)) dateLabel = 'Tomorrow'
    }

    return {
      id: r.id,
      patientName: `${r.patientLastName}, ${r.patientFirstName}`,
      service: r.serviceName,
      doseNumber: r.doseNumber ?? 1,
      scheduledDate: dateLabel,
    }
  })
}

export type Nudge = {
  id: string
  kind: 'overdue_order' | 'pending_transaction' | 'low_stock'
  label: string
  sub: string
  severity: 'overdue' | 'due' | 'info'
  dueAt: string | null
  link: string
}

export async function getNudges(
  { tenantId, branchId }: DashboardScope,
  limit = 20,
): Promise<Nudge[]> {
  const today = clinicCalendarDateString()
  const nudges: Nudge[] = []

  await withTenantTx({ tenantId, userId: 0, branchId }, async (tx) => {
    // 1. Overdue clinical orders (scheduled before today, not completed/cancelled)
    const overdueOrders = await tx
      .select({
        id: clinicalOrders.displayId,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
        doseNumber: clinicalOrders.doseNumber,
        currentScheduledDate: clinicalOrders.currentScheduledDate,
      })
      .from(clinicalOrders)
      .innerJoin(
        patientStandingOrders,
        eq(clinicalOrders.patientStandingOrderId, patientStandingOrders.id),
      )
      .innerJoin(patients, eq(patientStandingOrders.patientId, patients.id))
      .leftJoin(encounters, eq(clinicalOrders.encounterId, encounters.id))
      .where(
        and(
          eq(clinicalOrders.tenantId, tenantId),
          eq(clinicalOrders.status, 'Scheduled'),
          sql`${clinicalOrders.currentScheduledDate}::date < ${today}::date`,
          isNull(clinicalOrders.deletedAt),
          orderBranchCondition(branchId),
        ),
      )
      .orderBy(clinicalOrders.currentScheduledDate, clinicalOrders.displayId)
      .limit(10)

    for (const o of overdueOrders) {
      nudges.push({
        id: `order-${o.id}`,
        kind: 'overdue_order',
        label: `Dose ${o.doseNumber ?? '?'} overdue`,
        sub: `${o.patientLastName}, ${o.patientFirstName} · scheduled ${
          o.currentScheduledDate
            ? new Date(o.currentScheduledDate).toLocaleDateString('en-PH', {
                month: 'short',
                day: 'numeric',
              })
            : 'unknown'
        }`,
        severity: 'overdue',
        dueAt: o.currentScheduledDate ? o.currentScheduledDate.toISOString() : null,
        link: `/scheduled-orders/${o.id}`,
      })
    }

    // 2. Clinical orders due today (not yet completed)
    const dueTodayOrders = await tx
      .select({
        id: clinicalOrders.displayId,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
        doseNumber: clinicalOrders.doseNumber,
        currentScheduledDate: clinicalOrders.currentScheduledDate,
      })
      .from(clinicalOrders)
      .innerJoin(
        patientStandingOrders,
        eq(clinicalOrders.patientStandingOrderId, patientStandingOrders.id),
      )
      .innerJoin(patients, eq(patientStandingOrders.patientId, patients.id))
      .leftJoin(encounters, eq(clinicalOrders.encounterId, encounters.id))
      .where(
        and(
          eq(clinicalOrders.tenantId, tenantId),
          eq(clinicalOrders.status, 'Scheduled'),
          sql`${clinicalOrders.currentScheduledDate}::date = ${today}::date`,
          isNull(clinicalOrders.deletedAt),
          orderBranchCondition(branchId),
        ),
      )
      .orderBy(clinicalOrders.currentScheduledDate, clinicalOrders.displayId)
      .limit(5)

    for (const o of dueTodayOrders) {
      nudges.push({
        id: `order-due-${o.id}`,
        kind: 'overdue_order',
        label: `Dose ${o.doseNumber ?? '?'} due today`,
        sub: `${o.patientLastName}, ${o.patientFirstName}`,
        severity: 'due',
        dueAt: o.currentScheduledDate ? o.currentScheduledDate.toISOString() : null,
        link: `/scheduled-orders/${o.id}`,
      })
    }

    // 3. Pending transactions older than 2 hours
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
    const pendingTxns = await tx
      .select({
        id: transactions.displayId,
        netAmount: transactions.netAmount,
        transactedAt: transactions.transactedAt,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.tenantId, tenantId),
          eq(transactions.status, 'Pending'),
          lt(transactions.transactedAt, twoHoursAgo),
          isNull(transactions.deletedAt),
          branchId !== null ? eq(transactions.branchId, branchId) : undefined,
        ),
      )
      .orderBy(transactions.transactedAt)
      .limit(5)

    for (const t of pendingTxns) {
      const amount = parseFloat(t.netAmount ?? '0').toLocaleString('en-PH', {
        style: 'currency',
        currency: 'PHP',
      })
      nudges.push({
        id: `txn-${t.id}`,
        kind: 'pending_transaction',
        label: `Unsettled transaction`,
        sub: `${amount} · waiting cashier · ${t.id}`,
        severity: 'due',
        dueAt: t.transactedAt.toISOString(),
        link: `/transactions/${t.id}`,
      })
    }

    // 4. Low-stock lots expiring within 14 days
    const lowStockNudges = await tx
      .select({
        id: inventoryLots.displayId,
        name: products.name,
        batchNumber: inventoryLots.batchNumber,
        quantityOnHand: inventoryLots.quantityOnHand,
        expiryDate: inventoryLots.expiryDate,
      })
      .from(inventoryLots)
      .innerJoin(products, eq(inventoryLots.productId, products.id))
      .where(
        and(
          eq(inventoryLots.tenantId, tenantId),
          eq(inventoryLots.isQuarantined, false),
          sql`CAST(${inventoryLots.quantityOnHand} AS numeric) > 0`,
          sql`${inventoryLots.expiryDate}::date <= ${today}::date + 14`,
          branchId !== null ? eq(inventoryLots.branchId, branchId) : undefined,
        ),
      )
      .orderBy(inventoryLots.expiryDate)
      .limit(5)

    const clinicTodayUtc = new Date(`${today}T00:00:00Z`)
    for (const lot of lowStockNudges) {
      const expDate = lot.expiryDate ? new Date(lot.expiryDate) : null
      const daysLeft = expDate
        ? Math.round((expDate.getTime() - clinicTodayUtc.getTime()) / 86400000)
        : null
      nudges.push({
        id: `lot-${lot.id}`,
        kind: 'low_stock',
        label: `Lot expiring${daysLeft !== null && daysLeft <= 0 ? ' (expired)' : daysLeft === 0 ? ' today' : ` in ${daysLeft}d`}`,
        sub: `${lot.name} · ${lot.batchNumber} · ${Number(lot.quantityOnHand)} units`,
        severity: daysLeft !== null && daysLeft <= 7 ? 'overdue' : 'due',
        dueAt: lot.expiryDate ? new Date(lot.expiryDate).toISOString() : null,
        link: `/inventory/${lot.id}`,
      })
    }
  })

  // Sort: overdue first, then due, then info
  const severityOrder = { overdue: 0, due: 1, info: 2 }
  nudges.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

  return nudges.slice(0, limit)
}

export async function getLowStockAlerts({ tenantId, branchId }: DashboardScope, threshold = 5) {
  const rows = await withTenantTx({ tenantId, userId: 0, branchId }, async (tx) =>
    tx
      .select({
        id: inventoryLots.displayId,
        name: products.name,
        batchNumber: inventoryLots.batchNumber,
        quantityOnHand: inventoryLots.quantityOnHand,
        expiryDate: inventoryLots.expiryDate,
      })
      .from(inventoryLots)
      .innerJoin(products, eq(inventoryLots.productId, products.id))
      .where(
        and(
          eq(inventoryLots.tenantId, tenantId),
          eq(inventoryLots.isQuarantined, false),
          sql`CAST(${inventoryLots.quantityOnHand} AS numeric) > 0`,
          sql`CAST(${inventoryLots.quantityOnHand} AS numeric) <= ${threshold}`,
          branchId !== null ? eq(inventoryLots.branchId, branchId) : undefined,
        ),
      )
      .orderBy(inventoryLots.expiryDate),
  )

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    batchNumber: r.batchNumber,
    quantityOnHand: Number(r.quantityOnHand),
    expiryDate: r.expiryDate,
  }))
}
