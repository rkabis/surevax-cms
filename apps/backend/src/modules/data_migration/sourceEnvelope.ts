import { z } from 'zod'

export const sourceKindSchema = z.enum([
  'manual_sales_tracker',
  'appsheet_patient',
  'appsheet_immunization',
  'appsheet_transaction',
  'appsheet_remark',
  'owner_decision',
])

/**
 * Immutable location of a source observation. The workbook branch is carried
 * separately from any branch value inside the row so reconciliation can apply
 * the owner-approved workbook-first branch rule without losing the raw value.
 */
export const sourceEnvelopeSchema = z
  .object({
    source: sourceKindSchema,
    fileId: z.string().min(1).optional(),
    revisionId: z.string().min(1).optional(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional(),
    workbookTitle: z.string().min(1).optional(),
    workbookBranchLegacyId: z.string().min(1).optional(),
    sheet: z.string().min(1).optional(),
    rowNumber: z.number().int().positive().optional(),
    rowId: z.string().min(1).optional(),
    rowHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.rowId && !value.rowHash && !value.rowNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'source evidence needs rowId, rowHash, or rowNumber',
      })
    }
    if (value.source === 'manual_sales_tracker' && !value.workbookBranchLegacyId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'manual sales evidence requires workbookTitle-derived branch',
      })
    }
  })

export type SourceKind = z.infer<typeof sourceKindSchema>
export type SourceEnvelope = z.infer<typeof sourceEnvelopeSchema>
