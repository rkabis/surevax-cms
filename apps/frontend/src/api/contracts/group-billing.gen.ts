// GENERATED FILE — do not edit.
// Source: apps/backend/src/modules — contract 'group-billing'.
// Regenerate with `pnpm gen:contracts`; CI fails on drift.

export type GroupBillingListQuery = { status?: 'open' | 'all' }

export type GroupBillingListResponse = {
  data: {
    id: string
    transactionId: string
    payer: { id: string; name: string }
    patientCount: number
    itemCount: number
    netAmount: string
    amountPaid: string
    amountOutstanding: string
    status: 'Draft' | 'Pending' | 'Paid' | 'Voided' | 'Refunded'
    createdAt: string
    referenceNumber: string | null
  }[]
  summary: { count: number; netAmount: string; amountPaid: string; amountOutstanding: string }
}

export type GroupBillingCreateBody = {
  payerId: string
  referenceNumber?: string
  patients: {
    patientId: string
    encounterId?: string
    discount?: { idType: 'OSCA' | 'PWD' | 'Other' | 'NA'; idNumber?: string } | null
    items: {
      serviceId: string
      clinicalOrderId?: string
      quantity: number
      isVatExempt?: boolean
    }[]
  }[]
}

export type GroupBillingCreateResponse = {
  id: string
  transactionId?: string
  status?: 'Draft' | 'Pending' | 'Paid'
  idempotentReplay?: boolean
}

export type GroupBillingDetailIdParam = string

export type GroupBillingDetailResponse = {
  id: string
  transactionId: string
  payer: { id: string; name: string }
  patientCount: number
  itemCount: number
  netAmount: string
  amountPaid: string
  amountOutstanding: string
  status: 'Draft' | 'Pending' | 'Paid' | 'Voided' | 'Refunded'
  createdAt: string
  referenceNumber: string | null
  patients: {
    patient: { id: string; firstName: string; lastName: string }
    encounterId: string | null
    discount: { idType: 'OSCA' | 'PWD' | 'Other'; idNumber: string | null } | null
    items: {
      id: string
      serviceId: string
      clinicalOrderId: string | null
      quantity: string
      unitPrice: string
      discountAmount: string
      vatAmount: string
      subtotal: string
    }[]
  }[]
  payments: {
    id: string
    method: string
    amount: string
    referenceNumber: string | null
    receivedAt: string
    voidedAt: string | null
  }[]
}

export type GroupBillingAddPaymentIdParam = string

export type GroupBillingAddPaymentBody = {
  method:
    | 'Cash'
    | 'GCash'
    | 'Maya'
    | 'BankTransfer'
    | 'Card'
    | 'PayMongo'
    | 'HMO'
    | 'Corporate'
    | 'Other'
  amount: string
  referenceNumber?: string | undefined | ''
  notes?: string | undefined | ''
  attestedById?: string
  attestationPin?: string
}

export type GroupBillingAddPaymentResponse = {
  id: string
  status: 'Draft' | 'Pending' | 'Paid'
  receiptNo: string | null
}

export type GroupBillingVoidIdParam = string

export type GroupBillingVoidBody = { reason: string }

export type GroupBillingVoidResponse = { id: string; transactionId: string; status: 'Voided' }

export const groupBillingEndpoints = {
  list: { method: 'GET', path: '/api/group-bills' },
  create: { method: 'POST', path: '/api/group-bills' },
  detail: { method: 'GET', path: '/api/group-bills/:id' },
  addPayment: { method: 'POST', path: '/api/group-bills/:id/payments' },
  void: { method: 'POST', path: '/api/group-bills/:id/void' },
} as const
