import type { ClinicInfo } from '@/lib/escpos'
import type { TransactionDetail } from './api'

/**
 * Builds the receipt clinic header. Values are sourced, in order of preference:
 *   1. the transaction's branch (the branch of sale — correct even when the
 *      receipt is viewed by someone clocked in at a different branch), then
 *   2. the signed-in user's primary branch (fallback while a legacy branch-less
 *      transaction is open), then
 *   3. the SureVax brand default.
 *
 * When the transaction's branch is BIR-registered (`branch.receipt.mode ===
 * 'bir_official'`) the BIR block is carried through and the renderers switch to
 * Official-Receipt mode. Phase 1: always acknowledgement mode.
 */
type BranchFallback = {
  branchName?: string | null
  branchAddress?: string | null
  branchContactNumber?: string | null
  branchCode?: string | null
}

const SUREVAX_FALLBACK = { name: 'SureVax', address: '—', phone: '—', initials: 'SV' }

export function buildClinicInfo(
  txn: Pick<TransactionDetail, 'branch'> | null | undefined,
  user?: BranchFallback | null,
): ClinicInfo {
  const b = txn?.branch ?? null
  const addressParts = [b?.address, b?.city, b?.province].filter(Boolean)
  const name = b?.name ?? user?.branchName ?? SUREVAX_FALLBACK.name
  const address =
    addressParts.length > 0
      ? addressParts.join(', ')
      : (user?.branchAddress ?? SUREVAX_FALLBACK.address)
  const phone = b?.contactNumber ?? user?.branchContactNumber ?? SUREVAX_FALLBACK.phone
  const initials = b?.code ?? user?.branchCode ?? SUREVAX_FALLBACK.initials
  const bir = b?.receipt?.mode === 'bir_official' ? b.receipt.bir : null
  return { name, address, phone, initials, bir }
}
