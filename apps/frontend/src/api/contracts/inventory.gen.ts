// GENERATED FILE — do not edit.
// Source: apps/backend/src/modules — contract 'inventory'.
// Regenerate with `pnpm gen:contracts`; CI fails on drift.

export type InventoryListQuery = {
  q?: string
  filter?: 'all' | 'low_stock' | 'quarantined' | 'expiring_soon'
  sort?: 'expiry_date' | 'quantity_on_hand' | 'received_at'
  order?: 'asc' | 'desc'
}

export type InventoryListResponse = {
  data: {
    id: string
    serviceName: string
    serviceType: string
    batchNumber: string
    expiryDate: string
    manufacturer: string | null
    unitCost: string | null
    costCurrency: string
    locationId: number | null
    quantityOnHand: string
    quantityAvailable: string | null
    weightedAverageCost: string | null
    quantityReceived: string
    isQuarantined: boolean
    isRecalled: boolean
    quarantineReason: string | null
    supplierName: string | null
    receivedAt: string
    service: { basePrice: string; effectivePrice: string }
  }[]
  summary: {
    totalUnits: number
    lowStockCount: number
    quarantinedCount: number
    expiringCount: number
  }
}

export type InventoryMovementsQuery = { date?: string }

export type InventoryMovementsResponse = {
  movementId: string
  lotNumber: string
  serviceName: string
  movementType: string
  direction: 'in' | 'out' | 'adjust'
  quantity: number
  reason: string | null
  occurredAt: string
}[]

export type InventoryLotsQuery = {
  q?: string
  filter?: 'all' | 'low_stock' | 'quarantined' | 'expiring_soon'
  cursor?: string
  limit?: number
  sort?: 'expiry_date' | 'quantity_on_hand' | 'received_at'
  order?: 'asc' | 'desc'
}

export type InventoryLotsResponse = {
  id: string
  serviceName: string
  serviceType: string
  batchNumber: string
  expiryDate: string
  manufacturer: string | null
  unitCost: string | null
  costCurrency: string
  locationId: number | null
  quantityOnHand: string
  quantityAvailable: string | null
  weightedAverageCost: string | null
  quantityReceived: string
  isQuarantined: boolean
  isRecalled: boolean
  quarantineReason: string | null
  supplierName: string | null
  receivedAt: string
  service: { basePrice: string; effectivePrice: string }
}[]

export type InventoryLotMovementsIdParam = string

export type InventoryLotMovementsQuery = { limit?: number }

export type InventoryLotMovementsResponse = {
  id: string
  lotId: string
  branchId: number
  movementType: string
  quantityDelta: string
  unitCostSnapshot: string | null
  clinicalOrderId: number | null
  inventoryAdjustmentId: number | null
  inventoryTransferId: number | null
  notes: string | null
  performedById: number | null
  performedAt: string
  createdAt: string
}[]

export type InventoryLotDetailIdParam = string

export type InventoryLotDetailResponse = {
  id: string
  tenantId: string
  branchId: number
  productId: number
  batchNumber: string
  expiryDate: string
  quantityReceived: string
  isQuarantined: boolean
  quarantineReason: string | null
  manufacturer: string | null
  unitCost: string | null
  costCurrency: string
  locationId: number | null
  supplierName: string | null
  receivedAt: string
  createdAt: string
  updatedAt: string
  createdById: number | null
  quantityOnHand: string
  quantityAvailable: string | null
  weightedAverageCost: string | null
  balanceQuantityOnHand: string | null
  balanceQuantityAvailable: string | null
  balanceWeightedAverageCost: string | null
  productName: string
  createdByUserId: number | null
  createdByDisplayId: string | null
  createdByFirstName: string | null
  createdByLastName: string | null
  createdBy: { id: number; displayId: string; firstName: string; lastName: string } | null
  service: {
    id: number
    code: string
    name: string
    serviceType: string
    category: string | null
    basePrice: string
    effectivePrice: string
  }
}

export type InventoryDetailIdParam = string

export type InventoryDetailResponse = {
  id: string
  tenantId: string
  branchId: number
  productId: number
  batchNumber: string
  expiryDate: string
  quantityReceived: string
  isQuarantined: boolean
  quarantineReason: string | null
  manufacturer: string | null
  unitCost: string | null
  costCurrency: string
  locationId: number | null
  supplierName: string | null
  receivedAt: string
  createdAt: string
  updatedAt: string
  createdById: number | null
  quantityOnHand: string
  quantityAvailable: string | null
  weightedAverageCost: string | null
  balanceQuantityOnHand: string | null
  balanceQuantityAvailable: string | null
  balanceWeightedAverageCost: string | null
  productName: string
  createdByUserId: number | null
  createdByDisplayId: string | null
  createdByFirstName: string | null
  createdByLastName: string | null
  createdBy: { id: number; displayId: string; firstName: string; lastName: string } | null
  service: {
    id: number
    code: string
    name: string
    serviceType: string
    category: string | null
    basePrice: string
    effectivePrice: string
  }
}

export type InventoryReceiveBody = {
  productId: string
  batchNumber: string
  expiryDate: string
  quantity: number
  unitCost: string | number
  manufacturer: string
  supplierName?: string | undefined | null
  supplierInvoiceNumber?: string | undefined | null
  notes?: string | undefined | null
}

export type InventoryReceiveResponse = {
  id: string
  batchNumber: string
  expiryDate: string
  quantityOnHand: string
  quantityReceived: string
  isNewLot: boolean
}

export type InventoryProductsQuery = { q?: string }

export type InventoryProductsResponse = { id: string; name: string; manufacturer: string | null }[]

export const inventoryEndpoints = {
  list: { method: 'GET', path: '/api/inventory' },
  movements: { method: 'GET', path: '/api/inventory/movements' },
  lots: { method: 'GET', path: '/api/inventory/lots' },
  lotMovements: { method: 'GET', path: '/api/inventory/lots/:id/movements' },
  lotDetail: { method: 'GET', path: '/api/inventory/lots/:id' },
  detail: { method: 'GET', path: '/api/inventory/:id' },
  receive: { method: 'POST', path: '/api/inventory/receive' },
  products: { method: 'GET', path: '/api/inventory/products' },
} as const
