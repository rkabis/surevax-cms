import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/apiFetch'
// Wire types are generated from the backend contract — run `pnpm gen:contracts`.
import type {
  ArrivalsPreviewBundleResponse,
  ArrivalsAtomicBody,
  ArrivalsAtomicResponse,
} from '@/api/contracts/arrivals.gen'

// ── Wire type aliases — components keep importing these names ─────────────────

export type PreviewBundleResult = ArrivalsPreviewBundleResponse
export type PreviewBundleItem = ArrivalsPreviewBundleResponse['items'][number]
export type PreviewBundleService = ArrivalsPreviewBundleResponse['items'][number]['service']
export type PreviewBundleLot = NonNullable<ArrivalsPreviewBundleResponse['items'][number]['lot']>

export type AtomicCommitInput = ArrivalsAtomicBody
export type AtomicCommitResult = ArrivalsAtomicResponse

// ── Hooks ─────────────────────────────────────────────────────────────────────

/**
 * Day-0 bundle preview for the selected templates (merged Day-0 items). The lot
 * shown per item is indicative (earliest-expiring in stock) — the administering
 * nurse picks the actual brand.
 * Read-only — no reservation. Enabled only when at least one is selected.
 */
export function useArrivalPreviewBundle(
  templateIds: string[],
  triageCategory?: string | null,
  patientWeight?: number,
) {
  // Sort for a stable query key — selection order doesn't change the bundle.
  const idsKey = [...templateIds].sort().join(',')
  const params = new URLSearchParams()
  if (idsKey) params.set('templateIds', idsKey)
  if (triageCategory) params.set('triageCategory', triageCategory)
  if (patientWeight) params.set('patientWeight', String(patientWeight))

  return useQuery<PreviewBundleResult>({
    queryKey: ['arrivals', 'preview-bundle', idsKey, triageCategory, patientWeight],
    queryFn: () => apiFetch(`/api/arrivals/preview-bundle?${params}`),
    enabled: templateIds.length > 0,
    staleTime: 30_000,
  })
}

/**
 * Atomic commit: encounter + PSO in one server transaction.
 * On success, invalidates encounters + clinical-orders caches.
 *
 * Draft transaction creation is deferred (see Step3Protocol.tsx:460 comment).
 */
export function useArrivalAtomicCommit() {
  const qc = useQueryClient()
  return useMutation<AtomicCommitResult, Error, AtomicCommitInput>({
    mutationFn: (input) =>
      apiFetch('/api/arrivals/atomic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['encounters'] })
      qc.invalidateQueries({ queryKey: ['clinical-orders'] })
      qc.invalidateQueries({ queryKey: ['scheduledOrders'] })
      if (result.biteIncidentId) {
        qc.invalidateQueries({ queryKey: ['biteIncidents'] })
      }
    },
  })
}
