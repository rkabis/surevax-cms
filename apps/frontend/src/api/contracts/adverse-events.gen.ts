// GENERATED FILE — do not edit.
// Source: apps/backend/src/modules — contract 'adverse-events'.
// Regenerate with `pnpm gen:contracts`; CI fails on drift.

export type AdverseEventsListQuery = {
  patientId?: string
  severity?: 'Mild' | 'Moderate' | 'Severe' | 'LifeThreatening' | 'Fatal'
  limit?: number
}

export type AdverseEventsListResponse = {
  id: string
  caseNo: string | null
  tenantId: string
  patientId: string
  clinicalOrderId: string | null
  encounterId: string | null
  reportedAt: string
  reportedById: number | null
  onsetAt: string | null
  severity: string
  outcome: string | null
  description: string
  symptomsCoded: unknown
  treatmentGiven: string | null
  reportedToAuthorityAt: string | null
  authorityReferenceNumber: string | null
  rowVersion: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  createdById: number | null
  patientFirstName: string | null
  patientLastName: string | null
  reportedByName: string | null
}[]

export type AdverseEventsDetailIdParam = string

export type AdverseEventsDetailResponse = {
  id: string
  caseNo: string | null
  tenantId: string
  patientId: string
  clinicalOrderId: string | null
  encounterId: string | null
  reportedAt: string
  reportedById: number | null
  onsetAt: string | null
  severity: string
  outcome: string | null
  description: string
  symptomsCoded: unknown
  treatmentGiven: string | null
  reportedToAuthorityAt: string | null
  authorityReferenceNumber: string | null
  rowVersion: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  createdById: number | null
  patientFirstName: string | null
  patientLastName: string | null
  reportedByName: string | null
  clinicalOrder: { id: string; status: string } | null
  encounter: { id: string; specialty: string; status: string } | null
}

export type AdverseEventsCreateBody = {
  patientId: string
  clinicalOrderId?: string | undefined | null
  encounterId?: string | undefined | null
  caseNo?: string | undefined | null
  onsetAt?: string | undefined | null
  severity: 'Mild' | 'Moderate' | 'Severe' | 'LifeThreatening' | 'Fatal'
  outcome?:
    | 'Recovered'
    | 'Recovering'
    | 'NotRecovered'
    | 'RecoveredWithSequelae'
    | 'Fatal'
    | 'Unknown'
    | undefined
    | null
  description: string
  symptomsCoded?: unknown | undefined | null
  treatmentGiven?: string | undefined | null
  reportedToAuthorityAt?: string | undefined | null
  authorityReferenceNumber?: string | undefined | null
}

export type AdverseEventsCreateResponse = {
  id: string
  caseNo: string | null
  tenantId: string
  patientId: string
  clinicalOrderId: string | null
  encounterId: string | null
  reportedAt: string
  reportedById: number | null
  onsetAt: string | null
  severity: string
  outcome: string | null
  description: string
  symptomsCoded: unknown
  treatmentGiven: string | null
  reportedToAuthorityAt: string | null
  authorityReferenceNumber: string | null
  rowVersion: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  createdById: number | null
  patientFirstName: string | null
  patientLastName: string | null
  reportedByName: string | null
  clinicalOrder: { id: string; status: string } | null
  encounter: { id: string; specialty: string; status: string } | null
}

export type AdverseEventsUpdateIdParam = string

export type AdverseEventsUpdateBody = {
  caseNo?: string | undefined | null
  severity?: 'Mild' | 'Moderate' | 'Severe' | 'LifeThreatening' | 'Fatal'
  outcome?:
    | 'Recovered'
    | 'Recovering'
    | 'NotRecovered'
    | 'RecoveredWithSequelae'
    | 'Fatal'
    | 'Unknown'
    | undefined
    | null
  description?: string
  symptomsCoded?: unknown | undefined | null
  treatmentGiven?: string | undefined | null
  reportedToAuthorityAt?: string | undefined | null
  authorityReferenceNumber?: string | undefined | null
}

export type AdverseEventsUpdateResponse = {
  id: string
  caseNo: string | null
  tenantId: string
  patientId: string
  clinicalOrderId: string | null
  encounterId: string | null
  reportedAt: string
  reportedById: number | null
  onsetAt: string | null
  severity: string
  outcome: string | null
  description: string
  symptomsCoded: unknown
  treatmentGiven: string | null
  reportedToAuthorityAt: string | null
  authorityReferenceNumber: string | null
  rowVersion: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  createdById: number | null
  patientFirstName: string | null
  patientLastName: string | null
  reportedByName: string | null
  clinicalOrder: { id: string; status: string } | null
  encounter: { id: string; specialty: string; status: string } | null
}

export type AdverseEventsRemoveIdParam = string

export type AdverseEventsRemoveResponse = { ok: true }

export const adverseEventsEndpoints = {
  list: { method: 'GET', path: '/api/adverse-events' },
  detail: { method: 'GET', path: '/api/adverse-events/:id' },
  create: { method: 'POST', path: '/api/adverse-events' },
  update: { method: 'PATCH', path: '/api/adverse-events/:id' },
  remove: { method: 'DELETE', path: '/api/adverse-events/:id' },
} as const
