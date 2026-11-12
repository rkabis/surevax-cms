/**
 * adverse-events API contract — schemas + endpoint manifest.
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

export const aveIdSchema = prefixedDisplayIdSchema('AVE')
export const patIdSchema = prefixedDisplayIdSchema('PAT')
export const encIdSchema = prefixedDisplayIdSchema('ENC')
export const ordIdSchema = prefixedDisplayIdSchema('ORD')

export const listQuerySchema = z.object({
  patientId: patIdSchema.optional(),
  /** Plain text column — not a pg enum. */
  severity: z.enum(['Mild', 'Moderate', 'Severe', 'LifeThreatening', 'Fatal']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

export const createBodySchema = z.object({
  patientId: patIdSchema,
  clinicalOrderId: ordIdSchema.optional().nullable(),
  encounterId: encIdSchema.optional().nullable(),
  caseNo: z.string().max(100).optional().nullable(),
  onsetAt: z.string().datetime().optional().nullable(),
  severity: z.enum(['Mild', 'Moderate', 'Severe', 'LifeThreatening', 'Fatal']),
  outcome: z
    .enum(['Recovered', 'Recovering', 'NotRecovered', 'RecoveredWithSequelae', 'Fatal', 'Unknown'])
    .optional()
    .nullable(),
  description: z.string().min(1).max(4000),
  symptomsCoded: z.unknown().optional().nullable(),
  treatmentGiven: z.string().max(2000).optional().nullable(),
  reportedToAuthorityAt: z.string().datetime().optional().nullable(),
  authorityReferenceNumber: z.string().max(200).optional().nullable(),
})

export const updateBodySchema = z.object({
  caseNo: z.string().max(100).optional().nullable(),
  severity: z.enum(['Mild', 'Moderate', 'Severe', 'LifeThreatening', 'Fatal']).optional(),
  outcome: z
    .enum(['Recovered', 'Recovering', 'NotRecovered', 'RecoveredWithSequelae', 'Fatal', 'Unknown'])
    .optional()
    .nullable(),
  description: z.string().min(1).max(4000).optional(),
  symptomsCoded: z.unknown().optional().nullable(),
  treatmentGiven: z.string().max(2000).optional().nullable(),
  reportedToAuthorityAt: z.string().datetime().optional().nullable(),
  authorityReferenceNumber: z.string().max(200).optional().nullable(),
})

// ── Response schemas (wire truth — keep in lockstep with db.ts) ──────────────

/**
 * Base row returned by both list and detail endpoints.
 * severity/outcome are plain text columns — not pg enums.
 */
const adverseEventBaseSchema = z.object({
  id: z.string(),
  caseNo: z.string().nullable(),
  tenantId: z.string(),
  /** patient display_id (PAT_…) */
  patientId: z.string(),
  /** clinical_order display_id (ORD_…) or null */
  clinicalOrderId: z.string().nullable(),
  /** encounter display_id (ENC_…) or null */
  encounterId: z.string().nullable(),
  reportedAt: z.string(),
  /**
   * NOTE: reportedById is a bigint user PK crossing the wire raw — a known
   * display-id convention leak, captured as-is. Flagged for a separate fix.
   */
  reportedById: z.number().nullable(),
  onsetAt: z.string().nullable(),
  /** plain text column — not a pg enum */
  severity: z.string(),
  /** plain text column — not a pg enum */
  outcome: z.string().nullable(),
  description: z.string(),
  /** JSONB — shape not modeled */
  symptomsCoded: z.unknown(),
  treatmentGiven: z.string().nullable(),
  reportedToAuthorityAt: z.string().nullable(),
  authorityReferenceNumber: z.string().nullable(),
  rowVersion: z.number(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /**
   * NOTE: createdById is a bigint user PK crossing the wire raw — a known
   * display-id convention leak, captured as-is. Flagged for a separate fix.
   */
  createdById: z.number().nullable(),
})

/**
 * List row: base + patient name fields + reportedByName.
 * patientFirstName/patientLastName come from an innerJoin but Drizzle widens
 * them to nullable in the select projection.
 */
const listRowSchema = adverseEventBaseSchema.extend({
  patientFirstName: z.string().nullable(),
  patientLastName: z.string().nullable(),
  reportedByName: z.string().nullable(),
})

/**
 * Detail row: base + patient names + reportedByName + clinicalOrder + encounter.
 * clinicalOrder and encounter come from LEFT JOINs — always nullable.
 */
const detailRowSchema = adverseEventBaseSchema.extend({
  patientFirstName: z.string().nullable(),
  patientLastName: z.string().nullable(),
  reportedByName: z.string().nullable(),
  clinicalOrder: z
    .object({
      id: z.string(),
      status: z.string(),
    })
    .nullable(),
  encounter: z
    .object({
      id: z.string(),
      specialty: z.string(),
      status: z.string(),
    })
    .nullable(),
})

const removeResponseSchema = z.object({ ok: z.literal(true) })

// ── Manifest ─────────────────────────────────────────────────────────────────

export const adverseEventsContract = defineContract('adverse-events', {
  list: {
    method: 'GET',
    path: '/api/adverse-events',
    query: listQuerySchema,
    response: z.array(listRowSchema),
  },
  detail: {
    method: 'GET',
    path: '/api/adverse-events/:id',
    params: { id: aveIdSchema },
    response: detailRowSchema,
  },
  create: {
    method: 'POST',
    path: '/api/adverse-events',
    body: createBodySchema,
    response: detailRowSchema,
  },
  update: {
    method: 'PATCH',
    path: '/api/adverse-events/:id',
    params: { id: aveIdSchema },
    body: updateBodySchema,
    response: detailRowSchema,
  },
  remove: {
    method: 'DELETE',
    path: '/api/adverse-events/:id',
    params: { id: aveIdSchema },
    response: removeResponseSchema,
  },
})

// ── Inferred response types (used by routes.ts `satisfies` assertions) ────────

export type AdverseEventsListResponse = z.infer<typeof listRowSchema>[]
export type AdverseEventsDetailResponse = z.infer<typeof detailRowSchema>
export type AdverseEventsCreateResponse = z.infer<typeof detailRowSchema>
export type AdverseEventsUpdateResponse = z.infer<typeof detailRowSchema>
export type AdverseEventsRemoveResponse = z.infer<typeof removeResponseSchema>
