import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '@/lib/apiFetch'
// Wire types are generated from the backend contract — run `pnpm gen:contracts`.
import type {
  AppointmentsListResponse,
  AppointmentsAvailabilityResponse,
  AppointmentsDetailResponse,
  AppointmentsCreateResponse,
  AppointmentsUpdateResponse,
  AppointmentsCreateBody,
  AppointmentsUpdateBody,
  AppointmentsCancelBody,
} from '@/api/contracts/appointments.gen'

export { ApiError }
export type { AppointmentsListResponse }

// Feature-local aliases over the generated wire types — components keep
// importing these names.

/** A single appointment row from the list endpoint (bare array). */
export type Appointment = AppointmentsListResponse[number]

/** Status values for appointments. */
export type AppointmentStatus = Appointment['status']

/** The full detail row (inner data field after unwrapping the {data} envelope). */
export type AppointmentDetail = AppointmentsDetailResponse['data']

export type AvailabilitySlot = AppointmentsAvailabilityResponse['slots'][number]
export type AvailabilityResponse = AppointmentsAvailabilityResponse

export type CreateAppointmentBody = AppointmentsCreateBody
export type UpdateAppointmentBody = AppointmentsUpdateBody
export type CancelAppointmentBody = AppointmentsCancelBody

// ── Query hooks ───────────────────────────────────────────────────────────────

export type AppointmentsFilters = {
  status?: string
  patientId?: string
  limit?: number
}

export function useAppointments(filters?: AppointmentsFilters) {
  return useQuery<AppointmentsListResponse>({
    queryKey: ['appointments', filters],
    queryFn: () => {
      const params = new URLSearchParams()
      if (filters?.status) params.set('status', filters.status)
      if (filters?.patientId) params.set('patientId', filters.patientId)
      if (filters?.limit) params.set('limit', String(filters.limit))
      const qs = params.toString()
      return apiFetch<AppointmentsListResponse>(`/api/appointments${qs ? `?${qs}` : ''}`)
    },
    staleTime: 30_000,
  })
}

export function useAppointment(id: string) {
  return useQuery<AppointmentDetail>({
    queryKey: ['appointment', id],
    queryFn: () =>
      apiFetch<AppointmentsDetailResponse>(`/api/appointments/${id}`).then((r) => r.data),
    enabled: !!id,
    staleTime: 30_000,
  })
}

// ── Mutation hooks ────────────────────────────────────────────────────────────

export function useCreateAppointment() {
  const qc = useQueryClient()
  return useMutation<AppointmentDetail, ApiError, CreateAppointmentBody>({
    mutationFn: (body) =>
      apiFetch<AppointmentsCreateResponse>('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] })
    },
  })
}

export function useUpdateAppointment() {
  const qc = useQueryClient()
  return useMutation<AppointmentDetail, ApiError, { id: string; body: UpdateAppointmentBody }>({
    mutationFn: ({ id, body }) =>
      apiFetch<AppointmentsUpdateResponse>(`/api/appointments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['appointment', id] })
      qc.invalidateQueries({ queryKey: ['appointments'] })
    },
  })
}

export function useCancelAppointment() {
  const qc = useQueryClient()
  return useMutation<unknown, ApiError, { id: string; body: CancelAppointmentBody }>({
    // The backend route is POST /:displayId/cancel with a required reason —
    // the previous DELETE call never matched the route (404 on every cancel).
    mutationFn: ({ id, body }) =>
      apiFetch(`/api/appointments/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['appointment', id] })
      qc.invalidateQueries({ queryKey: ['appointments'] })
    },
  })
}

// ── Availability ──────────────────────────────────────────────────────────────

export function useAvailability(
  providerId: string | null,
  from: string | null,
  to: string | null,
  durationMinutes = 30,
) {
  return useQuery<AvailabilityResponse>({
    queryKey: ['appointments', 'availability', providerId, from, to, durationMinutes],
    queryFn: () => {
      const params = new URLSearchParams()
      if (providerId) params.set('providerId', providerId)
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      params.set('durationMinutes', String(durationMinutes))
      return apiFetch<AvailabilityResponse>(`/api/appointments/availability?${params}`)
    },
    enabled: !!providerId && !!from && !!to,
  })
}

// ── Branch physicians ─────────────────────────────────────────────────────────

// Physicians come from the canonical hook in `features/branch/api.ts`. This
// file used to declare its own duplicate type + `useQuery` against the same
// `['branch','physicians']` key but caching a different shape — see that
// hook's docblock for what that broke. Re-exported so existing imports from
// this module keep working.
export type { BranchPhysician } from '@/features/branch/api'
export { useBranchPhysicians } from '@/features/branch/api'
