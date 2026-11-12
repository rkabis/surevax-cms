/**
 * inventory-transfers API contract — schemas + endpoint manifest.
 *
 * Request schemas are the runtime validators used by routes.ts; response
 * schemas describe the ACTUAL res.json payloads and are enforced against the
 * implementation via `satisfies` at each res.json callsite.
 *
 * Side-effect-free imports only (zod + pure shared utils) — the generator
 * imports this file without a configured environment.
 */
import { z } from 'zod'
import { prefixedDisplayIdSchema, displayIdSchema } from '../../shared/utils/displayId.js'
import { defineContract } from '../../contracts/defineContract.js'

// ── Request schemas (runtime validators for routes.ts) ──────────────────────

const TRANSFER_STATUS = ['PendingReceipt', 'Received', 'Cancelled'] as const

export const shipBody = z.object({
  sourceBranchId: displayIdSchema,
  destinationBranchId: displayIdSchema,
  lotId: prefixedDisplayIdSchema('LOT'),
  quantity: z.number().positive('quantity must be > 0'),
  notes: z.string().max(4000).optional().nullable(),
})

export const receiveBody = z.object({
  destinationLotId: prefixedDisplayIdSchema('LOT').optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
})

export const cancelBody = z.object({
  reason: z.string().max(4000).optional().nullable(),
})

export const listQuery = z.object({
  status: z.enum(TRANSFER_STATUS).optional(),
  sourceBranchId: displayIdSchema.optional(),
  destinationBranchId: displayIdSchema.optional(),
})

export const transferIdParam = prefixedDisplayIdSchema('TRF')

// ── Response schemas (wire truth — keep in lockstep with db.ts/service.ts) ──

/** Core mutation shape. Internal bigint foreign keys never cross the wire. */
export const transferPublicSchema = z.object({
  id: z.string(),
  transferRef: z.string().nullable(),
  tenantId: z.string(),
  /** numeric(12,4) — crosses the wire as a string. */
  quantity: z.string(),
  status: z.enum(TRANSFER_STATUS),
  /** Date serialized by res.json → ISO string. */
  shippedAt: z.string(),
  /** Date serialized by res.json → ISO string. */
  receivedAt: z.string().nullable(),
  /** Date serialized by res.json → ISO string. */
  cancelledAt: z.string().nullable(),
  notes: z.string().nullable(),
  rowVersion: z.number(),
  /** Date serialized by res.json → ISO string. */
  createdAt: z.string(),
  /** Date serialized by res.json → ISO string. */
  updatedAt: z.string(),
})

const transferResolvedSchema = transferPublicSchema.extend({
  sourceBranchDisplayId: z.string(),
  destinationBranchDisplayId: z.string(),
  sourceBranchCode: z.string(),
  destinationBranchCode: z.string(),
  lotDisplayId: z.string(),
  destinationLotDisplayId: z.string().nullable(),
  /** LEFT JOIN branches src — nullable even though branches.name is NOT NULL. */
  sourceBranchName: z.string().nullable(),
  /** LEFT JOIN branches dst — nullable even though branches.name is NOT NULL. */
  destinationBranchName: z.string().nullable(),
  /** LEFT JOIN inventory_lots — nullable when lot not found. */
  lotBatchNumber: z.string().nullable(),
  productName: z.string().nullable(),
})

const transferDetailSchema = transferResolvedSchema

// ── Manifest ─────────────────────────────────────────────────────────────────

export const inventoryTransfersContract = defineContract('inventory-transfers', {
  list: {
    method: 'GET',
    path: '/api/inventory-transfers',
    query: listQuery,
    response: z.array(transferResolvedSchema),
  },
  detail: {
    method: 'GET',
    path: '/api/inventory-transfers/:id',
    params: { id: transferIdParam },
    response: transferDetailSchema,
  },
  create: {
    method: 'POST',
    path: '/api/inventory-transfers',
    body: shipBody,
    response: transferPublicSchema,
  },
  receive: {
    method: 'POST',
    path: '/api/inventory-transfers/:id/receive',
    params: { id: transferIdParam },
    body: receiveBody,
    response: transferPublicSchema,
  },
  cancel: {
    method: 'POST',
    path: '/api/inventory-transfers/:id/cancel',
    params: { id: transferIdParam },
    body: cancelBody,
    response: transferPublicSchema,
  },
})

// ── Inferred response types (used by routes.ts `satisfies` assertions) ───────

export type InventoryTransfersListResponse = z.infer<typeof transferResolvedSchema>[]
export type InventoryTransfersDetailResponse = z.infer<typeof transferDetailSchema>
export type InventoryTransfersCreateResponse = z.infer<typeof transferPublicSchema>
export type InventoryTransfersReceiveResponse = z.infer<typeof transferPublicSchema>
export type InventoryTransfersCancelResponse = z.infer<typeof transferPublicSchema>
