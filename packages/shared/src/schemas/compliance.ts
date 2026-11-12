import { z } from 'zod'
import { prefixedDisplayIdSchema } from '../utils/displayId'

const evidenceReferenceSchema = z
  .string()
  .trim()
  .min(3)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/, 'must be an opaque evidence reference')

export const dpaPurgeImpactSchema = z.object({
  patientDisplayId: prefixedDisplayIdSchema('PAT'),
  acknowledgeDryRun: z.literal(true),
})

export const dpaErasureRequestSchema = z.object({
  patientDisplayId: prefixedDisplayIdSchema('PAT'),
  requestReference: evidenceReferenceSchema,
  legalBasis: z.enum(['data_subject_request', 'consent_withdrawal', 'retention_expiry']),
  // Structured values only: free text here would be copied into approval/audit
  // evidence and could become an accidental secondary store of PHI.
  retentionDecision: z.enum(['retain_required_records', 'no_additional_retention']),
  rollbackReference: evidenceReferenceSchema,
  acknowledgeIrreversible: z.literal(true),
  acknowledgeStatutoryDeletionIncomplete: z.literal(true),
})

export const dpaErasureExecuteSchema = z.object({
  patientDisplayId: prefixedDisplayIdSchema('PAT'),
  confirmation: z.literal('DEIDENTIFY PRIMARY STORE'),
  acknowledgeStatutoryDeletionIncomplete: z.literal(true),
})

export type DpaPurgeImpactInput = z.infer<typeof dpaPurgeImpactSchema>
export type DpaErasureRequestInput = z.infer<typeof dpaErasureRequestSchema>
export type DpaErasureExecuteInput = z.infer<typeof dpaErasureExecuteSchema>
