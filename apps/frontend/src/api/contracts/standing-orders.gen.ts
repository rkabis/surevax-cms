// GENERATED FILE — do not edit.
// Source: apps/backend/src/modules — contract 'standing-orders'.
// Regenerate with `pnpm gen:contracts`; CI fails on drift.

export type StandingOrdersListQuery = { specialty?: string }

export type StandingOrdersListResponse = {
  data: {
    id: string
    code: string
    name: string
    description: string | null
    version: number
    requiresPhysicianAuth: boolean
    isActive: boolean
    isLocked: boolean
    specialty: string | null
    createdAt: string
    updatedAt: string
    createdById: number | null
  }[]
}

export type StandingOrdersDetailIdParam = string

export type StandingOrdersDetailResponse = {
  data: {
    id: string
    tenantId: string
    code: string
    name: string
    description: string | null
    requiresPhysicianAuth: boolean
    version: number
    supersedesId: string | null
    supersededById: string | null
    isLocked: boolean
    rowVersion: number
    isActive: boolean
    specialty: string | null
    createdAt: string
    updatedAt: string
    createdById: number | null
    createdBy: { id: number; displayId: string; firstName: string; lastName: string } | null
    items: {
      id: string
      dayOffset: number
      sequence: number
      serviceId: string
      serviceName: string
      serviceCode: string
      quantity: string
      instructions: string | null
    }[]
  }
}

export type StandingOrdersTemplatesListResponse = {
  data: {
    id: string
    code: string
    name: string
    description: string | null
    version: number
    requiresPhysicianAuth: boolean
    isActive: boolean
    isLocked: boolean
    specialty: string | null
    createdAt: string
    updatedAt: string
    createdById: number | null
    items: {
      id: string
      dayOffset: number
      sequence: number
      serviceId: string
      serviceName: string
      serviceCode: string
      quantity: string
      instructions: string | null
    }[]
  }[]
}

export type StandingOrdersPsoListResponse = {
  data: {
    id: string
    tenantId: string
    templateId: string
    templateName: string
    patientId: string
    patientName: string
    status: 'Active' | 'Suspended' | 'Completed' | 'Discontinued'
    startDate: string
    endDate: string | null
    authorizingProviderId: number | null
    suspendedAt: string | null
    discontinuedAt: string | null
    createdAt: string
    updatedAt: string
    dosesCompleted: number
    dosesTotal: number
  }[]
}

export type StandingOrdersPsoDetailIdParam = string

export type StandingOrdersPsoDetailResponse = {
  data: {
    id: string
    tenantId: string
    patientId: number
    templateId: string
    initiatingEncounterId: number | null
    authorizingProviderId: number | null
    status: string
    startDate: string
    endDate: string | null
    suspendedById: number | null
    suspensionReason: string | null
    resumedAt: string | null
    suspendedAt: string | null
    discontinuedAt: string | null
    discontinuedById: number | null
    discontinuationReason: string | null
    notes: string | null
    rowVersion: number
    createdAt: string
    updatedAt: string
    createdById: number | null
    clinicalOrders: {
      id: string
      doseNumber: number | null
      serviceId: string
      currentScheduledDate: string | null
      status: string
      completedAt: string | null
    }[]
    consents: {
      id: number
      displayId: string
      tenantId: string
      patientId: number
      encounterId: number | null
      consentType: string
      scope: string
      scopeRefType: string | null
      scopeRefId: string | null
      consenterRelation: string
      consenterName: string | null
      visProvided: boolean | null
      visVersion: string | null
      visDate: string | null
      visLanguage: string | null
      obtainedAt: string
      obtainedById: number | null
      consentLanguage: string | null
      signatureAttachmentId: number | null
      witnessId: number | null
      revokedAt: string | null
      revocationReason: string | null
      notes: string | null
      rowVersion: number
      deletedAt: string | null
      createdAt: string
      updatedAt: string
      createdById: number | null
    }[]
    statusHistory: {
      id: number
      tenantId: string
      entityId: number
      fromStatus: string | null
      toStatus: string
      reason: string | null
      changedAt: string
      changedById: number | null
      metadata: unknown
    }[]
  }
}

export type StandingOrdersPsoCreateBody = {
  patientId: string
  encounterId?: string
  templateId: string
  authorizingProviderId?: string
  startDate?: string
}

export type StandingOrdersPsoCreateResponse = {
  data: {
    id: string
    templateId: string
    status: string
    startDate: string
    clinicalOrders: {
      id: string
      serviceId: string
      doseNumber: number | null
      currentScheduledDate: string | null
      status: string
    }[]
  }
}

export type StandingOrdersAdminTemplatesUpdateIdParam = string

export type StandingOrdersAdminTemplatesUpdateBody = {
  name?: string
  description?: string | null
  requiresPhysicianAuth?: boolean
  isActive?: boolean
}

export type StandingOrdersAdminTemplatesUpdateResponse = {
  data: {
    id: string
    tenantId: string
    code: string
    name: string
    description: string | null
    requiresPhysicianAuth: boolean
    version: number
    supersedesId: string | null
    supersededById: string | null
    isLocked: boolean
    rowVersion: number
    isActive: boolean
    specialty: string | null
    createdAt: string
    updatedAt: string
    createdById: number | null
  }
}

export type StandingOrdersAdminTemplatesVersionsIdParam = string

export type StandingOrdersAdminTemplatesVersionsBody = {
  name?: string
  description?: string | null
  requiresPhysicianAuth?: boolean
  isActive?: boolean
}

export type StandingOrdersAdminTemplatesVersionsResponse = {
  data: {
    id: string
    tenantId: string
    code: string
    name: string
    description: string | null
    requiresPhysicianAuth: boolean
    version: number
    supersedesId: string | null
    supersededById: string | null
    isLocked: boolean
    rowVersion: number
    isActive: boolean
    specialty: string | null
    createdAt: string
    updatedAt: string
    createdById: number | null
  }
}

export type StandingOrdersAdminPsoAppendExternalDosePsoIdParam = string

export type StandingOrdersAdminPsoAppendExternalDoseBody = {
  doseNumber: number
  priorDoseDate: string
  serviceId: string
  externalClinicianName?: string
  externalClinicName?: string
  externalNotes?: string
}

export type StandingOrdersAdminPsoAppendExternalDoseResponse = {
  data: {
    id: string
    patientStandingOrderId: string
    serviceId: string
    doseNumber: number | null
    completedAt: string | null
    status: string
  }
}

export type StandingOrdersAdminPsoStatusPsoIdParam = string

export type StandingOrdersAdminPsoStatusBody = { status: 'Active' | 'Suspended' }

export type StandingOrdersAdminPsoStatusResponse = {
  data: { id: string; status: string; suspendedAt: string | null }
}

export const standingOrdersEndpoints = {
  list: { method: 'GET', path: '/api/standing-orders' },
  detail: { method: 'GET', path: '/api/standing-orders/:id' },
  templatesList: { method: 'GET', path: '/api/standing-order-templates' },
  psoList: { method: 'GET', path: '/api/patient-standing-orders' },
  psoDetail: { method: 'GET', path: '/api/patient-standing-orders/:id' },
  psoCreate: { method: 'POST', path: '/api/patient-standing-orders' },
  adminTemplatesUpdate: { method: 'PUT', path: '/api/admin/standing-order-templates/:id' },
  adminTemplatesVersions: {
    method: 'POST',
    path: '/api/admin/standing-order-templates/:id/versions',
  },
  adminPsoAppendExternalDose: {
    method: 'POST',
    path: '/api/admin/patient-standing-orders/:psoId/append-external-dose',
  },
  adminPsoStatus: { method: 'PATCH', path: '/api/admin/patient-standing-orders/:psoId/status' },
} as const
