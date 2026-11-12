import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/apiFetch'

export { ApiError } from '@/lib/apiFetch'

export type Branch = {
  id: string // display_id e.g. SVX.HST
  code: string
  name: string
  isActive: boolean
  address: string | null
  city: string | null
  province: string | null
  contactNumber: string | null
  email: string | null
  timezone: string | null
  settings: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export type BranchStaff = {
  displayId: string
  name: string
  email: string
  role: string | null
  isActive: boolean
}

export type TxnCounter = {
  kind: 'TXN'
  currentValue: number | null
}

export type BranchDetail = Branch & {
  staffCount: number
  activeStaffCount: number
  staff: BranchStaff[]
  txnCounter: TxnCounter
}

export function listBranches(opts: { includeInactive?: boolean } = {}): Promise<Branch[]> {
  const params = opts.includeInactive ? '?includeInactive=true' : ''
  return apiFetch(`/api/admin/branches${params}`)
}

export function getBranch(id: string): Promise<BranchDetail> {
  return apiFetch(`/api/admin/branches/${encodeURIComponent(id)}`)
}

export function useAdminBranchesList(opts: { includeInactive?: boolean } = {}) {
  return useQuery<Branch[]>({
    queryKey: ['admin-branches-list', opts.includeInactive ?? false],
    queryFn: () => listBranches(opts),
    staleTime: 2 * 60_000,
  })
}

export function useAdminBranchDetail(id: string | null) {
  return useQuery<BranchDetail>({
    queryKey: ['admin-branch', id],
    queryFn: () => getBranch(id!),
    enabled: !!id,
    staleTime: 60_000,
  })
}

// ── Receipt configuration ─────────────────────────────────────────────────────
//
// Writes `branches.settings.receipt.bir` (read by `extractBranchReceiptConfig`
// in apps/backend/src/modules/transactions/db.ts). A branch prints
// acknowledgement receipts until this is populated with a TIN.

export type BranchReceiptBir = {
  tin: string
  registeredName: string
  permitNo: string
  accreditationNo: string | null
  orSeries: string | null
}

export type BranchReceiptConfigInput = {
  mode: 'acknowledgement' | 'bir_official'
  tin?: string | null
  registeredName?: string | null
  permitNo?: string | null
  accreditationNo?: string | null
  orSeries?: string | null
}

export type BranchReceiptConfigResponse = {
  mode: 'acknowledgement' | 'bir_official'
  bir: BranchReceiptBir | null
  updatedAt: string
  rowVersion: number
}

/** Derive the *current* effective mode from stored settings: mirrors the
 *  backend reader's rule (`bir.tin` present and non-empty means official). */
export function deriveReceiptMode(settings: Record<string, unknown> | null | undefined): {
  mode: 'acknowledgement' | 'bir_official'
  bir: BranchReceiptBir | null
} {
  const receipt = (settings?.['receipt'] ?? {}) as Record<string, unknown>
  const bir = receipt['bir'] as Partial<BranchReceiptBir> | null | undefined
  if (bir && typeof bir.tin === 'string' && bir.tin.length > 0) {
    return {
      mode: 'bir_official',
      bir: {
        tin: bir.tin,
        registeredName: bir.registeredName ?? '',
        permitNo: bir.permitNo ?? '',
        accreditationNo: bir.accreditationNo ?? null,
        orSeries: bir.orSeries ?? null,
      },
    }
  }
  return { mode: 'acknowledgement', bir: null }
}

export function useUpdateBranchReceiptConfig(id: string) {
  const qc = useQueryClient()
  return useMutation<BranchReceiptConfigResponse, Error, BranchReceiptConfigInput>({
    mutationFn: (body) =>
      apiFetch<BranchReceiptConfigResponse>(
        `/api/admin/branches/${encodeURIComponent(id)}/receipt-config`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-branch', id] })
      void qc.invalidateQueries({ queryKey: ['admin-branches-list'] })
    },
  })
}
