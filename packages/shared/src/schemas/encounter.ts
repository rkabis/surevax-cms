/**
 * Encounter schemas — shared between frontend forms and type-checking.
 *
 * Backend keeps inline Zod (tsx v4 cannot resolve @surevax/shared values at
 * runtime). These schemas are the canonical API surface for the frontend.
 */
import { z } from 'zod'
import { encounterSpecialtySchema, encounterStatusSchema } from './enums'

// ── Sub-schemas ───────────────────────────────────────────────────────────────

/**
 * Vitals captured at encounter intake.
 * All fields optional — vitals may be partially captured.
 * Bounds are sanity guards; matches `encounters.clinicalNotes.vitals` JSONB.
 */
export const encounterVitalsSchema = z.object({
  bpSystolic: z
    .number({ invalid_type_error: 'Must be a number' })
    .int('Must be a whole number')
    .min(40, 'Too low (typical range 90–140 mmHg)')
    .max(300, 'Too high — recheck')
    .optional(),
  bpDiastolic: z
    .number({ invalid_type_error: 'Must be a number' })
    .int('Must be a whole number')
    .min(20, 'Too low (typical range 60–90 mmHg)')
    .max(200, 'Too high — recheck')
    .optional(),
  heartRate: z
    .number({ invalid_type_error: 'Must be a number' })
    .int('Must be a whole number')
    .min(20, 'Too low (typical range 60–100 bpm)')
    .max(300, 'Too high — recheck')
    .optional(),
  respiratoryRate: z
    .number({ invalid_type_error: 'Must be a number' })
    .int('Must be a whole number')
    .min(4, 'Too low (typical range 12–20 breaths/min)')
    .max(80, 'Too high — recheck')
    .optional(),
  temperatureC: z
    .number({ invalid_type_error: 'Must be a number' })
    .min(25, 'Too low (typical range 36.1–37.2 °C)')
    .max(45, 'Too high — recheck')
    .optional(),
  spo2: z
    .number({ invalid_type_error: 'Must be a number' })
    .int('Must be a whole number')
    .min(50, 'Too low (typical range 95–100%)')
    .max(100, 'Cannot exceed 100%')
    .optional(),
  weightKg: z
    .number({ invalid_type_error: 'Must be a number' })
    .min(0.5, 'Too low — recheck (minimum 0.5 kg)')
    .max(400, 'Too high — recheck')
    .optional(),
  heightCm: z
    .number({ invalid_type_error: 'Must be a number' })
    .min(20, 'Too low — recheck (minimum 20 cm)')
    .max(260, 'Too high — recheck')
    .optional(),
})
export type EncounterVitals = z.infer<typeof encounterVitalsSchema>

/** WHO-category rabies bite assessment stored in `encounters.specialtyData`. */
export const biteAssessmentSchema = z.object({
  whoCategory: z.enum(['I', 'II', 'III']).optional(),
  animalType: z.enum(['Dog', 'Cat', 'Bat', 'Monkey', 'Other']).optional(),
  animalTypeOther: z.string().max(100).optional(),
  animalStatus: z.enum(['Healthy', 'Sick', 'Dead', 'Unknown', 'Vaccinated']).optional(),
  animalArvStatus: z.enum(['Vaccinated', 'NotVaccinated', 'Unknown']).optional(),
  brainExamResult: z.enum(['Positive', 'Negative', 'Pending', 'NotDone']).optional(),
  animalOwnerName: z.string().max(200).optional(),
  animalDisposition: z
    .enum(['Died', 'UnderObservation', 'Escaped', 'Euthanized', 'Released', 'Unknown'])
    .optional(),
  exposureDate: z.string().optional(),
  exposureTime: z.string().optional(),
  circumstances: z.enum(['Provoked', 'Unprovoked', 'Unknown']).optional(),
  woundSite: z.string().max(200).optional(),
  washedWithSoap: z.boolean().optional(),
  priorPep: z.boolean().optional(),
  priorPepDetails: z.string().max(2000).optional(),
})
export type BiteAssessment = z.infer<typeof biteAssessmentSchema>

export const encounterDiagnosisSchema = z.object({
  icd10Code: z.string().min(1, 'ICD-10 code is required').max(20, 'Maximum 20 characters'),
  description: z.string().max(500, 'Maximum 500 characters').optional(),
  isPrimary: z.boolean().optional(),
  diagnosisType: z.string().max(50, 'Maximum 50 characters').optional(),
  notes: z.string().max(2000, 'Maximum 2000 characters').optional(),
})
export type EncounterDiagnosis = z.infer<typeof encounterDiagnosisSchema>

// ── Request schemas ───────────────────────────────────────────────────────────

export const encounterCreateSchema = z.object({
  patientId: z.string().min(1, 'Patient is required'),
  specialty: encounterSpecialtySchema,
  chiefComplaint: z.string().max(2000, 'Maximum 2000 characters').optional(),
  clinicalNotes: z.object({ vitals: encounterVitalsSchema.optional() }).optional(),
  specialtyData: biteAssessmentSchema.optional(),
})
export type EncounterCreateInput = z.infer<typeof encounterCreateSchema>

export const encounterUpdateSchema = z.object({
  status: encounterStatusSchema.optional(),
  chiefComplaint: z.string().max(2000).optional(),
  clinicalNotes: z.object({ vitals: encounterVitalsSchema.optional() }).optional(),
  specialtyData: biteAssessmentSchema.optional(),
})
export type EncounterUpdateInput = z.infer<typeof encounterUpdateSchema>

// ── Response shapes ───────────────────────────────────────────────────────────

export const encounterResponseSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  specialty: z.string(),
  status: z.string(),
  triageCategory: z.string().nullable(),
  bundleLabel: z.string(),
  chiefComplaint: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  specialtyData: z.record(z.unknown()).nullable(),
  clinicalNotes: z.record(z.unknown()).nullable(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdById: z.string().nullable(),
  patientId: z.string().nullable(),
  patientFirstName: z.string().nullable(),
  patientLastName: z.string().nullable(),
  patientDateOfBirth: z.string().nullable(),
  providerId: z.string().nullable(),
  providerFirstName: z.string().nullable(),
  providerLastName: z.string().nullable(),
  providerRole: z.string().nullable(),
  branchId: z.string().nullable(),
  branchName: z.string().nullable(),
})
export type EncounterResponse = z.infer<typeof encounterResponseSchema>
