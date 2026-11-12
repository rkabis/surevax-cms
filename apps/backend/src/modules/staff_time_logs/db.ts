import { and, eq, isNull, gte, lt, sum, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { displayId } from '../../shared/utils/displayId.js'
import { withTenantTx } from '../../shared/db/withTenantTx.js'
import type { Tx } from '../../shared/db/withTenantTx.js'
import {
  branches,
  cashDrawerSessions,
  payments,
  staffTimeLogs,
  transactions,
  userBranches,
  users,
} from '../../shared/db/schema.js'

export type DrawerSessionSummary = {
  /** Public handle — CSH_<8 base32> display_id. */
  id: string
  openingFloat: string
  closingTotalDeclared: string | null
  variance: string | null
  state: string
  openedAt: string
  closedAt: string | null
}

export type StaffTimeLogRow = {
  /** Public handle — TLG_<8 base32> display_id. */
  id: string
  /** users.display_id (USR_…). */
  userId: string
  /** branches.display_id (slug.CODE). */
  branchId: string
  clockInAt: string
  clockOutAt: string | null
  totalHours: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

/** Internal serialized row used to bridge bigint internals → display_id surface. */
type RawLogRow = {
  id: number
  displayId: string
  userDisplayId: string
  branchDisplayId: string
  clockInAt: Date
  clockOutAt: Date | null
  totalHours: string | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
}

function serializeLog(row: RawLogRow): StaffTimeLogRow {
  return {
    id: row.displayId,
    userId: row.userDisplayId,
    branchId: row.branchDisplayId,
    clockInAt: row.clockInAt.toISOString(),
    clockOutAt: row.clockOutAt ? row.clockOutAt.toISOString() : null,
    totalHours: row.totalHours,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Resolve a users display_id (USR_…) to its bigint PK, scoped to tenant. */
export async function resolveUserBigint(
  tenantId: string,
  userDisplayId: string,
): Promise<number | null> {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const [row] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.displayId, userDisplayId)))
      .limit(1)
    return row?.id ?? null
  })
}

/** Resolve a branches display_id (slug.CODE) to its bigint PK, scoped to tenant. */
export async function resolveBranchBigint(
  tenantId: string,
  branchDisplayId: string,
): Promise<number | null> {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const [row] = await tx
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.tenantId, tenantId), eq(branches.displayId, branchDisplayId)))
      .limit(1)
    return row?.id ?? null
  })
}

/** Verify a target user belongs to the given (tenant, branch) — used by the
 *  Branch-session clock-in/out routes to refuse cross-branch operations. */
export async function userBelongsToBranch(
  tenantId: string,
  userId: number,
  branchId: number,
): Promise<boolean> {
  return withTenantTx({ tenantId, userId: 0, branchId }, async (tx) => {
    const [row] = await tx
      .select({ id: users.id })
      .from(users)
      .innerJoin(
        userBranches,
        and(
          eq(userBranches.userId, users.id),
          eq(userBranches.tenantId, tenantId),
          eq(userBranches.branchId, branchId),
        ),
      )
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId), eq(users.isActive, true)))
      .limit(1)
    return Boolean(row)
  })
}

/** Returns the open shift (raw bigint row) for userId today (clockOutAt IS NULL), or null. */
export async function getActiveShiftRaw(tenantId: string, userId: number) {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date()
  todayEnd.setHours(23, 59, 59, 999)

  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const [row] = await tx
      .select()
      .from(staffTimeLogs)
      .where(
        and(
          eq(staffTimeLogs.tenantId, tenantId),
          eq(staffTimeLogs.userId, userId),
          isNull(staffTimeLogs.clockOutAt),
          gte(staffTimeLogs.clockInAt, todayStart),
          lt(staffTimeLogs.clockInAt, todayEnd),
        ),
      )
      .limit(1)
    return row ?? null
  })
}

/** Returns the open shift for userId today as a public-surface row, or null. */
export async function getActiveShift(
  tenantId: string,
  userId: number,
): Promise<StaffTimeLogRow | null> {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date()
  todayEnd.setHours(23, 59, 59, 999)

  const row = await withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const [r] = await tx
      .select({
        id: staffTimeLogs.id,
        displayId: staffTimeLogs.displayId,
        userDisplayId: users.displayId,
        branchDisplayId: branches.displayId,
        clockInAt: staffTimeLogs.clockInAt,
        clockOutAt: staffTimeLogs.clockOutAt,
        totalHours: staffTimeLogs.totalHours,
        notes: staffTimeLogs.notes,
        createdAt: staffTimeLogs.createdAt,
        updatedAt: staffTimeLogs.updatedAt,
      })
      .from(staffTimeLogs)
      .innerJoin(users, eq(staffTimeLogs.userId, users.id))
      .innerJoin(branches, eq(staffTimeLogs.branchId, branches.id))
      .where(
        and(
          eq(staffTimeLogs.tenantId, tenantId),
          eq(staffTimeLogs.userId, userId),
          isNull(staffTimeLogs.clockOutAt),
          gte(staffTimeLogs.clockInAt, todayStart),
          lt(staffTimeLogs.clockInAt, todayEnd),
        ),
      )
      .limit(1)
    return r ?? null
  })

  return row ? serializeLog(row) : null
}

/** Inserts a new clock-in row and returns the serialized public-surface row. */
export async function clockIn(
  data: {
    tenantId: string
    userId: number
    branchId: number
    createdById: number
  },
  tx: Tx,
): Promise<StaffTimeLogRow> {
  const [inserted] = await tx
    .insert(staffTimeLogs)
    .values({
      displayId: displayId('TLG'),
      tenantId: data.tenantId,
      userId: data.userId,
      branchId: data.branchId,
      clockInAt: new Date(),
      createdById: data.createdById,
    })
    .returning({ id: staffTimeLogs.id })

  // Re-fetch with joins to surface display_ids on user + branch.
  const [row] = await tx
    .select({
      id: staffTimeLogs.id,
      displayId: staffTimeLogs.displayId,
      userDisplayId: users.displayId,
      branchDisplayId: branches.displayId,
      clockInAt: staffTimeLogs.clockInAt,
      clockOutAt: staffTimeLogs.clockOutAt,
      totalHours: staffTimeLogs.totalHours,
      notes: staffTimeLogs.notes,
      createdAt: staffTimeLogs.createdAt,
      updatedAt: staffTimeLogs.updatedAt,
    })
    .from(staffTimeLogs)
    .innerJoin(users, eq(staffTimeLogs.userId, users.id))
    .innerJoin(branches, eq(staffTimeLogs.branchId, branches.id))
    .where(eq(staffTimeLogs.id, inserted!.id))
    .limit(1)

  return serializeLog(row!)
}

/** Sets clockOutAt + computes totalHours for the given internal log ID. */
export async function clockOut(
  tenantId: string,
  id: number,
  notes: string | undefined,
  tx: Tx,
): Promise<StaffTimeLogRow | null> {
  const now = new Date()
  const [updated] = await tx
    .update(staffTimeLogs)
    .set({
      clockOutAt: now,
      notes: notes ?? null,
      totalHours: sql<string>`EXTRACT(EPOCH FROM (${now.toISOString()}::timestamptz - clock_in_at)) / 3600`,
      updatedAt: now,
    })
    .where(and(eq(staffTimeLogs.id, id), eq(staffTimeLogs.tenantId, tenantId)))
    .returning({ id: staffTimeLogs.id })

  if (!updated) return null

  const [row] = await tx
    .select({
      id: staffTimeLogs.id,
      displayId: staffTimeLogs.displayId,
      userDisplayId: users.displayId,
      branchDisplayId: branches.displayId,
      clockInAt: staffTimeLogs.clockInAt,
      clockOutAt: staffTimeLogs.clockOutAt,
      totalHours: staffTimeLogs.totalHours,
      notes: staffTimeLogs.notes,
      createdAt: staffTimeLogs.createdAt,
      updatedAt: staffTimeLogs.updatedAt,
    })
    .from(staffTimeLogs)
    .innerJoin(users, eq(staffTimeLogs.userId, users.id))
    .innerJoin(branches, eq(staffTimeLogs.branchId, branches.id))
    .where(eq(staffTimeLogs.id, updated.id))
    .limit(1)

  return row ? serializeLog(row) : null
}

/** Opens a cash_drawer_sessions row for the given user/branch at clock-in time.
 *  Catches the 23505 unique-violation from the partial index on
 *  (tenant_id, branch_id) WHERE state='Open' and re-raises as
 *  DRAWER_ALREADY_OPEN so the clock-in route can return a clean 409. */
export async function openDrawerSession(
  data: {
    tenantId: string
    userId: number
    branchId: number
    openingFloat: string
    createdById: number
  },
  tx: Tx,
) {
  try {
    const [row] = await tx
      .insert(cashDrawerSessions)
      .values({
        displayId: displayId('CSH'),
        tenantId: data.tenantId,
        userId: data.userId,
        branchId: data.branchId,
        state: 'Open',
        openingFloat: data.openingFloat,
        openedAt: new Date(),
        createdById: data.createdById,
      })
      .returning()
    if (!row) {
      // Concurrent INSERT won the race (e.g. .onConflictDoNothing() path).
      const err = new Error('A drawer session is already open for this branch')
      ;(err as NodeJS.ErrnoException).code = 'DRAWER_ALREADY_OPEN'
      throw err
    }
    return row
  } catch (insertErr: unknown) {
    const pgCode = (insertErr as { code?: string }).code
    if (pgCode === '23505') {
      const err = new Error('A drawer session is already open for this branch')
      ;(err as NodeJS.ErrnoException).code = 'DRAWER_ALREADY_OPEN'
      throw err
    }
    throw insertErr
  }
}

/**
 * Closes the most-recent Open cash_drawer_sessions row for the given
 * user/branch today. Computes:
 *   expected_total = opening_float + sum(payments linked to this session)
 *   variance       = closing_total_declared - expected_total
 */
export async function closeDrawerSession(
  data: {
    tenantId: string
    userId: number
    branchId: number
    closingTotalDeclared: string
  },
  tx: Tx,
) {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date()
  todayEnd.setHours(23, 59, 59, 999)

  // Find the open session for this user/branch today.
  const [session] = await tx
    .select({ id: cashDrawerSessions.id, openingFloat: cashDrawerSessions.openingFloat })
    .from(cashDrawerSessions)
    .where(
      and(
        eq(cashDrawerSessions.tenantId, data.tenantId),
        eq(cashDrawerSessions.userId, data.userId),
        eq(cashDrawerSessions.branchId, data.branchId),
        eq(cashDrawerSessions.state, 'Open'),
        gte(cashDrawerSessions.openedAt, todayStart),
        lt(cashDrawerSessions.openedAt, todayEnd),
      ),
    )
    .orderBy(cashDrawerSessions.openedAt)
    .limit(1)

  if (!session) return null

  // Sum Cash payments linked to this drawer session (CASH-2: single source of
  // truth = cash_drawer_session_id). Only Cash physically lands in the drawer;
  // exclude card/e-wallet and Voided/Refunded parents (refunded cash was
  // returned from the drawer, MONEY-2). Also exclude voided payments: a
  // corrected-and-replaced row would otherwise double-count against its
  // replacement in the same close-out total.
  const [paymentsSum] = await tx
    .select({ total: sum(payments.amount) })
    .from(payments)
    .innerJoin(transactions, eq(payments.transactionId, transactions.id))
    .where(
      and(
        eq(payments.tenantId, data.tenantId),
        eq(payments.cashDrawerSessionId, session.id),
        eq(payments.method, 'Cash'),
        sql`${transactions.status} NOT IN ('Voided', 'Refunded')`,
        isNull(transactions.deletedAt),
        isNull(payments.voidedAt),
      ),
    )

  const collected = parseFloat(paymentsSum?.total ?? '0')
  const openingFloat = parseFloat(session.openingFloat)
  const closingDeclared = parseFloat(data.closingTotalDeclared)
  const expectedTotal = (openingFloat + collected).toFixed(2)
  const variance = (closingDeclared - parseFloat(expectedTotal)).toFixed(2)

  const now = new Date()
  const [row] = await tx
    .update(cashDrawerSessions)
    .set({
      state: 'Closed',
      closingTotalDeclared: data.closingTotalDeclared,
      expectedTotal,
      variance,
      closedAt: now,
      updatedAt: now,
    })
    .where(
      and(eq(cashDrawerSessions.id, session.id), eq(cashDrawerSessions.tenantId, data.tenantId)),
    )
    .returning()
  return row ?? null
}

/** Returns the cash_drawer_sessions row for a staff time log (joined on
 *  userId + branchId + same calendar day as clockInAt). */
export async function getDrawerSessionForLog(
  tenantId: string,
  logBigintId: number,
): Promise<DrawerSessionSummary | null> {
  const log = await withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const [r] = await tx
      .select({
        userId: staffTimeLogs.userId,
        branchId: staffTimeLogs.branchId,
        clockInAt: staffTimeLogs.clockInAt,
      })
      .from(staffTimeLogs)
      .where(and(eq(staffTimeLogs.tenantId, tenantId), eq(staffTimeLogs.id, logBigintId)))
      .limit(1)
    return r ?? null
  })

  if (!log) return null

  const dayStart = new Date(log.clockInAt)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(log.clockInAt)
  dayEnd.setHours(23, 59, 59, 999)

  const row = await withTenantTx({ tenantId, userId: 0, branchId: log.branchId }, async (tx) => {
    const [r] = await tx
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
          eq(cashDrawerSessions.userId, log.userId),
          eq(cashDrawerSessions.branchId, log.branchId),
          gte(cashDrawerSessions.openedAt, dayStart),
          lt(cashDrawerSessions.openedAt, dayEnd),
        ),
      )
      .orderBy(cashDrawerSessions.openedAt)
      .limit(1)
    return r ?? null
  })

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

/** List staff time logs for a tenant, ordered by clockInAt desc. */
export async function listStaffTimeLogs(tenantId: string, limit = 50): Promise<StaffTimeLogRow[]> {
  const rows = await withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) =>
    tx
      .select({
        id: staffTimeLogs.id,
        displayId: staffTimeLogs.displayId,
        userDisplayId: users.displayId,
        branchDisplayId: branches.displayId,
        clockInAt: staffTimeLogs.clockInAt,
        clockOutAt: staffTimeLogs.clockOutAt,
        totalHours: staffTimeLogs.totalHours,
        notes: staffTimeLogs.notes,
        createdAt: staffTimeLogs.createdAt,
        updatedAt: staffTimeLogs.updatedAt,
      })
      .from(staffTimeLogs)
      .innerJoin(users, eq(staffTimeLogs.userId, users.id))
      .innerJoin(branches, eq(staffTimeLogs.branchId, branches.id))
      .where(eq(staffTimeLogs.tenantId, tenantId))
      .orderBy(staffTimeLogs.clockInAt)
      .limit(limit),
  )

  return rows.map(serializeLog)
}

/** Return a single staff time log by display_id with createdBy resolution. */
export async function getLogByDisplayId(
  tenantId: string,
  logDisplayId: string,
): Promise<{
  row: StaffTimeLogRow & {
    createdBy: { id: number; displayId: string; firstName: string; lastName: string } | null
  }
  bigintId: number
} | null> {
  const createdByUser = alias(users, 'created_by_user')
  const row = await withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const [r] = await tx
      .select({
        id: staffTimeLogs.id,
        displayId: staffTimeLogs.displayId,
        userDisplayId: users.displayId,
        branchDisplayId: branches.displayId,
        clockInAt: staffTimeLogs.clockInAt,
        clockOutAt: staffTimeLogs.clockOutAt,
        totalHours: staffTimeLogs.totalHours,
        notes: staffTimeLogs.notes,
        createdAt: staffTimeLogs.createdAt,
        updatedAt: staffTimeLogs.updatedAt,
        // createdBy
        createdByUserId: createdByUser.id,
        createdByDisplayId: createdByUser.displayId,
        createdByFirstName: createdByUser.firstName,
        createdByLastName: createdByUser.lastName,
      })
      .from(staffTimeLogs)
      .innerJoin(users, eq(staffTimeLogs.userId, users.id))
      .innerJoin(branches, eq(staffTimeLogs.branchId, branches.id))
      .leftJoin(createdByUser, eq(createdByUser.id, staffTimeLogs.createdById))
      .where(and(eq(staffTimeLogs.tenantId, tenantId), eq(staffTimeLogs.displayId, logDisplayId)))
      .limit(1)
    return r ?? null
  })
  if (!row) return null
  return {
    row: {
      ...serializeLog(row),
      createdBy: row.createdByUserId
        ? {
            id: row.createdByUserId,
            displayId: row.createdByDisplayId!,
            firstName: row.createdByFirstName!,
            lastName: row.createdByLastName!,
          }
        : null,
    },
    bigintId: row.id,
  }
}
