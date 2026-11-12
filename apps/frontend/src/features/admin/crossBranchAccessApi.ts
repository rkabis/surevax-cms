import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/apiFetch'

export { ApiError } from '@/lib/apiFetch'

/**
 * A single cross-branch access grant row returned by
 * GET /api/admin/cross-branch-access
 *
 * Fields match the SELECT projection in
 * apps/backend/src/modules/admin/crossBranchAccess.ts
 */
export type CrossBranchGrant = {
  displayId: string
  tenantId: string
  grantedAt: string
  reasonCategory: string
  reasonDetail: string
  correlationId: string | null
  // acting user
  userDisplayId: string
  userFirstName: string
  userLastName: string
  // patient
  patientDisplayId: string
  patientMrn: string
  patientFirstName: string
  patientLastName: string
  // branches
  sourceBranchId: number | null
  targetBranchDisplayId: string
  targetBranchName: string | null
}

export type ListCrossbranchGrantsParams = {
  userId?: string
  patientId?: string
  targetBranchId?: string
  reasonCategory?: string
  since?: string
  limit?: number
}

function buildQuery(params: ListCrossbranchGrantsParams): string {
  const q = new URLSearchParams()
  if (params.userId) q.set('userId', params.userId)
  if (params.patientId) q.set('patientId', params.patientId)
  if (params.targetBranchId) q.set('targetBranchId', params.targetBranchId)
  if (params.reasonCategory) q.set('reasonCategory', params.reasonCategory)
  if (params.since) q.set('since', params.since)
  if (params.limit != null) q.set('limit', String(params.limit))
  const s = q.toString()
  return s ? `?${s}` : ''
}

/**
 * useCrossBranchGrants
 *
 * Fetches cross_branch_access_grants for retrospective compliance review.
 * Bare array response (per convention — no envelope).
 */
export function useCrossBranchGrants(params: ListCrossbranchGrantsParams = {}) {
  return useQuery({
    queryKey: ['admin', 'cross-branch-access', params],
    queryFn: () =>
      apiFetch<CrossBranchGrant[]>(`/api/admin/cross-branch-access${buildQuery(params)}`),
    staleTime: 30_000,
  })
}
