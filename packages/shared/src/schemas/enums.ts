/**
 * Shared enum schemas — mirror of the pgEnum definitions in schema.ts.
 * Do NOT import from apps/backend here; these are hand-mirrored for frontend
 * type-safety and shared validation across the monorepo.
 *
 * Enum values marked with NOTE comments may have additional values added via
 * supplemental SQL ALTER TYPE that are not reflected in schema.ts's pgEnum
 * call; the extended lists below are intentionally complete.
 */
import { z } from 'zod'

// ── User & roles ─────────────────────────────────────────────────────────────
// Note: userRoleSchema / UserRole are defined in auth.ts to avoid a duplicate
// export. New code should import from '@surevax/shared' directly.

export const userStatusSchema = z.enum(['Active', 'Inactive', 'Locked', 'PendingActivation'])
export type UserStatus = z.infer<typeof userStatusSchema>

// ── Sex ──────────────────────────────────────────────────────────────────────

export const sexSchema = z.enum(['Male', 'Female', 'Other'])
export type Sex = z.infer<typeof sexSchema>

// ── Service ──────────────────────────────────────────────────────────────────

export const serviceTypeSchema = z.enum(['Vaccine', 'Consultation', 'Lab', 'Procedure', 'Product'])
export type ServiceType = z.infer<typeof serviceTypeSchema>

// ── Encounter ─────────────────────────────────────────────────────────────────

export const encounterSpecialtySchema = z.enum(['Rabies', 'Flu', 'Vaccination', 'General'])
export type EncounterSpecialty = z.infer<typeof encounterSpecialtySchema>

/**
 * NOTE: additional values 'CheckedIn', 'Triage', 'OnHold', 'NoShow' added via
 * supplemental SQL ALTER TYPE — included here for completeness.
 */
export const encounterStatusSchema = z.enum([
  'Open',
  'InProgress',
  'Completed',
  'Cancelled',
  'CheckedIn',
  'Triage',
  'OnHold',
  'NoShow',
])
export type EncounterStatus = z.infer<typeof encounterStatusSchema>

// ── Clinical orders ───────────────────────────────────────────────────────────

export const clinicalOrderTypeSchema = z.enum(['Standing_Order', 'Ad_Hoc', 'STAT'])
export type ClinicalOrderType = z.infer<typeof clinicalOrderTypeSchema>

/**
 * NOTE: additional values 'Deferred', 'Refused' added via supplemental SQL
 * ALTER TYPE — included here for completeness.
 */
export const clinicalOrderStatusSchema = z.enum([
  'Scheduled',
  'Pending',
  'Completed',
  'Missed',
  'Cancelled',
  'Deferred',
  'Refused',
])
export type ClinicalOrderStatus = z.infer<typeof clinicalOrderStatusSchema>

export const administrationRouteSchema = z.enum(['IM', 'SC', 'ID', 'IV', 'PO', 'IN', 'Topical'])
export type AdministrationRoute = z.infer<typeof administrationRouteSchema>

export const standingOrderStatusSchema = z.enum([
  'Active',
  'Completed',
  'Discontinued',
  'Suspended',
])
export type StandingOrderStatus = z.infer<typeof standingOrderStatusSchema>

// ── Transactions & payments ───────────────────────────────────────────────────

/**
 * NOTE: additional value 'PartiallyPaid' added via supplemental SQL ALTER TYPE.
 */
export const transactionStatusSchema = z.enum([
  'Draft',
  'Pending',
  'Paid',
  'Voided',
  'Refunded',
  'PartiallyPaid',
])
export type TransactionStatus = z.infer<typeof transactionStatusSchema>

export const paymentMethodSchema = z.enum([
  'Cash',
  'GCash',
  'Maya',
  'BankTransfer',
  'Card',
  'PayMongo',
  'HMO',
  'Corporate',
  'Other',
])
export type PaymentMethod = z.infer<typeof paymentMethodSchema>

export const payerTypeSchema = z.enum(['HMO', 'Corporate', 'Government', 'Promo'])
export type PayerType = z.infer<typeof payerTypeSchema>

export const discountIdTypeSchema = z.enum(['OSCA', 'PWD', 'Other'])
export type DiscountIdType = z.infer<typeof discountIdTypeSchema>

// ── Inventory ─────────────────────────────────────────────────────────────────

export const movementTypeSchema = z.enum(['In', 'Out', 'Adjustment', 'Transfer', 'Expire'])
export type MovementType = z.infer<typeof movementTypeSchema>

// ── Lab orders ────────────────────────────────────────────────────────────────

export const labOrderStatusSchema = z.enum(['Pending', 'Sent', 'ResultReceived', 'Cancelled'])
export type LabOrderStatus = z.infer<typeof labOrderStatusSchema>

// ── Notifications ─────────────────────────────────────────────────────────────

export const notificationChannelSchema = z.enum(['SMS', 'Email', 'Push'])
export type NotificationChannel = z.infer<typeof notificationChannelSchema>

export const notificationStatusSchema = z.enum(['Queued', 'Sent', 'Failed', 'Cancelled'])
export type NotificationStatus = z.infer<typeof notificationStatusSchema>

// ── Audit ─────────────────────────────────────────────────────────────────────

export const auditActionSchema = z.enum([
  'CREATE',
  'READ',
  'UPDATE',
  'DELETE',
  'LOGIN',
  'LOGOUT',
  'CROSS_BRANCH_ACCESS',
  'TRANSACTION_MODIFY',
  'SCHEDULE_CHANGE',
])
export type AuditAction = z.infer<typeof auditActionSchema>

// ── Approvals ─────────────────────────────────────────────────────────────────

export const approvalRequestTypeSchema = z.enum([
  'void_transaction',
  'inventory_adjustment',
  'schedule_change',
  'discount_override',
  'patient_erasure',
  'emergency_access',
])
export type ApprovalRequestType = z.infer<typeof approvalRequestTypeSchema>

export const approvalStatusSchema = z.enum(['Pending', 'Approved', 'Rejected'])
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>

// ── Consents ──────────────────────────────────────────────────────────────────

export const consenterRelationSchema = z.enum([
  'Patient',
  'Parent',
  'Guardian',
  'Spouse',
  'Caregiver',
  'Other',
])
export type ConsenterRelation = z.infer<typeof consenterRelationSchema>

// ── Claims ────────────────────────────────────────────────────────────────────

export const claimStatusSchema = z.enum([
  'Draft',
  'Submitted',
  'Acknowledged',
  'InReview',
  'Approved',
  'PartiallyApproved',
  'Denied',
  'Paid',
  'Appealed',
])
export type ClaimStatus = z.infer<typeof claimStatusSchema>

// ── Cash drawer ───────────────────────────────────────────────────────────────

export const drawerStateSchema = z.enum(['Open', 'Closed', 'Reconciled', 'Discrepancy'])
export type DrawerState = z.infer<typeof drawerStateSchema>
