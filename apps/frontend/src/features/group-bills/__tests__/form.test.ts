import { describe, expect, it } from 'vitest'
import { canReviewGroupBill, toCreateGroupBillPayload, type GroupBillDraft } from '../form'

const draft = (overrides: Partial<GroupBillDraft> = {}): GroupBillDraft => ({
  payerId: 'PAY_CORP',
  referenceNumber: 'PO-2026-44',
  patients: [
    {
      id: 'member-1',
      patientId: 'PAT_A',
      items: [{ id: 'line-1', serviceId: 'SVC_ARV', quantity: 1 }],
    },
    {
      id: 'member-2',
      patientId: 'PAT_B',
      items: [{ id: 'line-2', serviceId: 'SVC_LAB', quantity: 2 }],
    },
  ],
  ...overrides,
})

describe('corporate group bill review gate', () => {
  it('does not allow review until two distinct patients each own a valid service', () => {
    expect(canReviewGroupBill(draft())).toBe(true)
    expect(canReviewGroupBill(draft({ patients: draft().patients.slice(0, 1) }))).toBe(false)
    expect(
      canReviewGroupBill(
        draft({
          patients: [
            { ...draft().patients[0]!, patientId: 'PAT_A' },
            { ...draft().patients[1]!, patientId: 'PAT_A' },
          ],
        }),
      ),
    ).toBe(false)
    expect(
      canReviewGroupBill(
        draft({ patients: [{ ...draft().patients[0]!, items: [] }, draft().patients[1]!] }),
      ),
    ).toBe(false)
  })

  it('keeps each patient-service assignment intact in the post-review create payload', () => {
    expect(toCreateGroupBillPayload(draft())).toEqual({
      payerId: 'PAY_CORP',
      referenceNumber: 'PO-2026-44',
      patients: [
        { patientId: 'PAT_A', items: [{ serviceId: 'SVC_ARV', quantity: 1 }] },
        { patientId: 'PAT_B', items: [{ serviceId: 'SVC_LAB', quantity: 2 }] },
      ],
    })
  })
})
