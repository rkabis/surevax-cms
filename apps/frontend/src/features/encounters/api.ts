import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/apiFetch'
// Wire types are generated from the backend contract — run `pnpm gen:contracts`.
import type {
  EncountersListResponse,
  EncountersDetailResponse,
  EncountersVitalsResponse,
  EncountersCreateVitalBody,
  EncountersCreateVitalResponse,
  EncountersDiagnosesResponse,
  EncountersCreateDiagnosisBody,
  EncountersCreateDiagnosisResponse,
  EncountersCreateBody,
  EncountersCancelBody,
  EncountersCompleteResponse,
  EncountersCancelResponse,
} from '@/api/contracts/encounters.gen'

// Feature-local aliases over the generated wire types — components keep
// importing these names.
export type VitalRow = EncountersCreateVitalResponse
export type DiagnosisRow = EncountersCreateDiagnosisResponse
export type CreateVitalInput = EncountersCreateVitalBody
export type CreateDiagnosisInput = EncountersCreateDiagnosisBody
export type EncounterListItem = EncountersListResponse['data'][number]
export type EncounterDetail = EncountersDetailResponse

type ListResponse = EncountersListResponse

// ── Encounters list ───────────────────────────────────────────────────────────
export function useEncounters(opts: { sort?: string; order?: 'asc' | 'desc' } = {}) {
  return useQuery<ListResponse>({
    queryKey: ['encounters', opts.sort ?? '', opts.order ?? ''],
    queryFn: () => {
      const params = new URLSearchParams()
      if (opts.sort) params.set('sort', opts.sort)
      if (opts.order) params.set('order', opts.order)
      const qs = params.toString()
      return apiFetch(`/api/encounters${qs ? `?${qs}` : ''}`)
    },
    staleTime: 30_000,
  })
}

// ── Single encounter ──────────────────────────────────────────────────────────
export function useEncounter(id: string | null) {
  return useQuery<EncounterDetail>({
    queryKey: ['encounters', id],
    queryFn: () => apiFetch(`/api/encounters/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  })
}

// ── Vitals ────────────────────────────────────────────────────────────────────
export function useVitals(encounterId: string | null) {
  return useQuery<EncountersVitalsResponse>({
    queryKey: ['encounters', encounterId, 'vitals'],
    queryFn: () => apiFetch(`/api/encounters/${encounterId}/vitals`),
    enabled: !!encounterId,
    staleTime: 30_000,
  })
}

export function useCreateVital(encounterId: string) {
  const qc = useQueryClient()
  return useMutation<VitalRow, Error, CreateVitalInput>({
    mutationFn: (data) =>
      apiFetch(`/api/encounters/${encounterId}/vitals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['encounters', encounterId, 'vitals'] })
    },
  })
}

// ── Diagnoses ─────────────────────────────────────────────────────────────────
export function useDiagnoses(encounterId: string | null) {
  return useQuery<EncountersDiagnosesResponse>({
    queryKey: ['encounters', encounterId, 'diagnoses'],
    queryFn: () => apiFetch(`/api/encounters/${encounterId}/diagnoses`),
    enabled: !!encounterId,
    staleTime: 30_000,
  })
}

export function useCreateDiagnosis(encounterId: string) {
  const qc = useQueryClient()
  return useMutation<DiagnosisRow, Error, CreateDiagnosisInput>({
    mutationFn: (data) =>
      apiFetch(`/api/encounters/${encounterId}/diagnoses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['encounters', encounterId, 'diagnoses'] })
    },
  })
}

// ── Create encounter ──────────────────────────────────────────────────────────
export type CreateEncounterInput = EncountersCreateBody

export function useCreateEncounter() {
  const qc = useQueryClient()
  return useMutation<EncounterDetail, Error, CreateEncounterInput>({
    mutationFn: (data) =>
      apiFetch('/api/encounters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['encounters'] })
    },
  })
}

// ── Status transitions ────────────────────────────────────────────────────────

/** Sign off a visit. No reason required, this is the routine close. */
export function useCompleteEncounter(encounterId: string) {
  const qc = useQueryClient()
  return useMutation<EncountersCompleteResponse, Error, void>({
    mutationFn: () =>
      apiFetch(`/api/encounters/${encounterId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['encounters'] })
    },
  })
}

/** Cancel a visit that has not had a dose administered against it. Reason required. */
export function useCancelEncounter(encounterId: string) {
  const qc = useQueryClient()
  return useMutation<EncountersCancelResponse, Error, EncountersCancelBody>({
    mutationFn: (data) =>
      apiFetch(`/api/encounters/${encounterId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['encounters'] })
    },
  })
}
