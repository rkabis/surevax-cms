import { describe, expect, it } from 'vitest'
import { planAllocation, type OpenBillLike } from '../allocate'

/**
 * Client-side mirror of the server's oldest-bill-first pay-on-account
 * allocator (PayBalancePanel's pre-commit preview). The server response is
 * always authoritative for what actually posts; this pins the preview math so
 * it never disagrees with the server by a centavo.
 */

const bill = (over: Partial<OpenBillLike> = {}): OpenBillLike => ({
  id: 'TXN_A',
  transactedAt: '2026-01-01',
  amountOutstanding: '500.00',
  ...over,
})

describe('planAllocation', () => {
  it('allocates oldest-first across two bills', () => {
    const bills = [
      bill({ id: 'TXN_A', transactedAt: '2026-01-01', amountOutstanding: '500.00' }),
      bill({ id: 'TXN_B', transactedAt: '2026-01-15', amountOutstanding: '300.00' }),
    ]
    const plan = planAllocation(bills, '600.00')
    expect(plan.allocations).toEqual([
      { billId: 'TXN_A', applied: '500.00', remainingAfter: '0.00', settles: true },
      { billId: 'TXN_B', applied: '100.00', remainingAfter: '200.00', settles: false },
    ])
    expect(plan.tenderApplied).toBe('600.00')
    expect(plan.overage).toBe('0.00')
  })

  it('settles the oldest exactly and part-pays the next', () => {
    const bills = [
      bill({ id: 'TXN_A', transactedAt: '2026-01-01', amountOutstanding: '200.00' }),
      bill({ id: 'TXN_B', transactedAt: '2026-01-15', amountOutstanding: '300.00' }),
    ]
    const plan = planAllocation(bills, '350.00')
    expect(plan.allocations).toEqual([
      { billId: 'TXN_A', applied: '200.00', remainingAfter: '0.00', settles: true },
      { billId: 'TXN_B', applied: '150.00', remainingAfter: '150.00', settles: false },
    ])
    expect(plan.tenderApplied).toBe('350.00')
    expect(plan.overage).toBe('0.00')
  })

  it('whole tender becomes overage when there are no open bills', () => {
    const plan = planAllocation([], '100.00')
    expect(plan.allocations).toEqual([])
    expect(plan.tenderApplied).toBe('0.00')
    expect(plan.overage).toBe('100.00')
  })

  it('never emits a zero-amount allocation', () => {
    const bills = [
      bill({ id: 'TXN_ZERO', transactedAt: '2026-01-01', amountOutstanding: '0.00' }),
      bill({ id: 'TXN_NEG', transactedAt: '2026-01-02', amountOutstanding: '-50.00' }),
      bill({ id: 'TXN_B', transactedAt: '2026-01-15', amountOutstanding: '150.00' }),
    ]
    const plan = planAllocation(bills, '100.00')
    expect(plan.allocations).toHaveLength(1)
    expect(plan.allocations[0]!.billId).toBe('TXN_B')
    expect(plan.allocations.every((a) => a.applied !== '0.00')).toBe(true)
  })

  it('is exact to the centavo for a tender landing mid-bill', () => {
    const bills = [bill({ id: 'TXN_A', transactedAt: '2026-01-01', amountOutstanding: '100.00' })]
    const plan = planAllocation(bills, '37.33')
    expect(plan.allocations).toEqual([
      { billId: 'TXN_A', applied: '37.33', remainingAfter: '62.67', settles: false },
    ])
    const appliedPlusOverage = (
      Number(plan.tenderApplied) * 100 +
      Number(plan.overage) * 100
    ).toFixed(0)
    expect(appliedPlusOverage).toBe('3733')
  })

  it('returns an empty plan for a zero tender', () => {
    const bills = [bill()]
    const plan = planAllocation(bills, '0.00')
    expect(plan.allocations).toEqual([])
    expect(plan.tenderApplied).toBe('0.00')
    expect(plan.overage).toBe('0.00')
  })

  it('returns an empty plan for a non-numeric tender', () => {
    const bills = [bill()]
    const plan = planAllocation(bills, 'not-a-number')
    expect(plan.allocations).toEqual([])
    expect(plan.tenderApplied).toBe('0.00')
    expect(plan.overage).toBe('0.00')
  })

  it('sorts unsorted input oldest-first', () => {
    const bills = [
      bill({ id: 'NEW', transactedAt: '2026-03-01', amountOutstanding: '100.00' }),
      bill({ id: 'OLD', transactedAt: '2026-01-01', amountOutstanding: '100.00' }),
    ]
    const plan = planAllocation(bills, '150.00')
    expect(plan.allocations[0]!.billId).toBe('OLD')
    expect(plan.allocations[0]!.settles).toBe(true)
    expect(plan.allocations[1]!.billId).toBe('NEW')
    expect(plan.allocations[1]!.settles).toBe(false)
  })
})
