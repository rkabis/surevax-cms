/**
 * Integration tests for the branch cash-deposit record (AppSheet conformance
 * audit item A1). Covers `cash_drawer/db.ts`: `recordDeposit`, `voidDeposit`,
 * and the derived on-hand-cash figure returned by `getCurrentDrawerSession` /
 * `closeDrawerSession`.
 *
 * Uses the TMG branch, which carries no drawer session in the seeded
 * database, so opening/closing a session here cannot collide with the HST
 * session the running dev stack (and other integration tests) may be using.
 *
 * Not wrapped in `withRollback`: `openDrawerSession` / `recordDeposit` /
 * `voidDeposit` / `closeDrawerSession` each call `withTenantTx`, which opens
 * its own connection from the Drizzle pool and would not participate in an
 * outer rollback transaction (see patterns.md "BEGIN/ROLLBACK test isolation"
 * caveat). Cleanup is explicit in `afterAll` instead, mirroring
 * `d2-branch-isolation.test.ts` / `brand-selection.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { eq, sql as drizzleSql } from 'drizzle-orm'
import { db } from '../../src/shared/db/index.js'
import { branches, users } from '../../src/shared/db/schema.js'
import {
  openDrawerSession,
  closeDrawerSession,
  getCurrentDrawerSession,
  recordDeposit,
  voidDeposit,
} from '../../src/modules/cash_drawer/db.js'
import { withTenantTx, type TenantCtx } from '../../src/shared/db/withTenantTx.js'

const TENANT = 'SVX'

let timBranchId = 0
let adminUserId = 0
let secondUserId = 0
let sessionDisplayId = ''

function ctx(): TenantCtx {
  return { tenantId: TENANT, userId: adminUserId, branchId: timBranchId }
}

async function closeOpenTestDrawers() {
  await withTenantTx(ctx(), async (tx) => {
    await tx.execute(drizzleSql`
      UPDATE cash_drawer_sessions
      SET state = 'Closed', closed_at = now()
      WHERE tenant_id = ${TENANT} AND branch_id = ${timBranchId} AND state = 'Open'
    `)
  })
}

beforeAll(async () => {
  const timRow = await db
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.code, 'TMG'))
    .limit(1)
  if (!timRow[0]) throw new Error('TMG branch not found, run pnpm run setup first')
  timBranchId = timRow[0].id

  const adminRow = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'admin@surevax.com'))
    .limit(1)
  if (!adminRow[0]) throw new Error('admin user not found, run pnpm run setup first')
  adminUserId = adminRow[0].id

  const secondUserRow = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'juan.dc@surevax.com'))
    .limit(1)
  if (!secondUserRow[0]) throw new Error('second user not found, run pnpm setup first')
  secondUserId = secondUserRow[0].id

  // Self-heal a leftover Open session from a previously aborted run of this
  // same suite. TMG is otherwise never used for a real drawer session.
  await closeOpenTestDrawers()
})

afterAll(async () => {
  // Best-effort: make sure no test in this file leaves TMG with an Open
  // session, which would block a future run's openDrawerSession call.
  await closeOpenTestDrawers()
})

describe('cash_drawer deposits: on-hand cash (A1)', () => {
  it('allows only one concurrent Open drawer across two users in the branch', async () => {
    const attempts = await Promise.allSettled([
      openDrawerSession(ctx(), '1000.00'),
      openDrawerSession(
        { tenantId: TENANT, userId: secondUserId, branchId: timBranchId },
        '1000.00',
      ),
    ])

    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = attempts.find((result) => result.status === 'rejected')
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { code: 'DRAWER_ALREADY_OPEN' },
    })

    await closeOpenTestDrawers()
  })

  it('opens a drawer with onHandCash equal to the opening float', async () => {
    const session = await openDrawerSession(ctx(), '1000.00')
    sessionDisplayId = session.id
    expect(session.onHandCash).toBe('1000.00')
    expect(session.depositsTotal).toBe('0.00')
    expect(session.deposits).toEqual([])

    // Recovery must continue to resolve this same drawer after Manila day
    // rollover instead of treating it as if no drawer exists.
    await withTenantTx(ctx(), async (tx) => {
      await tx.execute(drizzleSql`
        UPDATE cash_drawer_sessions
        SET opened_at = now() - interval '1 day'
        WHERE tenant_id = ${TENANT} AND display_id = ${sessionDisplayId}
      `)
    })
    expect((await getCurrentDrawerSession(ctx()))?.id).toBe(sessionDisplayId)
  })

  it('records a deposit against a prior-day drawer and reduces onHandCash', async () => {
    const deposit = await recordDeposit(ctx(), {
      amount: '400.00',
      depositSlipNumber: 'TEST-SLIP-1',
    })
    expect(deposit.amount).toBe('400.00')
    expect(deposit.voidedAt).toBeNull()

    const current = await getCurrentDrawerSession(ctx())
    expect(current?.onHandCash).toBe('600.00')
    expect(current?.depositsTotal).toBe('400.00')
    expect(current?.deposits).toHaveLength(1)
  })

  it('voids a deposit and restores onHandCash', async () => {
    const before = await getCurrentDrawerSession(ctx())
    const depositId = before!.deposits[0]!.id

    const voided = await voidDeposit(ctx(), depositId, 'Test correction: wrong amount keyed in')
    expect(voided.voidedAt).not.toBeNull()

    const after = await getCurrentDrawerSession(ctx())
    expect(after?.onHandCash).toBe('1000.00')
    expect(after?.depositsTotal).toBe('0.00')
  })

  it('rejects voiding an already-voided deposit', async () => {
    const current = await getCurrentDrawerSession(ctx())
    const depositId = current!.deposits[0]!.id

    await expect(voidDeposit(ctx(), depositId, 'second attempt')).rejects.toMatchObject({
      code: 'ALREADY_VOIDED',
    })
  })

  it('rejects voiding a deposit after its drawer session has closed', async () => {
    const deposit = await recordDeposit(ctx(), { amount: '150.00' })
    // expected = 1000.00 opening + 0 cash collected - 150.00 deposit = 850.00
    const closed = await closeDrawerSession(ctx(), sessionDisplayId, '850.00')
    expect(closed.expectedTotal).toBe('850.00')
    expect(closed.variance).toBe('0.00')

    await expect(voidDeposit(ctx(), deposit.id, 'too late')).rejects.toMatchObject({
      code: 'DRAWER_CLOSED',
    })
  })

  it('rejects recording a deposit when no drawer is open', async () => {
    await expect(recordDeposit(ctx(), { amount: '50.00' })).rejects.toMatchObject({
      code: 'NO_OPEN_DRAWER',
    })
  })

  it('records against the same Manila-day drawer before 08:00 PHT', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-22T16:30:00Z')) // 00:30 Aug 23 in Manila

    try {
      const session = await openDrawerSession(ctx(), '1000.00')
      const current = await getCurrentDrawerSession(ctx())
      expect(current?.id).toBe(session.id)

      const deposit = await recordDeposit(ctx(), { amount: '100.00' })
      expect(deposit.id).toMatch(/^DEP_[A-Z0-9]+$/)

      const updated = await getCurrentDrawerSession(ctx())
      expect(updated?.depositsTotal).toBe('100.00')
      await closeDrawerSession(ctx(), session.id, '900.00')
    } finally {
      vi.useRealTimers()
    }
  })
})
