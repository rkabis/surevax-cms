/**
 * Transaction schemas — shared frontend API surface.
 * Backend keeps inline Zod (tsx v4 gotcha).
 *
 * NOTE: `numeric(12,2)` columns arrive as JSON strings from the API — amount
 * fields (grossAmount, netAmount, etc.) are typed `string` in response schemas.
 */
import { z } from 'zod'
import { paymentMethodSchema, transactionStatusSchema, discountIdTypeSchema } from './enums'

// ── Sub-schemas ───────────────────────────────────────────────────────────────

export const transactionItemSchema = z.object({
  serviceId: z.string().min(1, 'Select a service'),
  /**
   * Multi-patient: the patient this line is billed for (PAT_…). Must be the
   * primary `patientId` or appear in `patients[]`. Omit ⇒ the primary patient.
   */
  patientId: z.string().optional(),
  clinicalOrderId: z.string().optional(),
  quantity: z.coerce
    .number()
    .positive('Quantity must be greater than 0')
    .max(10_000, 'Quantity cannot exceed 10,000'),
  isVatExempt: z.boolean().optional(),
  isPrepaid: z.boolean().optional(),
  prepaidTransactionId: z.string().optional(),
})
export type TransactionItem = z.infer<typeof transactionItemSchema>

/** Decimal string for amounts (e.g. "1500.00") — matches numeric column serialisation. */
const decimalAmountSchema = z
  .string()
  .min(1, 'Amount required')
  .regex(/^\d+(\.\d{1,2})?$/, 'Must be a positive decimal (e.g. 150.00)')

export const paymentSchema = z.object({
  method: paymentMethodSchema,
  amount: decimalAmountSchema,
  referenceNumber: z.string().max(120).optional().or(z.literal('')),
  payerId: z.string().max(120).optional().or(z.literal('')),
  notes: z.string().max(2000).optional().or(z.literal('')),
})
export type PaymentInput = z.infer<typeof paymentSchema>

// ── Request schemas ───────────────────────────────────────────────────────────

/**
 * Frontend discount field includes 'NA' as a sentinel for "no discount"
 * (the backend maps 'NA' → null before persistence).
 */
export const transactionDiscountSchema = z
  .object({
    idType: discountIdTypeSchema.or(z.literal('NA')),
    idNumber: z.string().trim().max(64, 'Maximum 64 characters').optional(),
  })
  .superRefine((discount, ctx) => {
    if ((discount.idType === 'OSCA' || discount.idType === 'PWD') && !discount.idNumber?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['idNumber'],
        message: 'Senior/PWD ID number is required',
      })
    }
  })
export type TransactionDiscount = z.infer<typeof transactionDiscountSchema>

/**
 * Per-patient sub-header for multi-patient (family / group) billing. The
 * top-level `patientId` is the primary / bill-to patient (its discount is the
 * top-level `discount`); each ADDITIONAL patient on the bill gets an entry here
 * carrying their own SC/PWD discount + optional encounter.
 */
export const transactionPatientSchema = z.object({
  patientId: z.string().min(1),
  encounterId: z.string().optional(),
  discount: transactionDiscountSchema.nullish(),
})
export type TransactionPatientInput = z.infer<typeof transactionPatientSchema>

export const transactionCreateSchema = z.object({
  patientId: z.string().min(1, 'Select a patient'),
  encounterId: z.string().optional(),
  payerId: z.string().optional(),
  isPrepayment: z.boolean().optional(),
  discount: transactionDiscountSchema.optional(),
  patients: z.array(transactionPatientSchema).max(20, 'Too many patients').optional(),
  items: z.array(transactionItemSchema).min(1, 'Add at least one item'),
  /** Single inline payment at create. Back-compat surface for the common
   *  one-method tender. Mutually exclusive with `payments` — send one or the
   *  other (the backend prefers `payments` when both are present). */
  payment: paymentSchema.optional(),
  /** Split tender: multiple payment legs applied atomically at create (e.g.
   *  part cash, part GCash). Each leg is a separate `payments` row; the backend
   *  walks them through addPayment so status lands Pending→Paid and per-leg
   *  overpayment is capped at the running outstanding balance. */
  payments: z.array(paymentSchema).max(10, 'At most 10 split legs').optional(),
})
export type TransactionCreateInput = z.infer<typeof transactionCreateSchema>

/** Body for recording a standalone payment against an existing transaction. */
export const addPaymentSchema = paymentSchema
export type AddPaymentInput = z.infer<typeof addPaymentSchema>

/** Body for void / refund endpoints — requires a reason. */
export const transactionReasonSchema = z.object({
  reason: z
    .string()
    .min(5, 'Reason must be at least 5 characters')
    .max(500, 'Maximum 500 characters'),
})
export type TransactionReasonInput = z.infer<typeof transactionReasonSchema>

// ── Response shapes ───────────────────────────────────────────────────────────

export const transactionItemResponseSchema = z.object({
  id: z.string(),
  serviceId: z.string(),
  clinicalOrderId: z.string().nullable(),
  quantity: z.string(),
  unitPrice: z.string(),
  discountAmount: z.string(),
  vatAmount: z.string(),
  subtotal: z.string(),
  isVatExempt: z.boolean(),
  isPrepaid: z.boolean(),
  prepaidTransactionId: z.string().nullable(),
  service: z
    .object({
      id: z.string(),
      name: z.string(),
      code: z.string().nullable(),
      serviceType: z.string().nullable(),
    })
    .nullable(),
})
export type TransactionItemResponse = z.infer<typeof transactionItemResponseSchema>

export const transactionPaymentResponseSchema = z.object({
  id: z.string(),
  method: z.string(),
  amount: z.string(),
  payerId: z.string().nullable(),
  referenceNumber: z.string().nullable(),
  receivedById: z.string().nullable(),
  receivedAt: z.string(),
  notes: z.string().nullable(),
  payer: z
    .object({ id: z.string().nullable(), name: z.string(), payerType: z.string() })
    .nullable(),
})
export type TransactionPaymentResponse = z.infer<typeof transactionPaymentResponseSchema>

export const transactionResponseSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  branchId: z.string(),
  patientId: z.string(),
  encounterId: z.string().nullable(),
  cashierId: z.string().nullable(),
  payerId: z.string().nullable(),
  status: transactionStatusSchema,
  orNumber: z.string().nullable(),
  discountIdType: z.string().nullable(),
  discountIdNumber: z.string().nullable(),
  grossAmount: z.string(),
  discountAmount: z.string(),
  vatAmount: z.string(),
  netAmount: z.string(),
  isPrepayment: z.boolean(),
  prepaymentAppliedAt: z.string().nullable(),
  voidedAt: z.string().nullable(),
  voidedById: z.string().nullable(),
  voidReason: z.string().nullable(),
  transactedAt: z.string(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdById: z.string().nullable(),
  patient: z.object({ id: z.string(), firstName: z.string(), lastName: z.string() }),
  cashier: z
    .object({ id: z.string().nullable(), firstName: z.string(), lastName: z.string() })
    .nullable(),
  payer: z
    .object({ id: z.string().nullable(), name: z.string(), payerType: z.string() })
    .nullable(),
  items: z.array(transactionItemResponseSchema),
  payments: z.array(transactionPaymentResponseSchema),
})
export type TransactionResponse = z.infer<typeof transactionResponseSchema>
