import type { SourceEnvelope } from './sourceEnvelope.js'

export type EvidenceConfidence = 'deterministic' | 'owner_approved' | 'manual_verified'

export type CanonicalEventBase = {
  eventId: string
  patientLegacyId: string
  branchLegacyId: string | null
  serviceId: string
  doseNumber: number | null
  confidence: EvidenceConfidence
  evidence: SourceEnvelope[]
  augmentationId?: string
}

export type LocalAdministrationEvent = CanonicalEventBase & {
  kind: 'local_administration'
  administeredAt: string
  route?: 'IM' | 'ID' | 'SC' | 'IV' | 'PO' | 'IN' | 'Topical' | 'INF'
  site?: string
  brandSnapshot?: string
  linkedTransactionLegacyId?: string
}

export type ExternalAdministrationEvent = CanonicalEventBase & {
  kind: 'external_administration'
  administeredAt: string | null
  datePrecision: 'exact' | 'unknown'
  dateBasis: 'explicit_source_date' | 'unknown_owner_assumption'
  externalClinicName?: string
  externalClinicianName?: string
  externalNotes?: string
}

export type ScheduledDoseEvent = CanonicalEventBase & {
  kind: 'scheduled_dose'
  patientStandingOrderLegacyId: string
  scheduledAt: string
  scheduleBasis: 'source_explicit' | 'template_derived'
}

export type CanonicalDoseEvent =
  | LocalAdministrationEvent
  | ExternalAdministrationEvent
  | ScheduledDoseEvent

export type ReconciliationException = {
  exceptionId: string
  priority: 'P0' | 'P1' | 'P2'
  code:
    | 'SAME_SLOT_CONFLICT'
    | 'AMBIGUOUS_PATIENT_MATCH'
    | 'BRANCH_CONFLICT'
    | 'FINANCIAL_CONFLICT'
    | 'UNREPRESENTABLE_TARGET_FACT'
  patientLegacyId?: string
  eventIds: string[]
  summary: string
  evidence: SourceEnvelope[]
}

export type CanonicalEventLedger = {
  events: CanonicalDoseEvent[]
  exceptions: ReconciliationException[]
}

export function emptyEventLedger(): CanonicalEventLedger {
  return { events: [], exceptions: [] }
}
