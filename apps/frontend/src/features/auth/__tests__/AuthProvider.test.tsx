import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { cleanup, screen } from '@testing-library/react'
import { renderWithProviders } from '@/test-utils/render'
import { server } from '@/test-utils/msw-handlers'
import { AuthProvider, useAuth } from '../context'

/**
 * Regression guard for the auth bootstrap resilience fix (2026-07-06).
 *
 * `AuthProvider`'s /api/auth/me probe must NOT treat every non-OK response as
 * "logged out". A 401 (lapsed 15-minute access token) should trigger a refresh
 * then retry; a transient 429 (a request burst tripping the per-IP rate limiter)
 * should back off and retry — never drop a valid session. The naive
 * `r.ok ? r.json() : null` bounced valid operators — and the shared-IP E2E
 * suite — to /login. See gotchas.md "Auth bootstrap must not treat transient
 * failures as logout".
 */

function Probe() {
  const { user, isLoading } = useAuth()
  if (isLoading) return <div>loading…</div>
  return <div data-testid="who">{user ? user.email : 'ANON'}</div>
}

const renderAuth = () => renderWithProviders(<AuthProvider>{<Probe />}</AuthProvider>)

const userBody = (email: string) => ({
  user: {
    id: 1,
    email,
    firstName: 'Test',
    lastName: 'User',
    role: 'Branch',
    tenantId: 'SVX',
    branchId: 1,
    branchCode: 'HST',
    isPlatformAdmin: false,
  },
})

let refreshCalls = 0

beforeEach(() => {
  refreshCalls = 0
  window.history.pushState({}, '', '/')
})

afterEach(() => {
  cleanup()
  window.history.pushState({}, '', '/')
})

describe('AuthProvider bootstrap', () => {
  it('sets the user when /me returns 200', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json(userBody('ok@surevax.com'))))
    renderAuth()
    expect(await screen.findByTestId('who')).toHaveTextContent('ok@surevax.com')
  })

  it('refreshes then retries /me on a 401 (lapsed access token)', async () => {
    let meCalls = 0
    server.use(
      http.get('/api/auth/me', () => {
        meCalls += 1
        return meCalls === 1
          ? new HttpResponse(null, { status: 401 })
          : HttpResponse.json(userBody('refreshed@surevax.com'))
      }),
      http.post('/api/auth/refresh', () => {
        refreshCalls += 1
        return HttpResponse.json({ ok: true })
      }),
    )

    renderAuth()

    expect(await screen.findByTestId('who')).toHaveTextContent('refreshed@surevax.com')
    expect(refreshCalls).toBe(1)
    expect(meCalls).toBe(2)
  })

  it('logs out only after the refresh itself fails', async () => {
    server.use(
      http.get('/api/auth/me', () => new HttpResponse(null, { status: 401 })),
      http.post('/api/auth/refresh', () => {
        refreshCalls += 1
        return new HttpResponse(null, { status: 401 })
      }),
    )

    renderAuth()

    expect(await screen.findByTestId('who')).toHaveTextContent('ANON')
    expect(refreshCalls).toBe(1)
  })

  it('tolerates a transient 429 without dropping the session (the E2E flake)', async () => {
    let meCalls = 0
    server.use(
      http.get('/api/auth/me', () => {
        meCalls += 1
        return meCalls === 1
          ? new HttpResponse(null, { status: 429 })
          : HttpResponse.json(userBody('survived@surevax.com'))
      }),
      // A 429 must NOT trigger a refresh — it is not an auth failure.
      http.post('/api/auth/refresh', () => {
        refreshCalls += 1
        return HttpResponse.json({ ok: true })
      }),
    )

    renderAuth()

    expect(await screen.findByTestId('who')).toHaveTextContent('survived@surevax.com')
    expect(refreshCalls).toBe(0)
    expect(meCalls).toBe(2)
  })

  it('does not waste a refresh on the login route (401 there is expected)', async () => {
    window.history.pushState({}, '', '/login')
    server.use(
      http.get('/api/auth/me', () => new HttpResponse(null, { status: 401 })),
      http.post('/api/auth/refresh', () => {
        refreshCalls += 1
        return HttpResponse.json({ ok: true })
      }),
    )

    renderAuth()

    expect(await screen.findByTestId('who')).toHaveTextContent('ANON')
    expect(refreshCalls).toBe(0)
  })
})
