import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { StaffTimeLog } from '@surevax/shared'
import { apiFetch } from '@/lib/apiFetch'
import type { DrawerSession } from '@/features/branch/api'

type ActiveShiftResponse = { data: StaffTimeLog | null }
type ShiftResponse = { data: StaffTimeLog }

/**
 * Response shape of `GET /api/shifts/current`, matching the backend's
 * `CurrentShift` projection field-for-field.
 *
 * Two frontend types used to describe this one endpoint and BOTH
 * under-declared it (this one omitted `startedAt`, `drawerBalance` and the
 * three day counters; dashboard's omitted the counters). Consolidated
 * 2026-07-26 — see `useCurrentShift` below for the cache-key half of the bug.
 */
export type CurrentShift = {
  id: string
  userId: string
  branchId: string
  openedAt: string
  startedAt: string
  floatAmount: string
  collectedSoFar: string
  drawerBalance: string
  drawerState: string
  cashierName: string
  encountersBookedToday: number
  dosesAdministeredToday: number
  dosesScheduledToday: number
  complianceRate: number
  drawerSession: DrawerSession | null
}

type CurrentShiftResponse = { data: CurrentShift | null }

export function useActiveShift(opts: { enabled?: boolean } = {}) {
  return useQuery<ActiveShiftResponse>({
    queryKey: ['shift', 'active'],
    queryFn: () => apiFetch('/api/staff-time-logs/active'),
    staleTime: 60_000,
    retry: false,
    enabled: opts.enabled !== false,
  })
}

/**
 * Current shift enriched with drawer fields (float, collected so far, state,
 * cashier name). Used by TenderRail in the cashier flow and the dashboard's
 * drawer KPI. Returns `data: null` when the caller hasn't clocked in.
 *
 * THE canonical hook for `/api/shifts/current` — don't add another `useQuery`
 * against it. Until 2026-07-26 the dashboard had its own copy keyed
 * `['shifts','current']` (plural) while this one and every clock-in/out
 * mutation use `['shift','current']`, so the two never shared a cache and the
 * dashboard's drawer KPI stayed stale after clocking in or out — the
 * invalidation simply never reached it.
 */
export function useCurrentShift(opts: { enabled?: boolean } = {}) {
  return useQuery<CurrentShiftResponse>({
    queryKey: ['shift', 'current'],
    queryFn: () => apiFetch('/api/shifts/current'),
    staleTime: 30_000,
    retry: false,
    enabled: opts.enabled !== false,
  })
}

export function useClockIn() {
  const qc = useQueryClient()
  // userId: target staff member when caller is a Branch session; ignored otherwise.
  return useMutation<ShiftResponse, Error, { branchId?: string; userId?: string }>({
    mutationFn: (body) =>
      apiFetch('/api/staff-time-logs/clock-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['shift', 'active'] })
      // Invalidate current shift so TenderRail reflects the new cashier state
      // without waiting for the 30s staleTime window.
      void qc.invalidateQueries({ queryKey: ['shift', 'current'] })
      void qc.invalidateQueries({ queryKey: ['branch', 'staff'] })
    },
  })
}

export function useClockOut() {
  const qc = useQueryClient()
  return useMutation<ShiftResponse, Error, { notes?: string; userId?: string }>({
    mutationFn: (body) =>
      apiFetch('/api/staff-time-logs/clock-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['shift', 'active'] })
      void qc.invalidateQueries({ queryKey: ['branch', 'staff'] })
    },
  })
}
