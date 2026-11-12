import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '@/lib/apiFetch'
import type {
  TransactionsListResponse,
  TransactionsDetailResponse,
  TransactionsCreateBody,
  TransactionsCreateResponse,
  TransactionsAddPaymentBody,
  TransactionsAddPaymentBatchBody,
  TransactionsAddPaymentBatchResponse,
  TransactionsApplyPrepaymentResponse,
  TransactionsCorrectPaymentMethodBody,
  TransactionsCorrectPaymentMethodResponse,
} from '@/api/contracts/transactions.gen'
import type { PatientsCreditResponse } from '@/api/contracts/patients.gen'
import type {
  PatientAccountsPayOnAccountResponse,
  PatientAccountsApplyCreditResponse,
  PatientAccountsReceivablesResponse,
} from '@/api/contracts/patient-accounts.gen'

export { ApiError }

// ── Wire-type aliases over generated contract ────────────────────────────────

export type TransactionListItem = TransactionsListResponse['data'][number]
export type TransactionStats = TransactionsListResponse['stats']
export type TransactionDayStats = NonNullable<TransactionsListResponse['dayStats']>
export type ListResponse = TransactionsListResponse
export type TransactionDetail = TransactionsDetailResponse
export type TransactionItemDetail = TransactionsDetailResponse['items'][number]
export type TransactionPatientDetail = TransactionsDetailResponse['patients'][number]
export type TransactionPaymentDetail = TransactionsDetailResponse['payments'][number]
export type TransactionStatus = TransactionListItem['status']
export type CreateTransactionInput = TransactionsCreateBody
export type CreateTransactionResponse = TransactionsCreateResponse
export type PaymentMethod = TransactionsAddPaymentBody['method']
export type AddPaymentInput = TransactionsAddPaymentBody & { transactionId: string }
export type AddPaymentBatchInput = TransactionsAddPaymentBatchBody & { transactionId: string }
export type ApplyPrepaymentResponse = TransactionsApplyPrepaymentResponse
export type CorrectPaymentMethodInput = TransactionsCorrectPaymentMethodBody & {
  transactionId: string
  paymentId: string
}
export type CorrectPaymentMethodResponse = TransactionsCorrectPaymentMethodResponse

// ── Patient credit (served by the patients module, so its own contract) ──────

export type PatientCredit = PatientsCreditResponse
export type PatientCreditDeposit = PatientsCreditResponse['deposits'][number]

// ── Frontend-only input types (frontend call pattern, not wire shapes) ────────

export type VoidInput = { transactionId: string; reason: string }
export type RefundInput = { transactionId: string; reason: string }

export type ApplyPrepaymentInput = {
  prepaymentTransactionId: string
  consumingTransactionId: string
}

// ── Transactions list ────────────────────────────────────────────────────────
export function useTransactions(opts: {
  q?: string
  status?: string
  patient?: string
  encounter?: string
  /** Calendar-day filter (YYYY-MM-DD). Renders all rows for the day. */
  date?: string
  limit?: number
  enabled?: boolean
  sort?: string
  order?: 'asc' | 'desc'
}) {
  return useQuery<ListResponse>({
    queryKey: [
      'transactions',
      opts.q ?? '',
      opts.status ?? 'all',
      opts.patient ?? '',
      opts.encounter ?? '',
      opts.date ?? '',
      opts.limit ?? 0,
      opts.sort ?? '',
      opts.order ?? '',
    ],
    queryFn: () => {
      const params = new URLSearchParams()
      if (opts.q) params.set('q', opts.q)
      if (opts.status && opts.status !== 'all') params.set('status', opts.status)
      if (opts.patient) params.set('patient', opts.patient)
      if (opts.encounter) params.set('encounter', opts.encounter)
      if (opts.date) params.set('date', opts.date)
      if (opts.limit) params.set('limit', String(opts.limit))
      if (opts.sort) params.set('sort', opts.sort)
      if (opts.order) params.set('order', opts.order)
      const qs = params.toString()
      return apiFetch(`/api/transactions${qs ? `?${qs}` : ''}`)
    },
    enabled: opts.enabled ?? true,
    staleTime: 30_000,
  })
}

// ── Single transaction detail ────────────────────────────────────────────────
export function useTransaction(id: string | null) {
  return useQuery<TransactionDetail>({
    queryKey: ['transactions', id],
    queryFn: () => apiFetch(`/api/transactions/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  })
}

// ── Create transaction ───────────────────────────────────────────────────────

export function useCreateTransaction() {
  const qc = useQueryClient()
  return useMutation<CreateTransactionResponse, Error, CreateTransactionInput>({
    mutationFn: (data) =>
      apiFetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      // A new bill also moves the patient's balance + ledger, so go through the
      // shared invalidator and add the clinical side-effects on top.
      invalidateTxn(qc)
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['lab-orders'] })
      qc.invalidateQueries({ queryKey: ['clinical-orders'] })
    },
  })
}

// ── Patient credit (prepaid deposits) ────────────────────────────────────────

/** A patient's spendable prepaid credit (sum of un-consumed deposits). */
export function usePatientCredit(patientId: string | null | undefined) {
  return useQuery<PatientCredit>({
    queryKey: ['patient-credit', patientId],
    queryFn: () => apiFetch(`/api/patients/${patientId}/credit`),
    enabled: !!patientId,
    staleTime: 30_000,
  })
}

// ── Mutations: lifecycle ─────────────────────────────────────────────────────

export function invalidateTxn(qc: ReturnType<typeof useQueryClient>) {
  // Catches both the list query and the detail query (they share the
  // 'transactions' prefix). Payment/void/refund also flip a dose's billing
  // status, so refresh the scheduled-order + prepay-picker views too.
  qc.invalidateQueries({ queryKey: ['transactions'] })
  qc.invalidateQueries({ queryKey: ['scheduledOrders'] })
  qc.invalidateQueries({ queryKey: ['prepayableDoses'] })
  qc.invalidateQueries({ queryKey: ['patient-credit'] })
  // Every money mutation moves the patient's derived position, so the account
  // summary + ledger must follow. Without these, the account surfaces go stale
  // the moment payment is taken from the older per-bill dialogs.
  qc.invalidateQueries({ queryKey: ['patient-account'] })
  qc.invalidateQueries({ queryKey: ['patient-ledger'] })
  qc.invalidateQueries({ queryKey: ['receivables'] })
}

export function useAddPayment() {
  const qc = useQueryClient()
  return useMutation<unknown, ApiError, AddPaymentInput>({
    mutationFn: ({ transactionId, ...body }) =>
      apiFetch(`/api/transactions/${transactionId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => invalidateTxn(qc),
  })
}

export function useAddPayments() {
  const qc = useQueryClient()
  return useMutation<TransactionsAddPaymentBatchResponse, ApiError, AddPaymentBatchInput>({
    mutationFn: ({ transactionId, ...body }) =>
      apiFetch(`/api/transactions/${transactionId}/payments/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => invalidateTxn(qc),
  })
}

export function useCorrectPaymentMethod() {
  const qc = useQueryClient()
  return useMutation<CorrectPaymentMethodResponse, ApiError, CorrectPaymentMethodInput>({
    mutationFn: ({ transactionId, paymentId, ...body }) =>
      apiFetch(`/api/transactions/${transactionId}/payments/${paymentId}/correct-method`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => invalidateTxn(qc),
  })
}

export function useVoidTransaction() {
  const qc = useQueryClient()
  return useMutation<unknown, ApiError, VoidInput>({
    mutationFn: ({ transactionId, reason }) =>
      apiFetch(`/api/transactions/${transactionId}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => invalidateTxn(qc),
  })
}

export function useRefundTransaction() {
  const qc = useQueryClient()
  return useMutation<unknown, ApiError, RefundInput>({
    mutationFn: ({ transactionId, reason }) =>
      apiFetch(`/api/transactions/${transactionId}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => invalidateTxn(qc),
  })
}

// ── Patient-account payments (pay-on-account / apply-credit / receivables) ───
// Served by the patients module (`/api/patients/:id/payments`,
// `/api/patients/:id/apply-credit`) and a tenant/branch aggregate
// (`/api/accounts-receivable`) — kept here alongside the other money
// mutations since they share `invalidateTxn` for cache busting.

export type PayOnAccountResponse = PatientAccountsPayOnAccountResponse
export type ApplyCreditResponse = PatientAccountsApplyCreditResponse
export type ReceivablesResponse = PatientAccountsReceivablesResponse
export type ReceivableRow = PatientAccountsReceivablesResponse['data'][number]

type PayOnAccountCommonInput = {
  patientId: string
  allowCredit?: boolean
  /** Sent as the `Idempotency-Key` header, never in the JSON body. */
  idempotencyKey?: string
  /** Staff attestation on the shared `Branch` login: see `StaffAttestationField`. */
  attestedById?: string
  attestationPin?: string
}

type PayOnAccountLegInput = {
  method: string
  amount: string
  referenceNumber?: string
  payerId?: string
  notes?: string
}

export type PayOnAccountInput = PayOnAccountCommonInput &
  (PayOnAccountLegInput | { payments: PayOnAccountLegInput[] })

export function usePayOnAccount() {
  const qc = useQueryClient()
  return useMutation<PayOnAccountResponse, ApiError, PayOnAccountInput>({
    mutationFn: ({ patientId, idempotencyKey, ...body }) =>
      apiFetch(`/api/patients/${patientId}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: JSON.stringify(body),
      }),
    onSuccess: () => invalidateTxn(qc),
  })
}

export type ApplyCreditInput = {
  patientId: string
  transactionId?: string
  amount?: string
}

export function useApplyCredit() {
  const qc = useQueryClient()
  return useMutation<ApplyCreditResponse, ApiError, ApplyCreditInput>({
    mutationFn: ({ patientId, ...body }) =>
      apiFetch(`/api/patients/${patientId}/apply-credit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => invalidateTxn(qc),
  })
}

export function useReceivables(opts: {
  q?: string
  bucket?: string
  scope?: string
  sort?: string
  order?: string
  limit?: number
}) {
  return useQuery<ReceivablesResponse>({
    queryKey: [
      'receivables',
      opts.q ?? '',
      opts.bucket ?? '',
      opts.scope ?? '',
      opts.sort ?? '',
      opts.order ?? '',
      opts.limit ?? 0,
    ],
    queryFn: () => {
      const params = new URLSearchParams()
      if (opts.q) params.set('q', opts.q)
      if (opts.bucket) params.set('bucket', opts.bucket)
      if (opts.scope) params.set('scope', opts.scope)
      if (opts.sort) params.set('sort', opts.sort)
      if (opts.order) params.set('order', opts.order)
      if (opts.limit) params.set('limit', String(opts.limit))
      const qs = params.toString()
      return apiFetch(`/api/accounts-receivable${qs ? `?${qs}` : ''}`)
    },
    staleTime: 30_000,
  })
}
