import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/apiFetch'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ClaimStatus =
  | 'Draft'
  | 'Submitted'
  | 'Acknowledged'
  | 'InReview'
  | 'Approved'
  | 'PartiallyApproved'
  | 'Denied'
  | 'Paid'
  | 'Appealed'

export const ALL_STATUSES: ClaimStatus[] = [
  'Draft',
  'Submitted',
  'Acknowledged',
  'InReview',
  'Approved',
  'PartiallyApproved',
  'Denied',
  'Paid',
  'Appealed',
]

export type Claim = {
  id: string
  tenantId: string
  payerId: string
  patientId: string | null
  encounterId: string | null
  transactionId: string | null
  externalClaimNumber: string | null
  loaNumber: string | null
  status: ClaimStatus
  totalBilled: string | null
  totalApproved: string | null
  createdAt: string
  updatedAt: string
  payer?: { id: string; name: string } | null
}

export type ClaimItem = {
  id: string
  claimId: string
  transactionItemId: string | null
  serviceCode: string | null
  description: string | null
  quantity: string | null
  chargedAmount: string
  approvedAmount: string | null
}

export type ClaimStatusHistory = {
  id: string
  claimId: string
  fromStatus: ClaimStatus | null
  toStatus: ClaimStatus
  note: string | null
  changedById: string | null
  changedAt: string
}

export type ClaimDetail = Claim & {
  items: ClaimItem[]
  statusHistory: ClaimStatusHistory[]
}

export type ClaimsFilters = {
  status?: ClaimStatus | 'all'
  payerId?: string
  from?: string
  to?: string
  patientId?: string
  limit?: number
  q?: string
}

export type CreateClaimBody = {
  payerId: string
  patientId?: string
  encounterId?: string
  transactionId?: string
  externalClaimNumber?: string
  loaNumber?: string
  totalBilled?: string
  items?: Array<{
    transactionItemId?: string
    serviceCode?: string
    description?: string
    quantity?: string
    chargedAmount: string
  }>
}

export type UpdateClaimStatusBody = {
  status: ClaimStatus
  note?: string
  metadata?: Record<string, unknown>
}

// Actual shape of PUT /api/admin/claims/:id/status: a small ack, not the
// full Claim row. The route (apps/backend/src/modules/admin/claims.ts) does
// `res.json({ ok: true, id: claimDisplayIdValue, status: body.status })`.
export type UpdateClaimStatusResponse = {
  ok: boolean
  id: string
  status: ClaimStatus
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useClaims(filters: ClaimsFilters = {}) {
  return useQuery<Claim[]>({
    queryKey: ['claims', filters],
    queryFn: () => {
      const params = new URLSearchParams()
      if (filters.status && filters.status !== 'all') params.set('status', filters.status)
      if (filters.payerId) params.set('payerId', filters.payerId)
      // Route reads req.query.dateFrom/dateTo, not from/to (apps/backend/src/
      // modules/admin/claims.ts:192), so sending `from`/`to` silently dropped
      // the date-range filter on every call.
      if (filters.from) params.set('dateFrom', filters.from)
      if (filters.to) params.set('dateTo', filters.to)
      if (filters.patientId) params.set('patientId', filters.patientId)
      if (filters.limit) params.set('limit', String(filters.limit))
      const qs = params.toString()
      return apiFetch<Claim[]>(`/api/admin/claims${qs ? `?${qs}` : ''}`)
    },
    staleTime: 30_000,
  })
}

export function useClaim(id: string | null) {
  return useQuery<ClaimDetail>({
    queryKey: ['claim', id],
    queryFn: () => apiFetch<ClaimDetail>(`/api/admin/claims/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  })
}

export function useCreateClaim() {
  const qc = useQueryClient()
  return useMutation<Claim, Error, CreateClaimBody>({
    mutationFn: (body) =>
      apiFetch<Claim>('/api/admin/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['claims'] })
    },
  })
}

export function useUpdateClaimStatus() {
  const qc = useQueryClient()
  return useMutation<UpdateClaimStatusResponse, Error, { id: string; body: UpdateClaimStatusBody }>(
    {
      mutationFn: ({ id, body }) =>
        // Route is PUT /:id/status (apps/backend/src/modules/admin/claims.ts:566);
        // /:id alone only has a GET, so the bare id URL 404'd on every call.
        apiFetch<UpdateClaimStatusResponse>(`/api/admin/claims/${id}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      onSuccess: (_, vars) => {
        void qc.invalidateQueries({ queryKey: ['claim', vars.id] })
        void qc.invalidateQueries({ queryKey: ['claims'] })
      },
    },
  )
}
