import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { app } from '../src/app.js'

// Phase 2: every request needs tenant context. Pre-login endpoints
// (login, refresh) read X-Tenant-Slug; post-login the JWT carries the
// tenant claim and the slug header is ignored. The seeded tenant uses
// slug 'SVX' (`tenants.id` and `tenants.slug` carry the same value). Bake
// it into FETCH_HEADER so refresh-flow tests that operate on bare cookies
// inherit it automatically.
const FETCH_HEADER = {
  'X-Requested-With': 'fetch' as const,
  'X-Tenant-Slug': 'SVX' as const,
}
const TENANT_HEADER = { 'X-Tenant-Slug': 'SVX' as const }

function findCookie(setCookie: string[] | undefined, name: string): string | undefined {
  if (!setCookie) return undefined
  const match = setCookie.find((c) => c.startsWith(`${name}=`))
  if (!match) return undefined
  return match.split(';')[0]?.slice(`${name}=`.length)
}

describe('POST /api/auth/login', () => {
  it('issues access + refresh cookies for valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set({ ...FETCH_HEADER, ...TENANT_HEADER })
      .send({ email: 'admin@surevax.com', password: 'TestPass123!' })

    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe('admin@surevax.com')
    expect(res.body.user.role).toBe('TenantAdmin')

    const cookies = res.headers['set-cookie'] as unknown as string[]
    expect(findCookie(cookies, 'access_token')).toBeTruthy()
    expect(findCookie(cookies, 'refresh_token')).toBeTruthy()
  })

  it('returns 401 with AUTH_FAILED for a wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set({ ...FETCH_HEADER, ...TENANT_HEADER })
      .send({ email: 'admin@surevax.com', password: 'NotTheRealPassword!' })

    expect(res.status).toBe(401)
    expect(res.body.code).toBe('AUTH_FAILED')
  })

  it('returns 400 with VALIDATION_ERROR for malformed input', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set({ ...FETCH_HEADER, ...TENANT_HEADER })
      .send({ email: 'not-an-email', password: '' })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VALIDATION_ERROR')
  })
})

describe('GET /api/auth/me', () => {
  it('returns the current user when an access cookie is present', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .set({ ...FETCH_HEADER, ...TENANT_HEADER })
      .send({ email: 'admin@surevax.com', password: 'TestPass123!' })
    const accessCookie = findCookie(
      login.headers['set-cookie'] as unknown as string[],
      'access_token',
    )

    const me = await request(app).get('/api/auth/me').set('Cookie', `access_token=${accessCookie}`)

    expect(me.status).toBe(200)
    expect(me.body.user.email).toBe('admin@surevax.com')
  })

  it('returns 401 without a cookie', async () => {
    const res = await request(app).get('/api/auth/me')
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('AUTH_REQUIRED')
  })
})

describe('POST /api/auth/refresh — rotation + reuse detection', () => {
  it('rotates the refresh token on success and revokes the family on reuse', async () => {
    // Step 1: log in to get an initial refresh token.
    const login = await request(app)
      .post('/api/auth/login')
      .set({ ...FETCH_HEADER, ...TENANT_HEADER })
      .send({ email: 'admin@surevax.com', password: 'TestPass123!' })
    expect(login.status).toBe(200)
    const oldRefresh = findCookie(
      login.headers['set-cookie'] as unknown as string[],
      'refresh_token',
    )
    expect(oldRefresh).toBeTruthy()

    // Step 2: rotate. Old token is consumed; response carries a new refresh cookie.
    const rotated = await request(app)
      .post('/api/auth/refresh')
      .set(FETCH_HEADER)
      .set('Cookie', `refresh_token=${oldRefresh}`)
    expect(rotated.status).toBe(200)
    const newRefresh = findCookie(
      rotated.headers['set-cookie'] as unknown as string[],
      'refresh_token',
    )
    expect(newRefresh).toBeTruthy()
    expect(newRefresh).not.toBe(oldRefresh)

    // Step 3: replay the OLD token. The reuse-detection branch must fire
    // and return TOKEN_REUSED. This is the security finding #5 invariant.
    const replay = await request(app)
      .post('/api/auth/refresh')
      .set(FETCH_HEADER)
      .set('Cookie', `refresh_token=${oldRefresh}`)
    expect(replay.status).toBe(401)
    expect(replay.body.code).toBe('TOKEN_REUSED')

    // Step 4: the new (rotated) token is now also unusable — its family
    // was revoked when reuse was detected.
    const afterFamilyRevoke = await request(app)
      .post('/api/auth/refresh')
      .set(FETCH_HEADER)
      .set('Cookie', `refresh_token=${newRefresh}`)
    expect(afterFamilyRevoke.status).toBe(401)
    expect(afterFamilyRevoke.body.code).toBe('TOKEN_REUSED')
  })
})
