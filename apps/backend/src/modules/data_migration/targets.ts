/**
 * Destination row shapes — minimal projections of the Drizzle schema columns
 * the importer writes.
 *
 * Design principle: **use the schema that already exists, don't invent new
 * tables.** Every legacy concept has a home. AppSheet-only concepts route to a
 * jsonb field that already exists (`onboarding_data`, `clinical_notes`).
 *
 *   • p_Categorization 1/2/3   → encounters.triage_category = 'CAT-1/2/3'
 *   • p_OnboardingChannel      → patients.onboarding_data.channel
 *   • p_PetStatus             → preserved for biting-animal follow-up migration
 *   • p_PetFirstARVDate       → preserved as the human patient's first ARV date
 *   • health card URL → DROPPED (B2)
 *   • Remarks (matched)        → encounters.clinical_notes.remarks
 *   • Remarks (orphan)         → patients.onboarding_data.legacyNotes
 *   • ImmunizationBundle       → DROPPED (A2)
 *   • InventoryLog             → DROPPED (D1)
 *   • t_DiscountRef=FullyPaid  → transactions.discount_id_type='Other' + amount
 *   • ARV-PEP courses          → patient_standing_orders + clinical_orders link
 *   • cross-format dupes       → patients.merged_into_id + patient_tags
 *
 * Optional new column: `legacy_appsheet_id text` on entities needing idempotent
 * re-import (NOT patients per A3).
 */

export type TargetBranch = {
  displayId: string
  tenantId: string
  code: string
  name: string
  address: string | null
  email: string | null
  isActive: boolean
  legacyAppsheetId: string
}

export type TargetUser = {
  displayId: string
  tenantId: string
  email: string
  passwordHash: string
  firstName: string
  lastName: string
  primaryBranchDisplayId: string | null
  canLogin: boolean
  status: 'Active' | 'Inactive' | 'Locked' | 'PendingActivation'
  legacyAppsheetId: string
  roles: Array<'TenantAdmin' | 'BranchAdmin' | 'Physician' | 'Nurse' | 'Cashier' | 'Branch'>
}

export type TargetProduct = {
  displayId: string
  tenantId: string
  name: string
  manufacturer: string | null
  defaultRoute: 'IM' | 'SC' | 'ID' | 'IV' | 'PO' | 'IN' | 'Topical' | 'INF' | null
  vialVolumeMl: string | null
  isActive: boolean
  legacyAppsheetId: string
}

export type TargetServiceCatalog = {
  id: string
  tenantId: string
  code: string
  name: string
  serviceType: 'Vaccine' | 'Consultation' | 'MedicalCertificate' | 'LabTest' | 'LabBundle' | 'Other'
  defaultRoute: TargetProduct['defaultRoute']
  defaultDoseVolumeMl: string | null
  isVatExempt: boolean
  requiresStock: boolean
  isActive: boolean
  legacyAppsheetId: string
}

export type TargetServiceEligibleProduct = {
  tenantId: string
  serviceId: string
  productLegacyId: string
  ranking: number
  isDefault: boolean
}

export type TargetServicePrice = {
  tenantId: string
  serviceId: string
  payerCode: string | null
  unitPrice: string
  effectiveFrom: string
}

export type TargetPatient = {
  displayId: string
  tenantId: string
  mrnSeq: number
  homeBranchDisplayId: string | null
  firstName: string
  lastName: string
  middleName: string | null
  dateOfBirth: string | null
  sex: 'Male' | 'Female' | 'Other' | 'Unknown' | null
  contactNumber: string | null
  email: string | null
  address: string | null
  onboardingData: Record<string, unknown>
  isActive: boolean
  createdAt: Date | null
  /** In-memory FK-resolution key only; NOT persisted (A3). */
  legacyAppsheetId: string
  /** Cross-format duplicate: points at the older (primary) record's legacy id. */
  mergedIntoLegacyId?: string | null
}

export type TargetEncounter = {
  displayId: string
  tenantId: string
  patientLegacyId: string
  branchDisplayId: string
  specialty: 'General' | 'Rabies' | 'Vaccination' | 'Flu' | 'Lab'
  status: 'Open' | 'Completed' | 'Cancelled'
  startedAt: Date
  completedAt: Date | null
  attendingUserLegacyId: string | null
  triageCategory: 'CAT-1' | 'CAT-2' | 'CAT-3' | null
  clinicalNotes: Record<string, unknown> | null
  specialtyData: Record<string, unknown> | null
  legacyAppsheetId: string
}

export type TargetPatientStandingOrder = {
  displayId: string
  tenantId: string
  patientLegacyId: string
  templateId: string
  initiatingEncounterLegacyId: string
  status: 'Active' | 'Completed' | 'Suspended' | 'Discontinued'
  startDate: Date
  endDate: Date | null
  legacyAppsheetId: string
}

export type TargetClinicalOrder = {
  displayId: string
  tenantId: string
  serviceId: string
  /**
   * A historical external administration may not have an encounter in the
   * source system. The physical `clinical_orders.encounter_id` column is
   * nullable, so do not invent one just to satisfy an old target type.
   */
  encounterLegacyId: string | null
  patientLegacyId: string
  patientStandingOrderLegacyId: string | null
  /** `External` is provenance, not a member of clinical_order_type. */
  orderType: 'Ad_Hoc' | 'Standing_Order' | 'STAT'
  status: 'Scheduled' | 'Pending' | 'Completed' | 'Missed' | 'Cancelled'
  /** Preserve the source plan separately from the live/recalculated plan. */
  originalScheduledDate: Date | null
  currentScheduledDate: Date | null
  completedAt: Date | null
  /** Completion is evidenced but the actual administration date is unknown. */
  completedAtUnknown: boolean
  administeredByUserLegacyId: string | null
  quantity: string
  doseNumber: number | null
  administrationRoute: TargetProduct['defaultRoute']
  administrationSite: string | null
  indication: string | null
  administeredAtExternalClinic: boolean
  externalClinicianName: string | null
  externalClinicName: string | null
  externalNotes: string | null
  /** Compact source/rule provenance. The durable migration ledger remains authoritative. */
  notes?: Record<string, unknown> | null
  legacyAppsheetId: string
}

/**
 * App-owner-approved migration-only consent. This unblocks the normal v2
 * consent gate without claiming the legacy record proves historic consent.
 */
export type TargetLegacyImportConsent = {
  displayId: string
  tenantId: string
  patientLegacyId: string
  obtainedAt: Date
  obtainedByUserLegacyId: string
  legacyAppsheetId: string
}

export type TargetTransaction = {
  displayId: string
  tenantId: string
  branchDisplayId: string
  patientLegacyId: string
  cashierUserLegacyId: string | null
  payerCode: string | null
  status: 'Draft' | 'Pending' | 'Paid' | 'Voided' | 'Refunded'
  grossAmount: string
  discountAmount: string
  vatAmount: string
  netAmount: string
  amountPaid: string
  /** Schema enum is `OSCA | PWD | Other`. */
  discountIdType: 'OSCA' | 'PWD' | 'Other' | null
  discountIdNumber: string | null
  transactedAt: Date
  legacyAppsheetId: string
}

export type TargetTransactionItem = {
  displayId: string
  tenantId: string
  transactionLegacyId: string
  serviceId: string
  clinicalOrderLegacyId: string | null
  quantity: string
  unitPrice: string
  subtotal: string
  discountAmount: string
  vatAmount: string
  performedByUserLegacyId: string | null
}

export type TargetPayment = {
  displayId: string
  tenantId: string
  transactionLegacyId: string
  method: 'Cash' | 'GCash' | 'BankTransfer' | 'PayMongo' | 'Other'
  amount: string
  referenceNumber: string | null
  reconciliationStatus: string
  receivedAt: Date
}

export type TargetCashDrawerSession = {
  displayId: string
  tenantId: string
  branchDisplayId: string
  openedByUserLegacyId: string | null
  openingFloat: string
  state: 'Open' | 'Closed' | 'Reconciled'
  openedAt: Date
  closedAt: Date | null
  legacyAppsheetId: string
}

export type TargetStaffTimeLog = {
  displayId: string
  tenantId: string
  userLegacyId: string
  branchDisplayId: string
  clockInAt: Date
  clockOutAt: Date | null
  totalHours: string | null
  notes: string | null
  legacyAppsheetId: string
}

/** Tag-application — uses existing patient_tags + tag_definitions. */
export type TargetPatientTag = {
  tenantId: string
  patientLegacyId: string
  tagCode: string
  appliedAt: Date
}

export type LoadPlan = {
  branches: TargetBranch[]
  users: TargetUser[]
  products: TargetProduct[]
  services: TargetServiceCatalog[]
  serviceEligibleProducts: TargetServiceEligibleProduct[]
  servicePrices: TargetServicePrice[]
  patients: TargetPatient[]
  legacyImportConsents: TargetLegacyImportConsent[]
  encounters: TargetEncounter[]
  patientStandingOrders: TargetPatientStandingOrder[]
  clinicalOrders: TargetClinicalOrder[]
  transactions: TargetTransaction[]
  transactionItems: TargetTransactionItem[]
  payments: TargetPayment[]
  cashDrawerSessions: TargetCashDrawerSession[]
  staffTimeLogs: TargetStaffTimeLog[]
  patientTags: TargetPatientTag[]
}

export function emptyLoadPlan(): LoadPlan {
  return {
    branches: [],
    users: [],
    products: [],
    services: [],
    serviceEligibleProducts: [],
    servicePrices: [],
    patients: [],
    legacyImportConsents: [],
    encounters: [],
    patientStandingOrders: [],
    clinicalOrders: [],
    transactions: [],
    transactionItems: [],
    payments: [],
    cashDrawerSessions: [],
    staffTimeLogs: [],
    patientTags: [],
  }
}
