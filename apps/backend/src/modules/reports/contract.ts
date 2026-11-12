import { createRequire } from 'node:module'
import type * as SharedReports from '@surevax/shared/reports'
import { defineContract } from '../../contracts/defineContract.js'

// @surevax/shared currently publishes CommonJS. createRequire avoids the
// Node/tsx named-export interop ambiguity while keeping the shared Zod module
// as the runtime contract source.
const reportSchemas = createRequire(import.meta.url)(
  '@surevax/shared/reports',
) as typeof SharedReports

export const reportsContract = defineContract('reports', {
  options: {
    method: 'GET',
    path: '/api/reports/options',
    query: reportSchemas.reportsOptionsQuerySchema,
    response: reportSchemas.reportsOptionsResponseSchema,
  },
  arAging: {
    method: 'GET',
    path: '/api/reports/ar-aging',
    query: reportSchemas.arAgingQuerySchema,
    response: reportSchemas.arAgingResponseSchema,
  },
  unbilled: {
    method: 'GET',
    path: '/api/reports/administered-unbilled',
    query: reportSchemas.unbilledQuerySchema,
    response: reportSchemas.unbilledResponseSchema,
  },
  paymentExceptions: {
    method: 'GET',
    path: '/api/reports/payment-exceptions',
    query: reportSchemas.paymentExceptionsQuerySchema,
    response: reportSchemas.paymentExceptionsResponseSchema,
  },
  dailyRevenue: {
    method: 'GET',
    path: '/api/reports/daily-revenue',
    query: reportSchemas.dailyRevenueQuerySchema,
    response: reportSchemas.dailyRevenueResponseSchema,
  },
  dailyRevenueExport: {
    method: 'POST',
    path: '/api/reports/daily-revenue/export',
    body: reportSchemas.dailyRevenueExportBodySchema,
    response: reportSchemas.dailyRevenueExportResponseSchema,
  },
})
