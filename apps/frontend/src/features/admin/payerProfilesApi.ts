import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/apiFetch'

export type PayerType = 'HMO' | 'Corporate' | 'Government' | 'Promo'

export type PayerProfile = {
  id: string
  name: string
  payerType: PayerType
  contactName: string | null
  contactNumber: string | null
  email: string | null
  paymentTermsDays: number | null
  isActive: boolean
  createdAt: string
}

export type PayerProfileDetail = PayerProfile & {
  tenantId: string
  address: string | null
  notes: string | null
  priceAdjustmentPercent: string | null
  rowVersion: number
  updatedAt: string
  createdById: string | null
  createdBy: {
    id: number
    displayId: string
    firstName: string
    lastName: string
  } | null
}

type ListResponse = {
  data: PayerProfile[]
}

// ── Payer profiles list ──────────────────────────────────────────────────────
export function usePayerProfiles(payerType?: PayerType | 'all') {
  return useQuery<ListResponse>({
    queryKey: ['payer-profiles', payerType ?? 'all'],
    queryFn: () => {
      const params = new URLSearchParams()
      if (payerType && payerType !== 'all') params.set('payerType', payerType)
      const qs = params.toString()
      return apiFetch<ListResponse>(`/api/payer-profiles${qs ? `?${qs}` : ''}`)
    },
    staleTime: 30_000,
  })
}

// ── Single payer profile ─────────────────────────────────────────────────────
export function usePayerProfile(id: string | null) {
  return useQuery<PayerProfileDetail>({
    queryKey: ['payer-profiles', id],
    queryFn: () => apiFetch<PayerProfileDetail>(`/api/payer-profiles/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  })
}

// ── Update payer profile ─────────────────────────────────────────────────────
export type UpdatePayerProfileInput = {
  name?: string
  payerType?: PayerType
  contactName?: string | null
  contactNumber?: string | null
  email?: string | null
  address?: string | null
  paymentTermsDays?: number | null
  notes?: string | null
  isActive?: boolean
  priceAdjustmentPercent?: number | null
  expectedRowVersion?: number
}

export type UpdatedPayerProfile = {
  displayId: string
  name: string
  payerType: PayerType
  contactName: string | null
  contactNumber: string | null
  email: string | null
  address: string | null
  paymentTermsDays: number | null
  notes: string | null
  isActive: boolean
  priceAdjustmentPercent: string | null
  rowVersion: number
  createdAt: string
  updatedAt: string
}

export function useUpdatePayerProfile(displayId: string) {
  const qc = useQueryClient()
  return useMutation<UpdatedPayerProfile, Error, UpdatePayerProfileInput>({
    mutationFn: (body) =>
      apiFetch<UpdatedPayerProfile>(`/api/payer-profiles/${displayId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['payer-profiles'] })
    },
  })
}

// ── Price-adjustment exclusions ──────────────────────────────────────────────
// Services exempt from a payer's priceAdjustmentPercent (opt-out list).

export type PayerPriceExclusion = {
  serviceId: string
  serviceName: string
}

type PriceExclusionsListResponse = {
  data: PayerPriceExclusion[]
}

export function usePayerPriceExclusions(payerDisplayId: string | null) {
  return useQuery<PriceExclusionsListResponse>({
    queryKey: ['payer-profiles', payerDisplayId, 'price-exclusions'],
    queryFn: () =>
      apiFetch<PriceExclusionsListResponse>(
        `/api/payer-profiles/${payerDisplayId}/price-exclusions`,
      ),
    enabled: !!payerDisplayId,
    staleTime: 30_000,
  })
}

export function useAddPayerPriceExclusion(payerDisplayId: string) {
  const qc = useQueryClient()
  return useMutation<PayerPriceExclusion, Error, string>({
    mutationFn: (serviceId) =>
      apiFetch<PayerPriceExclusion>(`/api/payer-profiles/${payerDisplayId}/price-exclusions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ['payer-profiles', payerDisplayId, 'price-exclusions'],
      })
    },
  })
}

export function useRemovePayerPriceExclusion(payerDisplayId: string) {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (serviceId) =>
      apiFetch<void>(`/api/payer-profiles/${payerDisplayId}/price-exclusions/${serviceId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ['payer-profiles', payerDisplayId, 'price-exclusions'],
      })
    },
  })
}
