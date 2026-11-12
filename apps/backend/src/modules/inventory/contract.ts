/**
 * inventory API contract — schemas + endpoint manifest.
 *
 * Request schemas are the runtime validators used by routes.ts; response
 * schemas describe the ACTUAL res.json payloads and are enforced against the
 * implementation via `satisfies` at each res.json callsite.
 *
 * Side-effect-free imports only (zod + pure shared utils) — the generator
 * imports this file without a configured environment.
 */
import { z } from 'zod'
import { prefixedDisplayIdSchema } from '../../shared/utils/displayId.js'
import { defineContract } from '../../contracts/defineContract.js'

// ── Request schemas (runtime validators for routes.ts) ──────────────────────

/** Lot display_ids (LOT_…) on every :id route param. */
export const lotIdSchema = prefixedDisplayIdSchema('LOT')

const inventoryFilterSchema = z.enum(['all', 'low_stock', 'quarantined', 'expiring_soon'])

const inventorySortSchema = z.enum(['expiry_date', 'quantity_on_hand', 'received_at'])

const inventoryOrderSchema = z.enum(['asc', 'desc'])

const listQuerySchema = z.object({
  q: z.string().optional(),
  filter: inventoryFilterSchema.optional(),
  sort: inventorySortSchema.optional(),
  order: inventoryOrderSchema.optional(),
})

const lotsQuerySchema = z.object({
  q: z.string().optional(),
  filter: inventoryFilterSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().optional(),
  sort: inventorySortSchema.optional(),
  order: inventoryOrderSchema.optional(),
})

const movementsQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
})

const lotMovementsQuerySchema = z.object({
  limit: z.coerce.number().optional(),
})

/** Product display_ids (PRD_...), the physical SKU a receipt is against. */
const productIdSchema = prefixedDisplayIdSchema('PRD')

/**
 * Decimal-string money schema for unit cost (numeric(12,4), one place more
 * precision than the peso-cent convention elsewhere, matching the column).
 * Accepts a number or string on input and normalizes to a string so the
 * server never does float arithmetic on money.
 */
const unitCostSchema = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? v.toFixed(4) : v.trim()))
  .refine(
    (v) => /^\d+(\.\d{1,4})?$/.test(v) && parseFloat(v) >= 0,
    'unitCost must be a non-negative decimal (up to 4 decimal places)',
  )

/**
 * Receive a delivery of stock at the caller's session branch. Branch is never
 * accepted from the body: see routes.ts, which reads it from req.tenant.
 */
export const receiveBody = z.object({
  productId: productIdSchema,
  batchNumber: z.string().min(1, 'Batch number is required').max(120),
  /** YYYY-MM-DD. Refused if already past, see receiveStock in db.ts. */
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expiryDate must be YYYY-MM-DD'),
  quantity: z.number().positive('quantity must be > 0'),
  unitCost: unitCostSchema,
  manufacturer: z.string().min(1, 'Manufacturer is required').max(200),
  supplierName: z.string().max(200).optional().nullable(),
  supplierInvoiceNumber: z.string().max(200).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
})

export const productsQuerySchema = z.object({
  q: z.string().optional(),
})

// ── Response schemas (wire truth — keep in lockstep with db.ts) ──────────────

const inventoryLotRowSchema = z.object({
  id: z.string(),
  serviceName: z.string(),
  serviceType: z.string(),
  batchNumber: z.string(),
  /** date() column — serializes as YYYY-MM-DD string. */
  expiryDate: z.string(),
  manufacturer: z.string().nullable(),
  /** numeric(12,4) — crosses the wire as a string; null when unset. */
  unitCost: z.string().nullable(),
  costCurrency: z.string(),
  /**
   * NOTE: locationId is a bigint FK crossing the wire raw — a known internal-id
   * leak captured as-is. Flagged for a separate fix.
   */
  locationId: z.number().nullable(),
  /** numeric(12,4) from inventory_lot_balances — crosses the wire as string. */
  quantityOnHand: z.string(),
  /** numeric(12,4) from inventory_lot_balances — null when no balance row. */
  quantityAvailable: z.string().nullable(),
  /** numeric(12,4) from inventory_lot_balances — null when no balance row. */
  weightedAverageCost: z.string().nullable(),
  /** numeric(12,4) from inventory_lots — crosses the wire as string. */
  quantityReceived: z.string(),
  isQuarantined: z.boolean(),
  isRecalled: z.boolean(),
  quarantineReason: z.string().nullable(),
  supplierName: z.string().nullable(),
  /** receivedAt.toISOString().slice(0,10) — YYYY-MM-DD string. */
  receivedAt: z.string(),
  service: z.object({
    /** Legacy compatibility placeholder — always '0.00'. */
    basePrice: z.string(),
    /** Legacy compatibility placeholder — always '0.00'. */
    effectivePrice: z.string(),
  }),
})

const inventorySummarySchema = z.object({
  totalUnits: z.number(),
  lowStockCount: z.number(),
  quarantinedCount: z.number(),
  expiringCount: z.number(),
})

const listResponseSchema = z.object({
  data: z.array(inventoryLotRowSchema),
  summary: inventorySummarySchema,
})

const movementRowSchema = z.object({
  movementId: z.string(),
  lotNumber: z.string(),
  serviceName: z.string(),
  movementType: z.string(),
  direction: z.enum(['in', 'out', 'adjust']),
  /** Math.abs(Number(quantityDelta)) — always a JS number. */
  quantity: z.number(),
  reason: z.string().nullable(),
  /** performedAt.toISOString() */
  occurredAt: z.string(),
})

const lotDetailResponseSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  /**
   * NOTE: branchId is a bigint FK crossing the wire raw — a known
   * internal-id leak. Flagged for a separate fix.
   */
  branchId: z.number(),
  /**
   * NOTE: productId is a bigint FK crossing the wire raw — a known
   * internal-id leak. Flagged for a separate fix.
   */
  productId: z.number(),
  batchNumber: z.string(),
  /** date() column — serializes as YYYY-MM-DD string. */
  expiryDate: z.string(),
  /** numeric(12,4) — crosses the wire as string. */
  quantityReceived: z.string(),
  isQuarantined: z.boolean(),
  quarantineReason: z.string().nullable(),
  manufacturer: z.string().nullable(),
  /** numeric(12,4) — null when unset. */
  unitCost: z.string().nullable(),
  costCurrency: z.string(),
  /**
   * NOTE: locationId is a bigint FK crossing the wire raw — a known
   * internal-id leak. Flagged for a separate fix.
   */
  locationId: z.number().nullable(),
  supplierName: z.string().nullable(),
  /** receivedAt.toISOString() */
  receivedAt: z.string(),
  /** createdAt.toISOString() */
  createdAt: z.string(),
  /** updatedAt.toISOString() */
  updatedAt: z.string(),
  /**
   * NOTE: createdById is a bigint FK crossing the wire raw via spread — a
   * known internal-id leak. Flagged for a separate fix.
   */
  createdById: z.number().nullable(),
  /** numeric(12,4) from inventory_lot_balances — null when LEFT JOIN misses. */
  quantityOnHand: z.string(),
  /** numeric(12,4) from inventory_lot_balances — null when no balance row. */
  quantityAvailable: z.string().nullable(),
  /** numeric(12,4) from inventory_lot_balances — null when no balance row. */
  weightedAverageCost: z.string().nullable(),
  /** Via LEFT JOIN; null when LEFT JOIN misses (columns widen to nullable). */
  balanceQuantityOnHand: z.string().nullable(),
  balanceQuantityAvailable: z.string().nullable(),
  balanceWeightedAverageCost: z.string().nullable(),
  productName: z.string(),
  createdByUserId: z.number().nullable(),
  createdByDisplayId: z.string().nullable(),
  createdByFirstName: z.string().nullable(),
  createdByLastName: z.string().nullable(),
  createdBy: z
    .object({
      /**
       * NOTE: id is the bigint PK crossing the wire raw — a known
       * internal-id leak. Flagged for a separate fix.
       */
      id: z.number(),
      displayId: z.string(),
      firstName: z.string(),
      lastName: z.string(),
    })
    .nullable(),
  service: z.object({
    /**
     * NOTE: service.id is the productId bigint crossing the wire raw — a
     * known internal-id leak. Flagged for a separate fix.
     */
    id: z.number(),
    code: z.string(),
    name: z.string(),
    serviceType: z.string(),
    category: z.string().nullable(),
    basePrice: z.string(),
    effectivePrice: z.string(),
  }),
})

const lotMovementRowSchema = z.object({
  id: z.string(),
  lotId: z.string(),
  /**
   * NOTE: branchId is a bigint FK crossing the wire raw — a known
   * internal-id leak. Flagged for a separate fix.
   */
  branchId: z.number(),
  movementType: z.string(),
  /** numeric(12,4) — crosses the wire as string. */
  quantityDelta: z.string(),
  /** numeric(12,4) — null when unset. */
  unitCostSnapshot: z.string().nullable(),
  /**
   * NOTE: clinicalOrderId / inventoryAdjustmentId / inventoryTransferId /
   * performedById are bigint FKs crossing the wire raw — known internal-id
   * leaks. Flagged for a separate fix.
   */
  clinicalOrderId: z.number().nullable(),
  inventoryAdjustmentId: z.number().nullable(),
  inventoryTransferId: z.number().nullable(),
  notes: z.string().nullable(),
  performedById: z.number().nullable(),
  /** performedAt.toISOString() */
  performedAt: z.string(),
  /** createdAt.toISOString() */
  createdAt: z.string(),
})

const receiveResponseSchema = z.object({
  id: z.string(),
  batchNumber: z.string(),
  /** date() column, serializes as YYYY-MM-DD string. */
  expiryDate: z.string(),
  /** numeric(12,4), crosses the wire as a string. */
  quantityOnHand: z.string(),
  /** numeric(12,4), crosses the wire as a string. */
  quantityReceived: z.string(),
  /**
   * true when this receipt created a brand-new lot; false when it topped up
   * an existing lot for the same batch number at this branch.
   */
  isNewLot: z.boolean(),
})

const productRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  manufacturer: z.string().nullable(),
})

// ── Manifest ─────────────────────────────────────────────────────────────────

export const inventoryContract = defineContract('inventory', {
  list: {
    method: 'GET',
    path: '/api/inventory',
    query: listQuerySchema,
    response: listResponseSchema,
  },
  movements: {
    method: 'GET',
    path: '/api/inventory/movements',
    query: movementsQuerySchema,
    response: z.array(movementRowSchema),
  },
  lots: {
    method: 'GET',
    path: '/api/inventory/lots',
    query: lotsQuerySchema,
    response: z.array(inventoryLotRowSchema),
  },
  lotMovements: {
    method: 'GET',
    path: '/api/inventory/lots/:id/movements',
    params: { id: lotIdSchema },
    query: lotMovementsQuerySchema,
    response: z.array(lotMovementRowSchema),
  },
  lotDetail: {
    method: 'GET',
    path: '/api/inventory/lots/:id',
    params: { id: lotIdSchema },
    response: lotDetailResponseSchema,
  },
  detail: {
    method: 'GET',
    path: '/api/inventory/:id',
    params: { id: lotIdSchema },
    response: lotDetailResponseSchema,
  },
  receive: {
    method: 'POST',
    path: '/api/inventory/receive',
    body: receiveBody,
    response: receiveResponseSchema,
  },
  products: {
    method: 'GET',
    path: '/api/inventory/products',
    query: productsQuerySchema,
    response: z.array(productRowSchema),
  },
})

// ── Inferred response types (used by routes.ts `satisfies` assertions) ───────

export type InventoryListResponse = z.infer<typeof listResponseSchema>
export type InventoryMovementsResponse = z.infer<typeof movementRowSchema>[]
export type InventoryLotsResponse = z.infer<typeof inventoryLotRowSchema>[]
export type InventoryLotMovementsResponse = z.infer<typeof lotMovementRowSchema>[]
export type InventoryLotDetailResponse = z.infer<typeof lotDetailResponseSchema>
export type InventoryDetailResponse = z.infer<typeof lotDetailResponseSchema>
export type InventoryReceiveBody = z.input<typeof receiveBody>
export type InventoryReceiveResponse = z.infer<typeof receiveResponseSchema>
export type InventoryProductsResponse = z.infer<typeof productRowSchema>[]
