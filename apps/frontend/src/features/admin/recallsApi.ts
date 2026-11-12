import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/apiFetch'

// ── Types ─────────────────────────────────────────────────────────────────────

export type RecallSeverity = 'Class1' | 'Class2' | 'Class3'

export type ProductRecall = {
  id: string
  tenantId: string
  productId: string | null
  productName: string | null
  manufacturer: string | null
  affectedLotsPattern: string | null
  recallReason: string
  recallSeverity: RecallSeverity
  issuedAt: string
  resolvedAt: string | null
  patientNotificationRequired: boolean
  rowVersion: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  createdBy: {
    displayId: string
    firstName: string
    lastName: string
  } | null
  affectedLots?: Array<{
    id: string
    batchNumber: string
    expiryDate: string
    branchId: string
  }>
}

export type RecallsFilters = {
  severity?: RecallSeverity
  active?: boolean
  productId?: string
  limit?: number
}

export type CreateRecallBody = {
  recallReason: string
  recallSeverity: RecallSeverity
  issuedAt: string
  productId?: string
  manufacturer?: string
  affectedLotsPattern?: string
  patientNotificationRequired?: boolean
}

export type UpdateRecallBody = Partial<CreateRecallBody> & {
  resolvedAt?: string | null
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useProductRecalls(filters: RecallsFilters = {}) {
  return useQuery<ProductRecall[]>({
    queryKey: ['recalls', filters],
    queryFn: () => {
      const params = new URLSearchParams()
      if (filters.severity) params.set('severity', filters.severity)
      if (filters.active !== undefined) params.set('active', String(filters.active))
      if (filters.productId) params.set('productId', filters.productId)
      if (filters.limit) params.set('limit', String(filters.limit))
      const qs = params.toString()
      return apiFetch<ProductRecall[]>(`/api/product-recalls${qs ? `?${qs}` : ''}`)
    },
    staleTime: 30_000,
  })
}

export function useProductRecall(id: string | null) {
  return useQuery<ProductRecall>({
    queryKey: ['recall', id],
    queryFn: async () => {
      const response = await apiFetch<{ data: ProductRecall }>(`/api/product-recalls/${id}`)
      return response.data
    },
    enabled: !!id,
    staleTime: 60_000,
  })
}

export function useCreateRecall() {
  const qc = useQueryClient()
  return useMutation<ProductRecall, Error, CreateRecallBody>({
    mutationFn: (body) =>
      apiFetch<ProductRecall>('/api/product-recalls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['recalls'] })
    },
  })
}

export function useUpdateRecall() {
  const qc = useQueryClient()
  return useMutation<ProductRecall, Error, { id: string; body: UpdateRecallBody }>({
    mutationFn: ({ id, body }) =>
      apiFetch<ProductRecall>(`/api/product-recalls/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['recall', vars.id] })
      void qc.invalidateQueries({ queryKey: ['recalls'] })
    },
  })
}

export function useDeleteRecall() {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (id) =>
      apiFetch<void>(`/api/product-recalls/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['recalls'] })
    },
  })
}
