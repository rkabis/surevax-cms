// GENERATED FILE — do not edit.
// Source: apps/backend/src/modules — contract 'patient-accounts'.
// Regenerate with `pnpm gen:contracts`; CI fails on drift.

export type PatientAccountsBalanceDisplayIdParam = string

export type PatientAccountsBalanceQuery = { asOf?: string }

export type PatientAccountsBalanceResponse = {
  patient: { displayId: string; mrn: string | null; firstName: string; lastName: string }
  asOf: string
  grossOutstanding: string
  availableCredit: string
  netOutstanding: string
  creditOnAccount: string
  openBillCount: number
  oldestOpenBillDate: string | null
  oldestOpenBillAgeDays: number | null
  lastPaymentAt: string | null
  aging: { d0_30: string; d31_60: string; d61_90: string; d90plus: string }
  openBills: {
    id: string
    transactedAt: string
    netAmount: string
    amountPaid: string
    amountOutstanding: string
    status: 'Draft' | 'Pending' | 'Paid' | 'Voided' | 'Refunded'
    itemCount: number
    ageDays: number
    isMultiPatient: boolean
  }[]
  deposits: {
    id: string
    depositAmount: string
    funded: string
    consumed: string
    remaining: string
    status: string
    createdAt: string
  }[]
}

export type PatientAccountsLedgerDisplayIdParam = string

export type PatientAccountsLedgerQuery = { asOf?: string; includeSettled?: 'true' | 'false' }

export type PatientAccountsLedgerResponse = {
  patient: {
    displayId: string
    mrn: string | null
    firstName: string
    lastName: string
    contactNumber: string | null
    address: string | null
    dateOfBirth: string | null
  }
  branch: {
    code: string
    name: string
    address: string | null
    city: string | null
    province: string | null
    contactNumber: string | null
  } | null
  asOf: string
  generatedAt: string
  rows: {
    key: string
    kind: 'charge' | 'payment' | 'credit_draw' | 'deposit'
    occurredAt: string
    transactionId: string
    paymentId: string | null
    receiptNo: string | null
    branchSeq: number | null
    status: 'Draft' | 'Pending' | 'Paid' | 'Voided' | 'Refunded'
    description: string
    method: string | null
    debit: string
    credit: string
    balanceDue: string
    creditBalance: string
    affectsBalance: boolean
    isMultiPatient: boolean
    fundedByTransactionId: string | null
    paymentVoidedAt: string | null
  }[]
  closingBalanceDue: string
  closingCreditBalance: string
  closingNetDue: string
  totalCharges: string
  totalPayments: string
  totalCreditDraws: string
  totalDeposits: string
  aging: { d0_30: string; d31_60: string; d61_90: string; d90plus: string }
  relatedBills: {
    transactionId: string
    transactedAt: string
    billedToPatient: { displayId: string; firstName: string; lastName: string }
    patientSubtotal: string
    status: 'Draft' | 'Pending' | 'Paid' | 'Voided' | 'Refunded'
  }[]
}

export type PatientAccountsPayOnAccountDisplayIdParam = string

export type PatientAccountsPayOnAccountBody =
  | {
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
      allowCredit?: boolean
      attestedById?: string
      attestationPin?: string
    }
  | {
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
      allowCredit?: boolean
      attestedById?: string
      attestationPin?: string
    }

export type PatientAccountsPayOnAccountResponse = {
  patientId: string
  appliedAmount: string
  creditedAmount: string
  allocations: {
    transactionId: string
    paymentId: string
    amount: string
    status: 'Draft' | 'Pending' | 'Paid'
    receiptNo: string | null
    outstandingAfter: string
  }[]
  creditTransactionId: string | null
  balanceAfter: string
  availableCreditAfter: string
  idempotentReplay: boolean
}

export type PatientAccountsApplyCreditDisplayIdParam = string

export type PatientAccountsApplyCreditBody = { transactionId?: string; amount?: string | number }

export type PatientAccountsApplyCreditResponse = {
  patientId: string
  appliedAmount: string
  allocations: {
    transactionId: string
    paymentId: string
    amount: string
    status: 'Draft' | 'Pending' | 'Paid'
    receiptNo: string | null
    outstandingAfter: string
  }[]
  balanceAfter: string
  availableCreditAfter: string
}

export type PatientAccountsReceivablesQuery = {
  q?: string
  bucket?: 'all' | 'd0_30' | 'd31_60' | 'd61_90' | 'd90plus'
  scope?: 'branch' | 'tenant'
  sort?: 'age' | 'amount' | 'name'
  order?: 'asc' | 'desc'
  limit?: number
  asOf?: string
}

export type PatientAccountsReceivablesResponse = {
  data: {
    patient: {
      displayId: string
      mrn: string | null
      firstName: string
      lastName: string
      contactNumber: string | null
    }
    openBillCount: number
    oldestOpenBillDate: string
    oldestOpenBillAgeDays: number
    bucket: 'd0_30' | 'd31_60' | 'd61_90' | 'd90plus'
    grossOutstanding: string
    availableCredit: string
    netOutstanding: string
    aging: { d0_30: string; d31_60: string; d61_90: string; d90plus: string }
    lastPaymentAt: string | null
    branchCode: string | null
  }[]
  totals: {
    patientCount: number
    filteredCount: number
    grossOutstanding: string
    availableCredit: string
    netOutstanding: string
    over30Count: number
    over30Total: string
    oldestAgeDays: number
    aging: { d0_30: string; d31_60: string; d61_90: string; d90plus: string }
  }
  asOf: string
  scope: 'branch' | 'tenant'
}

export const patientAccountsEndpoints = {
  balance: { method: 'GET', path: '/api/patients/:displayId/balance' },
  ledger: { method: 'GET', path: '/api/patients/:displayId/ledger' },
  payOnAccount: { method: 'POST', path: '/api/patients/:displayId/payments' },
  applyCredit: { method: 'POST', path: '/api/patients/:displayId/apply-credit' },
  receivables: { method: 'GET', path: '/api/accounts-receivable' },
} as const
