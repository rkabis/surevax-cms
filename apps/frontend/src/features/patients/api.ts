import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/apiFetch'
import { API_BASE_URL, STANDARD_API_HEADERS } from '@/lib/api-base'
import type {
  PatientsListResponse,
  PatientsDetailResponse,
  PatientsTagsResponse,
  PatientsAllergiesResponse,
  PatientsConditionsResponse,
  PatientsEmergencyContactsResponse,
  PatientsExternalImmunizationsResponse,
  PatientsConsentsResponse,
  PatientsPepProgressResponse,
  PatientsDemographicResponse,
  PatientsBreakGlassResponse,
  PatientsCreateBody,
  PatientsUpdateBody,
} from '@/api/contracts/patients.gen'
import type { ScheduledOrdersListResponse } from '@/api/contracts/scheduled-orders.gen'

// ── Wire-type aliases (generated from backend contract) ───────────────────────

/** A single patient row returned by the list endpoint. */
export type Patient = PatientsListResponse['data'][number]

/** Full patient detail returned by GET /api/patients/:id */
export type PatientDetail = PatientsDetailResponse

/** A single patient tag row. */
export type PatientTag = PatientsTagsResponse[number]

/** A single allergy row returned by GET /api/patients/:id/allergies. */
export type PatientAllergy = PatientsAllergiesResponse[number]

/** A single condition row returned by GET /api/patients/:id/conditions. */
export type PatientCondition = PatientsConditionsResponse[number]

/** A single emergency contact row. */
export type EmergencyContact = PatientsEmergencyContactsResponse[number]

/** A single external immunization row. */
export type ExternalImmunization = PatientsExternalImmunizationsResponse[number]

/** A single consent row returned by GET /api/patients/:id/consents. */
export type Consent = PatientsConsentsResponse[number]

/** A single dose entry within a standing-order progress response. */
export type StandingOrderDose = PatientsPepProgressResponse['doses'][number]

/** Standing-order progress returned by GET /api/patients/:id/pep-progress. */
export type StandingOrderProgress = PatientsPepProgressResponse

// Backward-compat aliases — kept so PatientDetailHeader and any other consumers
// that were already using the old names compile without churn.
/** @deprecated Use StandingOrderDose */
export type PepProgressDose = StandingOrderDose
/** @deprecated Use StandingOrderProgress */
export type PepProgress = StandingOrderProgress

/** Tier-1 demographic projection returned by GET /api/patients/:id/demographic. */
export type PatientDemographic = PatientsDemographicResponse

/** Chart returned by the break-glass endpoint on success. */
export type BreakGlassChart = PatientsBreakGlassResponse

// ── Frontend-only / form-state types ─────────────────────────────────────────

// Onboarding channels — single source of allowed "lead source" values for the UI.
// Keep in sync with the backend copy in apps/backend/src/modules/patients/routes.ts
// (ONBOARDING_CHANNELS) — backend can't import this at runtime (tsx path gotcha).
export const ONBOARDING_CHANNELS = [
  'Walk-in',
  'Referral',
  'Vaccination drive',
  'Partner',
  'HMO',
  'Social media',
  'Returning patient',
  'Other',
] as const
export type OnboardingChannel = (typeof ONBOARDING_CHANNELS)[number]

/** Create-patient request body (form state). */
export type CreatePatientInput = PatientsCreateBody

/** Update-patient request body (all fields optional). */
export type UpdatePatientInput = PatientsUpdateBody

export type AddEmergencyContactInput = {
  name: string
  relation: string
  phone: string
  email?: string
  isPrimary?: boolean
  notes?: string
}

export type AddExternalImmunizationInput = {
  vaccineName: string
  cvxCode?: string
  manufacturer?: string
  lotNumber?: string
  administeredDate: string
  administeredAtFacility?: string
  doseNumberInSeries?: number
  source: 'PatientReported' | 'RecordsTransfer' | 'IIS'
}

export type VerifyExternalImmunizationInput = {
  immunizationId: number
  reviewedById?: string
  attestationPin?: string
}

export type AddPatientAllergyInput = {
  allergen: string
  allergenCode?: string
  reaction?: string
  severity?: string
  onsetDate?: string
  source?: string
  notes?: string
}

export type UpdatePatientAllergyInput = Partial<AddPatientAllergyInput> & {
  resolvedAt?: string | null
}

export type AddPatientConditionInput = {
  conditionName: string
  icd10Code?: string
  status?: string
  onsetDate?: string
  notes?: string
}

export type UpdatePatientConditionInput = Partial<AddPatientConditionInput> & {
  resolvedDate?: string | null
}

// Admin: bulk-cancel pending orders (admin module — not patients contract)
export type CancelPendingOrdersInput = {
  reason: string
}

export type CancelPendingOrdersResult = {
  cancelledCount: number
  cancelledOrderIds: string[]
}

/** Input to the break-glass endpoint (POST /api/patients/:id/break-glass) */
export type BreakGlassInput = {
  targetBranchId: string
  reasonCategory:
    | 'Continuity_of_care'
    | 'Emergency'
    | 'Patient_request'
    | 'Quality_review'
    | 'Other'
  reasonDetail: string
}

// ── Patient encounters (cross-feature, from /api/encounters) ──────────────────
// These types are NOT part of the patients contract — they describe data from
// the encounters module. Kept hand-written as frontend view types.
export type PatientEncounter = {
  id: string
  specialty: string
  status: string
  bundleLabel: string
  chiefComplaint: string | null
  startedAt: string
  completedAt: string | null
  providerFirstName: string | null
  providerLastName: string | null
  providerLicenseNumber?: string | null
  branchDisplayId?: string | null
  branchName?: string | null
}

type EncountersResponse = {
  data: PatientEncounter[]
}

// ── List envelope ─────────────────────────────────────────────────────────────
// Used by usePatients and usePatientSearch (both call the list endpoint which
// returns { data, nextCursor, totalCount }).
type ListResponse = PatientsListResponse

// ── Patients list (infinite) ──────────────────────────────────────────────────
export function usePatients(opts: { q?: string; sort?: string; order?: 'asc' | 'desc' } | string) {
  // Accept legacy string form (q only) for backward compat with call sites not yet migrated
  const { q = '', sort, order } = typeof opts === 'string' ? { q: opts } : opts
  return useInfiniteQuery<ListResponse>({
    queryKey: ['patients', q, sort ?? '', order ?? ''],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      // Only pass cursor for the default sort; non-default sort returns top-N only
      if (pageParam && !sort) params.set('cursor', String(pageParam))
      params.set('limit', '30')
      if (sort) params.set('sort', sort)
      if (order) params.set('order', order)
      return apiFetch(`/api/patients?${params}`)
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (sort ? undefined : (last.nextCursor ?? undefined)),
    staleTime: 30_000,
  })
}

// ── Patient search (dedupe lookup) ────────────────────────────────────────────
// Lightweight query for duplicate-detection inside the registration form.
// Separate cache key from the list so list pagination is not disturbed.
export function usePatientSearch(q: string, enabled: boolean) {
  return useQuery<ListResponse>({
    queryKey: ['patients', 'search', q],
    queryFn: () => {
      const params = new URLSearchParams()
      params.set('q', q)
      params.set('limit', '10')
      return apiFetch(`/api/patients?${params}`)
    },
    enabled: enabled && q.trim().length >= 2,
    staleTime: 30_000,
  })
}

// ── Single patient ────────────────────────────────────────────────────────────
export function usePatient(id: string | null) {
  return useQuery<PatientDetail>({
    queryKey: ['patients', id],
    queryFn: () => apiFetch(`/api/patients/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  })
}

// ── Patient encounters (recent) ───────────────────────────────────────────────
export function usePatientEncounters(patientId: string | null, limit = 5) {
  return useQuery<EncountersResponse>({
    queryKey: ['patients', patientId, 'encounters', limit],
    queryFn: () => apiFetch(`/api/encounters?patientId=${patientId}&limit=${limit}`),
    enabled: !!patientId,
    staleTime: 30_000,
  })
}

// ── Create patient ────────────────────────────────────────────────────────────
export function useCreatePatient() {
  const qc = useQueryClient()
  return useMutation<PatientDetail, Error, CreatePatientInput>({
    mutationFn: (data) =>
      apiFetch('/api/patients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients'] })
    },
  })
}

// ── Update patient ────────────────────────────────────────────────────────────
export function useUpdatePatient(patientId: string | null) {
  const qc = useQueryClient()
  return useMutation<PatientDetail, Error, UpdatePatientInput>({
    mutationFn: (data) =>
      apiFetch(`/api/patients/${patientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients'] })
      qc.invalidateQueries({ queryKey: ['patients', patientId] })
    },
  })
}

// ── Emergency contacts ────────────────────────────────────────────────────────
// Field names match the canonical write shape (`relation`, `phone`). DB
// columns are still `relationship` / `phone_number` but the read projection
// aliases them, so frontend reads + writes use identical names.

export function useEmergencyContacts(patientId: string | null) {
  return useQuery<EmergencyContact[]>({
    queryKey: ['patients', patientId, 'emergency-contacts'],
    queryFn: () => apiFetch(`/api/patients/${patientId}/emergency-contacts`),
    enabled: !!patientId,
    staleTime: 30_000,
  })
}

export function useAddEmergencyContact(patientId: string | null) {
  const qc = useQueryClient()
  return useMutation<EmergencyContact, Error, AddEmergencyContactInput>({
    mutationFn: (data) =>
      apiFetch(`/api/patients/${patientId}/emergency-contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients', patientId, 'emergency-contacts'] })
    },
  })
}

export function useDeleteEmergencyContact(patientId: string | null) {
  const qc = useQueryClient()
  return useMutation<unknown, Error, number>({
    mutationFn: (contactId) =>
      apiFetch(`/api/patients/${patientId}/emergency-contacts/${contactId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients', patientId, 'emergency-contacts'] })
    },
  })
}

// ── External immunizations ────────────────────────────────────────────────────
// Field names match `patient_external_immunizations` (DB column) and
// `createExternalImmunizationSchema` (backend Zod): cvxCode, administeredDate,
// administeredAtFacility, source. The previous shape (vaccineCode/administeredAt
// /administeredBy/notes) was a write drift that caused every POST to 400.

export function useExternalImmunizations(patientId: string | null) {
  return useQuery<ExternalImmunization[]>({
    queryKey: ['patients', patientId, 'external-immunizations'],
    queryFn: () => apiFetch(`/api/patients/${patientId}/external-immunizations`),
    enabled: !!patientId,
    staleTime: 30_000,
  })
}

export function useAddExternalImmunization(patientId: string | null) {
  const qc = useQueryClient()
  return useMutation<ExternalImmunization, Error, AddExternalImmunizationInput>({
    mutationFn: (data) =>
      apiFetch(`/api/patients/${patientId}/external-immunizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients', patientId, 'external-immunizations'] })
    },
  })
}

export function useVerifyExternalImmunization(patientId: string | null) {
  const qc = useQueryClient()
  return useMutation<ExternalImmunization, Error, VerifyExternalImmunizationInput>({
    mutationFn: ({ immunizationId, ...body }) =>
      apiFetch(`/api/patients/${patientId}/external-immunizations/${immunizationId}/verify`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients', patientId, 'external-immunizations'] })
      qc.invalidateQueries({ queryKey: ['review-center'] })
    },
  })
}

// ── Patient Allergies ────────────────────────────────────────────────────────

export function usePatientAllergies(patientId: string | null) {
  return useQuery<PatientAllergy[]>({
    queryKey: ['patients', patientId, 'allergies'],
    queryFn: () => apiFetch(`/api/patients/${patientId}/allergies`),
    enabled: !!patientId,
    staleTime: 30_000,
  })
}

export function useAddPatientAllergy(patientId: string | null) {
  const qc = useQueryClient()
  return useMutation<PatientAllergy, Error, AddPatientAllergyInput>({
    mutationFn: (data) =>
      apiFetch(`/api/patients/${patientId}/allergies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients', patientId, 'allergies'] })
      qc.invalidateQueries({ queryKey: ['patients', patientId] })
    },
  })
}

export function useUpdatePatientAllergy(patientId: string | null) {
  const qc = useQueryClient()
  return useMutation<PatientAllergy, Error, { allergyId: number; data: UpdatePatientAllergyInput }>(
    {
      mutationFn: ({ allergyId, data }) =>
        apiFetch(`/api/patients/${patientId}/allergies/${allergyId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['patients', patientId, 'allergies'] })
        qc.invalidateQueries({ queryKey: ['patients', patientId] })
      },
    },
  )
}

export function useDeletePatientAllergy(patientId: string | null) {
  const qc = useQueryClient()
  return useMutation<unknown, Error, number>({
    mutationFn: (allergyId) =>
      apiFetch(`/api/patients/${patientId}/allergies/${allergyId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients', patientId, 'allergies'] })
      qc.invalidateQueries({ queryKey: ['patients', patientId] })
    },
  })
}

// ── Patient Conditions ───────────────────────────────────────────────────────

export function usePatientConditions(patientId: string | null) {
  return useQuery<PatientCondition[]>({
    queryKey: ['patients', patientId, 'conditions'],
    queryFn: () => apiFetch(`/api/patients/${patientId}/conditions`),
    enabled: !!patientId,
    staleTime: 30_000,
  })
}

export function useAddPatientCondition(patientId: string | null) {
  const qc = useQueryClient()
  return useMutation<PatientCondition, Error, AddPatientConditionInput>({
    mutationFn: (data) =>
      apiFetch(`/api/patients/${patientId}/conditions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients', patientId, 'conditions'] })
      qc.invalidateQueries({ queryKey: ['patients', patientId] })
    },
  })
}

export function useUpdatePatientCondition(patientId: string | null) {
  const qc = useQueryClient()
  return useMutation<
    PatientCondition,
    Error,
    { conditionId: number; data: UpdatePatientConditionInput }
  >({
    mutationFn: ({ conditionId, data }) =>
      apiFetch(`/api/patients/${patientId}/conditions/${conditionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients', patientId, 'conditions'] })
      qc.invalidateQueries({ queryKey: ['patients', patientId] })
    },
  })
}

export function useDeletePatientCondition(patientId: string | null) {
  const qc = useQueryClient()
  return useMutation<unknown, Error, number>({
    mutationFn: (conditionId) =>
      apiFetch(`/api/patients/${patientId}/conditions/${conditionId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients', patientId, 'conditions'] })
      qc.invalidateQueries({ queryKey: ['patients', patientId] })
    },
  })
}

// ── Consents ──────────────────────────────────────────────────────────────────

export function useConsents(patientId: string | null) {
  return useQuery<Consent[]>({
    queryKey: ['patients', patientId, 'consents'],
    queryFn: () => apiFetch(`/api/patients/${patientId}/consents`),
    enabled: !!patientId,
    staleTime: 30_000,
  })
}

// ── Standing Order Progress ──────────────────────────────────────────────────
// Generic standing-order schedule: covers rabies PEP, pre-exposure prophylaxis,
// or any other scheduled-dose vaccine standing order.

export function useStandingOrderProgress(patientId: string | null) {
  return useQuery<StandingOrderProgress>({
    queryKey: ['patients', patientId, 'pep-progress'],
    queryFn: () => apiFetch(`/api/patients/${patientId}/pep-progress`),
    enabled: !!patientId,
    staleTime: 30_000,
  })
}

/** @deprecated Use useStandingOrderProgress */
export const usePepProgress = useStandingOrderProgress

/**
 * Standing-order-linked clinical orders for this patient (Scheduled, Pending,
 * Completed, Missed: the same rows `listScheduledOrders` serves the
 * scheduled-orders worklist, scoped here with `?patientId=`). The chart has
 * no order id of its own to open the collect-payment picker with
 * (`useStandingOrderProgress` never selects one); this reuses the existing
 * `/api/scheduled-orders` endpoint rather than adding a new one. Cancelled
 * orders never appear in this list (the query's own status filter excludes
 * them), so "any row with paymentStatus === null" already covers a fully
 * cancelled chain and a fully paid-and-completed one alike, no separate
 * cancelled check needed.
 */
export function usePatientStandingOrders(patientId: string | null) {
  return useQuery<ScheduledOrdersListResponse>({
    queryKey: ['patients', patientId, 'standing-orders'],
    queryFn: () =>
      apiFetch(`/api/scheduled-orders?patientId=${encodeURIComponent(patientId ?? '')}`),
    enabled: !!patientId,
    staleTime: 30_000,
  })
}

// ── Admin: bulk-cancel pending orders ────────────────────────────────────────

export function useCancelPendingOrders(patientId: string | null) {
  const qc = useQueryClient()
  return useMutation<CancelPendingOrdersResult, Error, CancelPendingOrdersInput>({
    mutationFn: (data) =>
      apiFetch(`/api/admin/patients/${patientId}/cancel-pending-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      // Invalidate scheduled-orders list and patient detail (PEP progress may change)
      qc.invalidateQueries({ queryKey: ['scheduledOrders'] })
      qc.invalidateQueries({ queryKey: ['patients', patientId, 'pep-progress'] })
      qc.invalidateQueries({ queryKey: ['patients', patientId] })
    },
  })
}

// ── Health card download ──────────────────────────────────────────────────────

/**
 * Download a patient's health-card PDF.
 * Returns a Blob (application/pdf) ready for programmatic download.
 * GET — no X-Requested-With required (CSRF middleware only checks state-changing methods).
 */
export async function downloadHealthCard(patientId: string): Promise<Blob> {
  // Binary response — bypasses apiFetch (which JSON-parses), but MUST still
  // target API_BASE_URL: a bare relative fetch on the deployed Cloudflare
  // Pages site hits the Pages origin, whose SPA fallback returns index.html
  // with HTTP 200 — silently saving HTML bytes as a corrupt ".pdf".
  const res = await fetch(`${API_BASE_URL}/api/patients/${patientId}/health-card`, {
    credentials: 'include',
    headers: STANDARD_API_HEADERS,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(
      (body as { error?: string }).error ?? `Health card download failed (${res.status})`,
    )
  }
  return res.blob()
}

// ── Tier-1 demographic projection — Cross-Branch PHI RFC Step 2 ──────────────
//
// Returns the safe cross-branch demographic view (demographics + allergies +
// active conditions + DPA consent status). Does NOT include clinical chart
// data (Tier 2) or cross-branch full chart (Tier 3 — requires break-glass).
//
// The hook is intentionally NOT consumed by any UI in this PR — it is wired
// up in RFC Step 8 (PatientDetail Tier-1/Tier-2 split + BreakGlassReveal).

/**
 * usePatientDemographic
 *
 * Fetches the Tier-1 cross-branch demographic projection for a single patient
 * (identity + safety signals: activeRecalls, recentCriticalLabResults,
 * allergies, active conditions). Open to every clinical role including
 * `Branch` (nurse-testing-readiness R3: `Branch` is the only login a real
 * clinic uses).
 *
 * Callers MUST check `isError`. This response carries recall and
 * critical-lab warnings that are otherwise always visible, so a failed fetch
 * (network blip, an expired session) must be shown, never silently treated
 * as "no recalls / no critical labs". See PatientDetail.tsx's Tier-1 safety
 * banners for the required treatment.
 *
 * @param patientId  Patient display_id (PAT_XXXXXXXX)
 */
export function usePatientDemographic(patientId: string | null | undefined) {
  return useQuery({
    queryKey: ['patients', patientId, 'demographic'],
    queryFn: () => apiFetch<PatientDemographic>(`/api/patients/${patientId}/demographic`),
    enabled: !!patientId,
  })
}

/**
 * useBreakGlass
 *
 * Calls POST /api/patients/:id/break-glass with a mandatory typed reason.
 * On success, returns the BreakGlassChart (encounters + transactions at the
 * target branch) and the persistent CBA_ grant ID for the sticky toast.
 *
 * Break-glass is a read-only reveal — the with_check RLS clause blocks
 * cross-branch writes regardless of the cross_branch_read flag.
 *
 * @param patientId  Patient display_id (PAT_XXXXXXXX)
 */
export function useBreakGlass(patientId: string) {
  return useMutation({
    mutationFn: (input: BreakGlassInput) =>
      apiFetch<BreakGlassChart>(`/api/patients/${patientId}/break-glass`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
  })
}
