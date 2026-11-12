/**
 * Integration tests for the void/refund money-control approval gate.
 *
 * Invariant (docs/ai-context/06-PRODUCT-WORKFLOWS.md:262): "Void/refund over
 * PHP 1,000 requires manager approval. Refund over PHP 5,000 requires admin
 * approval." Implemented in `enforceMoneyApprovalGate`
 * (modules/transactions/db.ts), wired into `voidTransaction` (gates on
 * amount_paid) and `refundTransaction` (gates on the refund amount), filing
 * a Pending `approval_requests` row and refusing until it is Approved.
 *
 * Dedicated patient: PAT_TORRES_DISPLAY_ID. No other test file touches it
 * (grepped clean at write time), so this file owns its own balance and needs
 * no cleanup between its own tests: each test only asserts on the specific
 * transaction/approval it created, never an aggregate across the patient.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { app } from '../src/app.js'
import { db } from '../src/shared/db/index.js'
import { users } from '../src/shared/db/schema.js'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcrypt'
import { withTenantTx } from '../src/shared/db/withTenantTx.js'
import { PAT_TORRES_DISPLAY_ID, SVC_ARVPEP_IM, SVC_WOUND } from '../src/shared/db/seed/constants.js'

const TENANT_ID = 'SVX'
const FETCH_HEADER = {
  'X-Requested-With': 'fetch' as const,
  'X-Tenant-Slug': 'SVX' as const,
}
const CASHIER_EMAIL = 'jose.santos@surevax.com'
const ADMIN_EMAIL = 'admin@surevax.com'
const PATIENT = PAT_TORRES_DISPLAY_ID

function findCookie(setCookie: string[] | undefined, name: string): string | undefined {
  if (!setCookie) return undefined
  const match = setCookie.find((c) => c.startsWith(`${name}=`))
  if (!match) return undefined
  return match.split(';')[0]?.slice(`${name}=`.length)
}

async function loginAs(email: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .set(FETCH_HEADER)
    .send({ email, password: 'TestPass123!' })
  if (res.status !== 200) {
    throw new Error(`login as ${email} failed: ${res.status} ${JSON.stringify(res.body)}`)
  }
  const cookie = findCookie(res.headers['set-cookie'] as unknown as string[], 'access_token')
  if (!cookie) throw new Error(`login as ${email} did not set access_token`)
  return cookie
}

describe('Money-control approval gate (void/refund)', () => {
  let cashierToken: string
  let adminToken: string
  let managerToken: string
  const cashierCookie = () => `access_token=${cashierToken}`
  const adminCookie = () => `access_token=${adminToken}`
  const managerCookie = () => `access_token=${managerToken}`

  beforeAll(async () => {
    // Enable login on the seeded cashier (seed leaves can_login = false).
    const [cashier] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, CASHIER_EMAIL))
      .limit(1)
    if (!cashier) throw new Error(`seeded cashier (${CASHIER_EMAIL}) not found`)

    await withTenantTx({ tenantId: TENANT_ID, userId: cashier.id, branchId: null }, async (tx) => {
      await tx
        .update(users)
        .set({ canLogin: true, passwordHash: await bcrypt.hash('TestPass123!', 10) })
        .where(eq(users.id, cashier.id))
    })

    cashierToken = await loginAs(CASHIER_EMAIL)
    adminToken = await loginAs(ADMIN_EMAIL)

    // A fresh BranchAdmin ("manager") persona, created through the real admin
    // API (not a direct DB insert), so it exercises the same onboarding path
    // a real branch manager account would. Used to prove the refund admin
    // tier requires TenantAdmin specifically and a BranchAdmin does not
    // suffice, per the invariant's "manager" vs "admin" distinction.
    const managerEmail = `money-gate-manager-${Date.now()}@test.surevax.com`
    const createManagerRes = await request(app)
      .post('/api/admin/users')
      .set('Cookie', adminCookie())
      .set(FETCH_HEADER)
      .send({
        email: managerEmail,
        firstName: 'Gate',
        lastName: 'Manager',
        password: 'TestPass123!',
        role: 'BranchAdmin',
        branchId: 'SVX.HST',
      })
    if (createManagerRes.status !== 201) {
      throw new Error(
        `manager persona create failed: ${createManagerRes.status} ${JSON.stringify(createManagerRes.body)}`,
      )
    }
    managerToken = await loginAs(managerEmail)
  })

  /** Create a bill for PATIENT and return its id + net amount (numeric(12,2) → number). */
  async function createBill(
    quantity: number,
    serviceId: string = SVC_ARVPEP_IM,
  ): Promise<{ id: string; net: number }> {
    const res = await request(app)
      .post('/api/transactions')
      .set('Cookie', cashierCookie())
      .set(FETCH_HEADER)
      .send({ patientId: PATIENT, items: [{ serviceId, quantity }] })
    if (res.status !== 201) {
      throw new Error(`createBill failed: ${res.status} ${JSON.stringify(res.body)}`)
    }
    const get = await request(app)
      .get(`/api/transactions/${res.body.id}`)
      .set('Cookie', cashierCookie())
    return { id: res.body.id, net: parseFloat(get.body.netAmount) }
  }

  async function pay(id: string, amount: string): Promise<void> {
    const res = await request(app)
      .post(`/api/transactions/${id}/payments`)
      .set('Cookie', cashierCookie())
      .set(FETCH_HEADER)
      .send({ method: 'Cash', amount })
    if (res.status !== 201) {
      throw new Error(`pay failed: ${res.status} ${JSON.stringify(res.body)}`)
    }
  }

  async function approve(
    approvalId: string,
    cookie: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await request(app)
      .patch(`/api/admin/approvals/${approvalId}/approve`)
      .set('Cookie', cookie)
      .set(FETCH_HEADER)
      .send({})
    return { status: res.status, body: res.body }
  }

  // ── Below threshold proceeds ─────────────────────────────────────────────

  it('a void at or under the manager threshold proceeds without a gate', async () => {
    // SVC_WOUND (PHP 750, non-stock) never paid, so amount_paid is 0.
    const bill = await createBill(1, SVC_WOUND)

    const res = await request(app)
      .post(`/api/transactions/${bill.id}/void`)
      .set('Cookie', cashierCookie())
      .set(FETCH_HEADER)
      .send({ reason: 'Below-threshold void proceeds' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('Voided')
  })

  it('a refund at or under the manager threshold proceeds without a gate', async () => {
    // SVC_WOUND (PHP 750) paid in full: refund amount is 750, under PHP 1,000.
    const bill = await createBill(1, SVC_WOUND)
    await pay(bill.id, bill.net.toFixed(2))

    const res = await request(app)
      .post(`/api/transactions/${bill.id}/refund`)
      .set('Cookie', cashierCookie())
      .set(FETCH_HEADER)
      .send({ reason: 'Below-threshold refund proceeds' })

    expect(res.status).toBe(200)
    expect(res.body.transaction.status).toBe('Refunded')
  })

  // ── Above threshold: refuse, file, idempotent, approve, single-use ──────

  describe('void over the manager threshold', () => {
    // 2x ARVPEP_IM = PHP 3,000 net; leave it Pending with a PHP 1,200
    // partial payment (over the PHP 1,000 threshold, still short of the
    // PHP 3,000 net, so the transaction stays Pending and voidable).
    let bill: { id: string; net: number }
    let approvalId: string

    beforeAll(async () => {
      bill = await createBill(2)
      await pay(bill.id, '1200.00')
    })

    it('refuses with APPROVAL_REQUIRED and files exactly one Pending request', async () => {
      const res = await request(app)
        .post(`/api/transactions/${bill.id}/void`)
        .set('Cookie', cashierCookie())
        .set(FETCH_HEADER)
        .send({ reason: 'Over-threshold void, attempt 1' })

      expect(res.status).toBe(403)
      expect(res.body.code).toBe('APPROVAL_REQUIRED')
      expect(res.body.approverRole).toBe('BranchAdmin')
      expect(res.body.requiredTier).toBe('manager')
      expect(res.body.approvalRequestId).toBeTruthy()
      approvalId = res.body.approvalRequestId

      const list = await request(app)
        .get('/api/admin/approvals?limit=200')
        .set('Cookie', adminCookie())
        .set(FETCH_HEADER)
      const matches = (
        list.body.data as Array<{ id: string; entityId: string; status: string }>
      ).filter((r) => r.entityId === bill.id && r.status === 'Pending')
      expect(matches.length).toBe(1)
      expect(matches[0]!.id).toBe(approvalId)
    })

    it('a repeat attempt does not file a second request', async () => {
      const res = await request(app)
        .post(`/api/transactions/${bill.id}/void`)
        .set('Cookie', cashierCookie())
        .set(FETCH_HEADER)
        .send({ reason: 'Over-threshold void, attempt 2 (should be idempotent)' })

      expect(res.status).toBe(403)
      expect(res.body.code).toBe('APPROVAL_REQUIRED')
      expect(res.body.approvalRequestId).toBe(approvalId)

      const list = await request(app)
        .get('/api/admin/approvals?limit=200')
        .set('Cookie', adminCookie())
        .set(FETCH_HEADER)
      const matches = (
        list.body.data as Array<{ id: string; entityId: string; status: string }>
      ).filter((r) => r.entityId === bill.id)
      expect(matches.length).toBe(1)
    })

    it('after approval the void succeeds', async () => {
      const approveRes = await approve(approvalId, adminCookie())
      expect(approveRes.status).toBe(200)
      expect((approveRes.body as { data: { status: string } }).data.status).toBe('Approved')

      const retryRes = await request(app)
        .post(`/api/transactions/${bill.id}/void`)
        .set('Cookie', cashierCookie())
        .set(FETCH_HEADER)
        .send({ reason: 'Retry after manager approval' })
      expect(retryRes.status).toBe(200)
      expect(retryRes.body.status).toBe('Voided')
    })

    it('the approval is single-use: re-approving it is refused', async () => {
      const reapproveRes = await approve(approvalId, adminCookie())
      expect(reapproveRes.status).toBe(404)
      expect(reapproveRes.body.code).toBe('NOT_FOUND')
    })

    it('a manager (BranchAdmin) may also clear the manager tier', async () => {
      // Independent fixture from the rest of this block: same shape (2x
      // ARVPEP_IM, PHP 1,200 partial payment), approved by the BranchAdmin
      // persona instead of TenantAdmin, to show the manager tier genuinely
      // accepts either role, not just the TenantAdmin exemption.
      const bill2 = await createBill(2)
      await pay(bill2.id, '1200.00')

      const gatedRes = await request(app)
        .post(`/api/transactions/${bill2.id}/void`)
        .set('Cookie', cashierCookie())
        .set(FETCH_HEADER)
        .send({ reason: 'Over-threshold void for manager-approval case' })
      expect(gatedRes.status).toBe(403)
      const approvalId2 = gatedRes.body.approvalRequestId

      const approveRes = await approve(approvalId2, managerCookie())
      expect(approveRes.status).toBe(200)

      const retryRes = await request(app)
        .post(`/api/transactions/${bill2.id}/void`)
        .set('Cookie', cashierCookie())
        .set(FETCH_HEADER)
        .send({ reason: 'Retry after manager approval' })
      expect(retryRes.status).toBe(200)
      expect(retryRes.body.status).toBe('Voided')
    })
  })

  describe('refund over the admin threshold', () => {
    it('requires the admin approver: a manager is refused, an admin clears it', async () => {
      // 4x ARVPEP_IM = PHP 6,000, over the PHP 5,000 admin threshold.
      const bill = await createBill(4)
      await pay(bill.id, bill.net.toFixed(2))

      const gatedRes = await request(app)
        .post(`/api/transactions/${bill.id}/refund`)
        .set('Cookie', cashierCookie())
        .set(FETCH_HEADER)
        .send({ reason: 'Over-admin-threshold refund' })
      expect(gatedRes.status).toBe(403)
      expect(gatedRes.body.code).toBe('APPROVAL_REQUIRED')
      expect(gatedRes.body.approverRole).toBe('TenantAdmin')
      expect(gatedRes.body.requiredTier).toBe('admin')
      const approvalId = gatedRes.body.approvalRequestId
      expect(approvalId).toBeTruthy()

      // A BranchAdmin ("manager") is NOT sufficient for the admin tier.
      const managerApprove = await approve(approvalId, managerCookie())
      expect(managerApprove.status).toBe(403)
      expect(managerApprove.body.code).toBe('INSUFFICIENT_ROLE')

      // A TenantAdmin ("admin") clears it.
      const adminApprove = await approve(approvalId, adminCookie())
      expect(adminApprove.status).toBe(200)
      expect((adminApprove.body as { data: { status: string } }).data.status).toBe('Approved')

      const retryRes = await request(app)
        .post(`/api/transactions/${bill.id}/refund`)
        .set('Cookie', cashierCookie())
        .set(FETCH_HEADER)
        .send({ reason: 'Retry after admin approval' })
      expect(retryRes.status).toBe(200)
      expect(retryRes.body.transaction.status).toBe('Refunded')
    })
  })
})
