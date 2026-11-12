/**
 * standing-orders API contract — schemas + endpoint manifest.
 *
 * Covers all five routers exported from routes.ts:
 *   - /api/standing-orders              (standingOrdersRouter)
 *   - /api/standing-order-templates     (standingOrderTemplatesRouter)
 *   - /api/patient-standing-orders      (patientStandingOrdersRouter)
 *   - /api/admin/standing-order-templates   (adminStandingOrderTemplatesRouter)
 *   - /api/admin/patient-standing-orders    (adminPatientStandingOrdersRouter)
 *
 * Request schemas are the runtime validators used by routes.ts; response
 * schemas describe the ACTUAL res.json payloads and are enforced against the
 * implementation via `satisfies` at each res.json callsite.
 *
 * Side-effect-free imports only (zod + pure shared utils) — the generator
 * imports this file without a configured environment.
 */
import { z } from 'zod'
import { catalogCodeSchema, prefixedDisplayIdSchema } from '../../shared/utils/displayId.js'
import { defineContract } from '../../contracts/defineContract.js'

// ── Request schemas (runtime validators for routes.ts) ──────────────────────

/** Template id: raw catalog code (text PK, e.g. RABIES_PEP_IM). */
export const templateIdSchema = catalogCodeSchema

/** PSO display_id (PSO_…). */
export const psoIdSchema = prefixedDisplayIdSchema('PSO')

export const startStandingOrderBody = z
  .object({
    patientId: prefixedDisplayIdSchema('PAT'),
    encounterId: prefixedDisplayIdSchema('ENC').optional(),
    templateId: catalogCodeSchema,
    authorizingProviderId: prefixedDisplayIdSchema('USR').optional(),
    startDate: z.string().date().optional(),
  })
  .strict()

export const updateTemplateBody = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    requiresPhysicianAuth: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()

export const createVersionBody = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    requiresPhysicianAuth: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()

export const appendExternalDoseBody = z
  .object({
    doseNumber: z.number().int().min(1),
    priorDoseDate: z.string().date(),
    serviceId: catalogCodeSchema,
    externalClinicianName: z.string().min(1).optional(),
    externalClinicName: z.string().min(1).optional(),
    externalNotes: z.string().optional(),
  })
  .strict()

export const psoStatusBody = z.object({ status: z.enum(['Active', 'Suspended']) }).strict()

// ── Response schemas (wire truth — keep in lockstep with db.ts/service.ts) ──

// ── /api/standing-orders ─────────────────────────────────────────────────────

/**
 * Row returned by listStandingOrderTemplates.
 * createdById is a bigint internal PK crossing the wire — a known leak.
 * NOTE: bigint leak — createdById should be resolved to a USR_ display_id.
 */
const standingOrderTemplateRowSchema = z.object({
  id: z.string(), // text PK (raw catalog code, e.g. RABIES_PEP_IM)
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  version: z.number(),
  requiresPhysicianAuth: z.boolean(),
  isActive: z.boolean(),
  isLocked: z.boolean(),
  specialty: z.string().nullable(),
  createdAt: z.string(), // timestamp serialized to string by res.json
  updatedAt: z.string(),
  /** NOTE: bigint internal PK crossing the wire — known leak. */
  createdById: z.number().nullable(),
})

const standingOrdersListResponseSchema = z.object({
  data: z.array(standingOrderTemplateRowSchema),
})

// Items inside the template detail response.
const templateItemSchema = z.object({
  id: z.string(), // STI_ display_id
  dayOffset: z.number(),
  sequence: z.number(),
  serviceId: z.string(),
  serviceName: z.string(),
  serviceCode: z.string(),
  /** numeric(8,2) — crosses the wire as a string. */
  quantity: z.string(),
  instructions: z.string().nullable(),
})

/**
 * Response for GET /api/standing-orders/:id.
 * All columns from standingOrderTemplates plus createdBy + items.
 * createdBy is from a LEFT JOIN so it can be null.
 */
const standingOrderDetailResponseSchema = z.object({
  data: z.object({
    // standingOrderTemplates.$inferSelect fields
    id: z.string(),
    tenantId: z.string(),
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    requiresPhysicianAuth: z.boolean(),
    version: z.number(),
    supersedesId: z.string().nullable(),
    supersededById: z.string().nullable(),
    isLocked: z.boolean(),
    rowVersion: z.number(),
    isActive: z.boolean(),
    specialty: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    /** NOTE: bigint internal PK crossing the wire — known leak. */
    createdById: z.number().nullable(),
    // LEFT-joined user; nullable because the join may not match.
    createdBy: z
      .object({
        /** NOTE: bigint internal PK crossing the wire — known leak. */
        id: z.number(),
        displayId: z.string(),
        firstName: z.string(),
        lastName: z.string(),
      })
      .nullable(),
    items: z.array(templateItemSchema),
  }),
})

// ── /api/standing-order-templates ─────────────────────────────────────────────

/**
 * Template item schema for the active-templates-with-items picker.
 * Service fields come from INNER JOIN serviceCatalog — not nullable.
 */
const activeTemplateItemSchema = z.object({
  id: z.string(), // STI_ display_id (standingOrderTemplateItems.displayId)
  dayOffset: z.number(),
  sequence: z.number(),
  serviceId: z.string(),
  serviceName: z.string(),
  serviceCode: z.string(),
  /** numeric(8,2) — crosses the wire as a string. */
  quantity: z.string(),
  instructions: z.string().nullable(),
})

const activeTemplateWithItemsSchema = standingOrderTemplateRowSchema.extend({
  items: z.array(activeTemplateItemSchema),
})

const templatesListResponseSchema = z.object({
  data: z.array(activeTemplateWithItemsSchema),
})

// ── /api/patient-standing-orders ──────────────────────────────────────────────

/**
 * Row returned by listPatientStandingOrders.
 * patientId is the patient display_id (PAT_…), not a bigint.
 * authorizingProviderId is a nullable bigint FK — crosses wire raw.
 * NOTE: authorizingProviderId bigint leak — should resolve to USR_ display_id.
 */
const psoListRowSchema = z.object({
  id: z.string(), // PSO_ display_id
  tenantId: z.string(),
  templateId: z.string(),
  templateName: z.string(),
  patientId: z.string(), // patient display_id (PAT_…)
  patientName: z.string(),
  status: z.enum(['Active', 'Suspended', 'Completed', 'Discontinued']),
  startDate: z.string(), // timestamp serialized by res.json
  endDate: z.string().nullable(),
  /** NOTE: bigint internal PK crossing the wire — known leak. */
  authorizingProviderId: z.number().nullable(),
  suspendedAt: z.string().nullable(),
  discontinuedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  dosesCompleted: z.number(),
  dosesTotal: z.number(),
})

const psoListResponseSchema = z.object({
  data: z.array(psoListRowSchema),
})

// Clinical order rows embedded in PSO detail.
const psoClinicalOrderSchema = z.object({
  id: z.string(), // ORD_ display_id
  doseNumber: z.number().nullable(),
  serviceId: z.string(),
  currentScheduledDate: z.string().nullable(),
  status: z.string(),
  completedAt: z.string().nullable(),
})

/**
 * Consent row — full select from `consents` table.
 * Many bigint PK columns cross the wire here — modeled as z.number().
 * NOTE: multiple bigint leaks (id, patientId, encounterId, obtainedById,
 *   signatureAttachmentId, witnessId, createdById) — should resolve to
 *   display_ids in a follow-up.
 */
const consentRowSchema = z.object({
  /** NOTE: bigint internal PK crossing the wire — known leak. */
  id: z.number(),
  displayId: z.string(),
  tenantId: z.string(),
  /** NOTE: bigint internal PK crossing the wire — known leak. */
  patientId: z.number(),
  /** NOTE: bigint internal PK crossing the wire — known leak. */
  encounterId: z.number().nullable(),
  consentType: z.string(),
  scope: z.string(),
  scopeRefType: z.string().nullable(),
  scopeRefId: z.string().nullable(),
  consenterRelation: z.string(),
  consenterName: z.string().nullable(),
  visProvided: z.boolean().nullable(),
  visVersion: z.string().nullable(),
  visDate: z.string().nullable(),
  visLanguage: z.string().nullable(),
  obtainedAt: z.string(),
  /** NOTE: bigint internal PK crossing the wire — known leak. */
  obtainedById: z.number().nullable(),
  consentLanguage: z.string().nullable(),
  /** NOTE: bigint internal PK crossing the wire — known leak. */
  signatureAttachmentId: z.number().nullable(),
  /** NOTE: bigint internal PK crossing the wire — known leak. */
  witnessId: z.number().nullable(),
  revokedAt: z.string().nullable(),
  revocationReason: z.string().nullable(),
  notes: z.string().nullable(),
  rowVersion: z.number(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** NOTE: bigint internal PK crossing the wire — known leak. */
  createdById: z.number().nullable(),
})

/**
 * Status history row from patientStandingOrdersStatusHistory.
 * entityId and changedById are bigint PKs crossing the wire.
 * NOTE: entityId + changedById bigint leaks.
 */
const psoStatusHistoryRowSchema = z.object({
  /** NOTE: bigint internal PK crossing the wire — known leak. */
  id: z.number(),
  tenantId: z.string(),
  /** NOTE: bigint internal PK crossing the wire — known leak. */
  entityId: z.number(),
  fromStatus: z.string().nullable(),
  toStatus: z.string(),
  reason: z.string().nullable(),
  changedAt: z.string(),
  /** NOTE: bigint internal PK crossing the wire — known leak. */
  changedById: z.number().nullable(),
  /** JSONB — shape not modeled. */
  metadata: z.unknown(),
})

/**
 * Response for GET /api/patient-standing-orders/:id.
 * Full PSO row (with bigint id stripped, displayId aliased to id) plus
 * clinicalOrders, consents, statusHistory.
 * Several bigint columns from the base PSO row also cross the wire.
 */
const psoDetailResponseSchema = z.object({
  data: z.object({
    id: z.string(), // PSO_ display_id
    tenantId: z.string(),
    /** NOTE: bigint internal PK crossing the wire — known leak. */
    patientId: z.number(),
    templateId: z.string(),
    /** NOTE: bigint internal PK crossing the wire — known leak. */
    initiatingEncounterId: z.number().nullable(),
    /** NOTE: bigint internal PK crossing the wire — known leak. */
    authorizingProviderId: z.number().nullable(),
    status: z.string(),
    startDate: z.string(),
    endDate: z.string().nullable(),
    /** NOTE: bigint internal PK crossing the wire — known leak. */
    suspendedById: z.number().nullable(),
    suspensionReason: z.string().nullable(),
    resumedAt: z.string().nullable(),
    suspendedAt: z.string().nullable(),
    discontinuedAt: z.string().nullable(),
    /** NOTE: bigint internal PK crossing the wire — known leak. */
    discontinuedById: z.number().nullable(),
    discontinuationReason: z.string().nullable(),
    notes: z.string().nullable(),
    rowVersion: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
    /** NOTE: bigint internal PK crossing the wire — known leak. */
    createdById: z.number().nullable(),
    clinicalOrders: z.array(psoClinicalOrderSchema),
    consents: z.array(consentRowSchema),
    statusHistory: z.array(psoStatusHistoryRowSchema),
  }),
})

// ── POST /api/patient-standing-orders response ───────────────────────────────

const createdClinicalOrderSchema = z.object({
  id: z.string(), // ORD_ display_id
  serviceId: z.string(),
  doseNumber: z.number().nullable(),
  currentScheduledDate: z.string().nullable(),
  status: z.string(),
})

const psoCreateResponseSchema = z.object({
  data: z.object({
    id: z.string(), // PSO_ display_id
    templateId: z.string(),
    status: z.string(),
    startDate: z.string(), // Date serialized to string by res.json
    clinicalOrders: z.array(createdClinicalOrderSchema),
  }),
})

// ── /api/admin/standing-order-templates ──────────────────────────────────────

/**
 * Response for PUT /api/admin/standing-order-templates/:id and
 * POST /api/admin/standing-order-templates/:id/versions.
 * Returns the full standingOrderTemplates.$inferSelect row.
 * Many bigint columns cross the wire.
 * NOTE: createdById bigint leak.
 */
const adminTemplateResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    tenantId: z.string(),
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    requiresPhysicianAuth: z.boolean(),
    version: z.number(),
    supersedesId: z.string().nullable(),
    supersededById: z.string().nullable(),
    isLocked: z.boolean(),
    rowVersion: z.number(),
    isActive: z.boolean(),
    specialty: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    /** NOTE: bigint internal PK crossing the wire — known leak. */
    createdById: z.number().nullable(),
  }),
})

// ── /api/admin/patient-standing-orders ───────────────────────────────────────

/**
 * Response for POST /api/admin/patient-standing-orders/:psoId/append-external-dose.
 * Returns the inserted clinical_orders row plus the pso display_id.
 */
const appendExternalDoseResponseSchema = z.object({
  data: z.object({
    id: z.string(), // ORD_ display_id
    patientStandingOrderId: z.string(), // PSO_ display_id
    serviceId: z.string(),
    doseNumber: z.number().nullable(),
    completedAt: z.string().nullable(),
    status: z.string(),
  }),
})

/**
 * Response for PATCH /api/admin/patient-standing-orders/:psoId/status.
 */
const psoStatusResponseSchema = z.object({
  data: z.object({
    id: z.string(), // PSO_ display_id
    status: z.string(),
    suspendedAt: z.string().nullable(),
  }),
})

// ── Manifest ─────────────────────────────────────────────────────────────────

export const standingOrdersContract = defineContract('standing-orders', {
  // /api/standing-orders
  list: {
    method: 'GET',
    path: '/api/standing-orders',
    query: z.object({ specialty: z.string().optional() }),
    response: standingOrdersListResponseSchema,
  },
  detail: {
    method: 'GET',
    path: '/api/standing-orders/:id',
    params: { id: templateIdSchema },
    response: standingOrderDetailResponseSchema,
  },

  // /api/standing-order-templates
  templatesList: {
    method: 'GET',
    path: '/api/standing-order-templates',
    response: templatesListResponseSchema,
  },

  // /api/patient-standing-orders
  psoList: {
    method: 'GET',
    path: '/api/patient-standing-orders',
    response: psoListResponseSchema,
  },
  psoDetail: {
    method: 'GET',
    path: '/api/patient-standing-orders/:id',
    params: { id: psoIdSchema },
    response: psoDetailResponseSchema,
  },
  psoCreate: {
    method: 'POST',
    path: '/api/patient-standing-orders',
    body: startStandingOrderBody,
    response: psoCreateResponseSchema,
  },

  // /api/admin/standing-order-templates
  adminTemplatesUpdate: {
    method: 'PUT',
    path: '/api/admin/standing-order-templates/:id',
    params: { id: templateIdSchema },
    body: updateTemplateBody,
    response: adminTemplateResponseSchema,
  },
  adminTemplatesVersions: {
    method: 'POST',
    path: '/api/admin/standing-order-templates/:id/versions',
    params: { id: templateIdSchema },
    body: createVersionBody,
    response: adminTemplateResponseSchema,
  },

  // /api/admin/patient-standing-orders
  adminPsoAppendExternalDose: {
    method: 'POST',
    path: '/api/admin/patient-standing-orders/:psoId/append-external-dose',
    params: { psoId: psoIdSchema },
    body: appendExternalDoseBody,
    response: appendExternalDoseResponseSchema,
  },
  adminPsoStatus: {
    method: 'PATCH',
    path: '/api/admin/patient-standing-orders/:psoId/status',
    params: { psoId: psoIdSchema },
    body: psoStatusBody,
    response: psoStatusResponseSchema,
  },
})

// ── Inferred response types (used by routes.ts `satisfies` assertions) ───────

export type StandingOrdersListResponse = z.infer<typeof standingOrdersListResponseSchema>
export type StandingOrdersDetailResponse = z.infer<typeof standingOrderDetailResponseSchema>
export type StandingOrdersTemplatesListResponse = z.infer<typeof templatesListResponseSchema>
export type StandingOrdersPsoListResponse = z.infer<typeof psoListResponseSchema>
export type StandingOrdersPsoDetailResponse = z.infer<typeof psoDetailResponseSchema>
export type StandingOrdersPsoCreateResponse = z.infer<typeof psoCreateResponseSchema>
export type StandingOrdersAdminTemplateResponse = z.infer<typeof adminTemplateResponseSchema>
export type StandingOrdersAdminPsoAppendExternalDoseResponse = z.infer<
  typeof appendExternalDoseResponseSchema
>
export type StandingOrdersAdminPsoStatusResponse = z.infer<typeof psoStatusResponseSchema>
