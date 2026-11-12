import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '@/lib/apiFetch'
// Wire types are generated from the backend contract — run `pnpm gen:contracts`.
import type {
  AdverseEventsListResponse,
  AdverseEventsDetailResponse,
  AdverseEventsCreateBody,
  AdverseEventsUpdateBody,
  AdverseEventsListQuery,
} from '@/api/contracts/adverse-events.gen'

export { ApiError }

// ── Feature-local aliases over the generated wire types ──────────────────────

export type AdverseEvent = AdverseEventsListResponse[number]
export type AdverseEventDetail = AdverseEventsDetailResponse

export type AdverseEventsFilters = AdverseEventsListQuery

export type CreateAdverseEventInput = AdverseEventsCreateBody
export type UpdateAdverseEventInput = AdverseEventsUpdateBody

// ── Query hooks ───────────────────────────────────────────────────────────────

export function useAdverseEvents(filters: AdverseEventsFilters = {}) {
  const params = new URLSearchParams()
  if (filters.patientId) params.set('patientId', filters.patientId)
  if (filters.severity) params.set('severity', filters.severity)
  if (filters.limit != null) params.set('limit', String(filters.limit))

  const qs = params.toString()
  return useQuery<AdverseEventsListResponse>({
    queryKey: ['adverseEvents', filters],
    queryFn: () => apiFetch<AdverseEventsListResponse>(`/api/adverse-events${qs ? `?${qs}` : ''}`),
    staleTime: 30_000,
  })
}

export function useAdverseEvent(id: string | null) {
  return useQuery<AdverseEventDetail>({
    queryKey: ['adverseEvent', id],
    queryFn: () => apiFetch<AdverseEventDetail>(`/api/adverse-events/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  })
}

// Minimal projection of a patient's clinical orders — used by the report
// dialog to link the AEFI to the implicated dose.
export type PatientClinicalOrderOption = {
  id: string
  service: string | null
  doseNumber: number
  scheduledDate: string | null
  status: string
}

/** A patient's clinical orders (any status) for the implicated-dose picker. */
export function usePatientClinicalOrders(patientId: string | null) {
  return useQuery<{ data: PatientClinicalOrderOption[] }>({
    queryKey: ['scheduledOrders', 'by-patient', patientId],
    queryFn: () =>
      apiFetch<{ data: PatientClinicalOrderOption[] }>(
        `/api/scheduled-orders?patientId=${encodeURIComponent(patientId!)}`,
      ),
    enabled: !!patientId,
    staleTime: 30_000,
  })
}

// ── Mutation hooks ────────────────────────────────────────────────────────────

export function useCreateAdverseEvent() {
  const qc = useQueryClient()
  return useMutation<AdverseEventDetail, ApiError, CreateAdverseEventInput>({
    mutationFn: (body) =>
      apiFetch<AdverseEventDetail>('/api/adverse-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['adverseEvents'] })
    },
  })
}

export function useUpdateAdverseEvent() {
  const qc = useQueryClient()
  return useMutation<AdverseEventDetail, ApiError, { id: string; body: UpdateAdverseEventInput }>({
    mutationFn: ({ id, body }) =>
      apiFetch<AdverseEventDetail>(`/api/adverse-events/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['adverseEvent', id] })
      qc.invalidateQueries({ queryKey: ['adverseEvents'] })
    },
  })
}
