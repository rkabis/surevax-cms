import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/apiFetch'
// Wire types are generated from the backend contract — run `pnpm gen:contracts`.
import type { DashboardListResponse, DashboardNudgesResponse } from '@/api/contracts/dashboard.gen'

// Feature-local aliases over the generated wire types — components keep
// importing these names.
export type DashboardData = DashboardListResponse
export type DashboardStats = DashboardListResponse['stats']
export type DashboardTrend7d = DashboardListResponse['stats']['trend7d']
export type DashboardEncounter = DashboardListResponse['recentEncounters'][number]
export type DashboardScheduledOrder = DashboardListResponse['scheduledOrdersDue'][number]
export type DashboardLowStockLot = DashboardListResponse['lowStock'][number]
export type Nudge = DashboardNudgesResponse[number]

export type AuditEntry = {
  id: string
  timestamp: string
  action: string
  entityType: string
  entityId: string | null
  severity: 'warning' | 'info'
  /** Legacy human-readable sentence; kept for backward compat. */
  message: string
  /** Structured fields added alongside message (audit/routes.ts mapMessage). */
  actor?: string
  structuredAction?: string
  structuredEntityType?: string
  structuredEntityId?: string | null
}

// Canonical in `features/shift/api.ts` (which owns /api/shifts/current).
// This was a second declaration of the same payload — re-exported so
// existing imports from this module keep working.
export type { CurrentShift } from '@/features/shift/api'

export function useDashboard() {
  return useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: () => apiFetch('/api/dashboard'),
    staleTime: 30_000,
  })
}

export function useDashboardNudges() {
  return useQuery<Nudge[]>({
    queryKey: ['dashboard', 'nudges'],
    queryFn: () => apiFetch('/api/dashboard/nudges'),
    staleTime: 60_000,
  })
}

/**
 * `/api/audit` is mounted `requireRole('TenantAdmin', 'BranchAdmin')`
 * (apps/backend/src/app.ts): the `Branch` account (the only login a real
 * clinic uses) always gets a 403 here. Callers must pass `enabled: false`
 * for roles that cannot load this so the request is never even attempted,
 * rather than firing it and swallowing the 403 as an empty list.
 */
export function useAuditRecent(hours = 24, options?: { enabled?: boolean }) {
  return useQuery<AuditEntry[]>({
    queryKey: ['audit', 'recent', hours],
    queryFn: () => apiFetch(`/api/audit/recent?hours=${hours}`),
    staleTime: 60_000,
    enabled: options?.enabled ?? true,
  })
}

// The current shift comes from the canonical hook in `features/shift/api.ts`.
// This module used to hold a duplicate keyed `['shifts','current']` (plural)
// with its own narrower type, so clock-in/out invalidations — which target
// `['shift','current']` — never reached the dashboard's drawer KPI.
// Re-exported so existing imports from this module keep working.
export { useCurrentShift } from '@/features/shift/api'
