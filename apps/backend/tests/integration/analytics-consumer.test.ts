/**
 * Integration tests for analyticsConsumer revenue rollup idempotency.
 *
 * Regression guard for the TransactionCreated + TransactionPaid double-count:
 * both events fire with the same aggregateId. The old code incremented the
 * rollup unconditionally (+=), so two events produced transaction_count = 2×.
 * The fix recomputes from the live transactions table (SET =), making each
 * invocation idempotent — N firings always yield the correct aggregate.
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from '../../src/shared/db/index.js'
import { withSystemTx } from '../../src/shared/db/withTenantTx.js'
import { analyticsConsumer } from '../../src/workers/domainEventConsumers/analyticsConsumer.js'
import type { DomainEventRow } from '../../src/workers/domainEventsPublisher.js'

const TENANT_ID = 'SVX'
const MANILA_TZ = 'Asia/Manila'

function dateToDateId(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MANILA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const year = parts.find((p) => p.type === 'year')?.value ?? '0000'
  const month = parts.find((p) => p.type === 'month')?.value ?? '01'
  const day = parts.find((p) => p.type === 'day')?.value ?? '01'
  return parseInt(year + month + day, 10)
}

function manilaDateStr(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MANILA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d) // 'YYYY-MM-DD'
}

describe('analyticsConsumer — revenue rollup idempotency', () => {
  let testBranchId: number
  let testTxnDisplayId: string
  let testDateId: number
  let testBranchIdStr: string

  beforeAll(async () => {
    const [txn] = await db.execute<{
      id: number
      display_id: string
      branch_id: number
      // db.execute returns raw postgres.js results; timestamptz may come back as
      // a string or Date depending on driver config — normalise with new Date().
      transacted_at: Date | string
    }>(sql`
      SELECT t.id, t.display_id, t.branch_id, t.transacted_at
      FROM   transactions t
      WHERE  t.tenant_id    = ${TENANT_ID}
        AND  t.status       = 'Paid'
        AND  t.is_prepayment = false
        AND  t.deleted_at   IS NULL
      LIMIT 1
    `)
    if (!txn) throw new Error('no seeded Paid transaction found; run pnpm run setup')

    testBranchId = txn.branch_id
    testTxnDisplayId = txn.display_id
    testBranchIdStr = String(txn.branch_id)
    // Normalise to Date — postgres.js may return a string for timestamp columns
    testDateId = dateToDateId(new Date(txn.transacted_at))

    // Remove any existing rollup row for this (tenant, branch, date) so the test
    // starts from a clean slate.  Both vars are set above; the delete is safe.
    await db.execute(sql`
      DELETE FROM analytics.rollup_daily_branch_revenue
      WHERE  tenant_id = ${TENANT_ID}
        AND  branch_id = ${testBranchIdStr}
        AND  date_id   = ${testDateId}
    `)
  })

  afterAll(async () => {
    // Guard: if beforeAll failed, variables are uninitialised; skip cleanup to
    // avoid a secondary "syntax error at end of input" from undefined params.
    if (!testBranchIdStr || !testDateId) return
    await db.execute(sql`
      DELETE FROM analytics.rollup_daily_branch_revenue
      WHERE  tenant_id = ${TENANT_ID}
        AND  branch_id = ${testBranchIdStr}
        AND  date_id   = ${testDateId}
    `)
  })

  it('TransactionCreated then TransactionPaid for the same txn yield the correct count (no double-count)', async () => {
    // Look up the exact Manila-TZ date string so the SQL WHERE clause in the
    // consumer matches this seed transaction's date bucket.
    const [seedTxn] = await db.execute<{ transacted_at: Date | string }>(sql`
      SELECT transacted_at FROM transactions WHERE display_id = ${testTxnDisplayId}
    `)
    // Normalise: postgres.js may return a string for timestamp columns via raw execute
    const txnDate = new Date(seedTxn!.transacted_at)
    const txnDateStr = manilaDateStr(txnDate)

    // Count the actual Paid transactions on that (branch, date) — this is the
    // expected rollup transaction_count regardless of how many events fire.
    const [{ cnt }] = await db.execute<{ cnt: number }>(sql`
      SELECT COUNT(DISTINCT id)::int AS cnt
      FROM   transactions
      WHERE  tenant_id    = ${TENANT_ID}
        AND  branch_id    = ${testBranchId}::bigint
        AND  (transacted_at AT TIME ZONE 'Asia/Manila')::date = ${txnDateStr}::date
        AND  status       NOT IN ('Voided', 'Draft')
        AND  deleted_at   IS NULL
        AND  is_prepayment = false
    `)
    expect(cnt).toBeGreaterThan(0)

    const baseEvent: Omit<DomainEventRow, 'eventType' | 'payload'> = {
      id: 99001,
      tenantId: TENANT_ID,
      aggregateType: 'Transaction',
      aggregateId: testTxnDisplayId,
      occurredAt: txnDate,
      publishedAt: null,
      publishAttempts: 0,
      metadata: null,
    }
    const payload = {
      branchId: testBranchIdStr,
      transactionDate: txnDate.toISOString(),
    }

    // First event: TransactionCreated
    await withSystemTx({ tenantId: TENANT_ID, branchId: null }, async (tx) => {
      await analyticsConsumer({ ...baseEvent, eventType: 'TransactionCreated', payload }, tx)
    })

    // Second event: TransactionPaid for the SAME transaction
    await withSystemTx({ tenantId: TENANT_ID, branchId: null }, async (tx) => {
      await analyticsConsumer({ ...baseEvent, eventType: 'TransactionPaid', payload }, tx)
    })

    const [rollup] = await db.execute<{
      transaction_count: number
      total_net: string
    }>(sql`
      SELECT transaction_count, total_net
      FROM   analytics.rollup_daily_branch_revenue
      WHERE  tenant_id = ${TENANT_ID}
        AND  branch_id = ${testBranchIdStr}
        AND  date_id   = ${testDateId}
    `)

    expect(rollup, 'rollup row should have been created').toBeTruthy()
    // The rollup must match the live count — not doubled by duplicate events.
    expect(rollup!.transaction_count).toBe(cnt)
  })
})
