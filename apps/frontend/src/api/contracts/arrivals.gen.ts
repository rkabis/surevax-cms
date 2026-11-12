// GENERATED FILE — do not edit.
// Source: apps/backend/src/modules — contract 'arrivals'.
// Regenerate with `pnpm gen:contracts`; CI fails on drift.

export type ArrivalsPreviewBundleQuery = {
  templateId?: string
  templateIds?: string
  triageCategory?: string
  patientWeight?: number
}

export type ArrivalsPreviewBundleResponse = {
  items: {
    service: { id: string; name: string; sku: string | null }
    lot: { id: string; batchNumber: string } | null
    expiryDate: string | null
    doseSize: string | null
    qty: string
    unitPrice: string
    subtotal: string
  }[]
  total: string
}

export type ArrivalsAtomicBody = {
  patientId: string
  triageCategory?: string
  templateId?: string
  templateIds?: string[]
  authorizingProviderId?: string
  specialty: 'Rabies' | 'Flu' | 'Vaccination' | 'General'
  consentObtained: true
  consentBy: 'Patient' | 'Guardian'
  chiefComplaint?: string
  specialtyData?: Record<string, unknown>
  clinicalNotes?: Record<string, unknown>
  startDate?: string
}

export type ArrivalsAtomicResponse = {
  encounterId: string
  patientStandingOrderId: string
  patientStandingOrderIds: string[]
  scheduledOrderIds: string[]
  biteIncidentId: string | null
}

export const arrivalsEndpoints = {
  previewBundle: { method: 'GET', path: '/api/arrivals/preview-bundle' },
  atomic: { method: 'POST', path: '/api/arrivals/atomic' },
} as const
