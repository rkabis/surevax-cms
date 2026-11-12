/**
 * transactions API contract — schemas + endpoint manifest.
 *
 * Request schemas are the runtime validators used by routes.ts; response
 * schemas describe the ACTUAL res.json payloads and are enforced against the
 * implementation via `satisfies` at each res.json callsite.
 *
 * Side-effect-free imports only (zod + pure shared utils) — the generator
 * imports this file without a configured environment.
 */
import { z } from 'zod'
import { prefixedDisplayIdSchema, catalogCodeSchema } from '../../shared/utils/displayId.js'
import { defineContract } from '../../contracts/defineContract.js'

// ── Request schemas (runtime validators for routes.ts) ──────────────────────

export const txnDisplayId = prefixedDisplayIdSchema('TXN')
export const patientDisplayId = prefixedDisplayIdSchema('PAT')
export const encounterDisplayId = prefixedDisplayIdSchema('ENC')
export const payerDisplayId = prefixedDisplayIdSchema('PYR')
export const clinicalOrderDisplayId = prefixedDisplayIdSchema('ORD')
export const paymentDisplayId = prefixedDisplayIdSchema('PMT')

/**
 * Deliberate: 'Credit' is excluded — it is an internal-only method minted by
 * `applyPrepayment`; clients must never post it directly.
 */
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

/**
 * Positive money: numeric(12,2) accepts string or number; normalise to a
 * 2-decimal string. The DB CHECK constraint enforces > 0.
 */
export const positiveMoneySchema = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? v.toFixed(2) : v.trim()))
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v) && parseFloat(v) > 0, 'must be a positive decimal')

/**
 * The staff member who physically took the payment, recorded as
 * `payments.received_by_id`. Omit to attribute the payment to the caller,
 * which is only allowed when the caller is a real person logged in as
 * themselves (Nurse, Physician, BranchAdmin, TenantAdmin, or Cashier). On the
 * shared `Branch` kiosk this is REQUIRED, together with `attestationPin`: see
 * `shared/utils/clinicianAttestation.ts`.
 */
const attestedByIdSchema = prefixedDisplayIdSchema('USR').optional()
/** The named staff member's 4-digit kiosk PIN: the same PIN clock-in uses. */
const attestationPinSchema = z
  .string()
  .regex(/^\d{4}$/, 'PIN must be 4 digits')
  .optional()

const transactionDiscountSchema = z
  .object({
    idType: z.enum(['OSCA', 'PWD', 'Other', 'NA']),
    idNumber: z.string().trim().max(64).optional(),
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

export const createTransactionSchema = z
  .object({
    patientId: patientDisplayId,
    encounterId: encounterDisplayId.optional(),
    payerId: payerDisplayId.optional(),
    isPrepayment: z.boolean().optional(),
    depositAmount: positiveMoneySchema.optional(),
    discount: transactionDiscountSchema.nullable().optional(),
    items: z
      .array(
        z.object({
          serviceId: catalogCodeSchema,
          /**
           * Multi-patient: the patient this line is billed for. Must be the
           * top-level `patientId` (primary) or appear in `patients[]`. Omit ⇒
           * the primary patient.
           */
          patientId: patientDisplayId.optional(),
          clinicalOrderId: clinicalOrderDisplayId.optional(),
          quantity: z.number().positive().max(10_000),
          isVatExempt: z.boolean().optional(),
          isPrepaid: z.boolean().optional(),
          prepaidTransactionId: txnDisplayId.optional(),
        }),
      )
      .max(100, 'Too many items')
      .default([]),
    /**
     * Multi-patient (family / group) billing: per-patient sub-headers carrying
     * each patient's BIR SC/PWD discount + optional encounter link. The
     * top-level `patientId` is the primary / bill-to patient; additional
     * patients in this list may own line items. Omit ⇒ single-patient
     * transaction (the top-level `patientId` + `discount` apply). One combined
     * payment settles the whole transaction regardless.
     */
    patients: z
      .array(
        z.object({
          patientId: patientDisplayId,
          encounterId: encounterDisplayId.optional(),
          discount: transactionDiscountSchema.nullable().optional(),
        }),
      )
      .max(20, 'Too many patients')
      .optional(),
    payment: z
      .object({
        method: paymentMethodSchema,
        amount: positiveMoneySchema,
        referenceNumber: z.string().min(1).max(120).optional(),
        payerId: payerDisplayId.optional(),
        notes: z.string().max(2000).optional(),
      })
      .optional(),
    payments: z
      .array(
        z.object({
          method: paymentMethodSchema,
          amount: positiveMoneySchema,
          referenceNumber: z.string().min(1).max(120).optional(),
          payerId: payerDisplayId.optional(),
          notes: z.string().max(2000).optional(),
        }),
      )
      .max(10, 'At most 10 split legs')
      .optional(),
    /**
     * Who physically took the inline payment (single `payment` leg or every
     * leg in `payments[]`): one attestation for the whole create call, the
     * same shape as `administeredById` on the dose path. See
     * `attestedByIdSchema` above.
     */
    attestedById: attestedByIdSchema,
    attestationPin: attestationPinSchema,
  })
  .refine((v) => v.items.length >= 1 || (v.isPrepayment === true && !!v.depositAmount), {
    message: 'Provide at least one item, or set isPrepayment with a depositAmount',
    path: ['items'],
  })

export const addPaymentBodySchema = z.object({
  method: paymentMethodSchema,
  amount: positiveMoneySchema,
  referenceNumber: z.string().min(1).max(120).optional(),
  payerId: payerDisplayId.optional(),
  notes: z.string().max(2000).optional(),
  attestedById: attestedByIdSchema,
  attestationPin: attestationPinSchema,
})

export const addPaymentBatchBodySchema = z.object({
  payments: z
    .array(
      z.object({
        method: paymentMethodSchema,
        amount: positiveMoneySchema,
        referenceNumber: z.string().min(1).max(120).optional(),
        payerId: payerDisplayId.optional(),
        notes: z.string().max(2000).optional(),
      }),
    )
    .min(2, 'At least two split-tender legs are required')
    .max(10, 'At most 10 split-tender legs'),
  attestedById: attestedByIdSchema,
  attestationPin: attestationPinSchema,
})

export const voidBodySchema = z.object({
  reason: z
    .string()
    .min(5, 'Reason must be at least 5 characters')
    .max(500, 'Maximum 500 characters'),
})

export const refundBodySchema = z.object({
  reason: z.string().min(5, 'reason must be at least 5 characters').max(500),
})

export const applyPrepaymentBodySchema = z.object({
  consumingTransactionId: txnDisplayId,
})

/**
 * 'Credit' is excluded from `newMethod` for the same reason it's excluded
 * from `paymentMethodSchema` above: internal-only, minted solely by
 * `applyPrepayment`.
 */
export const correctPaymentMethodBodySchema = z.object({
  newMethod: paymentMethodSchema,
  newReferenceNumber: z.string().min(1).max(120).optional(),
  reason: z
    .string()
    .min(5, 'Reason must be at least 5 characters')
    .max(500, 'Maximum 500 characters'),
  /**
   * Who is PERFORMING this correction, on the shared `Branch` login. Unlike
   * the other money paths, this does NOT change `payments.received_by_id`:
   * the replacement payment keeps carrying the ORIGINAL payment's receiver
   * (see `correctPaymentMethod` in db.ts). It is recorded on the audit row
   * only, naming who typed the fix.
   */
  attestedById: attestedByIdSchema,
  attestationPin: attestationPinSchema,
})

// ── Response schemas (wire truth — keep in lockstep with db.ts) ──────────────

// ── list: listTransactions row shape ────────────────────────────────────────

const transactionListRowSchema = z.object({
  /** display_id (TXN_…). */
  id: z.string(),
  patientName: z.string(),
  status: z.enum(['Draft', 'Pending', 'Paid', 'Voided', 'Refunded']),
  /** numeric(12,2) → string. */
  grossAmount: z.string(),
  discountAmount: z.string(),
  netAmount: z.string(),
  amountPaid: z.string(),
  amountOutstanding: z.string(),
  vatRate: z.string(),
  /** First payment method; null when no payments yet. */
  paymentMethod: z.string().nullable(),
  itemCount: z.number(),
  transactedAt: z.string(),
  /** null when no cashier (e.g. back-office). */
  cashierName: z.string().nullable(),
})

const transactionStatsSchema = z.object({
  todayCount: z.number(),
  /** numeric(12,2) → string. */
  todayRevenue: z.string(),
  pendingCount: z.number(),
  /** 7-day revenue series, oldest → newest. */
  trend7d: z.object({ revenue: z.array(z.string()) }),
  /** Signed numeric string: today minus yesterday (e.g. "-120.00"). */
  revenueVsPrevDay: z.string(),
})

const transactionDayStatsSchema = z.object({
  count: z.number(),
  totalRevenue: z.string(),
  totalUnsettled: z.string(),
  byMethod: z.array(
    z.object({
      method: z.string(),
      count: z.number(),
      total: z.string(),
    }),
  ),
  byStatus: z.array(
    z.object({
      status: z.string(),
      count: z.number(),
    }),
  ),
})

/**
 * The list response envelope. dayStats is null unless ?date=YYYY-MM-DD.
 */
const listResponseSchema = z.object({
  data: z.array(transactionListRowSchema),
  stats: transactionStatsSchema,
  dayStats: transactionDayStatsSchema.nullable(),
})

// ── create: POST /api/transactions → 201 ────────────────────────────────────

const createResponseSchema = z.object({
  /** transaction display_id (TXN_…). */
  id: z.string(),
  status: z.enum(['Draft', 'Pending', 'Paid']),
  receiptNo: z.string().nullable(),
  /** First payment display_id (PMT_…) or null. */
  paymentId: z.string().nullable(),
})

// ── detail: GET /api/transactions/:id ───────────────────────────────────────

const paymentRowSchema = z.object({
  /** display_id (PMT_…). */
  id: z.string(),
  method: z.string(),
  /** numeric(12,2) → string. */
  amount: z.string(),
  /** payer display_id (PYR_…) or null. */
  payerId: z.string().nullable(),
  referenceNumber: z.string().nullable(),
  /** User display_id (USR_…) of the accountable money receiver. */
  receivedById: z.string().nullable(),
  receivedAt: z.string(),
  notes: z.string().nullable(),
  /**
   * NOTE: bigint FK leaking through — captured as-is.
   */
  cashDrawerSessionId: z.number().nullable(),
  /** numeric(12,2) → string; null when not charged. */
  externalProcessorFee: z.string().nullable(),
  reconciliationStatus: z.string(),
  clearedAt: z.string().nullable(),
  idempotencyKey: z.string().nullable(),
  /**
   * Set when this payment was superseded by a method correction. The row is
   * still returned so the correction stays auditable on the receipt, so the
   * UI must render it as superseded: two live-looking rows for one amount
   * read as a double charge.
   */
  voidedAt: z.string().nullable(),
  voidReason: z.string().nullable(),
  payer: z
    .object({
      id: z.string(),
      name: z.string().nullable(),
      payerType: z.string().nullable(),
    })
    .nullable(),
})

const transactionItemRowSchema = z.object({
  /** display_id (TXI_…). */
  id: z.string(),
  /** service_catalog text PK (e.g. ARVPEP_IM). */
  serviceId: z.string(),
  /** clinical_order display_id (ORD_…) or null. */
  clinicalOrderId: z.string().nullable(),
  quantity: z.string(),
  /** numeric(12,2) → string. */
  unitPrice: z.string(),
  discountAmount: z.string(),
  vatAmount: z.string(),
  subtotal: z.string(),
  isVatExempt: z.boolean(),
  isPrepaid: z.boolean(),
  /** prepaid transaction display_id (TXN_…) or null. */
  prepaidTransactionId: z.string().nullable(),
  /**
   * NOTE: bigint FK leaking through — captured as-is.
   */
  /** inventory_lots.display_id of the brand dispensed for this line. */
  lotId: z.string().nullable(),
  lot: z
    .object({ id: z.string(), batchNumber: z.string(), productName: z.string().nullable() })
    .nullable(),
  /** numeric(12,4) → string; null when not snapshotted. */
  unitCostSnapshot: z.string().nullable(),
  /**
   * NOTE: bigint FK leaking through — captured as-is.
   */
  servicePriceId: z.number().nullable(),
  /**
   * NOTE: bigint FK leaking through — captured as-is.
   */
  performedById: z.number().nullable(),
  service: z
    .object({
      id: z.string(),
      name: z.string().nullable(),
      code: z.string().nullable(),
      serviceType: z.string().nullable(),
    })
    .nullable(),
  /**
   * The patient this line is billed for: the per-line patient when set, else
   * the header/primary patient (COALESCE). display_id (PAT_…).
   */
  patient: z
    .object({
      id: z.string(),
      firstName: z.string(),
      lastName: z.string(),
    })
    .nullable(),
})

const detailResponseSchema = z.object({
  /** display_id (TXN_…). */
  id: z.string(),
  tenantId: z.string(),
  /**
   * NOTE: bigint FK leaking through — captured as-is.
   */
  branchId: z.number().nullable(),
  /** patient display_id (PAT_…). */
  patientId: z.string(),
  /** encounter display_id (ENC_…) or null. */
  encounterId: z.string().nullable(),
  /** cashier display_id (USR_…) or null. */
  cashierId: z.string().nullable(),
  /** payer display_id (PYR_…) or null. */
  payerId: z.string().nullable(),
  status: z.enum(['Draft', 'Pending', 'Paid', 'Voided', 'Refunded']),
  receiptNo: z.string().nullable(),
  /** Per-branch transaction sequence ("Branch Txn #" on the receipt). */
  branchSeq: z.number().nullable(),
  discountIdType: z.string().nullable(),
  discountIdNumber: z.string().nullable(),
  /** numeric(12,2) → string. */
  grossAmount: z.string(),
  discountAmount: z.string(),
  vatAmount: z.string(),
  netAmount: z.string(),
  amountPaid: z.string(),
  amountOutstanding: z.string(),
  vatRate: z.string(),
  /**
   * NOTE: bigint FK leaking through — captured as-is.
   */
  payerContractId: z.number().nullable(),
  /**
   * NOTE: bigint FK leaking through — captured as-is.
   */
  cashDrawerSessionId: z.number().nullable(),
  orSeriesId: z.string().nullable(),
  /** applied-to transaction display_id (TXN_…) or null. */
  appliedToTransactionId: z.string().nullable(),
  /**
   * NOTE: bigint FK leaking through — captured as-is.
   */
  replacementTransactionId: z.number().nullable(),
  /**
   * NOTE: bigint FK leaking through — captured as-is.
   */
  refundedFromTransactionId: z.number().nullable(),
  idempotencyKey: z.string().nullable(),
  isPrepayment: z.boolean(),
  prepaymentAppliedAt: z.string().nullable(),
  voidedAt: z.string().nullable(),
  /**
   * NOTE: bigint FK leaking through — captured as-is.
   */
  voidedById: z.number().nullable(),
  voidReason: z.string().nullable(),
  transactedAt: z.string(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /**
   * NOTE: bigint FK leaking through — captured as-is.
   */
  createdById: z.number().nullable(),
  createdBy: z
    .object({
      /**
       * NOTE: bigint PK leaking through — captured as-is.
       */
      id: z.number(),
      displayId: z.string(),
      // Non-null when the ref object exists — users.first/last_name are NOT NULL
      // and db.ts only builds createdBy when the join row is present.
      firstName: z.string(),
      lastName: z.string(),
    })
    .nullable(),
  patient: z.object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
  }),
  /**
   * Per-patient sub-headers for multi-patient (family / group) transactions.
   * Always ≥1 entry (the primary) for transactions created after the
   * multi-patient cutover; legacy/seed transactions with no sub-header rows
   * fall back to a single synthesized entry from the header patient + header
   * discount. `subtotal` is that patient's net contribution (numeric → string).
   */
  patients: z.array(
    z.object({
      patient: z.object({
        id: z.string(),
        firstName: z.string(),
        lastName: z.string(),
      }),
      /** encounter display_id (ENC_…) or null. */
      encounterId: z.string().nullable(),
      discountIdType: z.string().nullable(),
      discountIdNumber: z.string().nullable(),
      /** This patient's net contribution to the transaction (numeric → string). */
      subtotal: z.string(),
    }),
  ),
  cashier: z
    .object({
      id: z.string(),
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
    })
    .nullable(),
  payer: z
    .object({
      id: z.string(),
      name: z.string().nullable(),
      payerType: z.string().nullable(),
    })
    .nullable(),
  /**
   * Branch of sale — drives the receipt header (name/address/contact vary per
   * branch). `receipt.mode` is `acknowledgement` in Phase 1 (manual ORs issued
   * on request); populating `branches.settings.receipt.bir` flips a branch to
   * `bir_official` without a code change. Null only for legacy branch-less rows.
   */
  branch: z
    .object({
      code: z.string(),
      name: z.string(),
      address: z.string().nullable(),
      city: z.string().nullable(),
      province: z.string().nullable(),
      contactNumber: z.string().nullable(),
      email: z.string().nullable(),
      receipt: z.object({
        mode: z.enum(['acknowledgement', 'bir_official']),
        bir: z
          .object({
            tin: z.string(),
            registeredName: z.string(),
            permitNo: z.string(),
            accreditationNo: z.string().nullable(),
            orSeries: z.string().nullable(),
          })
          .nullable(),
      }),
    })
    .nullable(),
  items: z.array(transactionItemRowSchema),
  payments: z.array(paymentRowSchema),
})

// ── addPayment: POST /api/transactions/:id/payments → 201 ───────────────────

const addPaymentResponseSchema = z.object({
  /** payment display_id (PMT_…). */
  id: z.string(),
  status: z.enum(['Draft', 'Pending', 'Paid']),
  receiptNo: z.string().nullable(),
})

const addPaymentBatchResponseSchema = addPaymentResponseSchema.extend({
  payments: z.array(
    z.object({
      id: z.string(),
      amount: z.string(),
      status: z.enum(['Draft', 'Pending', 'Paid']),
    }),
  ),
})

// ── void: POST /api/transactions/:id/void → 200 ─────────────────────────────

const voidResponseSchema = z.object({
  /** display_id (TXN_…). */
  displayId: z.string(),
  status: z.enum(['Draft', 'Pending', 'Paid', 'Voided', 'Refunded']),
  /**
   * ORD_… display_ids of clinical_orders this void cancelled (bundle
   * fan-out unwind, see fanOutVoid.ts). Empty for a plain, non-bundle
   * transaction.
   */
  cancelledClinicalOrderIds: z.array(z.string()),
  /** LBO_… display_ids of lab_orders this void cancelled, same unwind. */
  cancelledLabOrderIds: z.array(z.string()),
})

// ── refund: POST /api/transactions/:id/refund → 200 ─────────────────────────

const refundResponseSchema = z.object({
  transaction: z
    .object({
      /** display_id (TXN_…). */
      displayId: z.string(),
      status: z.enum(['Draft', 'Pending', 'Paid', 'Voided', 'Refunded']),
    })
    .nullable(),
  /** numeric(12,2) → string. */
  refundedAmount: z.string(),
})

// ── correctPaymentMethod: POST /api/transactions/:id/payments/:paymentId/correct-method → 200 ──

const correctPaymentMethodResponseSchema = z.object({
  /** Transaction display_id (TXN_…). */
  transactionDisplayId: z.string(),
  /** display_id of the original payment, now voided (PMT_…). */
  voidedPaymentId: z.string(),
  /** display_id of the newly-inserted replacement payment (PMT_…). */
  replacementPaymentId: z.string(),
  status: z.enum(['Draft', 'Pending', 'Paid']),
  receiptNo: z.string().nullable(),
})

// ── applyPrepayment: POST /api/transactions/:id/apply-prepayment → 200 ───────

const applyPrepaymentResponseSchema = z.object({
  applied: z.literal(true),
  /** Credit payment display_id (PMT_…). */
  paymentId: z.string(),
  /** Amount drawn (numeric string). */
  amount: z.string(),
  /** Consuming transaction status after the draw. */
  status: z.enum(['Draft', 'Pending', 'Paid']),
  /** Remaining credit after this draw (numeric string). */
  remainingCredit: z.string(),
})

// ── Manifest ─────────────────────────────────────────────────────────────────

export const transactionsContract = defineContract('transactions', {
  list: {
    method: 'GET',
    path: '/api/transactions',
    query: z.object({
      q: z.string().optional(),
      status: z.string().optional(),
      patient: z.string().optional(),
      encounter: z.string().optional(),
      date: z.string().optional(),
      limit: z.number().optional(),
      sort: z.string().optional(),
      order: z.string().optional(),
    }),
    response: listResponseSchema,
  },
  create: {
    method: 'POST',
    path: '/api/transactions',
    body: createTransactionSchema,
    response: createResponseSchema,
  },
  detail: {
    method: 'GET',
    path: '/api/transactions/:id',
    params: { id: txnDisplayId },
    response: detailResponseSchema,
  },
  addPayment: {
    method: 'POST',
    path: '/api/transactions/:id/payments',
    params: { id: txnDisplayId },
    body: addPaymentBodySchema,
    response: addPaymentResponseSchema,
  },
  addPaymentBatch: {
    method: 'POST',
    path: '/api/transactions/:id/payments/batch',
    params: { id: txnDisplayId },
    body: addPaymentBatchBodySchema,
    response: addPaymentBatchResponseSchema,
  },
  void: {
    method: 'POST',
    path: '/api/transactions/:id/void',
    params: { id: txnDisplayId },
    body: voidBodySchema,
    response: voidResponseSchema,
  },
  refund: {
    method: 'POST',
    path: '/api/transactions/:id/refund',
    params: { id: txnDisplayId },
    body: refundBodySchema,
    response: refundResponseSchema,
  },
  correctPaymentMethod: {
    method: 'POST',
    path: '/api/transactions/:id/payments/:paymentId/correct-method',
    params: { id: txnDisplayId, paymentId: paymentDisplayId },
    body: correctPaymentMethodBodySchema,
    response: correctPaymentMethodResponseSchema,
  },
  applyPrepayment: {
    method: 'POST',
    path: '/api/transactions/:id/apply-prepayment',
    params: { id: txnDisplayId },
    body: applyPrepaymentBodySchema,
    response: applyPrepaymentResponseSchema,
  },
})

// ── Inferred response types (used by routes.ts `satisfies` assertions) ───────

export type TransactionsListResponse = z.infer<typeof listResponseSchema>
export type TransactionsCreateResponse = z.infer<typeof createResponseSchema>
export type TransactionsDetailResponse = z.infer<typeof detailResponseSchema>
export type TransactionsAddPaymentResponse = z.infer<typeof addPaymentResponseSchema>
export type TransactionsAddPaymentBatchResponse = z.infer<typeof addPaymentBatchResponseSchema>
export type TransactionsVoidResponse = z.infer<typeof voidResponseSchema>
export type TransactionsRefundResponse = z.infer<typeof refundResponseSchema>
export type TransactionsCorrectPaymentMethodResponse = z.infer<
  typeof correctPaymentMethodResponseSchema
>
export type TransactionsApplyPrepaymentResponse = z.infer<typeof applyPrepaymentResponseSchema>
