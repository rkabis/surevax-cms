import { z } from 'zod'
import { branchDisplayIdSchema, prefixedDisplayIdSchema } from '../utils/displayId'

export const reportScopeSchema = z.enum(['branch', 'tenant'])
export const reportAgingBucketSchema = z.enum(['all', 'd0_30', 'd31_60', 'd61_90', 'd90plus'])
export const reconciliationStatusSchema = z.enum([
  'AwaitingReconciliation',
  'Disputed',
  'Failed',
  'Mismatch',
  'Pending',
])

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
const pagingSchema = {
  page: z.coerce.number().int().positive().max(10_000).default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
}
const scopedQueryShape = {
  scope: reportScopeSchema.default('branch'),
  branchId: branchDisplayIdSchema.optional(),
}

export const reportsOptionsQuerySchema = z.object({})
export const arAgingQuerySchema = z.object({
  ...scopedQueryShape,
  ...pagingSchema,
  payerId: z.union([prefixedDisplayIdSchema('PYR'), z.literal('self-pay')]).optional(),
  bucket: reportAgingBucketSchema.default('all'),
  asOf: isoDateSchema.optional(),
})
export const unbilledQuerySchema = z.object({
  ...scopedQueryShape,
  ...pagingSchema,
  q: z.string().trim().max(120).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  reconciliationRequired: z.enum(['all', 'true', 'false']).default('all'),
})
export const paymentExceptionsQuerySchema = z.object({
  ...scopedQueryShape,
  ...pagingSchema,
  payerId: prefixedDisplayIdSchema('PYR').optional(),
  status: reconciliationStatusSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
})
export const dailyRevenueQuerySchema = z.object({
  scope: z.literal('branch').default('branch'),
  branchId: branchDisplayIdSchema.optional(),
  date: isoDateSchema.optional(),
})
export const dailyRevenueExportBodySchema = dailyRevenueQuerySchema

const moneySchema = z.string().regex(/^-?\d+\.\d{2}$/)
const branchRefSchema = z.object({ id: z.string(), code: z.string(), name: z.string() })
const payerRefSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.enum(['HMO', 'Corporate', 'Government', 'Promo']),
  })
  .nullable()
const patientRefSchema = z.object({
  id: z.string(),
  mrn: z.string(),
  name: z.string(),
})
const pageSchema = z.object({ page: z.number(), limit: z.number(), total: z.number() })

export const reportsOptionsResponseSchema = z.object({
  allowedScopes: z.array(reportScopeSchema),
  canViewFinancial: z.boolean(),
  branches: z.array(branchRefSchema),
  payers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.enum(['HMO', 'Corporate', 'Government', 'Promo']),
    }),
  ),
})

export const arAgingResponseSchema = z.object({
  asOf: isoDateSchema,
  scope: reportScopeSchema,
  rows: z.array(
    z.object({
      branch: branchRefSchema,
      responsiblePayer: payerRefSchema,
      invoiceCount: z.number(),
      patientCount: z.number(),
      oldestAgeDays: z.number(),
      outstanding: moneySchema,
      aging: z.object({
        d0_30: moneySchema,
        d31_60: moneySchema,
        d61_90: moneySchema,
        d90plus: moneySchema,
      }),
    }),
  ),
  totals: z.object({
    invoiceCount: z.number(),
    payerCount: z.number(),
    branchCount: z.number(),
    outstanding: moneySchema,
    aging: z.object({
      d0_30: moneySchema,
      d31_60: moneySchema,
      d61_90: moneySchema,
      d90plus: moneySchema,
    }),
  }),
  pagination: pageSchema,
})

export const unbilledResponseSchema = z.object({
  scope: reportScopeSchema,
  rows: z.array(
    z.object({
      orderId: z.string(),
      patient: patientRefSchema,
      branch: branchRefSchema,
      serviceName: z.string(),
      completedAt: z.string(),
      administeredByName: z.string().nullable(),
      reconciliationRequired: z.boolean(),
      reason: z.enum(['No active billing link', 'Legacy reconciliation flag']),
    }),
  ),
  totals: z.object({ count: z.number(), reconciliationRequiredCount: z.number() }),
  pagination: pageSchema,
})

export const paymentExceptionsResponseSchema = z.object({
  scope: reportScopeSchema,
  rows: z.array(
    z.object({
      paymentId: z.string(),
      transactionId: z.string(),
      patient: patientRefSchema,
      branch: branchRefSchema,
      method: z.string(),
      amount: moneySchema,
      status: reconciliationStatusSchema,
      referenceNumber: z.string().nullable(),
      receivedAt: z.string(),
      responsiblePayer: payerRefSchema,
      tenderPayer: payerRefSchema,
    }),
  ),
  totals: z.object({ count: z.number(), amount: moneySchema }),
  pagination: pageSchema,
})

export const dailyRevenueResponseSchema = z.object({
  date: isoDateSchema,
  branch: branchRefSchema,
  generatedAt: z.string(),
  revenue: z.object({
    transactionCount: z.number(),
    transactionNetTotal: moneySchema,
    outstanding: moneySchema,
  }),
  tenders: z.array(z.object({ method: z.string(), count: z.number(), total: moneySchema })),
  deposits: z.object({ count: z.number(), total: moneySchema }),
  drawer: z.object({
    sessionCount: z.number(),
    declaredTotal: moneySchema,
    variance: moneySchema,
  }),
})

export const dailyRevenueExportResponseSchema = z.object({
  fileName: z.string(),
  contentType: z.literal('text/csv;charset=utf-8'),
  csv: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
})

export type ReportScope = z.infer<typeof reportScopeSchema>
export type ReportsOptionsResponse = z.infer<typeof reportsOptionsResponseSchema>
export type ArAgingQuery = z.infer<typeof arAgingQuerySchema>
export type ArAgingResponse = z.infer<typeof arAgingResponseSchema>
export type UnbilledQuery = z.infer<typeof unbilledQuerySchema>
export type UnbilledResponse = z.infer<typeof unbilledResponseSchema>
export type PaymentExceptionsQuery = z.infer<typeof paymentExceptionsQuerySchema>
export type PaymentExceptionsResponse = z.infer<typeof paymentExceptionsResponseSchema>
export type DailyRevenueQuery = z.infer<typeof dailyRevenueQuerySchema>
export type DailyRevenueResponse = z.infer<typeof dailyRevenueResponseSchema>
export type DailyRevenueExportBody = z.infer<typeof dailyRevenueExportBodySchema>
export type DailyRevenueExportResponse = z.infer<typeof dailyRevenueExportResponseSchema>
