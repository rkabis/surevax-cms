// GENERATED FILE — do not edit.
// Source: apps/backend/src/modules — contract 'transactions'.
// Regenerate with `pnpm gen:contracts`; CI fails on drift.

export type TransactionsListQuery = {
  q?: string
  status?: string
  patient?: string
  encounter?: string
  date?: string
  limit?: number
  sort?: string
  order?: string
}

export type TransactionsListResponse = {
  data: {
    id: string
    patientName: string
    status: 'Draft' | 'Pending' | 'Paid' | 'Voided' | 'Refunded'
    grossAmount: string
    discountAmount: string
    netAmount: string
    amountPaid: string
    amountOutstanding: string
    vatRate: string
    paymentMethod: string | null
    itemCount: number
    transactedAt: string
    cashierName: string | null
  }[]
  stats: {
    todayCount: number
    todayRevenue: string
    pendingCount: number
    trend7d: { revenue: string[] }
    revenueVsPrevDay: string
  }
  dayStats: {
    count: number
    totalRevenue: string
    totalUnsettled: string
    byMethod: { method: string; count: number; total: string }[]
    byStatus: { status: string; count: number }[]
  } | null
}

export type TransactionsCreateBody = {
  patientId: string
  encounterId?: string
  payerId?: string
  isPrepayment?: boolean
  depositAmount?: string | number
  discount?: { idType: 'OSCA' | 'PWD' | 'Other' | 'NA'; idNumber?: string } | null
  items?: {
    serviceId: string
    patientId?: string
    clinicalOrderId?: string
    quantity: number
    isVatExempt?: boolean
    isPrepaid?: boolean
    prepaidTransactionId?: string
  }[]
  patients?: {
    patientId: string
    encounterId?: string
    discount?: { idType: 'OSCA' | 'PWD' | 'Other' | 'NA'; idNumber?: string } | null
  }[]
  payment?: {
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
    amount: string | number
    referenceNumber?: string
    payerId?: string
    notes?: string
  }
  payments?: {
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
    amount: string | number
    referenceNumber?: string
    payerId?: string
    notes?: string
  }[]
  attestedById?: string
  attestationPin?: string
}

export type TransactionsCreateResponse = {
  id: string
  status: 'Draft' | 'Pending' | 'Paid'
  receiptNo: string | null
  paymentId: string | null
}

export type TransactionsDetailIdParam = string

export type TransactionsDetailResponse = {
  id: string
  tenantId: string
  branchId: number | null
  patientId: string
  encounterId: string | null
  cashierId: string | null
  payerId: string | null
  status: 'Draft' | 'Pending' | 'Paid' | 'Voided' | 'Refunded'
  receiptNo: string | null
  branchSeq: number | null
  discountIdType: string | null
  discountIdNumber: string | null
  grossAmount: string
  discountAmount: string
  vatAmount: string
  netAmount: string
  amountPaid: string
  amountOutstanding: string
  vatRate: string
  payerContractId: number | null
  cashDrawerSessionId: number | null
  orSeriesId: string | null
  appliedToTransactionId: string | null
  replacementTransactionId: number | null
  refundedFromTransactionId: number | null
  idempotencyKey: string | null
  isPrepayment: boolean
  prepaymentAppliedAt: string | null
  voidedAt: string | null
  voidedById: number | null
  voidReason: string | null
  transactedAt: string
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  createdById: number | null
  createdBy: { id: number; displayId: string; firstName: string; lastName: string } | null
  patient: { id: string; firstName: string; lastName: string }
  patients: {
    patient: { id: string; firstName: string; lastName: string }
    encounterId: string | null
    discountIdType: string | null
    discountIdNumber: string | null
    subtotal: string
  }[]
  cashier: { id: string; firstName: string | null; lastName: string | null } | null
  payer: { id: string; name: string | null; payerType: string | null } | null
  branch: {
    code: string
    name: string
    address: string | null
    city: string | null
    province: string | null
    contactNumber: string | null
    email: string | null
    receipt: {
      mode: 'acknowledgement' | 'bir_official'
      bir: {
        tin: string
        registeredName: string
        permitNo: string
        accreditationNo: string | null
        orSeries: string | null
      } | null
    }
  } | null
  items: {
    id: string
    serviceId: string
    clinicalOrderId: string | null
    quantity: string
    unitPrice: string
    discountAmount: string
    vatAmount: string
    subtotal: string
    isVatExempt: boolean
    isPrepaid: boolean
    prepaidTransactionId: string | null
    lotId: string | null
    lot: { id: string; batchNumber: string; productName: string | null } | null
    unitCostSnapshot: string | null
    servicePriceId: number | null
    performedById: number | null
    service: {
      id: string
      name: string | null
      code: string | null
      serviceType: string | null
    } | null
    patient: { id: string; firstName: string; lastName: string } | null
  }[]
  payments: {
    id: string
    method: string
    amount: string
    payerId: string | null
    referenceNumber: string | null
    receivedById: string | null
    receivedAt: string
    notes: string | null
    cashDrawerSessionId: number | null
    externalProcessorFee: string | null
    reconciliationStatus: string
    clearedAt: string | null
    idempotencyKey: string | null
    voidedAt: string | null
    voidReason: string | null
    payer: { id: string; name: string | null; payerType: string | null } | null
  }[]
}

export type TransactionsAddPaymentIdParam = string

export type TransactionsAddPaymentBody = {
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
  amount: string | number
  referenceNumber?: string
  payerId?: string
  notes?: string
  attestedById?: string
  attestationPin?: string
}

export type TransactionsAddPaymentResponse = {
  id: string
  status: 'Draft' | 'Pending' | 'Paid'
  receiptNo: string | null
}

export type TransactionsAddPaymentBatchIdParam = string

export type TransactionsAddPaymentBatchBody = {
  payments: {
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
    amount: string | number
    referenceNumber?: string
    payerId?: string
    notes?: string
  }[]
  attestedById?: string
  attestationPin?: string
}

export type TransactionsAddPaymentBatchResponse = {
  id: string
  status: 'Draft' | 'Pending' | 'Paid'
  receiptNo: string | null
  payments: { id: string; amount: string; status: 'Draft' | 'Pending' | 'Paid' }[]
}

export type TransactionsVoidIdParam = string

export type TransactionsVoidBody = { reason: string }

export type TransactionsVoidResponse = {
  displayId: string
  status: 'Draft' | 'Pending' | 'Paid' | 'Voided' | 'Refunded'
  cancelledClinicalOrderIds: string[]
  cancelledLabOrderIds: string[]
}

export type TransactionsRefundIdParam = string

export type TransactionsRefundBody = { reason: string }

export type TransactionsRefundResponse = {
  transaction: {
    displayId: string
    status: 'Draft' | 'Pending' | 'Paid' | 'Voided' | 'Refunded'
  } | null
  refundedAmount: string
}

export type TransactionsCorrectPaymentMethodIdParam = string

export type TransactionsCorrectPaymentMethodPaymentIdParam = string

export type TransactionsCorrectPaymentMethodBody = {
  newMethod:
    | 'Cash'
    | 'GCash'
    | 'Maya'
    | 'BankTransfer'
    | 'Card'
    | 'PayMongo'
    | 'HMO'
    | 'Corporate'
    | 'Other'
  newReferenceNumber?: string
  reason: string
  attestedById?: string
  attestationPin?: string
}

export type TransactionsCorrectPaymentMethodResponse = {
  transactionDisplayId: string
  voidedPaymentId: string
  replacementPaymentId: string
  status: 'Draft' | 'Pending' | 'Paid'
  receiptNo: string | null
}

export type TransactionsApplyPrepaymentIdParam = string

export type TransactionsApplyPrepaymentBody = { consumingTransactionId: string }

export type TransactionsApplyPrepaymentResponse = {
  applied: true
  paymentId: string
  amount: string
  status: 'Draft' | 'Pending' | 'Paid'
  remainingCredit: string
}

export const transactionsEndpoints = {
  list: { method: 'GET', path: '/api/transactions' },
  create: { method: 'POST', path: '/api/transactions' },
  detail: { method: 'GET', path: '/api/transactions/:id' },
  addPayment: { method: 'POST', path: '/api/transactions/:id/payments' },
  addPaymentBatch: { method: 'POST', path: '/api/transactions/:id/payments/batch' },
  void: { method: 'POST', path: '/api/transactions/:id/void' },
  refund: { method: 'POST', path: '/api/transactions/:id/refund' },
  correctPaymentMethod: {
    method: 'POST',
    path: '/api/transactions/:id/payments/:paymentId/correct-method',
  },
  applyPrepayment: { method: 'POST', path: '/api/transactions/:id/apply-prepayment' },
} as const
