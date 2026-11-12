/**
 * End-to-end pipeline test against a hand-crafted fixture bundle.
 * extract → transform → load with the memory adapter; no real xlsx, no Postgres.
 */
import { describe, it, expect } from 'vitest'
import { bundleFromMap } from '../../../src/modules/data_migration/extract.js'
import { runTransforms } from '../../../src/modules/data_migration/transform/index.js'
import { load } from '../../../src/modules/data_migration/load.js'
import { createMemoryAdapter } from '../../../src/modules/data_migration/adapter.js'
import type { MigrationContext } from '../../../src/modules/data_migration/types.js'

const TENANT = 'SVX'
const ctx: MigrationContext = {
  tenantId: TENANT,
  platformUserId: 1,
  cutoverAt: new Date('2026-08-17T00:00:00.000Z'),
  dryRun: false,
  batchSize: 1000,
  log: () => {},
}

describe('data_migration end-to-end (fixture bundle)', () => {
  it('walks the sheets and produces a coherent LoadPlan + DB writes', async () => {
    const visitAt = new Date('2024-07-29T12:00:00Z')
    const bundle = bundleFromMap({
      Branch: [{ 'Row ID': 'HolySpirit', b_Name: 'Holy Spirit', b_TransactionInitials: 'HST' }],
      Nurse: [
        {
          'Row ID': 'RoberosePuri',
          n_FullName: 'Roberose Puri',
          n_FirstName: 'Roberose',
          n_LastName: 'Puri',
          n_BranchRef: 'HolySpirit',
        },
        {
          'Row ID': 'AppSheetAdmin',
          n_FullName: 'Appsheet Admin',
          n_FirstName: 'Appsheet',
          n_LastName: 'Admin',
        },
      ],
      AdminEmails: [{ Email: 'admin@surevax.com' }],
      Vaccine: [
        {
          'Row ID': 'ARVPEP_AbhayrabID',
          v_Type: 'Anti Rabies - PEP',
          v_Brand: 'Abhayrab',
          v_Route: 'ID',
          v_DosagePrice: 800,
          v_DosageAmount: 0.2,
        },
      ],
      Patient: [
        {
          'Row ID': 'PAT-CATA',
          p_FullName: 'Cataleya Hulguin',
          p_FirstName: 'Cataleya',
          p_LastName: 'Hulguin',
          p_DateFirstVisit: visitAt,
          p_Branch: 'HolySpirit',
          p_Categorization: '2',
        },
      ],
      Immunization: [
        {
          'Row ID': 'IMM-1',
          i_PatientRef: 'PAT-CATA',
          i_BranchRef: 'HolySpirit',
          i_NurseRef: 'RoberosePuri',
          i_VaccineRef: 'ARVPEP_AbhayrabID',
          i_Timestamp_Actual: visitAt,
          i_DosagePrice: 800,
          i_DosageCount: '1',
          'i_IsAdministered?': true,
          i_TransactionRef: 'TXN-1',
          i_VaccineRoute: 'ID',
        },
      ],
      Transactions: [
        {
          'Row ID': 'TXN-1',
          t_Timestamp: visitAt,
          t_PatientRef: 'PAT-CATA',
          t_NurseRef: 'RoberosePuri',
          t_BranchRef: 'HolySpirit',
          t_TransactionValue: 800,
          t_TotalAmountPaid: 800,
          t_AmountPaid_Cash: 800,
        },
      ],
      Remarks: [
        {
          'Row ID': 'R-1',
          r_PatientRef: 'PAT-CATA',
          r_NurseRef: 'RoberosePuri',
          r_Timestamp: visitAt,
          r_Remarks: 'Tolerated well',
        },
      ],
      CashBalanceLog: [
        {
          'Row ID': 'CSH-1',
          cbl_Timestamp: visitAt,
          cbl_BranchRef: 'HolySpirit',
          cbl_DepositAmount: 5000,
          cbl_Remarks: 'Padding',
        },
      ],
      NurseShift: [
        {
          'Row ID': 'NS-1',
          ns_BranchEmail: 'surevax.hs@gmail.com',
          ns_NurseRef: 'Roberose Puri',
          ns_TimeIn: visitAt,
          ns_TimeOut: new Date(visitAt.getTime() + 8 * 3600_000),
        },
      ],
      // ImmunizationBundle dropped per A2; InventoryLog dropped per D1.
    })

    const { plan, serviceCodeByLegacyRef } = runTransforms(
      bundle,
      TENANT,
      new Date('2026-08-17T15:59:59.999Z'),
    )

    expect(plan.branches).toHaveLength(1)
    expect(plan.users.length).toBeGreaterThanOrEqual(2)
    expect(plan.products).toHaveLength(1)
    expect(plan.services).toHaveLength(1)
    expect(plan.patients).toHaveLength(1)
    expect(plan.encounters).toHaveLength(1)
    expect(plan.clinicalOrders).toHaveLength(1)
    expect(plan.transactions).toHaveLength(1)
    expect(plan.transactionItems.length).toBeGreaterThanOrEqual(1)
    expect(plan.payments).toHaveLength(1)
    expect(plan.cashDrawerSessions).toHaveLength(1)
    // C1: attendance is optional and neither source is loaded until the
    // TimeLog + NurseShift union/dedupe transform is implemented.
    expect(plan.staffTimeLogs).toHaveLength(0)
    expect(serviceCodeByLegacyRef.get('ARVPEP_AbhayrabID')).toBe('ARVPEP_ID')

    const enc = plan.encounters[0]!
    expect(enc.specialty).toBe('Rabies')
    expect((enc.clinicalNotes as Record<string, unknown>).remarks).toEqual(['Tolerated well'])

    expect(plan.patientStandingOrders.length).toBeGreaterThanOrEqual(1)
    expect(plan.patientStandingOrders[0]!.templateId).toBe('SOT-RABIES-PEP-ID')

    const adapter = createMemoryAdapter()
    const report = await load(plan, adapter, ctx)
    expect(report.inserted.patients).toBe(1)
    expect(report.inserted.transactions).toBe(1)
    expect(report.inserted.payments).toBe(1)
    expect(report.inserted.clinical_orders).toBe(1)
    expect(report.inserted.encounters).toBe(1)
    expect(adapter.byTable.patients).toHaveLength(1)
    expect(adapter.byTable.transactions).toHaveLength(1)
  })
})
