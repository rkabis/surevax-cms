// GENERATED FILE — do not edit.
// Source: apps/backend/src/modules — contract 'appointments'.
// Regenerate with `pnpm gen:contracts`; CI fails on drift.

export type AppointmentsListQuery = {
  patientId?: string
  providerId?: string
  branchId?: string
  status?:
    | 'Scheduled'
    | 'Confirmed'
    | 'CheckedIn'
    | 'InProgress'
    | 'Completed'
    | 'Cancelled'
    | 'NoShow'
  from?: string
  to?: string
  limit?: number
}

export type AppointmentsListResponse = {
  id: string
  bookingRef: string | null
  tenantId: string
  patientId: number
  branchId: number
  providerId: number | null
  locationId: number | null
  scheduledStartAt: string
  scheduledEndAt: string
  appointmentType: string
  status: string
  reason: string | null
  notes: string | null
  cancelledAt: string | null
  cancelledById: number | null
  cancellationReason: string | null
  encounterId: number | null
  rowVersion: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  createdById: number | null
  patientFirstName: string | null
  patientLastName: string | null
  patientDisplayId: string | null
  providerName: string | null
  branchName: string | null
  locationName: string | null
  encounterDisplayId: string | null
}[]

export type AppointmentsAvailabilityQuery = {
  providerId: string
  from: string
  to: string
  durationMinutes?: number
}

export type AppointmentsAvailabilityResponse = { slots: { startAt: string; endAt: string }[] }

export type AppointmentsDetailDisplayIdParam = string

export type AppointmentsDetailResponse = {
  data: {
    id: string
    bookingRef: string | null
    tenantId: string
    patientId: number
    branchId: number
    providerId: number | null
    locationId: number | null
    scheduledStartAt: string
    scheduledEndAt: string
    appointmentType: string
    status: string
    reason: string | null
    notes: string | null
    cancelledAt: string | null
    cancelledById: number | null
    cancellationReason: string | null
    encounterId: number | null
    rowVersion: number
    deletedAt: string | null
    createdAt: string
    updatedAt: string
    createdById: number | null
    patientFirstName: string | null
    patientLastName: string | null
    patientDisplayId: string | null
    providerName: string | null
    branchName: string | null
    locationName: string | null
    encounterDisplayId: string | null
    cancelledByName: string | null
  }
}

export type AppointmentsCreateBody = {
  patientId: string
  branchId: string
  providerId?: string | undefined | null
  locationId?: string | undefined | null
  scheduledStartAt: string
  scheduledEndAt: string
  appointmentType: 'Consultation' | 'Vaccination' | 'LabDraw' | 'Procedure' | 'FollowUp'
  reason?: string | undefined | null
  notes?: string | undefined | null
}

export type AppointmentsCreateResponse = {
  data: {
    id: string
    bookingRef: string | null
    tenantId: string
    patientId: number
    branchId: number
    providerId: number | null
    locationId: number | null
    scheduledStartAt: string
    scheduledEndAt: string
    appointmentType: string
    status: string
    reason: string | null
    notes: string | null
    cancelledAt: string | null
    cancelledById: number | null
    cancellationReason: string | null
    encounterId: number | null
    rowVersion: number
    deletedAt: string | null
    createdAt: string
    updatedAt: string
    createdById: number | null
    patientFirstName: string | null
    patientLastName: string | null
    patientDisplayId: string | null
    providerName: string | null
    branchName: string | null
    locationName: string | null
    encounterDisplayId: string | null
    cancelledByName: string | null
  }
}

export type AppointmentsUpdateDisplayIdParam = string

export type AppointmentsUpdateBody = {
  scheduledStartAt?: string
  scheduledEndAt?: string
  providerId?: string | undefined | null
  locationId?: string | undefined | null
  status?:
    | 'Scheduled'
    | 'Confirmed'
    | 'CheckedIn'
    | 'InProgress'
    | 'Completed'
    | 'Cancelled'
    | 'NoShow'
  reason?: string | undefined | null
  notes?: string | undefined | null
}

export type AppointmentsUpdateResponse = {
  data: {
    id: string
    bookingRef: string | null
    tenantId: string
    patientId: number
    branchId: number
    providerId: number | null
    locationId: number | null
    scheduledStartAt: string
    scheduledEndAt: string
    appointmentType: string
    status: string
    reason: string | null
    notes: string | null
    cancelledAt: string | null
    cancelledById: number | null
    cancellationReason: string | null
    encounterId: number | null
    rowVersion: number
    deletedAt: string | null
    createdAt: string
    updatedAt: string
    createdById: number | null
    patientFirstName: string | null
    patientLastName: string | null
    patientDisplayId: string | null
    providerName: string | null
    branchName: string | null
    locationName: string | null
    encounterDisplayId: string | null
    cancelledByName: string | null
  }
}

export type AppointmentsCancelDisplayIdParam = string

export type AppointmentsCancelBody = { reason: string }

export type AppointmentsCancelResponse = {
  data: {
    id: string
    bookingRef: string | null
    tenantId: string
    patientId: number
    branchId: number
    providerId: number | null
    locationId: number | null
    scheduledStartAt: string
    scheduledEndAt: string
    appointmentType: string
    status: string
    reason: string | null
    notes: string | null
    cancelledAt: string | null
    cancelledById: number | null
    cancellationReason: string | null
    encounterId: number | null
    rowVersion: number
    deletedAt: string | null
    createdAt: string
    updatedAt: string
    createdById: number | null
    patientFirstName: string | null
    patientLastName: string | null
    patientDisplayId: string | null
    providerName: string | null
    branchName: string | null
    locationName: string | null
    encounterDisplayId: string | null
    cancelledByName: string | null
  }
}

export type AppointmentsRemoveDisplayIdParam = string

export type AppointmentsRemoveResponse = { ok: true }

export const appointmentsEndpoints = {
  list: { method: 'GET', path: '/api/appointments' },
  availability: { method: 'GET', path: '/api/appointments/availability' },
  detail: { method: 'GET', path: '/api/appointments/:displayId' },
  create: { method: 'POST', path: '/api/appointments' },
  update: { method: 'PATCH', path: '/api/appointments/:displayId' },
  cancel: { method: 'POST', path: '/api/appointments/:displayId/cancel' },
  remove: { method: 'DELETE', path: '/api/appointments/:displayId' },
} as const
