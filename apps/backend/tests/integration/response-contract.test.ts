import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { app } from '../../src/app.js'

// Prevention gate — bug class: "schema↔frontend response-shape drift"
// (audit FE-ENV-1/2/3; the recurring "bare array vs {data} envelope" class
// that appeared in every audit since 2026-05-17).
//
// Backend list endpoints return EITHER a bare JSON array OR a {data, ...sidecar}
// envelope. Each frontend features/<x>/api.ts consumes one shape verbatim. If
// the backend flips shape, the matching page renders empty with NO typecheck
// error — neither the frontend nor the backend test suite crosses the boundary,
// so only an audit ever caught it. This test LOCKS the backend half of the
// contract: a shape flip fails CI.
//
// The frontend half (does the hook unwrap correctly) is documented in
// .claude/rules/gotchas.md "List response is a bare array" — this manifest is
// the machine-checked source of truth the frontend must follow.

const FETCH_HEADER = {
  'X-Requested-With': 'fetch' as const,
  'X-Tenant-Slug': 'SVX' as const,
}

// shape 'array'    → res.body must be a JSON array (read `await res.json()` directly)
// shape 'envelope' → res.body must be a non-array object carrying `data`
const LIST_CONTRACT: { path: string; shape: 'array' | 'envelope' }[] = [
  // Envelope endpoints — sidecars (cursor / stats / summary) travel with rows.
  { path: '/api/patients', shape: 'envelope' },
  { path: '/api/inventory', shape: 'envelope' },
  { path: '/api/transactions', shape: 'envelope' },
  { path: '/api/services', shape: 'envelope' },
  { path: '/api/scheduled-orders', shape: 'envelope' },
  { path: '/api/encounters', shape: 'envelope' },
  { path: '/api/payer-profiles', shape: 'envelope' }, // verified empirically: {data} envelope
  // Bare-array endpoints — frontend reads the array directly, no `.data` unwrap.
  { path: '/api/adverse-events', shape: 'array' },
  { path: '/api/bite-incidents', shape: 'array' },
  { path: '/api/product-recalls', shape: 'array' },
  { path: '/api/appointments', shape: 'array' },
  { path: '/api/inventory-transfers', shape: 'array' },
]

function findCookie(setCookie: string[] | undefined, name: string): string | undefined {
  if (!setCookie) return undefined
  const match = setCookie.find((c) => c.startsWith(`${name}=`))
  return match?.split(';')[0]?.slice(`${name}=`.length)
}

describe('list-endpoint response contract', () => {
  let accessCookie: string | undefined

  beforeAll(async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .set(FETCH_HEADER)
      .send({ email: 'admin@surevax.com', password: 'TestPass123!' })
    expect(login.status).toBe(200)
    accessCookie = findCookie(login.headers['set-cookie'] as unknown as string[], 'access_token')
    expect(accessCookie).toBeTruthy()
  })

  it.each(LIST_CONTRACT)('GET $path returns a $shape', async ({ path, shape }) => {
    const res = await request(app)
      .get(path)
      .set('Cookie', `access_token=${accessCookie}`)
      .set(FETCH_HEADER)

    expect(res.status, `${path} → ${res.status}: ${JSON.stringify(res.body).slice(0, 160)}`).toBe(
      200,
    )

    if (shape === 'array') {
      expect(Array.isArray(res.body), `${path} must be a BARE ARRAY, got object`).toBe(true)
    } else {
      expect(Array.isArray(res.body), `${path} must be a {data} ENVELOPE, got array`).toBe(false)
      expect(res.body, `${path} envelope must carry 'data'`).toHaveProperty('data')
    }
  })
})
