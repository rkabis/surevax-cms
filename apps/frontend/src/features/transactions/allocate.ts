// Client-side mirror of the server's oldest-bill-first payment allocator, used
// only to render a pre-commit preview in PayBalancePanel. The server response
// from POST /api/patients/:id/payments is authoritative for what actually
// posted; this module never writes anything. Money math stays in integer
// cents via `@/lib/money` helpers, never `parseFloat` directly.

import { toCents, fromCents, subtractMoney } from '@/lib/money'

export type OpenBillLike = { id: string; transactedAt: string; amountOutstanding: string }

export type Allocation = {
  billId: string
  applied: string
  remainingAfter: string
  settles: boolean
}

export type AllocationPlan = {
  allocations: Allocation[]
  tenderApplied: string
  overage: string
}

const EMPTY_PLAN: AllocationPlan = { allocations: [], tenderApplied: '0.00', overage: '0.00' }

/**
 * Plan how a tender amount applies across a patient's open bills: oldest
 * transaction first, settling each bill in turn before moving to the next.
 * Any tender left over after every open bill is covered becomes `overage`
 * (banked as patient credit by the server).
 */
export function planAllocation(bills: readonly OpenBillLike[], tender: string): AllocationPlan {
  const tenderCents = toCents(tender)
  if (tenderCents <= 0) return EMPTY_PLAN

  const sorted = [...bills].sort((a, b) => {
    const byDate = new Date(a.transactedAt).getTime() - new Date(b.transactedAt).getTime()
    if (byDate !== 0) return byDate
    if (a.id < b.id) return -1
    if (a.id > b.id) return 1
    return 0
  })

  let remainingCents = tenderCents
  const allocations: Allocation[] = []

  for (const bill of sorted) {
    if (remainingCents <= 0) break
    const outstandingCents = toCents(bill.amountOutstanding)
    if (outstandingCents <= 0) continue

    const appliedCents = Math.min(remainingCents, outstandingCents)
    if (appliedCents <= 0) continue

    remainingCents -= appliedCents
    const applied = fromCents(appliedCents)
    const remainingAfter = subtractMoney(bill.amountOutstanding, applied)

    allocations.push({
      billId: bill.id,
      applied,
      remainingAfter,
      settles: toCents(remainingAfter) === 0,
    })
  }

  return {
    allocations,
    tenderApplied: fromCents(tenderCents - remainingCents),
    overage: fromCents(remainingCents),
  }
}
