import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/apiFetch'

// ── Types ─────────────────────────────────────────────────────────────────────

export type PayerContract = {
  id: string
  payerId: string
  contractNumber: string
  effectiveFrom: string
  effectiveTo: string | null
  paymentTermsDays: number | null
  claimSubmissionFormat: string | null
  requiresPriorAuth: boolean
  feeScheduleNotes: string | null
  contactName: string | null
  contactNumber: string | null
  contactEmail: string | null
  rowVersion: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

type ListResponse = {
  data: PayerContract[]
}

export type CreatePayerContractInput = {
  contractNumber: string
  effectiveFrom: string
  effectiveTo?: string | null
  paymentTermsDays?: number | null
  claimSubmissionFormat?: string | null
  requiresPriorAuth?: boolean
  feeScheduleNotes?: string | null
  contactName?: string | null
  contactNumber?: string | null
  contactEmail?: string | null
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function usePayerContracts(payerId: string | null) {
  return useQuery<ListResponse>({
    queryKey: ['payer-contracts', payerId],
    queryFn: () => apiFetch<ListResponse>(`/api/payer-profiles/${payerId}/contracts`),
    enabled: !!payerId,
    staleTime: 30_000,
  })
}

export function useCreatePayerContract(payerId: string) {
  const qc = useQueryClient()
  return useMutation<PayerContract, Error, CreatePayerContractInput>({
    mutationFn: (body) =>
      apiFetch<PayerContract>(`/api/payer-profiles/${payerId}/contracts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['payer-contracts', payerId] })
    },
  })
}
