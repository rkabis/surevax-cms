import { useMutation, useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/apiFetch'
import type {
  ReportsOptionsResponse,
  ReportsArAgingQuery,
  ReportsArAgingResponse,
  ReportsUnbilledQuery,
  ReportsUnbilledResponse,
  ReportsPaymentExceptionsQuery,
  ReportsPaymentExceptionsResponse,
  ReportsDailyRevenueQuery,
  ReportsDailyRevenueResponse,
  ReportsDailyRevenueExportBody,
  ReportsDailyRevenueExportResponse,
} from '@/api/contracts/reports.gen'

function queryString(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function useReportOptions() {
  return useQuery<ReportsOptionsResponse>({
    queryKey: ['reports', 'options'],
    queryFn: () => apiFetch('/api/reports/options'),
  })
}

export function useArAging(query: ReportsArAgingQuery, enabled: boolean) {
  return useQuery<ReportsArAgingResponse>({
    queryKey: ['reports', 'ar-aging', query],
    queryFn: () => apiFetch(`/api/reports/ar-aging${queryString(query)}`),
    enabled,
  })
}

export function useUnbilled(query: ReportsUnbilledQuery, enabled: boolean) {
  return useQuery<ReportsUnbilledResponse>({
    queryKey: ['reports', 'administered-unbilled', query],
    queryFn: () => apiFetch(`/api/reports/administered-unbilled${queryString(query)}`),
    enabled,
  })
}

export function usePaymentExceptions(query: ReportsPaymentExceptionsQuery, enabled: boolean) {
  return useQuery<ReportsPaymentExceptionsResponse>({
    queryKey: ['reports', 'payment-exceptions', query],
    queryFn: () => apiFetch(`/api/reports/payment-exceptions${queryString(query)}`),
    enabled,
  })
}

export function useDailyRevenue(query: ReportsDailyRevenueQuery, enabled: boolean) {
  return useQuery<ReportsDailyRevenueResponse>({
    queryKey: ['reports', 'daily-revenue', query],
    queryFn: () => apiFetch(`/api/reports/daily-revenue${queryString(query)}`),
    enabled,
  })
}

export function useDailyRevenueExport() {
  return useMutation<ReportsDailyRevenueExportResponse, unknown, ReportsDailyRevenueExportBody>({
    mutationFn: (body) =>
      apiFetch('/api/reports/daily-revenue/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
  })
}

export type ArRow = ReportsArAgingResponse['rows'][number]
export type UnbilledRow = ReportsUnbilledResponse['rows'][number]
export type PaymentExceptionRow = ReportsPaymentExceptionsResponse['rows'][number]
export type DailyRevenue = ReportsDailyRevenueResponse
export type DailyRevenueExport = ReportsDailyRevenueExportResponse
