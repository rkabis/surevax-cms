import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { app } from '../src/app.js'

// Pre-login requests resolve the tenant via X-Tenant-Slug. JWT-authenticated
// requests ignore the slug header (JWT claim wins), so sending it on every
// request is safe.
const FETCH_HEADER = {
  'X-Requested-With': 'fetch' as const,
  'X-Tenant-Slug': 'SVX' as const,
}

function findCookie(setCookie: string[] | undefined, name: string): string | undefined {
  if (!setCookie) return undefined
  const match = setCookie.find((c) => c.startsWith(`${name}=`))
  if (!match) return undefined
  return match.split(';')[0]?.slice(`${name}=`.length)
}

async function loginAsAdmin(): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .set(FETCH_HEADER)
    .send({ email: 'admin@surevax.com', password: 'TestPass123!' })
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`)
  }
  const cookie = findCookie(res.headers['set-cookie'] as unknown as string[], 'access_token')
  if (!cookie) throw new Error('login response did not set access_token')
  return cookie
}

describe('GET /api/inventory — FEFO ordering', () => {
  it('returns lots ordered by expiry date ascending (First-Expired-First-Out)', async () => {
    const accessToken = await loginAsAdmin()

    const res = await request(app)
      .get('/api/inventory')
      .set('Cookie', `access_token=${accessToken}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.data.length).toBeGreaterThanOrEqual(2)

    const expiries = res.body.data.map((lot: { expiryDate: string }) => lot.expiryDate)
    const sorted = [...expiries].sort()
    // ISO date strings (YYYY-MM-DD) sort identically lexicographically and chronologically.
    expect(expiries).toEqual(sorted)
  })

  it('the same FEFO order persists when filtered to expiring_soon', async () => {
    const accessToken = await loginAsAdmin()

    const res = await request(app)
      .get('/api/inventory?filter=expiring_soon')
      .set('Cookie', `access_token=${accessToken}`)

    expect(res.status).toBe(200)
    const expiries = res.body.data.map((lot: { expiryDate: string }) => lot.expiryDate)
    const sorted = [...expiries].sort()
    expect(expiries).toEqual(sorted)
  })
})
