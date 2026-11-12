import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import postgres from 'postgres'
import { app } from '../../src/app.js'

// /api/services mounts WITHOUT a router-level requireRole, because the POS
// line-item picker, the administer brand picker and the arrivals wizard all
// need catalog reads from whichever role is at the desk. The write routes
// (POST / PATCH / PUT) therefore carry their own
// requireRole('TenantAdmin','BranchAdmin') per-route in
// modules/service_catalog/routes.ts.
//
// Before that gate, any authenticated principal (a Nurse, a Cashier, or the
// shared day-scoped `Branch` service account sitting unattended on the front
// desk) could create catalog services and move `basePrice`, which dual-writes
// `service_prices` and so reprices every future sale at every branch.
//
// These tests lock both halves: reads stay open, writes are admin-only, and
// BOTH allowed roles are proven to still get through.

const FETCH_HEADER = {
  'X-Requested-With': 'fetch' as const,
  'X-Tenant-Slug': 'SVX' as const,
}
const PASSWORD = 'TestPass123!'
const TENANT_ID = 'SVX'
// Supertest fires real HTTP through the app's own pool, so withRollback cannot
// isolate these writes (patterns.md "BEGIN/ROLLBACK test isolation"). Suffix
// the fixtures to survive concurrent/repeat runs and delete them in afterAll.
const SUFFIX = Date.now()
const NURSE_EMAIL = `svc-guard-nurse-${SUFFIX}@test.surevax.com`
const BRANCH_ADMIN_EMAIL = `svc-guard-ba-${SUFFIX}@test.surevax.com`

function findCookie(setCookie: string[] | undefined, name: string): string | undefined {
  if (!setCookie) return undefined
  const match = setCookie.find((c) => c.startsWith(`${name}=`))
  return match?.split(';')[0]?.slice(`${name}=`.length)
}

async function loginAs(email: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .set(FETCH_HEADER)
    .send({ email, password: PASSWORD })
  expect(res.status, `login as ${email} -> ${res.status}`).toBe(200)
  const cookie = findCookie(res.headers['set-cookie'] as unknown as string[], 'access_token')
  expect(cookie, `no access_token cookie for ${email}`).toBeTruthy()
  return cookie as string
}

async function createUserAs(cookie: string, email: string, role: string): Promise<void> {
  const res = await request(app)
    .post('/api/admin/users')
    .set('Cookie', `access_token=${cookie}`)
    .set(FETCH_HEADER)
    .send({ email, firstName: 'Svc', lastName: 'Guard', password: PASSWORD, role })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
}

/**
 * `service_catalog.id` IS the raw catalog code, and `catalogCodeSchema`
 * (CATALOG_CODE_REGEX) only accepts `[A-Z][A-Z0-9_]{1,30}[A-Z0-9]`: uppercase,
 * never trailing-underscore, 3 to 32 chars. Keep the tag short, since the
 * 13-digit `Date.now()` suffix also has to fit under createServiceSchema's
 * max(30).
 */
function newServiceBody(tag: string) {
  return {
    code: `SG${tag}${SUFFIX}`,
    name: `Services guard ${tag}`,
    serviceType: 'Procedure' as const,
    basePrice: '123.00',
  }
}

async function readBasePrice(cookie: string, serviceId: string): Promise<string> {
  const res = await request(app)
    .get(`/api/services/${serviceId}`)
    .set('Cookie', `access_token=${cookie}`)
    .set(FETCH_HEADER)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body.data.basePrice as string
}

describe('service catalog write guard', () => {
  let adminCookie: string
  let nurseCookie: string
  let branchAdminCookie: string
  let branchCookie: string
  /** Raw catalog code of a service created by the admin: the PATCH/PUT target. */
  let targetServiceId: string

  beforeAll(async () => {
    adminCookie = await loginAs('admin@surevax.com')

    // Seeded nurses are PIN-only (`canLogin: false`, shared-session clinic), so
    // mint password logins for the roles under test.
    await createUserAs(adminCookie, NURSE_EMAIL, 'Nurse')
    await createUserAs(adminCookie, BRANCH_ADMIN_EMAIL, 'BranchAdmin')
    nurseCookie = await loginAs(NURSE_EMAIL)
    branchAdminCookie = await loginAs(BRANCH_ADMIN_EMAIL)

    // The shared branch kiosk account: the highest-exposure non-admin login.
    branchCookie = await loginAs('branch-main@surevax.com')

    const created = await request(app)
      .post('/api/services')
      .set('Cookie', `access_token=${adminCookie}`)
      .set(FETCH_HEADER)
      .send(newServiceBody('TGT'))
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    targetServiceId = created.body.data.id as string
  })

  // The created service defaults to active, so leaving it behind would add a
  // permanent junk row to the Services list and the POS picker of the shared
  // dev database on every run.
  afterAll(async () => {
    const sql = postgres(process.env['DATABASE_MIGRATOR_URL'] || process.env['DATABASE_URL']!)
    try {
      // The audit trigger raises unless app.current_tenant_id matches the row's
      // tenant (0024 strict mode), so set it before deleting.
      await sql`SELECT set_config('app.current_tenant_id', ${TENANT_ID}, false)`
      if (targetServiceId) {
        await sql`DELETE FROM service_prices WHERE service_id = ${targetServiceId}`
        await sql`DELETE FROM service_catalog WHERE id = ${targetServiceId}`
      }
      // user_roles / user_branches cascade off users.
      await sql`DELETE FROM users WHERE email IN (${NURSE_EMAIL}, ${BRANCH_ADMIN_EMAIL})`
    } finally {
      await sql.end({ timeout: 5 })
    }
  })

  it('Nurse can list services -> 200', async () => {
    const res = await request(app)
      .get('/api/services')
      .set('Cookie', `access_token=${nurseCookie}`)
      .set(FETCH_HEADER)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.data.length).toBeGreaterThan(0)
  })

  it('Nurse can read a service detail and its prices -> 200', async () => {
    const detail = await request(app)
      .get(`/api/services/${targetServiceId}`)
      .set('Cookie', `access_token=${nurseCookie}`)
      .set(FETCH_HEADER)
    expect(detail.status, JSON.stringify(detail.body)).toBe(200)
    expect(detail.body.data.id).toBe(targetServiceId)

    const prices = await request(app)
      .get(`/api/services/${targetServiceId}/prices`)
      .set('Cookie', `access_token=${nurseCookie}`)
      .set(FETCH_HEADER)
    expect(prices.status, JSON.stringify(prices.body)).toBe(200)
    expect(Array.isArray(prices.body.data)).toBe(true)
  })

  it('the Branch account can still read the catalog (POS picker) -> 200', async () => {
    const res = await request(app)
      .get('/api/services')
      .set('Cookie', `access_token=${branchCookie}`)
      .set(FETCH_HEADER)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
  })

  it('Nurse cannot create a service -> 403 FORBIDDEN', async () => {
    const res = await request(app)
      .post('/api/services')
      .set('Cookie', `access_token=${nurseCookie}`)
      .set(FETCH_HEADER)
      .send(newServiceBody('NURSE'))
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('FORBIDDEN')

    // The refused create must not have landed.
    const list = await request(app)
      .get('/api/services')
      .set('Cookie', `access_token=${adminCookie}`)
      .set(FETCH_HEADER)
      .query({ q: `SGNURSE${SUFFIX}` })
    expect(list.body.data).toHaveLength(0)
  })

  // Each write case reads the price back inside its own body, so the
  // assertions do not depend on the declaration order of the it() blocks.
  it('Nurse cannot reprice a service via PATCH -> 403, price unchanged', async () => {
    const before = await readBasePrice(adminCookie, targetServiceId)
    const res = await request(app)
      .patch(`/api/services/${targetServiceId}`)
      .set('Cookie', `access_token=${nurseCookie}`)
      .set(FETCH_HEADER)
      .send({ basePrice: '1.00' })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('FORBIDDEN')
    expect(await readBasePrice(adminCookie, targetServiceId)).toBe(before)
  })

  it('Nurse cannot reprice a service via PUT -> 403, price unchanged', async () => {
    const before = await readBasePrice(adminCookie, targetServiceId)
    const res = await request(app)
      .put(`/api/services/${targetServiceId}`)
      .set('Cookie', `access_token=${nurseCookie}`)
      .set(FETCH_HEADER)
      .send({ basePrice: '1.00' })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('FORBIDDEN')
    expect(await readBasePrice(adminCookie, targetServiceId)).toBe(before)
  })

  it('the shared Branch account cannot create or reprice -> 403 FORBIDDEN', async () => {
    const before = await readBasePrice(adminCookie, targetServiceId)

    const create = await request(app)
      .post('/api/services')
      .set('Cookie', `access_token=${branchCookie}`)
      .set(FETCH_HEADER)
      .send(newServiceBody('BRANCH'))
    expect(create.status).toBe(403)
    expect(create.body.code).toBe('FORBIDDEN')

    const patch = await request(app)
      .patch(`/api/services/${targetServiceId}`)
      .set('Cookie', `access_token=${branchCookie}`)
      .set(FETCH_HEADER)
      .send({ basePrice: '1.00' })
    expect(patch.status).toBe(403)
    expect(patch.body.code).toBe('FORBIDDEN')

    expect(await readBasePrice(adminCookie, targetServiceId)).toBe(before)
  })

  it('TenantAdmin can still reprice -> 200', async () => {
    const res = await request(app)
      .patch(`/api/services/${targetServiceId}`)
      .set('Cookie', `access_token=${adminCookie}`)
      .set(FETCH_HEADER)
      .send({ basePrice: '456.00' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.data.basePrice).toBe('456.00')
  })

  // The gate admits two roles. Without this case, narrowing it to
  // requireRole('TenantAdmin') would lock every branch admin out silently.
  //
  // This is also the SECOND price change on the same calendar day, which is
  // how it caught the resolveServicePrice tie described in shared/lib/pricing.ts:
  // effective_from/effective_to are DATE columns, so the row superseded moments
  // ago is still eligible today and used to win the tie at random.
  it('BranchAdmin can still reprice -> 200', async () => {
    const res = await request(app)
      .patch(`/api/services/${targetServiceId}`)
      .set('Cookie', `access_token=${branchAdminCookie}`)
      .set(FETCH_HEADER)
      .send({ basePrice: '789.00' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.data.basePrice).toBe('789.00')
  })

  it('BranchAdmin can still create a service -> 201', async () => {
    const res = await request(app)
      .post('/api/services')
      .set('Cookie', `access_token=${branchAdminCookie}`)
      .set(FETCH_HEADER)
      .send(newServiceBody('BA'))
    expect(res.status, JSON.stringify(res.body)).toBe(201)

    // Clean up immediately: afterAll only knows about the shared target.
    const created = res.body.data.id as string
    const sql = postgres(process.env['DATABASE_MIGRATOR_URL'] || process.env['DATABASE_URL']!)
    try {
      await sql`SELECT set_config('app.current_tenant_id', ${TENANT_ID}, false)`
      await sql`DELETE FROM service_prices WHERE service_id = ${created}`
      await sql`DELETE FROM service_catalog WHERE id = ${created}`
    } finally {
      await sql.end({ timeout: 5 })
    }
  })
})
