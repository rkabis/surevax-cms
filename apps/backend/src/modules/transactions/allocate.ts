/**
 * Oldest-first allocation of a tendered amount across a patient's open bills.
 *
 * Pure and DB-free so the arithmetic is unit-testable without a database, and
 * so the frontend can mirror it for a pre-commit preview the same way
 * `features/transactions/totals.ts` mirrors `computeTransactionTotals`. The
 * server's result is always authoritative.
 *
 * All arithmetic is in integer cents. Never use floats for money.
 */

/** An open bill, already sorted oldest-first by the caller. */
export type OpenBill = {
  /** transactions.id (bigint). */
  transactionId: number
  /** Balance still owed on this bill, in cents. Always > 0. */
  outstandingCents: number
}

export type AllocationLeg = {
  transactionId: number
  amountCents: number
  /** Bill balance remaining after this leg. 0 means the leg settles it. */
  remainingAfterCents: number
}

export type AllocationPlan = {
  legs: AllocationLeg[]
  /** Total applied to bills. */
  appliedCents: number
  /** Tender left over once every open bill is settled. */
  excessCents: number
}

/**
 * Greedily fill the oldest bills first until the tender runs out.
 *
 * `bills` MUST already be ordered oldest-first; this function does not sort,
 * because "oldest" is a business decision (transacted_at, not created_at) that
 * belongs with the query. Bills with a non-positive balance are skipped rather
 * than emitted as zero-amount legs, which would violate the
 * `payments CHECK (amount > 0)` constraint.
 */
export function planAllocation(tenderedCents: number, bills: readonly OpenBill[]): AllocationPlan {
  let remaining = Math.max(0, Math.trunc(tenderedCents))
  const legs: AllocationLeg[] = []

  for (const bill of bills) {
    if (remaining <= 0) break
    if (bill.outstandingCents <= 0) continue
    const amountCents = Math.min(remaining, bill.outstandingCents)
    legs.push({
      transactionId: bill.transactionId,
      amountCents,
      remainingAfterCents: bill.outstandingCents - amountCents,
    })
    remaining -= amountCents
  }

  const tendered = Math.max(0, Math.trunc(tenderedCents))
  return { legs, appliedCents: tendered - remaining, excessCents: remaining }
}

/** A deposit with spendable credit, already sorted oldest-first. */
export type CreditSource = {
  /** transactions.id of the deposit (bigint). */
  transactionId: number
  /** Spendable balance on this deposit, in cents. Always > 0. */
  remainingCents: number
}

export type CreditDrawLeg = {
  /** The bill being paid. */
  transactionId: number
  /** The deposit funding this draw. */
  fundedByTransactionId: number
  amountCents: number
  /** Deposit balance remaining after this draw. 0 means it is exhausted. */
  depositRemainingAfterCents: number
  /** Bill balance remaining after this draw. */
  billRemainingAfterCents: number
}

export type CreditPlan = {
  legs: CreditDrawLeg[]
  drawnCents: number
}

/**
 * Draw available credit across open bills, oldest bill first and oldest deposit
 * first. One bill can be funded by several deposits (a draw per deposit),
 * because a deposit is consumed by `Credit` payment rows that each carry a
 * single `funded_by_transaction_id`.
 *
 * `capCents` bounds the total drawn (a cashier applying only part of the
 * available credit); pass `Infinity` to draw as much as both sides allow.
 */
export function planCreditDraw(
  bills: readonly OpenBill[],
  sources: readonly CreditSource[],
  capCents: number = Number.POSITIVE_INFINITY,
): CreditPlan {
  const legs: CreditDrawLeg[] = []
  // Local mutable copies: the caller's arrays stay untouched.
  const pool = sources.filter((s) => s.remainingCents > 0).map((s) => ({ ...s }))
  let budget = Math.max(0, Math.trunc(Math.min(capCents, Number.MAX_SAFE_INTEGER)))
  let drawn = 0

  for (const bill of bills) {
    let billRemaining = bill.outstandingCents
    if (billRemaining <= 0) continue

    for (const source of pool) {
      if (billRemaining <= 0 || budget <= 0) break
      if (source.remainingCents <= 0) continue

      const amountCents = Math.min(billRemaining, source.remainingCents, budget)
      if (amountCents <= 0) continue

      billRemaining -= amountCents
      source.remainingCents -= amountCents
      budget -= amountCents
      drawn += amountCents

      legs.push({
        transactionId: bill.transactionId,
        fundedByTransactionId: source.transactionId,
        amountCents,
        depositRemainingAfterCents: source.remainingCents,
        billRemainingAfterCents: billRemaining,
      })
    }

    if (budget <= 0) break
  }

  return { legs, drawnCents: drawn }
}
