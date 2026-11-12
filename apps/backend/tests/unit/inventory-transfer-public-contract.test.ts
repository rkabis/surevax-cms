import { describe, expect, it } from 'vitest'
import { transferPublicSchema } from '../../src/modules/inventory_transfers/contract.js'

describe('inventory transfer public contract', () => {
  it('strips every internal numeric foreign key from mutation responses', () => {
    const parsed = transferPublicSchema.parse({
      id: 'TRF_AAAAAAA1',
      transferRef: null,
      tenantId: 'SVX',
      sourceBranchId: 1,
      destinationBranchId: 2,
      lotId: 3,
      destinationLotId: 4,
      quantity: '2.0000',
      status: 'Received',
      shippedAt: '2026-08-23T00:00:00.000Z',
      receivedAt: '2026-08-23T01:00:00.000Z',
      cancelledAt: null,
      shippedById: 5,
      receivedById: 6,
      cancelledById: null,
      notes: null,
      rowVersion: 2,
      createdAt: '2026-08-23T00:00:00.000Z',
      updatedAt: '2026-08-23T01:00:00.000Z',
    })

    expect(parsed).not.toHaveProperty('sourceBranchId')
    expect(parsed).not.toHaveProperty('destinationBranchId')
    expect(parsed).not.toHaveProperty('lotId')
    expect(parsed).not.toHaveProperty('destinationLotId')
    expect(parsed).not.toHaveProperty('shippedById')
    expect(parsed).not.toHaveProperty('receivedById')
    expect(parsed).not.toHaveProperty('cancelledById')
  })
})
