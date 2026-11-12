/**
 * arrivals API contract — schemas + endpoint manifest.
 *
 * Request schemas are the runtime validators used by routes.ts; response
 * schemas describe the ACTUAL res.json payloads and are enforced against
 * the implementation via `satisfies` at each res.json callsite.
 *
 * Side-effect-free imports only (zod + pure shared utils) — the generator
 * imports this file without a configured environment.
 */
import { z } from 'zod'
import { prefixedDisplayIdSchema, catalogCodeSchema } from '../../shared/utils/displayId.js'
import { defineContract } from '../../contracts/defineContract.js'

// ── Request schemas (runtime validators for routes.ts) ──────────────────────

export const previewQuerySchema = z
  .object({
    // templateId is a catalog code (raw uppercase, e.g. ARVPEP_IM) — not a prefixed display_id
    templateId: catalogCodeSchema.optional(),
    // Comma-separated catalog codes — multi-protocol preview (Cat III: ARV + RIG + ATS)
    templateIds: z.string().max(300).optional(),
    triageCategory: z.string().max(20).optional(),
    patientWeight: z.coerce.number().positive().optional(),
  })
  .refine((q) => q.templateId || q.templateIds, {
    message: 'templateId or templateIds is required',
  })

export const atomicBodySchema = z
  .object({
    // patientId is the public-facing PAT_<8 base32> display_id
    patientId: prefixedDisplayIdSchema('PAT'),
    triageCategory: z.string().max(20).optional(),
    // templateId is a catalog code (raw uppercase, e.g. ARVPEP_IM) — not a prefixed display_id.
    // Kept for back-compat; new clients send templateIds.
    templateId: catalogCodeSchema.optional(),
    // Multi-protocol commit — one PSO per template, all in the same transaction
    // (Cat III: ARV course + ERIG + ATS committed together).
    templateIds: z.array(catalogCodeSchema).min(1).max(5).optional(),
    // authorizingProviderId is the public-facing USR_<8 base32> display_id
    authorizingProviderId: prefixedDisplayIdSchema('USR').optional(),
    // Choosing a clinical pathway is an explicit intake decision. The API must
    // not silently turn an omitted value into a Rabies encounter.
    specialty: z.enum(['Rabies', 'Flu', 'Vaccination', 'General']),
    /** Explicitly attested before the arrival creates the active consent row. */
    consentObtained: z.literal(true),
    /** The patient or guardian who gave the arrival consent. */
    consentBy: z.enum(['Patient', 'Guardian']),
    chiefComplaint: z.string().max(2000).optional(),
    specialtyData: z.record(z.unknown()).optional(),
    clinicalNotes: z.record(z.unknown()).optional(),
    /** ISO date string for start date; defaults to today if omitted */
    startDate: z.string().optional(),
  })
  .refine((b) => b.templateId || (b.templateIds && b.templateIds.length > 0), {
    message: 'templateId or templateIds is required',
  })
  .superRefine((body, ctx) => {
    if (body.specialty !== 'Rabies') return

    const biteAssessment = body.specialtyData?.['biteAssessment']
    const whoCategory =
      biteAssessment && typeof biteAssessment === 'object'
        ? (biteAssessment as Record<string, unknown>)['whoCategory']
        : undefined

    if (whoCategory !== 'I' && whoCategory !== 'II' && whoCategory !== 'III') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['specialtyData', 'biteAssessment', 'whoCategory'],
        message: 'Rabies arrivals require a WHO exposure category.',
      })
      return
    }

    // Do not allow two conflicting classifications in the same clinical write.
    if (body.triageCategory !== undefined && body.triageCategory !== whoCategory) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['triageCategory'],
        message: 'Triage category must match the WHO exposure category.',
      })
    }
  })

// ── Response schemas (wire truth — keep in lockstep with db.ts/service.ts) ──

const previewBundleItemSchema = z.object({
  service: z.object({
    /** service_catalog.id — the raw catalog code (e.g. ARVPEP_IM), not a prefixed display_id */
    id: z.string(),
    name: z.string(),
    sku: z.string().nullable(),
  }),
  lot: z
    .object({
      /** inventory_lots.display_id — LOT_<8 base32> */
      id: z.string(),
      batchNumber: z.string(),
    })
    .nullable(),
  expiryDate: z.string().nullable(),
  doseSize: z.string().nullable(),
  /** numeric(N,M) — crosses the wire as a string */
  qty: z.string(),
  /** numeric(N,M) — crosses the wire as a string */
  unitPrice: z.string(),
  /** numeric(N,M) — crosses the wire as a string */
  subtotal: z.string(),
})

const previewBundleResponseSchema = z.object({
  items: z.array(previewBundleItemSchema),
  /** numeric string */
  total: z.string(),
})

const atomicResponseSchema = z.object({
  encounterId: z.string(),
  /** First created PSO — kept for back-compat with single-protocol flows. */
  patientStandingOrderId: z.string(),
  patientStandingOrderIds: z.array(z.string()),
  scheduledOrderIds: z.array(z.string()),
  /** Set when the Rabies bite assessment captured WHO exposure category. */
  biteIncidentId: z.string().nullable(),
})

// ── Manifest ─────────────────────────────────────────────────────────────────

export const arrivalsContract = defineContract('arrivals', {
  previewBundle: {
    method: 'GET',
    path: '/api/arrivals/preview-bundle',
    query: previewQuerySchema,
    response: previewBundleResponseSchema,
  },
  atomic: {
    method: 'POST',
    path: '/api/arrivals/atomic',
    body: atomicBodySchema,
    response: atomicResponseSchema,
  },
})

// ── Inferred response types (used by routes.ts `satisfies` assertions) ───────

export type ArrivalsPreviewBundleResponse = z.infer<typeof previewBundleResponseSchema>
export type ArrivalsAtomicResponse = z.infer<typeof atomicResponseSchema>
