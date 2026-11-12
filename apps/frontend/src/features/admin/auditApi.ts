import { useQuery } from '@tanstack/react-query'
import { API_BASE_URL, STANDARD_API_HEADERS } from '@/lib/api-base'
import { useRecentList, type RecentListResult } from '@/lib/useRecentList'

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'TRANSACTION_MODIFY'
  | 'SCHEDULE_CHANGE'
  | 'CROSS_BRANCH_ACCESS'

export type AuditEntry = {
  id: string
  action: AuditAction
  entityType: string
  entityId: string | null
  sessionId: string | null
  correlationId: string | null
  /** @deprecated Use `actor` for structured rendering; kept for backward compat */
  userName: string
  /** Structured actor for <UserLabel> rendering */
  actor: {
    displayId: string
    firstName: string
    lastName: string
  } | null
  description: string
  ipAddress: string | null
  metadata: unknown
  timestamp: string
}

export type AuditEntryDetail = {
  id: string
  action: AuditAction
  entityType: string
  entityId: string | null
  sessionId: string | null
  correlationId: string | null
  timestamp: string
  ipAddress: string | null
  userAgent: string | null
  changes: unknown
  metadata: unknown
  user: {
    id: string
    firstName: string | null
    lastName: string | null
    email: string | null
    role: string | null
  } | null
  branch: {
    id: string
    name: string | null
  } | null
}

async function apiFetch(path: string, opts?: RequestInit) {
  const url = `${API_BASE_URL}${path}`
  const res = await fetch(url, {
    credentials: 'include',
    ...opts,
    headers: { ...STANDARD_API_HEADERS, ...(opts?.headers as Record<string, string>) },
  })
  if (res.status === 401) {
    // Attempt token refresh
    const refreshRes = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: STANDARD_API_HEADERS,
    })
    if (!refreshRes.ok) throw new Error('SESSION_EXPIRED')
    const retry = await fetch(url, {
      credentials: 'include',
      ...opts,
      headers: { ...STANDARD_API_HEADERS, ...(opts?.headers as Record<string, string>) },
    })
    if (!retry.ok) throw new Error(`API error: ${retry.status}`)
    return retry.json()
  }
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export function useAuditLog(params: {
  q?: string
  action?: string
  sessionId?: string
  sort?: string
  order?: string
}): RecentListResult<AuditEntry> {
  const { q, action, sessionId, sort, order } = params
  return useRecentList<AuditEntry>({
    endpoint: '/api/admin/audit',
    query: {
      q: q || undefined,
      action: action && action !== 'all' ? action : undefined,
      sessionId: sessionId || undefined,
      sort: sort || undefined,
      order: order || undefined,
    },
    queryKey: ['audit', q ?? '', action ?? 'all', sessionId ?? '', sort ?? '', order ?? ''],
    pageSize: 50,
  })
}

export function useAuditEntry(id: string | null) {
  return useQuery<AuditEntryDetail>({
    queryKey: ['audit', id],
    queryFn: () => apiFetch(`/api/admin/audit/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  })
}
