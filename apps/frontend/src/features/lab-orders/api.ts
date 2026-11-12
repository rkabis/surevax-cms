import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/apiFetch'
// Wire types are generated from the backend contract — run `pnpm gen:contracts`.
import type { LabOrdersListResponse, LabOrdersDetailResponse } from '@/api/contracts/lab-orders.gen'

// Feature-local aliases over the generated wire types — components keep
// importing these names.
export type LabOrderRow = LabOrdersListResponse[number]
export type LabOrderDetail = LabOrdersDetailResponse

// Frontend-only view type for the submit-result mutation body.
// Note: resultFileAttachmentId is a string display_id on the frontend
// (Attachment.id from useAttachments) even though the backend expects a
// bigint-PK number — this is a pre-existing shape mismatch kept as-is.
export type SubmitLabResultInput = {
  resultData?: Record<string, unknown>
  resultFileAttachmentId?: string
  notes?: string
}

// Backend returns a bare array (gotchas.md "List response is a bare array").
export function useLabOrders(opts: { sort?: string; order?: 'asc' | 'desc' } = {}) {
  return useQuery<LabOrderRow[]>({
    queryKey: ['lab-orders', opts.sort ?? '', opts.order ?? ''],
    queryFn: () => {
      const params = new URLSearchParams()
      if (opts.sort) params.set('sort', opts.sort)
      if (opts.order) params.set('order', opts.order)
      const qs = params.toString()
      return apiFetch(`/api/lab-orders${qs ? `?${qs}` : ''}`)
    },
    staleTime: 30_000,
  })
}

export function useLabOrder(id: string | null) {
  return useQuery<LabOrderDetail>({
    queryKey: ['lab-orders', id],
    queryFn: () => apiFetch(`/api/lab-orders/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  })
}

export function useAcknowledgeCritical(labOrderId: string) {
  const qc = useQueryClient()
  return useMutation<LabOrderDetail, Error>({
    mutationFn: () =>
      apiFetch(`/api/lab-orders/${labOrderId}/acknowledge-critical`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['lab-orders', labOrderId] })
      void qc.invalidateQueries({ queryKey: ['lab-orders'] })
    },
  })
}

export function useMarkLabSent(labOrderId: string) {
  const qc = useQueryClient()
  return useMutation<LabOrderDetail, Error>({
    mutationFn: () => apiFetch(`/api/lab-orders/${labOrderId}/mark-sent`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['lab-orders', labOrderId] })
      void qc.invalidateQueries({ queryKey: ['lab-orders'] })
    },
  })
}

export function useSubmitLabResult(labOrderId: string) {
  const qc = useQueryClient()
  return useMutation<LabOrderDetail, Error, SubmitLabResultInput>({
    mutationFn: (body) =>
      apiFetch(`/api/lab-orders/${labOrderId}/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['lab-orders', labOrderId] })
      void qc.invalidateQueries({ queryKey: ['lab-orders'] })
    },
  })
}
