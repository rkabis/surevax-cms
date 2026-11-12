import { describe, it, expect } from 'vitest'
import {
  planAllocation,
  planCreditDraw,
  type OpenBill,
  type CreditSource,
} from '../../src/modules/transactions/allocate.js'

/**
 * Pure arithmetic for pay-on-account. No DB, no fixtures. These are the cases
 * that would otherwise only be caught by an integration test after money has
 * already moved.
 */

/** Bills are always handed to the planner oldest-first. */
function bills(...outstanding: number[]): OpenBill[] {
  return outstanding.map((cents, i) => ({ transactionId: i + 1, outstandingCents: cents }))
}

describe('planAllocation', () => {
  it('fills the oldest bill first and stops when the tender is exhausted', () => {
    const plan = planAllocation(50_00, bills(30_00, 90_00))
    expect(plan.legs).toEqual([
      { transactionId: 1, amountCents: 30_00, remainingAfterCents: 0 },
      { transactionId: 2, amountCents: 20_00, remainingAfterCents: 70_00 },
    ])
    expect(plan.appliedCents).toBe(50_00)
    expect(plan.excessCents).toBe(0)
  })

  it('splits a tender across three bills, exactly settling the first two', () => {
    const plan = planAllocation(1_400_00, bills(500_00, 900_00, 900_00))
    expect(plan.legs.map((l) => l.amountCents)).toEqual([500_00, 900_00])
    expect(plan.legs.every((l) => l.remainingAfterCents === 0)).toBe(true)
    expect(plan.excessCents).toBe(0)
  })

  it('returns the whole tender as excess when there are no open bills', () => {
    const plan = planAllocation(2_000_00, [])
    expect(plan.legs).toEqual([])
    expect(plan.appliedCents).toBe(0)
    expect(plan.excessCents).toBe(2_000_00)
  })

  it('reports the leftover as excess once every bill is settled', () => {
    const plan = planAllocation(1_000_00, bills(300_00, 200_00))
    expect(plan.appliedCents).toBe(500_00)
    expect(plan.excessCents).toBe(500_00)
  })

  it('never emits a zero-amount leg for a bill with no outstanding balance', () => {
    // A zero leg would violate the payments CHECK (amount > 0).
    const plan = planAllocation(100_00, bills(0, 40_00, 0, 30_00))
    expect(plan.legs.map((l) => l.transactionId)).toEqual([2, 4])
    expect(plan.legs.every((l) => l.amountCents > 0)).toBe(true)
    expect(plan.excessCents).toBe(30_00)
  })

  it('is exact to the centavo for a tender that lands mid-bill', () => {
    const plan = planAllocation(1234_56, bills(500_00, 900_00))
    expect(plan.legs).toEqual([
      { transactionId: 1, amountCents: 500_00, remainingAfterCents: 0 },
      { transactionId: 2, amountCents: 734_56, remainingAfterCents: 165_44 },
    ])
    // No float drift: applied + excess must equal the tender exactly.
    expect(plan.appliedCents + plan.excessCents).toBe(1234_56)
  })

  it('returns excess 0 when the tender exactly equals total outstanding', () => {
    const plan = planAllocation(500_00, bills(200_00, 300_00))
    expect(plan.excessCents).toBe(0)
    expect(plan.appliedCents).toBe(500_00)
  })

  it('allocates nothing for a zero tender', () => {
    const plan = planAllocation(0, bills(100_00))
    expect(plan.legs).toEqual([])
    expect(plan.appliedCents).toBe(0)
    expect(plan.excessCents).toBe(0)
  })

  it('sums the legs to appliedCents across many single-centavo bills', () => {
    const plan = planAllocation(3, bills(1, 1, 1, 1))
    expect(plan.legs).toHaveLength(3)
    expect(plan.legs.reduce((s, l) => s + l.amountCents, 0)).toBe(plan.appliedCents)
    expect(plan.appliedCents).toBe(3)
  })
})

describe('planCreditDraw', () => {
  function sources(...remaining: number[]): CreditSource[] {
    return remaining.map((cents, i) => ({ transactionId: 100 + i, remainingCents: cents }))
  }

  it('draws the oldest deposit first against the oldest bill', () => {
    const plan = planCreditDraw(bills(80_00), sources(50_00, 60_00))
    expect(plan.legs).toEqual([
      {
        transactionId: 1,
        fundedByTransactionId: 100,
        amountCents: 50_00,
        depositRemainingAfterCents: 0,
        billRemainingAfterCents: 30_00,
      },
      {
        transactionId: 1,
        fundedByTransactionId: 101,
        amountCents: 30_00,
        depositRemainingAfterCents: 30_00,
        billRemainingAfterCents: 0,
      },
    ])
    expect(plan.drawnCents).toBe(80_00)
  })

  it('spreads one deposit across several bills', () => {
    const plan = planCreditDraw(bills(20_00, 20_00, 20_00), sources(45_00))
    expect(plan.legs.map((l) => [l.transactionId, l.amountCents])).toEqual([
      [1, 20_00],
      [2, 20_00],
      [3, 5_00],
    ])
    expect(plan.drawnCents).toBe(45_00)
  })

  it('honours a cap below the available credit', () => {
    const plan = planCreditDraw(bills(100_00), sources(80_00), 30_00)
    expect(plan.drawnCents).toBe(30_00)
    expect(plan.legs).toHaveLength(1)
    expect(plan.legs[0]!.depositRemainingAfterCents).toBe(50_00)
  })

  it('draws nothing when there is no credit', () => {
    expect(planCreditDraw(bills(100_00), [])).toEqual({ legs: [], drawnCents: 0 })
  })

  it('draws nothing when there are no open bills', () => {
    expect(planCreditDraw([], sources(100_00))).toEqual({ legs: [], drawnCents: 0 })
  })

  it('never draws more than a bill owes', () => {
    const plan = planCreditDraw(bills(10_00), sources(500_00))
    expect(plan.drawnCents).toBe(10_00)
    expect(plan.legs[0]!.billRemainingAfterCents).toBe(0)
  })

  it('does not mutate the caller’s source array', () => {
    const src = sources(50_00)
    planCreditDraw(bills(50_00), src)
    expect(src[0]!.remainingCents).toBe(50_00)
  })

  it('skips exhausted deposits without emitting zero-amount legs', () => {
    const plan = planCreditDraw(bills(30_00), sources(0, 30_00))
    expect(plan.legs).toHaveLength(1)
    expect(plan.legs[0]!.fundedByTransactionId).toBe(101)
  })
})
