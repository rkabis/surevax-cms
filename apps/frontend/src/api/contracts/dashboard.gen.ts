// GENERATED FILE — do not edit.
// Source: apps/backend/src/modules — contract 'dashboard'.
// Regenerate with `pnpm gen:contracts`; CI fails on drift.

export type DashboardListResponse = {
  stats: {
    patientsToday: number
    encountersToday: number
    scheduledOrdersDueToday: number
    pendingPayments: number
    walkInCount: number
    bookedCount: number
    unsettledTotal: string
    cashCollectedToday: string
    nonCashCollectedToday: string
    trend7d: { arrivals: number[]; revenue: string[]; unsettled: number[] }
  }
  scheduledOrderStats: {
    dueCount: number
    overdueCount: number
    backfillCount: number
    upcomingCount: number
  }
  recentEncounters: {
    id: string
    patientDisplayId: string
    patientName: string
    specialty: string | null
    status: string
    attendingClinicianName: string | null
    time: string
    completedAt: string | null
  }[]
  scheduledOrdersDue: {
    id: string
    patientName: string
    service: string
    doseNumber: number
    scheduledDate: string
  }[]
  lowStock: {
    id: string
    name: string
    batchNumber: string
    quantityOnHand: number
    expiryDate: string | null
  }[]
}

export type DashboardNudgesResponse = {
  id: string
  kind: 'overdue_order' | 'pending_transaction' | 'low_stock'
  label: string
  sub: string
  severity: 'overdue' | 'due' | 'info'
  dueAt: string | null
  link: string
}[]

export const dashboardEndpoints = {
  list: { method: 'GET', path: '/api/dashboard' },
  nudges: { method: 'GET', path: '/api/dashboard/nudges' },
} as const
