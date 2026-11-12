import { and, count, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import { withTenantTx, type Tx, type TenantCtx } from '../../shared/db/withTenantTx.js'
import {
  branches,
  cashDrawerSessions,
  clinicalOrders,
  encounters,
  payments,
  staffTimeLogs,
  transactions,
  users,
} from '../../shared/db/schema.js'

export type DrawerSession = {
  /** Public handle — CSH_<8 base32> display_id. */
  id: string
  openingFloat: string
  closingTotalDeclared: string | null
  variance: string | null
  state: string
  openedAt: string
  closedAt: string | null
}

export type CurrentShift = {
  /** Public handle — TLG_<8 base32> display_id. */
  id: string
  /** users.display_id (USR_…). */
  userId: string
  /** branches.display_id (slug.CODE). */
  branchId: string
  openedAt: string
  startedAt: string
  floatAmount: string
  collectedSoFar: string
  drawerBalance: string
  drawerState: string
  cashierName: string
  encountersBookedToday: number
  dosesAdministeredToday: number
  dosesScheduledToday: number
  complianceRate: number
  drawerSession: DrawerSession | null
}

/**
 * Returns the caller's current open shift enriched with the drawer fields
 * the cashier UI needs (TenderRail in transactions/components/TenderRail.tsx).
 *
 * Returns null if the caller has no open shift today.
 */
export async function getCurrentShift(ctx: TenantCtx): Promise<CurrentShift | null> {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  return withTenantTx(ctx, async (tx) => {
    const [shift] = await tx
      .select({
        id: staffTimeLogs.id,
        displayId: staffTimeLogs.displayId,
        userBigintId: staffTimeLogs.userId,
        branchBigintId: staffTimeLogs.branchId,
        userDisplayId: users.displayId,
        branchDisplayId: branches.displayId,
        clockInAt: staffTimeLogs.clockInAt,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(staffTimeLogs)
      .innerJoin(users, eq(staffTimeLogs.userId, users.id))
      .innerJoin(branches, eq(staffTimeLogs.branchId, branches.id))
      .where(
        and(
          eq(staffTimeLogs.tenantId, ctx.tenantId),
          eq(staffTimeLogs.userId, ctx.userId),
          isNull(staffTimeLogs.clockOutAt),
          gte(staffTimeLogs.clockInAt, todayStart),
        ),
      )
      .limit(1)

    if (!shift) return null

    const todayEnd = new Date()
    todayEnd.setHours(23, 59, 59, 999)

    const [collected, encounterStats, dosesAdministered, dosesScheduled] = await Promise.all([
      // What this cashier actually collected today. Four exclusions, all
      // necessary: 'Credit' is the internal method minted by a patient-credit
      // draw (money already collected on a deposit, reallocated, no new cash),
      // a payment on a Voided/Refunded or soft-deleted transaction collected
      // nothing, and a voided payment is a corrected-and-replaced row (the
      // original stays for audit) that would double-count against its
      // replacement. Without them a cashier's own figure inflates the moment
      // they apply credit or a method gets corrected mid-shift.
      tx
        .select({
          total: sql<string>`COALESCE(SUM(CAST(${payments.amount} AS numeric)), 0)`,
        })
        .from(payments)
        .innerJoin(transactions, eq(transactions.id, payments.transactionId))
        .where(
          and(
            eq(payments.tenantId, ctx.tenantId),
            eq(payments.receivedById, ctx.userId),
            gte(payments.receivedAt, todayStart),
            sql`${payments.method} <> 'Credit'`,
            isNull(transactions.deletedAt),
            sql`${transactions.status} NOT IN ('Voided', 'Refunded')`,
            isNull(payments.voidedAt),
          ),
        )
        .then((r) => r[0]),

      // Encounters booked today at the same branch (branch-level KPI)
      tx
        .select({ cnt: count() })
        .from(encounters)
        .where(
          and(
            eq(encounters.tenantId, ctx.tenantId),
            ctx.branchId !== null ? eq(encounters.branchId, ctx.branchId) : sql`TRUE`,
            gte(encounters.startedAt, todayStart),
            lt(encounters.startedAt, todayEnd),
            isNull(encounters.deletedAt),
          ),
        )
        .then((r) => r[0]),

      // Doses administered today by this user (completed clinical orders)
      // Phase 2: filter by documentedById (Phase 1 mirrored completedById → documentedById)
      tx
        .select({ cnt: count() })
        .from(clinicalOrders)
        .where(
          and(
            eq(clinicalOrders.tenantId, ctx.tenantId),
            eq(clinicalOrders.status, 'Completed'),
            eq(clinicalOrders.documentedById, ctx.userId),
            gte(clinicalOrders.completedAt, todayStart),
            lt(clinicalOrders.completedAt, todayEnd),
            isNull(clinicalOrders.deletedAt),
          ),
        )
        .then((r) => r[0]),

      // Doses scheduled today at this branch (denominator for compliance)
      tx
        .select({ cnt: count() })
        .from(clinicalOrders)
        .where(
          and(
            eq(clinicalOrders.tenantId, ctx.tenantId),
            gte(clinicalOrders.currentScheduledDate, todayStart),
            lt(clinicalOrders.currentScheduledDate, todayEnd),
            isNull(clinicalOrders.deletedAt),
          ),
        )
        .then((r) => r[0]),
    ])

    const collectedAmount = parseFloat(collected?.total ?? '0')
    const dosesAdminCount = Number(dosesAdministered?.cnt ?? 0)
    const dosesSchedCount = Number(dosesScheduled?.cnt ?? 0)

    const drawerSession = await fetchDrawerSession(
      tx,
      ctx.tenantId,
      shift.branchBigintId,
      shift.clockInAt,
    )

    const drawerOpeningFloat = drawerSession?.openingFloat ?? '0'
    const floatAmt = parseFloat(drawerOpeningFloat)
    return {
      id: shift.displayId,
      userId: shift.userDisplayId,
      branchId: shift.branchDisplayId,
      openedAt: shift.clockInAt.toISOString(),
      startedAt: shift.clockInAt.toISOString(),
      floatAmount: drawerOpeningFloat,
      collectedSoFar: collectedAmount.toFixed(2),
      drawerBalance: (floatAmt + collectedAmount).toFixed(2),
      // No drawer session → 'None' (honest), not a false 'Open'. The dashboard
      // KPI keys off `=== 'Open'`, so this surfaces "No drawer" until one is opened.
      drawerState: drawerSession?.state ?? 'None',
      cashierName: `${shift.firstName} ${shift.lastName}`,
      encountersBookedToday: Number(encounterStats?.cnt ?? 0),
      dosesAdministeredToday: dosesAdminCount,
      dosesScheduledToday: dosesSchedCount,
      complianceRate:
        dosesSchedCount > 0
          ? Math.round((dosesAdminCount / dosesSchedCount) * 100) / 100
          : dosesAdminCount > 0
            ? 1
            : 0,
      drawerSession,
    }
  })
}

// ---------------------------------------------------------------------------
// Drawer session helpers
// ---------------------------------------------------------------------------

/** Fetch the cash_drawer_sessions row for a given branch (bigint) on the same
 *  day as `shiftAt`. Returns null when no row exists.
 *
 *  Branch-day scoped (NOT per-user): the cash drawer is shared across whoever
 *  is on the floor that day (see the Branch-Day Session Model), so any
 *  operator's shift reflects the branch's single open drawer. */
async function fetchDrawerSession(
  tx: Tx,
  tenantId: string,
  branchId: number,
  shiftAt: Date,
): Promise<DrawerSession | null> {
  const dayStart = new Date(shiftAt)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(shiftAt)
  dayEnd.setHours(23, 59, 59, 999)

  const [row] = await tx
    .select({
      displayId: cashDrawerSessions.displayId,
      openingFloat: cashDrawerSessions.openingFloat,
      closingTotalDeclared: cashDrawerSessions.closingTotalDeclared,
      variance: cashDrawerSessions.variance,
      state: cashDrawerSessions.state,
      openedAt: cashDrawerSessions.openedAt,
      closedAt: cashDrawerSessions.closedAt,
    })
    .from(cashDrawerSessions)
    .where(
      and(
        eq(cashDrawerSessions.tenantId, tenantId),
        // Branch-day scoped — no userId filter (shared drawer).
        eq(cashDrawerSessions.branchId, branchId),
        gte(cashDrawerSessions.openedAt, dayStart),
        lt(cashDrawerSessions.openedAt, dayEnd),
      ),
    )
    .orderBy(cashDrawerSessions.openedAt)
    .limit(1)

  if (!row) return null

  return {
    id: row.displayId,
    openingFloat: row.openingFloat,
    closingTotalDeclared: row.closingTotalDeclared ?? null,
    variance: row.variance ?? null,
    state: row.state,
    openedAt: row.openedAt.toISOString(),
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
  }
}

/** Returns a shift by display_id (TLG_…) with enriched drawer session. */
export async function getShiftByDisplayId(
  ctx: TenantCtx,
  shiftDisplayId: string,
): Promise<(CurrentShift & { notes: string | null }) | null> {
  return withTenantTx(ctx, async (tx) => {
    const [shift] = await tx
      .select({
        id: staffTimeLogs.id,
        displayId: staffTimeLogs.displayId,
        userBigintId: staffTimeLogs.userId,
        branchBigintId: staffTimeLogs.branchId,
        userDisplayId: users.displayId,
        branchDisplayId: branches.displayId,
        clockInAt: staffTimeLogs.clockInAt,
        clockOutAt: staffTimeLogs.clockOutAt,
        notes: staffTimeLogs.notes,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(staffTimeLogs)
      .innerJoin(users, eq(staffTimeLogs.userId, users.id))
      .innerJoin(branches, eq(staffTimeLogs.branchId, branches.id))
      .where(
        and(eq(staffTimeLogs.tenantId, ctx.tenantId), eq(staffTimeLogs.displayId, shiftDisplayId)),
      )
      .limit(1)

    if (!shift) return null

    const drawerSession = await fetchDrawerSession(
      tx,
      ctx.tenantId,
      shift.branchBigintId,
      shift.clockInAt,
    )

    const drawerOpeningFloat = drawerSession?.openingFloat ?? '0'
    return {
      id: shift.displayId,
      userId: shift.userDisplayId,
      branchId: shift.branchDisplayId,
      openedAt: shift.clockInAt.toISOString(),
      startedAt: shift.clockInAt.toISOString(),
      floatAmount: drawerOpeningFloat,
      collectedSoFar: '0.00',
      drawerBalance: drawerOpeningFloat,
      drawerState: drawerSession?.state ?? 'None',
      cashierName: `${shift.firstName} ${shift.lastName}`,
      encountersBookedToday: 0,
      dosesAdministeredToday: 0,
      dosesScheduledToday: 0,
      complianceRate: 0,
      drawerSession,
      notes: shift.notes ?? null,
    }
  })
}

/** Returns the raw cash_drawer_sessions row for a given shift display_id. */
export async function getDrawerSessionForShift(
  ctx: TenantCtx,
  shiftDisplayId: string,
): Promise<DrawerSession | null> {
  return withTenantTx(ctx, async (tx) => {
    const [shift] = await tx
      .select({
        userBigintId: staffTimeLogs.userId,
        branchBigintId: staffTimeLogs.branchId,
        clockInAt: staffTimeLogs.clockInAt,
      })
      .from(staffTimeLogs)
      .where(
        and(eq(staffTimeLogs.tenantId, ctx.tenantId), eq(staffTimeLogs.displayId, shiftDisplayId)),
      )
      .limit(1)

    if (!shift) return null

    return fetchDrawerSession(tx, ctx.tenantId, shift.branchBigintId, shift.clockInAt)
  })
}
