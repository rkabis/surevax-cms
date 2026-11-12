import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/apiFetch'
import type {
  ReviewCenterListResponse,
  ReviewCenterUpdateGuardianBody,
  ReviewCenterUpdateGuardianResponse,
} from '@/api/contracts/review-center.gen'

export type ReviewCenterData = ReviewCenterListResponse
export type MissingGuardianRow = ReviewCenterData['missingGuardians']['rows'][number]
export type PotentialDuplicateRow = ReviewCenterData['potentialDuplicates']['rows'][number]
export type ExternalImmunizationReviewRow =
  ReviewCenterData['externalImmunizations']['rows'][number]

export function useReviewCenter(opts: { date: string; q?: string }) {
  return useQuery<ReviewCenterListResponse>({
    queryKey: ['review-center', opts.date, opts.q ?? ''],
    queryFn: () => {
      const params = new URLSearchParams({ date: opts.date })
      if (opts.q) params.set('q', opts.q)
      return apiFetch(`/api/review-center?${params}`)
    },
    staleTime: 15_000,
  })
}

export function useUpdateGuardian() {
  const queryClient = useQueryClient()
  return useMutation<
    ReviewCenterUpdateGuardianResponse,
    Error,
    { patientId: string; body: ReviewCenterUpdateGuardianBody }
  >({
    mutationFn: ({ patientId, body }) =>
      apiFetch(`/api/review-center/missing-guardians/${patientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-center'] })
      queryClient.invalidateQueries({ queryKey: ['patients'] })
    },
  })
}
