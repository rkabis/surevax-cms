// GENERATED FILE — do not edit.
// Source: apps/backend/src/modules — contract 'reports'.
// Regenerate with `pnpm gen:contracts`; CI fails on drift.

export type ReportsOptionsQuery = Record<string, never>

export type ReportsOptionsResponse = {
  allowedScopes: ('branch' | 'tenant')[]
  canViewFinancial: boolean
  branches: { id: string; code: string; name: string }[]
  payers: { id: string; name: string; type: 'HMO' | 'Corporate' | 'Government' | 'Promo' }[]
}

export type ReportsArAgingQuery = {
  scope?: 'branch' | 'tenant'
  branchId?: string
  page?: number
  limit?: number
  payerId?: string | 'self-pay'
  bucket?: 'all' | 'd0_30' | 'd31_60' | 'd61_90' | 'd90plus'
  asOf?: string
}

export type ReportsArAgingResponse = {
  asOf: string
  scope: 'branch' | 'tenant'
  rows: {
    branch: { id: string; code: string; name: string }
    responsiblePayer: {
      id: string
      name: string
      type: 'HMO' | 'Corporate' | 'Government' | 'Promo'
    } | null
    invoiceCount: number
    patientCount: number
    oldestAgeDays: number
    outstanding: string
    aging: { d0_30: string; d31_60: string; d61_90: string; d90plus: string }
  }[]
  totals: {
    invoiceCount: number
    payerCount: number
    branchCount: number
    outstanding: string
    aging: { d0_30: string; d31_60: string; d61_90: string; d90plus: string }
  }
  pagination: { page: number; limit: number; total: number }
}

export type ReportsUnbilledQuery = {
  scope?: 'branch' | 'tenant'
  branchId?: string
  page?: number
  limit?: number
  q?: string
  from?: string
  to?: string
  reconciliationRequired?: 'all' | 'true' | 'false'
}

export type ReportsUnbilledResponse = {
  scope: 'branch' | 'tenant'
  rows: {
    orderId: string
    patient: { id: string; mrn: string; name: string }
    branch: { id: string; code: string; name: string }
    serviceName: string
    completedAt: string
    administeredByName: string | null
    reconciliationRequired: boolean
    reason: 'No active billing link' | 'Legacy reconciliation flag'
  }[]
  totals: { count: number; reconciliationRequiredCount: number }
  pagination: { page: number; limit: number; total: number }
}

export type ReportsPaymentExceptionsQuery = {
  scope?: 'branch' | 'tenant'
  branchId?: string
  page?: number
  limit?: number
  payerId?: string
  status?: 'AwaitingReconciliation' | 'Disputed' | 'Failed' | 'Mismatch' | 'Pending'
  from?: string
  to?: string
}

export type ReportsPaymentExceptionsResponse = {
  scope: 'branch' | 'tenant'
  rows: {
    paymentId: string
    transactionId: string
    patient: { id: string; mrn: string; name: string }
    branch: { id: string; code: string; name: string }
    method: string
    amount: string
    status: 'AwaitingReconciliation' | 'Disputed' | 'Failed' | 'Mismatch' | 'Pending'
    referenceNumber: string | null
    receivedAt: string
    responsiblePayer: {
      id: string
      name: string
      type: 'HMO' | 'Corporate' | 'Government' | 'Promo'
    } | null
    tenderPayer: {
      id: string
      name: string
      type: 'HMO' | 'Corporate' | 'Government' | 'Promo'
    } | null
  }[]
  totals: { count: number; amount: string }
  pagination: { page: number; limit: number; total: number }
}

export type ReportsDailyRevenueQuery = { scope?: 'branch'; branchId?: string; date?: string }

export type ReportsDailyRevenueResponse = {
  date: string
  branch: { id: string; code: string; name: string }
  generatedAt: string
  revenue: { transactionCount: number; transactionNetTotal: string; outstanding: string }
  tenders: { method: string; count: number; total: string }[]
  deposits: { count: number; total: string }
  drawer: { sessionCount: number; declaredTotal: string; variance: string }
}

export type ReportsDailyRevenueExportBody = { scope?: 'branch'; branchId?: string; date?: string }

export type ReportsDailyRevenueExportResponse = {
  fileName: string
  contentType: 'text/csv;charset=utf-8'
  csv: string
  sha256: string
}

export const reportsEndpoints = {
  options: { method: 'GET', path: '/api/reports/options' },
  arAging: { method: 'GET', path: '/api/reports/ar-aging' },
  unbilled: { method: 'GET', path: '/api/reports/administered-unbilled' },
  paymentExceptions: { method: 'GET', path: '/api/reports/payment-exceptions' },
  dailyRevenue: { method: 'GET', path: '/api/reports/daily-revenue' },
  dailyRevenueExport: { method: 'POST', path: '/api/reports/daily-revenue/export' },
} as const
