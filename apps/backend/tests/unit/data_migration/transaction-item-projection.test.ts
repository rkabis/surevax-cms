import { describe, expect, it } from 'vitest'

import { projectTransactionConstrainedItems } from '../../../src/modules/data_migration/transactionItemProjection.js'
import { emptyLoadPlan } from '../../../src/modules/data_migration/targets.js'

describe('projectTransactionConstrainedItems', () => {
  it('treats each linked immunization as one purchased unit and admits exact gross only', () => {
    const plan = emptyLoadPlan()
    plan.transactions = [
      {
        displayId: 'TXN_1',
        tenantId: 'SVX',
        branchDisplayId: 'Cubao',
        patientLegacyId: 'PAT',
        cashierUserLegacyId: null,
        payerCode: null,
        status: 'Paid',
        grossAmount: '200.00',
        discountAmount: '0.00',
        vatAmount: '0.00',
        netAmount: '200.00',
        amountPaid: '200.00',
        discountIdType: null,
        discountIdNumber: null,
        transactedAt: new Date('2026-01-01'),
        legacyAppsheetId: 'TX1',
      },
    ]
    plan.transactionItems = [1, 2].map((index) => ({
      displayId: `TXI_${index}`,
      tenantId: 'SVX',
      transactionLegacyId: 'TX1',
      serviceId: 'ARVPEP_IM',
      clinicalOrderLegacyId: null,
      quantity: index === 1 ? '4.00' : '5.00',
      unitPrice: '100.00',
      subtotal: index === 1 ? '400.00' : '500.00',
      discountAmount: '0.00',
      vatAmount: '0.00',
      performedByUserLegacyId: null,
    }))
    const result = projectTransactionConstrainedItems(plan)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      quantity: '2.00',
      unitPrice: '100.00',
      subtotal: '200.00',
    })
    expect(result.counts.transactionsWithExactItemization).toBe(1)
  })

  it('withholds the item set when linked prices do not equal header gross', () => {
    const plan = emptyLoadPlan()
    plan.transactions = [
      {
        displayId: 'TXN_1',
        tenantId: 'SVX',
        branchDisplayId: 'Cubao',
        patientLegacyId: 'PAT',
        cashierUserLegacyId: null,
        payerCode: null,
        status: 'Paid',
        grossAmount: '150.00',
        discountAmount: '0.00',
        vatAmount: '0.00',
        netAmount: '150.00',
        amountPaid: '150.00',
        discountIdType: null,
        discountIdNumber: null,
        transactedAt: new Date('2026-01-01'),
        legacyAppsheetId: 'TX1',
      },
    ]
    plan.transactionItems = [
      {
        displayId: 'TXI_1',
        tenantId: 'SVX',
        transactionLegacyId: 'TX1',
        serviceId: 'ARVPEP_IM',
        clinicalOrderLegacyId: null,
        quantity: '1.00',
        unitPrice: '100.00',
        subtotal: '100.00',
        discountAmount: '0.00',
        vatAmount: '0.00',
        performedByUserLegacyId: null,
      },
    ]
    const result = projectTransactionConstrainedItems(plan)
    expect(result.items).toEqual([])
    expect(result.counts.transactionsWithMismatchedItemsWithheld).toBe(1)
  })
})
