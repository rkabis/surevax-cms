/**
 * lab-orders API contract — schemas + endpoint manifest.
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

/** Lab order display_ids (LBO_…) on every :id route param. */
export const labOrderIdSchema = prefixedDisplayIdSchema('LBO')

export const createLabOrderBody = z.object({
  clinicalOrderId: displayIdSchema,
  laboratoryId: prefixedDisplayIdSchema('LAB').optional(),
  externalOrderId: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
})

export const submitLabResultBody = z
  .object({
    resultData: z.record(z.unknown()).optional(),
    resultFileAttachmentId: z.number().int().positive().optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((d) => d.resultData !== undefined || d.resultFileAttachmentId !== undefined, {
    message: 'Provide structured result data OR a file attachment',
  })

export const listLabOrdersQuery = z.object({
  sort: z.enum(['created_at', 'status', 'sent_at']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
})

// ── Response schemas (wire truth — keep in lockstep with db.ts) ──────────────

/**
 * Flat row returned by listLabOrders — suitable for table rendering.
 * laboratoryName comes from a LEFT JOIN → widens to nullable even though the
 * source column is NOT NULL.
 */
const labOrderRowSchema = z.object({
  id: z.string(),
  status: z.string(),
  sentAt: z.string().nullable(),
  resultReceivedAt: z.string().nullable(),
  collectedAt: z.string().nullable(),
  hasCriticalValue: z.boolean(),
  externalOrderId: z.string().nullable(),
  laboratoryName: z.string().nullable(),
  serviceName: z.string(),
  /**
   * NOTE: resultFileAttachmentId is the bigint FK to attachments crossing the
   * wire as a JS number — a known id-type leak. Captured as-is; not fixed here.
   */
  resultFileAttachmentId: z.number().nullable(),
  createdAt: z.string(),
})

const createdBySchema = z.object({
  /**
   * NOTE: id here is the bigint PK crossing the wire raw — a known
   * display-id convention leak. Captured as-is; flagged for a separate fix.
   */
  id: z.number(),
  displayId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
})

/**
 * Full detail row returned by getLabOrder.
 *
 * Several bigint internal FKs cross the wire as numbers — known leaks,
 * modeled as z.number() with NOTE comments. laboratoryId / clinicalOrderId
 * come from LEFT/INNER JOINed display_id columns so they are correctly string.
 * patientName/laboratoryName/laboratoryId come from LEFT JOINs → nullable.
 */
const labOrderDetailSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  clinicalOrderId: z.string().nullable(),
  laboratoryId: z.string().nullable(),
  status: z.string(),
  externalOrderId: z.string().nullable(),
  collectedAt: z.string().nullable(),
  /** NOTE: bigint FK crossing the wire raw — known leak. */
  collectedById: z.number().nullable(),
  rejectionReason: z.string().nullable(),
  hasCriticalValue: z.boolean(),
  criticalValueAcknowledgedAt: z.string().nullable(),
  /** NOTE: bigint FK crossing the wire raw — known leak. */
  criticalValueAcknowledgedById: z.number().nullable(),
  /** JSONB — shape not modeled. */
  resultData: z.unknown(),
  /** NOTE: bigint FK to attachments crossing the wire raw — known leak. */
  resultFileAttachmentId: z.number().nullable(),
  sentAt: z.string().nullable(),
  resultReceivedAt: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** NOTE: bigint FK crossing the wire raw — known leak. */
  createdById: z.number().nullable(),
  createdBy: createdBySchema.nullable(),
  laboratoryName: z.string().nullable(),
  serviceName: z.string(),
  patientName: z.string().nullable(),
})

// ── Manifest ─────────────────────────────────────────────────────────────────

export const labOrdersContract = defineContract('lab-orders', {
  list: {
    method: 'GET',
    path: '/api/lab-orders',
    query: listLabOrdersQuery,
    response: z.array(labOrderRowSchema),
  },
  detail: {
    method: 'GET',
    path: '/api/lab-orders/:id',
    params: { id: labOrderIdSchema },
    response: labOrderDetailSchema,
  },
  create: {
    method: 'POST',
    path: '/api/lab-orders',
    body: createLabOrderBody,
    response: labOrderDetailSchema,
  },
  markSent: {
    method: 'POST',
    path: '/api/lab-orders/:id/mark-sent',
    params: { id: labOrderIdSchema },
    response: labOrderDetailSchema,
  },
  result: {
    method: 'POST',
    path: '/api/lab-orders/:id/result',
    params: { id: labOrderIdSchema },
    body: submitLabResultBody,
    response: labOrderDetailSchema,
  },
  acknowledgeCritical: {
    method: 'POST',
    path: '/api/lab-orders/:id/acknowledge-critical',
    params: { id: labOrderIdSchema },
    response: labOrderDetailSchema,
  },
})

// ── Inferred response types (used by routes.ts `satisfies` assertions) ───────

export type LabOrdersListResponse = z.infer<typeof labOrderRowSchema>[]
export type LabOrdersDetailResponse = z.infer<typeof labOrderDetailSchema>
export type LabOrdersCreateResponse = z.infer<typeof labOrderDetailSchema>
export type LabOrdersMarkSentResponse = z.infer<typeof labOrderDetailSchema>
export type LabOrdersResultResponse = z.infer<typeof labOrderDetailSchema>
export type LabOrdersAcknowledgeCriticalResponse = z.infer<typeof labOrderDetailSchema>
