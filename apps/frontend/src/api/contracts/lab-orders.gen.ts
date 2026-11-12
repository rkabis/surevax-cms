// GENERATED FILE — do not edit.
// Source: apps/backend/src/modules — contract 'lab-orders'.
// Regenerate with `pnpm gen:contracts`; CI fails on drift.

export type LabOrdersListQuery = {
  sort?: 'created_at' | 'status' | 'sent_at'
  order?: 'asc' | 'desc'
}

export type LabOrdersListResponse = {
  id: string
  status: string
  sentAt: string | null
  resultReceivedAt: string | null
  collectedAt: string | null
  hasCriticalValue: boolean
  externalOrderId: string | null
  laboratoryName: string | null
  serviceName: string
  resultFileAttachmentId: number | null
  createdAt: string
}[]

export type LabOrdersDetailIdParam = string

export type LabOrdersDetailResponse = {
  id: string
  tenantId: string
  clinicalOrderId: string | null
  laboratoryId: string | null
  status: string
  externalOrderId: string | null
  collectedAt: string | null
  collectedById: number | null
  rejectionReason: string | null
  hasCriticalValue: boolean
  criticalValueAcknowledgedAt: string | null
  criticalValueAcknowledgedById: number | null
  resultData: unknown
  resultFileAttachmentId: number | null
  sentAt: string | null
  resultReceivedAt: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  createdById: number | null
  createdBy: { id: number; displayId: string; firstName: string; lastName: string } | null
  laboratoryName: string | null
  serviceName: string
  patientName: string | null
}

export type LabOrdersCreateBody = {
  clinicalOrderId: string
  laboratoryId?: string
  externalOrderId?: string
  notes?: string
}

export type LabOrdersCreateResponse = {
  id: string
  tenantId: string
  clinicalOrderId: string | null
  laboratoryId: string | null
  status: string
  externalOrderId: string | null
  collectedAt: string | null
  collectedById: number | null
  rejectionReason: string | null
  hasCriticalValue: boolean
  criticalValueAcknowledgedAt: string | null
  criticalValueAcknowledgedById: number | null
  resultData: unknown
  resultFileAttachmentId: number | null
  sentAt: string | null
  resultReceivedAt: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  createdById: number | null
  createdBy: { id: number; displayId: string; firstName: string; lastName: string } | null
  laboratoryName: string | null
  serviceName: string
  patientName: string | null
}

export type LabOrdersMarkSentIdParam = string

export type LabOrdersMarkSentResponse = {
  id: string
  tenantId: string
  clinicalOrderId: string | null
  laboratoryId: string | null
  status: string
  externalOrderId: string | null
  collectedAt: string | null
  collectedById: number | null
  rejectionReason: string | null
  hasCriticalValue: boolean
  criticalValueAcknowledgedAt: string | null
  criticalValueAcknowledgedById: number | null
  resultData: unknown
  resultFileAttachmentId: number | null
  sentAt: string | null
  resultReceivedAt: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  createdById: number | null
  createdBy: { id: number; displayId: string; firstName: string; lastName: string } | null
  laboratoryName: string | null
  serviceName: string
  patientName: string | null
}

export type LabOrdersResultIdParam = string

export type LabOrdersResultBody = {
  resultData?: Record<string, unknown>
  resultFileAttachmentId?: number
  notes?: string
}

export type LabOrdersResultResponse = {
  id: string
  tenantId: string
  clinicalOrderId: string | null
  laboratoryId: string | null
  status: string
  externalOrderId: string | null
  collectedAt: string | null
  collectedById: number | null
  rejectionReason: string | null
  hasCriticalValue: boolean
  criticalValueAcknowledgedAt: string | null
  criticalValueAcknowledgedById: number | null
  resultData: unknown
  resultFileAttachmentId: number | null
  sentAt: string | null
  resultReceivedAt: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  createdById: number | null
  createdBy: { id: number; displayId: string; firstName: string; lastName: string } | null
  laboratoryName: string | null
  serviceName: string
  patientName: string | null
}

export type LabOrdersAcknowledgeCriticalIdParam = string

export type LabOrdersAcknowledgeCriticalResponse = {
  id: string
  tenantId: string
  clinicalOrderId: string | null
  laboratoryId: string | null
  status: string
  externalOrderId: string | null
  collectedAt: string | null
  collectedById: number | null
  rejectionReason: string | null
  hasCriticalValue: boolean
  criticalValueAcknowledgedAt: string | null
  criticalValueAcknowledgedById: number | null
  resultData: unknown
  resultFileAttachmentId: number | null
  sentAt: string | null
  resultReceivedAt: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  createdById: number | null
  createdBy: { id: number; displayId: string; firstName: string; lastName: string } | null
  laboratoryName: string | null
  serviceName: string
  patientName: string | null
}

export const labOrdersEndpoints = {
  list: { method: 'GET', path: '/api/lab-orders' },
  detail: { method: 'GET', path: '/api/lab-orders/:id' },
  create: { method: 'POST', path: '/api/lab-orders' },
  markSent: { method: 'POST', path: '/api/lab-orders/:id/mark-sent' },
  result: { method: 'POST', path: '/api/lab-orders/:id/result' },
  acknowledgeCritical: { method: 'POST', path: '/api/lab-orders/:id/acknowledge-critical' },
} as const
