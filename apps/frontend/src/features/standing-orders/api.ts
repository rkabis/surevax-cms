import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/apiFetch'
import type {
  StandingOrdersListResponse,
  StandingOrdersDetailResponse,
  StandingOrdersTemplatesListResponse,
  StandingOrdersPsoListResponse,
  StandingOrdersPsoDetailResponse,
  StandingOrdersPsoCreateResponse,
  StandingOrdersPsoCreateBody,
  StandingOrdersAdminTemplatesUpdateResponse,
  StandingOrdersAdminTemplatesUpdateBody,
  StandingOrdersAdminTemplatesVersionsResponse,
  StandingOrdersAdminTemplatesVersionsBody,
  StandingOrdersAdminPsoAppendExternalDoseResponse,
  StandingOrdersAdminPsoAppendExternalDoseBody,
  StandingOrdersAdminPsoStatusResponse,
  StandingOrdersAdminPsoStatusBody,
} from '@/api/contracts/standing-orders.gen'

// ── Wire-type aliases (over generated contract types) ─────────────────────────

/** A single standing order template row (list projection — no items, no createdBy). */
export type StandingOrderTemplate = StandingOrdersListResponse['data'][number]

/** Template item (day-offset + service info). */
export type StandingOrderTemplateItem = StandingOrdersDetailResponse['data']['items'][number]

/** Template detail: template row + items + createdBy. */
export type StandingOrderTemplateDetail = StandingOrdersDetailResponse['data']

/** Template with items joined — used by the protocol-initiation picker. */
export type StandingOrderTemplateWithItems = StandingOrdersTemplatesListResponse['data'][number]

/** PSO list row. */
export type PatientStandingOrderRow = StandingOrdersPsoListResponse['data'][number]

/** A single clinical-order dose within a PSO detail. */
export type PatientStandingOrderDose =
  StandingOrdersPsoDetailResponse['data']['clinicalOrders'][number]

/** PSO detail: list row + clinicalOrders + consents + statusHistory. */
export type PatientStandingOrderDetail = StandingOrdersPsoDetailResponse['data']

/** Created clinical-order row returned inside the PSO creation response. */
export type CreatedClinicalOrder = StandingOrdersPsoCreateResponse['data']['clinicalOrders'][number]

/** The full PSO object returned on successful creation. */
export type CreatedPatientStandingOrder = StandingOrdersPsoCreateResponse['data']

/** External-dose clinical-order row returned by append-external-dose. */
export type ExternalDoseClinicalOrder = StandingOrdersAdminPsoAppendExternalDoseResponse['data']

// ── Frontend-only view types (not wire types — keep as-is) ────────────────────

export type StartStandingOrderInput = StandingOrdersPsoCreateBody & {
  /** Omit when initiating outside a visit (booster from the patient chart). */
  encounterId?: string
}

export type UpdateTemplateInput = { id: string } & StandingOrdersAdminTemplatesUpdateBody

export type AppendExternalDoseInput = {
  psoId: string
} & StandingOrdersAdminPsoAppendExternalDoseBody

// Alias of the canonical `BranchPhysician`. It used to be a narrower local
// shape (no `licenseNumber`) than the endpoint actually returns.
export type { BranchPhysician as PhysicianOption } from '@/features/branch/api'

// ── Query hooks ───────────────────────────────────────────────────────────────

export function useStandingOrderTemplates(specialty?: string | null) {
  return useQuery<StandingOrderTemplate[]>({
    queryKey: ['standing-orders', specialty ?? null],
    queryFn: async () => {
      const url = specialty
        ? `/api/standing-orders?specialty=${encodeURIComponent(specialty)}`
        : '/api/standing-orders'
      const res: StandingOrdersListResponse = await apiFetch(url)
      return res.data
    },
    staleTime: 60_000,
  })
}

export function useStandingOrderTemplate(id: string | null) {
  return useQuery<StandingOrderTemplateDetail>({
    // Use a distinct 'detail' segment to avoid colliding with the list key
    // ['standing-orders', specialty?] — TanStack Query uses referential array
    // equality so ['standing-orders', 'detail', id] never shadows the list.
    queryKey: ['standing-orders', 'detail', id],
    queryFn: async () => {
      const res: StandingOrdersDetailResponse = await apiFetch(`/api/standing-orders/${id}`)
      return res.data
    },
    enabled: !!id,
    staleTime: 60_000,
  })
}

/**
 * Active templates with their items joined — used by the protocol-initiation
 * picker to preview Day-offsets without an N+1.
 */
export function useStandingOrderTemplatesWithItems() {
  return useQuery<StandingOrderTemplateWithItems[]>({
    queryKey: ['standing-order-templates'],
    queryFn: async () => {
      const res: StandingOrdersTemplatesListResponse = await apiFetch(
        '/api/standing-order-templates',
      )
      return res.data
    },
    staleTime: 60_000,
  })
}

export function usePatientStandingOrders() {
  return useQuery<PatientStandingOrderRow[]>({
    queryKey: ['patient-standing-orders'],
    queryFn: async () => {
      const res: StandingOrdersPsoListResponse = await apiFetch('/api/patient-standing-orders')
      return res.data
    },
    staleTime: 30_000,
  })
}

export function usePatientStandingOrderDetail(id: string | null) {
  return useQuery<PatientStandingOrderDetail>({
    queryKey: ['patient-standing-orders', 'detail', id],
    queryFn: async () => {
      const res: StandingOrdersPsoDetailResponse = await apiFetch(
        `/api/patient-standing-orders/${id}`,
      )
      return res.data
    },
    enabled: !!id,
    staleTime: 30_000,
  })
}

// ── Physician picker (used when a Nurse initiates a protocol) ────────────────

// Physicians come from the canonical hook in `features/branch/api.ts` (which
// queries /api/branch/physicians, so Branch and Nurse sessions — not just
// Admins — can populate the "authorized by" dropdown). This module used to
// hold a third `useQuery` on the same cache key with a different shape; see
// that hook's docblock. Re-exported under the local name so `PhysicianPicker`
// and this feature's own imports keep working.
export { useBranchPhysicians as usePhysicians } from '@/features/branch/api'

// ── Mutation hooks ────────────────────────────────────────────────────────────

export function useStartStandingOrder() {
  const qc = useQueryClient()
  return useMutation<CreatedPatientStandingOrder, Error, StartStandingOrderInput>({
    mutationFn: async (input) => {
      const res: StandingOrdersPsoCreateResponse = await apiFetch('/api/patient-standing-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clinical-orders'] })
      qc.invalidateQueries({ queryKey: ['scheduledOrders'] })
    },
  })
}

/** Pause (Suspended) / resume (Active) a PSO. */
export function useSetPatientStandingOrderStatus() {
  const qc = useQueryClient()
  return useMutation<
    StandingOrdersAdminPsoStatusResponse,
    Error,
    { psoId: string } & StandingOrdersAdminPsoStatusBody
  >({
    mutationFn: ({ psoId, ...body }) =>
      apiFetch(`/api/admin/patient-standing-orders/${psoId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_, { psoId }) => {
      qc.invalidateQueries({ queryKey: ['patient-standing-orders'] })
      qc.invalidateQueries({ queryKey: ['patient-standing-orders', 'detail', psoId] })
    },
  })
}

/**
 * Creates a new version of a locked template via copy-on-write.
 * The old template becomes locked; the new one (version+1) is returned.
 * Invalidates both template list query keys.
 */
export function useCreateNewTemplateVersion() {
  const qc = useQueryClient()
  return useMutation<StandingOrderTemplate, Error, string>({
    mutationFn: async (id) => {
      // The backend route is POST /:id/versions — the previous /new-version
      // path never existed (404 on every call).
      const body: StandingOrdersAdminTemplatesVersionsBody = {}
      const res: StandingOrdersAdminTemplatesVersionsResponse = await apiFetch(
        `/api/admin/standing-order-templates/${id}/versions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['standing-orders'] })
      qc.invalidateQueries({ queryKey: ['standing-order-templates'] })
    },
  })
}

/**
 * Updates a standing order template. Throws with code TEMPLATE_LOCKED (409)
 * if the template is locked — callers should catch and redirect to the
 * new-version flow.
 */
export function useUpdateTemplate() {
  const qc = useQueryClient()
  return useMutation<StandingOrderTemplate, Error & { code?: string }, UpdateTemplateInput>({
    mutationFn: async ({ id, ...body }: UpdateTemplateInput) => {
      const res: StandingOrdersAdminTemplatesUpdateResponse = await apiFetch(
        `/api/admin/standing-order-templates/${id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body as StandingOrdersAdminTemplatesUpdateBody),
        },
      )
      return res.data
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['standing-orders'] })
      qc.invalidateQueries({ queryKey: ['standing-orders', 'detail', id] })
      qc.invalidateQueries({ queryKey: ['standing-order-templates'] })
    },
  })
}

// ── Continuity-of-care: external dose append ─────────────────────────────────

/**
 * Append an externally-administered dose to an existing PSO.
 * Only TenantAdmin and Physician can call this endpoint.
 */
export function useAppendExternalDose() {
  const qc = useQueryClient()
  return useMutation<ExternalDoseClinicalOrder, Error, AppendExternalDoseInput>({
    mutationFn: async ({ psoId, ...body }: AppendExternalDoseInput) => {
      const res: StandingOrdersAdminPsoAppendExternalDoseResponse = await apiFetch(
        `/api/admin/patient-standing-orders/${psoId}/append-external-dose`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body as StandingOrdersAdminPsoAppendExternalDoseBody),
        },
      )
      return res.data
    },
    onSuccess: (_data, { psoId }) => {
      qc.invalidateQueries({ queryKey: ['patient-standing-orders', psoId] })
      qc.invalidateQueries({ queryKey: ['clinical-orders'] })
      qc.invalidateQueries({ queryKey: ['scheduledOrders'] })
    },
  })
}
