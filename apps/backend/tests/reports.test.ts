import { beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { and, eq } from 'drizzle-orm'
import bcrypt from 'bcrypt'
import { createHash } from 'node:crypto'
import { app } from '../src/app.js'
import { db } from '../src/shared/db/index.js'
import {
  branches,
  auditLogs,
  clinicalOrders,
  encounters,
  patients,
  payerProfiles,
  payments,
  serviceCatalog,
  transactions,
  users,
} from '../src/shared/db/schema.js'
import { withTenantTx } from '../src/shared/db/withTenantTx.js'
import { displayId } from '../src/shared/utils/displayId.js'
import { clinicCalendarDateString } from '../src/shared/utils/clinicDate.js'

const TENANT_ID = 'SVX'
const FETCH_HEADER = { 'X-Requested-With': 'fetch' as const, 'X-Tenant-Slug': TENANT_ID }
const PASSWORD = 'TestPass123!'

function cookieValue(setCookie: string[] | undefined) {
  return setCookie
    ?.find((value) => value.startsWith('access_token='))
    ?.split(';')[0]
    ?.slice('access_token='.length)
}
async function login(email: string) {
  const response = await request(app)
    .post('/api/auth/login')
    .set(FETCH_HEADER)
    .send({ email, password: PASSWORD })
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  const token = cookieValue(response.headers['set-cookie'] as unknown as string[])
  expect(token).toBeTruthy()
  return `access_token=${token}`
}

describe('Phase-1 revenue integrity reports', () => {
  let adminCookie: string
  let branchCookie: string
  let nurseCookie: string
  let payerDisplayId: string
  let orderDisplayId: string
  let paymentDisplayId: string
  let mismatchPaymentDisplayId: string
  let branchDisplayId: string
  let adminUserId: number

  beforeAll(async () => {
    adminCookie = await login('admin@surevax.com')
    branchCookie = await login('branch-main@surevax.com')
    payerDisplayId = displayId('PYR')
    orderDisplayId = displayId('ORD')
    paymentDisplayId = displayId('PMT')
    mismatchPaymentDisplayId = displayId('PMT')

    const [admin] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, 'admin@surevax.com'))
      .limit(1)
    if (!admin) throw new Error('seed admin missing')
    adminUserId = admin.id

    const [nurse] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, 'juan.dc@surevax.com'))
      .limit(1)
    if (!nurse) throw new Error('seed nurse missing')
    await withTenantTx({ tenantId: TENANT_ID, userId: admin.id, branchId: null }, async (tx) => {
      await tx
        .update(users)
        .set({ canLogin: true, passwordHash: await bcrypt.hash(PASSWORD, 10) })
        .where(eq(users.id, nurse.id))
    })
    nurseCookie = await login('juan.dc@surevax.com')

    const fixture = await withTenantTx(
      { tenantId: TENANT_ID, userId: admin.id, branchId: null },
      async (tx) => {
        const [branch] = await tx
          .select({ id: branches.id, displayId: branches.displayId })
          .from(branches)
          .where(and(eq(branches.tenantId, TENANT_ID), eq(branches.code, 'HST')))
          .limit(1)
        const [patient] = await tx
          .select({ id: patients.id })
          .from(patients)
          .where(and(eq(patients.tenantId, TENANT_ID), eq(patients.homeBranchId, branch!.id)))
          .limit(1)
        const [encounter] = await tx
          .select({ id: encounters.id })
          .from(encounters)
          .where(
            and(
              eq(encounters.tenantId, TENANT_ID),
              eq(encounters.branchId, branch!.id),
              eq(encounters.patientId, patient!.id),
            ),
          )
          .limit(1)
        const [service] = await tx
          .select({ id: serviceCatalog.id })
          .from(serviceCatalog)
          .where(and(eq(serviceCatalog.tenantId, TENANT_ID), eq(serviceCatalog.isActive, true)))
          .limit(1)
        if (!branch || !patient || !encounter || !service)
          throw new Error('report fixture prerequisites missing')
        branchDisplayId = branch.displayId

        return { branch, patient, encounter, service }
      },
    )

    // The branch RLS WITH CHECK deliberately never permits cross-branch writes,
    // even for a tenant-wide reader. Create branch-owned facts in branch scope.
    await withTenantTx(
      { tenantId: TENANT_ID, userId: admin.id, branchId: fixture.branch.id },
      async (tx) => {
        const [payer] = await tx
          .insert(payerProfiles)
          .values({
            displayId: payerDisplayId,
            tenantId: TENANT_ID,
            name: 'Report Test Payer',
            payerType: 'Corporate',
            paymentTermsDays: 30,
            createdById: admin.id,
          })
          .returning({ id: payerProfiles.id })
        const [transaction] = await tx
          .insert(transactions)
          .values({
            displayId: displayId('TXN'),
            tenantId: TENANT_ID,
            branchId: fixture.branch.id,
            patientId: fixture.patient.id,
            payerId: payer!.id,
            status: 'Pending',
            grossAmount: '123.45',
            discountAmount: '0.00',
            vatAmount: '0.00',
            netAmount: '123.45',
            amountPaid: '0.00',
            cashierId: admin.id,
            createdById: admin.id,
          })
          .returning({ id: transactions.id })
        await tx.insert(payments).values({
          displayId: paymentDisplayId,
          tenantId: TENANT_ID,
          transactionId: transaction!.id,
          method: 'GCash',
          amount: '23.45',
          payerId: payer!.id,
          referenceNumber: 'REPORT-TEST-REF',
          reconciliationStatus: 'AwaitingReconciliation',
          receivedById: admin.id,
          createdById: admin.id,
        })
        await tx.insert(payments).values({
          displayId: mismatchPaymentDisplayId,
          tenantId: TENANT_ID,
          transactionId: transaction!.id,
          method: 'GCash',
          amount: '1.00',
          payerId: payer!.id,
          referenceNumber: 'REPORT-TEST-MISMATCH',
          reconciliationStatus: 'Mismatch',
          receivedById: admin.id,
          createdById: admin.id,
        })
        await tx.insert(clinicalOrders).values({
          displayId: orderDisplayId,
          tenantId: TENANT_ID,
          serviceId: fixture.service.id,
          encounterId: fixture.encounter.id,
          patientId: fixture.patient.id,
          orderType: 'Ad_Hoc',
          status: 'Completed',
          completedAt: new Date(),
          administeredById: admin.id,
          documentedById: admin.id,
          indication: 'paymentReconciliationRequired',
          quantity: '1.00',
          createdById: admin.id,
        })

        const semanticDate = new Date('2040-01-14T16:30:00.000Z') // Jan 15 in Manila
        const semanticStatuses = [
          { status: 'Draft' as const, amount: '10.00', isPrepayment: false },
          { status: 'Pending' as const, amount: '20.00', isPrepayment: false },
          { status: 'Paid' as const, amount: '30.00', isPrepayment: false },
          { status: 'Voided' as const, amount: '40.00', isPrepayment: false },
          { status: 'Refunded' as const, amount: '50.00', isPrepayment: false },
          { status: 'Pending' as const, amount: '60.00', isPrepayment: true },
        ]
        await tx.insert(transactions).values(
          semanticStatuses.map(({ status, amount, isPrepayment }) => ({
            displayId: displayId('TXN'),
            tenantId: TENANT_ID,
            branchId: fixture.branch.id,
            patientId: fixture.patient.id,
            status,
            grossAmount: amount,
            discountAmount: '0.00',
            vatAmount: '0.00',
            netAmount: amount,
            amountPaid: status === 'Paid' ? amount : '0.00',
            isPrepayment,
            transactedAt: semanticDate,
            cashierId: admin.id,
            createdById: admin.id,
          })),
        )
      },
    )
  })

  it('keeps Branch tenant scope forbidden and options branch-only', async () => {
    const options = await request(app).get('/api/reports/options').set('Cookie', branchCookie)
    expect(options.status).toBe(200)
    expect(options.body.allowedScopes).toEqual(['branch'])
    expect(options.body.canViewFinancial).toBe(true)
    expect(options.body.branches).toHaveLength(1)

    const forbidden = await request(app)
      .get('/api/reports/ar-aging?scope=tenant')
      .set('Cookie', branchCookie)
    expect(forbidden.status).toBe(403)
    expect(forbidden.body.code).toBe('FORBIDDEN')
  })

  it('keeps Nurse branch-scoped and excludes every financial report contract', async () => {
    const options = await request(app).get('/api/reports/options').set('Cookie', nurseCookie)
    expect(options.status).toBe(200)
    expect(options.body).toMatchObject({ allowedScopes: ['branch'], canViewFinancial: false })
    expect(options.body.branches).toHaveLength(1)
    expect(options.body.payers).toEqual([])

    const [ar, exceptions, daily, unbilled] = await Promise.all([
      request(app).get('/api/reports/ar-aging').set('Cookie', nurseCookie),
      request(app).get('/api/reports/payment-exceptions').set('Cookie', nurseCookie),
      request(app).get('/api/reports/daily-revenue').set('Cookie', nurseCookie),
      request(app)
        .get('/api/reports/administered-unbilled?scope=branch&limit=100')
        .set('Cookie', nurseCookie),
    ])
    expect([ar.status, exceptions.status, daily.status]).toEqual([403, 403, 403])
    expect(unbilled.status, JSON.stringify(unbilled.body)).toBe(200)
    expect(unbilled.body.scope).toBe('branch')
    expect(
      unbilled.body.rows.every(
        (row: { branch: { id: string } }) => row.branch.id === branchDisplayId,
      ),
    ).toBe(true)
  })

  it('aggregates authoritative header AR by responsible payer, branch, and aging bucket', async () => {
    const response = await request(app)
      .get(`/api/reports/ar-aging?scope=tenant&payerId=${payerDisplayId}&limit=1`)
      .set('Cookie', adminCookie)
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body.pagination.limit).toBe(1)
    expect(response.body.rows).toHaveLength(1)
    const row = response.body.rows[0]
    expect(row.responsiblePayer.id).toBe(payerDisplayId)
    expect(row.branch.id).toBe(branchDisplayId)
    expect(row.outstanding).toBe('99.00')
    expect(Object.values(row.aging).reduce((sum, value) => sum + Number(value), 0)).toBe(99)
  })

  it('surfaces completed work with no active billing link and preserves the legacy signal', async () => {
    const response = await request(app)
      .get('/api/reports/administered-unbilled?scope=tenant&reconciliationRequired=true&limit=100')
      .set('Cookie', adminCookie)
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    const row = response.body.rows.find(
      (candidate: { orderId: string }) => candidate.orderId === orderDisplayId,
    )
    expect(row).toMatchObject({
      reconciliationRequired: true,
      reason: 'Legacy reconciliation flag',
    })
  })

  it('lists only live reconciliation exceptions with responsible and tender payer facts', async () => {
    const response = await request(app)
      .get(`/api/reports/payment-exceptions?scope=tenant&payerId=${payerDisplayId}`)
      .set('Cookie', adminCookie)
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    const row = response.body.rows.find(
      (candidate: { paymentId: string }) => candidate.paymentId === paymentDisplayId,
    )
    expect(row).toMatchObject({ status: 'AwaitingReconciliation', amount: '23.45' })
    expect(row.responsiblePayer.id).toBe(payerDisplayId)
    expect(row.tenderPayer.id).toBe(payerDisplayId)

    const mismatch = response.body.rows.find(
      (candidate: { paymentId: string }) => candidate.paymentId === mismatchPaymentDisplayId,
    )
    expect(mismatch).toMatchObject({ status: 'Mismatch', amount: '1.00' })
  })

  it('keeps the daily transaction fact honest across statuses and Manila midnight', async () => {
    const response = await request(app)
      .get(`/api/reports/daily-revenue?branchId=${branchDisplayId}&date=2040-01-15`)
      .set('Cookie', adminCookie)
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body.revenue).toMatchObject({
      transactionCount: 6,
      transactionNetTotal: '60.00',
    })
  })

  it('maps omitted-date defaults to the Asia/Manila clinic day', () => {
    expect(clinicCalendarDateString(new Date('2026-08-22T16:30:00.000Z'))).toBe('2026-08-23')
  })

  it('delegates daily revenue and tenders to day-summary truth and exposes actual deposits', async () => {
    const date = clinicCalendarDateString()
    const [report, truth] = await Promise.all([
      request(app)
        .get(`/api/reports/daily-revenue?branchId=${branchDisplayId}&date=${date}`)
        .set('Cookie', adminCookie),
      request(app).get(`/api/day-summary?date=${date}`).set('Cookie', branchCookie),
    ])
    expect(report.status, JSON.stringify(report.body)).toBe(200)
    expect(truth.status, JSON.stringify(truth.body)).toBe(200)
    expect(report.body.revenue.transactionNetTotal).toBe(truth.body.transactions.totalRevenue)
    expect(report.body.tenders).toEqual(truth.body.transactions.byMethod)
    expect(report.body.deposits).toEqual({
      count: truth.body.drawer.depositCount,
      total: truth.body.drawer.depositsTotal,
    })
  })

  it('persists a content-bound audit event before returning the daily CSV', async () => {
    const date = clinicCalendarDateString()
    const response = await request(app)
      .post('/api/reports/daily-revenue/export')
      .set('Cookie', adminCookie)
      .set(FETCH_HEADER)
      .send({ scope: 'branch', branchId: branchDisplayId, date })
    expect(response.status, JSON.stringify(response.body)).toBe(201)
    expect(response.body.fileName).toBe(`surevax-daily-revenue-HST-${date}.csv`)
    expect(response.body.csv).toContain('"Transaction net total"')
    expect(response.body.sha256).toBe(
      createHash('sha256').update(response.body.csv, 'utf8').digest('hex'),
    )

    const [audit] = await withTenantTx(
      { tenantId: TENANT_ID, userId: adminUserId, branchId: null },
      async (tx) =>
        tx
          .select({ metadata: auditLogs.metadata })
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.tenantId, TENANT_ID),
              eq(auditLogs.action, 'EXPORT'),
              eq(auditLogs.entityId, `${branchDisplayId}:${date}`),
            ),
          )
          .limit(1),
    )
    expect(audit?.metadata).toMatchObject({
      documentType: 'daily_revenue_csv',
      sha256: response.body.sha256,
    })
  })
})
