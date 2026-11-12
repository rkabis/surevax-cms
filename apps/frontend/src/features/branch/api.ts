import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/apiFetch'

export type BranchStaffRow = {
  id: string
  firstName: string
  lastName: string
  email: string
  role: string
  licenseNumber: string | null
  isActive: boolean
  canLogin: boolean
  activeShift: { id: string; clockInAt: string } | null
}

export type BranchPhysician = {
  id: string
  firstName: string
  lastName: string
  email: string
  role: string
  isActive: boolean
  licenseNumber: string | null
}

/**
 * Branch staff roster. Pass `enabled: false` from a caller that may render
 * nothing: hooks cannot be called conditionally, so a component that returns
 * null for some roles would otherwise still fetch and discard the whole
 * roster every time it mounts.
 */
export function useBranchStaff(opts?: { enabled?: boolean }) {
  return useQuery<{ data: BranchStaffRow[] }>({
    queryKey: ['branch', 'staff'],
    queryFn: () => apiFetch('/api/branch/staff'),
    staleTime: 30_000,
    enabled: opts?.enabled ?? true,
  })
}

/**
 * Physicians at the caller's branch — THE canonical hook for
 * `GET /api/branch/physicians`. Import it (or a re-export of it); do not
 * write another `useQuery` against this endpoint.
 *
 * Why this is centralised (fixed 2026-07-26): three hooks in three features
 * shared the `['branch','physicians']` cache key with **two different
 * shapes** — this one and appointments' cached the `{ data: [...] }`
 * envelope, while standing-orders' returned `res.data`, the unwrapped
 * array. TanStack caches by key, so whichever mounted first won and the
 * others read a shape they didn't expect: consumers doing `data.data` got
 * `undefined`, consumers expecting an array got an object. Symptom was a
 * silently empty physician dropdown, which on the protocol-initiation
 * sheet means the operator cannot record who authorised a standing order.
 *
 * The hook unwraps, so callers get `BranchPhysician[]` directly. Keep the
 * three staleTimes identical too — they were 60s / 5min / 60s, so the same
 * key also expired at three different times.
 */
export function useBranchPhysicians() {
  return useQuery<BranchPhysician[]>({
    queryKey: ['branch', 'physicians'],
    queryFn: async () => {
      const res: { data: BranchPhysician[] } = await apiFetch('/api/branch/physicians')
      return res.data
    },
    staleTime: 60_000,
  })
}

// ---------------------------------------------------------------------------
// Cash drawer
// ---------------------------------------------------------------------------

export type CashDeposit = {
  id: string
  amount: string
  depositSlipNumber: string | null
  depositedAt: string
  notes: string | null
  voidedAt: string | null
  voidReason: string | null
  recordedByName: string | null
}

export type DrawerSession = {
  id: string
  openingFloat: string
  closingTotalDeclared: string | null
  expectedTotal: string | null
  variance: string | null
  state: string
  openedAt: string
  closedAt: string | null
  /** Derived on every read, not stored: see cash_drawer/db.ts computeCashFigures. */
  cashCollected: string | null
  depositsTotal: string | null
  onHandCash: string | null
  deposits: CashDeposit[]
}

export function useCurrentDrawer(opts?: { enabled?: boolean }) {
  return useQuery<DrawerSession>({
    queryKey: ['cash-drawer', 'current'],
    queryFn: () => apiFetch('/api/cash-drawer/current'),
    enabled: opts?.enabled ?? true,
    retry: (count, err) => {
      if (
        err &&
        typeof err === 'object' &&
        'statusCode' in err &&
        (err as { statusCode: number }).statusCode === 404
      )
        return false
      return count < 2
    },
    staleTime: 30_000,
  })
}

export function useOpenDrawer() {
  const qc = useQueryClient()
  return useMutation<DrawerSession, Error, { openingFloat: string }>({
    mutationFn: ({ openingFloat }) =>
      apiFetch('/api/cash-drawer/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openingFloat }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cash-drawer'] })
    },
  })
}

export function useCloseDrawer() {
  const qc = useQueryClient()
  return useMutation<DrawerSession, Error, { sessionId: string; closingTotalDeclared: string }>({
    mutationFn: ({ sessionId, closingTotalDeclared }) =>
      apiFetch('/api/cash-drawer/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, closingTotalDeclared }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cash-drawer'] })
    },
  })
}

export function useRecordDeposit() {
  const qc = useQueryClient()
  return useMutation<
    CashDeposit,
    Error,
    { amount: string; depositSlipNumber?: string; notes?: string }
  >({
    mutationFn: (body) =>
      apiFetch('/api/cash-drawer/deposits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cash-drawer'] })
    },
  })
}

export function useVoidDeposit() {
  const qc = useQueryClient()
  return useMutation<CashDeposit, Error, { depositId: string; reason: string }>({
    mutationFn: ({ depositId, reason }) =>
      apiFetch(`/api/cash-drawer/deposits/${depositId}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cash-drawer'] })
    },
  })
}
