import { describe, expect, it } from 'vitest'
import { bundleFromMap } from '../../../src/modules/data_migration/extract.js'
import {
  reconcileRehearsal,
  type RehearsalInput,
} from '../../../src/modules/data_migration/rehearsal.js'

function fixture(): RehearsalInput {
  const at = new Date('2026-08-01T09:00:00.000Z')
  return {
    tenantId: 'SVX',
    cutoffDate: '2026-08-20',
    sourceDriftRecorded: false,
    snapshots: [
      {
        key: 'appsheet',
        source: 'appsheet',
        title: 'surevax_gsheet_db',
        present: true,
        actualSha256: 'a'.repeat(64),
        hashMatchesExpected: true,
      },
      {
        key: 'tracker:Taguig',
        source: 'tracker',
        title: 'Manual Sales Tracker - Taguig',
        present: true,
        actualSha256: 'b'.repeat(64),
        hashMatchesExpected: true,
      },
    ],
    source: bundleFromMap({
      Branch: [
        { 'Row ID': 'Cubao', b_Name: 'Cubao', b_TransactionInitials: 'CUB' },
        { 'Row ID': 'Taguig', b_Name: 'Taguig', b_TransactionInitials: 'TAG' },
      ],
      Vaccine: [
        {
          'Row ID': 'ARV_ID',
          v_Type: 'Anti Rabies - PEP',
          v_Route: 'ID',
          v_Brand: 'Abhayrab',
          v_DosagePrice: 800,
        },
      ],
      Patient: [
        {
          'Row ID': 'PAT-1',
          p_FullName: 'Patient One',
          p_FirstName: 'Patient',
          p_LastName: 'One',
          p_DateFirstVisit: at,
          p_Branch: 'Cubao',
          p_PetStatus: 'Pending',
          p_PetFirstARVDate: '2026-08-01',
        },
      ],
      Immunization: [
        {
          'Row ID': 'IMM-2',
          i_PatientRef: 'PAT-1',
          i_BranchRef: 'Cubao',
          i_NurseRef: 'N-1',
          i_VaccineRef: 'ARV_ID',
          i_VaccineType: 'Anti Rabies - PEP',
          i_VaccineRoute: 'ID',
          i_Label: 'ARV PEP - 2nd Dose',
          i_Timestamp_Actual: at,
          'i_IsAdministered?': true,
          i_TransactionRef: 'TX-1',
        },
      ],
      Transactions: [
        {
          'Row ID': 'TX-1',
          t_PatientRef: 'PAT-1',
          t_BranchRef: 'Cubao',
          t_Timestamp: at,
          t_TotalAmount: 800,
          t_TotalAmountPaid: 800,
          t_AmountPaid_Cash: 800,
        },
      ],
      Remarks: [
        {
          'Row ID': 'REM-1',
          r_PatientRef: 'PAT-1',
          r_Remarks: 'Dose 1 received at another clinic.',
        },
      ],
    }),
    trackers: [
      {
        branchLegacyId: 'Taguig',
        date: '2026-08-01',
        name: 'One, Patient',
        vaccine: 'ARV 3',
        route: 'ID',
        amount: 800,
        payment: 'Cash',
        notes: null,
        envelope: {
          source: 'manual_sales_tracker',
          workbookTitle: 'Manual Sales Tracker - Taguig',
          workbookBranchLegacyId: 'Taguig',
          sheet: 'Manual Sales',
          rowNumber: 3,
          rowHash: 'c'.repeat(64),
        },
      },
    ],
  }
}

describe('local migration rehearsal', () => {
  it('applies tracker-title branch precedence, uses transactions for finance conflicts, and preserves external D1 uncertainty', async () => {
    const result = await reconcileRehearsal(fixture())
    const trackerEvent = result.ledger.events.find((event) => event.eventId.startsWith('TRK::'))
    const externalD1 = result.ledger.events.find((event) => event.eventId.startsWith('E33::'))

    expect(trackerEvent).toMatchObject({
      kind: 'local_administration',
      branchLegacyId: 'Taguig',
      serviceId: 'ARVPEP_ID',
      doseNumber: 3,
    })
    expect(externalD1).toMatchObject({
      kind: 'external_administration',
      doseNumber: 1,
      administeredAt: null,
      datePrecision: 'unknown',
    })
    expect(
      result.report.queue.some((item) => item.code === 'TRACKER_TRANSACTION_BRANCH_CONFLICT'),
    ).toBe(true)
    expect(result.report.queue.some((item) => item.code === 'UNIQUE_INCIDENT_OVERDUE')).toBe(true)
  })

  it('keeps raw PHI and raw remarks out of the serialized report', async () => {
    const result = await reconcileRehearsal(fixture())
    const serialized = JSON.stringify(result.report)

    expect(serialized).not.toContain('Patient One')
    expect(serialized).not.toContain('another clinic')
    expect(serialized).not.toContain('PAT-1')
    expect(result.report.readyForDatabaseWrite).toBe(false)
  })

  it('makes a missing snapshot a P0 cutover blocker without preventing local analysis', async () => {
    const input = fixture()
    input.snapshots.push({
      key: 'tracker:Cubao',
      source: 'tracker',
      title: 'Manual Sales Tracker - Cubao',
      present: false,
      hashMatchesExpected: null,
    })
    const result = await reconcileRehearsal(input)

    expect(
      result.report.queue.find((item) => item.code === 'SOURCE_EXPORT_MISSING')?.priority,
    ).toBe('P0')
    expect(result.report.counts.canonicalEvents).toBeGreaterThan(0)
  })
})
