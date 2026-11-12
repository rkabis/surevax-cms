/**
 * Integration tests for the patient-accounts module: balance, ledger,
 * pay-on-account, apply-credit, and clinic-wide receivables.
 *
 * Isolation strategy: `withRollback` does not work here (supertest writes
 * through the app's own connection pool, bypassing any wrapping transaction
 * per .claude/rules/patterns.md "supertest caveat"). Instead each describe
 * block below owns a DEDICATED seeded patient with an active seed consent
 * row (required by assertActiveConsent on every clinical write) and zero
 * OPEN bills at seed time, and no other test file ever touches it:
 *   - Balance and downpayment: PAT_CRUZ_DISPLAY_ID    (zero seed transactions)
 *   - Pay on account:          PAT_MENDOZA_DISPLAY_ID (one seed txn, Paid)
 *   - Credit interplay:        PAT_AGUILAR_DISPLAY_ID (one seed txn, Paid)
 *   - Ledger:                  PAT_SANTOS_DISPLAY_ID  (one seed txn, Paid)
 *   - Receivables:             PAT_REYES_DISPLAY_ID   (one seed txn, Paid)
 * A pre-existing Paid seed transaction contributes nothing to
 * grossOutstanding/aging (only Draft/Pending bills are "open") and, since it
 * is dated days before "today", nets to zero on the ledger's running total
 * by the time any of these tests' own rows occur. The one place that
 * matters (the ledger group's exact-row-count case) diffs against a
 * baseline fetch rather than asserting an absolute row count, so historical
 * rows do not interfere.
 * Within a describe block, tests that leave a bill Pending clean up with a
 * void so the next test in the same block starts from a known state. Only
 * genuinely tenant-wide aggregates (dayStats.totalRevenue, dashboard
 * cashCollectedToday/nonCashCollectedToday) are asserted as before/after
 * DELTAS rather than absolute totals, since those aggregate across every
 * patient in the tenant.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { app } from '../src/app.js'
import { db } from '../src/shared/db/index.js'
import { transactions, users } from '../src/shared/db/schema.js'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcrypt'
import { withTenantTx } from '../src/shared/db/withTenantTx.js'
import { toCents, fromCents } from '../src/shared/utils/money.js'
import { clinicCalendarDateString } from '../src/shared/utils/clinicDate.js'
import {
  PAT_CRUZ_DISPLAY_ID,
  PAT_MENDOZA_DISPLAY_ID,
  PAT_AGUILAR_DISPLAY_ID,
  PAT_SANTOS_DISPLAY_ID,
  PAT_REYES_DISPLAY_ID,
  SVC_ARVPEP_IM,
  SVC_WOUND,
} from '../src/shared/db/seed/constants.js'

const TENANT_ID = 'SVX'
const FETCH_HEADER = {
  'X-Requested-With': 'fetch' as const,
  'X-Tenant-Slug': 'SVX' as const,
}
const CASHIER_EMAIL = 'jose.santos@surevax.com'
const ADMIN_EMAIL = 'admin@surevax.com'

const BAL = PAT_CRUZ_DISPLAY_ID
const PAY = PAT_MENDOZA_DISPLAY_ID
const CREDIT = PAT_AGUILAR_DISPLAY_ID
const LEDGER = PAT_SANTOS_DISPLAY_ID
const AR = PAT_REYES_DISPLAY_ID

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

/** TenantAdmin login, already can_login by seed default (unlike the cashier). Used
 * only to clear the money-control approval gate (docs/ai-context/06-PRODUCT-
 * WORKFLOWS.md:262) on cleanup voids that happen to leave a large partial
 * payment, and by the dedicated gate tests below. */
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

/** YYYY-MM-DD, offset by `days` from today (UTC). Matches the server's todayIso(). */
function isoDateOffset(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

describe('Patient Accounts Router', () => {
  let accessToken: string
  let adminAccessToken: string
  let cashierDisplayId: string
  let cashierUserId = 0
  const cookie = () => `access_token=${accessToken}`
  const adminCookie = () => `access_token=${adminAccessToken}`

  beforeAll(async () => {
    const [cashier] = await db
      .select({ id: users.id, displayId: users.displayId })
      .from(users)
      .where(eq(users.email, CASHIER_EMAIL))
      .limit(1)
    if (!cashier) throw new Error(`seeded cashier (${CASHIER_EMAIL}) not found`)
    cashierDisplayId = cashier.displayId
    cashierUserId = cashier.id

    await withTenantTx({ tenantId: TENANT_ID, userId: cashier.id, branchId: null }, async (tx) => {
      await tx
        .update(users)
        .set({ canLogin: true, passwordHash: await bcrypt.hash('TestPass123!', 10) })
        .where(eq(users.id, cashier.id))
    })

    accessToken = await loginAsCashier()
    adminAccessToken = await loginAsAdmin()
  })

  async function createBill(
    patientId: string,
    quantity = 1,
    serviceId = SVC_ARVPEP_IM,
  ): Promise<{ id: string; net: number }> {
    const res = await request(app)
      .post('/api/transactions')
      .set('Cookie', cookie())
      .set(FETCH_HEADER)
      .send({ patientId, items: [{ serviceId, quantity }] })
    if (res.status !== 201) {
      throw new Error(`createBill failed: ${res.status} ${JSON.stringify(res.body)}`)
    }
    const id = res.body.id
    const get = await request(app).get(`/api/transactions/${id}`).set('Cookie', cookie())
    return { id, net: parseFloat(get.body.netAmount) }
  }

  async function createDeposit(patientId: string, depositAmount: string): Promise<string> {
    const res = await request(app)
      .post('/api/transactions')
      .set('Cookie', cookie())
      .set(FETCH_HEADER)
      .send({
        patientId,
        isPrepayment: true,
        depositAmount,
        payment: { method: 'Cash', amount: depositAmount },
      })
    if (res.status !== 201) {
      throw new Error(`createDeposit failed: ${res.status} ${JSON.stringify(res.body)}`)
    }
    if (res.body.status !== 'Paid') {
      throw new Error(`deposit did not settle to Paid: ${JSON.stringify(res.body)}`)
    }
    return res.body.id
  }

  /**
   * Void a bill used as test cleanup. Most fixtures here void at $0 or a
   * small partial payment (under the manager threshold, docs/ai-context/
   * 06-PRODUCT-WORKFLOWS.md:262), so the gate never fires and this is a
   * single round trip. A few leave a large partial payment (e.g. "leave
   * exactly 1.00 outstanding" on a PHP 1,500 bill) and genuinely trip the
   * gate; for those, clear it the real way, file then approve as
   * TenantAdmin then retry, rather than avoiding the gate in the fixture.
   * Approving your own cleanup void as a DIFFERENT user (admin, not the
   * cashier who requested it) is also what APPR-2 (self-approval blocked)
   * requires.
   */
  async function voidBill(id: string, reason = 'Test cleanup void'): Promise<void> {
    const res = await request(app)
      .post(`/api/transactions/${id}/void`)
      .set('Cookie', cookie())
      .set(FETCH_HEADER)
      .send({ reason })
    if (res.status === 200) return

    if (res.status === 403 && res.body.code === 'APPROVAL_REQUIRED') {
      const approvalId = res.body.approvalRequestId as string
      const approveRes = await request(app)
        .patch(`/api/admin/approvals/${approvalId}/approve`)
        .set('Cookie', adminCookie())
        .set(FETCH_HEADER)
        .send({})
      if (approveRes.status !== 200) {
        throw new Error(
          `voidBill cleanup approve failed: ${approveRes.status} ${JSON.stringify(approveRes.body)}`,
        )
      }
      const retryRes = await request(app)
        .post(`/api/transactions/${id}/void`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .send({ reason })
      if (retryRes.status !== 200) {
        throw new Error(
          `voidBill retry after approval failed: ${retryRes.status} ${JSON.stringify(retryRes.body)}`,
        )
      }
      return
    }

    throw new Error(`voidBill failed: ${res.status} ${JSON.stringify(res.body)}`)
  }

  async function payDirect(
    id: string,
    amount: string,
    method = 'Cash',
  ): Promise<{ status: string; receiptNo: string | null }> {
    const res = await request(app)
      .post(`/api/transactions/${id}/payments`)
      .set('Cookie', cookie())
      .set(FETCH_HEADER)
      .send({ method, amount })
    if (res.status !== 201) {
      throw new Error(`payDirect failed: ${res.status} ${JSON.stringify(res.body)}`)
    }
    return res.body
  }

  // ── Balance and downpayment (PAT_CRUZ_DISPLAY_ID) ───────────────────────────

  describe('Balance and downpayment', () => {
    let chainBill: { id: string; net: number }
    let chainHalf: string
    let bill4: { id: string; net: number }
    let depositAmt4: string

    it('returns 0.00 gross for a patient with no open bills', async () => {
      const res = await request(app).get(`/api/patients/${BAL}/balance`).set('Cookie', cookie())
      expect(res.status).toBe(200)
      expect(res.body.grossOutstanding).toBe('0.00')
      expect(res.body.availableCredit).toBe('0.00')
      expect(res.body.netOutstanding).toBe('0.00')
      expect(res.body.creditOnAccount).toBe('0.00')
      expect(res.body.openBillCount).toBe(0)
      expect(res.body.openBills).toEqual([])
    })

    it('a partial payment leaves the bill Pending with a reduced amountOutstanding and no receiptNo', async () => {
      chainBill = await createBill(BAL)
      const halfCents = Math.floor(toCents(chainBill.net.toFixed(2)) / 2)
      chainHalf = fromCents(halfCents)

      const payRes = await payDirect(chainBill.id, chainHalf)
      expect(payRes.status).toBe('Pending')
      expect(payRes.receiptNo).toBeNull()

      const balRes = await request(app).get(`/api/patients/${BAL}/balance`).set('Cookie', cookie())
      const ob = balRes.body.openBills.find((b: { id: string }) => b.id === chainBill.id)
      expect(ob).toBeTruthy()
      expect(ob.status).toBe('Pending')
      const expectedOutstanding = fromCents(toCents(chainBill.net.toFixed(2)) - halfCents)
      expect(ob.amountOutstanding).toBe(expectedOutstanding)
      expect(balRes.body.grossOutstanding).toBe(expectedOutstanding)
    })

    it('the settling payment flips the bill to Paid and mints a BIR receipt_no', async () => {
      const remaining = fromCents(toCents(chainBill.net.toFixed(2)) - toCents(chainHalf))
      const payRes = await payDirect(chainBill.id, remaining)
      expect(payRes.status).toBe('Paid')
      expect(payRes.receiptNo).not.toBeNull()
      expect(typeof payRes.receiptNo).toBe('string')

      const balRes = await request(app).get(`/api/patients/${BAL}/balance`).set('Cookie', cookie())
      expect(balRes.body.grossOutstanding).toBe('0.00')
      expect(
        balRes.body.openBills.find((b: { id: string }) => b.id === chainBill.id),
      ).toBeUndefined()
    })

    it('nets availableCredit against grossOutstanding into netOutstanding', async () => {
      bill4 = await createBill(BAL)
      depositAmt4 = fromCents(Math.floor(toCents(bill4.net.toFixed(2)) / 3))
      await createDeposit(BAL, depositAmt4)

      const res = await request(app).get(`/api/patients/${BAL}/balance`).set('Cookie', cookie())
      expect(res.body.grossOutstanding).toBe(bill4.net.toFixed(2))
      expect(res.body.availableCredit).toBe(depositAmt4)
      expect(res.body.netOutstanding).toBe(
        fromCents(toCents(bill4.net.toFixed(2)) - toCents(depositAmt4)),
      )
      expect(res.body.creditOnAccount).toBe('0.00')
    })

    it('reports creditOnAccount when credit exceeds what is owed', async () => {
      // Pay off bill4 in full directly. The deposit's credit is untouched by
      // this (a direct cash payment on the bill never draws on the deposit),
      // so once the bill is gone the whole deposit reads as pure credit.
      const payRes = await payDirect(bill4.id, bill4.net.toFixed(2))
      expect(payRes.status).toBe('Paid')

      const res = await request(app).get(`/api/patients/${BAL}/balance`).set('Cookie', cookie())
      expect(res.body.grossOutstanding).toBe('0.00')
      expect(res.body.netOutstanding).toBe('0.00')
      expect(res.body.availableCredit).toBe(depositAmt4)
      expect(res.body.creditOnAccount).toBe(depositAmt4)
    })

    it('a Voided bill drops out of grossOutstanding and out of the allocation', async () => {
      const bill6 = await createBill(BAL)
      const before = await request(app).get(`/api/patients/${BAL}/balance`).set('Cookie', cookie())
      expect(before.body.grossOutstanding).toBe(bill6.net.toFixed(2))

      await voidBill(bill6.id)

      const after = await request(app).get(`/api/patients/${BAL}/balance`).set('Cookie', cookie())
      expect(after.body.grossOutstanding).toBe('0.00')
      expect(after.body.openBills.find((b: { id: string }) => b.id === bill6.id)).toBeUndefined()

      // The voided bill is no longer allocatable, so there is nothing to pay
      // toward and the tender is refused as NOTHING_OUTSTANDING.
      const payRes = await request(app)
        .post(`/api/patients/${BAL}/payments`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .send({ method: 'Cash', amount: '1.00' })
      expect(payRes.status).toBe(422)
      expect(payRes.body.code).toBe('NOTHING_OUTSTANDING')
    })

    it('buckets a bill into the correct aging band and the four bands sum to grossOutstanding', async () => {
      const bill7 = await createBill(BAL)
      const futureAsOf = isoDateOffset(45)

      const res = await request(app)
        .get(`/api/patients/${BAL}/balance?asOf=${futureAsOf}`)
        .set('Cookie', cookie())
      expect(res.status).toBe(200)
      expect(res.body.grossOutstanding).toBe(bill7.net.toFixed(2))
      expect(res.body.aging.d31_60).toBe(bill7.net.toFixed(2))
      expect(res.body.aging.d0_30).toBe('0.00')
      expect(res.body.aging.d61_90).toBe('0.00')
      expect(res.body.aging.d90plus).toBe('0.00')

      const sumCents =
        toCents(res.body.aging.d0_30) +
        toCents(res.body.aging.d31_60) +
        toCents(res.body.aging.d61_90) +
        toCents(res.body.aging.d90plus)
      expect(sumCents).toBe(toCents(res.body.grossOutstanding))
    })
  })

  // ── Pay on account (PAT_MENDOZA_DISPLAY_ID) ─────────────────────────────────

  describe('Pay on account', () => {
    it('preserves each split-tender method while settling one bill atomically', async () => {
      const bill = await createBill(PAY)
      const totalCents = toCents(bill.net.toFixed(2))
      const cashCents = Math.floor(totalCents / 2)
      const gcashCents = totalCents - cashCents

      const res = await request(app)
        .post(`/api/patients/${PAY}/payments`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .send({
          payments: [
            { method: 'Cash', amount: fromCents(cashCents) },
            {
              method: 'GCash',
              amount: fromCents(gcashCents),
              referenceNumber: 'PAY-ACCOUNT-SPLIT',
            },
          ],
        })

      expect(res.status).toBe(201)
      expect(res.body.appliedAmount).toBe(bill.net.toFixed(2))
      expect(res.body.allocations).toHaveLength(1)
      expect(res.body.allocations[0].status).toBe('Paid')

      const detail = await request(app).get(`/api/transactions/${bill.id}`).set('Cookie', cookie())
      expect(
        detail.body.payments.map((payment: { method: string; amount: string }) => ({
          method: payment.method,
          amount: payment.amount,
        })),
      ).toEqual([
        { method: 'Cash', amount: fromCents(cashCents) },
        { method: 'GCash', amount: fromCents(gcashCents) },
      ])
    })

    it('allocates a tendered amount across two open bills oldest-first by transacted_at', async () => {
      const bill1 = await createBill(PAY)
      const bill2 = await createBill(PAY)
      const partialSecond = Math.max(100, Math.floor(toCents(bill2.net.toFixed(2)) / 2))
      const tender = fromCents(toCents(bill1.net.toFixed(2)) + partialSecond)

      const res = await request(app)
        .post(`/api/patients/${PAY}/payments`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .send({ method: 'Cash', amount: tender })
      expect(res.status).toBe(201)
      expect(res.body.allocations.length).toBe(2)
      expect(res.body.allocations[0].transactionId).toBe(bill1.id)
      expect(res.body.allocations[0].status).toBe('Paid')
      expect(res.body.allocations[0].receiptNo).not.toBeNull()
      expect(res.body.allocations[1].transactionId).toBe(bill2.id)
      expect(res.body.allocations[1].status).toBe('Pending')
      expect(res.body.allocations[1].amount).toBe(fromCents(partialSecond))
      expect(res.body.allocations[1].outstandingAfter).toBe(
        fromCents(toCents(bill2.net.toFixed(2)) - partialSecond),
      )
      expect(res.body.appliedAmount).toBe(tender)
      expect(res.body.creditedAmount).toBe('0.00')

      await voidBill(bill2.id)
    })

    it('settles the first bill and part-pays the second, returning per-leg outstandingAfter', async () => {
      const bill3 = await createBill(PAY)
      const bill4 = await createBill(PAY)
      const leaveCents = 100 // leave exactly 1.00 outstanding on the second bill
      const tender = fromCents(
        toCents(bill3.net.toFixed(2)) + (toCents(bill4.net.toFixed(2)) - leaveCents),
      )

      const res = await request(app)
        .post(`/api/patients/${PAY}/payments`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .send({ method: 'Cash', amount: tender })
      expect(res.status).toBe(201)
      expect(res.body.allocations[0].transactionId).toBe(bill3.id)
      expect(res.body.allocations[0].outstandingAfter).toBe('0.00')
      expect(res.body.allocations[1].transactionId).toBe(bill4.id)
      expect(res.body.allocations[1].outstandingAfter).toBe(fromCents(leaveCents))

      await voidBill(bill4.id)
    })

    it('mints a distinct BIR receipt_no for each bill that crosses to Paid in one call', async () => {
      const bill5 = await createBill(PAY)
      const bill6 = await createBill(PAY)
      const tender = fromCents(toCents(bill5.net.toFixed(2)) + toCents(bill6.net.toFixed(2)))

      const res = await request(app)
        .post(`/api/patients/${PAY}/payments`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .send({ method: 'Cash', amount: tender })
      expect(res.status).toBe(201)
      expect(res.body.allocations[0].status).toBe('Paid')
      expect(res.body.allocations[1].status).toBe('Paid')
      expect(res.body.allocations[0].receiptNo).not.toBeNull()
      expect(res.body.allocations[1].receiptNo).not.toBeNull()
      expect(res.body.allocations[0].receiptNo).not.toBe(res.body.allocations[1].receiptNo)
    })

    it('rejects tendered above outstanding with 422 OVERPAYMENT_NOT_ALLOWED carrying excess in the body', async () => {
      const bill7 = await createBill(PAY)
      const excessCents = 10000 // 100.00
      const tender = fromCents(toCents(bill7.net.toFixed(2)) + excessCents)

      const res = await request(app)
        .post(`/api/patients/${PAY}/payments`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .send({ method: 'Cash', amount: tender })
      expect(res.status).toBe(422)
      expect(res.body.code).toBe('OVERPAYMENT_NOT_ALLOWED')
      expect(res.body.excess).toBe(fromCents(excessCents))
      expect(res.body.totalOutstanding).toBe(bill7.net.toFixed(2))

      await voidBill(bill7.id)
    })

    it('with allowCredit banks the excess as an item-less is_prepayment deposit', async () => {
      const bill8 = await createBill(PAY)
      const excessCents = 25000 // 250.00
      const tender = fromCents(toCents(bill8.net.toFixed(2)) + excessCents)

      const res = await request(app)
        .post(`/api/patients/${PAY}/payments`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .send({ method: 'Cash', amount: tender, allowCredit: true })
      expect(res.status).toBe(201)
      expect(res.body.creditedAmount).toBe(fromCents(excessCents))
      expect(res.body.creditTransactionId).toBeTruthy()
      expect(res.body.allocations[0].status).toBe('Paid')
      expect(res.body.availableCreditAfter).toBe(fromCents(excessCents))

      const allocatedBill = await request(app)
        .get(`/api/transactions/${res.body.allocations[0].transactionId}`)
        .set('Cookie', cookie())
      const allocatedPayment = allocatedBill.body.payments.find(
        (payment: { id: string }) => payment.id === res.body.allocations[0].paymentId,
      )
      expect(allocatedPayment.receivedById).toBe(cashierDisplayId)

      const bal = await request(app).get(`/api/patients/${PAY}/balance`).set('Cookie', cookie())
      const dep = bal.body.deposits.find(
        (d: { id: string }) => d.id === res.body.creditTransactionId,
      )
      expect(dep).toBeTruthy()
      expect(dep.remaining).toBe(fromCents(excessCents))
    })

    // Regression guard. This assertion originally failed: with zero open bills
    // planAllocation puts the WHOLE tender into excessCents, so the overage gate
    // fired first and answered "tendered 1.00 exceeds the total outstanding of
    // 0.00", leaving NOTHING_OUTSTANDING unreachable. The "owes nothing" check
    // now runs ahead of the overage check so the cashier gets the actionable
    // message. Do not reorder those two gates.
    it('returns 422 NOTHING_OUTSTANDING when the patient owes nothing and allowCredit is false', async () => {
      const res = await request(app)
        .post(`/api/patients/${PAY}/payments`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .send({ method: 'Cash', amount: '1.00' })
      expect(res.status).toBe(422)
      expect(res.body.code).toBe('NOTHING_OUTSTANDING')
    })

    it('replaying the same Idempotency-Key returns idempotentReplay and inserts no second payment', async () => {
      const bill9 = await createBill(PAY)
      const idemKey = `pay-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const body = { method: 'Cash', amount: bill9.net.toFixed(2) }

      const res1 = await request(app)
        .post(`/api/patients/${PAY}/payments`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .set('Idempotency-Key', idemKey)
        .send(body)
      expect(res1.status).toBe(201)
      expect(res1.body.idempotentReplay).toBe(false)
      expect(res1.headers['x-idempotent-replay']).toBeUndefined()

      const res2 = await request(app)
        .post(`/api/patients/${PAY}/payments`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .set('Idempotency-Key', idemKey)
        .send(body)
      expect(res2.status).toBe(201)
      expect(res2.body.idempotentReplay).toBe(true)
      expect(res2.headers['x-idempotent-replay']).toBe('true')
      expect(res2.body.allocations[0].paymentId).toBe(res1.body.allocations[0].paymentId)
    })

    it('never pushes amount_paid above net_amount on any touched bill (invariant sweep over the bills it touched)', async () => {
      const bill10 = await createBill(PAY)
      const bill11 = await createBill(PAY)
      const tender = fromCents(toCents(bill10.net.toFixed(2)) + toCents(bill11.net.toFixed(2)))

      const res = await request(app)
        .post(`/api/patients/${PAY}/payments`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .send({ method: 'Cash', amount: tender })
      expect(res.status).toBe(201)

      for (const alloc of res.body.allocations as Array<{ transactionId: string }>) {
        const detail = await request(app)
          .get(`/api/transactions/${alloc.transactionId}`)
          .set('Cookie', cookie())
        expect(toCents(detail.body.amountPaid)).toBeLessThanOrEqual(toCents(detail.body.netAmount))
      }
    })

    it('rejects a malformed Idempotency-Key with 400', async () => {
      const res = await request(app)
        .post(`/api/patients/${PAY}/payments`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .set('Idempotency-Key', 'bad')
        .send({ method: 'Cash', amount: '1.00' })
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('INVALID_IDEMPOTENCY_KEY')
    })
  })

  // ── Credit interplay (PAT_AGUILAR_DISPLAY_ID) ───────────────────────────────

  describe('Credit interplay', () => {
    let remainingAfter17: string

    it('the banked overage is spendable via apply-credit on a later bill', async () => {
      const billA = await createBill(CREDIT)
      const excessA = '2000.00'
      const tenderA = fromCents(toCents(billA.net.toFixed(2)) + toCents(excessA))

      const r1 = await request(app)
        .post(`/api/patients/${CREDIT}/payments`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .send({ method: 'Cash', amount: tenderA, allowCredit: true })
      expect(r1.status).toBe(201)
      expect(r1.body.creditedAmount).toBe(excessA)

      const billB = await createBill(CREDIT)
      const r2 = await request(app)
        .post(`/api/patients/${CREDIT}/apply-credit`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .send({})
      expect(r2.status).toBe(201)
      expect(r2.body.allocations.length).toBe(1)
      expect(r2.body.allocations[0].transactionId).toBe(billB.id)
      expect(r2.body.allocations[0].status).toBe('Paid')
      expect(r2.body.appliedAmount).toBe(billB.net.toFixed(2))

      remainingAfter17 = fromCents(toCents(excessA) - toCents(billB.net.toFixed(2)))
      expect(r2.body.availableCreditAfter).toBe(remainingAfter17)
    })

    it('apply-credit scoped to one transactionId touches only that bill', async () => {
      const billC = await createBill(CREDIT)
      const billD = await createBill(CREDIT)

      const r = await request(app)
        .post(`/api/patients/${CREDIT}/apply-credit`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .send({ transactionId: billD.id })
      expect(r.status).toBe(201)
      expect(r.body.allocations.length).toBe(1)
      expect(r.body.allocations[0].transactionId).toBe(billD.id)
      const expectedApplied = fromCents(
        Math.min(toCents(remainingAfter17), toCents(billD.net.toFixed(2))),
      )
      expect(r.body.appliedAmount).toBe(expectedApplied)
      expect(r.body.availableCreditAfter).toBe(
        fromCents(toCents(remainingAfter17) - toCents(expectedApplied)),
      )

      const detailC = await request(app)
        .get(`/api/transactions/${billC.id}`)
        .set('Cookie', cookie())
      expect(detailC.body.amountPaid).toBe('0.00')
      expect(detailC.body.status).toBe('Pending')

      await voidBill(billC.id)
      await voidBill(billD.id)
    })

    it('apply-credit caps at the amount argument when supplied', async () => {
      const depositAmt = '1000.00'
      await createDeposit(CREDIT, depositAmt)
      const billE = await createBill(CREDIT)
      const cap = '400.00'

      const r = await request(app)
        .post(`/api/patients/${CREDIT}/apply-credit`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .send({ amount: cap })
      expect(r.status).toBe(201)
      expect(r.body.appliedAmount).toBe(cap)
      expect(r.body.allocations[0].amount).toBe(cap)
      expect(r.body.allocations[0].transactionId).toBe(billE.id)
      expect(r.body.allocations[0].outstandingAfter).toBe(
        fromCents(toCents(billE.net.toFixed(2)) - toCents(cap)),
      )
      expect(r.body.availableCreditAfter).toBe(fromCents(toCents(depositAmt) - toCents(cap)))

      await voidBill(billE.id)
    })

    it('returns 422 when the patient has no credit available', async () => {
      const billF = await createBill(CREDIT)

      // Setup: drain whatever credit is left over from the previous case
      // (not itself an assertion).
      const drain = await request(app)
        .post(`/api/patients/${CREDIT}/apply-credit`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .send({})
      expect(drain.status).toBe(201)

      const r = await request(app)
        .post(`/api/patients/${CREDIT}/apply-credit`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .send({})
      expect(r.status).toBe(422)
      expect(r.body.code).toBe('CREDIT_EXHAUSTED')

      await voidBill(billF.id)
    })

    it('the banked overage does not move dayStats.totalRevenue (assert the delta is 0)', async () => {
      const statsBefore = await request(app).get('/api/transactions').set('Cookie', cookie())
      const revenueBefore = parseFloat(statsBefore.body.dayStats?.totalRevenue ?? '0')

      // Zero open bills at this point (drained/voided above), so the entire
      // tender is a pure deposit: nothing to charge, nothing to recognize.
      const r = await request(app)
        .post(`/api/patients/${CREDIT}/payments`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .send({ method: 'Cash', amount: '777.00', allowCredit: true })
      expect(r.status).toBe(201)
      expect(r.body.creditedAmount).toBe('777.00')
      expect(r.body.allocations).toEqual([])

      const statsAfter = await request(app).get('/api/transactions').set('Cookie', cookie())
      const revenueAfter = parseFloat(statsAfter.body.dayStats?.totalRevenue ?? '0')
      expect(revenueAfter - revenueBefore).toBeCloseTo(0, 2)
    })

    it('a Credit draw is excluded from the dashboard cashSplit nonCash figure', async () => {
      const dashBefore = await request(app).get('/api/dashboard').set('Cookie', cookie())
      const cashBefore = parseFloat(dashBefore.body.stats.cashCollectedToday)
      const nonCashBefore = parseFloat(dashBefore.body.stats.nonCashCollectedToday)

      const billH = await createBill(CREDIT)
      const r = await request(app)
        .post(`/api/patients/${CREDIT}/apply-credit`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .send({ amount: '300.00' })
      expect(r.status).toBe(201)
      expect(r.body.appliedAmount).toBe('300.00')

      const dashAfter = await request(app).get('/api/dashboard').set('Cookie', cookie())
      const cashAfter = parseFloat(dashAfter.body.stats.cashCollectedToday)
      const nonCashAfter = parseFloat(dashAfter.body.stats.nonCashCollectedToday)
      expect(cashAfter - cashBefore).toBeCloseTo(0, 2)
      expect(nonCashAfter - nonCashBefore).toBeCloseTo(0, 2)

      await voidBill(billH.id)
    })

    /**
     * Regression guard for the deposit filter on the AR aggregates.
     *
     * A PARTLY funded deposit is the only shape that exposes it: it sits Pending
     * with a positive amount_outstanding, so before the fix it counted as money
     * OWED by the patient in the dashboard AR and the day-summary carry-over,
     * while /api/accounts-receivable had always excluded it. That made the two
     * surfaces disagree, and the disagreement was invisible because
     * pay-on-account always funds its overage deposit in full.
     */
    it('a partly funded deposit does not inflate the dashboard AR or the receivables total', async () => {
      const dashBefore = await request(app).get('/api/dashboard').set('Cookie', cookie())
      const arBefore = parseFloat(dashBefore.body.stats.unsettledTotal)
      // Branch scope: `scope=tenant` is admin-gated and this suite runs as the
      // Cashier. The deposit is raised at the cashier's own branch either way.
      const recvBefore = await request(app).get('/api/accounts-receivable').set('Cookie', cookie())
      const recvTotalBefore = parseFloat(recvBefore.body.totals.grossOutstanding)

      // Deposit of 1000 funded with only 400: Pending, 600 outstanding.
      const partial = await request(app)
        .post('/api/transactions')
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .send({
          patientId: CREDIT,
          isPrepayment: true,
          depositAmount: '1000.00',
          payment: { method: 'Cash', amount: '400.00' },
        })
      expect(partial.status).toBe(201)
      expect(partial.body.status).toBe('Pending')

      const dashAfter = await request(app).get('/api/dashboard').set('Cookie', cookie())
      const recvAfter = await request(app).get('/api/accounts-receivable').set('Cookie', cookie())

      // Neither surface may move: the 600 is deferred revenue the clinic HOLDS.
      expect(parseFloat(dashAfter.body.stats.unsettledTotal) - arBefore).toBeCloseTo(0, 2)
      expect(parseFloat(recvAfter.body.totals.grossOutstanding) - recvTotalBefore).toBeCloseTo(0, 2)

      await voidBill(partial.body.id)
    })

    it('a credit draw records funded_by_transaction_id pointing at the deposit', async () => {
      const depositAmt = '500.00'
      const depositId = await createDeposit(CREDIT, depositAmt)
      const billI = await createBill(CREDIT)

      const r = await request(app)
        .post(`/api/patients/${CREDIT}/apply-credit`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .send({ transactionId: billI.id })
      expect(r.status).toBe(201)

      const ledgerRes = await request(app)
        .get(`/api/patients/${CREDIT}/ledger`)
        .set('Cookie', cookie())
      // Scoped by fundedByTransactionId (not just kind+transactionId): an
      // older leftover credit source could also have drawn against billI in
      // the same call, so this specifically finds the leg funded by OUR
      // deposit rather than assuming it is the only credit_draw row.
      const drawRow = ledgerRes.body.rows.find(
        (row: { kind: string; transactionId: string; fundedByTransactionId: string | null }) =>
          row.kind === 'credit_draw' &&
          row.transactionId === billI.id &&
          row.fundedByTransactionId === depositId,
      )
      expect(drawRow).toBeTruthy()
    })
  })

  // ── Ledger (PAT_SANTOS_DISPLAY_ID) ───────────────────────────────────────────

  describe('Ledger', () => {
    it('returns charges, payments, credit draws and deposits in chronological order with running balanceDue and creditBalance', async () => {
      // Diff against a baseline rather than asserting an absolute row count:
      // PAT_SANTOS_DISPLAY_ID carries one historical Paid seed transaction
      // (dated days before "today"), which contributes its own charge +
      // payment rows to the ledger. Those net to zero on the running
      // balance/credit by the time our own rows land (see file header), but
      // would otherwise throw off a raw `rows.length` assertion.
      const baselineRes = await request(app)
        .get(`/api/patients/${LEDGER}/ledger`)
        .set('Cookie', cookie())
      const baselineKeys = new Set(
        (baselineRes.body.rows as Array<{ key: string }>).map((r) => r.key),
      )

      const depositAmt = '2000.00'
      await createDeposit(LEDGER, depositAmt)
      const billL = await createBill(LEDGER)
      const drawAmt = '800.00'

      const drawRes = await request(app)
        .post(`/api/patients/${LEDGER}/apply-credit`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .send({ transactionId: billL.id, amount: drawAmt })
      expect(drawRes.status).toBe(201)

      const remainingL = fromCents(toCents(billL.net.toFixed(2)) - toCents(drawAmt))
      const payRes = await payDirect(billL.id, remainingL)
      expect(payRes.status).toBe('Paid')

      const ledgerRes = await request(app)
        .get(`/api/patients/${LEDGER}/ledger`)
        .set('Cookie', cookie())
      const allRows = ledgerRes.body.rows as Array<{
        key: string
        kind: string
        balanceDue: string
        creditBalance: string
      }>
      const rows = allRows.filter((r) => !baselineKeys.has(r.key))
      expect(rows.length).toBe(4)
      expect([...rows.map((r) => r.kind)].sort()).toEqual([
        'charge',
        'credit_draw',
        'deposit',
        'payment',
      ])

      const depositRow = rows.find((r) => r.kind === 'deposit')!
      const chargeRow = rows.find((r) => r.kind === 'charge')!
      const drawRow = rows.find((r) => r.kind === 'credit_draw')!
      const paymentRow = rows.find((r) => r.kind === 'payment')!

      // Chronological order: deposit funded first, then the bill was
      // charged, then the credit draw, then the cash top-up. Compare
      // positions within the FULL returned array (allRows), which is what
      // the server actually sorted.
      expect(allRows.indexOf(depositRow)).toBeLessThan(allRows.indexOf(chargeRow))
      expect(allRows.indexOf(chargeRow)).toBeLessThan(allRows.indexOf(drawRow))
      expect(allRows.indexOf(drawRow)).toBeLessThan(allRows.indexOf(paymentRow))

      expect(depositRow.balanceDue).toBe('0.00')
      expect(depositRow.creditBalance).toBe(depositAmt)
      expect(chargeRow.balanceDue).toBe(billL.net.toFixed(2))
      expect(chargeRow.creditBalance).toBe(depositAmt)
      expect(drawRow.balanceDue).toBe(remainingL)
      const expectedCreditAfterDraw = fromCents(toCents(depositAmt) - toCents(drawAmt))
      expect(drawRow.creditBalance).toBe(expectedCreditAfterDraw)
      expect(paymentRow.balanceDue).toBe('0.00')
      expect(paymentRow.creditBalance).toBe(expectedCreditAfterDraw)
    })

    it('closingBalanceDue equals the balance endpoint grossOutstanding and closingCreditBalance equals availableCredit', async () => {
      await createBill(LEDGER)

      const ledgerRes = await request(app)
        .get(`/api/patients/${LEDGER}/ledger`)
        .set('Cookie', cookie())
      const balRes = await request(app)
        .get(`/api/patients/${LEDGER}/balance`)
        .set('Cookie', cookie())

      expect(parseFloat(balRes.body.grossOutstanding)).toBeGreaterThan(0)
      expect(ledgerRes.body.closingBalanceDue).toBe(balRes.body.grossOutstanding)
      expect(ledgerRes.body.closingCreditBalance).toBe(balRes.body.availableCredit)
    })

    it('models a payment-only as-of fixture as unapplied credit without losing its value', async () => {
      const asOf = clinicCalendarDateString()
      const baseline = await request(app)
        .get(`/api/patients/${LEDGER}/ledger?asOf=${asOf}`)
        .set('Cookie', cookie())
      const bill = await createBill(LEDGER)
      const amount = bill.net.toFixed(2)

      // Move the still-Pending charge beyond the statement boundary before
      // collecting it. Paid transactions are intentionally immutable, so the
      // fixture must establish its chronology before the payment posts.
      await withTenantTx(
        { tenantId: TENANT_ID, userId: cashierUserId, branchId: null },
        async (tx) => {
          const future = new Date(`${asOf}T12:00:00+08:00`)
          future.setUTCDate(future.getUTCDate() + 1)
          await tx
            .update(transactions)
            .set({ transactedAt: future })
            .where(eq(transactions.displayId, bill.id))
        },
      )
      await payDirect(bill.id, amount)

      const ledgerRes = await request(app)
        .get(`/api/patients/${LEDGER}/ledger?asOf=${asOf}`)
        .set('Cookie', cookie())
      const billRows = ledgerRes.body.rows.filter(
        (row: { transactionId: string }) => row.transactionId === bill.id,
      ) as Array<{
        kind: string
        balanceDue: string
        creditBalance: string
      }>

      expect(billRows.map((row) => row.kind)).toEqual(['payment'])
      expect(billRows[0]!.balanceDue).toBe(baseline.body.closingBalanceDue)
      expect(toCents(billRows[0]!.creditBalance)).toBe(
        toCents(baseline.body.closingCreditBalance) + toCents(amount),
      )
      expect(ledgerRes.body.closingBalanceDue).toBe(baseline.body.closingBalanceDue)
      expect(toCents(ledgerRes.body.closingCreditBalance)).toBe(
        toCents(baseline.body.closingCreditBalance) + toCents(amount),
      )

      const balanceRes = await request(app)
        .get(`/api/patients/${LEDGER}/balance?asOf=${asOf}`)
        .set('Cookie', cookie())
      expect(balanceRes.body.availableCredit).toBe(ledgerRes.body.closingCreditBalance)
    })

    it('never presents a paid bill as a negative receivable in the running ledger', async () => {
      const bill = await createBill(LEDGER)
      await payDirect(bill.id, bill.net.toFixed(2))

      const ledgerRes = await request(app)
        .get(`/api/patients/${LEDGER}/ledger`)
        .set('Cookie', cookie())
      const paymentRow = ledgerRes.body.rows.find(
        (row: { transactionId: string; kind: string }) =>
          row.transactionId === bill.id && row.kind === 'payment',
      )

      expect(paymentRow).toBeDefined()
      expect(parseFloat(paymentRow.balanceDue)).toBeGreaterThanOrEqual(0)
      expect(parseFloat(ledgerRes.body.closingBalanceDue)).toBeGreaterThanOrEqual(0)
    })

    it('a Voided bill appears with affectsBalance false and does not move the running balance', async () => {
      const baselineRes = await request(app)
        .get(`/api/patients/${LEDGER}/ledger`)
        .set('Cookie', cookie())
      const baseline = baselineRes.body.closingBalanceDue

      const billN = await createBill(LEDGER)
      await voidBill(billN.id)

      const afterRes = await request(app)
        .get(`/api/patients/${LEDGER}/ledger`)
        .set('Cookie', cookie())
      expect(afterRes.body.closingBalanceDue).toBe(baseline)

      const rows = afterRes.body.rows as Array<{
        transactionId: string
        kind: string
        status: string
        affectsBalance: boolean
        balanceDue: string
      }>
      const idx = rows.findIndex((r) => r.transactionId === billN.id && r.kind === 'charge')
      expect(idx).toBeGreaterThan(-1)
      expect(rows[idx]!.status).toBe('Voided')
      expect(rows[idx]!.affectsBalance).toBe(false)
      const prevBalance = idx > 0 ? rows[idx - 1]!.balanceDue : '0.00'
      expect(rows[idx]!.balanceDue).toBe(prevBalance)
    })

    it('honours ?asOf by excluding events after that date', async () => {
      const yesterday = isoDateOffset(-1)
      const beforeRes = await request(app)
        .get(`/api/patients/${LEDGER}/ledger?asOf=${yesterday}`)
        .set('Cookie', cookie())
      const countBefore = beforeRes.body.rows.length

      const billO = await createBill(LEDGER)

      const afterSameAsOf = await request(app)
        .get(`/api/patients/${LEDGER}/ledger?asOf=${yesterday}`)
        .set('Cookie', cookie())
      expect(afterSameAsOf.body.rows.length).toBe(countBefore)
      expect(
        afterSameAsOf.body.rows.find(
          (r: { transactionId: string }) => r.transactionId === billO.id,
        ),
      ).toBeUndefined()

      const todayRes = await request(app)
        .get(`/api/patients/${LEDGER}/ledger`)
        .set('Cookie', cookie())
      expect(
        todayRes.body.rows.find((r: { transactionId: string }) => r.transactionId === billO.id),
      ).toBeTruthy()
    })

    it('surfaces fundedByTransactionId on a credit_draw row', async () => {
      // Drain any leftover credit from earlier cases in this group first
      // (setup, not itself an assertion): test24's deposit still has 1200.00
      // unconsumed, and being older it would otherwise fund this draw ahead
      // of our own fresh deposit below, since apply-credit spends sources
      // oldest-first regardless of the `amount` cap.
      const drainRes = await request(app)
        .post(`/api/patients/${LEDGER}/apply-credit`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .send({})
      expect([201, 422]).toContain(drainRes.status)

      const depositAmt = '400.00'
      const depositId = await createDeposit(LEDGER, depositAmt)
      const billP = await createBill(LEDGER)

      const r = await request(app)
        .post(`/api/patients/${LEDGER}/apply-credit`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .send({ transactionId: billP.id, amount: depositAmt })
      expect(r.status).toBe(201)

      const ledgerRes = await request(app)
        .get(`/api/patients/${LEDGER}/ledger`)
        .set('Cookie', cookie())
      const row = ledgerRes.body.rows.find(
        (r: { kind: string; transactionId: string; fundedByTransactionId: string | null }) =>
          r.kind === 'credit_draw' &&
          r.transactionId === billP.id &&
          r.fundedByTransactionId === depositId,
      )
      expect(row).toBeTruthy()
    })
  })

  // ── Receivables (PAT_REYES_DISPLAY_ID) ───────────────────────────────────────

  describe('Receivables', () => {
    it('lists only patients with a positive netOutstanding', async () => {
      await createBill(AR)

      const res = await request(app).get('/api/accounts-receivable').set('Cookie', cookie())
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.data)).toBe(true)
      for (const row of res.body.data as Array<{ netOutstanding: string }>) {
        expect(parseFloat(row.netOutstanding)).toBeGreaterThan(0)
      }
      const arRow = res.body.data.find(
        (r: { patient: { displayId: string } }) => r.patient.displayId === AR,
      )
      expect(arRow).toBeTruthy()
    })

    it("aging buckets per row sum to that row's grossOutstanding", async () => {
      const res = await request(app).get('/api/accounts-receivable').set('Cookie', cookie())
      type Row = {
        grossOutstanding: string
        aging: { d0_30: string; d31_60: string; d61_90: string; d90plus: string }
        patient: { displayId: string }
      }
      const rows = res.body.data as Row[]
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) {
        const sum =
          toCents(row.aging.d0_30) +
          toCents(row.aging.d31_60) +
          toCents(row.aging.d61_90) +
          toCents(row.aging.d90plus)
        expect(sum).toBe(toCents(row.grossOutstanding))
      }
      expect(rows.some((r) => r.patient.displayId === AR)).toBe(true)
    })

    it('excludes Voided, Refunded and is_prepayment rows', async () => {
      const before = await request(app).get('/api/accounts-receivable').set('Cookie', cookie())
      const arBefore = before.body.data.find(
        (r: { patient: { displayId: string } }) => r.patient.displayId === AR,
      )
      const g0 = arBefore.grossOutstanding

      const billR = await createBill(AR)
      await voidBill(billR.id)

      // This case is about the receivables exclusion, not the money-control
      // approval gate (docs/ai-context/06-PRODUCT-WORKFLOWS.md:262), so the
      // fixture uses the cheap non-stock WOUND service (PHP 750, under the
      // PHP 1,000 manager threshold) rather than the default ARVPEP_IM (PHP
      // 1,500) so the refund below proceeds without needing an approval.
      const billS = await createBill(AR, 1, SVC_WOUND)
      await payDirect(billS.id, billS.net.toFixed(2))
      const refundRes = await request(app)
        .post(`/api/transactions/${billS.id}/refund`)
        .set('Cookie', cookie())
        .set(FETCH_HEADER)
        .send({ reason: 'Test cleanup refund' })
      expect(refundRes.status).toBe(200)

      await createDeposit(AR, '321.00')

      const after = await request(app).get('/api/accounts-receivable').set('Cookie', cookie())
      const arAfter = after.body.data.find(
        (r: { patient: { displayId: string } }) => r.patient.displayId === AR,
      )
      expect(arAfter.grossOutstanding).toBe(g0)
    })

    it('sets the X-Total-Count header', async () => {
      const res = await request(app).get('/api/accounts-receivable').set('Cookie', cookie())
      expect(res.status).toBe(200)
      expect(res.headers['x-total-count']).toBe(String(res.body.totals.patientCount))
    })

    it('rejects ?scope=tenant for a non-admin role with 403', async () => {
      const res = await request(app)
        .get('/api/accounts-receivable?scope=tenant')
        .set('Cookie', cookie())
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('FORBIDDEN')
    })

    it('filters by ?q on patient name', async () => {
      const found = await request(app)
        .get('/api/accounts-receivable?q=Reyes')
        .set('Cookie', cookie())
      expect(
        found.body.data.some((r: { patient: { displayId: string } }) => r.patient.displayId === AR),
      ).toBe(true)

      const notFound = await request(app)
        .get('/api/accounts-receivable?q=Zzzxxqqnotarealname123')
        .set('Cookie', cookie())
      expect(
        notFound.body.data.some(
          (r: { patient: { displayId: string } }) => r.patient.displayId === AR,
        ),
      ).toBe(false)
    })
  })

  // ── Contract/shape ───────────────────────────────────────────────────────────

  describe('money field format contract', () => {
    it('every money field on the balance response is a raw numeric string with no comma formatting', async () => {
      const res = await request(app).get(`/api/patients/${AR}/balance`).set('Cookie', cookie())
      expect(res.status).toBe(200)

      const topFields = ['grossOutstanding', 'availableCredit', 'netOutstanding', 'creditOnAccount']
      for (const f of topFields) {
        const v = (res.body as Record<string, unknown>)[f]
        expect(typeof v, `${f} must be a string`).toBe('string')
        expect(v as string, `${f} must not contain comma formatting`).not.toMatch(/,/)
        expect(Number.isFinite(Number(v)), `${f} must parse to a finite number`).toBe(true)
      }

      for (const bill of res.body.openBills as Array<Record<string, unknown>>) {
        for (const f of ['netAmount', 'amountPaid', 'amountOutstanding']) {
          const v = bill[f]
          expect(typeof v, `openBills.${f} must be a string`).toBe('string')
          expect(v as string, `openBills.${f} must not contain comma formatting`).not.toMatch(/,/)
          expect(Number.isFinite(Number(v)), `openBills.${f} must parse to a finite number`).toBe(
            true,
          )
        }
      }

      for (const dep of res.body.deposits as Array<Record<string, unknown>>) {
        for (const f of ['depositAmount', 'funded', 'consumed', 'remaining']) {
          const v = dep[f]
          expect(typeof v, `deposits.${f} must be a string`).toBe('string')
          expect(v as string, `deposits.${f} must not contain comma formatting`).not.toMatch(/,/)
          expect(Number.isFinite(Number(v)), `deposits.${f} must parse to a finite number`).toBe(
            true,
          )
        }
      }

      // Sanity: this is not a vacuous pass over empty arrays.
      expect(res.body.openBills.length + res.body.deposits.length).toBeGreaterThan(0)
    })
  })
})
