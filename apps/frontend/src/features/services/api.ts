import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '@/lib/apiFetch'

export type Service = {
  id: string
  code: string
  sku: string | null
  name: string
  serviceType: string
  category: string | null
  basePrice: string
  isVatExempt: boolean
  requiresStock: boolean
  requiresRx: boolean
  isActive: boolean
}

export type ServiceDetail = Service & {
  tenantId: string
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  createdById: string | null
  createdBy: {
    id: number
    displayId: string
    firstName: string
    lastName: string
  } | null
}

type ListResponse = { data: Service[] }
type DetailResponse = { data: ServiceDetail }

export type ServicePrice = {
  id: string
  serviceId: string
  branchId: string | null
  payerId: string | null
  patientSegment: string | null
  unitPrice: string
  currency: string
  effectiveFrom: string
  effectiveTo: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  createdById: string | null
}

type PriceListResponse = { data: ServicePrice[] }

// ── Services list ─────────────────────────────────────────────────────────────
export function useServices(q: string) {
  return useQuery<Service[]>({
    queryKey: ['services', q],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      const qs = params.toString()
      const res: ListResponse = await apiFetch(`/api/services${qs ? `?${qs}` : ''}`)
      return res.data
    },
    staleTime: 30_000,
  })
}

// ── Single service ────────────────────────────────────────────────────────────
export function useService(id: string | null) {
  return useQuery<ServiceDetail>({
    queryKey: ['services', id],
    queryFn: async () => {
      const res: DetailResponse = await apiFetch(`/api/services/${id}`)
      return res.data
    },
    enabled: !!id,
    staleTime: 60_000,
  })
}

export function useServicePrices(serviceId: string | null) {
  return useQuery<ServicePrice[]>({
    queryKey: ['services', serviceId, 'prices'],
    queryFn: async () => {
      const res: PriceListResponse = await apiFetch(`/api/services/${serviceId}/prices`)
      return res.data
    },
    enabled: !!serviceId,
    staleTime: 30_000,
  })
}

export function useUpdateService() {
  const qc = useQueryClient()
  return useMutation<DetailResponse, ApiError, { id: string; body: Record<string, unknown> }>({
    mutationFn: ({ id, body }) =>
      apiFetch(`/api/services/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['services'] })
      qc.invalidateQueries({ queryKey: ['services', id] })
      qc.invalidateQueries({ queryKey: ['services', id, 'prices'] })
    },
  })
}

export function useCreateService() {
  const qc = useQueryClient()
  return useMutation<DetailResponse, ApiError, Record<string, unknown>>({
    mutationFn: (body) =>
      apiFetch('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services'] })
    },
  })
}
