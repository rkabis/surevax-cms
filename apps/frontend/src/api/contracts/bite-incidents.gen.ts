// GENERATED FILE — do not edit.
// Source: apps/backend/src/modules — contract 'bite-incidents'.
// Regenerate with `pnpm gen:contracts`; CI fails on drift.

export type BiteIncidentsListQuery = { patientId?: string; limit?: number }

export type BiteIncidentsListResponse = {
  id: string
  incidentNo: string | null
  tenantId: string
  patientId: string
  patientStandingOrderId: string | null
  incidentDate: string
  species: 'Dog' | 'Cat' | 'Bat' | 'Monkey' | 'Other'
  animalVaccinationStatus: 'Vaccinated' | 'NotVaccinated' | 'Unknown'
  animalVaccinationDocDate: string | null
  animalAgeMonths: number | null
  exposureCategory: 'I' | 'II' | 'III'
  biteSite: string
  requiresObservation: boolean
  metadata: unknown
  rowVersion: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  createdById: number | null
  patientFirstName: string
  patientLastName: string
  followup: {
    id: string
    tenantId: string
    biteIncidentId: string
    dueDate: string
    status: string
    outcome: string | null
    fatTestResult: string | null
    outcomeRecordedAt: string | null
    notes: string | null
    rowVersion: number
    createdAt: string
    updatedAt: string
  } | null
}[]

export type BiteIncidentsDetailIdParam = string

export type BiteIncidentsDetailResponse = {
  id: string
  incidentNo: string | null
  tenantId: string
  patientId: string
  patientStandingOrderId: string | null
  incidentDate: string
  species: 'Dog' | 'Cat' | 'Bat' | 'Monkey' | 'Other'
  animalVaccinationStatus: 'Vaccinated' | 'NotVaccinated' | 'Unknown'
  animalVaccinationDocDate: string | null
  animalAgeMonths: number | null
  exposureCategory: 'I' | 'II' | 'III'
  biteSite: string
  requiresObservation: boolean
  metadata: unknown
  rowVersion: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  createdById: number | null
  patientFirstName: string
  patientLastName: string
  createdByName: string | null
  followup: {
    id: string
    tenantId: string
    biteIncidentId: string
    dueDate: string
    status: string
    outcome: string | null
    fatTestResult: string | null
    outcomeRecordedAt: string | null
    notes: string | null
    rowVersion: number
    createdAt: string
    updatedAt: string
  } | null
}

export type BiteIncidentsCreateBody = {
  patientId: string
  patientStandingOrderId?: string | undefined | null
  incidentNo?: string | undefined | null
  incidentDate: string
  species: 'Dog' | 'Cat' | 'Bat' | 'Monkey' | 'Other'
  animalVaccinationStatus: 'Vaccinated' | 'NotVaccinated' | 'Unknown'
  animalVaccinationDocDate?: string | undefined | null
  animalAgeMonths?: number | undefined | null
  exposureCategory: 'I' | 'II' | 'III'
  biteSite: string
  requiresObservation?: boolean
  metadata?: unknown | undefined | null
}

export type BiteIncidentsCreateResponse = {
  id: string
  incidentNo: string | null
  tenantId: string
  patientId: string
  patientStandingOrderId: string | null
  incidentDate: string
  species: 'Dog' | 'Cat' | 'Bat' | 'Monkey' | 'Other'
  animalVaccinationStatus: 'Vaccinated' | 'NotVaccinated' | 'Unknown'
  animalVaccinationDocDate: string | null
  animalAgeMonths: number | null
  exposureCategory: 'I' | 'II' | 'III'
  biteSite: string
  requiresObservation: boolean
  metadata: unknown
  rowVersion: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  createdById: number | null
  patientFirstName: string
  patientLastName: string
  createdByName: string | null
  followup: {
    id: string
    tenantId: string
    biteIncidentId: string
    dueDate: string
    status: string
    outcome: string | null
    fatTestResult: string | null
    outcomeRecordedAt: string | null
    notes: string | null
    rowVersion: number
    createdAt: string
    updatedAt: string
  } | null
}

export type BiteIncidentsUpdateIdParam = string

export type BiteIncidentsUpdateBody = {
  incidentNo?: string | undefined | null
  incidentDate?: string
  species?: 'Dog' | 'Cat' | 'Bat' | 'Monkey' | 'Other'
  animalVaccinationStatus?: 'Vaccinated' | 'NotVaccinated' | 'Unknown'
  animalVaccinationDocDate?: string | undefined | null
  animalAgeMonths?: number | undefined | null
  exposureCategory?: 'I' | 'II' | 'III'
  biteSite?: string
  requiresObservation?: boolean
  metadata?: unknown | undefined | null
}

export type BiteIncidentsUpdateResponse = {
  id: string
  incidentNo: string | null
  tenantId: string
  patientId: string
  patientStandingOrderId: string | null
  incidentDate: string
  species: 'Dog' | 'Cat' | 'Bat' | 'Monkey' | 'Other'
  animalVaccinationStatus: 'Vaccinated' | 'NotVaccinated' | 'Unknown'
  animalVaccinationDocDate: string | null
  animalAgeMonths: number | null
  exposureCategory: 'I' | 'II' | 'III'
  biteSite: string
  requiresObservation: boolean
  metadata: unknown
  rowVersion: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  createdById: number | null
  patientFirstName: string
  patientLastName: string
  createdByName: string | null
  followup: {
    id: string
    tenantId: string
    biteIncidentId: string
    dueDate: string
    status: string
    outcome: string | null
    fatTestResult: string | null
    outcomeRecordedAt: string | null
    notes: string | null
    rowVersion: number
    createdAt: string
    updatedAt: string
  } | null
}

export type BiteIncidentsRecordOutcomeIdParam = string

export type BiteIncidentsRecordOutcomeFollowupIdParam = string

export type BiteIncidentsRecordOutcomeBody = {
  outcome:
    | 'AliveHealthy'
    | 'AliveSick'
    | 'DiedNaturally'
    | 'DiedUnknownCause'
    | 'KilledForTesting'
    | 'LostToFollowup'
  fatTestResult?: 'Positive' | 'Negative' | 'Pending' | 'NotTested' | undefined | null
  notes?: string | undefined | null
}

export type BiteIncidentsRecordOutcomeResponse = {
  followup: {
    id: string
    tenantId: string
    biteIncidentId: string
    dueDate: string
    status: string
    outcome: string | null
    fatTestResult: string | null
    outcomeRecordedAt: string | null
    notes: string | null
    rowVersion: number
    createdAt: string
    updatedAt: string
  }
  cancelsDay28: boolean
  patientId: string
  cancelledOrderId: string | null
}

export const biteIncidentsEndpoints = {
  list: { method: 'GET', path: '/api/bite-incidents' },
  detail: { method: 'GET', path: '/api/bite-incidents/:id' },
  create: { method: 'POST', path: '/api/bite-incidents' },
  update: { method: 'PATCH', path: '/api/bite-incidents/:id' },
  recordOutcome: {
    method: 'POST',
    path: '/api/bite-incidents/:id/followups/:followupId/record-outcome',
  },
} as const
