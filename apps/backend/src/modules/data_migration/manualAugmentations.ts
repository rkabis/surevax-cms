import { z } from 'zod'
import type {
  CanonicalDoseEvent,
  CanonicalEventLedger,
  ExternalAdministrationEvent,
} from './eventLedger.js'
import { sourceEnvelopeSchema } from './sourceEnvelope.js'

const isoTimestamp = z.string().datetime({ offset: true })
const identifier = z.string().min(1).max(200)

const matchBasisSchema = z
  .object({
    patientLegacyId: identifier,
    branchLegacyId: identifier.nullable(),
    rule: z.enum([
      'unique_multifield_match',
      'workbook_title_branch',
      'remarks_checked_external_d1',
    ]),
    confidence: z.enum(['deterministic', 'owner_approved', 'manual_verified']),
  })
  .strict()

const approvalSchema = z
  .object({
    augmentationId: identifier,
    disposition: z.literal('approved'),
    approvedBy: identifier,
    approvedAt: isoTimestamp,
    reasonCode: identifier,
    rationale: z.string().min(1).max(2000),
    match: matchBasisSchema,
    evidence: z.array(sourceEnvelopeSchema).min(1),
  })
  .strict()

const routeSchema = z.enum(['IM', 'ID', 'SC', 'IV', 'PO', 'IN', 'Topical', 'INF'])

const localAdministrationSchema = approvalSchema
  .extend({
    kind: z.literal('local_administration'),
    serviceId: identifier,
    doseNumber: z.number().int().positive().nullable().default(null),
    administeredAt: isoTimestamp,
    route: routeSchema.optional(),
    site: z.string().min(1).optional(),
    brandSnapshot: z.string().min(1).optional(),
    linkedTransactionLegacyId: identifier.optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.match.branchLegacyId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'local administration requires a resolved branchLegacyId',
      })
    }
  })

const remarksReviewSchema = z
  .object({
    checkedRemarkRowIds: z.array(identifier),
    conclusion: z.enum(['explicit_external', 'no_contradiction', 'contradiction']),
    note: z.string().min(1).max(2000),
  })
  .strict()

const externalAdministrationSchema = approvalSchema
  .extend({
    kind: z.literal('external_administration'),
    serviceId: identifier,
    doseNumber: z.number().int().positive(),
    administeredAt: isoTimestamp.nullable(),
    datePrecision: z.enum(['exact', 'unknown']),
    dateBasis: z.enum(['explicit_source_date', 'unknown_owner_assumption']),
    externalClinicName: z.string().min(1).optional(),
    externalClinicianName: z.string().min(1).optional(),
    externalNotes: z.string().min(1).optional(),
    remarksReview: remarksReviewSchema,
  })
  .superRefine((value, ctx) => {
    if (value.remarksReview.conclusion === 'contradiction') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a contradictory remarks review cannot create an external administration',
      })
    }
    if (value.dateBasis === 'unknown_owner_assumption') {
      if (value.administeredAt !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'unknown_owner_assumption must not carry a fabricated administeredAt',
        })
      }
      if (value.datePrecision !== 'unknown') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'unknown_owner_assumption requires datePrecision=unknown',
        })
      }
      if (value.match.rule !== 'remarks_checked_external_d1' || value.doseNumber !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'unknown-date external administration is limited to remarks-checked dose 1',
        })
      }
    } else {
      if (value.administeredAt === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'explicit external administration requires a date',
        })
      }
      if (value.datePrecision !== 'exact') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'explicit external administration requires datePrecision=exact',
        })
      }
    }
  })

const scheduledDoseSchema = approvalSchema.extend({
  kind: z.literal('scheduled_dose'),
  serviceId: identifier,
  doseNumber: z.number().int().positive(),
  patientStandingOrderLegacyId: identifier,
  scheduledAt: isoTimestamp,
  scheduleBasis: z.enum(['source_explicit', 'template_derived']),
})

export const manualAugmentationSchema = z.union([
  localAdministrationSchema,
  externalAdministrationSchema,
  scheduledDoseSchema,
])

export const augmentationBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: identifier,
    frozenSourceHash: z.string().regex(/^[a-f0-9]{64}$/i),
    entries: z.array(manualAugmentationSchema),
  })
  .strict()

export type ManualAugmentation = z.infer<typeof manualAugmentationSchema>
export type AugmentationBundle = z.infer<typeof augmentationBundleSchema>

export type ApplyAugmentationResult = {
  ledger: CanonicalEventLedger
  appliedAugmentationIds: string[]
  targetBlockedEventIds: string[]
}

export type AugmentationReferenceCatalog = {
  patientLegacyIds: ReadonlySet<string>
  branchLegacyIds: ReadonlySet<string>
  serviceIds: ReadonlySet<string>
  patientStandingOrderLegacyIds: ReadonlySet<string>
}

export type ApplyAugmentationOptions = {
  expectedFrozenSourceHash: string
  references: AugmentationReferenceCatalog
}

/**
 * Append approved facts to the canonical event ledger. This function never
 * mutates its inputs and intentionally does not map directly to DB rows.
 */
export function applyManualAugmentations(
  ledger: CanonicalEventLedger,
  rawBundle: unknown,
  options: ApplyAugmentationOptions,
): ApplyAugmentationResult {
  const bundle = augmentationBundleSchema.parse(rawBundle)
  if (bundle.frozenSourceHash.toLowerCase() !== options.expectedFrozenSourceHash.toLowerCase()) {
    throw new Error('augmentation frozenSourceHash does not match the migration source pack')
  }

  const existingEventIds = new Set(ledger.events.map((event) => event.eventId))
  const seenAugmentationIds = new Set<string>()
  const appended: CanonicalDoseEvent[] = []
  const targetBlockedEventIds: string[] = []

  for (const entry of bundle.entries) {
    if (seenAugmentationIds.has(entry.augmentationId)) {
      throw new Error(`duplicate augmentationId: ${entry.augmentationId}`)
    }
    seenAugmentationIds.add(entry.augmentationId)

    if (!options.references.patientLegacyIds.has(entry.match.patientLegacyId)) {
      throw new Error(`unknown patientLegacyId: ${entry.match.patientLegacyId}`)
    }
    if (
      entry.match.branchLegacyId &&
      !options.references.branchLegacyIds.has(entry.match.branchLegacyId)
    ) {
      throw new Error(`unknown branchLegacyId: ${entry.match.branchLegacyId}`)
    }
    if (!options.references.serviceIds.has(entry.serviceId)) {
      throw new Error(`unknown serviceId: ${entry.serviceId}`)
    }
    if (
      entry.kind === 'scheduled_dose' &&
      !options.references.patientStandingOrderLegacyIds.has(entry.patientStandingOrderLegacyId)
    ) {
      throw new Error(`unknown patientStandingOrderLegacyId: ${entry.patientStandingOrderLegacyId}`)
    }

    const eventId = `AUG::${entry.augmentationId}`
    if (existingEventIds.has(eventId)) {
      throw new Error(`augmentation already exists in ledger: ${entry.augmentationId}`)
    }

    const base = {
      eventId,
      patientLegacyId: entry.match.patientLegacyId,
      branchLegacyId: entry.match.branchLegacyId,
      serviceId: entry.serviceId,
      doseNumber: entry.doseNumber,
      confidence: entry.match.confidence,
      evidence: entry.evidence,
      augmentationId: entry.augmentationId,
    } as const

    if (entry.kind === 'local_administration') {
      appended.push({
        ...base,
        kind: entry.kind,
        administeredAt: entry.administeredAt,
        route: entry.route,
        site: entry.site,
        brandSnapshot: entry.brandSnapshot,
        linkedTransactionLegacyId: entry.linkedTransactionLegacyId,
      })
    } else if (entry.kind === 'external_administration') {
      const event: ExternalAdministrationEvent = {
        ...base,
        doseNumber: entry.doseNumber,
        kind: entry.kind,
        administeredAt: entry.administeredAt,
        datePrecision: entry.datePrecision,
        dateBasis: entry.dateBasis,
        externalClinicName: entry.externalClinicName,
        externalClinicianName: entry.externalClinicianName,
        externalNotes: entry.externalNotes,
      }
      appended.push(event)
    } else {
      appended.push({
        ...base,
        kind: entry.kind,
        doseNumber: entry.doseNumber,
        patientStandingOrderLegacyId: entry.patientStandingOrderLegacyId,
        scheduledAt: entry.scheduledAt,
        scheduleBasis: entry.scheduleBasis,
      })
    }
    existingEventIds.add(eventId)
  }

  return {
    ledger: {
      events: [...ledger.events, ...appended],
      exceptions: ledger.exceptions,
    },
    appliedAugmentationIds: [...seenAugmentationIds],
    targetBlockedEventIds,
  }
}
