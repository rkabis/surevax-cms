import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { API_BASE_URL, STANDARD_API_HEADERS } from '@/lib/api-base'
import { useRecentList, type RecentListResult } from '@/lib/useRecentList'

export type ApprovalType =
  | 'void_transaction'
  | 'inventory_adjustment'
  | 'schedule_change'
  | 'discount_override'
  | string

export type ApprovalStatus = 'Pending' | 'Approved' | 'Rejected'

export type Approval = {
  id: string
  type: ApprovalType
  description: string
  details: string | null
  status: ApprovalStatus
  requestedBy: string
  requestedAt: string
  reviewedBy: string | null
  reviewedAt: string | null
}

export type ApprovalDetail = Approval & {
  entityType: string | null
  entityId: string | null
  requestedByEmail: string | null
  reviewedByEmail: string | null
  reviewNotes: string | null
  branch: string | null
  createdAt: string
  updatedAt: string
}

type DetailResponse = { data: ApprovalDetail }

async function apiFetch(path: string, opts?: RequestInit) {
  const url = `${API_BASE_URL}${path}`
  const res = await fetch(url, {
    credentials: 'include',
    ...opts,
    headers: { ...STANDARD_API_HEADERS, ...(opts?.headers as Record<string, string>) },
  })
  if (res.status === 401) {
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

// ── List approvals ───────────────────────────────────────────────────────────
export function useApprovals(): RecentListResult<Approval> {
  return useRecentList<Approval>({
    endpoint: '/api/admin/approvals',
    queryKey: ['approvals'],
    pageSize: 50,
  })
}

// ── Single approval ──────────────────────────────────────────────────────────
export function useApproval(id: string | null) {
  return useQuery<ApprovalDetail>({
    queryKey: ['approvals', id],
    queryFn: async () => {
      const json: DetailResponse = await apiFetch(`/api/admin/approvals/${id}`)
      return json.data
    },
    enabled: !!id,
    staleTime: 30_000,
  })
}

// ── Approve / Reject mutations ───────────────────────────────────────────────
type ReviewInput = { id: string; notes?: string }

export function useApproveRequest() {
  const qc = useQueryClient()
  return useMutation<unknown, Error, ReviewInput>({
    mutationFn: ({ id, notes }) =>
      apiFetch(`/api/admin/approvals/${id}/approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notes ?? '' }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['approvals'] })
    },
  })
}

export function useRejectRequest() {
  const qc = useQueryClient()
  return useMutation<unknown, Error, ReviewInput>({
    mutationFn: ({ id, notes }) =>
      apiFetch(`/api/admin/approvals/${id}/reject`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notes ?? '' }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['approvals'] })
    },
  })
}
