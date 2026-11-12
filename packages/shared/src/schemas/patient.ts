import { z } from 'zod'

/**
 * Patient creation schema — canonical source of truth shared between frontend
 * forms and type-checking.
 *
 * Sex and date of birth are optional: some intake workflows capture the patient
 * name and contact first, with demographics filled in on subsequent visits
 * (e.g. paediatric referrals where only the guardian is present).
 * The backend routes.ts mirrors this optionality.
 */
export const createPatientSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100, 'Maximum 100 characters'),
  lastName: z.string().min(1, 'Last name is required').max(100, 'Maximum 100 characters'),
  dateOfBirth: z.string().date('Must be a valid date (YYYY-MM-DD)').optional(),
  sex: z.enum(['Male', 'Female', 'Other']).optional(),
  contactNumber: z.string().max(30, 'Maximum 30 characters').optional(),
  address: z.string().max(500, 'Maximum 500 characters').optional(),
  region: z.string().max(100, 'Maximum 100 characters').optional(),
  province: z.string().max(100, 'Maximum 100 characters').optional(),
  city: z.string().max(100, 'Maximum 100 characters').optional(),
  barangay: z.string().max(100, 'Maximum 100 characters').optional(),
  consentObtained: z.literal(true),
  consentBy: z.enum(['Patient', 'Guardian']),
})

export type CreatePatientInput = z.infer<typeof createPatientSchema>
