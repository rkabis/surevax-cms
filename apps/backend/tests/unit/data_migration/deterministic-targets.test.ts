import { describe, expect, it } from 'vitest'
import { DISPLAY_ID_REGEX } from '../../../src/shared/utils/displayId.js'
import {
  deterministicMigrationDisplayId,
  stabilizeMigrationTargetIds,
} from '../../../src/modules/data_migration/deterministicTargets.js'
import { emptyLoadPlan } from '../../../src/modules/data_migration/targets.js'

describe('deterministic migration target IDs', () => {
  it('is stable across processes while retaining the public display-id shape', () => {
    const first = deterministicMigrationDisplayId('PAT', 'legacy-patient-1')
    const retry = deterministicMigrationDisplayId('PAT', 'legacy-patient-1')
    expect(first).toBe(retry)
    expect(first).toMatch(DISPLAY_ID_REGEX)
    expect(first).not.toBe(deterministicMigrationDisplayId('PAT', 'legacy-patient-2'))
    expect(first.slice(4)).not.toBe(
      deterministicMigrationDisplayId('USR', 'legacy-patient-1').slice(4),
    )
  })

  it('stabilizes transaction and payment targets from their immutable source keys', () => {
    const plan = emptyLoadPlan()
    plan.transactions = [
      {
        displayId: 'TXN_00000000',
        tenantId: 'SVX',
        branchDisplayId: 'SVX.HST',
        patientLegacyId: 'PAT-1',
        cashierUserLegacyId: null,
        payerCode: null,
        status: 'Paid',
        grossAmount: '100.00',
        discountAmount: '0.00',
        vatAmount: '0.00',
        netAmount: '100.00',
        amountPaid: '100.00',
        discountIdType: null,
        discountIdNumber: null,
        transactedAt: new Date('2026-08-01T08:00:00+08:00'),
        legacyAppsheetId: 'TX-1',
      },
    ]
    plan.payments = [
      {
        displayId: 'PMT_00000000',
        tenantId: 'SVX',
        transactionLegacyId: 'TX-1',
        method: 'Cash',
        amount: '100.00',
        referenceNumber: null,
        reconciliationStatus: 'Reconciled',
        receivedAt: new Date('2026-08-01T08:00:00+08:00'),
      },
    ]

    const first = stabilizeMigrationTargetIds(plan)
    const retry = stabilizeMigrationTargetIds(plan)
    expect(first.transactions[0]!.displayId).toBe(retry.transactions[0]!.displayId)
    expect(first.payments[0]!.displayId).toBe(retry.payments[0]!.displayId)
    expect(first.transactions[0]!.displayId).toMatch(DISPLAY_ID_REGEX)
    expect(first.payments[0]!.displayId).toMatch(DISPLAY_ID_REGEX)
  })
})
