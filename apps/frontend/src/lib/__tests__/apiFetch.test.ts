import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { delay, http, HttpResponse } from 'msw'
import { apiFetch, ApiError } from '../apiFetch'
import { server } from '@/test-utils/msw-handlers'

/**
 * The shared fetch wrapper every feature api.ts imports. Its contract:
 *   - always sends the X-Requested-With: fetch CSRF header
 *   - on 401, refreshes once (shared single-flight) then retries
 *   - throws ApiError (statusCode + code) on a non-2xx that isn't a 401
 *
 * Concurrency note: N parallel 401s must collapse to ONE /api/auth/refresh —
 * the server rotates the refresh-token family per call, so racing refreshes
 * would burn each other and force a premature logout (apiFetch.ts H13).
 */

let refreshCalls = 0

beforeEach(() => {
  refreshCalls = 0
  window.history.pushState({}, '', '/app')
})

afterEach(() => {
  window.history.pushState({}, '', '/app')
})

describe('apiFetch', () => {
  it('returns parsed JSON on success', async () => {
    server.use(http.get('/api/thing', () => HttpResponse.json({ hello: 'world' })))
    await expect(apiFetch('/api/thing')).resolves.toEqual({ hello: 'world' })
  })

  it('sends the X-Requested-With CSRF header on every request', async () => {
    let seen: string | null = 'MISSING'
    server.use(
      http.post('/api/thing', ({ request }) => {
        seen = request.headers.get('x-requested-with')
        return HttpResponse.json({ ok: true })
      }),
    )
    await apiFetch('/api/thing', { method: 'POST' })
    expect(seen).toBe('fetch')
  })

  it('throws ApiError with statusCode + code on a non-401 error', async () => {
    server.use(
      http.get('/api/thing', () =>
        HttpResponse.json({ error: 'nope', code: 'FORBIDDEN' }, { status: 403 }),
      ),
    )
    await expect(apiFetch('/api/thing')).rejects.toMatchObject({
      name: 'ApiError',
      statusCode: 403,
      code: 'FORBIDDEN',
    })
    await expect(apiFetch('/api/thing')).rejects.toBeInstanceOf(ApiError)
  })

  it('refreshes once on 401 then retries the original request', async () => {
    let thingCalls = 0
    server.use(
      http.get('/api/thing', () => {
        thingCalls += 1
        return thingCalls === 1
          ? new HttpResponse(null, { status: 401 })
          : HttpResponse.json({ recovered: true })
      }),
      http.post('/api/auth/refresh', () => {
        refreshCalls += 1
        return HttpResponse.json({ ok: true })
      }),
    )

    await expect(apiFetch('/api/thing')).resolves.toEqual({ recovered: true })
    expect(refreshCalls).toBe(1)
    expect(thingCalls).toBe(2)
  })

  it('keeps typed staff PIN failures at action level instead of refreshing the session', async () => {
    server.use(
      http.post('/api/action', () =>
        HttpResponse.json(
          { error: 'Incorrect PIN.', code: 'ATTESTATION_PIN_INVALID' },
          { status: 401 },
        ),
      ),
      http.post('/api/auth/refresh', () => {
        refreshCalls += 1
        return HttpResponse.json({ ok: true })
      }),
    )

    await expect(apiFetch('/api/action', { method: 'POST' })).rejects.toMatchObject({
      name: 'ApiError',
      statusCode: 401,
      code: 'ATTESTATION_PIN_INVALID',
    })
    expect(refreshCalls).toBe(0)
    expect(window.location.pathname).toBe('/app')
  })

  it('collapses concurrent 401s into a single shared refresh (single-flight)', async () => {
    server.use(
      http.get('/api/thing', () => new HttpResponse(null, { status: 401 })),
      http.post('/api/auth/refresh', async () => {
        refreshCalls += 1
        await delay(25) // widen the in-flight window so both callers share it
        return HttpResponse.json({ ok: true })
      }),
    )

    // Both 401, both refresh — but the promise is shared, so only ONE POST.
    const results = await Promise.allSettled([apiFetch('/api/thing'), apiFetch('/api/thing')])
    expect(results.every((r) => r.status === 'rejected')).toBe(true) // retry still 401
    expect(refreshCalls).toBe(1)
  })

  it('throws SESSION_EXPIRED when the refresh itself fails', async () => {
    // Run on /login so apiFetch skips the hard `location.href` redirect (jsdom
    // does not implement navigation); the throw + single refresh are what matter.
    window.history.pushState({}, '', '/login')
    server.use(
      http.get('/api/thing', () => new HttpResponse(null, { status: 401 })),
      http.post('/api/auth/refresh', () => {
        refreshCalls += 1
        return new HttpResponse(null, { status: 401 })
      }),
    )

    await expect(apiFetch('/api/thing')).rejects.toThrow('SESSION_EXPIRED')
    expect(refreshCalls).toBe(1)
  })
})
