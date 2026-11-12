import { z } from 'zod'

/**
 * Login schema — used at the sign-in form. Password length is intentionally
 * unconstrained here: we are authenticating against a stored hash, not
 * registering a new credential.
 */
export const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

export type LoginInput = z.infer<typeof loginSchema>

/**
 * Registration / account-creation schema — enforces the minimum password
 * strength required when setting a new credential.
 */
export const registrationSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password is too long'),
})

export type RegistrationInput = z.infer<typeof registrationSchema>

export const userRoleSchema = z.enum([
  'SuperAdmin',
  'BranchAdmin',
  'Physician',
  'Nurse',
  'Cashier',
  'Branch',
])

export type UserRole = z.infer<typeof userRoleSchema>

export const ADMIN_ROLES: UserRole[] = ['SuperAdmin', 'BranchAdmin']
export const BRANCH_ROLE: UserRole = 'Branch'
