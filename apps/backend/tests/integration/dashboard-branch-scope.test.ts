import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { and, eq } from 'drizzle-orm'
import { app } from '../../src/app.js'
import { db } from '../../src/shared/db/index.js'
import {
  branches,
  clinicalOrders,
  encounters,
  inventoryMovements,
  inventoryLotBalances,
  inventoryLots,
  patients,
  patientStandingOrders,
  transactions,
  users,
} from '../../src/shared/db/schema.js'
import { withTenantTx } from '../../src/shared/db/withTenantTx.js'
import { displayId } from '../../src/shared/utils/displayId.js'
import { clinicCalendarDateString } from '../../src/shared/utils/clinicDate.js'

const TENANT_ID = 'SVX'
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
  const cookie = findCookie(response.headers['set-cookie'] as string[] | undefined, 'access_token')
  expect(cookie).toBeTruthy()
  return cookie!
}

async function getDashboard(cookie: string) {
  const response = await request(app).get('/api/dashboard').set(FETCH_HEADER).set('Cookie', cookie)
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  return response.body
}

async function getNudges(cookie: string) {
  const response = await request(app)
    .get('/api/dashboard/nudges')
    .set(FETCH_HEADER)
    .set('Cookie', cookie)
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  return response.body as Array<{ id: string }>
}

async function getTransactions(cookie: string, date: string) {
  const response = await request(app)
    .get(`/api/transactions?date=${date}`)
    .set(FETCH_HEADER)
    .set('Cookie', cookie)
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  return response.body as { data: Array<{ id: string }> }
}

async function getMovements(cookie: string, date: string) {
  const response = await request(app)
    .get(`/api/inventory/movements?date=${date}`)
    .set(FETCH_HEADER)
    .set('Cookie', cookie)
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  return response.body as Array<{ movementId: string }>
}

describe('dashboard — branch scope', () => {
  const encounterDisplayId = displayId('ENC')
  const orderDisplayId = displayId('ORD')
  const lotDisplayId = displayId('LOT')
  const movementDisplayId = displayId('MVT')
  const transactionDisplayId = displayId('TXN')
  const midnightTransactionDisplayId = displayId('TXN')
  let hstCookie: string
  let tmgCookie: string
  let adminCookie: string
  let hstBefore: any
  let tmgBefore: any
  let adminBefore: any
  let tmgBranchId = 0
  let fixtureUserId = 0

  beforeAll(async () => {
    hstCookie = await loginAs('branch-main@surevax.com')
    tmgCookie = await loginAs('surevax.tmg@surevax.com')
    adminCookie = await loginAs('admin@surevax.com')
    ;[hstBefore, tmgBefore, adminBefore] = await Promise.all([
      getDashboard(hstCookie),
      getDashboard(tmgCookie),
      getDashboard(adminCookie),
    ])

    const [tmgFixture] = await db
      .select({
        branchId: branches.id,
        userId: users.id,
        patientId: patients.id,
        standingOrderId: patientStandingOrders.id,
        serviceId: clinicalOrders.serviceId,
      })
      .from(branches)
      .innerJoin(users, and(eq(users.tenantId, TENANT_ID), eq(users.primaryBranchId, branches.id)))
      .innerJoin(
        patients,
        and(eq(patients.tenantId, TENANT_ID), eq(patients.homeBranchId, branches.id)),
      )
      .innerJoin(patientStandingOrders, eq(patientStandingOrders.patientId, patients.id))
      .innerJoin(
        clinicalOrders,
        eq(clinicalOrders.patientStandingOrderId, patientStandingOrders.id),
      )
      .where(and(eq(branches.tenantId, TENANT_ID), eq(branches.code, 'TMG')))
      .limit(1)

    const [tmgProduct] = await db
      .select({ productId: inventoryLots.productId })
      .from(inventoryLots)
      .innerJoin(branches, eq(inventoryLots.branchId, branches.id))
      .where(and(eq(inventoryLots.tenantId, TENANT_ID), eq(branches.code, 'TMG')))
      .limit(1)

    expect(tmgFixture, 'TMG clinical seed fixture missing; run pnpm setup').toBeTruthy()
    expect(tmgProduct, 'TMG inventory seed fixture missing; run pnpm setup').toBeTruthy()
    tmgBranchId = tmgFixture!.branchId
    fixtureUserId = tmgFixture!.userId

    const today = clinicCalendarDateString()
    // Scheduled-order dates are stored as date-only values represented by UTC
    // midnight; this matches dateMath.ts and the production seed convention.
    const dueToday = new Date(`${today}T00:00:00Z`)
    // Regression: at 00:15 Manila the server/database calendar may still be
    // on the previous UTC day. Every clinic-day surface must keep this row today.
    const recentToday = new Date(`${today}T00:15:00+08:00`)

    await withTenantTx(
      { tenantId: TENANT_ID, userId: fixtureUserId, branchId: tmgBranchId },
      async (tx) => {
        const [encounter] = await tx
          .insert(encounters)
          .values({
            displayId: encounterDisplayId,
            tenantId: TENANT_ID,
            patientId: tmgFixture!.patientId,
            branchId: tmgBranchId,
            specialty: 'Vaccination',
            status: 'Open',
            startedAt: recentToday,
            createdById: fixtureUserId,
          })
          .returning({ id: encounters.id })

        await tx.insert(clinicalOrders).values({
          displayId: orderDisplayId,
          tenantId: TENANT_ID,
          patientStandingOrderId: tmgFixture!.standingOrderId,
          patientId: tmgFixture!.patientId,
          serviceId: tmgFixture!.serviceId,
          encounterId: encounter!.id,
          orderType: 'Standing_Order',
          status: 'Scheduled',
          originalScheduledDate: dueToday,
          currentScheduledDate: dueToday,
          quantity: '1',
          doseNumber: 99,
          createdById: fixtureUserId,
        })

        await tx.insert(inventoryLots).values({
          displayId: lotDisplayId,
          tenantId: TENANT_ID,
          branchId: tmgBranchId,
          productId: tmgProduct!.productId,
          batchNumber: `DASH-${lotDisplayId}`,
          manufacturer: 'Dashboard branch-scope fixture',
          expiryDate: '2000-01-01',
          quantityOnHand: '3',
          quantityReceived: '3',
          unitCost: '1',
          createdById: fixtureUserId,
        })

        const [fixtureLot] = await tx
          .select({ id: inventoryLots.id })
          .from(inventoryLots)
          .where(eq(inventoryLots.displayId, lotDisplayId))
          .limit(1)
        await tx.insert(inventoryMovements).values({
          displayId: movementDisplayId,
          tenantId: TENANT_ID,
          branchId: tmgBranchId,
          lotId: fixtureLot!.id,
          movementType: 'Adjustment',
          quantityDelta: '1',
          performedAt: recentToday,
          performedById: fixtureUserId,
          createdById: fixtureUserId,
        })

        await tx.insert(transactions).values({
          displayId: transactionDisplayId,
          tenantId: TENANT_ID,
          branchId: tmgBranchId,
          patientId: tmgFixture!.patientId,
          cashierId: fixtureUserId,
          status: 'Pending',
          grossAmount: '101.00',
          discountAmount: '0.00',
          vatAmount: '0.00',
          netAmount: '101.00',
          amountPaid: '0.00',
          transactedAt: new Date('2000-01-01T00:00:00.000Z'),
          createdById: fixtureUserId,
        })

        await tx.insert(transactions).values({
          displayId: midnightTransactionDisplayId,
          tenantId: TENANT_ID,
          branchId: tmgBranchId,
          patientId: tmgFixture!.patientId,
          cashierId: fixtureUserId,
          status: 'Paid',
          grossAmount: '7.00',
          discountAmount: '0.00',
          vatAmount: '0.00',
          netAmount: '7.00',
          amountPaid: '7.00',
          transactedAt: recentToday,
          createdById: fixtureUserId,
        })
      },
    )
  })

  afterAll(async () => {
    if (!tmgBranchId || !fixtureUserId) return
    await withTenantTx(
      { tenantId: TENANT_ID, userId: fixtureUserId, branchId: tmgBranchId },
      async (tx) => {
        await tx
          .delete(inventoryMovements)
          .where(
            and(
              eq(inventoryMovements.tenantId, TENANT_ID),
              eq(inventoryMovements.displayId, movementDisplayId),
            ),
          )
        await tx
          .delete(clinicalOrders)
          .where(
            and(
              eq(clinicalOrders.tenantId, TENANT_ID),
              eq(clinicalOrders.displayId, orderDisplayId),
            ),
          )
        await tx
          .delete(transactions)
          .where(
            and(
              eq(transactions.tenantId, TENANT_ID),
              eq(transactions.displayId, transactionDisplayId),
            ),
          )
        await tx
          .delete(transactions)
          .where(
            and(
              eq(transactions.tenantId, TENANT_ID),
              eq(transactions.displayId, midnightTransactionDisplayId),
            ),
          )
        await tx
          .delete(encounters)
          .where(
            and(eq(encounters.tenantId, TENANT_ID), eq(encounters.displayId, encounterDisplayId)),
          )
        const [fixtureLot] = await tx
          .select({ id: inventoryLots.id })
          .from(inventoryLots)
          .where(
            and(eq(inventoryLots.tenantId, TENANT_ID), eq(inventoryLots.displayId, lotDisplayId)),
          )
          .limit(1)
        if (fixtureLot) {
          await tx
            .delete(inventoryLotBalances)
            .where(
              and(
                eq(inventoryLotBalances.tenantId, TENANT_ID),
                eq(inventoryLotBalances.lotId, fixtureLot.id),
              ),
            )
        }
        await tx
          .delete(inventoryLots)
          .where(
            and(eq(inventoryLots.tenantId, TENANT_ID), eq(inventoryLots.displayId, lotDisplayId)),
          )
      },
    )
  })

  it('keeps every dashboard component inside the authenticated branch while TenantAdmin remains tenant-wide', async () => {
    const today = clinicCalendarDateString()
    const [hst, tmg, admin, hstNudges, tmgNudges, adminNudges, txns, movements] = await Promise.all(
      [
        getDashboard(hstCookie),
        getDashboard(tmgCookie),
        getDashboard(adminCookie),
        getNudges(hstCookie),
        getNudges(tmgCookie),
        getNudges(adminCookie),
        getTransactions(tmgCookie, today),
        getMovements(tmgCookie, today),
      ],
    )

    expect(hst.stats).toEqual(hstBefore.stats)
    expect(hst.scheduledOrderStats).toEqual(hstBefore.scheduledOrderStats)
    expect(hst.recentEncounters.map((row: { id: string }) => row.id)).not.toContain(
      encounterDisplayId,
    )
    expect(hst.scheduledOrdersDue.map((row: { id: string }) => row.id)).not.toContain(
      orderDisplayId,
    )
    expect(hst.lowStock.map((row: { id: string }) => row.id)).not.toContain(lotDisplayId)
    expect(hstNudges.map((row) => row.id)).not.toEqual(
      expect.arrayContaining([
        `order-due-${orderDisplayId}`,
        `txn-${transactionDisplayId}`,
        `lot-${lotDisplayId}`,
      ]),
    )

    expect(tmg.recentEncounters.map((row: { id: string }) => row.id)).toContain(encounterDisplayId)
    expect(txns.data.map((row) => row.id)).toContain(midnightTransactionDisplayId)
    expect(movements.map((row) => row.movementId)).toContain(movementDisplayId)
    expect(tmg.scheduledOrdersDue.map((row: { id: string }) => row.id)).toContain(orderDisplayId)
    expect(tmg.lowStock.map((row: { id: string }) => row.id)).toContain(lotDisplayId)
    expect(tmgNudges.map((row) => row.id)).toEqual(
      expect.arrayContaining([
        `order-due-${orderDisplayId}`,
        `txn-${transactionDisplayId}`,
        `lot-${lotDisplayId}`,
      ]),
    )

    // The tenant-wide list is deliberately limited to five rows, so its
    // scheduled-order inclusion is proven by dueCount below rather than by a
    // fixture ID that may sort after another branch's seeded row.
    // TenantAdmin's recent list is capped at five tenant-wide rows. Inclusion
    // is proven by the unbounded aggregate below; asserting the fixture is in
    // the presentation slice becomes false whenever five newer rows exist.
    expect(admin.lowStock.map((row: { id: string }) => row.id)).toContain(lotDisplayId)
    expect(adminNudges.map((row) => row.id)).toEqual(
      expect.arrayContaining([`txn-${transactionDisplayId}`, `lot-${lotDisplayId}`]),
    )

    expect(tmg.stats.encountersToday).toBe(tmgBefore.stats.encountersToday + 1)
    expect(tmg.stats.pendingPayments).toBe(tmgBefore.stats.pendingPayments + 1)
    expect(Number(tmg.stats.unsettledTotal)).toBe(Number(tmgBefore.stats.unsettledTotal) + 101)
    expect(tmg.scheduledOrderStats.dueCount).toBe(tmgBefore.scheduledOrderStats.dueCount + 1)

    expect(admin.stats.encountersToday).toBe(adminBefore.stats.encountersToday + 1)
    expect(admin.stats.pendingPayments).toBe(adminBefore.stats.pendingPayments + 1)
    expect(Number(admin.stats.unsettledTotal)).toBe(Number(adminBefore.stats.unsettledTotal) + 101)
    expect(admin.scheduledOrderStats.dueCount).toBe(adminBefore.scheduledOrderStats.dueCount + 1)
  })
})
