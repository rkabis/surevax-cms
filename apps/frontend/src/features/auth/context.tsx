import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { API_BASE_URL, STANDARD_API_HEADERS } from '@/lib/api-base'
import { getRefresh } from '@/lib/apiFetch'

export type AuthUser = {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  branchId: string | null
  /** 3-letter branch code (e.g. "HST") — populated from JWT claim. Null for
   *  platform admins or users with no primary branch. */
  branchCode?: string | null
  /** Resolved branch name (e.g. "Holy Spirit"). Null for platform admins / unbound users. */
  branchName?: string | null
  /** Resolved branch street address. Null if no primary branch / address unset. */
  branchAddress?: string | null
  /** Resolved branch contact number. Null if no primary branch / contact unset. */
  branchContactNumber?: string | null
  isPlatformAdmin?: boolean
}

type AuthContextValue = {
  user: AuthUser | null
  isLoading: boolean
  setUser: (user: AuthUser | null) => void
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function fetchMe(): Promise<Response> {
  return fetch(`${API_BASE_URL}/api/auth/me`, {
    credentials: 'include',
    headers: STANDARD_API_HEADERS,
  })
}

/**
 * Resolve the current user on app bootstrap, tolerant of a lapsed access token
 * and transient rate-limit / server blips. Returns the user, or null only when
 * the caller is genuinely unauthenticated (→ /login).
 *
 *   - 200 → the user. Backend returns `{ user: AuthUser }` (matches the login
 *     response shape); unwrap the envelope so context never holds the wrapper
 *     (else AppShell crashes reading `user.firstName[0]` off it).
 *   - 401 → access token missing or expired. Attempt ONE shared refresh
 *     (single-flight, deduped with data-query refreshes) and retry /me once. A
 *     genuinely unauthenticated caller (no/expired refresh token) falls through
 *     to null. Previously any 401 logged the user straight out, so an operator
 *     whose 15-minute access token lapsed while idle got bounced to /login on
 *     the next mount instead of silently refreshing.
 *   - 429 / 5xx → transient (a request burst tripping the per-IP rate limiter,
 *     or a server hiccup). Retry with backoff rather than dropping the session;
 *     treating a rate-limit blip as "logged out" bounced valid operators — and
 *     shared-IP request bursts — to /login for no reason.
 */
// Login surfaces where a 401 on /me is expected (no session yet) — attempting a
// refresh there is pure waste and burns the tight credential-endpoint limiter
// (login/refresh/verify-pin share one 10/min-per-IP bucket).
const LOGIN_PATHS = new Set(['/login', '/operator/login'])

async function fetchAuthUser(): Promise<AuthUser | null> {
  let res = await fetchMe()

  // Only attempt a refresh when loading a protected surface: there a 401 means
  // an access token that lapsed while a valid refresh token likely persists. On
  // a login page a 401 just means "not signed in" — refreshing is wasteful.
  if (res.status === 401 && !LOGIN_PATHS.has(window.location.pathname)) {
    const refreshed = await getRefresh()
    if (refreshed.ok) res = await fetchMe()
  }

  for (let attempt = 0; (res.status === 429 || res.status >= 500) && attempt < 2; attempt++) {
    await sleep(400 * (attempt + 1))
    res = await fetchMe()
  }

  if (!res.ok) return null
  const data = (await res.json()) as { user: AuthUser } | null
  return data?.user ?? null
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const queryClient = useQueryClient()

  useEffect(() => {
    let cancelled = false
    fetchAuthUser()
      .then((resolved) => {
        if (!cancelled) setUser(resolved)
      })
      .catch(() => {
        if (!cancelled) setUser(null)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const logout = useCallback(async () => {
    await fetch(`${API_BASE_URL}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: STANDARD_API_HEADERS,
    })
    setUser(null)
    queryClient.clear()
    // Clear app-scoped storage so the next user on a shared kiosk doesn't
    // see the previous user's wizard draft / day-open ack / nav state.
    // Critical: prevents PHI leak (free-text chief-complaint) across sessions.
    try {
      for (const storage of [sessionStorage, localStorage]) {
        const keysToRemove: string[] = []
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i)
          if (
            key &&
            (key.startsWith('surevax.') || key.startsWith('branch.') || key.startsWith('sv.'))
          ) {
            keysToRemove.push(key)
          }
        }
        keysToRemove.forEach((k) => storage.removeItem(k))
      }
    } catch {
      // Storage unavailable; ignore.
    }
  }, [queryClient])

  return (
    <AuthContext.Provider value={{ user, isLoading, setUser, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
