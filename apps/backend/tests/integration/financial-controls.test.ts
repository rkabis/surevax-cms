import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import { db } from '../../src/shared/db/index.js'
import { branches, users } from '../../src/shared/db/schema.js'
import { createTransaction, voidTransaction } from '../../src/modules/transactions/db.js'
import { displayId } from '../../src/shared/utils/displayId.js'

const TENANT = 'SVX'
const pgClient = postgres(process.env['DATABASE_URL']!)

let hstBranchId = 0
let adminUserId = 0
let orderFixtures: Array<{
  orderDisplayId: string
  patientDisplayId: string
  serviceId: string
}> = []
const createdTxnDisplayIds: string[] = []

async function withGucs<T>(fn: (sql: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return pgClient.begin(async (sql) => {
    await sql`select set_config('app.current_tenant_id', ${TENANT}, true)`
    await sql`select set_config('app.current_user_id', ${String(adminUserId)}, true)`
    await sql`select set_config('app.current_branch_id', '', true)`
    return fn(sql as unknown as postgres.TransactionSql)
  }) as Promise<T>
}

beforeAll(async () => {
  const [hst] = await db.select({ id: branches.id }).from(branches).where(eq(branches.code, 'HST'))
  if (!hst) throw new Error('HST branch not found: run pnpm setup first')
  hstBranchId = hst.id

  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'admin@surevax.com'))
  if (!admin) throw new Error('admin user not found: run pnpm setup first')
  adminUserId = admin.id

  const rows = await withGucs(
    (sql) => sql<
      Array<{ order_display_id: string; patient_display_id: string; service_id: string }>
    >`
      SELECT co.display_id AS order_display_id,
             p.display_id AS patient_display_id,
             co.service_id
      FROM clinical_orders co
      JOIN patients p ON p.id = co.patient_id AND p.tenant_id = co.tenant_id
      JOIN encounters e ON e.id = co.encounter_id AND e.tenant_id = co.tenant_id
      JOIN service_catalog sc ON sc.id = co.service_id AND sc.tenant_id = co.tenant_id
      WHERE co.tenant_id = ${TENANT}
        AND e.branch_id = ${hstBranchId}
        AND co.status IN ('Scheduled', 'Pending')
        AND co.deleted_at IS NULL
        AND sc.is_active = true
        AND EXISTS (
          SELECT 1 FROM consents c
          WHERE c.tenant_id = co.tenant_id
            AND c.patient_id = co.patient_id
            AND c.revoked_at IS NULL
            AND c.deleted_at IS NULL
        )
        AND NOT EXISTS (
          SELECT 1
          FROM transaction_items ti
          JOIN transactions t ON t.id = ti.transaction_id AND t.tenant_id = ti.tenant_id
          WHERE ti.tenant_id = co.tenant_id
            AND ti.clinical_order_id = co.id
            AND t.deleted_at IS NULL
            AND t.status NOT IN ('Voided', 'Refunded')
        )
      ORDER BY co.id
      LIMIT 2
    `,
  )

  orderFixtures = rows.map((row) => ({
    orderDisplayId: row.order_display_id,
    patientDisplayId: row.patient_display_id,
    serviceId: row.service_id,
  }))
  if (orderFixtures.length < 2) throw new Error('two unbilled HST clinical orders are required')
})

afterAll(async () => {
  await withGucs(async (sql) => {
    if (createdTxnDisplayIds.length === 0) return
    const ids = sql(createdTxnDisplayIds)
    await sql`DELETE FROM payments WHERE transaction_id IN (SELECT id FROM transactions WHERE display_id IN ${ids})`
    await sql`DELETE FROM transaction_items WHERE transaction_id IN (SELECT id FROM transactions WHERE display_id IN ${ids})`
    await sql`DELETE FROM transactions WHERE display_id IN ${ids}`
  })
  await pgClient.end()
})

function createForOrder(order: (typeof orderFixtures)[number]) {
  return createTransaction({
    tenantId: TENANT,
    userId: adminUserId,
    branchId: hstBranchId,
    moneyCaller: { kind: 'internal' },
    payload: {
      patientId: order.patientDisplayId,
      items: [
        {
          serviceId: order.serviceId,
          clinicalOrderId: order.orderDisplayId,
          quantity: 1,
        },
      ],
    },
  })
}

function rememberSuccessful(results: Awaited<ReturnType<typeof createTransaction>>[]) {
  for (const result of results) {
    if (result.ok) createdTxnDisplayIds.push(result.id)
  }
}

describe('clinical-order billing guard', () => {
  it('rejects missing SC/PWD evidence at the service boundary before any write', async () => {
    const order = orderFixtures[0]!
    const before = await withGucs(
      (sql) => sql<{ count: string }[]>`
        SELECT COUNT(*)::text AS count
        FROM transactions t
        JOIN patients p ON p.id = t.patient_id AND p.tenant_id = t.tenant_id
        WHERE t.tenant_id = ${TENANT} AND p.display_id = ${order.patientDisplayId}
      `,
    )

    const rejected = await createTransaction({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      moneyCaller: { kind: 'internal' },
      payload: {
        patientId: order.patientDisplayId,
        discount: { idType: 'PWD' },
        items: [{ serviceId: order.serviceId, quantity: 1 }],
      },
    })

    expect(rejected).toMatchObject({
      ok: false,
      status: 400,
      code: 'DISCOUNT_ID_REQUIRED',
      details: { path: 'discount.idNumber' },
    })

    const after = await withGucs(
      (sql) => sql<{ count: string }[]>`
        SELECT COUNT(*)::text AS count
        FROM transactions t
        JOIN patients p ON p.id = t.patient_id AND p.tenant_id = t.tenant_id
        WHERE t.tenant_id = ${TENANT} AND p.display_id = ${order.patientDisplayId}
      `,
    )
    expect(after[0]!.count).toBe(before[0]!.count)
  })

  it('rejects sequential double billing and permits rebilling only after void', async () => {
    const order = orderFixtures[0]!
    const first = await createForOrder(order)
    rememberSuccessful([first])
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const duplicate = await createForOrder(order)
    rememberSuccessful([duplicate])
    expect(duplicate).toMatchObject({
      ok: false,
      status: 409,
      code: 'CLINICAL_ORDER_ALREADY_BILLED',
    })

    await voidTransaction({
      tenantId: TENANT,
      userId: adminUserId,
      branchId: hstBranchId,
      transactionDisplayId: first.id,
      reason: 'Correcting duplicate-billing integration fixture',
    })

    const replacement = await createForOrder(order)
    rememberSuccessful([replacement])
    expect(replacement.ok).toBe(true)

    // Reproduce the database-only two-step that previously bypassed the item
    // trigger: change deleted_at on the terminal bill, then restore it as Paid.
    await withGucs(
      (sql) => sql`
        UPDATE transactions
        SET deleted_at = now()
        WHERE tenant_id = ${TENANT} AND display_id = ${first.id}
      `,
    )
    await expect(
      withGucs(
        (sql) => sql`
          UPDATE transactions
          SET status = 'Paid', deleted_at = NULL
          WHERE tenant_id = ${TENANT} AND display_id = ${first.id}
        `,
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('installs tenant and activation guards in the database catalog', async () => {
    const [guard] = await withGucs(
      (sql) => sql<
        Array<{ item_trigger: boolean; activation_trigger: boolean; tenant_fk_valid: boolean }>
      >`
        SELECT
          EXISTS (
            SELECT 1 FROM pg_trigger
            WHERE tgrelid = 'transaction_items'::regclass
              AND tgname = 'trg_transaction_items_one_active_clinical_order'
              AND tgenabled <> 'D' AND NOT tgisinternal
          ) AS item_trigger,
          EXISTS (
            SELECT 1 FROM pg_trigger
            WHERE tgrelid = 'transactions'::regclass
              AND tgname = 'trg_transactions_active_order_claims'
              AND tgenabled <> 'D' AND NOT tgisinternal
          ) AS activation_trigger,
          EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'transaction_items'::regclass
              AND conname = 'transaction_items_tenant_clinical_order_fk'
              AND convalidated
          ) AS tenant_fk_valid
      `,
    )
    expect(guard).toEqual({ item_trigger: true, activation_trigger: true, tenant_fk_valid: true })
  })

  it('forces competing database inserts through the trigger race path', async () => {
    const order = orderFixtures[1]!
    const transactionIds = [displayId('TXN'), displayId('TXN')]
    const itemIds = [displayId('TXI'), displayId('TXI')]

    const [orderRow] = await withGucs(
      (sql) => sql<Array<{ order_id: number; patient_id: number }>>`
        SELECT co.id AS order_id, co.patient_id
        FROM clinical_orders co
        WHERE co.tenant_id = ${TENANT} AND co.display_id = ${order.orderDisplayId}
      `,
    )
    if (!orderRow) throw new Error('clinical-order fixture disappeared')

    await withGucs(async (sql) => {
      await sql`
        INSERT INTO transactions (
          display_id, tenant_id, branch_id, patient_id, status, created_by_id
        ) VALUES
          (${transactionIds[0]}, ${TENANT}, ${hstBranchId}, ${orderRow.patient_id}, 'Pending', ${adminUserId}),
          (${transactionIds[1]}, ${TENANT}, ${hstBranchId}, ${orderRow.patient_id}, 'Pending', ${adminUserId})
      `
    })
    createdTxnDisplayIds.push(...transactionIds)

    const contenderA = postgres(process.env['DATABASE_URL']!, { max: 1 })
    const contenderB = postgres(process.env['DATABASE_URL']!, { max: 1 })
    let releaseFirst!: () => void
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let firstInserted!: () => void
    const firstHasLock = new Promise<void>((resolve) => {
      firstInserted = resolve
    })
    let secondStarted!: () => void
    const secondIsAttempting = new Promise<void>((resolve) => {
      secondStarted = resolve
    })

    const insertItem = async (
      client: postgres.Sql,
      index: number,
      beforeInsert?: () => void,
      afterInsert?: () => Promise<void>,
    ) =>
      client.begin(async (sql) => {
        await sql`select set_config('app.current_tenant_id', ${TENANT}, true)`
        await sql`select set_config('app.current_user_id', ${String(adminUserId)}, true)`
        await sql`select set_config('app.current_branch_id', '', true)`
        beforeInsert?.()
        await sql`
          INSERT INTO transaction_items (
            display_id, tenant_id, transaction_id, service_id, clinical_order_id,
            quantity, unit_price, subtotal, created_by_id
          )
          SELECT ${itemIds[index]}, ${TENANT}, t.id, ${order.serviceId}, ${orderRow.order_id},
                 1, 0, 0, ${adminUserId}
          FROM transactions t
          WHERE t.tenant_id = ${TENANT} AND t.display_id = ${transactionIds[index]}
        `
        await afterInsert?.()
      })

    try {
      const first = insertItem(contenderA, 0, undefined, async () => {
        firstInserted()
        await holdFirst
      })
      await firstHasLock
      const second = insertItem(contenderB, 1, secondStarted)
      await secondIsAttempting
      releaseFirst()

      const outcomes = await Promise.allSettled([first, second])
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
      expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toEqual([
        expect.objectContaining({
          reason: expect.objectContaining({
            code: '23505',
            constraint_name: 'transaction_items_one_active_clinical_order',
          }),
        }),
      ])
    } finally {
      releaseFirst()
      await Promise.all([contenderA.end(), contenderB.end()])
    }
  })
})
