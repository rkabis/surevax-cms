/**
 * Integration tests for the transactions module.
 *
 * Two-tier IDs (2026-05-19 ID redesign):
 *   - Patient / service / transaction handles are now `PAT_<...>` / `ARVPEP_IM`
 *     / `TXN_<...>` (no tenant prefix). Service catalog IDs are raw codes.
 *   - The seed allocates `TXN_<random>` display_ids — we resolve a real one
 *     at suite startup rather than hardcoding.
 *   - `withTenantTx` takes the cashier user's bigint; we look it up after
 *     enabling `can_login` on the seeded cashier.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { app } from '../src/app.js'
import { db } from '../src/shared/db/index.js'
import { clinicalOrders, patients, transactions, users } from '../src/shared/db/schema.js'
import { and, eq } from 'drizzle-orm'
import bcrypt from 'bcrypt'
import { withTenantTx } from '../src/shared/db/withTenantTx.js'
import { PAT_DELACRUZ_DISPLAY_ID, SVC_ARVPEP_IM } from '../src/shared/db/seed/constants.js'
import { isClinicalOrderPrepayable } from '../src/modules/transactions/db.js'

const TENANT_ID = 'SVX'
// Pre-login requests resolve the tenant via X-Tenant-Slug. JWT-authenticated
// requests ignore the slug header (JWT claim wins), so sending it on every
// request is safe.
const FETCH_HEADER = {
  'X-Requested-With': 'fetch' as const,
  'X-Tenant-Slug': 'SVX' as const,
}
const CASHIER_EMAIL = 'jose.santos@surevax.com'
const ADMIN_EMAIL = 'admin@surevax.com'

function findCookie(setCookie: string[] | undefined, name: string): string | undefined {
  if (!setCookie) return undefined
  const match = setCookie.find((c) => c.startsWith(`${name}=`))
  if (!match) return undefined
  return match.split(';')[0]?.slice(`${name}=`.length)
}

async function loginAsCashier(): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .set(FETCH_HEADER)
    .send({ email: CASHIER_EMAIL, password: 'TestPass123!' })
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`)
  }
  const cookie = findCookie(res.headers['set-cookie'] as unknown as string[], 'access_token')
  if (!cookie) throw new Error('login response did not set access_token')
  return cookie
}

/** TenantAdmin login, already can_login by seed default. Used to clear the
 * money-control approval gate (docs/ai-context/06-PRODUCT-WORKFLOWS.md:262). */
async function loginAsAdmin(): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .set(FETCH_HEADER)
    .send({ email: ADMIN_EMAIL, password: 'TestPass123!' })
  if (res.status !== 200) {
    throw new Error(`admin login failed: ${res.status} ${JSON.stringify(res.body)}`)
  }
  const cookie = findCookie(res.headers['set-cookie'] as unknown as string[], 'access_token')
  if (!cookie) throw new Error('admin login response did not set access_token')
  return cookie
}

describe('Transactions Router', () => {
  let accessToken: string
  let adminAccessToken: string
  let seededTransactionId: string
  let cashierDisplayId: string

  beforeAll(async () => {
    // Enable login on the seeded cashier (seed leaves can_login = false) so
    // we can authenticate. Use withTenantTx to satisfy the audit trigger.
    const [cashier] = await db
      .select({ id: users.id, displayId: users.displayId })
      .from(users)
      .where(eq(users.email, CASHIER_EMAIL))
      .limit(1)
    if (!cashier) throw new Error(`seeded cashier (${CASHIER_EMAIL}) not found`)
    cashierDisplayId = cashier.displayId

    await withTenantTx({ tenantId: TENANT_ID, userId: cashier.id, branchId: null }, async (tx) => {
      await tx
        .update(users)
        .set({
          canLogin: true,
          passwordHash: await bcrypt.hash('TestPass123!', 10),
        })
        .where(eq(users.id, cashier.id))
    })

    accessToken = await loginAsCashier()
    adminAccessToken = await loginAsAdmin()

    // Pick any seeded transaction so the detail test runs against real data.
    const [seeded] = await db
      .select({ displayId: transactions.displayId })
      .from(transactions)
      .where(eq(transactions.tenantId, TENANT_ID))
      .limit(1)
    if (!seeded) throw new Error('no seeded transactions found')
    seededTransactionId = seeded.displayId
  })

  describe('GET /api/transactions', () => {
    it('returns a list of transactions and stats', async () => {
      const res = await request(app)
        .get('/api/transactions')
        .set('Cookie', `access_token=${accessToken}`)

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.data.length).toBeGreaterThan(0)
      expect(res.body).toHaveProperty('stats')
    })

    it('filters transactions by status', async () => {
      const res = await request(app)
        .get('/api/transactions?status=Paid')
        .set('Cookie', `access_token=${accessToken}`)

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.data)).toBe(true)
      if (res.body.data.length > 0) {
        expect(res.body.data[0].status).toBe('Paid')
      }
    })
  })

  describe('POST /api/transactions', () => {
    it('allows prepayment only for active payable clinical-order statuses', () => {
      expect(isClinicalOrderPrepayable('Scheduled')).toBe(true)
      expect(isClinicalOrderPrepayable('Pending')).toBe(true)
      expect(isClinicalOrderPrepayable('Completed')).toBe(false)
      expect(isClinicalOrderPrepayable('Missed')).toBe(false)
      expect(isClinicalOrderPrepayable('Cancelled')).toBe(false)
    })

    it('creates a new Pending transaction', async () => {
      const res = await request(app)
        .post('/api/transactions')
        .set('Cookie', `access_token=${accessToken}`)
        .set(FETCH_HEADER)
        .send({
          patientId: PAT_DELACRUZ_DISPLAY_ID,
          items: [{ serviceId: SVC_ARVPEP_IM, quantity: 1 }],
        })

      expect(res.status).toBe(201)
      expect(res.body).toHaveProperty('id')
      expect(res.body.status).toBe('Pending')
    })

    it('rejects a direct prepayment request linked to a completed clinical order', async () => {
      const [completed] = await db
        .select({
          orderId: clinicalOrders.displayId,
          patientId: patients.displayId,
          serviceId: clinicalOrders.serviceId,
        })
        .from(clinicalOrders)
        .innerJoin(patients, eq(patients.id, clinicalOrders.patientId))
        .where(and(eq(clinicalOrders.tenantId, TENANT_ID), eq(clinicalOrders.status, 'Completed')))
        .limit(1)
      expect(completed).toBeDefined()

      const res = await request(app)
        .post('/api/transactions')
        .set('Cookie', `access_token=${accessToken}`)
        .set(FETCH_HEADER)
        .send({
          patientId: completed!.patientId,
          items: [
            {
              serviceId: completed!.serviceId,
              clinicalOrderId: completed!.orderId,
              quantity: 1,
              isPrepaid: true,
            },
          ],
        })

      expect(res.status).toBe(422)
      expect(res.body.code).toBe('CLINICAL_ORDER_NOT_PREPAYABLE')
    })
  })

  describe('GET /api/transactions/:id', () => {
    it('fetches a transaction by ID', async () => {
      const res = await request(app)
        .get(`/api/transactions/${seededTransactionId}`)
        .set('Cookie', `access_token=${accessToken}`)

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('id', seededTransactionId)
      expect(res.body).toHaveProperty('items')
    })

    it('returns 404 for unknown transaction ID', async () => {
      const res = await request(app)
        .get('/api/transactions/TXN_ZZZZZZZZ')
        .set('Cookie', `access_token=${accessToken}`)

      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/transactions/:id/payments', () => {
    it('adds a payment to a transaction', async () => {
      const createRes = await request(app)
        .post('/api/transactions')
        .set('Cookie', `access_token=${accessToken}`)
        .set(FETCH_HEADER)
        .send({
          patientId: PAT_DELACRUZ_DISPLAY_ID,
          items: [{ serviceId: SVC_ARVPEP_IM, quantity: 1 }],
        })
      const txnId = createRes.body.id

      const getRes = await request(app)
        .get(`/api/transactions/${txnId}`)
        .set('Cookie', `access_token=${accessToken}`)
      const amountToPay = getRes.body.netAmount

      const payRes = await request(app)
        .post(`/api/transactions/${txnId}/payments`)
        .set('Cookie', `access_token=${accessToken}`)
        .set(FETCH_HEADER)
        .send({
          method: 'Cash',
          amount: amountToPay,
        })

      expect(payRes.status).toBe(201)
      expect(payRes.body.status).toBe('Paid')
      // Lifecycle response is `{ id: 'PMT_…', status, receiptNo }`. The
      // BIR OR (`receiptNo`) stays null until BIR registration completes;
      // the seed leaves it null, so we only assert the field is present.
      expect(payRes.body).toHaveProperty('id')
      expect(payRes.body).toHaveProperty('receiptNo')

      const paidDetail = await request(app)
        .get(`/api/transactions/${txnId}`)
        .set('Cookie', `access_token=${accessToken}`)
      const original = paidDetail.body.payments.find(
        (payment: { id: string }) => payment.id === payRes.body.id,
      )
      expect(original.receivedById).toBe(cashierDisplayId)

      const correction = await request(app)
        .post(`/api/transactions/${txnId}/payments/${payRes.body.id}/correct-method`)
        .set('Cookie', `access_token=${accessToken}`)
        .set(FETCH_HEADER)
        .send({
          newMethod: 'GCash',
          newReferenceNumber: `route-${Date.now()}`,
          reason: 'Route attribution regression coverage',
        })
      expect(correction.status).toBe(200)

      const correctedDetail = await request(app)
        .get(`/api/transactions/${txnId}`)
        .set('Cookie', `access_token=${accessToken}`)
      const replacement = correctedDetail.body.payments.find(
        (payment: { id: string }) => payment.id === correction.body.replacementPaymentId,
      )
      expect(replacement.receivedById).toBe(cashierDisplayId)
    })

    // MONEY-5: cap-and-reject overpayment. A payment row records the amount
    // APPLIED to the bill (not cash tendered), so it must never push
    // amount_paid above net_amount.
    it('rejects a single overpayment with 422 OVERPAYMENT_NOT_ALLOWED', async () => {
      const createRes = await request(app)
        .post('/api/transactions')
        .set('Cookie', `access_token=${accessToken}`)
        .set(FETCH_HEADER)
        .send({
          patientId: PAT_DELACRUZ_DISPLAY_ID,
          items: [{ serviceId: SVC_ARVPEP_IM, quantity: 1 }],
        })
      const txnId = createRes.body.id

      const getRes = await request(app)
        .get(`/api/transactions/${txnId}`)
        .set('Cookie', `access_token=${accessToken}`)
      const overpay = (parseFloat(getRes.body.netAmount) * 2).toFixed(2)

      const payRes = await request(app)
        .post(`/api/transactions/${txnId}/payments`)
        .set('Cookie', `access_token=${accessToken}`)
        .set(FETCH_HEADER)
        .send({ method: 'Cash', amount: overpay })

      expect(payRes.status).toBe(422)
      expect(payRes.body.code).toBe('OVERPAYMENT_NOT_ALLOWED')

      // The rejected overpayment must not have persisted — txn stays Pending.
      const afterRes = await request(app)
        .get(`/api/transactions/${txnId}`)
        .set('Cookie', `access_token=${accessToken}`)
      expect(afterRes.body.status).toBe('Pending')
      expect(afterRes.body.payments.length).toBe(0)
    })

    it('accepts a partial payment then the exact remaining, then rejects a third', async () => {
      const createRes = await request(app)
        .post('/api/transactions')
        .set('Cookie', `access_token=${accessToken}`)
        .set(FETCH_HEADER)
        .send({
          patientId: PAT_DELACRUZ_DISPLAY_ID,
          items: [{ serviceId: SVC_ARVPEP_IM, quantity: 1 }],
        })
      const txnId = createRes.body.id

      const getRes = await request(app)
        .get(`/api/transactions/${txnId}`)
        .set('Cookie', `access_token=${accessToken}`)
      const netCents = Math.round(parseFloat(getRes.body.netAmount) * 100)
      const firstCents = Math.floor(netCents / 2)
      const first = (firstCents / 100).toFixed(2)
      const remaining = ((netCents - firstCents) / 100).toFixed(2)

      const r1 = await request(app)
        .post(`/api/transactions/${txnId}/payments`)
        .set('Cookie', `access_token=${accessToken}`)
        .set(FETCH_HEADER)
        .send({ method: 'Cash', amount: first })
      expect(r1.status).toBe(201)
      expect(r1.body.status).toBe('Pending')

      const r2 = await request(app)
        .post(`/api/transactions/${txnId}/payments`)
        .set('Cookie', `access_token=${accessToken}`)
        .set(FETCH_HEADER)
        .send({ method: 'Cash', amount: remaining })
      expect(r2.status).toBe(201)
      expect(r2.body.status).toBe('Paid')

      // Now fully paid — a further payment is rejected as ALREADY_PAID.
      const r3 = await request(app)
        .post(`/api/transactions/${txnId}/payments`)
        .set('Cookie', `access_token=${accessToken}`)
        .set(FETCH_HEADER)
        .send({ method: 'Cash', amount: '1.00' })
      expect(r3.status).toBe(422)
      expect(r3.body.code).toBe('ALREADY_PAID')
    })

    it('rejects a partial payment that overshoots the remaining balance', async () => {
      const createRes = await request(app)
        .post('/api/transactions')
        .set('Cookie', `access_token=${accessToken}`)
        .set(FETCH_HEADER)
        .send({
          patientId: PAT_DELACRUZ_DISPLAY_ID,
          items: [{ serviceId: SVC_ARVPEP_IM, quantity: 1 }],
        })
      const txnId = createRes.body.id

      const getRes = await request(app)
        .get(`/api/transactions/${txnId}`)
        .set('Cookie', `access_token=${accessToken}`)
      const netCents = Math.round(parseFloat(getRes.body.netAmount) * 100)
      const first = (Math.floor(netCents / 2) / 100).toFixed(2)

      const r1 = await request(app)
        .post(`/api/transactions/${txnId}/payments`)
        .set('Cookie', `access_token=${accessToken}`)
        .set(FETCH_HEADER)
        .send({ method: 'Cash', amount: first })
      expect(r1.status).toBe(201)

      // The full net now exceeds the ~half that remains.
      const r2 = await request(app)
        .post(`/api/transactions/${txnId}/payments`)
        .set('Cookie', `access_token=${accessToken}`)
        .set(FETCH_HEADER)
        .send({ method: 'Cash', amount: getRes.body.netAmount })
      expect(r2.status).toBe(422)
      expect(r2.body.code).toBe('OVERPAYMENT_NOT_ALLOWED')
    })
  })

  describe('POST /api/transactions/:id/void', () => {
    it('voids a Pending transaction', async () => {
      const createRes = await request(app)
        .post('/api/transactions')
        .set('Cookie', `access_token=${accessToken}`)
        .set(FETCH_HEADER)
        .send({
          patientId: PAT_DELACRUZ_DISPLAY_ID,
          items: [{ serviceId: SVC_ARVPEP_IM, quantity: 1 }],
        })
      const txnId = createRes.body.id

      const voidRes = await request(app)
        .post(`/api/transactions/${txnId}/void`)
        .set('Cookie', `access_token=${accessToken}`)
        .set(FETCH_HEADER)
        .send({ reason: 'Patient changed mind' })

      expect(voidRes.status).toBe(200)
      expect(voidRes.body.status).toBe('Voided')
    })
  })

  describe('POST /api/transactions/:id/refund', () => {
    // ARVPEP_IM's base price (PHP 1,500) is over the PHP 1,000 manager
    // threshold on the money-control approval gate (docs/ai-context/
    // 06-PRODUCT-WORKFLOWS.md:262), so a full refund of a real clinical-price
    // transaction genuinely exercises the approved path: refused and filed,
    // approved as TenantAdmin, then the retry succeeds.
    it('refunds a Paid transaction once the manager-tier approval gate clears', async () => {
      const createRes = await request(app)
        .post('/api/transactions')
        .set('Cookie', `access_token=${accessToken}`)
        .set(FETCH_HEADER)
        .send({
          patientId: PAT_DELACRUZ_DISPLAY_ID,
          items: [{ serviceId: SVC_ARVPEP_IM, quantity: 1 }],
        })
      const txnId = createRes.body.id

      const getRes = await request(app)
        .get(`/api/transactions/${txnId}`)
        .set('Cookie', `access_token=${accessToken}`)
      const amountToPay = getRes.body.netAmount

      await request(app)
        .post(`/api/transactions/${txnId}/payments`)
        .set('Cookie', `access_token=${accessToken}`)
        .set(FETCH_HEADER)
        .send({ method: 'Cash', amount: amountToPay })

      const gatedRes = await request(app)
        .post(`/api/transactions/${txnId}/refund`)
        .set('Cookie', `access_token=${accessToken}`)
        .set(FETCH_HEADER)
        .send({ reason: 'Overcharge error' })

      expect(gatedRes.status).toBe(403)
      expect(gatedRes.body.code).toBe('APPROVAL_REQUIRED')
      const approvalId = gatedRes.body.approvalRequestId
      expect(approvalId).toBeTruthy()

      const approveRes = await request(app)
        .patch(`/api/admin/approvals/${approvalId}/approve`)
        .set('Cookie', `access_token=${adminAccessToken}`)
        .set(FETCH_HEADER)
        .send({})
      expect(approveRes.status).toBe(200)
      expect(approveRes.body.data.status).toBe('Approved')

      const refundRes = await request(app)
        .post(`/api/transactions/${txnId}/refund`)
        .set('Cookie', `access_token=${accessToken}`)
        .set(FETCH_HEADER)
        .send({ reason: 'Overcharge error' })

      expect(refundRes.status).toBe(200)
      expect(refundRes.body.transaction.status).toBe('Refunded')
    })
  })

  // Helpers for the patient-credit suite.
  const cookie = () => `access_token=${accessToken}`
  async function createDeposit(depositAmount: string): Promise<string> {
    const res = await request(app)
      .post('/api/transactions')
      .set('Cookie', cookie())
      .set(FETCH_HEADER)
      .send({
        patientId: PAT_DELACRUZ_DISPLAY_ID,
        isPrepayment: true,
        depositAmount,
        payment: { method: 'Cash', amount: depositAmount },
      })
    if (res.status !== 201) {
      throw new Error(`deposit create failed: ${res.status} ${JSON.stringify(res.body)}`)
    }
    expect(res.body.status).toBe('Paid')
    return res.body.id
  }
  async function createBill(quantity = 1): Promise<{ id: string; net: number }> {
    const res = await request(app)
      .post('/api/transactions')
      .set('Cookie', cookie())
      .set(FETCH_HEADER)
      .send({ patientId: PAT_DELACRUZ_DISPLAY_ID, items: [{ serviceId: SVC_ARVPEP_IM, quantity }] })
    const id = res.body.id
    const get = await request(app).get(`/api/transactions/${id}`).set('Cookie', cookie())
    return { id, net: parseFloat(get.body.netAmount) }
  }

  describe('Free-standing patient credit (deposit + apply-prepayment as a credit draw)', () => {
    it('records a deposit, exposes the balance, and fully covers a later bill', async () => {
      const depositId = await createDeposit('5000.00')

      const depositDetail = await request(app)
        .get(`/api/transactions/${depositId}`)
        .set('Cookie', cookie())
      expect(depositDetail.body.payments[0].receivedById).toBe(cashierDisplayId)

      const creditRes = await request(app)
        .get(`/api/patients/${PAT_DELACRUZ_DISPLAY_ID}/credit`)
        .set('Cookie', cookie())
      expect(creditRes.status).toBe(200)
      expect(parseFloat(creditRes.body.available)).toBeGreaterThanOrEqual(5000)
      const dep = creditRes.body.deposits.find((d: { id: string }) => d.id === depositId)
      expect(dep.remaining).toBe('5000.00')

      const bill = await createBill(1)
      expect(bill.net).toBeLessThan(5000) // ensure deposit fully covers

      const applyRes = await request(app)
        .post(`/api/transactions/${depositId}/apply-prepayment`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .send({ consumingTransactionId: bill.id })
      expect(applyRes.status).toBe(200)
      expect(applyRes.body.applied).toBe(true)
      expect(applyRes.body.status).toBe('Paid')
      expect(parseFloat(applyRes.body.amount)).toBeCloseTo(bill.net, 2)

      const verify = await request(app).get(`/api/transactions/${bill.id}`).set('Cookie', cookie())
      expect(verify.body.status).toBe('Paid')
      expect(verify.body.amountOutstanding).toBe('0.00')
      expect(verify.body.payments.some((p: { method: string }) => p.method === 'Credit')).toBe(true)

      const after = await request(app)
        .get(`/api/patients/${PAT_DELACRUZ_DISPLAY_ID}/credit`)
        .set('Cookie', cookie())
      const depAfter = after.body.deposits.find((d: { id: string }) => d.id === depositId)
      expect(parseFloat(depAfter.remaining)).toBeCloseTo(5000 - bill.net, 2)
    })

    it('a deposit smaller than the bill leaves the consuming txn Pending (credit downpayment)', async () => {
      const bill = await createBill(1)
      const half = (bill.net / 2).toFixed(2)
      const depositId = await createDeposit(half)

      const applyRes = await request(app)
        .post(`/api/transactions/${depositId}/apply-prepayment`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .send({ consumingTransactionId: bill.id })
      expect(applyRes.status).toBe(200)
      expect(applyRes.body.status).toBe('Pending')
      expect(parseFloat(applyRes.body.amount)).toBeCloseTo(parseFloat(half), 2)
      expect(applyRes.body.remainingCredit).toBe('0.00')

      const verify = await request(app).get(`/api/transactions/${bill.id}`).set('Cookie', cookie())
      expect(verify.body.status).toBe('Pending')
      expect(parseFloat(verify.body.amountOutstanding)).toBeCloseTo(bill.net - parseFloat(half), 2)
    })

    it('rejects a draw against exhausted credit with 422 CREDIT_EXHAUSTED', async () => {
      const billA = await createBill(1)
      const depositId = await createDeposit(billA.net.toFixed(2))

      const first = await request(app)
        .post(`/api/transactions/${depositId}/apply-prepayment`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .send({ consumingTransactionId: billA.id })
      expect(first.body.status).toBe('Paid')
      expect(first.body.remainingCredit).toBe('0.00')

      const billB = await createBill(1)
      const second = await request(app)
        .post(`/api/transactions/${depositId}/apply-prepayment`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .send({ consumingTransactionId: billB.id })
      expect(second.status).toBe(422)
      expect(second.body.code).toBe('CREDIT_EXHAUSTED')
    })

    it('a Paid deposit is excluded from day-stats revenue', async () => {
      const statsBefore = await request(app).get('/api/transactions').set('Cookie', cookie())
      const revenueBefore = parseFloat(statsBefore.body.dayStats?.totalRevenue ?? '0')
      await createDeposit('1234.00')
      const statsAfter = await request(app).get('/api/transactions').set('Cookie', cookie())
      const revenueAfter = parseFloat(statsAfter.body.dayStats?.totalRevenue ?? '0')
      // The 1234 deposit must NOT have moved revenue.
      expect(revenueAfter).toBeCloseTo(revenueBefore, 2)
    })
  })

  describe('GET /api/scheduled-orders/:id/doses', () => {
    it('lists the chain doses with billing status for the prepay picker', async () => {
      const list = await request(app).get('/api/scheduled-orders').set('Cookie', cookie())
      expect(list.status).toBe(200)
      const order = list.body.data?.[0]
      if (!order) return // no seeded scheduled orders — nothing to assert
      const doses = await request(app)
        .get(`/api/scheduled-orders/${order.id}/doses`)
        .set('Cookie', cookie())
      expect(doses.status).toBe(200)
      expect(Array.isArray(doses.body)).toBe(true)
      if (doses.body.length > 0) {
        expect(doses.body[0]).toHaveProperty('orderId')
        expect(doses.body[0]).toHaveProperty('serviceId')
        expect(doses.body[0]).toHaveProperty('state')
        expect(doses.body[0]).toHaveProperty('paymentStatus')
      }
    })
  })

  // ── Money format contract ────────────────────────────────────────────────────
  // Regression guard for FE-ENV-1: backend was pre-formatting amounts as "4,820.00"
  // (comma-grouped). Frontend Number() / parseFloat coerces "4,820.00" to 4 (stops
  // at the comma), causing KPI cards and formatMoney() to display wrong values for
  // amounts ≥ 1,000. Fix: backend returns raw numeric(12,2) strings; frontend formats.
  describe('money field format contract', () => {
    it('list endpoint returns raw numeric strings (no comma formatting) for all amount fields', async () => {
      const res = await request(app)
        .get('/api/transactions')
        .set('Cookie', `access_token=${accessToken}`)
      expect(res.status).toBe(200)
      const rows: { grossAmount: string; netAmount: string; amountPaid: string }[] =
        res.body.data ?? []
      if (rows.length === 0) return // nothing to assert against empty seed

      for (const row of rows) {
        for (const field of [
          'grossAmount',
          'netAmount',
          'amountPaid',
          'amountOutstanding',
        ] as const) {
          const val = (row as Record<string, unknown>)[field]
          if (val == null) continue
          expect(typeof val, `${field} must be a string`).toBe('string')
          expect(val as string, `${field} must not contain comma formatting`).not.toMatch(/,/)
          // Must parse as a finite number — not NaN.
          expect(
            Number.isFinite(Number(val)),
            `${field} "${val}" must parseFloat to a finite number`,
          ).toBe(true)
        }
      }
    })

    it('detail endpoint returns raw numeric strings for all amount fields', async () => {
      const res = await request(app)
        .get(`/api/transactions/${seededTransactionId}`)
        .set('Cookie', `access_token=${accessToken}`)
      expect(res.status).toBe(200)
      const body = res.body as Record<string, unknown>
      for (const field of [
        'grossAmount',
        'discountAmount',
        'vatAmount',
        'netAmount',
        'amountPaid',
        'amountOutstanding',
      ]) {
        const val = body[field]
        if (val == null) continue
        expect(typeof val, `${field} must be a string`).toBe('string')
        expect(val as string, `${field} must not contain comma formatting`).not.toMatch(/,/)
        expect(Number.isFinite(Number(val)), `${field} "${val}" must be a parseable number`).toBe(
          true,
        )
      }
    })

    it('detail endpoint carries receiptNo field (not orNumber)', async () => {
      const res = await request(app)
        .get(`/api/transactions/${seededTransactionId}`)
        .set('Cookie', `access_token=${accessToken}`)
      expect(res.status).toBe(200)
      // receiptNo is present (may be null for unpaid transactions).
      expect(res.body).toHaveProperty('receiptNo')
      // orNumber must NOT appear — that was the stale alias from before the rename.
      expect(res.body).not.toHaveProperty('orNumber')
    })
  })

  // Silence unused-import guard; `and` is kept for future filter helpers.
  void and
})
