import { describe, it, expect } from 'vitest'
import { transformClinicalOrders } from '../../../src/modules/data_migration/transform/clinicalOrders.js'

const svcMap = new Map<string, string>([['ARVPEP_AbhayrabID', 'ARVPEP_ID']])
const typeMap = new Map<string, string>([['ARVPEP_AbhayrabID', 'Anti Rabies - PEP']])

const past = new Date('2024-07-29T12:00:00Z')
const future = new Date('2027-12-31T00:00:00Z')
const ahead90 = new Date('2025-08-15T00:00:00Z')

describe('transformClinicalOrders — status mapping', () => {
  it('completed dose → status=Completed', () => {
    const { clinicalOrders } = transformClinicalOrders(
      [
        {
          'Row ID': 'I1',
          i_PatientRef: 'PAT-A',
          i_BranchRef: 'HolySpirit',
          i_VaccineRef: 'ARVPEP_AbhayrabID',
          i_VaccineRoute: 'ID',
          i_Timestamp_Actual: past,
          i_Timestamp_Ideal: past,
          'i_IsAdministered?': true,
          i_NurseRef: 'NurseA',
          i_DosageCount: '1',
        },
      ],
      'SVX',
      svcMap,
      typeMap,
      new Set(),
    )
    expect(clinicalOrders[0]!.status).toBe('Completed')
  })

  it('future scheduled dose → status=Scheduled', () => {
    const { clinicalOrders } = transformClinicalOrders(
      [
        {
          'Row ID': 'I2',
          i_PatientRef: 'PAT-A',
          i_BranchRef: 'HolySpirit',
          i_VaccineRef: 'ARVPEP_AbhayrabID',
          i_Timestamp_Ideal: ahead90,
          'i_IsAdministered?': false,
        },
      ],
      'SVX',
      svcMap,
      typeMap,
      new Set(),
    )
    expect(clinicalOrders[0]!.status).toBe('Scheduled')
  })

  it('past-not-administered → status=Cancelled', () => {
    const { clinicalOrders } = transformClinicalOrders(
      [
        {
          'Row ID': 'I3',
          i_PatientRef: 'PAT-A',
          i_BranchRef: 'HolySpirit',
          i_VaccineRef: 'ARVPEP_AbhayrabID',
          i_Timestamp_Ideal: past,
          'i_IsAdministered?': false,
        },
      ],
      'SVX',
      svcMap,
      typeMap,
      new Set(),
    )
    expect(clinicalOrders[0]!.status).toBe('Cancelled')
  })

  it('clamps typo future dates beyond 2y past export', () => {
    const { clinicalOrders, warnings } = transformClinicalOrders(
      [
        {
          'Row ID': 'I4',
          i_PatientRef: 'PAT-A',
          i_BranchRef: 'HolySpirit',
          i_VaccineRef: 'ARVPEP_AbhayrabID',
          i_Timestamp_Ideal: future,
          'i_IsAdministered?': false,
        },
      ],
      'SVX',
      svcMap,
      typeMap,
      new Set(),
    )
    expect(warnings.length).toBeGreaterThanOrEqual(1)
    expect(warnings[0]!.msg).toMatch(/clamped/)
    expect(clinicalOrders[0]!.originalScheduledDate!.getFullYear()).toBeLessThan(2027)
    expect(clinicalOrders[0]!.currentScheduledDate).toEqual(
      clinicalOrders[0]!.originalScheduledDate,
    )
  })

  it('admin-no-txn (Bot 12 race) → Completed + indication=paymentReconciliationRequired', () => {
    const { clinicalOrders } = transformClinicalOrders(
      [
        {
          'Row ID': 'I5',
          i_PatientRef: 'PAT-A',
          i_BranchRef: 'HolySpirit',
          i_VaccineRef: 'ARVPEP_AbhayrabID',
          i_Timestamp_Actual: past,
          'i_IsAdministered?': true,
          i_NurseRef: 'NurseA',
        },
      ],
      'SVX',
      svcMap,
      typeMap,
      new Set(),
    )
    expect(clinicalOrders[0]!.status).toBe('Completed')
    expect(clinicalOrders[0]!.indication).toBe('paymentReconciliationRequired')
  })

  it('historical-import (AppSheetAdmin + Migration) → administeredAtExternalClinic=true', () => {
    const { clinicalOrders } = transformClinicalOrders(
      [
        {
          'Row ID': 'I6',
          i_PatientRef: 'PAT-A',
          i_BranchRef: 'HolySpirit',
          i_VaccineRef: 'ARVPEP_AbhayrabID',
          i_Timestamp_Actual: past,
          'i_IsAdministered?': true,
          i_NurseRef: 'AppSheetAdmin',
          i_DosagePrice: 'Migration',
        },
      ],
      'SVX',
      svcMap,
      typeMap,
      new Set(),
    )
    expect(clinicalOrders[0]!.administeredAtExternalClinic).toBe(true)
    expect(clinicalOrders[0]!.indication).toBe('historicalImport')
  })
})

describe('transformClinicalOrders — PSO course synthesis', () => {
  it('groups consecutive ARV-PEP doses (within 60d) into one PSO', () => {
    const ds = [
      new Date('2024-07-29T12:00:00Z'),
      new Date('2024-08-01T12:00:00Z'),
      new Date('2024-08-05T12:00:00Z'),
      new Date('2024-08-12T12:00:00Z'),
    ]
    const { patientStandingOrders, clinicalOrders } = transformClinicalOrders(
      ds.map((d, i) => ({
        'Row ID': `I${i}`,
        i_PatientRef: 'PAT-A',
        i_BranchRef: 'HolySpirit',
        i_VaccineRef: 'ARVPEP_AbhayrabID',
        i_VaccineRoute: 'ID',
        i_Timestamp_Actual: d,
        i_Timestamp_Ideal: d,
        'i_IsAdministered?': true,
        i_NurseRef: 'NurseA',
        i_TransactionRef: 'TXN-A',
      })),
      'SVX',
      svcMap,
      typeMap,
      new Set(['I0', 'I1', 'I2', 'I3']),
    )
    expect(patientStandingOrders).toHaveLength(1)
    expect(patientStandingOrders[0]!.templateId).toBe('SOT-RABIES-PEP-ID')
    expect(patientStandingOrders[0]!.status).toBe('Completed')
    expect(clinicalOrders.every((o) => o.patientStandingOrderLegacyId !== null)).toBe(true)
    expect(clinicalOrders.every((o) => o.orderType === 'Standing_Order')).toBe(true)
  })

  it('splits multi-bite patients into separate PSO instances on 60d+ gap', () => {
    const { patientStandingOrders } = transformClinicalOrders(
      [
        {
          'Row ID': 'A0',
          i_PatientRef: 'PAT-A',
          i_BranchRef: 'HolySpirit',
          i_VaccineRef: 'ARVPEP_AbhayrabID',
          i_VaccineRoute: 'ID',
          i_Timestamp_Actual: new Date('2024-07-29T12:00:00Z'),
          i_Timestamp_Ideal: new Date('2024-07-29T12:00:00Z'),
          'i_IsAdministered?': true,
          i_TransactionRef: 'TXN',
        },
        {
          'Row ID': 'A1',
          i_PatientRef: 'PAT-A',
          i_BranchRef: 'HolySpirit',
          i_VaccineRef: 'ARVPEP_AbhayrabID',
          i_VaccineRoute: 'ID',
          i_Timestamp_Actual: new Date('2024-08-12T12:00:00Z'),
          i_Timestamp_Ideal: new Date('2024-08-12T12:00:00Z'),
          'i_IsAdministered?': true,
          i_TransactionRef: 'TXN',
        },
        {
          'Row ID': 'B0',
          i_PatientRef: 'PAT-A',
          i_BranchRef: 'HolySpirit',
          i_VaccineRef: 'ARVPEP_AbhayrabID',
          i_VaccineRoute: 'IM',
          i_Timestamp_Actual: new Date('2025-01-15T12:00:00Z'),
          i_Timestamp_Ideal: new Date('2025-01-15T12:00:00Z'),
          'i_IsAdministered?': true,
          i_TransactionRef: 'TXN',
        },
        {
          'Row ID': 'B1',
          i_PatientRef: 'PAT-A',
          i_BranchRef: 'HolySpirit',
          i_VaccineRef: 'ARVPEP_AbhayrabID',
          i_VaccineRoute: 'IM',
          i_Timestamp_Actual: new Date('2025-02-15T12:00:00Z'),
          i_Timestamp_Ideal: new Date('2025-02-15T12:00:00Z'),
          'i_IsAdministered?': true,
          i_TransactionRef: 'TXN',
        },
      ],
      'SVX',
      svcMap,
      typeMap,
      new Set(['A0', 'A1', 'B0', 'B1']),
    )
    expect(patientStandingOrders).toHaveLength(2)
    expect(patientStandingOrders.map((p) => p.templateId).sort()).toEqual([
      'SOT-RABIES-PEP-ID',
      'SOT-RABIES-PEP-IM',
    ])
  })
})
