import type { TransactionStatus, PaymentMethod } from './api'

/** Status enum → humanized state label shown in the cashier flow. */
export function statusToFsmLabel(status: TransactionStatus): string {
  switch (status) {
    case 'Draft':
      return 'Draft'
    case 'Pending':
      return 'Awaiting payment'
    case 'Paid':
      return 'Paid'
    case 'Voided':
      return 'Voided'
    case 'Refunded':
      return 'Refunded'
  }
}

/** TenderRail tab key → backend PaymentMethod. The rail exposes 6 tabs;
 *  Split is currently UI-only (resolved client-side into multiple payments
 *  before submit). For now we map Split → Cash so a single primary payment
 *  is still recorded; multi-method submission lands with the cashier-shift
 *  reconciliation batch. */
export function payMethodToBackend(
  method: 'cash' | 'card' | 'gcash' | 'split' | 'maya' | 'hmo',
): PaymentMethod {
  switch (method) {
    case 'cash':
    case 'split':
      return 'Cash'
    case 'card':
      return 'Card'
    case 'gcash':
      return 'GCash'
    case 'maya':
      return 'Maya'
    case 'hmo':
      return 'HMO'
  }
}
