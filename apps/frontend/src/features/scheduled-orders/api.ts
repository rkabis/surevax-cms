import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '@/lib/apiFetch'
// Wire types are generated from the backend contract — run `pnpm gen:contracts`.
import type {
  ScheduledOrdersListQuery,
  ScheduledOrdersListResponse,
  ScheduledOrdersDetailResponse,
  ScheduledOrdersTimelineResponse,
  ScheduledOrdersDosesResponse,
  ScheduledOrdersEligibleLotsResponse,
  ScheduledOrdersRecomputePreviewResponse,
  ScheduledOrdersAdministerBody,
  ScheduledOrdersAdministerResponse,
  ScheduledOrdersObservationActionBody,
  ScheduledOrdersObservationActionResponse,
  ScheduledOrdersRescheduleBody,
  ScheduledOrdersTextDraftResponse,
} from '@/api/contracts/scheduled-orders.gen'

export { ApiError }
export type { ScheduledOrdersListResponse }

// Feature-local aliases over the generated wire types — components keep
// importing these names.
export type ScheduledOrder = ScheduledOrdersListResponse['data'][number]
export type ScheduledOrderPaymentStatus = NonNullable<ScheduledOrder['paymentStatus']>
export type ScheduledOrdersStats = ScheduledOrdersListResponse['stats']
export type ScheduledOrderDetail = ScheduledOrdersDetailResponse
export type TimelineEntry = ScheduledOrdersTimelineResponse[number]
export type RecomputePreview = ScheduledOrdersRecomputePreviewResponse
export type AdministerBody = ScheduledOrdersAdministerBody
export type AdministerResult = ScheduledOrdersAdministerResponse
export type ObservationActionBody = ScheduledOrdersObservationActionBody
export type Observation = ScheduledOrdersObservationActionResponse

export type LotRecallMatch = {
  id: string
  recallReason: string
  recallSeverity: string
  issuedAt: string
}

export type RescheduleBody = ScheduledOrdersRescheduleBody

/**
 * Manual "text patient" draft (R2): a QR encoding an `sms:` URI the nurse
 * scans with their own phone, plus the plain-text body and a masked
 * recipient for on-screen review. Not the automated reminder pipeline,
 * which stays deferred.
 */
export type TextDraftResponse = ScheduledOrdersTextDraftResponse
export type TextDraftBlockedReason = NonNullable<TextDraftResponse['blockedReason']>

export type DoseCalcInput = {
  serviceCode: string
  weightKg: number | null
}

export type DoseCalcResult = {
  serviceCode: string
  weightKg: number | null
  totalIu: number
  volumeMl: number
  infiltrationMl: number
  imMl: number
  route: 'INF' | 'IM' | 'SC'
  cappedAtMax: boolean
  weightBased: boolean
  warnings: string[]
  notes: string
}

export const DEFAULT_VIS_VERSION = 'DOH-VIS-RABIES-2024'

// ── Query hooks ───────────────────────────────────────────────────────────────

export type ScheduledOrdersFilterMode = NonNullable<ScheduledOrdersListQuery['filter']>

export function useScheduledOrders(q: string, filter?: ScheduledOrdersFilterMode) {
  return useQuery<ScheduledOrdersListResponse>({
    queryKey: ['scheduledOrders', q, filter ?? 'all'],
    queryFn: () => {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (filter) params.set('filter', filter)
      return apiFetch<ScheduledOrdersListResponse>(`/api/scheduled-orders?${params}`)
    },
    staleTime: 30_000,
  })
}

export function useScheduledOrder(id: string | null) {
  return useQuery<ScheduledOrderDetail>({
    queryKey: ['scheduledOrder', id],
    queryFn: () => apiFetch<ScheduledOrderDetail>(`/api/scheduled-orders/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  })
}

export function useTimeline(id: string) {
  return useQuery<TimelineEntry[]>({
    queryKey: ['scheduledOrderTimeline', id],
    queryFn: () => apiFetch<TimelineEntry[]>(`/api/scheduled-orders/${id}/timeline`),
    staleTime: 30_000,
    enabled: !!id,
  })
}

export function useRecomputePreview(id: string) {
  return useQuery<RecomputePreview>({
    queryKey: ['scheduledOrderRecomputePreview', id],
    queryFn: () => apiFetch<RecomputePreview>(`/api/scheduled-orders/${id}/recompute-preview`),
    staleTime: 30_000,
    enabled: !!id,
  })
}

export type PrepayableDose = ScheduledOrdersDosesResponse[number]

/** Chain doses + billing status for the Collect/Prepay picker. */
/**
 * Chain doses for the prepay / collect picker.
 *
 * `payerId` is part of the query KEY, not just the URL: each dose's `unitPrice`
 * is resolved server-side at that payer's contracted rate, so two payers are two
 * different answers and must not share a cache entry.
 */
export function usePrepayableDoses(id: string | null, enabled = true, payerId?: string | null) {
  return useQuery<PrepayableDose[]>({
    queryKey: ['prepayableDoses', id, payerId ?? null],
    queryFn: () => {
      const qs = payerId ? `?payerId=${encodeURIComponent(payerId)}` : ''
      return apiFetch<PrepayableDose[]>(`/api/scheduled-orders/${id}/doses${qs}`)
    },
    staleTime: 30_000,
    enabled: !!id && enabled,
  })
}

export type EligibleLots = ScheduledOrdersEligibleLotsResponse
export type EligibleLot = EligibleLots['data'][number]

/**
 * Brands/lots the nurse may pick for this dose, house brand first then
 * earliest-expiring. `staleTime: 0` on purpose — stock moves between doses, and
 * a stale list means offering a lot another nurse just used up.
 */
export function useEligibleLots(id: string | null, enabled = true) {
  return useQuery<EligibleLots>({
    queryKey: ['eligibleLots', id],
    queryFn: () => apiFetch<EligibleLots>(`/api/scheduled-orders/${id}/eligible-lots`),
    staleTime: 0,
    enabled: !!id && enabled,
  })
}

/**
 * Composed SMS reminder draft for a single order, fetched only once the
 * "Text patient" dialog opens (`enabled`), since it renders a QR server-side
 * on every call.
 */
export function useTextDraft(id: string | null, enabled = true) {
  return useQuery<TextDraftResponse>({
    queryKey: ['scheduledOrderTextDraft', id],
    queryFn: () => apiFetch<TextDraftResponse>(`/api/scheduled-orders/${id}/text-draft`),
    enabled: !!id && enabled,
    staleTime: 0,
  })
}

export function useLotRecallMatches(lotId: string | null) {
  return useQuery<{ matches: LotRecallMatch[] }>({
    queryKey: ['lotRecallMatches', lotId],
    queryFn: () =>
      apiFetch<{ matches: LotRecallMatch[] }>(`/api/product-recalls/lots/${lotId}/matches`),
    enabled: !!lotId,
    staleTime: 30_000,
  })
}

// ── Mutation hooks ────────────────────────────────────────────────────────────

export function useAdministerScheduledOrder() {
  const qc = useQueryClient()
  return useMutation<AdministerResult, ApiError, { id: string; body: AdministerBody }>({
    mutationFn: ({ id, body }) =>
      apiFetch(`/api/scheduled-orders/${id}/administer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (result, { id }) => {
      qc.invalidateQueries({ queryKey: ['scheduledOrder', id] })
      qc.invalidateQueries({ queryKey: ['scheduledOrders'] })
      qc.invalidateQueries({ queryKey: ['scheduledOrderTimeline', id] })
      qc.invalidateQueries({ queryKey: ['scheduledOrderRecomputePreview', id] })
      qc.invalidateQueries({ queryKey: ['prepayableDoses', id] })
      // The dose consumed stock: the brand list and the inventory page are stale.
      qc.invalidateQueries({ queryKey: ['eligibleLots'] })
      qc.invalidateQueries({ queryKey: ['inventory'] })
      // The patient chart's standing-order banner is independently queried.
      // Without this, it can keep displaying the just-administered dose until
      // its stale window expires.
      if (result.patientId) {
        qc.invalidateQueries({ queryKey: ['patients', result.patientId, 'standing-orders'] })
        qc.invalidateQueries({ queryKey: ['patients', result.patientId, 'pep-progress'] })
      }
    },
  })
}

export function useRecordObservationAction() {
  const qc = useQueryClient()
  return useMutation<Observation, ApiError, { id: string; body: ObservationActionBody }>({
    mutationFn: ({ id, body }) =>
      apiFetch(`/api/scheduled-orders/${id}/observation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['scheduledOrder', id] })
      qc.invalidateQueries({ queryKey: ['scheduledOrders'] })
    },
  })
}

export function useRescheduleScheduledOrder() {
  const qc = useQueryClient()
  return useMutation<unknown, ApiError, { id: string; body: RescheduleBody }>({
    mutationFn: ({ id, body }) =>
      apiFetch(`/api/scheduled-orders/${id}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['scheduledOrder', id] })
      qc.invalidateQueries({ queryKey: ['scheduledOrders'] })
      qc.invalidateQueries({ queryKey: ['scheduledOrderTimeline', id] })
      qc.invalidateQueries({ queryKey: ['scheduledOrderRecomputePreview', id] })
    },
  })
}

export function useDoseCalc() {
  return useMutation<DoseCalcResult, ApiError, DoseCalcInput>({
    mutationFn: (input) =>
      apiFetch<DoseCalcResult>('/api/dose-calc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
  })
}
