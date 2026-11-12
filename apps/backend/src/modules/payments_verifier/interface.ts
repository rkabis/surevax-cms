/**
 * PaymentVerifier — pluggable adapter for external payment reconciliation.
 *
 * Today: only the no-op stub exists. When PayMongo is wired, swap
 * `getVerifier()` in `index.ts` to return a real adapter.
 */

export type PaymentMethod =
  | 'Cash'
  | 'GCash'
  | 'Maya'
  | 'BankTransfer'
  | 'Card'
  | 'PayMongo'
  | 'HMO'
  | 'Corporate'
  | 'Other'
  | 'Credit'

export type ReconciliationStatus =
  | 'Cleared'
  | 'AwaitingReconciliation'
  | 'Disputed'
  | 'Failed'
  | 'Pending'

export interface PaymentVerifier {
  /**
   * Attempt to verify a payment with an external processor.
   * Returns null when no external verification is wired (stub).
   */
  verifyPayment(args: {
    method: PaymentMethod
    referenceNumber: string
    amount: string // numeric column serializes as string
    payerId: number | null
  }): Promise<{ status: ReconciliationStatus; externalProcessorFee?: string | null } | null>

  /**
   * Validate that an inbound webhook payload was signed by the processor.
   * Stub returns true (accept everything in dev).
   */
  verifyWebhookSignature(rawBody: string, signature: string | null): boolean
}

/**
 * Determine the initial reconciliation status to record at payment insertion.
 *
 * State machine:
 *   Cash / Credit     → 'Cleared'   (no external verification needed —
 *                                     Credit is an internal draw against a
 *                                     patient's prepaid balance)
 *   All other methods → 'AwaitingReconciliation' (queued for external check)
 */
export function initialReconciliationStatus(method: PaymentMethod): ReconciliationStatus {
  return method === 'Cash' || method === 'Credit' ? 'Cleared' : 'AwaitingReconciliation'
}
