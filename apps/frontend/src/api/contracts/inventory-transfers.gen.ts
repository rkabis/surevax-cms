// GENERATED FILE — do not edit.
// Source: apps/backend/src/modules — contract 'inventory-transfers'.
// Regenerate with `pnpm gen:contracts`; CI fails on drift.

export type InventoryTransfersListQuery = {
  status?: 'PendingReceipt' | 'Received' | 'Cancelled'
  sourceBranchId?: string
  destinationBranchId?: string
}

export type InventoryTransfersListResponse = {
  id: string
  transferRef: string | null
  tenantId: string
  quantity: string
  status: 'PendingReceipt' | 'Received' | 'Cancelled'
  shippedAt: string
  receivedAt: string | null
  cancelledAt: string | null
  notes: string | null
  rowVersion: number
  createdAt: string
  updatedAt: string
  sourceBranchDisplayId: string
  destinationBranchDisplayId: string
  sourceBranchCode: string
  destinationBranchCode: string
  lotDisplayId: string
  destinationLotDisplayId: string | null
  sourceBranchName: string | null
  destinationBranchName: string | null
  lotBatchNumber: string | null
  productName: string | null
}[]

export type InventoryTransfersDetailIdParam = string

export type InventoryTransfersDetailResponse = {
  id: string
  transferRef: string | null
  tenantId: string
  quantity: string
  status: 'PendingReceipt' | 'Received' | 'Cancelled'
  shippedAt: string
  receivedAt: string | null
  cancelledAt: string | null
  notes: string | null
  rowVersion: number
  createdAt: string
  updatedAt: string
  sourceBranchDisplayId: string
  destinationBranchDisplayId: string
  sourceBranchCode: string
  destinationBranchCode: string
  lotDisplayId: string
  destinationLotDisplayId: string | null
  sourceBranchName: string | null
  destinationBranchName: string | null
  lotBatchNumber: string | null
  productName: string | null
}

export type InventoryTransfersCreateBody = {
  sourceBranchId: string
  destinationBranchId: string
  lotId: string
  quantity: number
  notes?: string | undefined | null
}

export type InventoryTransfersCreateResponse = {
  id: string
  transferRef: string | null
  tenantId: string
  quantity: string
  status: 'PendingReceipt' | 'Received' | 'Cancelled'
  shippedAt: string
  receivedAt: string | null
  cancelledAt: string | null
  notes: string | null
  rowVersion: number
  createdAt: string
  updatedAt: string
}

export type InventoryTransfersReceiveIdParam = string

export type InventoryTransfersReceiveBody = {
  destinationLotId?: string | undefined | null
  notes?: string | undefined | null
}

export type InventoryTransfersReceiveResponse = {
  id: string
  transferRef: string | null
  tenantId: string
  quantity: string
  status: 'PendingReceipt' | 'Received' | 'Cancelled'
  shippedAt: string
  receivedAt: string | null
  cancelledAt: string | null
  notes: string | null
  rowVersion: number
  createdAt: string
  updatedAt: string
}

export type InventoryTransfersCancelIdParam = string

export type InventoryTransfersCancelBody = { reason?: string | undefined | null }

export type InventoryTransfersCancelResponse = {
  id: string
  transferRef: string | null
  tenantId: string
  quantity: string
  status: 'PendingReceipt' | 'Received' | 'Cancelled'
  shippedAt: string
  receivedAt: string | null
  cancelledAt: string | null
  notes: string | null
  rowVersion: number
  createdAt: string
  updatedAt: string
}

export const inventoryTransfersEndpoints = {
  list: { method: 'GET', path: '/api/inventory-transfers' },
  detail: { method: 'GET', path: '/api/inventory-transfers/:id' },
  create: { method: 'POST', path: '/api/inventory-transfers' },
  receive: { method: 'POST', path: '/api/inventory-transfers/:id/receive' },
  cancel: { method: 'POST', path: '/api/inventory-transfers/:id/cancel' },
} as const
