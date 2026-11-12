import { beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../../src/app.js'
import { db } from '../../src/shared/db/index.js'
import { clinicalOrders } from '../../src/shared/db/schema.js'
import { and, eq } from 'drizzle-orm'

const FETCH_HEADER = {
  'X-Requested-With': 'fetch' as const,
  'X-Tenant-Slug': 'SVX' as const,
}

// Seeded by seed/branch-workflows.ts for TMG. The Branch account below is
// deliberately HST, so this is a direct-URL cross-branch attempt.
const TMG_ORDER_ID = 'ORD_000000FM'

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

describe('scheduled-order direct routes — Branch scope', () => {
  let branchCookie: string
  let cashierCookie: string
  let adminCookie: string
  let originalStatus: string

  beforeAll(async () => {
    branchCookie = await loginAs('branch-main@surevax.com')
    cashierCookie = await loginAs('jose.santos@surevax.com')
    adminCookie = await loginAs('admin@surevax.com')

    const [order] = await db
      .select({ status: clinicalOrders.status })
      .from(clinicalOrders)
      .where(and(eq(clinicalOrders.tenantId, 'SVX'), eq(clinicalOrders.displayId, TMG_ORDER_ID)))
      .limit(1)
    expect(order, 'TMG branch-workflow order missing; run pnpm setup').toBeTruthy()
    originalStatus = order!.status
  })

  it('hides a different branch order from the Branch kiosk across every direct read route', async () => {
    const paths = [
      `/api/scheduled-orders/${TMG_ORDER_ID}`,
      `/api/scheduled-orders/${TMG_ORDER_ID}/timeline`,
      `/api/scheduled-orders/${TMG_ORDER_ID}/doses`,
      `/api/scheduled-orders/${TMG_ORDER_ID}/text-draft`,
      `/api/scheduled-orders/${TMG_ORDER_ID}/eligible-lots`,
      `/api/scheduled-orders/${TMG_ORDER_ID}/recompute-preview`,
    ]

    for (const path of paths) {
      const response = await request(app).get(path).set(FETCH_HEADER).set('Cookie', branchCookie)
      expect(response.status, `${path}: ${JSON.stringify(response.body)}`).toBe(404)
      expect(response.body.code).toBe('NOT_FOUND')
    }
  })

  it('prevents a Branch kiosk from changing or administering a different branch order', async () => {
    const recompute = await request(app)
      .post(`/api/scheduled-orders/${TMG_ORDER_ID}/recompute`)
      .set(FETCH_HEADER)
      .set('Cookie', branchCookie)
    expect(recompute.status, JSON.stringify(recompute.body)).toBe(404)

    // Access preflight intentionally runs before idempotency/body parsing, so
    // a guessed foreign order ID cannot be replayed or probed with a payload.
    const administer = await request(app)
      .post(`/api/scheduled-orders/${TMG_ORDER_ID}/administer`)
      .set(FETCH_HEADER)
      .set('Cookie', branchCookie)
      .send({})
    expect(administer.status, JSON.stringify(administer.body)).toBe(404)

    const reschedule = await request(app)
      .post(`/api/scheduled-orders/${TMG_ORDER_ID}/reschedule`)
      .set(FETCH_HEADER)
      .set('Cookie', branchCookie)
      .send({ newDate: '2030-01-01', reason: 'Cross-branch write must be blocked' })
    expect(reschedule.status, JSON.stringify(reschedule.body)).toBe(404)

    const [after] = await db
      .select({ status: clinicalOrders.status })
      .from(clinicalOrders)
      .where(and(eq(clinicalOrders.tenantId, 'SVX'), eq(clinicalOrders.displayId, TMG_ORDER_ID)))
      .limit(1)
    expect(after?.status).toBe(originalStatus)
  })

  it('keeps the established TenantAdmin cross-branch operational read', async () => {
    const response = await request(app)
      .get(`/api/scheduled-orders/${TMG_ORDER_ID}`)
      .set(FETCH_HEADER)
      .set('Cookie', adminCookie)

    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body.id).toBe(TMG_ORDER_ID)
  })

  it('allows branch-scoped cashier reads but rejects clinical writes', async () => {
    const list = await request(app)
      .get('/api/scheduled-orders')
      .set(FETCH_HEADER)
      .set('Cookie', cashierCookie)
    expect(list.status, JSON.stringify(list.body)).toBe(200)

    const localOrderId = list.body.data?.[0]?.id as string | undefined
    if (!localOrderId) return

    const recompute = await request(app)
      .post(`/api/scheduled-orders/${localOrderId}/recompute`)
      .set(FETCH_HEADER)
      .set('Cookie', cashierCookie)
    expect(recompute.status, JSON.stringify(recompute.body)).toBe(403)
  })
})
