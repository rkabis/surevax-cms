import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { withTenantTx, type Tx, type TenantCtx } from '../../shared/db/withTenantTx.js'
import {
  cashDrawerSessions,
  cashDeposits,
  payments,
  transactions,
  users,
} from '../../shared/db/schema.js'
import { displayId } from '../../shared/utils/displayId.js'

export type CashDeposit = {
  /** Public handle: DEP_<8 base32> display_id. */
  id: string
  amount: string
  depositSlipNumber: string | null
  depositedAt: string
  notes: string | null
  voidedAt: string | null
  voidReason: string | null
  recordedByName: string | null
}

export type DrawerSession = {
  /** Public handle: CSH_<8 base32> display_id. */
  id: string
  openingFloat: string
  closingTotalDeclared: string | null
  expectedTotal: string | null
  variance: string | null
  state: string
  openedAt: string
  closedAt: string | null
  /**
   * Live-derived fields, populated only while the session is Open (a Closed
   * session's expectedTotal/variance are the frozen, already-correct values
   * written by closeDrawerSession). null on a session these don't apply to.
   */
  cashCollected: string | null
  depositsTotal: string | null
  onHandCash: string | null
  deposits: CashDeposit[]
}

/**
 * Computes the three cash figures for an Open drawer session, DERIVED on
 * every read rather than stored, the same shape as `getPatientCredit`
 * (patient_accounts/db.ts), because a stored running balance drifts and the
 * immutability trigger on settled financial rows forbids rewriting it back.
 *
 *   cashCollected  = SUM(payments.amount) for this session, method='Cash',
 *                    excluding Voided/Refunded/soft-deleted transactions and
 *                    voided payments (a corrected-and-replaced row, kept for
 *                    audit but must not double-count against its replacement).
 *                    Mirrors closeDrawerSession's existing reconciliation
 *                    query (CASH-2): reconciles by cash_drawer_session_id, the
 *                    single source of truth, not a date-range guess. A cash
 *                    payment on an `is_prepayment` transaction IS real cash
 *                    physically in the drawer, so it is NOT excluded here:
 *                    that exclusion in day_summary/patterns.md is a REVENUE
 *                    recognition rule (deferred revenue isn't today's
 *                    revenue), a different concern from "is this cash
 *                    physically present." shifts.getCurrentShift's `collected`
 *                    figure (the canonical reference for this distinction)
 *                    makes the same call: it excludes only the internal
 *                    'Credit' method (a draw-down that reallocates money
 *                    already collected, bringing in no new cash) plus
 *                    Voided/Refunded/soft-deleted, never is_prepayment.
 *   depositsTotal  = SUM(cash_deposits.amount) for this session, excluding
 *                    voided deposits.
 *   onHandCash     = openingFloat + cashCollected - depositsTotal.
 *
 * This is the AppSheet parity formula (b_CashBalance = cash received - bank
 * deposits made), scoped to the session currently on the floor so it also
 * matches what closeDrawerSession stores as expectedTotal at close time.
 */
async function computeCashFigures(
  tx: Tx,
  tenantId: string,
  sessionId: number,
  openingFloat: string,
): Promise<{ cashCollected: string; depositsTotal: string; expectedTotal: string }> {
  const [cashSum] = await tx
    .select({
      total: sql<string>`COALESCE(SUM(CAST(${payments.amount} AS numeric)), 0)`,
    })
    .from(payments)
    .innerJoin(transactions, eq(payments.transactionId, transactions.id))
    .where(
      and(
        eq(payments.tenantId, tenantId),
        eq(payments.cashDrawerSessionId, sessionId),
        eq(payments.method, 'Cash'),
        sql`${transactions.status} NOT IN ('Voided', 'Refunded')`,
        isNull(transactions.deletedAt),
        // A voided payment is a corrected-and-replaced row: it never physically
        // left cash in the drawer twice, so it must not double-count against
        // its replacement here.
        isNull(payments.voidedAt),
      ),
    )

  const [depositSum] = await tx
    .select({
      total: sql<string>`COALESCE(SUM(CAST(${cashDeposits.amount} AS numeric)), 0)`,
    })
    .from(cashDeposits)
    .where(
      and(
        eq(cashDeposits.tenantId, tenantId),
        eq(cashDeposits.cashDrawerSessionId, sessionId),
        isNull(cashDeposits.voidedAt),
      ),
    )

  const floatNum = parseFloat(openingFloat)
  const cashNum = parseFloat(cashSum?.total ?? '0')
  const depositsNum = parseFloat(depositSum?.total ?? '0')
  const expectedNum = floatNum + cashNum - depositsNum

  return {
    cashCollected: cashNum.toFixed(2),
    depositsTotal: depositsNum.toFixed(2),
    expectedTotal: expectedNum.toFixed(2),
  }
}

async function listDeposits(tx: Tx, tenantId: string, sessionId: number): Promise<CashDeposit[]> {
  const rows = await tx
    .select({
      id: cashDeposits.displayId,
      amount: cashDeposits.amount,
      depositSlipNumber: cashDeposits.depositSlipNumber,
      depositedAt: cashDeposits.depositedAt,
      notes: cashDeposits.notes,
      voidedAt: cashDeposits.voidedAt,
      voidReason: cashDeposits.voidReason,
      recordedByFirstName: users.firstName,
      recordedByLastName: users.lastName,
    })
    .from(cashDeposits)
    .leftJoin(users, eq(cashDeposits.createdById, users.id))
    .where(
      and(eq(cashDeposits.tenantId, tenantId), eq(cashDeposits.cashDrawerSessionId, sessionId)),
    )
    .orderBy(desc(cashDeposits.depositedAt))

  return rows.map((r) => ({
    id: r.id,
    amount: r.amount,
    depositSlipNumber: r.depositSlipNumber ?? null,
    depositedAt: r.depositedAt.toISOString(),
    notes: r.notes ?? null,
    voidedAt: r.voidedAt ? r.voidedAt.toISOString() : null,
    voidReason: r.voidReason ?? null,
    recordedByName:
      r.recordedByFirstName || r.recordedByLastName
        ? `${r.recordedByFirstName ?? ''} ${r.recordedByLastName ?? ''}`.trim()
        : null,
  }))
}

/** Return the oldest currently-Open drawer session for the branch.
 *  Prior-day sessions remain resolvable until an accountable operator closes
 *  them; otherwise the Review Center could identify a financial exception but
 *  its owner workflow would hide the target. */
export async function getCurrentDrawerSession(ctx: TenantCtx): Promise<DrawerSession | null> {
  if (ctx.branchId === null) return null

  const branchId = ctx.branchId
  return withTenantTx(ctx, async (tx) => {
    const [row] = await tx
      .select({
        id: cashDrawerSessions.id,
        // Surface display_id as the public id field, never leak bigint.
        displayId: cashDrawerSessions.displayId,
        openingFloat: cashDrawerSessions.openingFloat,
        closingTotalDeclared: cashDrawerSessions.closingTotalDeclared,
        expectedTotal: cashDrawerSessions.expectedTotal,
        variance: cashDrawerSessions.variance,
        state: cashDrawerSessions.state,
        openedAt: cashDrawerSessions.openedAt,
        closedAt: cashDrawerSessions.closedAt,
      })
      .from(cashDrawerSessions)
      .where(
        and(
          eq(cashDrawerSessions.tenantId, ctx.tenantId),
          // Shared physical drawer: one Open session per branch across day
          // rollover, regardless of which operator opened it.
          eq(cashDrawerSessions.branchId, branchId),
          eq(cashDrawerSessions.state, 'Open'),
        ),
      )
      .orderBy(asc(cashDrawerSessions.openedAt))
      .limit(1)

    if (!row) return null

    const [figures, deposits] = await Promise.all([
      computeCashFigures(tx, ctx.tenantId, row.id, row.openingFloat),
      listDeposits(tx, ctx.tenantId, row.id),
    ])

    return {
      id: row.displayId,
      openingFloat: row.openingFloat,
      closingTotalDeclared: row.closingTotalDeclared ?? null,
      // Live expectedTotal/variance are computed here (not read from the
      // stored columns, which stay null until close) so the drawer card can
      // show a running figure before the session is closed.
      expectedTotal: figures.expectedTotal,
      variance: row.variance ?? null,
      state: row.state,
      openedAt: row.openedAt.toISOString(),
      closedAt: row.closedAt ? row.closedAt.toISOString() : null,
      cashCollected: figures.cashCollected,
      depositsTotal: figures.depositsTotal,
      onHandCash: figures.expectedTotal,
      deposits,
    }
  })
}

/** Create a new Open cash drawer session. Fails if this branch already has an
 *  open session, including an unclosed prior-day session. */
export async function openDrawerSession(
  ctx: TenantCtx,
  openingFloat: string,
): Promise<DrawerSession> {
  if (ctx.branchId === null) throw new Error('branchId required to open a drawer')
  const branchId = ctx.branchId

  return withTenantTx(ctx, async (tx) => {
    // Guard: a prior-day session must be reconciled before another shared
    // branch drawer can open.
    const [existing] = await tx
      .select({ id: cashDrawerSessions.id })
      .from(cashDrawerSessions)
      .where(
        and(
          eq(cashDrawerSessions.tenantId, ctx.tenantId),
          // Shared physical drawer: one Open session per branch across day
          // rollover, regardless of which operator opened it.
          eq(cashDrawerSessions.branchId, branchId),
          eq(cashDrawerSessions.state, 'Open'),
        ),
      )
      .limit(1)

    if (existing) {
      const err = new Error('A drawer session is already open for this branch')
      ;(err as NodeJS.ErrnoException).code = 'DRAWER_ALREADY_OPEN'
      throw err
    }

    const newDisplayId = displayId('CSH')
    const now = new Date()

    let inserted: { displayId: string; openedAt: Date } | undefined
    try {
      const [row] = await tx
        .insert(cashDrawerSessions)
        .values({
          displayId: newDisplayId,
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          branchId,
          state: 'Open',
          openingFloat,
          openedAt: now,
          createdById: ctx.userId,
        })
        .returning({
          displayId: cashDrawerSessions.displayId,
          openedAt: cashDrawerSessions.openedAt,
        })
      inserted = row
    } catch (insertErr: unknown) {
      // The partial unique index on (tenant_id, branch_id) WHERE state='Open'
      // prevents double-open even under concurrent requests. Translate the 23505
      // unique-violation into the same DRAWER_ALREADY_OPEN error the pre-check would raise.
      const pgCode = (insertErr as { code?: string }).code
      if (pgCode === '23505') {
        const err = new Error('A drawer session is already open for this branch')
        ;(err as NodeJS.ErrnoException).code = 'DRAWER_ALREADY_OPEN'
        throw err
      }
      throw insertErr
    }

    if (!inserted) {
      // Defensive guard: no returned row means the INSERT did not create a session.
      const err = new Error('A drawer session is already open for this branch')
      ;(err as NodeJS.ErrnoException).code = 'DRAWER_ALREADY_OPEN'
      throw err
    }

    return {
      id: inserted.displayId,
      openingFloat,
      closingTotalDeclared: null,
      expectedTotal: openingFloat,
      variance: null,
      state: 'Open',
      openedAt: inserted.openedAt.toISOString(),
      closedAt: null,
      cashCollected: '0.00',
      depositsTotal: '0.00',
      onHandCash: openingFloat,
      deposits: [],
    }
  })
}

/** Close an open drawer session. `sessionDisplayId` is the CSH_<8 base32> public id.
 *
 *  Server computes the expected total as:
 *    openingFloat + cash payments received on this session - deposits
 *    taken out of this session (see computeCashFigures for the full filter
 *    set). Only Cash payments are in the physical drawer; card/bank are
 *    excluded, and a bank deposit is money that physically LEFT the drawer,
 *    so it must reduce the expected count same as it reduces the running
 *    on-hand figure while the session is still open.
 *
 *  variance = closingTotalDeclared - expectedTotal
 */
export async function closeDrawerSession(
  ctx: TenantCtx,
  sessionDisplayId: string,
  closingTotalDeclared: string,
): Promise<DrawerSession> {
  if (ctx.branchId === null) throw new Error('branchId required to close a drawer')
  const branchId = ctx.branchId

  return withTenantTx(ctx, async (tx) => {
    // Fetch the session by display_id; ensure it belongs to this tenant+branch and is Open.
    const [session] = await tx
      .select({
        id: cashDrawerSessions.id,
        displayId: cashDrawerSessions.displayId,
        openingFloat: cashDrawerSessions.openingFloat,
        openedAt: cashDrawerSessions.openedAt,
        state: cashDrawerSessions.state,
      })
      .from(cashDrawerSessions)
      .where(
        and(
          eq(cashDrawerSessions.tenantId, ctx.tenantId),
          eq(cashDrawerSessions.branchId, branchId),
          eq(cashDrawerSessions.displayId, sessionDisplayId),
        ),
      )
      .limit(1)

    if (!session) {
      const err = new Error('Drawer session not found')
      ;(err as NodeJS.ErrnoException).code = 'NOT_FOUND'
      throw err
    }

    if (session.state !== 'Open') {
      const err = new Error('Drawer session is already closed')
      ;(err as NodeJS.ErrnoException).code = 'DRAWER_NOT_OPEN'
      throw err
    }

    const { expectedTotal } = await computeCashFigures(
      tx,
      ctx.tenantId,
      session.id,
      session.openingFloat,
    )

    const closingNum = parseFloat(closingTotalDeclared)
    const variance = (closingNum - parseFloat(expectedTotal)).toFixed(2)

    const now = new Date()

    await tx
      .update(cashDrawerSessions)
      .set({
        state: 'Closed',
        closingTotalDeclared,
        expectedTotal,
        variance,
        closedAt: now,
        updatedAt: now,
      })
      .where(
        and(eq(cashDrawerSessions.tenantId, ctx.tenantId), eq(cashDrawerSessions.id, session.id)),
      )

    const deposits = await listDeposits(tx, ctx.tenantId, session.id)

    return {
      id: session.displayId,
      openingFloat: session.openingFloat,
      closingTotalDeclared,
      expectedTotal,
      variance,
      state: 'Closed',
      openedAt: session.openedAt.toISOString(),
      closedAt: now.toISOString(),
      cashCollected: null,
      depositsTotal: null,
      onHandCash: null,
      deposits,
    }
  })
}

/**
 * Record a cash-out-to-the-bank deposit against the caller's currently-Open
 * drawer session. Cash is banked at intervals that don't line up with drawer
 * open/close, but it always comes out of whichever session is on the floor
 * right now, so the deposit is always stamped with that session's id (the
 * same "reconcile by cash_drawer_session_id, not a date guess" discipline
 * CASH-2 already established for payments).
 */
export async function recordDeposit(
  ctx: TenantCtx,
  input: { amount: string; depositSlipNumber?: string; notes?: string },
): Promise<CashDeposit> {
  if (ctx.branchId === null) throw new Error('branchId required to record a deposit')
  const branchId = ctx.branchId

  return withTenantTx(ctx, async (tx) => {
    const [session] = await tx
      .select({ id: cashDrawerSessions.id })
      .from(cashDrawerSessions)
      .where(
        and(
          eq(cashDrawerSessions.tenantId, ctx.tenantId),
          eq(cashDrawerSessions.branchId, branchId),
          eq(cashDrawerSessions.state, 'Open'),
        ),
      )
      .orderBy(asc(cashDrawerSessions.openedAt))
      .limit(1)

    if (!session) {
      const err = new Error('No open drawer session to deposit from')
      ;(err as NodeJS.ErrnoException).code = 'NO_OPEN_DRAWER'
      throw err
    }

    const newDisplayId = displayId('DEP')
    const now = new Date()

    const [row] = await tx
      .insert(cashDeposits)
      .values({
        displayId: newDisplayId,
        tenantId: ctx.tenantId,
        branchId,
        cashDrawerSessionId: session.id,
        amount: input.amount,
        depositSlipNumber: input.depositSlipNumber ?? null,
        depositedAt: now,
        notes: input.notes ?? null,
        createdById: ctx.userId,
      })
      .returning({ displayId: cashDeposits.displayId, depositedAt: cashDeposits.depositedAt })

    if (!row) {
      throw new Error('Failed to insert cash deposit row')
    }

    return {
      id: row.displayId,
      amount: input.amount,
      depositSlipNumber: input.depositSlipNumber ?? null,
      depositedAt: row.depositedAt.toISOString(),
      notes: input.notes ?? null,
      voidedAt: null,
      voidReason: null,
      recordedByName: null,
    }
  })
}

/**
 * Void a previously-recorded deposit. Corrections here are inline + warned
 * (frontend confirm) + logged (audit trigger on cash_deposits), NOT an
 * approval queue, mirroring the codebase's standing position on sensitive
 * financial corrections (backdate/void/cross-branch elsewhere). The row is
 * never mutated back to "not deposited": voidedAt/voidReason record the
 * reversal, so a voided deposit still shows in history but drops out of
 * computeCashFigures's depositsTotal (and therefore back into onHandCash).
 *
 * Refused once the owning drawer session has already closed: expectedTotal/
 * variance are frozen at close time, and voiding afterward would silently
 * make those stored numbers wrong with no recomputation path.
 */
export async function voidDeposit(
  ctx: TenantCtx,
  depositDisplayId: string,
  reason: string,
): Promise<CashDeposit> {
  if (ctx.branchId === null) throw new Error('branchId required to void a deposit')
  const branchId = ctx.branchId

  return withTenantTx(ctx, async (tx) => {
    const [deposit] = await tx
      .select({
        id: cashDeposits.id,
        displayId: cashDeposits.displayId,
        amount: cashDeposits.amount,
        depositSlipNumber: cashDeposits.depositSlipNumber,
        depositedAt: cashDeposits.depositedAt,
        notes: cashDeposits.notes,
        voidedAt: cashDeposits.voidedAt,
        sessionId: cashDeposits.cashDrawerSessionId,
      })
      .from(cashDeposits)
      .where(
        and(
          eq(cashDeposits.tenantId, ctx.tenantId),
          eq(cashDeposits.branchId, branchId),
          eq(cashDeposits.displayId, depositDisplayId),
        ),
      )
      .limit(1)

    if (!deposit) {
      const err = new Error('Deposit not found')
      ;(err as NodeJS.ErrnoException).code = 'NOT_FOUND'
      throw err
    }

    if (deposit.voidedAt) {
      const err = new Error('Deposit is already voided')
      ;(err as NodeJS.ErrnoException).code = 'ALREADY_VOIDED'
      throw err
    }

    const [session] = await tx
      .select({ state: cashDrawerSessions.state })
      .from(cashDrawerSessions)
      .where(
        and(
          eq(cashDrawerSessions.tenantId, ctx.tenantId),
          eq(cashDrawerSessions.id, deposit.sessionId),
        ),
      )
      .limit(1)

    if (session?.state !== 'Open') {
      const err = new Error('Cannot void a deposit after its drawer session has closed')
      ;(err as NodeJS.ErrnoException).code = 'DRAWER_CLOSED'
      throw err
    }

    const now = new Date()
    await tx
      .update(cashDeposits)
      .set({
        voidedAt: now,
        voidedById: ctx.userId,
        voidReason: reason,
        updatedAt: now,
      })
      .where(and(eq(cashDeposits.tenantId, ctx.tenantId), eq(cashDeposits.id, deposit.id)))

    return {
      id: deposit.displayId,
      amount: deposit.amount,
      depositSlipNumber: deposit.depositSlipNumber ?? null,
      depositedAt: deposit.depositedAt.toISOString(),
      notes: deposit.notes ?? null,
      voidedAt: now.toISOString(),
      voidReason: reason,
      recordedByName: null,
    }
  })
}
