import { API_BASE_URL, STANDARD_API_HEADERS } from '@/lib/api-base'

// ── ApiError ──────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function asApiError(res: Response): Promise<ApiError> {
  let body: { error?: string; message?: string; code?: string } = {}
  try {
    body = (await res.json()) as { error?: string; message?: string; code?: string }
  } catch {
    // ignore json parse failures
  }
  const message = body.message ?? body.error ?? `API error: ${res.status}`
  return new ApiError(message, res.status, body.code)
}

// ── apiFetch ──────────────────────────────────────────────────────────────────
//
// Canonical shared fetch util for all frontend feature api.ts files.
//
// Behaviors:
//   - Sends `credentials: 'include'` so cookies (access_token, refresh_token)
//     flow on every request.
//   - Sends `X-Requested-With: fetch` on every request (CSRF requirement — the
//     backend middleware at `shared/middleware/csrf.ts` rejects POST/PUT/PATCH/
//     DELETE without this header).
//   - On 401, calls `/api/auth/refresh` once, then retries the original request.
//   - Throws `ApiError` (with statusCode + optional code) on non-2xx responses.

// H13: single in-flight refresh promise. When N parallel queries 401 at
// once (PatientDetail fires 5+), all share the same refresh call instead
// of racing N independent POSTs to /api/auth/refresh. Server-side rotation
// invalidates the previous refresh-token family on each call — without
// this dedup, only one parallel refresh wins and the rest force a
// premature SESSION_EXPIRED redirect.
let refreshPromise: Promise<Response> | null = null

// Exported so the auth-context bootstrap (`/api/auth/me` probe on load) shares
// the SAME in-flight refresh as data queries. Without a shared promise, a page
// mount that fires `/me` alongside its data queries would race N refreshes; the
// server rotates the refresh-token family on each call, so all but one lose and
// force a premature logout. One shared promise keeps the whole app on a single
// refresh per 401 cycle.
export function getRefresh(): Promise<Response> {
  if (refreshPromise) return refreshPromise
  const p = fetch(`${API_BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: STANDARD_API_HEADERS,
  })
  refreshPromise = p
  // Clear on settle so the NEXT 401 cycle can refresh again.
  p.finally(() => {
    if (refreshPromise === p) refreshPromise = null
  })
  return p
}

export async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}${path}`
  const res = await fetch(url, {
    credentials: 'include',
    ...opts,
    headers: { ...STANDARD_API_HEADERS, ...(opts?.headers as Record<string, string>) },
  })
  if (res.status === 401) {
    // Action-level staff attestation is not web-session authentication. New
    // servers return these typed failures as 4xx validation errors, but keep
    // this guard for mixed-version deployments so a wrong kiosk PIN can never
    // trigger token refresh/logout and discard the open action dialog.
    const actionError = await typedActionError(res)
    if (actionError) throw actionError

    // Attempt token refresh — shared across all parallel 401s.
    const refreshRes = await getRefresh()
    if (!refreshRes.ok) {
      // Redirect to login, preserving the current URL so the user can
      // return after re-authenticating. Skip if already on /login.
      if (window.location.pathname !== '/login') {
        const returnTo = encodeURIComponent(window.location.pathname + window.location.search)
        window.location.href = `/login?returnTo=${returnTo}`
      }
      throw new Error('SESSION_EXPIRED')
    }
    const retry = await fetch(url, {
      credentials: 'include',
      ...opts,
      headers: { ...STANDARD_API_HEADERS, ...(opts?.headers as Record<string, string>) },
    })
    if (!retry.ok) throw await asApiError(retry)
    return parseJsonBody<T>(retry)
  }
  if (!res.ok) throw await asApiError(res)
  return parseJsonBody<T>(res)
}

async function typedActionError(res: Response): Promise<ApiError | null> {
  try {
    const body = (await res.clone().json()) as { error?: string; message?: string; code?: string }
    if (!body.code?.startsWith('ATTESTATION_')) return null
    return new ApiError(
      body.message ?? body.error ?? 'Staff attestation failed',
      res.status,
      body.code,
    )
  } catch {
    return null
  }
}

// 204 No Content (and any other empty body) has nothing for res.json() to
// parse — it throws a SyntaxError, which silently breaks callers expecting
// `void` (e.g. a DELETE mutation's onSuccess/cache-invalidation never runs).
function parseJsonBody<T>(res: Response): Promise<T> {
  if (res.status === 204) return Promise.resolve(undefined as T)
  return res.json() as Promise<T>
}
