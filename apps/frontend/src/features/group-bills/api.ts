import { useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  GroupBillingCreateResponse,
  GroupBillingListQuery,
  GroupBillingListResponse,
} from '@/api/contracts/group-billing.gen'
import { apiFetch } from '@/lib/apiFetch'
import type { CreateGroupBillInput } from './form'

export type GroupBillListItem = GroupBillingListResponse['data'][number]

export function useGroupBills(status: NonNullable<GroupBillingListQuery['status']> = 'open') {
  return useQuery<GroupBillingListResponse>({
    queryKey: ['group-bills', status],
    queryFn: () => apiFetch(`/api/group-bills?status=${status}`),
    staleTime: 30_000,
  })
}

export function useCreateGroupBill() {
  const qc = useQueryClient()
  // Keep one key across an ambiguous network failure and its user-triggered
  // retry. The server's unique key prevents duplicate money/inventory fan-out.
  const idempotencyKey = useRef<string | null>(null)
  return useMutation<GroupBillingCreateResponse, Error, CreateGroupBillInput>({
    mutationFn: async (body) => {
      idempotencyKey.current ??= `group-${crypto.randomUUID()}`
      const response = await apiFetch<GroupBillingCreateResponse>('/api/group-bills', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey.current,
        },
        body: JSON.stringify(body),
      })
      idempotencyKey.current = null
      return response
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['group-bills'] })
      void qc.invalidateQueries({ queryKey: ['transactions'] })
      void qc.invalidateQueries({ queryKey: ['receivables'] })
      void qc.invalidateQueries({ queryKey: ['patient-account'] })
      void qc.invalidateQueries({ queryKey: ['patient-ledger'] })
    },
  })
}
