import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { getDaySnapshot, createDaySnapshot } from '../../src/modules/day_summary/service.js'
import { db } from '../../src/shared/db/index.js'
import { branches, daySummarySnapshots, users } from '../../src/shared/db/schema.js'
import { withTenantTx } from '../../src/shared/db/withTenantTx.js'

const TENANT = 'SVX'
const SNAPSHOT_DATE = '2099-12-31'

let branchId = 0
let userId = 0

beforeAll(async () => {
  const [branch] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.tenantId, TENANT), eq(branches.code, 'HST')))
    .limit(1)
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, TENANT), eq(users.email, 'admin@surevax.com')))
    .limit(1)

  if (!branch || !user) throw new Error('seeded HST branch and admin user are required')
  branchId = branch.id
  userId = user.id
})

afterAll(async () => {
  if (!branchId || !userId) return
  await withTenantTx({ tenantId: TENANT, userId, branchId }, async (tx) => {
    await tx
      .delete(daySummarySnapshots)
      .where(
        and(
          eq(daySummarySnapshots.tenantId, TENANT),
          eq(daySummarySnapshots.branchId, branchId),
          eq(daySummarySnapshots.snapshotDate, SNAPSHOT_DATE),
        ),
      )
  })
})

describe('day-summary snapshot public IDs', () => {
  it('returns the branch display ID when reading a persisted snapshot under RLS', async () => {
    const ctx = { tenantId: TENANT, userId, branchId, date: SNAPSHOT_DATE }

    await createDaySnapshot(ctx)
    const snapshot = await getDaySnapshot(ctx)

    expect(snapshot).not.toBeNull()
    expect(snapshot?.branchId).toBe('SVX.HST')
    expect(snapshot?.branchId).not.toMatch(/^\d+$/)
  })
})
