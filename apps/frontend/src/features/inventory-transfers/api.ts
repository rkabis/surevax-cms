import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '@/lib/apiFetch'
// Wire types are generated from the backend contract — run `pnpm gen:contracts`.
import type {
  InventoryTransfersListQuery,
  InventoryTransfersListResponse,
  InventoryTransfersDetailResponse,
  InventoryTransfersCreateBody,
  InventoryTransfersCreateResponse,
  InventoryTransfersReceiveBody,
  InventoryTransfersReceiveResponse,
  InventoryTransfersCancelBody,
  InventoryTransfersCancelResponse,
} from '@/api/contracts/inventory-transfers.gen'

export { ApiError }

// Feature-local aliases over the generated wire types — components keep
// importing these names.
export type TransferStatus = NonNullable<InventoryTransfersListQuery['status']>
export type InventoryTransfer = InventoryTransfersListResponse[number]
export type InventoryTransferDetail = InventoryTransfersDetailResponse
export type InventoryTransferFilters = InventoryTransfersListQuery
export type ShipTransferInput = InventoryTransfersCreateBody
export type ReceiveTransferInput = InventoryTransfersReceiveBody
export type CancelTransferInput = InventoryTransfersCancelBody

// ── Query hooks ───────────────────────────────────────────────────────────────

export function useInventoryTransfers(filters: InventoryTransferFilters = {}) {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.sourceBranchId) params.set('sourceBranchId', filters.sourceBranchId)
  if (filters.destinationBranchId) params.set('destinationBranchId', filters.destinationBranchId)
  const qs = params.toString()
  return useQuery<InventoryTransfersListResponse>({
    queryKey: ['inventoryTransfers', filters],
    queryFn: () =>
      apiFetch<InventoryTransfersListResponse>(`/api/inventory-transfers${qs ? `?${qs}` : ''}`),
    staleTime: 30_000,
  })
}

export function useInventoryTransfer(id: string | null) {
  return useQuery<InventoryTransferDetail>({
    queryKey: ['inventoryTransfer', id],
    queryFn: () => apiFetch<InventoryTransferDetail>(`/api/inventory-transfers/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  })
}

// ── Mutation hooks ────────────────────────────────────────────────────────────

export function useShipTransfer() {
  const qc = useQueryClient()
  return useMutation<InventoryTransfersCreateResponse, ApiError, ShipTransferInput>({
    mutationFn: (body) =>
      apiFetch<InventoryTransfersCreateResponse>('/api/inventory-transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventoryTransfers'] })
      qc.invalidateQueries({ queryKey: ['inventory'] })
    },
  })
}

export function useReceiveTransfer() {
  const qc = useQueryClient()
  return useMutation<
    InventoryTransfersReceiveResponse,
    ApiError,
    { id: string; body: ReceiveTransferInput }
  >({
    mutationFn: ({ id, body }) =>
      apiFetch<InventoryTransfersReceiveResponse>(`/api/inventory-transfers/${id}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['inventoryTransfer', id] })
      qc.invalidateQueries({ queryKey: ['inventoryTransfers'] })
      qc.invalidateQueries({ queryKey: ['inventory'] })
    },
  })
}

export function useCancelTransfer() {
  const qc = useQueryClient()
  return useMutation<
    InventoryTransfersCancelResponse,
    ApiError,
    { id: string; body: CancelTransferInput }
  >({
    mutationFn: ({ id, body }) =>
      apiFetch<InventoryTransfersCancelResponse>(`/api/inventory-transfers/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['inventoryTransfer', id] })
      qc.invalidateQueries({ queryKey: ['inventoryTransfers'] })
      qc.invalidateQueries({ queryKey: ['inventory'] })
    },
  })
}
