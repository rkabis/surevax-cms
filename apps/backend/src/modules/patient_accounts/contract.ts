/**
 * patient-accounts API contract: schemas + endpoint manifest.
 *
 * A patient's financial position: what they owe across every open bill, what
 * credit they hold, the chronological ledger behind both, and the clinic-wide
 * roll-up of who owes what.
 *
 * Request schemas are the runtime validators used by routes.ts; response
 * schemas describe the ACTUAL res.json payloads and are enforced against the
 * implementation via `satisfies` at each res.json callsite.
 *
 * Side-effect-free imports only (zod + pure shared utils): the generator
 * imports this file without a configured environment.
 */
import { z } from 'zod'
import { prefixedDisplayIdSchema } from '../../shared/utils/displayId.js'
import { defineContract } from '../../contracts/defineContract.js'
// Reused rather than redefined: same package, zod-only, no side effects.
import { paymentMethodSchema, positiveMoneySchema } from '../transactions/contract.js'

// ── Request schemas (runtime validators for routes.ts) ──────────────────────

export const patDisplayId = prefixedDisplayIdSchema('PAT')
export const txnDisplayId = prefixedDisplayIdSchema('TXN')

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

export const balanceQuery = z.object({ asOf: isoDate.optional() })

export const ledgerQuery = z.object({
  asOf: isoDate.optional(),
  /** Include settled bills in the ledger rows. Defaults to true. */
  includeSettled: z.enum(['true', 'false']).optional(),
})

export const receivablesQuery = z.object({
  q: z.string().max(120).optional(),
  bucket: z.enum(['all', 'd0_30', 'd31_60', 'd61_90', 'd90plus']).optional(),
  /** 'branch' (default) or tenant-wide, which is admin-gated in the handler. */
  scope: z.enum(['branch', 'tenant']).optional(),
  sort: z.enum(['age', 'amount', 'name']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  asOf: isoDate.optional(),
})

const payOnAccountLeg = z.object({
  /** 'Credit' is deliberately absent: credit is spent via apply-credit. */
  method: paymentMethodSchema,
  amount: positiveMoneySchema,
  referenceNumber: z.string().min(1).max(120).optional(),
  payerId: prefixedDisplayIdSchema('PYR').optional(),
  notes: z.string().max(2000).optional(),
})

const payOnAccountCommon = z.object({
  /**
   * Tender above the total outstanding: omitted/false rejects with 422
   * OVERPAYMENT_NOT_ALLOWED and returns the computed excess so the client can
   * confirm; true banks the excess as an item-less patient-credit deposit.
   * The per-bill payment route keeps MONEY-5's hard reject either way.
   */
  allowCredit: z.boolean().optional(),
  /**
   * Who physically took the payment, recorded as `payments.received_by_id` on
   * every allocated leg. Omit to attribute it to the caller, which is only
   * allowed when the caller is a real person logged in as themselves. On the
   * shared `Branch` kiosk both fields are REQUIRED: see
   * `shared/utils/clinicianAttestation.ts`.
   */
  attestedById: prefixedDisplayIdSchema('USR').optional(),
  /** The named staff member's 4-digit kiosk PIN, the same one clock-in uses. */
  attestationPin: z
    .string()
    .regex(/^\d{4}$/, 'PIN must be 4 digits')
    .optional(),
})

export const payOnAccountBody = z.union([
  payOnAccountLeg.merge(payOnAccountCommon),
  z
    .object({
      payments: z
        .array(payOnAccountLeg)
        .min(2, 'At least two split-tender legs are required')
        .max(10, 'At most 10 split-tender legs'),
    })
    .merge(payOnAccountCommon),
])

export const applyCreditBody = z.object({
  /** Scope the draw to one bill. Omit to work the whole balance. */
  transactionId: txnDisplayId.optional(),
  /** Cap the draw. Omit to apply min(available credit, outstanding). */
  amount: positiveMoneySchema.optional(),
})

// ── Response schemas (wire truth) ───────────────────────────────────────────

const patientRefSchema = z.object({
  /** display_id (PAT_…), named displayId to match the frontend PatientRef. */
  displayId: z.string(),
  mrn: z.string().nullable(),
  firstName: z.string(),
  lastName: z.string(),
})

const openBillSchema = z.object({
  id: z.string(),
  transactedAt: z.string(),
  netAmount: z.string(),
  amountPaid: z.string(),
  amountOutstanding: z.string(),
  status: z.enum(['Draft', 'Pending', 'Paid', 'Voided', 'Refunded']),
  itemCount: z.number(),
  ageDays: z.number(),
  /** True when the bill covers more than one patient (family/group bill). */
  isMultiPatient: z.boolean(),
})

const depositSchema = z.object({
  id: z.string(),
  depositAmount: z.string(),
  funded: z.string(),
  consumed: z.string(),
  remaining: z.string(),
  status: z.string(),
  createdAt: z.string(),
})

const agingSchema = z.object({
  d0_30: z.string(),
  d31_60: z.string(),
  d61_90: z.string(),
  d90plus: z.string(),
})

/**
 * NOTE on attribution: `grossOutstanding` sums the HEADER balance of bills
 * where this patient is the bill-to party. On a family/group bill the whole
 * balance is attributed to the primary patient, because net_amount /
 * amount_paid / amount_outstanding exist only on the header and
 * transaction_patients carries no money columns. Secondary patients contribute
 * nothing to their own balance and see the bill under the ledger's
 * `relatedBills` instead. See .claude/rules/gotchas.md, multi-patient section.
 */
const balanceResponseSchema = z.object({
  patient: patientRefSchema,
  /** Calendar date the figures were computed for (?asOf, default today). */
  asOf: z.string(),
  /** Sum of amount_outstanding across open bills. */
  grossOutstanding: z.string(),
  /** Same derivation as GET /api/patients/:id/credit → available. */
  availableCredit: z.string(),
  /** GREATEST(gross - credit, 0): what the cashier should actually ask for. */
  netOutstanding: z.string(),
  /** GREATEST(credit - gross, 0): non-zero means the patient is in credit. */
  creditOnAccount: z.string(),
  openBillCount: z.number(),
  oldestOpenBillDate: z.string().nullable(),
  oldestOpenBillAgeDays: z.number().nullable(),
  lastPaymentAt: z.string().nullable(),
  aging: agingSchema,
  openBills: z.array(openBillSchema),
  deposits: z.array(depositSchema),
})

const ledgerRowSchema = z.object({
  /** `${kind}:${refId}`, a stable client key. */
  key: z.string(),
  kind: z.enum(['charge', 'payment', 'credit_draw', 'deposit']),
  occurredAt: z.string(),
  transactionId: z.string(),
  paymentId: z.string().nullable(),
  receiptNo: z.string().nullable(),
  branchSeq: z.number().nullable(),
  status: z.enum(['Draft', 'Pending', 'Paid', 'Voided', 'Refunded']),
  description: z.string(),
  method: z.string().nullable(),
  /** '0.00' on non-charge rows. */
  debit: z.string(),
  /** '0.00' on charge rows. */
  credit: z.string(),
  /** Running charges minus payments. */
  balanceDue: z.string(),
  /** Running deposits minus credit draws. */
  creditBalance: z.string(),
  /**
   * False for Voided/Refunded (transaction status) rows AND for rows whose
   * own payment was voided-and-replaced (see `paymentVoidedAt`). Either way
   * the row is shown but moves no running total.
   */
  affectsBalance: z.boolean(),
  isMultiPatient: z.boolean(),
  /** The deposit behind a credit_draw row. */
  fundedByTransactionId: z.string().nullable(),
  /**
   * Set when the underlying payment was voided (a corrected, replaced row),
   * independent of the parent transaction's own status. Lets the UI render a
   * distinct "Voided" tag on the payment/credit_draw/deposit row itself.
   */
  paymentVoidedAt: z.string().nullable(),
})

const ledgerResponseSchema = z.object({
  patient: patientRefSchema.extend({
    contactNumber: z.string().nullable(),
    address: z.string().nullable(),
    dateOfBirth: z.string().nullable(),
  }),
  /** Branch of the patient's most recent bill, for the statement letterhead. */
  branch: z
    .object({
      code: z.string(),
      name: z.string(),
      address: z.string().nullable(),
      city: z.string().nullable(),
      province: z.string().nullable(),
      contactNumber: z.string().nullable(),
    })
    .nullable(),
  asOf: z.string(),
  generatedAt: z.string(),
  rows: z.array(ledgerRowSchema),
  /** MUST equal balance.grossOutstanding when asOf is today. */
  closingBalanceDue: z.string(),
  /** MUST equal balance.availableCredit when asOf is today. */
  closingCreditBalance: z.string(),
  closingNetDue: z.string(),
  totalCharges: z.string(),
  totalPayments: z.string(),
  totalCreditDraws: z.string(),
  totalDeposits: z.string(),
  aging: agingSchema,
  /**
   * Bills this patient is a member of but is NOT billed for. Informational:
   * excluded from every running total, so a guardian reading a child's
   * statement still sees the dose that was given.
   */
  relatedBills: z.array(
    z.object({
      transactionId: z.string(),
      transactedAt: z.string(),
      billedToPatient: z.object({
        displayId: z.string(),
        firstName: z.string(),
        lastName: z.string(),
      }),
      patientSubtotal: z.string(),
      status: z.enum(['Draft', 'Pending', 'Paid', 'Voided', 'Refunded']),
    }),
  ),
})

const receivableRowSchema = z.object({
  patient: patientRefSchema.extend({ contactNumber: z.string().nullable() }),
  openBillCount: z.number(),
  oldestOpenBillDate: z.string(),
  oldestOpenBillAgeDays: z.number(),
  /**
   * Bucket of the OLDEST open bill: drives row severity and sort. It does NOT
   * partition grossOutstanding; `aging` does that.
   */
  bucket: z.enum(['d0_30', 'd31_60', 'd61_90', 'd90plus']),
  grossOutstanding: z.string(),
  availableCredit: z.string(),
  netOutstanding: z.string(),
  /** Per-bill aging. The four buckets sum to grossOutstanding exactly. */
  aging: agingSchema,
  lastPaymentAt: z.string().nullable(),
  /** Branch of the oldest open bill. LEFT joined, so nullable. */
  branchCode: z.string().nullable(),
})

/**
 * Envelope rather than a bare array because a totals row travels with the rows,
 * same justification as /api/inventory. Recorded as an accepted exception in
 * .claude/rules/gotchas.md "List response is a bare array".
 */
const receivablesResponseSchema = z.object({
  data: z.array(receivableRowSchema),
  /**
   * Computed over the UNFILTERED set. The aging tab filters the table, not these
   * figures, so clicking "90+" cannot silently redefine "Total outstanding" to
   * mean "outstanding in this bucket". Same convention as the transactions list,
   * whose stats sidecar ignores the status pills.
   */
  totals: z.object({
    /** Every patient owing in scope, not just the rows the tab is showing. */
    patientCount: z.number(),
    /** How many rows the current bucket filter left on the table. */
    filteredCount: z.number(),
    grossOutstanding: z.string(),
    availableCredit: z.string(),
    netOutstanding: z.string(),
    over30Count: z.number(),
    over30Total: z.string(),
    oldestAgeDays: z.number(),
    aging: agingSchema,
  }),
  asOf: z.string(),
  scope: z.enum(['branch', 'tenant']),
})

const allocationSchema = z.object({
  transactionId: z.string(),
  paymentId: z.string(),
  amount: z.string(),
  /** Bill status AFTER this leg. */
  status: z.enum(['Draft', 'Pending', 'Paid']),
  /** Minted on the leg that crosses the bill to Paid. */
  receiptNo: z.string().nullable(),
  outstandingAfter: z.string(),
})

/**
 * NOTE: a downpayment never moves revenue. Revenue is recognised on the bill
 * date (accrual), so totalRevenue is invariant to how many installments settle
 * it; only amount_paid / amount_outstanding move. Do not "fix" the revenue
 * aggregates to follow collections.
 */
const payOnAccountResponseSchema = z.object({
  patientId: z.string(),
  /** Total applied to bills. */
  appliedAmount: z.string(),
  /** Banked as patient credit ('0.00' when none). */
  creditedAmount: z.string(),
  allocations: z.array(allocationSchema),
  /** The overage deposit, or null. */
  creditTransactionId: z.string().nullable(),
  balanceAfter: z.string(),
  availableCreditAfter: z.string(),
  /**
   * True when this call replayed a prior run with the same Idempotency-Key.
   * The effect is never re-applied; the body reproduces the first leg plus
   * live-recomputed totals (multi-leg replay would need a payment_batches table).
   */
  idempotentReplay: z.boolean(),
})

const applyCreditResponseSchema = z.object({
  patientId: z.string(),
  appliedAmount: z.string(),
  allocations: z.array(allocationSchema),
  balanceAfter: z.string(),
  availableCreditAfter: z.string(),
})

export const patientAccountsContract = defineContract('patient-accounts', {
  balance: {
    method: 'GET',
    path: '/api/patients/:displayId/balance',
    params: { displayId: patDisplayId },
    query: balanceQuery,
    response: balanceResponseSchema,
  },
  ledger: {
    method: 'GET',
    path: '/api/patients/:displayId/ledger',
    params: { displayId: patDisplayId },
    query: ledgerQuery,
    response: ledgerResponseSchema,
  },
  payOnAccount: {
    method: 'POST',
    path: '/api/patients/:displayId/payments',
    params: { displayId: patDisplayId },
    body: payOnAccountBody,
    response: payOnAccountResponseSchema,
  },
  applyCredit: {
    method: 'POST',
    path: '/api/patients/:displayId/apply-credit',
    params: { displayId: patDisplayId },
    body: applyCreditBody,
    response: applyCreditResponseSchema,
  },
  receivables: {
    method: 'GET',
    path: '/api/accounts-receivable',
    query: receivablesQuery,
    response: receivablesResponseSchema,
  },
})

export type PatientAccountsBalanceResponse = z.output<typeof balanceResponseSchema>
export type PatientAccountsLedgerResponse = z.output<typeof ledgerResponseSchema>
export type PatientAccountsPayOnAccountResponse = z.output<typeof payOnAccountResponseSchema>
export type PatientAccountsApplyCreditResponse = z.output<typeof applyCreditResponseSchema>
export type PatientAccountsReceivablesResponse = z.output<typeof receivablesResponseSchema>
