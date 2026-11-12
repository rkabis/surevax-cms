/**
 * encounters API contract — schemas + endpoint manifest.
 *
 * Request schemas are the runtime validators used by routes.ts; response
 * schemas describe the ACTUAL res.json payloads and are enforced against the
 * implementation via `satisfies` at each res.json callsite.
 *
 * Side-effect-free imports only (zod + pure shared utils) — the generator
 * imports this file without a configured environment.
 */
import { z } from 'zod'
import { prefixedDisplayIdSchema } from '../../shared/utils/displayId.js'
import { defineContract } from '../../contracts/defineContract.js'

// ── Request schemas (runtime validators for routes.ts) ──────────────────────

export const encounterIdSchema = prefixedDisplayIdSchema('ENC')
export const patientIdSchema = prefixedDisplayIdSchema('PAT')
export const userIdSchema = prefixedDisplayIdSchema('USR')

// Allow-list of sortable column keys for GET /api/encounters.
const ENCOUNTER_SORTABLE_COLUMNS = ['created_at', 'specialty'] as const

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  patientId: patientIdSchema.optional(),
  sort: z.enum(ENCOUNTER_SORTABLE_COLUMNS).optional(),
  order: z.enum(['asc', 'desc']).optional(),
})

export const createEncounterSchema = z.object({
  patientId: patientIdSchema,
  specialty: z.enum(['Rabies', 'Flu', 'Vaccination', 'General']),
  chiefComplaint: z.string().max(2000).optional(),
  specialtyData: z.record(z.unknown()).optional(),
  clinicalNotes: z.record(z.unknown()).optional(),
})

// numeric columns arrive/depart as strings (gotchas.md).
const numericStringField = (min: number, max: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === 'string' ? parseFloat(v) : v))
    .pipe(z.number().min(min).max(max))
    .transform((n) => String(n))

export const createVitalSchema = z.object({
  temperatureC: numericStringField(25, 45).optional(),
  heartRateBpm: z.coerce.number().int().min(0).max(300).optional(),
  respiratoryRateBpm: z.coerce.number().int().min(0).max(100).optional(),
  systolic: z.coerce.number().int().min(0).max(300).optional(),
  diastolic: z.coerce.number().int().min(0).max(300).optional(),
  systolicBp: z.coerce.number().int().min(0).max(300).optional(),
  diastolicBp: z.coerce.number().int().min(0).max(300).optional(),
  spo2Percent: z.union([z.string(), z.number()]).transform(String).optional(),
  weightKg: numericStringField(0.5, 500).optional(),
  heightCm: numericStringField(10, 300).optional(),
  bmi: numericStringField(5, 100).optional(),
  painScore: z.coerce.number().int().min(0).max(10).optional(),
  extra: z.record(z.unknown()).optional(),
})

export const createDiagnosisSchema = z.object({
  icd10Code: z.string().min(1).max(20),
  description: z.string().max(1000).optional(),
  isPrimary: z.boolean().optional(),
  diagnosisType: z.string().max(100).optional(),
  recordedById: userIdSchema.optional(),
  notes: z.string().max(5000).optional(),
})

// Status-transition bodies. Mirrors the void/refund shape in
// transactions/contract.ts: completion needs no explanation (routine),
// cancellation is an irreversible, out-of-the-ordinary call and gets the
// same typed-reason gate (min 5 / max 500 chars).
export const encounterCompleteBodySchema = z.object({})

export const encounterCancelBodySchema = z.object({
  reason: z
    .string()
    .min(5, 'Reason must be at least 5 characters')
    .max(500, 'Maximum 500 characters'),
})

// ── Response schemas (wire truth — keep in lockstep with db.ts/service.ts) ──

const encounterListRowSchema = z.object({
  id: z.string(),
  specialty: z.string(),
  status: z.string(),
  triageCategory: z.string().nullable(),
  chiefComplaint: z.string().nullable(),
  visitNo: z.number().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  bundleLabel: z.string(),
  // Patient — LEFT JOIN; columns widen to nullable even if source is NOT NULL.
  patientId: z.string().nullable(),
  patientFirstName: z.string().nullable(),
  patientLastName: z.string().nullable(),
  // Provider — LEFT JOIN
  providerId: z.string().nullable(),
  providerFirstName: z.string().nullable(),
  providerLastName: z.string().nullable(),
  providerRole: z.string().nullable(),
  // Location — LEFT JOIN
  branchId: z.string().nullable(),
  branchName: z.string().nullable(),
  createdAt: z.string(),
})

const listResponseSchema = z.object({
  data: z.array(encounterListRowSchema),
})

/**
 * Vital row from encounter_vitals full select (.returning()).
 * NOTE: id, encounterId, patientId, recordedById, createdById are bigint PKs/FKs
 * crossing the wire raw — a known internal-id leak captured as-is.
 */
const vitalRowSchema = z.object({
  id: z.number(),
  tenantId: z.string(),
  encounterId: z.number(),
  patientId: z.number(),
  recordedAt: z.string(),
  recordedById: z.number().nullable(),
  /** numeric(4,1) — crosses the wire as a string. */
  temperatureC: z.string().nullable(),
  heartRateBpm: z.number().nullable(),
  respiratoryRateBpm: z.number().nullable(),
  systolicBp: z.number().nullable(),
  diastolicBp: z.number().nullable(),
  /** numeric(5,2) — crosses the wire as a string. */
  spo2Percent: z.string().nullable(),
  /** numeric(6,2) — crosses the wire as a string. */
  weightKg: z.string().nullable(),
  /** numeric(5,1) — crosses the wire as a string. */
  heightCm: z.string().nullable(),
  /** numeric(5,2) — crosses the wire as a string. */
  bmi: z.string().nullable(),
  painScore: z.number().nullable(),
  /** JSONB — shape not modeled. */
  extra: z.unknown(),
  rowVersion: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdById: z.number().nullable(),
})

/**
 * Diagnosis row from encounter_diagnoses full select (.returning()).
 * NOTE: id, encounterId, patientId, recordedById, createdById are bigint
 * PKs/FKs crossing the wire raw — a known internal-id leak captured as-is.
 */
const diagnosisRowSchema = z.object({
  id: z.number(),
  tenantId: z.string(),
  encounterId: z.number(),
  patientId: z.number(),
  icd10Code: z.string(),
  description: z.string().nullable(),
  isPrimary: z.boolean(),
  diagnosisType: z.string().nullable(),
  recordedById: z.number().nullable(),
  notes: z.string().nullable(),
  rowVersion: z.number(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdById: z.number().nullable(),
})

/**
 * Encounter detail from getEncounter / createEncounter.
 * NOTE: createdById is a bigint PK crossing the wire raw.
 */
const encounterDetailSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  specialty: z.string(),
  status: z.string(),
  triageCategory: z.string().nullable(),
  chiefComplaint: z.string().nullable(),
  visitNo: z.number().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  bundleLabel: z.string(),
  /** JSONB — shape not modeled. */
  specialtyData: z.unknown(),
  /** JSONB — shape not modeled. */
  clinicalNotes: z.unknown(),
  dispositionCode: z.string().nullable(),
  /**
   * NOTE: closedById is a bigint PK crossing the wire raw — a known
   * display-id convention leak, captured as-is.
   */
  closedById: z.number().nullable(),
  /**
   * NOTE: appointmentId is a bigint FK crossing the wire raw — a known
   * internal-id leak, captured as-is.
   */
  appointmentId: z.number().nullable(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /**
   * NOTE: createdById is a bigint FK crossing the wire raw — a known
   * internal-id leak, captured as-is.
   */
  createdById: z.number().nullable(),
  // Patient — LEFT JOIN; columns widen to nullable.
  patientId: z.string().nullable(),
  patientFirstName: z.string().nullable(),
  patientLastName: z.string().nullable(),
  patientDateOfBirth: z.string().nullable(),
  // Provider — LEFT JOIN
  providerId: z.string().nullable(),
  providerFirstName: z.string().nullable(),
  providerLastName: z.string().nullable(),
  providerRole: z.string().nullable(),
  // Location — LEFT JOIN
  branchId: z.string().nullable(),
  branchName: z.string().nullable(),
  // Sub-resources: empty arrays on create, populated on detail fetch.
  vitals: z.array(vitalRowSchema),
  diagnoses: z.array(diagnosisRowSchema),
})

const vitalsListResponseSchema = z.object({
  data: z.array(vitalRowSchema),
})

const diagnosesListResponseSchema = z.object({
  data: z.array(diagnosisRowSchema),
})

// ── Manifest ─────────────────────────────────────────────────────────────────

export const encountersContract = defineContract('encounters', {
  list: {
    method: 'GET',
    path: '/api/encounters',
    query: listQuerySchema,
    response: listResponseSchema,
  },
  detail: {
    method: 'GET',
    path: '/api/encounters/:displayId',
    params: { displayId: encounterIdSchema },
    response: encounterDetailSchema,
  },
  create: {
    method: 'POST',
    path: '/api/encounters',
    body: createEncounterSchema,
    response: encounterDetailSchema,
  },
  vitals: {
    method: 'GET',
    path: '/api/encounters/:displayId/vitals',
    params: { displayId: encounterIdSchema },
    response: vitalsListResponseSchema,
  },
  createVital: {
    method: 'POST',
    path: '/api/encounters/:displayId/vitals',
    params: { displayId: encounterIdSchema },
    body: createVitalSchema,
    response: vitalRowSchema,
  },
  diagnoses: {
    method: 'GET',
    path: '/api/encounters/:displayId/diagnoses',
    params: { displayId: encounterIdSchema },
    response: diagnosesListResponseSchema,
  },
  createDiagnosis: {
    method: 'POST',
    path: '/api/encounters/:displayId/diagnoses',
    params: { displayId: encounterIdSchema },
    body: createDiagnosisSchema,
    response: diagnosisRowSchema,
  },
  complete: {
    method: 'POST',
    path: '/api/encounters/:displayId/complete',
    params: { displayId: encounterIdSchema },
    body: encounterCompleteBodySchema,
    response: encounterDetailSchema,
  },
  cancel: {
    method: 'POST',
    path: '/api/encounters/:displayId/cancel',
    params: { displayId: encounterIdSchema },
    body: encounterCancelBodySchema,
    response: encounterDetailSchema,
  },
})

// ── Inferred response types (used by routes.ts `satisfies` assertions) ───────

export type EncountersListResponse = z.infer<typeof listResponseSchema>
export type EncountersDetailResponse = z.infer<typeof encounterDetailSchema>
export type EncountersCreateResponse = z.infer<typeof encounterDetailSchema>
export type EncountersVitalsResponse = z.infer<typeof vitalsListResponseSchema>
export type EncountersCreateVitalResponse = z.infer<typeof vitalRowSchema>
export type EncountersDiagnosesResponse = z.infer<typeof diagnosesListResponseSchema>
export type EncountersCreateDiagnosisResponse = z.infer<typeof diagnosisRowSchema>
export type EncountersCompleteResponse = z.infer<typeof encounterDetailSchema>
export type EncountersCancelResponse = z.infer<typeof encounterDetailSchema>
