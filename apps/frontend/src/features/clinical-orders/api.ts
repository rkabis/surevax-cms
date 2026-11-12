import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/apiFetch'

export type AdministeredOrderRow = {
  id: string
  patientId: string
  patientName: string
  serviceName: string
  lotNumber: string | null
  administeredAt: string
  administeredByName: string | null
  encounterId: string | null
}

// ── Query hooks ───────────────────────────────────────────────────────────────

/**
 * Fetch the branch-wide administered log for a given date (YYYY-MM-DD).
 * Calls GET /api/scheduled-orders/administered?date=YYYY-MM-DD.
 * Returns a bare array of AdministeredOrderRow.
 */
export function useAdministeredOrders(date: string) {
  return useQuery<AdministeredOrderRow[]>({
    queryKey: ['administeredOrders', date],
    queryFn: () =>
      apiFetch<AdministeredOrderRow[]>(`/api/scheduled-orders/administered?date=${date}`),
    staleTime: 30_000,
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(date),
  })
}
