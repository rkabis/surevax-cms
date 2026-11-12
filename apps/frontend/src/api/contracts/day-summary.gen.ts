// GENERATED FILE — do not edit.
// Source: apps/backend/src/modules — contract 'day-summary'.
// Regenerate with `pnpm gen:contracts`; CI fails on drift.

export type DaySummaryListQuery = { date?: string }

export type DaySummaryListResponse = {
  date: string
  branchId: string
  branchName: string
  generatedAt: string
  transactions: {
    count: number
    totalRevenue: string
    totalUnsettled: string
    byMethod: { method: string; count: number; total: string }[]
    byStatus: { status: string; count: number; total: string }[]
  }
  administrations: {
    count: number
    rows: {
      orderId: string
      patientId: string
      patientName: string
      serviceName: string
      lotNumber: string | null
      administeredAt: string
      administeredByName: string | null
    }[]
  }
  encounters: {
    count: number
    byBundle: { bundleLabel: string; count: number }[]
    byWhoCategory: { category: string; count: number }[]
  }
  inventory: {
    movementCount: number
    rows: {
      movementId: string
      lotNumber: string
      serviceName: string
      direction: 'in' | 'out' | 'adjust'
      quantity: number
      reasonCode: string | null
      occurredAt: string
    }[]
  }
  drawer: {
    sessionCount: number
    openingFloatTotal: string
    declaredTotalTotal: string
    varianceTotal: string
    depositCount: number
    depositsTotal: string
    rows: {
      sessionId: string
      state: 'Open' | 'Closed'
      openedAt: string
      closedAt: string | null
      openingFloat: string
      declaredTotal: string | null
      variance: string | null
      depositCount: number
      depositsTotal: string
    }[]
  }
}

export type DaySummaryLooseEndsQuery = { date?: string }

export type DaySummaryLooseEndsResponse = {
  date: string
  branchId: string
  unsettledTransactions: { count: number; totalOutstanding: string; asOfDate: string }
  openPriorDrawers: {
    count: number
    rows: { sessionId: string; openedAt: string; userName: string | null; openingFloat: string }[]
  }
  undocumentedAdministrations: { count: number; asOfDate: string }
}

export type DaySummaryTodayRosterQuery = { date?: string }

export type DaySummaryTodayRosterResponse = {
  date: string
  branchId: string
  branchName: string
  generatedAt: string
  roster: {
    id: string
    patientId: string
    patientName: string
    patientMrn: string
    specialty: string
    status: string
    startedAt: string
    completedAt: string | null
    claimedBy: { id: string; name: string; role: string | null } | null
    waitingSince: string
    lastActionAt: string
    rowVersion: number
    nextOwner: { role: string; label: string } | null
    handoffState:
      | 'waiting_clinical'
      | 'in_care'
      | 'on_hold'
      | 'awaiting_payment'
      | 'complete'
      | 'closed'
    pendingTransactionId: string | null
  }[]
}

export type DaySummarySetTodayRosterOwnerEncounterIdParam = string

export type DaySummarySetTodayRosterOwnerBody = {
  assigneeId?: string
  attestationPin?: string
  expectedRowVersion: number
}

export type DaySummarySetTodayRosterOwnerResponse = {
  ok: true
  encounterId: string
  claimedById: string
}

export type DaySummarySnapshotQuery = { date?: string }

export type DaySummarySnapshotResponse = {
  id: string
  date: string
  branchId: string
  createdAt: string
  createdById: string | null
  payload: unknown
}

export type DaySummaryCreateSnapshotBody = { date: string }

export type DaySummaryCreateSnapshotResponse = {
  id: string
  date: string
  branchId: string
  createdAt: string
  payload: unknown
}

export const daySummaryEndpoints = {
  list: { method: 'GET', path: '/api/day-summary' },
  looseEnds: { method: 'GET', path: '/api/day-summary/loose-ends' },
  todayRoster: { method: 'GET', path: '/api/day-summary/today-roster' },
  setTodayRosterOwner: { method: 'POST', path: '/api/day-summary/today-roster/:encounterId/owner' },
  snapshot: { method: 'GET', path: '/api/day-summary/snapshot' },
  createSnapshot: { method: 'POST', path: '/api/day-summary/snapshot' },
} as const
