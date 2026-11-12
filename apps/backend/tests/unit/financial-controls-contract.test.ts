import { describe, expect, it } from 'vitest'
import { createTransactionSchema } from '../../src/modules/transactions/contract.js'

const basePayload = {
  patientId: 'PAT_AAAAAAA1',
  items: [{ serviceId: 'LAB_GLUCOSE_FBS', quantity: 1 }],
}

describe('transaction discount evidence contract', () => {
  it.each(['OSCA', 'PWD'] as const)(
    'requires a non-blank ID number for a primary %s discount',
    (idType) => {
      const result = createTransactionSchema.safeParse({
        ...basePayload,
        discount: { idType, idNumber: '   ' },
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues).toContainEqual(
          expect.objectContaining({ path: ['discount', 'idNumber'] }),
        )
      }
    },
  )

  it('requires the same evidence for an additional patient discount', () => {
    const result = createTransactionSchema.safeParse({
      ...basePayload,
      patients: [
        {
          patientId: 'PAT_AAAAAAA2',
          discount: { idType: 'PWD' },
        },
      ],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ path: ['patients', 0, 'discount', 'idNumber'] }),
      )
    }
  })

  it('does not invent an ID requirement for NA or Other', () => {
    expect(
      createTransactionSchema.safeParse({ ...basePayload, discount: { idType: 'NA' } }).success,
    ).toBe(true)
    expect(
      createTransactionSchema.safeParse({ ...basePayload, discount: { idType: 'Other' } }).success,
    ).toBe(true)
  })
})
