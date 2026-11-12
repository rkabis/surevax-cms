// GENERATED FILE — do not edit.
// Source: apps/backend/src/modules — contract 'patients'.
// Regenerate with `pnpm gen:contracts`; CI fails on drift.

export type PatientsListQuery = {
  q?: string
  cursor?: string
  limit?: number
  sort?: 'last_name' | 'created_at'
  order?: 'asc' | 'desc'
}

export type PatientsListResponse = {
  data: {
    id: string
    mrn: string
    firstName: string
    lastName: string
    middleName: string | null
    dateOfBirth: string | null
    sex: string | null
    contactNumber: string | null
    email: string | null
    address: string | null
    region: string | null
    province: string | null
    city: string | null
    isActive: boolean
    createdAt: string
    isCrossBranch: boolean
    doseStates: ('done' | 'due' | 'overdue' | 'upcoming')[] | null
    pepCompleted: number
    pepTotal: number | null
  }[]
  nextCursor: string | null
  totalCount: number
}

export type PatientsCreateBody = {
  firstName: string
  lastName: string
  middleName?: string
  dateOfBirth?: string
  sex?: 'Male' | 'Female' | 'Other'
  contactNumber?: string
  email?: string | undefined | ''
  smsOptIn?: boolean
  address?: string
  region?: string
  province?: string
  city?: string
  barangay?: string
  guardianName?: string
  guardianRelationship?: string
  guardianContact?: string
  allergies?: string[]
  conditions?: string[]
  insuranceProvider?: string
  insurancePolicyNumber?: string
  civilStatus?: 'Single' | 'Married' | 'Widowed' | 'Separated' | 'Divorced' | 'Live-in'
  onboardingChannel?:
    | 'Walk-in'
    | 'Referral'
    | 'Vaccination drive'
    | 'Partner'
    | 'HMO'
    | 'Social media'
    | 'Returning patient'
    | 'Other'
  onboardingChannelPayerId?: string | null
  consentObtained: true
  consentBy: 'Patient' | 'Guardian'
}

export type PatientsCreateResponse = {
  id: string
  displayId: string
  tenantId: string
  mrn: string
  firstName: string
  lastName: string
  middleName: string | null
  suffix: string | null
  dateOfBirth: string | null
  sex: string | null
  civilStatus: string | null
  nationality: string | null
  address: string | null
  region: string | null
  province: string | null
  city: string | null
  barangay: string | null
  contactNumber: string | null
  email: string | null
  preferredLanguage: string
  smsOptIn: boolean
  emailOptIn: boolean
  guardianName: string | null
  guardianRelationship: string | null
  guardianContact: string | null
  insuranceProvider: string | null
  insurancePolicyNumber: string | null
  onboardingData: unknown
  onboardingChannel: string | null
  mergedAt: string | null
  deletionRequestedAt: string | null
  scheduledPurgeAt: string | null
  isActive: boolean
  rowVersion: number
  deletedAt: string | null
  fullName: string | null
  createdAt: string
  updatedAt: string
  onboardingChannelPayer: { id: string; name: string } | null
  allergies: {
    id: number
    allergen: string | null
    allergenCode: string | null
    reaction: string | null
    severity: string | null
    onsetDate: string | null
    source: string | null
    notes: string | null
    resolvedAt: string | null
  }[]
  conditions: {
    id: number
    conditionName: string | null
    icd10Code: string | null
    status: string | null
    onsetDate: string | null
    resolvedDate: string | null
    notes: string | null
  }[]
  tags: { tag: string; color: string | null; category: string | null }[]
  doseStates: ('done' | 'due' | 'overdue' | 'upcoming')[] | null
  pepCompleted: number
  pepTotal: number | null
}

export type PatientsDetailDisplayIdParam = string

export type PatientsDetailResponse = {
  id: string
  displayId: string
  tenantId: string
  mrn: string
  firstName: string
  lastName: string
  middleName: string | null
  suffix: string | null
  dateOfBirth: string | null
  sex: string | null
  civilStatus: string | null
  nationality: string | null
  address: string | null
  region: string | null
  province: string | null
  city: string | null
  barangay: string | null
  contactNumber: string | null
  email: string | null
  preferredLanguage: string
  smsOptIn: boolean
  emailOptIn: boolean
  guardianName: string | null
  guardianRelationship: string | null
  guardianContact: string | null
  insuranceProvider: string | null
  insurancePolicyNumber: string | null
  onboardingData: unknown
  onboardingChannel: string | null
  mergedAt: string | null
  deletionRequestedAt: string | null
  scheduledPurgeAt: string | null
  isActive: boolean
  rowVersion: number
  deletedAt: string | null
  fullName: string | null
  createdAt: string
  updatedAt: string
  onboardingChannelPayer: { id: string; name: string } | null
  allergies: {
    id: number
    allergen: string | null
    allergenCode: string | null
    reaction: string | null
    severity: string | null
    onsetDate: string | null
    source: string | null
    notes: string | null
    resolvedAt: string | null
  }[]
  conditions: {
    id: number
    conditionName: string | null
    icd10Code: string | null
    status: string | null
    onsetDate: string | null
    resolvedDate: string | null
    notes: string | null
  }[]
  tags: { tag: string; color: string | null; category: string | null }[]
  doseStates: ('done' | 'due' | 'overdue' | 'upcoming')[] | null
  pepCompleted: number
  pepTotal: number | null
}

export type PatientsUpdateDisplayIdParam = string

export type PatientsUpdateBody = {
  firstName?: string
  lastName?: string
  middleName?: string
  dateOfBirth?: string
  sex?: 'Male' | 'Female' | 'Other'
  contactNumber?: string
  email?: string | undefined | ''
  smsOptIn?: boolean
  address?: string
  region?: string
  province?: string
  city?: string
  barangay?: string
  guardianName?: string
  guardianRelationship?: string
  guardianContact?: string
  allergies?: string[]
  conditions?: string[]
  insuranceProvider?: string
  insurancePolicyNumber?: string
  civilStatus?: 'Single' | 'Married' | 'Widowed' | 'Separated' | 'Divorced' | 'Live-in'
  onboardingChannel?:
    | 'Walk-in'
    | 'Referral'
    | 'Vaccination drive'
    | 'Partner'
    | 'HMO'
    | 'Social media'
    | 'Returning patient'
    | 'Other'
  onboardingChannelPayerId?: string | null
}

export type PatientsUpdateResponse = {
  id: string
  displayId: string
  tenantId: string
  mrn: string
  firstName: string
  lastName: string
  middleName: string | null
  suffix: string | null
  dateOfBirth: string | null
  sex: string | null
  civilStatus: string | null
  nationality: string | null
  address: string | null
  region: string | null
  province: string | null
  city: string | null
  barangay: string | null
  contactNumber: string | null
  email: string | null
  preferredLanguage: string
  smsOptIn: boolean
  emailOptIn: boolean
  guardianName: string | null
  guardianRelationship: string | null
  guardianContact: string | null
  insuranceProvider: string | null
  insurancePolicyNumber: string | null
  onboardingData: unknown
  onboardingChannel: string | null
  mergedAt: string | null
  deletionRequestedAt: string | null
  scheduledPurgeAt: string | null
  isActive: boolean
  rowVersion: number
  deletedAt: string | null
  fullName: string | null
  createdAt: string
  updatedAt: string
  onboardingChannelPayer: { id: string; name: string } | null
  allergies: {
    id: number
    allergen: string | null
    allergenCode: string | null
    reaction: string | null
    severity: string | null
    onsetDate: string | null
    source: string | null
    notes: string | null
    resolvedAt: string | null
  }[]
  conditions: {
    id: number
    conditionName: string | null
    icd10Code: string | null
    status: string | null
    onsetDate: string | null
    resolvedDate: string | null
    notes: string | null
  }[]
  tags: { tag: string; color: string | null; category: string | null }[]
  doseStates: ('done' | 'due' | 'overdue' | 'upcoming')[] | null
  pepCompleted: number
  pepTotal: number | null
}

export type PatientsCreditDisplayIdParam = string

export type PatientsCreditResponse = {
  available: string
  deposits: {
    id: string
    depositAmount: string
    funded: string
    consumed: string
    remaining: string
    status: string
    createdAt: string
  }[]
}

export type PatientsPepProgressDisplayIdParam = string

export type PatientsPepProgressResponse = {
  status: 'not-started' | 'in-progress' | 'completed' | 'missed'
  doses: {
    doseNumber: number
    status: 'completed' | 'pending' | 'missed'
    scheduledDate: string | null
    administeredAt: string | null
    label: string
  }[]
  completedDoses: number
  totalDoses: number
  indication: string | null
}

export type PatientsTagsDisplayIdParam = string

export type PatientsTagsResponse = { tag: string; color: string | null; category: string | null }[]

export type PatientsAddTagDisplayIdParam = string

export type PatientsAddTagBody = { tag: string }

export type PatientsAddTagResponse = {
  id: number
  tenantId: string
  patientId: number
  tagDefinitionId: number
  appliedAt: string
  appliedById: number | null
  expiresAt: string | null
  createdAt: string
  createdById: number | null
}

export type PatientsEmergencyContactsDisplayIdParam = string

export type PatientsEmergencyContactsResponse = {
  id: number
  name: string
  relation: string
  phone: string
  email: string | null
  isPrimary: boolean
  createdAt: string
}[]

export type PatientsCreateEmergencyContactDisplayIdParam = string

export type PatientsCreateEmergencyContactBody = {
  name: string
  relation: string
  phone: string
  email?: string | undefined | ''
  isPrimary?: boolean
}

export type PatientsCreateEmergencyContactResponse = {
  id: number
  name: string
  relation: string
  phone: string
  email: string | null
  isPrimary: boolean
  createdAt: string
}

export type PatientsRemoveEmergencyContactDisplayIdParam = string

export type PatientsRemoveEmergencyContactContactIdParam = number

export type PatientsRemoveEmergencyContactResponse = undefined

export type PatientsExternalImmunizationsDisplayIdParam = string

export type PatientsExternalImmunizationsResponse = {
  id: number
  vaccineName: string
  cvxCode: string | null
  manufacturer: string | null
  lotNumber: string | null
  administeredDate: string | null
  administeredDatePrecision: 'Exact' | 'Estimated' | 'Unknown'
  administeredAtFacility: string | null
  doseNumberInSeries: number | null
  source: string
  verifiedAt: string | null
  verifiedBy: { displayId: string; fullName: string; licenseNumber: string | null } | null
  createdAt: string
}[]

export type PatientsCreateExternalImmunizationDisplayIdParam = string

export type PatientsCreateExternalImmunizationBody = {
  vaccineName: string
  cvxCode?: string
  manufacturer?: string
  lotNumber?: string
  administeredDate: string
  administeredAtFacility?: string
  doseNumberInSeries?: number
  source: 'PatientReported' | 'RecordsTransfer' | 'IIS'
}

export type PatientsCreateExternalImmunizationResponse = {
  id: number
  vaccineName: string
  cvxCode: string | null
  manufacturer: string | null
  lotNumber: string | null
  administeredDate: string | null
  administeredDatePrecision: 'Exact' | 'Estimated' | 'Unknown'
  administeredAtFacility: string | null
  doseNumberInSeries: number | null
  source: string
  verifiedAt: string | null
  verifiedBy: { displayId: string; fullName: string; licenseNumber: string | null } | null
  createdAt: string
}

export type PatientsVerifyExternalImmunizationDisplayIdParam = string

export type PatientsVerifyExternalImmunizationImmunizationIdParam = number

export type PatientsVerifyExternalImmunizationBody = {
  reviewedById?: string
  attestationPin?: string
}

export type PatientsVerifyExternalImmunizationResponse = {
  id: number
  vaccineName: string
  cvxCode: string | null
  manufacturer: string | null
  lotNumber: string | null
  administeredDate: string | null
  administeredDatePrecision: 'Exact' | 'Estimated' | 'Unknown'
  administeredAtFacility: string | null
  doseNumberInSeries: number | null
  source: string
  verifiedAt: string | null
  verifiedBy: { displayId: string; fullName: string; licenseNumber: string | null } | null
  createdAt: string
}

export type PatientsAllergiesDisplayIdParam = string

export type PatientsAllergiesResponse = {
  id: number
  allergen: string | null
  allergenCode: string | null
  reaction: string | null
  severity: string | null
  onsetDate: string | null
  source: string | null
  notes: string | null
  resolvedAt: string | null
}[]

export type PatientsCreateAllergyDisplayIdParam = string

export type PatientsCreateAllergyBody = {
  allergen: string
  allergenCode?: string
  reaction?: string
  severity?: string
  onsetDate?: string
  source?: 'PatientReported' | 'Confirmed' | 'External'
  notes?: string
}

export type PatientsCreateAllergyResponse = {
  id: number
  allergen: string | null
  allergenCode: string | null
  reaction: string | null
  severity: string | null
  onsetDate: string | null
  source: string | null
  notes: string | null
  resolvedAt: string | null
}

export type PatientsUpdateAllergyDisplayIdParam = string

export type PatientsUpdateAllergyAllergyIdParam = number

export type PatientsUpdateAllergyBody = {
  allergen?: string
  allergenCode?: string
  reaction?: string
  severity?: string
  onsetDate?: string
  source?: 'PatientReported' | 'Confirmed' | 'External'
  notes?: string
  resolvedAt?: string | null
}

export type PatientsUpdateAllergyResponse = {
  id: number
  allergen: string | null
  allergenCode: string | null
  reaction: string | null
  severity: string | null
  onsetDate: string | null
  source: string | null
  notes: string | null
  resolvedAt: string | null
}

export type PatientsRemoveAllergyDisplayIdParam = string

export type PatientsRemoveAllergyAllergyIdParam = number

export type PatientsRemoveAllergyResponse = undefined

export type PatientsConditionsDisplayIdParam = string

export type PatientsConditionsResponse = {
  id: number
  conditionName: string | null
  icd10Code: string | null
  status: string | null
  onsetDate: string | null
  resolvedDate: string | null
  notes: string | null
}[]

export type PatientsCreateConditionDisplayIdParam = string

export type PatientsCreateConditionBody = {
  conditionName: string
  icd10Code?: string
  status?: 'Active' | 'Resolved' | 'InRemission'
  onsetDate?: string
  notes?: string
}

export type PatientsCreateConditionResponse = {
  id: number
  conditionName: string | null
  icd10Code: string | null
  status: string | null
  onsetDate: string | null
  resolvedDate: string | null
  notes: string | null
}

export type PatientsUpdateConditionDisplayIdParam = string

export type PatientsUpdateConditionConditionIdParam = number

export type PatientsUpdateConditionBody = {
  conditionName?: string
  icd10Code?: string
  status?: 'Active' | 'Resolved' | 'InRemission'
  onsetDate?: string
  notes?: string
  resolvedDate?: string | null
}

export type PatientsUpdateConditionResponse = {
  id: number
  conditionName: string | null
  icd10Code: string | null
  status: string | null
  onsetDate: string | null
  resolvedDate: string | null
  notes: string | null
}

export type PatientsRemoveConditionDisplayIdParam = string

export type PatientsRemoveConditionConditionIdParam = number

export type PatientsRemoveConditionResponse = undefined

export type PatientsConsentsDisplayIdParam = string

export type PatientsConsentsResponse = {
  id: number
  encounterId: number | null
  consentType: string
  scope: string
  scopeRefType: string | null
  scopeRefId: string | null
  consenterRelation: string | null
  consenterName: string | null
  visProvided: boolean | null
  visVersion: string | null
  visDate: string | null
  visLanguage: string | null
  obtainedAt: string | null
  consentLanguage: string | null
  revokedAt: string | null
  revocationReason: string | null
  notes: string | null
  createdAt: string
}[]

export type PatientsDemographicDisplayIdParam = string

export type PatientsDemographicResponse = {
  id: number
  displayId: string
  tenantId: string
  homeBranchId: number | null
  homeBranchDisplayId: string | null
  mrn: string
  firstName: string
  middleName: string | null
  lastName: string
  suffix: string | null
  dateOfBirth: string | null
  sex: string | null
  primaryPhone: string | null
  isActive: boolean
  allergies: { allergen: string; severity: string | null; reaction: string | null }[]
  activeConditions: { icd10: string | null; name: string; status: string }[]
  dpaConsentActive: boolean
  activeCourses: { displayId: string; templateId: string; status: string; startDate: string }[]
  recentDoses: {
    displayId: string
    serviceId: string
    doseNumber: number | null
    completedAt: string
    manufacturerSnapshot: string | null
    expiryDateSnapshot: string | null
    batchNumber: string | null
    lotId: number | null
    branchId: number | null
  }[]
  activeRecalls: {
    displayId: string
    recallNo: string | null
    recallReason: string
    recallSeverity: string
    issuedAt: string
  }[]
  recentCriticalLabResults: {
    displayId: string
    status: string
    hasCriticalValue: boolean
    criticalAcknowledgedAt: string | null
    updatedAt: string
    branchId: number | null
  }[]
  createdAt: string
  updatedAt: string
}

export type PatientsBreakGlassDisplayIdParam = string

export type PatientsBreakGlassBody = {
  reasonCategory:
    | 'Continuity_of_care'
    | 'Emergency'
    | 'Patient_request'
    | 'Quality_review'
    | 'Other'
  reasonDetail: string
  targetBranchId: string
}

export type PatientsBreakGlassResponse = {
  grantId: string
  patientDisplayId: string
  homeBranchId: number | null
  targetBranchId: number
  encounters: {
    id: string
    branchId: number | null
    branch: { displayId: string; name: string } | null
    provider: {
      displayId: string
      firstName: string
      lastName: string
      licenseNumber: string | null
    } | null
    specialty: string
    status: string
    chiefComplaint: string | null
    visitNo: number | null
    startedAt: string
    completedAt: string | null
  }[]
  transactions: {
    id: string
    branchId: number | null
    status: string
    netAmount: string
    amountPaid: string
    amountOutstanding: string
    receiptNo: string | null
    createdAt: string
  }[]
  allergies: {
    id: number
    allergen: string | null
    allergenCode: string | null
    reaction: string | null
    severity: string | null
    onsetDate: string | null
    source: string | null
    notes: string | null
    resolvedAt: string | null
  }[]
  conditions: {
    id: number
    conditionName: string | null
    icd10Code: string | null
    status: string | null
    onsetDate: string | null
    resolvedDate: string | null
    notes: string | null
  }[]
}

export const patientsEndpoints = {
  list: { method: 'GET', path: '/api/patients' },
  create: { method: 'POST', path: '/api/patients' },
  detail: { method: 'GET', path: '/api/patients/:displayId' },
  update: { method: 'PATCH', path: '/api/patients/:displayId' },
  credit: { method: 'GET', path: '/api/patients/:displayId/credit' },
  pepProgress: { method: 'GET', path: '/api/patients/:displayId/pep-progress' },
  tags: { method: 'GET', path: '/api/patients/:displayId/tags' },
  addTag: { method: 'POST', path: '/api/patients/:displayId/tags' },
  emergencyContacts: { method: 'GET', path: '/api/patients/:displayId/emergency-contacts' },
  createEmergencyContact: { method: 'POST', path: '/api/patients/:displayId/emergency-contacts' },
  removeEmergencyContact: {
    method: 'DELETE',
    path: '/api/patients/:displayId/emergency-contacts/:contactId',
  },
  externalImmunizations: { method: 'GET', path: '/api/patients/:displayId/external-immunizations' },
  createExternalImmunization: {
    method: 'POST',
    path: '/api/patients/:displayId/external-immunizations',
  },
  verifyExternalImmunization: {
    method: 'PATCH',
    path: '/api/patients/:displayId/external-immunizations/:immunizationId/verify',
  },
  allergies: { method: 'GET', path: '/api/patients/:displayId/allergies' },
  createAllergy: { method: 'POST', path: '/api/patients/:displayId/allergies' },
  updateAllergy: { method: 'PATCH', path: '/api/patients/:displayId/allergies/:allergyId' },
  removeAllergy: { method: 'DELETE', path: '/api/patients/:displayId/allergies/:allergyId' },
  conditions: { method: 'GET', path: '/api/patients/:displayId/conditions' },
  createCondition: { method: 'POST', path: '/api/patients/:displayId/conditions' },
  updateCondition: { method: 'PATCH', path: '/api/patients/:displayId/conditions/:conditionId' },
  removeCondition: { method: 'DELETE', path: '/api/patients/:displayId/conditions/:conditionId' },
  consents: { method: 'GET', path: '/api/patients/:displayId/consents' },
  demographic: { method: 'GET', path: '/api/patients/:displayId/demographic' },
  breakGlass: { method: 'POST', path: '/api/patients/:displayId/break-glass' },
} as const
