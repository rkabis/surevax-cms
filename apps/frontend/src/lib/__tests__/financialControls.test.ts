import { describe, expect, it } from 'vitest'
import { transactionCreateSchema } from '@surevax/shared'
import { ApiError } from '../apiFetch'
import { apiErrorMessage } from '../apiErrors'
import { isStaffAttestationComplete } from '@/features/transactions/components/StaffAttestationField'
import { transactionCreateFormSchema } from '@/features/transactions/formSchema'

const basePayload = {
  patientId: 'PAT_AAAAAAA1',
  items: [{ serviceId: 'LAB_GLUCOSE_FBS', quantity: 1 }],
}

describe('cashier financial-control feedback', () => {
  it('rejects an OSCA discount without an ID number in the shared contract', () => {
    const result = transactionCreateSchema.safeParse({
      ...basePayload,
      discount: { idType: 'OSCA' },
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['discount', 'idNumber'],
          message: 'Senior/PWD ID number is required',
        }),
      )
    }
  })

  it('keeps the flattened cashier form fail-closed for a blank PWD ID', () => {
    const result = transactionCreateFormSchema.safeParse({
      ...basePayload,
      discountIdType: 'PWD',
      discountIdNumber: '   ',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['discountIdNumber'],
          message: 'Senior/PWD ID number is required',
        }),
      )
    }
  })

  it('gives an actionable recovery path for an already-billed clinical order', () => {
    expect(
      apiErrorMessage(
        new ApiError(
          'Duplicate transaction — a matching record already exists',
          409,
          'CLINICAL_ORDER_ALREADY_BILLED',
        ),
      ),
    ).toBe(
      'This dose already has an active bill. Refresh the worklist and open that transaction before collecting payment again.',
    )
  })

  it('routes missing legacy receiver attribution to accountable repair', () => {
    expect(
      apiErrorMessage(
        new ApiError('Repair that audit field before retrying', 409, 'PAYMENT_RECEIVER_UNKNOWN'),
      ),
    ).toBe(
      'This legacy payment has no accountable receiver on record. Ask a Tenant Admin to document and repair the attribution before correcting it.',
    )
  })

  it('does not treat an unresolved login role as implicit self-attestation', () => {
    expect(
      isStaffAttestationComplete({ attestedById: null, attestationPin: null }, undefined),
    ).toBe(false)
  })
})
