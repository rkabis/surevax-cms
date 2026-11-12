/**
 * useRecentList — shared hook for search-first records browse (Pattern 24).
 *
 * Default = most recent `pageSize` rows (default 50).
 * Debounced search filters via backend query params.
 * "Load older" button advances cursor manually — no auto-scroll.
 * Total badge comes from X-Total-Count response header.
 *
 * Uses raw fetch (not apiFetch) so we can read response headers.
 * Sends credentials + CSRF header on every request (same as apiFetch).
 *
 * Backend requirements: list endpoints must emit `X-Total-Count` and
 * (when more pages exist) `X-Next-Cursor` response headers. The body may
 * be a bare JSON array OR a `{ data: TRow[] }` envelope — both are handled.
 *
 * Canonical caller pattern:
 * ```ts
 * const { rows, totalCount, hasMore, loadMore, isLoading } = useRecentList<Patient>({
 *   endpoint: '/api/patients',
 *   query: { q: searchTerm },
 *   queryKey: ['patients', searchTerm],
 *   pageSize: 50,
 * })
 * ```
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { API_BASE_URL, STANDARD_API_HEADERS } from '@/lib/api-base'

export type RecentListOpts = {
  endpoint: string // '/api/<resource>'
  query?: Record<string, string | undefined> // additional filter params
  pageSize?: number // default 50
  enabled?: boolean
  /**
   * React Query-style cache key. Included in the internal stable serialisation
   * so the hook resets when filters change. Must contain all variables that
   * affect `endpoint` or `query`. E.g. `['patients', searchTerm]`.
   */
  queryKey: readonly unknown[]
}

export type RecentListResult<TRow> = {
  rows: TRow[]
  totalCount: number | null // from X-Total-Count header
  hasMore: boolean
  isLoading: boolean
  isError: boolean
  error: unknown
  loadMore: () => void
  reset: () => void
}

async function fetchPage<TRow>(
  endpoint: string,
  query: Record<string, string | undefined>,
  pageSize: number,
  cursor: string | null,
): Promise<{ rows: TRow[]; nextCursor: string | null; totalCount: number | null }> {
  const params = new URLSearchParams()
  params.set('limit', String(pageSize))
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') params.set(k, v)
  }
  if (cursor) params.set('cursor', cursor)

  const url = `${API_BASE_URL}${endpoint}?${params}`

  const doFetch = async (signal?: AbortSignal) => {
    return fetch(url, {
      credentials: 'include',
      signal,
      headers: { ...STANDARD_API_HEADERS },
    })
  }

  let res = await doFetch()

  if (res.status === 401) {
    // Token refresh (mirrors apiFetch logic)
    const refreshRes = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: STANDARD_API_HEADERS,
    })
    if (!refreshRes.ok) throw new Error('SESSION_EXPIRED')
    res = await doFetch()
  }

  if (!res.ok) throw new Error(`API error: ${res.status}`)

  // X-Total-Count: total matching rows (ignoring cursor/limit), set by backend
  const totalHeader = res.headers.get('X-Total-Count')
  const totalCount = totalHeader !== null ? parseInt(totalHeader, 10) : null

  // X-Next-Cursor: opaque base64 cursor from backend (preferred source)
  const nextCursorHeader = res.headers.get('X-Next-Cursor')

  const body = (await res.json()) as unknown

  // Support both bare-array and {data[, nextCursor]} envelope shapes.
  // X-Next-Cursor header takes priority over body.nextCursor (patients legacy).
  let rows: TRow[]
  let nextCursor: string | null = nextCursorHeader ?? null

  if (Array.isArray(body)) {
    rows = body as TRow[]
  } else if (body && typeof body === 'object' && 'data' in body) {
    const obj = body as { data: TRow[]; nextCursor?: string | null }
    rows = obj.data
    // Fall back to body.nextCursor only when header not present (legacy patients shape)
    if (nextCursor === null) nextCursor = obj.nextCursor ?? null
  } else {
    rows = []
  }

  return { rows, nextCursor, totalCount }
}

/**
 * The FIRST page is a real React Query entry under `queryKey`; "load older"
 * pages are appended in local state.
 *
 * This split exists because the hook used to be pure `useState`/`useEffect`
 * with no React Query entry at all — so `invalidateQueries(['approvals'])`,
 * `(['notifications'])`, `(['attendance'])` and `(['audit'])` were **silent
 * no-ops**. Four admin surfaces never refreshed after a write: approve
 * something and the list sat there unchanged. `invalidateQueries` can only
 * act on cache entries that exist, so the fix has to register one.
 *
 * Consequence worth knowing: when the first page refetches (invalidation,
 * remount, filter change), accumulated older pages are dropped and the list
 * returns to "most recent `pageSize`". That is deliberate — keeping stale
 * appended pages around a freshly-refetched head is how you get duplicated
 * and out-of-order rows.
 */
export function useRecentList<TRow>(opts: RecentListOpts): RecentListResult<TRow> {
  const { endpoint, query = {}, pageSize = 50, enabled = true, queryKey: callerQueryKey } = opts

  type Page = { rows: TRow[]; nextCursor: string | null; totalCount: number | null }

  const head = useQuery<Page>({
    queryKey: callerQueryKey,
    queryFn: () => fetchPage<TRow>(endpoint, query, pageSize, null),
    enabled,
    staleTime: 30_000,
  })

  // Pages fetched by "load older", newest-first order preserved.
  const [olderPages, setOlderPages] = useState<Page[]>([])
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<unknown>(null)

  // Drop accumulated pages whenever the head is replaced (refetch or new key).
  const headStamp = `${JSON.stringify(callerQueryKey)}:${head.dataUpdatedAt}`
  const prevStamp = useRef(headStamp)
  useEffect(() => {
    if (prevStamp.current === headStamp) return
    prevStamp.current = headStamp
    setOlderPages([])
    setMoreError(null)
  }, [headStamp])

  const lastPage = olderPages.length > 0 ? olderPages[olderPages.length - 1] : head.data
  const cursor = lastPage?.nextCursor ?? null

  const rows = useMemo(
    () => [...(head.data?.rows ?? []), ...olderPages.flatMap((p) => p.rows)],
    [head.data, olderPages],
  )

  // Prefer the most recently reported count — later pages carry a fresher one.
  const totalCount =
    [...olderPages].reverse().find((p) => p.totalCount !== null)?.totalCount ??
    head.data?.totalCount ??
    null

  const loadMore = useCallback(() => {
    if (!cursor || isLoadingMore) return
    setIsLoadingMore(true)
    setMoreError(null)
    fetchPage<TRow>(endpoint, query, pageSize, cursor)
      .then((page) => setOlderPages((prev) => [...prev, page]))
      .catch((err) => setMoreError(err))
      .finally(() => setIsLoadingMore(false))
    // `query` is an object literal at most call sites; callerQueryKey is the
    // documented carrier for anything that affects it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, isLoadingMore, endpoint, pageSize, JSON.stringify(callerQueryKey)])

  const reset = useCallback(() => {
    setOlderPages([])
    setMoreError(null)
  }, [])

  return {
    rows,
    totalCount,
    hasMore: cursor !== null,
    isLoading: head.isLoading || isLoadingMore,
    isError: head.isError || moreError !== null,
    error: head.error ?? moreError,
    loadMore,
    reset,
  }
}
