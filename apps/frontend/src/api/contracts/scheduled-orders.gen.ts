// GENERATED FILE — do not edit.
// Source: apps/backend/src/modules — contract 'scheduled-orders'.
// Regenerate with `pnpm gen:contracts`; CI fails on drift.

export type ScheduledOrdersListQuery = {
  q?: string
  patientId?: string
  filter?: 'all' | 'today' | 'upcoming' | 'missed' | 'overdue' | 'backfill' | 'completed_today'
}

export type ScheduledOrdersListResponse = {
  data: {
    id: string
    patientName: string
    patientMrn: string | null
    patientDateOfBirth: string | null
    contactNumber: string | null
    service: string
    doseNumber: number
    totalDoses: number
    scheduledDate: string | null
    status: 'Scheduled' | 'Pending' | 'Completed' | 'Missed' | 'Cancelled'
    standingOrderName: string
    indication: string | null
    paymentStatus: 'Draft' | 'Pending' | 'Paid' | 'Voided' | 'Refunded' | null
    hasBlockingOverdue: boolean
    priorityState:
      | 'due'
      | 'overdue'
      | 'upcoming'
      | 'completed'
      | 'missed'
      | 'cancelled'
      | 'unscheduled'
    smsOptIn: boolean
    observation: {
      id: string
      durationMinutes: number
      observeUntil: string
      outcome: 'NoReaction' | 'Reaction' | 'Escalated' | null
      outcomeNotes: string | null
      outcomeRecordedAt: string | null
      outcomeRecordedBy: { displayId: string; fullName: string } | null
      dischargedAt: string | null
      dischargedBy: { displayId: string; fullName: string } | null
      state: 'Observing' | 'ReadyForDischarge' | 'Reaction' | 'Escalated' | 'Discharged'
    } | null
  }[]
  stats: {
    todayCount: number
    missedCount: number
    completedToday: number
    overdueCount: number
    backfillCount: number
    upcomingCount: number
    activeCoursesCount: number
    recomputeNeededCount: number
    administered7d: number[]
  }
}

export type ScheduledOrdersAdministeredQuery = { date?: string }

export type ScheduledOrdersAdministeredResponse = {
  id: string
  patientId: string
  patientName: string
  serviceName: string
  lotNumber: string | null
  administeredAt: string
  administeredByName: string | null
  encounterId: string | null
}[]

export type ScheduledOrdersDetailIdParam = string

export type ScheduledOrdersDetailResponse = {
  id: string
  tenantId: string
  patientStandingOrderId: string | null
  serviceId: string | null
  encounterId: string | null
  orderType: string
  status: 'Scheduled' | 'Pending' | 'Completed' | 'Missed' | 'Cancelled'
  originalScheduledDate: string | null
  currentScheduledDate: string | null
  completedAt: string | null
  observation: {
    id: string
    durationMinutes: number
    observeUntil: string
    outcome: 'NoReaction' | 'Reaction' | 'Escalated' | null
    outcomeNotes: string | null
    outcomeRecordedAt: string | null
    outcomeRecordedBy: { displayId: string; fullName: string } | null
    dischargedAt: string | null
    dischargedBy: { displayId: string; fullName: string } | null
    state: 'Observing' | 'ReadyForDischarge' | 'Reaction' | 'Escalated' | 'Discharged'
  } | null
  documentedById: string | null
  administeredById: string | null
  quantity: string
  doseNumber: number | null
  administrationRoute: string | null
  administrationSite: string | null
  indication: string | null
  notes: unknown
  deletedAt: string | null
  createdAt: string | null
  updatedAt: string | null
  createdById: string | null
  paymentStatus: 'Draft' | 'Pending' | 'Paid' | 'Voided' | 'Refunded' | null
  service: { id: string | null; name: string; requiresDoseCalculation: boolean } | null
  patient: {
    id: string
    firstName: string | null
    lastName: string | null
    dateOfBirth: string | null
    mrn: string | null
    allergies: string[]
    activeConditions: string[]
  } | null
  standingOrder: { id: string; status: string | null; template: { name: string } | null } | null
  consent: {
    id: string
    visProvided: boolean | null
    visDate: string | null
    visVersion: string | null
    consentObtained: boolean
    consentBy: string | null
    consentTimestamp: string | null
    notes: string | null
  } | null
}

export type ScheduledOrdersTimelineIdParam = string

export type ScheduledOrdersTimelineResponse = {
  id: string
  day: number
  scheduledAt: string
  administeredAt: string | null
  state: 'completed' | 'overdue' | 'due' | 'upcoming' | 'cancelled'
  byClinician: string | null
  lotNumber: string | null
  doseSize: string
  note?: string
}[]

export type ScheduledOrdersDosesIdParam = string

export type ScheduledOrdersDosesQuery = { payerId?: string }

export type ScheduledOrdersDosesResponse = {
  orderId: string
  doseNumber: number
  serviceId: string
  serviceName: string
  scheduledAt: string
  state: 'upcoming' | 'due' | 'overdue' | 'completed' | 'cancelled'
  paymentStatus: 'Draft' | 'Pending' | 'Paid' | null
  unitPrice: string
}[]

export type ScheduledOrdersEligibleLotsIdParam = string

export type ScheduledOrdersEligibleLotsResponse = {
  data: {
    id: string
    batchNumber: string
    expiryDate: string
    quantityOnHand: string
    product: { id: string; name: string; manufacturer: string | null }
    isHouseBrand: boolean
    unitPrice: string
    isRecalled: boolean
  }[]
  billedUnitPrice: string | null
}

export type ScheduledOrdersRecomputePreviewIdParam = string

export type ScheduledOrdersRecomputePreviewResponse = {
  current: { id: string; currentScheduledDate: string | null }
  downstream: { id: string; day: number; fromDate: string; toDate: string; deltaDays: number }[]
}

export type ScheduledOrdersRecomputeIdParam = string

export type ScheduledOrdersRecomputeResponse = {
  updated: number
  downstream: { id: string; day: number; fromDate: string; toDate: string; deltaDays: number }[]
}

export type ScheduledOrdersAdministerIdParam = string

export type ScheduledOrdersAdministerBody = {
  consentBy: 'Patient' | 'Guardian'
  consentObtained: true
  visVersion: string
  visProvided?: boolean
  lotId: string
  brandPriceVarianceAcknowledged?: boolean
  administeredById?: string
  attestationPin?: string
  observationMinutes?: number
}

export type ScheduledOrdersAdministerResponse = {
  id: string
  status: string
  completedAt: string
  patientId: string | null
  serviceId: string
  lot: { lotId: string; batchNumber: string; expiryDate: string }
  administeredBy: { displayId: string; fullName: string; licenseNumber: string | null } | null
  downstream: { id: string; day: number; fromDate: string; toDate: string; deltaDays: number }[]
  observation: {
    id: string
    durationMinutes: number
    observeUntil: string
    outcome: 'NoReaction' | 'Reaction' | 'Escalated' | null
    outcomeNotes: string | null
    outcomeRecordedAt: string | null
    outcomeRecordedBy: { displayId: string; fullName: string } | null
    dischargedAt: string | null
    dischargedBy: { displayId: string; fullName: string } | null
    state: 'Observing' | 'ReadyForDischarge' | 'Reaction' | 'Escalated' | 'Discharged'
  }
}

export type ScheduledOrdersObservationActionIdParam = string

export type ScheduledOrdersObservationActionBody =
  | {
      action: 'record_outcome'
      outcome: 'NoReaction' | 'Reaction' | 'Escalated'
      notes?: string
      attestedById?: string
      attestationPin?: string
    }
  | { action: 'acknowledge_discharge'; attestedById?: string; attestationPin?: string }

export type ScheduledOrdersObservationActionResponse = {
  id: string
  durationMinutes: number
  observeUntil: string
  outcome: 'NoReaction' | 'Reaction' | 'Escalated' | null
  outcomeNotes: string | null
  outcomeRecordedAt: string | null
  outcomeRecordedBy: { displayId: string; fullName: string } | null
  dischargedAt: string | null
  dischargedBy: { displayId: string; fullName: string } | null
  state: 'Observing' | 'ReadyForDischarge' | 'Reaction' | 'Escalated' | 'Discharged'
}

export type ScheduledOrdersRescheduleIdParam = string

export type ScheduledOrdersRescheduleBody = { newDate: string; reason: string }

export type ScheduledOrdersRescheduleResponse = { id: string; currentScheduledDate: string }

export type ScheduledOrdersTextDraftIdParam = string

export type ScheduledOrdersTextDraftResponse = {
  blocked: boolean
  blockedReason: 'no_contact_number' | 'sms_opt_in_false' | null
  maskedNumber: string | null
  smsUri: string | null
  messageBody: string | null
  qrDataUrl: string | null
}

export const scheduledOrdersEndpoints = {
  list: { method: 'GET', path: '/api/scheduled-orders' },
  administered: { method: 'GET', path: '/api/scheduled-orders/administered' },
  detail: { method: 'GET', path: '/api/scheduled-orders/:id' },
  timeline: { method: 'GET', path: '/api/scheduled-orders/:id/timeline' },
  doses: { method: 'GET', path: '/api/scheduled-orders/:id/doses' },
  eligibleLots: { method: 'GET', path: '/api/scheduled-orders/:id/eligible-lots' },
  recomputePreview: { method: 'GET', path: '/api/scheduled-orders/:id/recompute-preview' },
  recompute: { method: 'POST', path: '/api/scheduled-orders/:id/recompute' },
  administer: { method: 'POST', path: '/api/scheduled-orders/:id/administer' },
  observationAction: { method: 'POST', path: '/api/scheduled-orders/:id/observation' },
  reschedule: { method: 'POST', path: '/api/scheduled-orders/:id/reschedule' },
  textDraft: { method: 'GET', path: '/api/scheduled-orders/:id/text-draft' },
} as const
