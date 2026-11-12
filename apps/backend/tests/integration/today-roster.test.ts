import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { app } from '../../src/app.js'
import { db } from '../../src/shared/db/index.js'
import { branches, encounters, patients, transactions, users } from '../../src/shared/db/schema.js'
import { withTenantTx } from '../../src/shared/db/withTenantTx.js'
import { displayId } from '../../src/shared/utils/displayId.js'
import { clinicCalendarDateString } from '../../src/shared/utils/clinicDate.js'

const TENANT_ID = 'SVX'
const DATE = clinicCalendarDateString()
const FETCH_HEADER = {
  'X-Requested-With': 'fetch' as const,
  'X-Tenant-Slug': TENANT_ID,
}

function findCookie(setCookie: string[] | undefined, name: string): string | undefined {
  return setCookie?.find((cookie) => cookie.startsWith(`${name}=`))?.split(';')[0]
}

async function loginAs(email: string): Promise<string> {
  const response = await request(app)
    .post('/api/auth/login')
    .set(FETCH_HEADER)
    .send({ email, password: 'TestPass123!' })
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  return findCookie(response.headers['set-cookie'] as string[] | undefined, 'access_token')!
}

describe('Today branch-day roster snapshot', () => {
  const encounterIds = Array.from({ length: 7 }, () => displayId('ENC'))
  const pendingTransactionId = displayId('TXN')
  let hstCookie: string
  let tmgCookie: string
  let hstBranchId = 0
  let providerId = 0

  beforeAll(async () => {
    ;[hstCookie, tmgCookie] = await Promise.all([
      loginAs('branch-main@surevax.com'),
      loginAs('surevax.tmg@surevax.com'),
    ])

    const [fixture] = await db
      .select({
        branchId: branches.id,
        providerId: users.id,
        patientId: patients.id,
      })
      .from(branches)
      .innerJoin(users, and(eq(users.tenantId, TENANT_ID), eq(users.primaryBranchId, branches.id)))
      .innerJoin(
        patients,
        and(eq(patients.tenantId, TENANT_ID), eq(patients.homeBranchId, branches.id)),
      )
      .where(and(eq(branches.tenantId, TENANT_ID), eq(branches.code, 'HST')))
      .limit(1)
    expect(fixture, 'HST seed fixture missing; run pnpm setup').toBeTruthy()
    hstBranchId = fixture!.branchId
    providerId = fixture!.providerId

    await withTenantTx(
      { tenantId: TENANT_ID, userId: providerId, branchId: hstBranchId },
      async (tx) => {
        const inserted = await tx
          .insert(encounters)
          .values(
            encounterIds.map((id, index) => ({
              displayId: id,
              tenantId: TENANT_ID,
              patientId: fixture!.patientId,
              branchId: hstBranchId,
              providerId,
              specialty: 'Vaccination' as const,
              status: index === 0 ? ('Completed' as const) : ('Open' as const),
              startedAt: new Date(`${DATE}T${String(index + 1).padStart(2, '0')}:00:00+08:00`),
              completedAt: index === 0 ? new Date(`${DATE}T02:00:00+08:00`) : null,
              createdById: providerId,
            })),
          )
          .returning({ id: encounters.id, displayId: encounters.displayId })

        const completed = inserted.find((row) => row.displayId === encounterIds[0])!
        await tx.insert(transactions).values({
          displayId: pendingTransactionId,
          tenantId: TENANT_ID,
          branchId: hstBranchId,
          patientId: fixture!.patientId,
          encounterId: completed.id,
          cashierId: providerId,
          status: 'Pending',
          grossAmount: '250.00',
          discountAmount: '0.00',
          vatAmount: '0.00',
          netAmount: '250.00',
          amountPaid: '0.00',
          createdById: providerId,
        })
      },
    )
  })

  afterAll(async () => {
    if (!hstBranchId || !providerId) return
    await withTenantTx(
      { tenantId: TENANT_ID, userId: providerId, branchId: hstBranchId },
      async (tx) => {
        await tx
          .delete(transactions)
          .where(
            and(
              eq(transactions.tenantId, TENANT_ID),
              eq(transactions.displayId, pendingTransactionId),
            ),
          )
        await tx
          .delete(encounters)
          .where(
            and(eq(encounters.tenantId, TENANT_ID), inArray(encounters.displayId, encounterIds)),
          )
      },
    )
  })

  it('returns the complete authenticated-branch clinic day with ownership and handoff state', async () => {
    const [hst, tmg] = await Promise.all([
      request(app)
        .get(`/api/day-summary/today-roster?date=${DATE}`)
        .set(FETCH_HEADER)
        .set('Cookie', hstCookie),
      request(app)
        .get(`/api/day-summary/today-roster?date=${DATE}`)
        .set(FETCH_HEADER)
        .set('Cookie', tmgCookie),
    ])

    expect(hst.status, JSON.stringify(hst.body)).toBe(200)
    expect(tmg.status, JSON.stringify(tmg.body)).toBe(200)
    expect(hst.body.date).toBe(DATE)
    expect(hst.body.branchId).toBe('SVX.HST')
    expect(Number.isNaN(Date.parse(hst.body.generatedAt))).toBe(false)

    const [count] = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count
      FROM encounters
      WHERE tenant_id = ${TENANT_ID}
        AND branch_id = ${hstBranchId}
        AND (started_at AT TIME ZONE 'Asia/Manila')::date = ${DATE}::date
        AND deleted_at IS NULL
    `)
    expect(hst.body.roster).toHaveLength(Number(count!.count))
    expect(hst.body.roster.map((row: { id: string }) => row.id)).toEqual(
      expect.arrayContaining(encounterIds),
    )
    expect(tmg.body.roster.map((row: { id: string }) => row.id)).not.toEqual(
      expect.arrayContaining(encounterIds),
    )

    const completed = hst.body.roster.find((row: { id: string }) => row.id === encounterIds[0])
    expect(completed).toMatchObject({
      handoffState: 'awaiting_payment',
      pendingTransactionId,
      nextOwner: { role: 'Cashier', label: 'Cashier' },
    })
    expect(completed.claimedBy).toMatchObject({ id: expect.stringMatching(/^USR_/) })
    expect(Number.isNaN(Date.parse(completed.waitingSince))).toBe(false)
    expect(Number.isNaN(Date.parse(completed.lastActionAt))).toBe(false)

    const active = hst.body.roster.find((row: { id: string }) => row.id === encounterIds[1])
    const claimBody = {
      assigneeId: 'USR_AAAAAAA3', // seeded HST nurse, juan.dc@surevax.com
      attestationPin: '1234',
      expectedRowVersion: active.rowVersion,
    }
    const claimed = await request(app)
      .post(`/api/day-summary/today-roster/${active.id}/owner`)
      .set(FETCH_HEADER)
      .set('Cookie', hstCookie)
      .send(claimBody)
    expect(claimed.status, JSON.stringify(claimed.body)).toBe(200)
    expect(claimed.body).toMatchObject({
      ok: true,
      encounterId: active.id,
      claimedById: 'USR_AAAAAAA3',
    })

    const refreshed = await request(app)
      .get(`/api/day-summary/today-roster?date=${DATE}`)
      .set(FETCH_HEADER)
      .set('Cookie', hstCookie)
    expect(refreshed.status, JSON.stringify(refreshed.body)).toBe(200)
    expect(refreshed.body.roster.find((row: { id: string }) => row.id === active.id)).toMatchObject(
      {
        claimedBy: { id: 'USR_AAAAAAA3', name: expect.any(String) },
        handoffState: 'in_care',
      },
    )

    // A second terminal acting on the old snapshot cannot overwrite the first
    // claim: updated_at is the optimistic concurrency token.
    const stale = await request(app)
      .post(`/api/day-summary/today-roster/${active.id}/owner`)
      .set(FETCH_HEADER)
      .set('Cookie', hstCookie)
      .send(claimBody)
    expect(stale.status, JSON.stringify(stale.body)).toBe(409)
    expect(stale.body.code).toBe('STALE_ENCOUNTER')
  })
})
