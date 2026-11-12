// GENERATED FILE — do not edit.
// Source: apps/backend/src/modules — contract 'encounters'.
// Regenerate with `pnpm gen:contracts`; CI fails on drift.

export type EncountersListQuery = {
  limit?: number
  patientId?: string
  sort?: 'created_at' | 'specialty'
  order?: 'asc' | 'desc'
}

export type EncountersListResponse = {
  data: {
    id: string
    specialty: string
    status: string
    triageCategory: string | null
    chiefComplaint: string | null
    visitNo: number | null
    startedAt: string
    completedAt: string | null
    bundleLabel: string
    patientId: string | null
    patientFirstName: string | null
    patientLastName: string | null
    providerId: string | null
    providerFirstName: string | null
    providerLastName: string | null
    providerRole: string | null
    branchId: string | null
    branchName: string | null
    createdAt: string
  }[]
}

export type EncountersDetailDisplayIdParam = string

export type EncountersDetailResponse = {
  id: string
  tenantId: string
  specialty: string
  status: string
  triageCategory: string | null
  chiefComplaint: string | null
  visitNo: number | null
  startedAt: string
  completedAt: string | null
  bundleLabel: string
  specialtyData: unknown
  clinicalNotes: unknown
  dispositionCode: string | null
  closedById: number | null
  appointmentId: number | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  createdById: number | null
  patientId: string | null
  patientFirstName: string | null
  patientLastName: string | null
  patientDateOfBirth: string | null
  providerId: string | null
  providerFirstName: string | null
  providerLastName: string | null
  providerRole: string | null
  branchId: string | null
  branchName: string | null
  vitals: {
    id: number
    tenantId: string
    encounterId: number
    patientId: number
    recordedAt: string
    recordedById: number | null
    temperatureC: string | null
    heartRateBpm: number | null
    respiratoryRateBpm: number | null
    systolicBp: number | null
    diastolicBp: number | null
    spo2Percent: string | null
    weightKg: string | null
    heightCm: string | null
    bmi: string | null
    painScore: number | null
    extra: unknown
    rowVersion: number
    createdAt: string
    updatedAt: string
    createdById: number | null
  }[]
  diagnoses: {
    id: number
    tenantId: string
    encounterId: number
    patientId: number
    icd10Code: string
    description: string | null
    isPrimary: boolean
    diagnosisType: string | null
    recordedById: number | null
    notes: string | null
    rowVersion: number
    deletedAt: string | null
    createdAt: string
    updatedAt: string
    createdById: number | null
  }[]
}

export type EncountersCreateBody = {
  patientId: string
  specialty: 'Rabies' | 'Flu' | 'Vaccination' | 'General'
  chiefComplaint?: string
  specialtyData?: Record<string, unknown>
  clinicalNotes?: Record<string, unknown>
}

export type EncountersCreateResponse = {
  id: string
  tenantId: string
  specialty: string
  status: string
  triageCategory: string | null
  chiefComplaint: string | null
  visitNo: number | null
  startedAt: string
  completedAt: string | null
  bundleLabel: string
  specialtyData: unknown
  clinicalNotes: unknown
  dispositionCode: string | null
  closedById: number | null
  appointmentId: number | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  createdById: number | null
  patientId: string | null
  patientFirstName: string | null
  patientLastName: string | null
  patientDateOfBirth: string | null
  providerId: string | null
  providerFirstName: string | null
  providerLastName: string | null
  providerRole: string | null
  branchId: string | null
  branchName: string | null
  vitals: {
    id: number
    tenantId: string
    encounterId: number
    patientId: number
    recordedAt: string
    recordedById: number | null
    temperatureC: string | null
    heartRateBpm: number | null
    respiratoryRateBpm: number | null
    systolicBp: number | null
    diastolicBp: number | null
    spo2Percent: string | null
    weightKg: string | null
    heightCm: string | null
    bmi: string | null
    painScore: number | null
    extra: unknown
    rowVersion: number
    createdAt: string
    updatedAt: string
    createdById: number | null
  }[]
  diagnoses: {
    id: number
    tenantId: string
    encounterId: number
    patientId: number
    icd10Code: string
    description: string | null
    isPrimary: boolean
    diagnosisType: string | null
    recordedById: number | null
    notes: string | null
    rowVersion: number
    deletedAt: string | null
    createdAt: string
    updatedAt: string
    createdById: number | null
  }[]
}

export type EncountersVitalsDisplayIdParam = string

export type EncountersVitalsResponse = {
  data: {
    id: number
    tenantId: string
    encounterId: number
    patientId: number
    recordedAt: string
    recordedById: number | null
    temperatureC: string | null
    heartRateBpm: number | null
    respiratoryRateBpm: number | null
    systolicBp: number | null
    diastolicBp: number | null
    spo2Percent: string | null
    weightKg: string | null
    heightCm: string | null
    bmi: string | null
    painScore: number | null
    extra: unknown
    rowVersion: number
    createdAt: string
    updatedAt: string
    createdById: number | null
  }[]
}

export type EncountersCreateVitalDisplayIdParam = string

export type EncountersCreateVitalBody = {
  temperatureC?: string | number
  heartRateBpm?: number
  respiratoryRateBpm?: number
  systolic?: number
  diastolic?: number
  systolicBp?: number
  diastolicBp?: number
  spo2Percent?: string | number
  weightKg?: string | number
  heightCm?: string | number
  bmi?: string | number
  painScore?: number
  extra?: Record<string, unknown>
}

export type EncountersCreateVitalResponse = {
  id: number
  tenantId: string
  encounterId: number
  patientId: number
  recordedAt: string
  recordedById: number | null
  temperatureC: string | null
  heartRateBpm: number | null
  respiratoryRateBpm: number | null
  systolicBp: number | null
  diastolicBp: number | null
  spo2Percent: string | null
  weightKg: string | null
  heightCm: string | null
  bmi: string | null
  painScore: number | null
  extra: unknown
  rowVersion: number
  createdAt: string
  updatedAt: string
  createdById: number | null
}

export type EncountersDiagnosesDisplayIdParam = string

export type EncountersDiagnosesResponse = {
  data: {
    id: number
    tenantId: string
    encounterId: number
    patientId: number
    icd10Code: string
    description: string | null
    isPrimary: boolean
    diagnosisType: string | null
    recordedById: number | null
    notes: string | null
    rowVersion: number
    deletedAt: string | null
    createdAt: string
    updatedAt: string
    createdById: number | null
  }[]
}

export type EncountersCreateDiagnosisDisplayIdParam = string

export type EncountersCreateDiagnosisBody = {
  icd10Code: string
  description?: string
  isPrimary?: boolean
  diagnosisType?: string
  recordedById?: string
  notes?: string
}

export type EncountersCreateDiagnosisResponse = {
  id: number
  tenantId: string
  encounterId: number
  patientId: number
  icd10Code: string
  description: string | null
  isPrimary: boolean
  diagnosisType: string | null
  recordedById: number | null
  notes: string | null
  rowVersion: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  createdById: number | null
}

export type EncountersCompleteDisplayIdParam = string

export type EncountersCompleteBody = Record<string, never>

export type EncountersCompleteResponse = {
  id: string
  tenantId: string
  specialty: string
  status: string
  triageCategory: string | null
  chiefComplaint: string | null
  visitNo: number | null
  startedAt: string
  completedAt: string | null
  bundleLabel: string
  specialtyData: unknown
  clinicalNotes: unknown
  dispositionCode: string | null
  closedById: number | null
  appointmentId: number | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  createdById: number | null
  patientId: string | null
  patientFirstName: string | null
  patientLastName: string | null
  patientDateOfBirth: string | null
  providerId: string | null
  providerFirstName: string | null
  providerLastName: string | null
  providerRole: string | null
  branchId: string | null
  branchName: string | null
  vitals: {
    id: number
    tenantId: string
    encounterId: number
    patientId: number
    recordedAt: string
    recordedById: number | null
    temperatureC: string | null
    heartRateBpm: number | null
    respiratoryRateBpm: number | null
    systolicBp: number | null
    diastolicBp: number | null
    spo2Percent: string | null
    weightKg: string | null
    heightCm: string | null
    bmi: string | null
    painScore: number | null
    extra: unknown
    rowVersion: number
    createdAt: string
    updatedAt: string
    createdById: number | null
  }[]
  diagnoses: {
    id: number
    tenantId: string
    encounterId: number
    patientId: number
    icd10Code: string
    description: string | null
    isPrimary: boolean
    diagnosisType: string | null
    recordedById: number | null
    notes: string | null
    rowVersion: number
    deletedAt: string | null
    createdAt: string
    updatedAt: string
    createdById: number | null
  }[]
}

export type EncountersCancelDisplayIdParam = string

export type EncountersCancelBody = { reason: string }

export type EncountersCancelResponse = {
  id: string
  tenantId: string
  specialty: string
  status: string
  triageCategory: string | null
  chiefComplaint: string | null
  visitNo: number | null
  startedAt: string
  completedAt: string | null
  bundleLabel: string
  specialtyData: unknown
  clinicalNotes: unknown
  dispositionCode: string | null
  closedById: number | null
  appointmentId: number | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  createdById: number | null
  patientId: string | null
  patientFirstName: string | null
  patientLastName: string | null
  patientDateOfBirth: string | null
  providerId: string | null
  providerFirstName: string | null
  providerLastName: string | null
  providerRole: string | null
  branchId: string | null
  branchName: string | null
  vitals: {
    id: number
    tenantId: string
    encounterId: number
    patientId: number
    recordedAt: string
    recordedById: number | null
    temperatureC: string | null
    heartRateBpm: number | null
    respiratoryRateBpm: number | null
    systolicBp: number | null
    diastolicBp: number | null
    spo2Percent: string | null
    weightKg: string | null
    heightCm: string | null
    bmi: string | null
    painScore: number | null
    extra: unknown
    rowVersion: number
    createdAt: string
    updatedAt: string
    createdById: number | null
  }[]
  diagnoses: {
    id: number
    tenantId: string
    encounterId: number
    patientId: number
    icd10Code: string
    description: string | null
    isPrimary: boolean
    diagnosisType: string | null
    recordedById: number | null
    notes: string | null
    rowVersion: number
    deletedAt: string | null
    createdAt: string
    updatedAt: string
    createdById: number | null
  }[]
}

export const encountersEndpoints = {
  list: { method: 'GET', path: '/api/encounters' },
  detail: { method: 'GET', path: '/api/encounters/:displayId' },
  create: { method: 'POST', path: '/api/encounters' },
  vitals: { method: 'GET', path: '/api/encounters/:displayId/vitals' },
  createVital: { method: 'POST', path: '/api/encounters/:displayId/vitals' },
  diagnoses: { method: 'GET', path: '/api/encounters/:displayId/diagnoses' },
  createDiagnosis: { method: 'POST', path: '/api/encounters/:displayId/diagnoses' },
  complete: { method: 'POST', path: '/api/encounters/:displayId/complete' },
  cancel: { method: 'POST', path: '/api/encounters/:displayId/cancel' },
} as const
