import { z } from 'zod'

const clinicDateSchema = z.string().date('date must be a valid YYYY-MM-DD calendar date')

export const reviewCenterQuerySchema = z.object({
  date: clinicDateSchema.optional(),
  q: z.string().trim().max(100).optional(),
})

export const reviewCenterGuardianUpdateSchema = z.object({
  guardianName: z.string().trim().min(1).max(200),
  guardianRelationship: z.string().trim().min(1).max(100),
  guardianContact: z.string().trim().min(1).max(30),
  expectedRowVersion: z.number().int().nonnegative(),
})

export const reviewCenterMissingGuardianRowSchema = z.object({
  patientId: z.string(),
  mrn: z.string(),
  patientName: z.string(),
  dateOfBirth: clinicDateSchema,
  age: z.number().int().nonnegative(),
  contactNumber: z.string().nullable(),
  guardianName: z.string().nullable(),
  guardianRelationship: z.string().nullable(),
  guardianContact: z.string().nullable(),
  rowVersion: z.number().int().nonnegative(),
})

const staleEncounterRowSchema = z.object({
  encounterId: z.string(),
  patientId: z.string(),
  patientName: z.string(),
  specialty: z.string(),
  status: z.enum(['Open', 'InProgress']),
  startedAt: z.string(),
})

const unsettledTransactionRowSchema = z.object({
  transactionId: z.string(),
  patientId: z.string(),
  patientName: z.string(),
  status: z.string(),
  outstandingAmount: z.string(),
  createdAt: z.string(),
})

const openDrawerRowSchema = z.object({
  sessionId: z.string(),
  openedAt: z.string(),
  userName: z.string().nullable(),
  openingFloat: z.string(),
})

const undocumentedAdministrationRowSchema = z.object({
  orderId: z.string(),
  encounterId: z.string().nullable(),
  patientId: z.string(),
  patientName: z.string(),
  serviceName: z.string(),
  completedAt: z.string(),
})

const potentialDuplicateRowSchema = z.object({
  patientId: z.string(),
  mrn: z.string(),
  patientName: z.string(),
  dateOfBirth: clinicDateSchema.nullable(),
  contactNumber: z.string().nullable(),
  flaggedAt: z.string(),
})

const externalImmunizationReviewRowSchema = z.object({
  patientId: z.string(),
  mrn: z.string(),
  patientName: z.string(),
  vaccineName: z.string(),
  administeredDate: clinicDateSchema.nullable(),
  administeredDatePrecision: z.enum(['Exact', 'Estimated', 'Unknown']),
  administeredAtFacility: z.string().nullable(),
  source: z.string(),
  createdAt: z.string(),
})

export const reviewCenterResponseSchema = z.object({
  generatedAt: z.string(),
  asOfDate: clinicDateSchema,
  branchId: z.string(),
  counts: z.object({
    missingGuardians: z.number().int().nonnegative(),
    yesterdayLooseEnds: z.number().int().nonnegative(),
    potentialDuplicates: z.number().int().nonnegative(),
    externalImmunizations: z.number().int().nonnegative(),
  }),
  missingGuardians: z.object({
    count: z.number().int().nonnegative(),
    rows: z.array(reviewCenterMissingGuardianRowSchema),
  }),
  yesterdayLooseEnds: z.object({
    count: z.number().int().nonnegative(),
    staleOpenEncounters: z.object({
      count: z.number().int().nonnegative(),
      rows: z.array(staleEncounterRowSchema),
    }),
    unsettledTransactions: z.object({
      count: z.number().int().nonnegative(),
      totalOutstanding: z.string(),
      rows: z.array(unsettledTransactionRowSchema),
    }),
    openPriorDrawers: z.object({
      count: z.number().int().nonnegative(),
      rows: z.array(openDrawerRowSchema),
    }),
    undocumentedAdministrations: z.object({
      count: z.number().int().nonnegative(),
      rows: z.array(undocumentedAdministrationRowSchema),
    }),
  }),
  potentialDuplicates: z.object({
    count: z.number().int().nonnegative(),
    rows: z.array(potentialDuplicateRowSchema),
  }),
  externalImmunizations: z.object({
    count: z.number().int().nonnegative(),
    rows: z.array(externalImmunizationReviewRowSchema),
  }),
})

export const reviewCenterGuardianUpdateResponseSchema = z.object({
  patientId: z.string(),
  patientName: z.string(),
  guardianName: z.string(),
  guardianRelationship: z.string(),
  guardianContact: z.string(),
  rowVersion: z.number().int().nonnegative(),
  reviewedById: z.string(),
  reviewedAt: z.string(),
})

export type ReviewCenterQuery = z.input<typeof reviewCenterQuerySchema>
export type ReviewCenterResponse = z.output<typeof reviewCenterResponseSchema>
export type ReviewCenterGuardianUpdate = z.input<typeof reviewCenterGuardianUpdateSchema>
export type ReviewCenterGuardianUpdateResponse = z.output<
  typeof reviewCenterGuardianUpdateResponseSchema
>
