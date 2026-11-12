import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '@/lib/apiFetch'
// Wire types are generated from the backend contract — run `pnpm gen:contracts`.
import type {
  BiteIncidentsListResponse,
  BiteIncidentsDetailResponse,
  BiteIncidentsCreateBody,
  BiteIncidentsUpdateBody,
  BiteIncidentsRecordOutcomeBody,
  BiteIncidentsRecordOutcomeResponse,
  BiteIncidentsListQuery,
} from '@/api/contracts/bite-incidents.gen'

export { ApiError }

// ── Enum types (re-exported for component use) ────────────────────────────────

export type BiteSpecies = 'Dog' | 'Cat' | 'Bat' | 'Monkey' | 'Other'
export type AnimalVaccinationStatus = 'Vaccinated' | 'NotVaccinated' | 'Unknown'
export type ExposureCategory = 'I' | 'II' | 'III'
export type AnimalOutcome =
  | 'AliveHealthy'
  | 'AliveSick'
  | 'DiedNaturally'
  | 'DiedUnknownCause'
  | 'KilledForTesting'
  | 'LostToFollowup'
export type FatTestResult = 'Positive' | 'Negative' | 'Pending' | 'NotTested'

// ── Wire type aliases over generated types ────────────────────────────────────

/** List-row shape (includes patientFirstName + patientLastName enrichments). */
export type BiteIncidentListRow = BiteIncidentsListResponse[number]

/**
 * Detail shape — includes list-row fields plus createdByName + followup.
 * Used by detail rail, create/update mutation return types, and useBiteIncident.
 */
export type BiteIncident = BiteIncidentsDetailResponse

export type AnimalObservationFollowup = NonNullable<BiteIncidentsDetailResponse['followup']>

export type CreateBiteIncidentInput = BiteIncidentsCreateBody
export type UpdateBiteIncidentInput = BiteIncidentsUpdateBody
export type RecordOutcomeInput = BiteIncidentsRecordOutcomeBody
export type RecordOutcomeResult = BiteIncidentsRecordOutcomeResponse

// ── Frontend-only view types ──────────────────────────────────────────────────

export type BiteIncidentFilters = NonNullable<BiteIncidentsListQuery>

// ── Query hooks ───────────────────────────────────────────────────────────────

export function useBiteIncidents(filters: BiteIncidentFilters = {}) {
  const params = new URLSearchParams()
  if (filters.patientId) params.set('patientId', filters.patientId)
  if (filters.limit != null) params.set('limit', String(filters.limit))
  const qs = params.toString()
  return useQuery<BiteIncidentsListResponse>({
    queryKey: ['biteIncidents', filters],
    queryFn: () => apiFetch<BiteIncidentsListResponse>(`/api/bite-incidents${qs ? `?${qs}` : ''}`),
    staleTime: 30_000,
  })
}

export function useBiteIncident(id: string | null) {
  return useQuery<BiteIncident>({
    queryKey: ['biteIncident', id],
    queryFn: () => apiFetch<BiteIncident>(`/api/bite-incidents/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  })
}

// ── Mutation hooks ────────────────────────────────────────────────────────────

export function useCreateBiteIncident() {
  const qc = useQueryClient()
  return useMutation<BiteIncident, ApiError, CreateBiteIncidentInput>({
    mutationFn: (body) =>
      apiFetch<BiteIncident>('/api/bite-incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['biteIncidents'] })
    },
  })
}

export function useUpdateBiteIncident() {
  const qc = useQueryClient()
  return useMutation<BiteIncident, ApiError, { id: string; body: UpdateBiteIncidentInput }>({
    mutationFn: ({ id, body }) =>
      apiFetch<BiteIncident>(`/api/bite-incidents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['biteIncident', id] })
      qc.invalidateQueries({ queryKey: ['biteIncidents'] })
    },
  })
}

export function useRecordOutcome() {
  const qc = useQueryClient()
  return useMutation<
    RecordOutcomeResult,
    ApiError,
    { biteIncidentId: string; followupId: string; body: RecordOutcomeInput }
  >({
    mutationFn: ({ biteIncidentId, followupId, body }) =>
      apiFetch<RecordOutcomeResult>(
        `/api/bite-incidents/${biteIncidentId}/followups/${followupId}/record-outcome`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      ),
    onSuccess: (_, { biteIncidentId }) => {
      qc.invalidateQueries({ queryKey: ['biteIncident', biteIncidentId] })
      qc.invalidateQueries({ queryKey: ['biteIncidents'] })
      // Invalidate scheduled orders in case a Day-28 was cancelled
      qc.invalidateQueries({ queryKey: ['scheduledOrders'] })
    },
  })
}
