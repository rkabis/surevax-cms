/**
 * Corporate group billing vertical slice: one transaction is still the money
 * engine, while its group_bills wrapper moves AR ownership from patient to
 * corporate payer. Direct DB calls keep the test focused on the invariant and
 * avoid an auth-cookie dependency.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { app } from '../../src/app.js'
import { db } from '../../src/shared/db/index.js'
import { branches, users } from '../../src/shared/db/schema.js'
import {
  addGroupBillPayment,
  createGroupBill,
  getGroupBill,
  listGroupBills,
  voidGroupBill,
} from '../../src/modules/group_billing/db.js'
import { getPatientBalance } from '../../src/modules/patient_accounts/db.js'
import {
  addPayment,
  applyCreditOnAccount,
  applyPrepayment,
  createTransaction,
  payOnAccount,
} from '../../src/modules/transactions/db.js'
import { displayId } from '../../src/shared/utils/displayId.js'

const TENANT = 'SVX'
const PRIMARY = 'PAT_AAAAAAA1'
const SECONDARY = 'PAT_AAAAAAA2'
const CORPORATE_PAYER = 'PYR_AAAAAAA3' // Globe Telecom, seeded Corporate payer
const SERVICE = 'ARVBOOSTER_IM'
const PASSWORD = 'TestPass123!'
const FETCH_HEADER = {
  'X-Requested-With': 'fetch' as const,
  'X-Tenant-Slug': TENANT as const,
}
const RUN = `${process.pid}_${Date.now()}`
const RLS_ROLE = `rls_group_bill_${RUN}`
const NURSE_EMAIL = `group-bill-nurse-${RUN}@test.surevax.com`
const CREDIT_PRIMARY = displayId('PAT')
const CREDIT_SECONDARY = displayId('PAT')

const pgClient = postgres(process.env['DATABASE_URL']!)
let hstBranchId = 0
let otherBranchId = 0
let adminUserId = 0
let branchCookie = ''
let nurseCookie = ''
let adminCookie = ''
const createdTransactionIds: string[] = []

function findCookie(setCookie: string[] | undefined, name: string): string | undefined {
  return setCookie
    ?.find((cookie) => cookie.startsWith(`${name}=`))
    ?.split(';')[0]
    ?.slice(name.length + 1)
}

async function loginAs(email: string): Promise<string> {
  const login = await request(app)
    .post('/api/auth/login')
    .set(FETCH_HEADER)
    .send({ email, password: PASSWORD })
  expect(login.status, JSON.stringify(login.body)).toBe(200)
  const cookie = findCookie(login.headers['set-cookie'] as string[] | undefined, 'access_token')
  expect(cookie).toBeTruthy()
  return cookie as string
}

async function withGucs<T>(fn: (sql: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return pgClient.begin(async (sql) => {
    await sql`select set_config('app.current_tenant_id', ${TENANT}, true)`
    await sql`select set_config('app.current_user_id', ${String(adminUserId)}, true)`
    await sql`select set_config('app.current_branch_id', ${String(hstBranchId)}, true)`
    return fn(sql as unknown as postgres.TransactionSql)
  }) as Promise<T>
}

async function createUnpaid(
  referenceNumber: string,
  clinicalOrderId?: string,
  clinicalOrderServiceId = SERVICE,
  patientIds = { primary: PRIMARY, secondary: SECONDARY },
) {
  const created = await createGroupBill({
    tenantId: TENANT,
    userId: adminUserId,
    branchId: hstBranchId,
    moneyCaller: { kind: 'internal' },
    payload: {
      payerId: CORPORATE_PAYER,
      referenceNumber,
      patients: [
        {
          patientId: patientIds.primary,
          items: [
            {
              serviceId: clinicalOrderId ? clinicalOrderServiceId : SERVICE,
              quantity: 1,
              ...(clinicalOrderId ? { clinicalOrderId } : {}),
            },
          ],
        },
        { patientId: patientIds.secondary, items: [{ serviceId: SERVICE, quantity: 1 }] },
      ],
    },
  })
  expect(created.ok).toBe(true)
  if (!created.ok) throw new Error(`${created.code}: ${created.error}`)
  createdTransactionIds.push(created.transactionId)
  return created
}

beforeAll(async () => {
  const branchRows = await db.select({ id: branches.id, code: branches.code }).from(branches)
  const branch = branchRows.find((candidate) => candidate.code === 'HST')
  if (!branch) throw new Error('HST branch not found — run pnpm setup first')
  hstBranchId = branch.id
  const otherBranch = branchRows.find((candidate) => candidate.id !== hstBranchId)
  if (!otherBranch) throw new Error('A second branch is required for the group-bill RLS test')
  otherBranchId = otherBranch.id
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'admin@surevax.com'))
  if (!admin) throw new Error('admin user not found — run pnpm setup first')
  adminUserId = admin.id

  await pgClient.unsafe(`CREATE ROLE ${RLS_ROLE} NOSUPERUSER NOBYPASSRLS NOINHERIT`)
  await pgClient.unsafe(`GRANT SELECT ON group_bills TO ${RLS_ROLE}`)

  adminCookie = await loginAs('admin@surevax.com')
  const createdNurse = await request(app)
    .post('/api/admin/users')
    .set(FETCH_HEADER)
    .set('Cookie', `access_token=${adminCookie}`)
    .send({
      email: NURSE_EMAIL,
      firstName: 'Group',
      lastName: 'Bill Nurse',
      password: PASSWORD,
      role: 'Nurse',
    })
  expect(createdNurse.status, JSON.stringify(createdNurse.body)).toBe(201)
  branchCookie = await loginAs('branch-main@surevax.com')
  nurseCookie = await loginAs(NURSE_EMAIL)

  // This pair belongs only to the patient-credit test. Reusing seeded patients
  // makes the full integration suite race with other files that legitimately
  // create open patient bills, which can turn an expected NOTHING_OUTSTANDING
  // result into a payment against an unrelated fixture.
  await withGucs(async (sql) => {
    for (const [index, patientDisplayId] of [CREDIT_PRIMARY, CREDIT_SECONDARY].entries()) {
      const [patient] = await sql<{ id: number }[]>`
        INSERT INTO patients (
          display_id, tenant_id, mrn, home_branch_id, first_name, last_name, created_by_id
        ) VALUES (
          ${patientDisplayId}, ${TENANT}, ${`MRN-GB-CREDIT-${RUN}-${index + 1}`},
          ${hstBranchId}, 'GroupCredit', ${`Patient${index + 1}`}, ${adminUserId}
        )
        RETURNING id`
      if (!patient) throw new Error('group-billing credit fixture patient insert failed')
      await sql`
        INSERT INTO consents (
          display_id, tenant_id, patient_id, consent_type, scope,
          consenter_relation, obtained_at, obtained_by_id, created_by_id
        ) VALUES (
          ${displayId('CNS')}, ${TENANT}, ${patient.id}, 'informed_consent', 'tenant',
          'Patient', now(), ${adminUserId}, ${adminUserId}
        )`
    }
  })
})

afterAll(async () => {
  await withGucs(async (sql) => {
    if (createdTransactionIds.length > 0) {
      const ids = sql(createdTransactionIds)
      await sql`DELETE FROM group_bills WHERE transaction_id IN (SELECT id FROM transactions WHERE display_id IN ${ids})`
      await sql`DELETE FROM payments WHERE transaction_id IN (SELECT id FROM transactions WHERE display_id IN ${ids})`
      await sql`DELETE FROM transaction_items WHERE transaction_id IN (SELECT id FROM transactions WHERE display_id IN ${ids})`
      await sql`DELETE FROM transactions WHERE display_id IN ${ids}`
    }
    await sql`DELETE FROM user_branches WHERE user_id IN (SELECT id FROM users WHERE email = ${NURSE_EMAIL})`
    await sql`DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE email = ${NURSE_EMAIL})`
    await sql`DELETE FROM users WHERE email = ${NURSE_EMAIL}`
    await sql`DELETE FROM consents WHERE patient_id IN (
      SELECT id FROM patients WHERE display_id IN (${CREDIT_PRIMARY}, ${CREDIT_SECONDARY})
    )`
    await sql`DELETE FROM patients WHERE display_id IN (${CREDIT_PRIMARY}, ${CREDIT_SECONDARY})`
  })
  await pgClient.unsafe(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${RLS_ROLE}`)
  await pgClient.unsafe(`DROP ROLE IF EXISTS ${RLS_ROLE}`)
  await pgClient.end()
})

describe('group billing', () => {
  it('keeps exact patient allocations while moving the receivable to payer AR', async () => {
    const created = await createUnpaid(`GB-ALLOC-${Date.now()}`)
    const detail = await getGroupBill(
      { tenantId: TENANT, userId: adminUserId, branchId: hstBranchId },
      created.id,
    )
    expect(detail.patients).toHaveLength(2)
    expect(detail.patients.map((p) => p.patient.id)).toEqual([PRIMARY, SECONDARY])
    expect(detail.patients.flatMap((p) => p.items)).toHaveLength(2)
    expect(
      detail.patients
        .flatMap((patient) => patient.items)
        .reduce((sum, item) => sum + Number(item.subtotal), 0)
        .toFixed(2),
    ).toBe(detail.netAmount)
    expect(detail.referenceNumber).toContain('GB-ALLOC-')

    const patientAr = await getPatientBalance({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      patientDisplayId: PRIMARY,
    })
    expect(patientAr.openBills.map((bill) => bill.id)).not.toContain(created.transactionId)

    const payerAr = await listGroupBills({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      status: 'open',
    })
    const row = payerAr.data.find((bill) => bill.id === created.id)
    expect(row).toMatchObject({
      transactionId: created.transactionId,
      payer: { id: CORPORATE_PAYER },
      patientCount: 2,
      itemCount: 2,
      status: 'Pending',
    })
    expect(Number(row?.amountOutstanding)).toBeGreaterThan(0)

    await withGucs(async (sql) => {
      const [audit] = await sql<{ entity_id: string; action: string }[]>`
        SELECT entity_id, action::text
        FROM audit_logs
        WHERE tenant_id = ${TENANT}
          AND entity_type = 'group_bills'
          AND entity_id = ${created.id}
        ORDER BY "timestamp" DESC
        LIMIT 1`
      expect(audit).toMatchObject({ entity_id: created.id, action: 'CREATE' })
    })
  })

  it('enforces HTTP role boundaries and branch RLS visibility', async () => {
    const created = await createUnpaid(`GB-RLS-${Date.now()}`)

    const allowed = await request(app)
      .get('/api/group-bills')
      .set(FETCH_HEADER)
      .set('Cookie', `access_token=${branchCookie}`)
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(200)
    expect(allowed.body.data.map((bill: { id: string }) => bill.id)).toContain(created.id)

    const denied = await request(app)
      .get('/api/group-bills')
      .set(FETCH_HEADER)
      .set('Cookie', `access_token=${nurseCookie}`)
    expect(denied.status).toBe(403)
    expect(denied.body.code).toBe('FORBIDDEN')

    const visibleFrom = async (branchId: number) =>
      pgClient.begin(async (sql) => {
        await sql`select set_config('app.current_tenant_id', ${TENANT}, true)`
        await sql`select set_config('app.current_user_id', ${String(adminUserId)}, true)`
        await sql`select set_config('app.current_branch_id', ${String(branchId)}, true)`
        await sql.unsafe(`SET LOCAL ROLE ${RLS_ROLE}`)
        const [row] = await sql<{ count: number }[]>`
          SELECT count(*)::int AS count FROM group_bills WHERE display_id = ${created.id}`
        return row?.count ?? 0
      })

    expect(await visibleFrom(hstBranchId)).toBe(1)
    expect(await visibleFrom(otherBranchId)).toBe(0)

    const nurseGenericVoid = await request(app)
      .post(`/api/transactions/${created.transactionId}/void`)
      .set(FETCH_HEADER)
      .set('Cookie', `access_token=${nurseCookie}`)
      .send({ reason: 'Unauthorized group reversal attempt' })
    expect(nurseGenericVoid.status, JSON.stringify(nurseGenericVoid.body)).toBe(403)
    expect(nurseGenericVoid.body.code).toBe('GROUP_BILL_ADMIN_REQUIRED')

    const adminGenericVoid = await request(app)
      .post(`/api/transactions/${created.transactionId}/void`)
      .set(FETCH_HEADER)
      .set('Cookie', `access_token=${adminCookie}`)
      .send({ reason: 'Authorized whole-group cancellation' })
    expect(adminGenericVoid.status, JSON.stringify(adminGenericVoid.body)).toBe(200)
    expect(adminGenericVoid.body.status).toBe('Voided')
  })

  it('forces standalone settlement to the group corporate payer', async () => {
    const created = await createUnpaid(`GB-PAY-${Date.now()}`)
    const detail = await getGroupBill(
      { tenantId: TENANT, userId: adminUserId, branchId: hstBranchId },
      created.id,
    )
    await expect(
      addPayment({
        tenantId: TENANT,
        userId: adminUserId,
        branchId: hstBranchId,
        moneyCaller: { kind: 'internal' },
        transactionDisplayId: created.transactionId,
        method: 'Corporate',
        amount: detail.netAmount,
        payerDisplayId: 'PYR_AAAAAAA1',
        referenceNumber: `WRONG-PAYER-${Date.now()}`,
      }),
    ).rejects.toMatchObject({ code: 'GROUP_PAYER_MISMATCH' })

    const paid = await addGroupBillPayment({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      moneyCaller: { kind: 'internal' },
      groupBillDisplayId: created.id,
      payment: {
        method: 'Corporate',
        amount: detail.netAmount,
        referenceNumber: `SET-${Date.now()}`,
      },
    })
    expect(paid.status).toBe('Paid')

    const nurseRefund = await request(app)
      .post(`/api/transactions/${created.transactionId}/refund`)
      .set(FETCH_HEADER)
      .set('Cookie', `access_token=${nurseCookie}`)
      .send({ reason: 'Unauthorized group refund attempt' })
    expect(nurseRefund.status, JSON.stringify(nurseRefund.body)).toBe(403)
    expect(nurseRefund.body.code).toBe('GROUP_BILL_ADMIN_REQUIRED')

    const nurseCorrection = await request(app)
      .post(`/api/transactions/${created.transactionId}/payments/${paid.id}/correct-method`)
      .set(FETCH_HEADER)
      .set('Cookie', `access_token=${nurseCookie}`)
      .send({ newMethod: 'Corporate', reason: 'Unauthorized group correction attempt' })
    expect(nurseCorrection.status, JSON.stringify(nurseCorrection.body)).toBe(403)
    expect(nurseCorrection.body.code).toBe('GROUP_BILL_ADMIN_REQUIRED')

    await expect(
      voidGroupBill({
        tenantId: TENANT,
        userId: adminUserId,
        branchId: hstBranchId,
        callerRole: 'TenantAdmin',
        groupBillDisplayId: created.id,
        reason: 'Paid bill must be refunded before cancellation',
      }),
    ).rejects.toMatchObject({ code: 'REFUND_REQUIRED' })
    await withGucs(async (sql) => {
      const [payment] = await sql<{ payer_id: string }[]>`
        SELECT pp.display_id AS payer_id FROM payments p
        JOIN payer_profiles pp ON pp.id = p.payer_id
        WHERE p.display_id = ${paid.id}`
      expect(payment?.payer_id).toBe(CORPORATE_PAYER)
      const [paymentAudit] = await sql<{ entity_id: string; action: string }[]>`
        SELECT entity_id, action::text
        FROM audit_logs
        WHERE tenant_id = ${TENANT}
          AND entity_type = 'payments'
          AND entity_id = ${paid.id}
        ORDER BY "timestamp" DESC
        LIMIT 1`
      expect(paymentAudit).toMatchObject({ entity_id: paid.id, action: 'CREATE' })
    })
  })

  it('keeps patient tender and deposit credit out of payer-owned group AR', async () => {
    const created = await createUnpaid(`GB-CREDIT-${Date.now()}`, undefined, SERVICE, {
      primary: CREDIT_PRIMARY,
      secondary: CREDIT_SECONDARY,
    })

    await expect(
      payOnAccount({
        tenantId: TENANT,
        userId: adminUserId,
        branchId: hstBranchId,
        moneyCaller: { kind: 'internal' },
        patientDisplayId: CREDIT_PRIMARY,
        method: 'Cash',
        amount: '1.00',
        allowCredit: false,
      }),
    ).rejects.toMatchObject({ code: 'NOTHING_OUTSTANDING' })

    await expect(
      applyCreditOnAccount({
        tenantId: TENANT,
        userId: adminUserId,
        branchId: hstBranchId,
        patientDisplayId: CREDIT_PRIMARY,
        transactionDisplayId: created.transactionId,
      }),
    ).rejects.toMatchObject({ code: 'NOTHING_OUTSTANDING' })

    const deposit = await createTransaction({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      payload: {
        patientId: CREDIT_PRIMARY,
        isPrepayment: true,
        depositAmount: '25.00',
        items: [],
      },
    })
    expect(deposit.ok).toBe(true)
    if (!deposit.ok) throw new Error(`${deposit.code}: ${deposit.error}`)
    createdTransactionIds.push(deposit.id)
    await addPayment({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      moneyCaller: { kind: 'internal' },
      transactionDisplayId: deposit.id,
      method: 'Cash',
      amount: '25.00',
    })

    await expect(
      applyPrepayment({
        tenantId: TENANT,
        userId: adminUserId,
        branchId: hstBranchId,
        prepaymentDisplayId: deposit.id,
        consumingDisplayId: created.transactionId,
      }),
    ).rejects.toMatchObject({ code: 'GROUP_BILL_PATIENT_CREDIT_FORBIDDEN' })

    await expect(
      withGucs(
        (sql) => sql`
        INSERT INTO payments (
          display_id, tenant_id, transaction_id, method, amount, received_by_id, created_by_id
        )
        SELECT ${displayId('PMT')}, ${TENANT}, t.id, 'Credit'::payment_method,
               1.00, ${adminUserId}, ${adminUserId}
        FROM transactions t
        WHERE t.tenant_id = ${TENANT} AND t.display_id = ${created.transactionId}`,
      ),
    ).rejects.toMatchObject({ constraint_name: 'group_bill_patient_credit_forbidden' })

    const unchanged = await getGroupBill(
      { tenantId: TENANT, userId: adminUserId, branchId: hstBranchId },
      created.id,
    )
    expect(unchanged.amountPaid).toBe('0.00')
    expect(unchanged.status).toBe('Pending')
  })

  it('voids an unpaid group bill through the existing transaction lifecycle', async () => {
    const created = await createUnpaid(`GB-VOID-${Date.now()}`)
    const voided = await voidGroupBill({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      callerRole: 'TenantAdmin',
      groupBillDisplayId: created.id,
      reason: 'Corporate booking entered in error',
    })
    expect(voided).toMatchObject({
      id: created.id,
      transactionId: created.transactionId,
      status: 'Voided',
    })
    const open = await listGroupBills({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      status: 'open',
    })
    expect(open.data.map((bill) => bill.id)).not.toContain(created.id)
  })

  it('serializes duplicate live clinical-order billing attempts', async () => {
    const [order] = await withGucs(
      (sql) =>
        sql<{ display_id: string; service_id: string }[]>`
        SELECT co.display_id, co.service_id
        FROM clinical_orders co
        JOIN patients p ON p.id = co.patient_id
        WHERE co.tenant_id = ${TENANT} AND p.display_id = ${PRIMARY}
          AND NOT EXISTS (SELECT 1 FROM transaction_items ti WHERE ti.clinical_order_id = co.id)
        ORDER BY co.id LIMIT 1`,
    )
    expect(
      order,
      'seed must provide an unbilled clinical order for the concurrency invariant',
    ).toBeDefined()
    if (!order) throw new Error('No unbilled clinical order available')

    const [first, second] = await Promise.allSettled([
      createUnpaid(`GB-CO-A-${Date.now()}`, order.display_id, order.service_id),
      createUnpaid(`GB-CO-B-${Date.now()}`, order.display_id, order.service_id),
    ])
    const successes = [first, second].filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof createUnpaid>>> =>
        result.status === 'fulfilled',
    )
    const failures = [first, second].filter((result) => result.status === 'rejected')
    expect(successes).toHaveLength(1)
    expect(failures).toHaveLength(1)
  })

  it('rejects a clinical order attributed to the wrong patient without partial rows', async () => {
    const [order] = await withGucs(
      (sql) => sql<{ display_id: string; service_id: string }[]>`
        SELECT co.display_id, co.service_id
        FROM clinical_orders co
        JOIN patients p ON p.id = co.patient_id
        WHERE co.tenant_id = ${TENANT} AND p.display_id = ${SECONDARY}
          AND NOT EXISTS (SELECT 1 FROM transaction_items ti WHERE ti.clinical_order_id = co.id)
        ORDER BY co.id LIMIT 1`,
    )
    expect(order).toBeDefined()
    if (!order) throw new Error('No secondary-patient clinical order available')

    const referenceNumber = `GB-WRONG-ORDER-${Date.now()}`
    const result = await createGroupBill({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      moneyCaller: { kind: 'internal' },
      payload: {
        payerId: CORPORATE_PAYER,
        referenceNumber,
        patients: [
          {
            patientId: PRIMARY,
            items: [
              {
                serviceId: order.service_id,
                clinicalOrderId: order.display_id,
                quantity: 1,
              },
            ],
          },
          { patientId: SECONDARY, items: [{ serviceId: SERVICE, quantity: 1 }] },
        ],
      },
    })
    expect(result).toMatchObject({ ok: false, code: 'CLINICAL_ORDER_PATIENT_MISMATCH' })
    await withGucs(async (sql) => {
      const [rows] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM group_bills WHERE reference_number = ${referenceNumber}`
      expect(rows?.count).toBe(0)
    })
  })

  it('replays a group create idempotency key without creating a second bill', async () => {
    const key = `group-test-${Date.now()}`
    const referenceNumber = `GB-IDEM-${Date.now()}`
    const body = {
      payerId: CORPORATE_PAYER,
      referenceNumber,
      patients: [
        { patientId: PRIMARY, items: [{ serviceId: SERVICE, quantity: 1 }] },
        { patientId: SECONDARY, items: [{ serviceId: SERVICE, quantity: 1 }] },
      ],
    }
    const first = await request(app)
      .post('/api/group-bills')
      .set(FETCH_HEADER)
      .set('Cookie', `access_token=${adminCookie}`)
      .set('Idempotency-Key', key)
      .send(body)
    expect(first.status, JSON.stringify(first.body)).toBe(201)
    createdTransactionIds.push(first.body.transactionId as string)

    const replay = await request(app)
      .post('/api/group-bills')
      .set(FETCH_HEADER)
      .set('Cookie', `access_token=${adminCookie}`)
      .set('Idempotency-Key', key)
      .send(body)
    expect(replay.status, JSON.stringify(replay.body)).toBe(200)
    expect(replay.headers['x-idempotent-replay']).toBe('true')
    expect(replay.body).toMatchObject({ id: first.body.id, idempotentReplay: true })

    await withGucs(async (sql) => {
      const [rows] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM group_bills WHERE idempotency_key = ${key}`
      expect(rows?.count).toBe(1)
    })
  })
})
