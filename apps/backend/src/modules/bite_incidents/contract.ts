/**
 * bite-incidents API contract — schemas + endpoint manifest.
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

export const bitIdSchema = prefixedDisplayIdSchema('BIT')
export const aofIdSchema = prefixedDisplayIdSchema('AOF')
export const patIdSchema = prefixedDisplayIdSchema('PAT')
export const psoIdSchema = prefixedDisplayIdSchema('PSO')

const SPECIES = ['Dog', 'Cat', 'Bat', 'Monkey', 'Other'] as const
const VACCINATION_STATUS = ['Vaccinated', 'NotVaccinated', 'Unknown'] as const
const EXPOSURE_CATEGORIES = ['I', 'II', 'III'] as const
const OUTCOMES = [
  'AliveHealthy',
  'AliveSick',
  'DiedNaturally',
  'DiedUnknownCause',
  'KilledForTesting',
  'LostToFollowup',
] as const
const FAT_RESULTS = ['Positive', 'Negative', 'Pending', 'NotTested'] as const

export const createBody = z.object({
  patientId: patIdSchema,
  patientStandingOrderId: psoIdSchema.optional().nullable(),
  incidentNo: z.string().max(100).optional().nullable(),
  incidentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Incident date must be YYYY-MM-DD'),
  species: z.enum(SPECIES),
  animalVaccinationStatus: z.enum(VACCINATION_STATUS),
  animalVaccinationDocDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  animalAgeMonths: z.number().int().min(0).max(600).optional().nullable(),
  exposureCategory: z.enum(EXPOSURE_CATEGORIES),
  biteSite: z.string().min(1).max(500),
  requiresObservation: z.boolean().optional(),
  metadata: z.unknown().optional().nullable(),
})

export const patchBody = z.object({
  incidentNo: z.string().max(100).optional().nullable(),
  incidentDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  species: z.enum(SPECIES).optional(),
  animalVaccinationStatus: z.enum(VACCINATION_STATUS).optional(),
  animalVaccinationDocDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  animalAgeMonths: z.number().int().min(0).max(600).optional().nullable(),
  exposureCategory: z.enum(EXPOSURE_CATEGORIES).optional(),
  biteSite: z.string().min(1).max(500).optional(),
  requiresObservation: z.boolean().optional(),
  metadata: z.unknown().optional().nullable(),
})

export const recordOutcomeBody = z.object({
  outcome: z.enum(OUTCOMES),
  fatTestResult: z.enum(FAT_RESULTS).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
})

export const listQuerySchema = z.object({
  patientId: patIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

// ── Response schemas (wire truth — keep in lockstep with db.ts/service.ts) ──

/**
 * Serialized bite incident row — shape produced by serializeIncident() in db.ts.
 * NOTE: `createdById` is a bigint users PK crossing the wire raw — a known
 * display-id convention leak. Flagged for a separate fix.
 */
const biteIncidentRowSchema = z.object({
  id: z.string(),
  incidentNo: z.string().nullable(),
  tenantId: z.string(),
  patientId: z.string(),
  patientStandingOrderId: z.string().nullable(),
  incidentDate: z.string(),
  species: z.enum(SPECIES),
  animalVaccinationStatus: z.enum(VACCINATION_STATUS),
  animalVaccinationDocDate: z.string().nullable(),
  animalAgeMonths: z.number().nullable(),
  exposureCategory: z.enum(EXPOSURE_CATEGORIES),
  biteSite: z.string(),
  requiresObservation: z.boolean(),
  /** JSONB — shape not modeled. */
  metadata: z.unknown(),
  rowVersion: z.number(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /**
   * NOTE: bigint users PK crossing the wire raw — known display-id convention
   * leak; flagged for a separate fix.
   */
  createdById: z.number().nullable(),
})

/**
 * Serialized followup row — shape produced by serializeFollowup() in db.ts.
 * `outcomeRecordedById` (bigint users PK) is intentionally NOT exposed — no
 * bigint crosses the wire (display-id convention).
 */
const followupSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  biteIncidentId: z.string(),
  dueDate: z.string(),
  status: z.string(),
  outcome: z.string().nullable(),
  fatTestResult: z.string().nullable(),
  outcomeRecordedAt: z.string().nullable(),
  notes: z.string().nullable(),
  rowVersion: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** List row extends the base with patient name enrichments + the Day-14 followup. */
const listRowSchema = biteIncidentRowSchema.extend({
  patientFirstName: z.string(),
  patientLastName: z.string(),
  followup: followupSchema.nullable(),
})

const listResponseSchema = z.array(listRowSchema)

/** Detail response extends the base with full name enrichments + followup. */
const detailResponseSchema = biteIncidentRowSchema.extend({
  patientFirstName: z.string(),
  patientLastName: z.string(),
  createdByName: z.string().nullable(),
  followup: followupSchema.nullable(),
})

/** POST /api/bite-incidents — same shape as detail (calls getBiteIncident after insert). */
const createResponseSchema = detailResponseSchema

/** PATCH /api/bite-incidents/:id — same shape as detail. */
const updateResponseSchema = detailResponseSchema

/**
 * POST /:id/followups/:followupId/record-outcome response.
 * Returned by service.recordOutcomeAndMayCancelDay28.
 */
const recordOutcomeResponseSchema = z.object({
  followup: followupSchema,
  cancelsDay28: z.boolean(),
  /** patient display_id (PAT_…). */
  patientId: z.string(),
  cancelledOrderId: z.string().nullable(),
})

// ── Manifest ─────────────────────────────────────────────────────────────────

export const biteIncidentsContract = defineContract('bite-incidents', {
  list: {
    method: 'GET',
    path: '/api/bite-incidents',
    query: listQuerySchema,
    response: listResponseSchema,
  },
  detail: {
    method: 'GET',
    path: '/api/bite-incidents/:id',
    params: { id: bitIdSchema },
    response: detailResponseSchema,
  },
  create: {
    method: 'POST',
    path: '/api/bite-incidents',
    body: createBody,
    response: createResponseSchema,
  },
  update: {
    method: 'PATCH',
    path: '/api/bite-incidents/:id',
    params: { id: bitIdSchema },
    body: patchBody,
    response: updateResponseSchema,
  },
  recordOutcome: {
    method: 'POST',
    path: '/api/bite-incidents/:id/followups/:followupId/record-outcome',
    params: { id: bitIdSchema, followupId: aofIdSchema },
    body: recordOutcomeBody,
    response: recordOutcomeResponseSchema,
  },
})

// ── Inferred response types (used by routes.ts `satisfies` assertions) ───────

export type BiteIncidentsListResponse = z.infer<typeof listResponseSchema>
export type BiteIncidentsDetailResponse = z.infer<typeof detailResponseSchema>
export type BiteIncidentsCreateResponse = z.infer<typeof createResponseSchema>
export type BiteIncidentsUpdateResponse = z.infer<typeof updateResponseSchema>
export type BiteIncidentsRecordOutcomeResponse = z.infer<typeof recordOutcomeResponseSchema>
