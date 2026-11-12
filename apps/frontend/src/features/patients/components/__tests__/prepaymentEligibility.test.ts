import { describe, expect, it } from 'vitest'
import { isEligiblePrepaymentOrder } from '../StandingOrderTab'

describe('patient-account prepayment eligibility', () => {
  it.each(['Completed', 'Cancelled'])(
    'excludes %s orders even when they are unbilled',
    (status) => {
      expect(isEligiblePrepaymentOrder({ status, paymentStatus: null })).toBe(false)
    },
  )

  it('excludes an already-linked active order', () => {
    expect(isEligiblePrepaymentOrder({ status: 'Scheduled', paymentStatus: 'Pending' })).toBe(false)
  })

  it('allows an active, unbilled future order', () => {
    expect(isEligiblePrepaymentOrder({ status: 'Scheduled', paymentStatus: null })).toBe(true)
  })
})
