import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '@/lib/apiFetch'
// Wire types are generated from the backend contract — run `pnpm gen:contracts`.
import type {
  DaySummaryListResponse,
  DaySummaryLooseEndsResponse,
  DaySummarySnapshotResponse,
  DaySummaryCreateSnapshotResponse,
  DaySummaryTodayRosterResponse,
  DaySummarySetTodayRosterOwnerBody,
  DaySummarySetTodayRosterOwnerResponse,
} from '@/api/contracts/day-summary.gen'

// Feature-local aliases over the generated wire types — components keep
// importing these names.
export type DaySummary = DaySummaryListResponse
export type DaySummaryTransactions = DaySummary['transactions']
export type DaySummaryAdministrations = DaySummary['administrations']
export type DaySummaryAdministrationRow = DaySummaryAdministrations['rows'][number]
export type DaySummaryEncounters = DaySummary['encounters']
export type DaySummaryInventory = DaySummary['inventory']
export type DaySummaryInventoryRow = DaySummaryInventory['rows'][number]
export type DaySummaryDrawer = DaySummary['drawer']
export type DaySummaryDrawerRow = DaySummaryDrawer['rows'][number]
export type LooseEnds = DaySummaryLooseEndsResponse
export type DaySnapshot = DaySummarySnapshotResponse
export type { DaySummaryCreateSnapshotResponse }
export type TodayRosterSnapshot = DaySummaryTodayRosterResponse
export type TodayRosterRow = DaySummaryTodayRosterResponse['roster'][number]

export function useDaySummary(date: string) {
  return useQuery<DaySummary>({
    queryKey: ['day-summary', date],
    queryFn: () =>
      apiFetch<DaySummary>(`/api/day-summary?date=${encodeURIComponent(date)}`, { method: 'GET' }),
    enabled: Boolean(date),
  })
}

/** Complete branch-local clinic-day roster; never backed by dashboard limits. */
export function useTodayRoster(date: string) {
  return useQuery<TodayRosterSnapshot>({
    queryKey: ['day-summary', 'today-roster', date],
    queryFn: () =>
      apiFetch<TodayRosterSnapshot>(
        `/api/day-summary/today-roster?date=${encodeURIComponent(date)}`,
      ),
    enabled: Boolean(date),
    staleTime: 30_000,
  })
}

export function useSetTodayRosterOwner(date: string) {
  const qc = useQueryClient()
  return useMutation<
    DaySummarySetTodayRosterOwnerResponse,
    Error,
    { encounterId: string; body: DaySummarySetTodayRosterOwnerBody }
  >({
    mutationFn: ({ encounterId, body }) =>
      apiFetch(`/api/day-summary/today-roster/${encounterId}/owner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['day-summary', 'today-roster', date] })
      void qc.invalidateQueries({ queryKey: ['encounters'] })
    },
  })
}

/** Existing snapshot for a (branch, date), or null if none. */
export function useDaySnapshot(date: string) {
  return useQuery<DaySnapshot | null>({
    queryKey: ['day-summary', 'snapshot', date],
    queryFn: async () => {
      try {
        return await apiFetch<DaySnapshot>(
          `/api/day-summary/snapshot?date=${encodeURIComponent(date)}`,
          { method: 'GET' },
        )
      } catch (err) {
        if (err instanceof ApiError && err.statusCode === 404) return null
        throw err
      }
    },
    enabled: Boolean(date),
  })
}

export function useLooseEnds(date: string, enabled: boolean = true) {
  return useQuery<LooseEnds>({
    queryKey: ['day-summary', 'loose-ends', date],
    queryFn: () =>
      apiFetch<LooseEnds>(`/api/day-summary/loose-ends?date=${encodeURIComponent(date)}`, {
        method: 'GET',
      }),
    enabled: Boolean(date) && enabled,
  })
}

/** Snapshot the current Day Summary for a date. Re-snapshotting overwrites. */
export function useCreateDaySnapshot() {
  const qc = useQueryClient()
  return useMutation<DaySummaryCreateSnapshotResponse, unknown, { date: string }>({
    mutationFn: (input) =>
      apiFetch<DaySummaryCreateSnapshotResponse>(`/api/day-summary/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['day-summary', 'snapshot', vars.date] })
    },
  })
}
