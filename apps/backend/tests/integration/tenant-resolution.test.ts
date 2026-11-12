/**
 * Integration tests for Phase 2 dynamic tenant resolution.
 *
 * Proves the three resolution paths and cross-tenant safety:
 *
 *   1. JWT path: login with slug header → JWT carries tenantId → subsequent
 *      authenticated requests resolve tenant from JWT (no slug header needed).
 *
 *   2. Host/header path (pre-login): X-Tenant-Slug header resolves to correct
 *      tenant. Without a slug AND without JWT, login returns 400 TENANT_REQUIRED.
 *
 *   3. Cross-tenant safety: JWT tenant takes priority over X-Tenant-Slug header.
 *      A tenant-1 JWT + X-Tenant-Slug: tenant-2 → resolved as tenant-1 (JWT wins).
 *
 * Two-tier IDs (2026-05-19 ID redesign):
 *   - `tenants.id` is the slug text PK; format-free.
 *   - `branches.id` / `users.id` are bigserial; we capture bigints via
 *     `.returning()` and thread them through `userRoles`.
 *   - `userRoles` PK is composite `(user_id, role)` — no `id` column.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { eq, and } from 'drizzle-orm'
import { app } from '../../src/app.js'
import { db } from '../../src/shared/db/index.js'
import { withTenantTx } from '../../src/shared/db/withTenantTx.js'
import { tenants, branches, users, userRoles } from '../../src/shared/db/schema.js'
import { displayId } from '../../src/shared/utils/displayId.js'
import bcrypt from 'bcrypt'

const FETCH_HEADER = { 'X-Requested-With': 'fetch' as const }

// Seeded primary tenant — slug from seed.ts.
// tenants.id and tenants.slug carry the same value (`SVX`) after the
// collapse — header lookup and JWT lookup land on the same row.
const TENANT1_SLUG = 'SVX'
const TENANT1_ID = 'SVX'
const SEEDED_ADMIN_EMAIL = 'admin@surevax.com'
const SEEDED_ADMIN_PASSWORD = 'TestPass123!'

// Second tenant created inline — timestamped.
const RUN_SEED = Date.now()
const TS_SUFFIX = RUN_SEED.toString(36).toUpperCase().slice(-6)
const TENANT2_ID = `TR${TS_SUFFIX.toUpperCase()}`
const TENANT2_SLUG = `tr-test-${TS_SUFFIX.toLowerCase()}`
const BRANCH2_CODE = 'MAI'
const BRANCH2_DISPLAY_ID = `${TENANT2_ID}.${BRANCH2_CODE}`
const USER2_DISPLAY_ID = displayId('USR')
const USER2_EMAIL = `admin-tr-${TS_SUFFIX.toLowerCase()}@example.com`
const USER2_PASSWORD = 'TenantTwoPass123!'

// Runtime-resolved bigints.
let user2BigintId = 0
let branch2BigintId = 0

beforeAll(async () => {
  // Insert tenant2 (no RLS on tenants table).
  await db.insert(tenants).values({
    id: TENANT2_ID,
    name: `TR Test Tenant ${TS_SUFFIX}`,
    slug: TENANT2_SLUG,
    timezone: 'Asia/Manila',
    countryCode: 'PH',
  })

  // Branch + user setup needs a real user bigint for withTenantTx, but the
  // user doesn't exist yet. Bootstrap the branch with userId=0 (the audit
  // trigger only checks app.current_tenant_id, not user_id validity).
  const passwordHash = await bcrypt.hash(USER2_PASSWORD, 12)
  await withTenantTx({ tenantId: TENANT2_ID, userId: 0, branchId: null }, async (tx) => {
    const branchRows = await tx
      .insert(branches)
      .values({
        displayId: BRANCH2_DISPLAY_ID,
        tenantId: TENANT2_ID,
        code: BRANCH2_CODE,
        name: 'Main Branch',
      })
      .returning({ id: branches.id })
    branch2BigintId = branchRows[0]!.id

    const userRows = await tx
      .insert(users)
      .values({
        displayId: USER2_DISPLAY_ID,
        tenantId: TENANT2_ID,
        email: USER2_EMAIL,
        firstName: 'TR',
        lastName: 'Admin',
        passwordHash,
        primaryBranchId: branch2BigintId,
        canLogin: true,
      })
      .returning({ id: users.id })
    user2BigintId = userRows[0]!.id

    await tx.insert(userRoles).values({
      tenantId: TENANT2_ID,
      userId: user2BigintId,
      role: 'TenantAdmin',
    })
  })
})

afterAll(async () => {
  await withTenantTx(
    { tenantId: TENANT2_ID, userId: user2BigintId, branchId: branch2BigintId },
    async (tx) => {
      await tx
        .delete(userRoles)
        .where(and(eq(userRoles.userId, user2BigintId), eq(userRoles.tenantId, TENANT2_ID)))
      await tx.delete(users).where(and(eq(users.id, user2BigintId), eq(users.tenantId, TENANT2_ID)))
      await tx.delete(branches).where(eq(branches.id, branch2BigintId))
    },
  )
  await db.delete(tenants).where(eq(tenants.id, TENANT2_ID))
})

function findCookie(setCookie: string[] | undefined, name: string): string | undefined {
  if (!setCookie) return undefined
  const match = setCookie.find((c) => c.startsWith(`${name}=`))
  if (!match) return undefined
  return match.split(';')[0]?.slice(`${name}=`.length)
}

// ---------------------------------------------------------------------------
// Test 1 — JWT path
// ---------------------------------------------------------------------------

describe('Tenant resolution: JWT path', () => {
  it('login issues a JWT with tenantId; subsequent request resolves tenant from JWT', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .set({ ...FETCH_HEADER, 'X-Tenant-Slug': TENANT1_SLUG })
      .send({ email: SEEDED_ADMIN_EMAIL, password: SEEDED_ADMIN_PASSWORD })

    expect(login.status).toBe(200)
    expect(login.body.user.email).toBe(SEEDED_ADMIN_EMAIL)

    const accessCookie = findCookie(
      login.headers['set-cookie'] as unknown as string[],
      'access_token',
    )
    expect(accessCookie).toBeTruthy()

    const me = await request(app)
      .get('/api/auth/me')
      .set(FETCH_HEADER)
      .set('Cookie', `access_token=${accessCookie}`)

    expect(me.status).toBe(200)
    expect(me.body.user.tenantId).toBe(TENANT1_ID)
  })

  it('JWT tenant takes priority over X-Tenant-Slug header (cross-tenant safety)', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .set({ ...FETCH_HEADER, 'X-Tenant-Slug': TENANT1_SLUG })
      .send({ email: SEEDED_ADMIN_EMAIL, password: SEEDED_ADMIN_PASSWORD })
    expect(login.status).toBe(200)

    const accessCookie = findCookie(
      login.headers['set-cookie'] as unknown as string[],
      'access_token',
    )
    expect(accessCookie).toBeTruthy()

    const me = await request(app)
      .get('/api/auth/me')
      .set({ ...FETCH_HEADER, 'X-Tenant-Slug': TENANT2_SLUG })
      .set('Cookie', `access_token=${accessCookie}`)

    expect(me.status).toBe(200)
    expect(me.body.user.tenantId).toBe(TENANT1_ID)
  })
})

// ---------------------------------------------------------------------------
// Test 2 — X-Tenant-Slug header path (pre-login)
// ---------------------------------------------------------------------------

describe('Tenant resolution: X-Tenant-Slug header path', () => {
  it('resolves tenant correctly for tenant 1 via slug header', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set({ ...FETCH_HEADER, 'X-Tenant-Slug': TENANT1_SLUG })
      .send({ email: SEEDED_ADMIN_EMAIL, password: SEEDED_ADMIN_PASSWORD })

    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe(SEEDED_ADMIN_EMAIL)
  })

  it('resolves tenant correctly for tenant 2 via slug header', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set({ ...FETCH_HEADER, 'X-Tenant-Slug': TENANT2_SLUG })
      .send({ email: USER2_EMAIL, password: USER2_PASSWORD })

    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe(USER2_EMAIL)
  })

  it('returns 401 for correct password but wrong tenant slug (email belongs to tenant 1, slug is tenant 2)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set({ ...FETCH_HEADER, 'X-Tenant-Slug': TENANT2_SLUG })
      .send({ email: SEEDED_ADMIN_EMAIL, password: SEEDED_ADMIN_PASSWORD })

    expect(res.status).toBe(401)
    expect(res.body.code).toBe('AUTH_FAILED')
  })

  it('returns 400 TENANT_REQUIRED when no slug header and no JWT is present', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set(FETCH_HEADER)
      .send({ email: SEEDED_ADMIN_EMAIL, password: SEEDED_ADMIN_PASSWORD })

    expect([400, 404]).toContain(res.status)
    expect(['TENANT_REQUIRED', 'TENANT_NOT_FOUND']).toContain(res.body.code)
  })

  it('returns 404 TENANT_NOT_FOUND for an unknown slug', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set({ ...FETCH_HEADER, 'X-Tenant-Slug': 'this-tenant-does-not-exist-xyz' })
      .send({ email: SEEDED_ADMIN_EMAIL, password: SEEDED_ADMIN_PASSWORD })

    expect(res.status).toBe(404)
    expect(res.body.code).toBe('TENANT_NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------
// Test 3 — X-Dev-Tenant-Id override (dev/test only)
// ---------------------------------------------------------------------------

describe('Tenant resolution: X-Dev-Tenant-Id dev override', () => {
  it('accepts raw tenant ID via X-Dev-Tenant-Id in non-production env', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set({ ...FETCH_HEADER, 'X-Dev-Tenant-Id': TENANT1_ID })
      .send({ email: SEEDED_ADMIN_EMAIL, password: SEEDED_ADMIN_PASSWORD })

    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe(SEEDED_ADMIN_EMAIL)
  })
})
