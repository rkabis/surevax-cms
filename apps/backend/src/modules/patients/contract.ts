/**
 * patients API contract — schemas + endpoint manifest.
 *
 * Request schemas are the runtime validators from routes.ts; response schemas
 * describe the ACTUAL res.json payloads (wire truth). Side-effect-free imports
 * only (zod + pure shared utils) — the generator imports this file without a
 * configured environment.
 */
import { z } from 'zod'
import { prefixedDisplayIdSchema } from '../../shared/utils/displayId.js'
import { defineContract } from '../../contracts/defineContract.js'

// ── Request schemas (verbatim from routes.ts) ────────────────────────────────

// Accept either full ISO datetime or plain date string.
const dateOrDatetime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/, 'Invalid date')

export const patDisplayIdSchema = prefixedDisplayIdSchema('PAT')

const numericIdSchema = z.coerce.number().int().positive()

const ONBOARDING_CHANNELS = [
  'Walk-in',
  'Referral',
  'Vaccination drive',
  'Partner',
  'HMO',
  'Social media',
  'Returning patient',
  'Other',
] as const

const patientFieldsBody = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  middleName: z.string().max(100).optional(),
  dateOfBirth: dateOrDatetime.optional(),
  sex: z.enum(['Male', 'Female', 'Other']).optional(),
  contactNumber: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal('')),
  // Messaging-consent flag (patients.sms_opt_in), distinct from the clinical
  // consents table. Defaults false at the DB layer; the registration form
  // must capture it explicitly (nurse-testing-readiness R1/R2) so the SMS
  // dose-reminder action has someone opted-in to text.
  smsOptIn: z.boolean().optional(),
  address: z.string().max(500).optional(),
  region: z.string().max(100).optional(),
  province: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  barangay: z.string().max(100).optional(),
  guardianName: z.string().max(200).optional(),
  guardianRelationship: z.string().max(100).optional(),
  guardianContact: z.string().max(30).optional(),
  allergies: z.array(z.string().max(120)).max(50).optional(),
  conditions: z.array(z.string().max(120)).max(50).optional(),
  insuranceProvider: z.string().max(200).optional(),
  insurancePolicyNumber: z.string().max(120).optional(),
  civilStatus: z
    .enum(['Single', 'Married', 'Widowed', 'Separated', 'Divorced', 'Live-in'])
    .optional(),
  onboardingChannel: z.enum(ONBOARDING_CHANNELS).optional(),
  onboardingChannelPayerId: prefixedDisplayIdSchema('PYR').nullable().optional(),
})

export const createPatientBody = patientFieldsBody.extend({
  /** Explicit registration-time attestation; the patient and active consent
   * row are committed together so the new chart is immediately usable. */
  consentObtained: z.literal(true),
  consentBy: z.enum(['Patient', 'Guardian']),
})

export const updatePatientBody = patientFieldsBody.partial()

const PATIENT_SORTABLE_COLUMNS = ['last_name', 'created_at'] as const

export const patientsListQuery = z.object({
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(PATIENT_SORTABLE_COLUMNS).optional(),
  order: z.enum(['asc', 'desc']).optional(),
})

export const addTagBody = z.object({
  tag: z.string().min(1).max(120),
})

export const createEmergencyContactBody = z.object({
  name: z.string().min(1).max(200),
  relation: z.string().min(1).max(100),
  phone: z.string().min(1).max(50),
  email: z.string().email().optional().or(z.literal('')),
  isPrimary: z.boolean().optional(),
})

export const createExternalImmunizationBody = z.object({
  vaccineName: z.string().min(1).max(200),
  cvxCode: z.string().max(20).optional(),
  manufacturer: z.string().max(200).optional(),
  lotNumber: z.string().max(100).optional(),
  administeredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  administeredAtFacility: z.string().max(300).optional(),
  doseNumberInSeries: z.number().int().positive().optional(),
  source: z.enum(['PatientReported', 'RecordsTransfer', 'IIS']),
})

export const verifyExternalImmunizationBody = z.object({
  reviewedById: prefixedDisplayIdSchema('USR').optional(),
  attestationPin: z
    .string()
    .regex(/^\d{4}$/, 'PIN must be exactly 4 digits')
    .optional(),
})

const allergySourceEnum = z.enum(['PatientReported', 'Confirmed', 'External'])

export const createAllergyBody = z.object({
  allergen: z.string().min(1).max(200),
  allergenCode: z.string().max(40).optional(),
  reaction: z.string().max(500).optional(),
  severity: z.string().max(40).optional(),
  onsetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
    .optional(),
  source: allergySourceEnum.optional(),
  notes: z.string().max(2000).optional(),
})

export const updateAllergyBody = z.object({
  allergen: z.string().min(1).max(200).optional(),
  allergenCode: z.string().max(40).optional(),
  reaction: z.string().max(500).optional(),
  severity: z.string().max(40).optional(),
  onsetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
    .optional(),
  source: allergySourceEnum.optional(),
  notes: z.string().max(2000).optional(),
  resolvedAt: z.string().datetime().nullable().optional(),
})

const conditionStatusEnum = z.enum(['Active', 'Resolved', 'InRemission'])

export const createConditionBody = z.object({
  conditionName: z.string().min(1).max(200),
  icd10Code: z.string().max(20).optional(),
  status: conditionStatusEnum.optional(),
  onsetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
    .optional(),
  notes: z.string().max(2000).optional(),
})

export const updateConditionBody = z.object({
  conditionName: z.string().min(1).max(200).optional(),
  icd10Code: z.string().max(20).optional(),
  status: conditionStatusEnum.optional(),
  onsetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
    .optional(),
  notes: z.string().max(2000).optional(),
  resolvedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
    .nullable()
    .optional(),
})

const REASON_CATEGORIES = [
  'Continuity_of_care',
  'Emergency',
  'Patient_request',
  'Quality_review',
  'Other',
] as const

export const breakGlassBody = z.object({
  reasonCategory: z.enum(REASON_CATEGORIES),
  reasonDetail: z.string().min(10).max(2000),
  targetBranchId: z.string().min(1),
})

// ── Response schemas (wire truth — keep in lockstep with db.ts) ──────────────

// Allergy row — returned by list/create/update endpoints. `allergen` is
// nullable for the Cross-Branch PHI RFC Tier-2 masking case: a cross-branch
// caller still gets the row (so the array length discloses that an allergy
// IS recorded) but every detail field, including the allergen name, is
// nulled. create/update/delete are branch-gated (403) before reaching here,
// so a caller only ever sees a null allergen on a masked GET, never as the
// direct result of their own write.
const allergyRowSchema = z.object({
  id: z.number(),
  allergen: z.string().nullable(),
  allergenCode: z.string().nullable(),
  reaction: z.string().nullable(),
  severity: z.string().nullable(),
  // date column serialized as string by postgres-js
  onsetDate: z.string().nullable(),
  source: z.string().nullable(),
  notes: z.string().nullable(),
  resolvedAt: z.string().nullable(),
})

// Condition row — both the patient DETAIL conditions join and the conditions
// SUB-RESOURCE (list/create/update) project icd10_code under the unified wire
// name "icd10Code" (matching the DB column). One schema, one shape.
// `conditionName` is nullable for the same Cross-Branch PHI RFC Tier-2
// masking reason as allergyRowSchema.allergen above; see that comment.
const conditionRowSchema = z.object({
  id: z.number(),
  conditionName: z.string().nullable(),
  icd10Code: z.string().nullable(),
  status: z.string().nullable(),
  onsetDate: z.string().nullable(),
  resolvedDate: z.string().nullable(),
  notes: z.string().nullable(),
})

// Tag row (from getPatientTags — joined with tag_definitions).
// patient_tags has no display_id and tagDefinitionId is an internal bigint FK,
// so neither is exposed — the chip renders from tag/color/category alone.
const tagRowSchema = z.object({
  tag: z.string(),
  color: z.string().nullable(),
  category: z.string().nullable(),
})

// Emergency contact row (uses aliased `relation` and `phone` field names per db.ts)
const emergencyContactRowSchema = z.object({
  // NOTE: id is a bigint PK — crosses the wire as a number.
  id: z.number(),
  name: z.string(),
  relation: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  isPrimary: z.boolean(),
  createdAt: z.string(),
})

// External immunization row
const externalImmunizationRowSchema = z.object({
  // NOTE: id is a bigint PK — crosses the wire as a number.
  id: z.number(),
  vaccineName: z.string(),
  cvxCode: z.string().nullable(),
  manufacturer: z.string().nullable(),
  lotNumber: z.string().nullable(),
  administeredDate: z.string().nullable(),
  administeredDatePrecision: z.enum(['Exact', 'Estimated', 'Unknown']),
  administeredAtFacility: z.string().nullable(),
  doseNumberInSeries: z.number().nullable(),
  source: z.string(),
  verifiedAt: z.string().nullable(),
  verifiedBy: z
    .object({
      displayId: z.string(),
      fullName: z.string(),
      licenseNumber: z.string().nullable(),
    })
    .nullable(),
  createdAt: z.string(),
})

// Consent row (from listConsents via consents table)
const consentRowSchema = z.object({
  // NOTE: id is a bigint PK — crosses the wire as a number.
  id: z.number(),
  encounterId: z.number().nullable(),
  consentType: z.string(),
  scope: z.string(),
  scopeRefType: z.string().nullable(),
  // scope_ref_id stores the scoped entity DISPLAY id (text, per consents spec).
  scopeRefId: z.string().nullable(),
  consenterRelation: z.string().nullable(),
  consenterName: z.string().nullable(),
  visProvided: z.boolean().nullable(),
  visVersion: z.string().nullable(),
  visDate: z.string().nullable(),
  visLanguage: z.string().nullable(),
  obtainedAt: z.string().nullable(),
  consentLanguage: z.string().nullable(),
  revokedAt: z.string().nullable(),
  revocationReason: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
})

// Onboarding payer ref (included in patient detail when onboardingChannelPayerId is set)
const payerRefSchema = z
  .object({
    // payer_profiles.displayId (PYR_…)
    id: z.string(),
    name: z.string(),
  })
  .nullable()

// Patient detail (from getPatient — includes allergies/conditions/tags inline)
const patientRowSchema = z.object({
  // displayId aliased as `id` — clients never see the internal bigint PK.
  id: z.string(),
  displayId: z.string(),
  tenantId: z.string(),
  mrn: z.string(),
  // homeBranchId (bigint FK) is intentionally NOT exposed here — no bigint
  // crosses the wire. Cross-branch logic reads it from the demographic endpoint.
  firstName: z.string(),
  lastName: z.string(),
  middleName: z.string().nullable(),
  suffix: z.string().nullable(),
  // Drizzle `date` column serialized as string by postgres-js
  dateOfBirth: z.string().nullable(),
  sex: z.string().nullable(),
  civilStatus: z.string().nullable(),
  nationality: z.string().nullable(),
  address: z.string().nullable(),
  region: z.string().nullable(),
  province: z.string().nullable(),
  city: z.string().nullable(),
  barangay: z.string().nullable(),
  contactNumber: z.string().nullable(),
  email: z.string().nullable(),
  preferredLanguage: z.string(),
  smsOptIn: z.boolean(),
  emailOptIn: z.boolean(),
  guardianName: z.string().nullable(),
  guardianRelationship: z.string().nullable(),
  guardianContact: z.string().nullable(),
  insuranceProvider: z.string().nullable(),
  insurancePolicyNumber: z.string().nullable(),
  // JSONB — shape not modeled.
  onboardingData: z.unknown(),
  onboardingChannel: z.string().nullable(),
  // healthCardAttachmentId, potentialDuplicateOfId, mergedIntoId are bigints on the table
  // but are excluded from the getPatient projection (not returned from select).
  // The raw DB row fields NOT included in the detail projection are suppressed above.
  mergedAt: z.string().nullable(),
  deletionRequestedAt: z.string().nullable(),
  scheduledPurgeAt: z.string().nullable(),
  isActive: z.boolean(),
  rowVersion: z.number(),
  deletedAt: z.string().nullable(),
  fullName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // createdById (bigint FK) is intentionally NOT exposed — no bigint crosses the wire.
})

// Detail = base row + resolved sub-entities. POST /api/patients returns the
// BASE row only (createPatient returns the bare insert row — no sub-entity
// arrays); GET /:id and PATCH /:id return the full detail.
const patientDetailSchema = patientRowSchema.extend({
  // Resolved payer reference (null when no payer is associated)
  onboardingChannelPayer: payerRefSchema,
  allergies: z.array(allergyRowSchema),
  conditions: z.array(conditionRowSchema),
  tags: z.array(tagRowSchema),
  // Per-dose states for the patient's active standing-order course, same
  // derivation as the list row below (getActiveDoseStatesTx in db.ts); null
  // when there is no active course. Nulled (along with pepCompleted/pepTotal)
  // for a cross-branch-masked patient, see getPatient's masking branch.
  doseStates: z.array(z.enum(['done', 'due', 'overdue', 'upcoming'])).nullable(),
  pepCompleted: z.number(),
  pepTotal: z.number().nullable(),
})

// List row shape (from listPatients — publicData after stripping _internalId)
const patientListRowSchema = z.object({
  // displayId aliased as `id` — clients never see the internal bigint PK.
  id: z.string(),
  mrn: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  middleName: z.string().nullable(),
  // Drizzle `date` column serialized as string by postgres-js
  dateOfBirth: z.string().nullable(),
  sex: z.string().nullable(),
  contactNumber: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  region: z.string().nullable(),
  province: z.string().nullable(),
  city: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  // Server-derived branch relationship; does not expose an internal bigint FK.
  isCrossBranch: z.boolean(),
  // Dose states from active standing-order course; null when no active course.
  doseStates: z.array(z.enum(['done', 'due', 'overdue', 'upcoming'])).nullable(),
  // Count of completed doses in the active course.
  pepCompleted: z.number(),
  // Total doses in the active course; null when no active course.
  pepTotal: z.number().nullable(),
})

// List response: {data, nextCursor, totalCount} envelope (as returned by listPatients)
const patientsListResponseSchema = z.object({
  data: z.array(patientListRowSchema),
  nextCursor: z.string().nullable(),
  totalCount: z.number(),
})

// Credit response (from getPatientCredit)
const creditDepositSchema = z.object({
  id: z.string(),
  depositAmount: z.string(),
  funded: z.string(),
  consumed: z.string(),
  remaining: z.string(),
  status: z.string(),
  createdAt: z.string(),
})

const patientCreditResponseSchema = z.object({
  available: z.string(),
  deposits: z.array(creditDepositSchema),
})

// PEP progress response (from getPepProgress)
const pepProgressDoseSchema = z.object({
  doseNumber: z.number(),
  status: z.enum(['completed', 'pending', 'missed']),
  scheduledDate: z.string().nullable(),
  administeredAt: z.string().nullable(),
  label: z.string(),
})

const pepProgressResponseSchema = z.object({
  status: z.enum(['not-started', 'in-progress', 'completed', 'missed']),
  doses: z.array(pepProgressDoseSchema),
  completedDoses: z.number(),
  totalDoses: z.number(),
  indication: z.string().nullable(),
})

// Demographic projection (from getPatientDemographicProjection / patients_demographic_v)
// These are JSONB arrays from the view, modeled as z.unknown() arrays.
const demographicResponseSchema = z.object({
  // NOTE: id is the internal bigint PK — crosses the wire as a number.
  id: z.number(),
  displayId: z.string(),
  tenantId: z.string(),
  // NOTE: homeBranchId is a bigint FK — crosses the wire as a number.
  homeBranchId: z.number().nullable(),
  // The home branch's display_id (e.g. "SVX.TMG"), joined in alongside the
  // bigint above. Break-glass (breakGlassBody.targetBranchId) needs THIS
  // field, not homeBranchId stringified: the route resolves a display_id
  // back to a bigint server-side.
  homeBranchDisplayId: z.string().nullable(),
  mrn: z.string(),
  firstName: z.string(),
  middleName: z.string().nullable(),
  lastName: z.string(),
  suffix: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  sex: z.string().nullable(),
  primaryPhone: z.string().nullable(),
  isActive: z.boolean(),
  // JSONB aggregates — shapes mirror PatientDemographicRow in db.ts
  allergies: z.array(
    z.object({
      allergen: z.string(),
      severity: z.string().nullable(),
      reaction: z.string().nullable(),
    }),
  ),
  activeConditions: z.array(
    z.object({ icd10: z.string().nullable(), name: z.string(), status: z.string() }),
  ),
  dpaConsentActive: z.boolean(),
  activeCourses: z.array(
    z.object({
      displayId: z.string(),
      templateId: z.string(),
      status: z.string(),
      startDate: z.string(),
    }),
  ),
  recentDoses: z.array(
    z.object({
      displayId: z.string(),
      serviceId: z.string(),
      doseNumber: z.number().nullable(),
      completedAt: z.string(),
      manufacturerSnapshot: z.string().nullable(),
      expiryDateSnapshot: z.string().nullable(),
      batchNumber: z.string().nullable(),
      // NOTE: lotId/branchId are bigint FKs crossing the wire as numbers.
      lotId: z.number().nullable(),
      branchId: z.number().nullable(),
    }),
  ),
  activeRecalls: z.array(
    z.object({
      displayId: z.string(),
      recallNo: z.string().nullable(),
      recallReason: z.string(),
      recallSeverity: z.string(),
      issuedAt: z.string(),
    }),
  ),
  recentCriticalLabResults: z.array(
    z.object({
      displayId: z.string(),
      status: z.string(),
      hasCriticalValue: z.boolean(),
      criticalAcknowledgedAt: z.string().nullable(),
      updatedAt: z.string(),
      branchId: z.number().nullable(),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
})

// Break-glass chart response (from breakGlassPatientChart → result.chart)
const breakGlassEncounterRowSchema = z.object({
  id: z.string(),
  // NOTE: branchId is a bigint FK crossing the wire as a number.
  branchId: z.number().nullable(),
  branch: z.object({ displayId: z.string(), name: z.string() }).nullable(),
  provider: z
    .object({
      displayId: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      licenseNumber: z.string().nullable(),
    })
    .nullable(),
  specialty: z.string(),
  status: z.string(),
  chiefComplaint: z.string().nullable(),
  visitNo: z.number().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
})

const breakGlassTransactionRowSchema = z.object({
  id: z.string(),
  // NOTE: branchId is a bigint FK crossing the wire as a number.
  branchId: z.number().nullable(),
  status: z.string(),
  // numeric(12,2) columns cross the wire as strings
  netAmount: z.string(),
  amountPaid: z.string(),
  amountOutstanding: z.string(),
  receiptNo: z.string().nullable(),
  createdAt: z.string(),
})

const breakGlassResponseSchema = z.object({
  grantId: z.string(),
  patientDisplayId: z.string(),
  // NOTE: homeBranchId is a bigint FK crossing the wire as a number.
  homeBranchId: z.number().nullable(),
  // NOTE: targetBranchId is a bigint FK crossing the wire as a number.
  targetBranchId: z.number(),
  encounters: z.array(breakGlassEncounterRowSchema),
  transactions: z.array(breakGlassTransactionRowSchema),
  // Full (unmasked) detail: the Tier-3 reveal is the explicit, audited
  // access the Tier-2 allergy/condition masking exists to gate. Reuses the
  // same row schemas as the sub-resource endpoints (allergyRowSchema /
  // conditionRowSchema stay nullable to type both shapes; a break-glass
  // response never actually carries a null allergen/conditionName).
  allergies: z.array(allergyRowSchema),
  conditions: z.array(conditionRowSchema),
})

// addPatientTag returns the raw patient_tags INSERT .returning() row.
// All bigint columns from the table cross the wire as numbers.
const patientTagInsertRowSchema = z.object({
  // NOTE: all id/FK fields below are bigint PKs/FKs crossing the wire as numbers.
  id: z.number(),
  tenantId: z.string(),
  patientId: z.number(),
  tagDefinitionId: z.number(),
  appliedAt: z.string(),
  appliedById: z.number().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
  createdById: z.number().nullable(),
})

// ── Manifest ──────────────────────────────────────────────────────────────────

export const patientsContract = defineContract('patients', {
  list: {
    method: 'GET',
    path: '/api/patients',
    query: patientsListQuery,
    response: patientsListResponseSchema,
  },
  create: {
    method: 'POST',
    path: '/api/patients',
    body: createPatientBody,
    response: patientDetailSchema,
  },
  detail: {
    method: 'GET',
    path: '/api/patients/:displayId',
    params: { displayId: patDisplayIdSchema },
    response: patientDetailSchema,
  },
  update: {
    method: 'PATCH',
    path: '/api/patients/:displayId',
    params: { displayId: patDisplayIdSchema },
    body: updatePatientBody,
    response: patientDetailSchema,
  },
  credit: {
    method: 'GET',
    path: '/api/patients/:displayId/credit',
    params: { displayId: patDisplayIdSchema },
    response: patientCreditResponseSchema,
  },
  pepProgress: {
    method: 'GET',
    path: '/api/patients/:displayId/pep-progress',
    params: { displayId: patDisplayIdSchema },
    response: pepProgressResponseSchema,
  },
  tags: {
    method: 'GET',
    path: '/api/patients/:displayId/tags',
    params: { displayId: patDisplayIdSchema },
    response: z.array(tagRowSchema),
  },
  addTag: {
    method: 'POST',
    path: '/api/patients/:displayId/tags',
    params: { displayId: patDisplayIdSchema },
    body: addTagBody,
    response: patientTagInsertRowSchema,
  },
  emergencyContacts: {
    method: 'GET',
    path: '/api/patients/:displayId/emergency-contacts',
    params: { displayId: patDisplayIdSchema },
    response: z.array(emergencyContactRowSchema),
  },
  createEmergencyContact: {
    method: 'POST',
    path: '/api/patients/:displayId/emergency-contacts',
    params: { displayId: patDisplayIdSchema },
    body: createEmergencyContactBody,
    response: emergencyContactRowSchema,
  },
  removeEmergencyContact: {
    method: 'DELETE',
    path: '/api/patients/:displayId/emergency-contacts/:contactId',
    params: { displayId: patDisplayIdSchema, contactId: numericIdSchema },
    response: z.undefined(),
  },
  externalImmunizations: {
    method: 'GET',
    path: '/api/patients/:displayId/external-immunizations',
    params: { displayId: patDisplayIdSchema },
    response: z.array(externalImmunizationRowSchema),
  },
  createExternalImmunization: {
    method: 'POST',
    path: '/api/patients/:displayId/external-immunizations',
    params: { displayId: patDisplayIdSchema },
    body: createExternalImmunizationBody,
    response: externalImmunizationRowSchema,
  },
  verifyExternalImmunization: {
    method: 'PATCH',
    path: '/api/patients/:displayId/external-immunizations/:immunizationId/verify',
    params: { displayId: patDisplayIdSchema, immunizationId: numericIdSchema },
    body: verifyExternalImmunizationBody,
    response: externalImmunizationRowSchema,
  },
  allergies: {
    method: 'GET',
    path: '/api/patients/:displayId/allergies',
    params: { displayId: patDisplayIdSchema },
    response: z.array(allergyRowSchema),
  },
  createAllergy: {
    method: 'POST',
    path: '/api/patients/:displayId/allergies',
    params: { displayId: patDisplayIdSchema },
    body: createAllergyBody,
    response: allergyRowSchema,
  },
  updateAllergy: {
    method: 'PATCH',
    path: '/api/patients/:displayId/allergies/:allergyId',
    params: { displayId: patDisplayIdSchema, allergyId: numericIdSchema },
    body: updateAllergyBody,
    response: allergyRowSchema,
  },
  removeAllergy: {
    method: 'DELETE',
    path: '/api/patients/:displayId/allergies/:allergyId',
    params: { displayId: patDisplayIdSchema, allergyId: numericIdSchema },
    response: z.undefined(),
  },
  conditions: {
    method: 'GET',
    path: '/api/patients/:displayId/conditions',
    params: { displayId: patDisplayIdSchema },
    response: z.array(conditionRowSchema),
  },
  createCondition: {
    method: 'POST',
    path: '/api/patients/:displayId/conditions',
    params: { displayId: patDisplayIdSchema },
    body: createConditionBody,
    response: conditionRowSchema,
  },
  updateCondition: {
    method: 'PATCH',
    path: '/api/patients/:displayId/conditions/:conditionId',
    params: { displayId: patDisplayIdSchema, conditionId: numericIdSchema },
    body: updateConditionBody,
    response: conditionRowSchema,
  },
  removeCondition: {
    method: 'DELETE',
    path: '/api/patients/:displayId/conditions/:conditionId',
    params: { displayId: patDisplayIdSchema, conditionId: numericIdSchema },
    response: z.undefined(),
  },
  consents: {
    method: 'GET',
    path: '/api/patients/:displayId/consents',
    params: { displayId: patDisplayIdSchema },
    response: z.array(consentRowSchema),
  },
  demographic: {
    method: 'GET',
    path: '/api/patients/:displayId/demographic',
    params: { displayId: patDisplayIdSchema },
    response: demographicResponseSchema,
  },
  breakGlass: {
    method: 'POST',
    path: '/api/patients/:displayId/break-glass',
    params: { displayId: patDisplayIdSchema },
    body: breakGlassBody,
    response: breakGlassResponseSchema,
  },
})

// ── Inferred response types (used by routes.ts `satisfies` assertions) ────────

export type PatientsListResponse = z.infer<typeof patientsListResponseSchema>
export type PatientsCreateResponse = z.infer<typeof patientRowSchema>
export type PatientsDetailResponse = z.infer<typeof patientDetailSchema>
export type PatientsUpdateResponse = z.infer<typeof patientDetailSchema>
export type PatientsCreditResponse = z.infer<typeof patientCreditResponseSchema>
export type PatientsPepProgressResponse = z.infer<typeof pepProgressResponseSchema>
export type PatientsTagsResponse = z.infer<typeof tagRowSchema>[]
export type PatientsAddTagResponse = z.infer<typeof patientTagInsertRowSchema>
export type PatientsEmergencyContactsResponse = z.infer<typeof emergencyContactRowSchema>[]
export type PatientsCreateEmergencyContactResponse = z.infer<typeof emergencyContactRowSchema>
export type PatientsExternalImmunizationsResponse = z.infer<typeof externalImmunizationRowSchema>[]
export type PatientsCreateExternalImmunizationResponse = z.infer<
  typeof externalImmunizationRowSchema
>
export type PatientsVerifyExternalImmunizationResponse = z.infer<
  typeof externalImmunizationRowSchema
>
export type PatientsAllergiesResponse = z.infer<typeof allergyRowSchema>[]
export type PatientsCreateAllergyResponse = z.infer<typeof allergyRowSchema>
export type PatientsUpdateAllergyResponse = z.infer<typeof allergyRowSchema>
export type PatientsConditionsResponse = z.infer<typeof conditionRowSchema>[]
export type PatientsCreateConditionResponse = z.infer<typeof conditionRowSchema>
export type PatientsUpdateConditionResponse = z.infer<typeof conditionRowSchema>
export type PatientsConsentsResponse = z.infer<typeof consentRowSchema>[]
export type PatientsDemographicResponse = z.infer<typeof demographicResponseSchema>
export type PatientsBreakGlassResponse = z.infer<typeof breakGlassResponseSchema>
