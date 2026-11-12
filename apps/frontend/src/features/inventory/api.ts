import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '@/lib/apiFetch'
// Wire types are generated from the backend contract — run `pnpm gen:contracts`.
import type {
  InventoryListResponse,
  InventoryMovementsResponse,
  InventoryLotDetailResponse,
  InventoryReceiveBody,
  InventoryReceiveResponse,
  InventoryProductsResponse,
} from '@/api/contracts/inventory.gen'

export { ApiError }

// ── Feature-local filter type (UI state, not a wire type) ──────────────────────
export type InventoryFilter = 'all' | 'low_stock' | 'quarantined' | 'expiring_soon'

// ── Wire type aliases — components keep importing these names ─────────────────
export type InventoryLot = InventoryListResponse['data'][number]
export type InventorySummary = InventoryListResponse['summary']
export type InventoryLotDetail = InventoryLotDetailResponse
export type InventoryProduct = InventoryProductsResponse[number]
export type ReceiveStockInput = InventoryReceiveBody
export type ReceiveStockResult = InventoryReceiveResponse

// ── Day-totals header type (from X-Day-Totals response header, not the body) ──
export type InventoryMovementRow = InventoryMovementsResponse[number]

export type InventoryDayTotals = {
  count: number
  byDirection: { in: number; out: number; adjust: number }
}

// ── Inventory list ────────────────────────────────────────────────────────────
export function useInventoryLots(opts: {
  q?: string
  filter?: InventoryFilter
  sort?: string
  order?: 'asc' | 'desc'
}) {
  const { q, filter = 'all', sort, order } = opts
  return useQuery<InventoryListResponse>({
    queryKey: ['inventory', { q, filter, sort: sort ?? '', order: order ?? '' }],
    queryFn: () => {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (filter) params.set('filter', filter)
      if (sort) params.set('sort', sort)
      if (order) params.set('order', order)
      const qs = params.toString()
      return apiFetch(`/api/inventory${qs ? `?${qs}` : ''}`)
    },
    staleTime: 30_000,
  })
}

// ── Inventory movements (day-scoped) ──────────────────────────────────────────

import { API_BASE_URL, STANDARD_API_HEADERS } from '@/lib/api-base'

/**
 * Day-scoped inventory movements for the authenticated session's branch.
 * Reads `X-Day-Totals` response header (parsed inline since `apiFetch` only
 * surfaces the body — see `lib/apiFetch.ts`).
 */
export function useInventoryMovements(date: string) {
  return useQuery<{ rows: InventoryMovementRow[]; totals: InventoryDayTotals }>({
    queryKey: ['inventory', 'movements', date],
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE_URL}/api/inventory/movements?date=${encodeURIComponent(date)}`,
        {
          credentials: 'include',
          headers: STANDARD_API_HEADERS,
        },
      )
      if (!res.ok) throw new Error(`Failed to load movements: ${res.status}`)
      const rows = (await res.json()) as InventoryMovementRow[]
      const headerRaw = res.headers.get('X-Day-Totals')
      let totals: InventoryDayTotals = {
        count: rows.length,
        byDirection: { in: 0, out: 0, adjust: 0 },
      }
      if (headerRaw) {
        try {
          totals = JSON.parse(headerRaw) as InventoryDayTotals
        } catch {
          // fall through to derived totals
        }
      }
      return { rows, totals }
    },
    enabled: Boolean(date),
  })
}

// ── Single lot ────────────────────────────────────────────────────────────────
export function useInventoryLot(id: string | null) {
  return useQuery<InventoryLotDetail>({
    queryKey: ['inventory', id],
    queryFn: () => apiFetch(`/api/inventory/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  })
}

// ── Products (for the receive-stock product picker) ───────────────────────────
export function useInventoryProducts(q: string) {
  return useQuery<InventoryProductsResponse>({
    queryKey: ['inventory', 'products', q],
    queryFn: () => {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      const qs = params.toString()
      return apiFetch(`/api/inventory/products${qs ? `?${qs}` : ''}`)
    },
    staleTime: 60_000,
  })
}

// ── Receive stock ──────────────────────────────────────────────────────────────
export function useReceiveStock() {
  const qc = useQueryClient()
  return useMutation<ReceiveStockResult, ApiError, ReceiveStockInput>({
    mutationFn: (body) =>
      apiFetch<ReceiveStockResult>('/api/inventory/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] })
    },
  })
}
