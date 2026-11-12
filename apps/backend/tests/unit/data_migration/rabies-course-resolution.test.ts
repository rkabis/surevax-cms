import { describe, expect, it } from 'vitest'

import { resolveRabiesClinicalCourses } from '../../../src/modules/data_migration/resolveRabiesClinicalCourses.js'
import type { SourceBundle } from '../../../src/modules/data_migration/types.js'

function source(): SourceBundle {
  return {
    Patient: [],
    Transactions: [],
    Remarks: [],
    Vaccine: [],
    Branch: [],
    Nurse: [],
    BranchReport: [],
    ImmunizationBundle: [],
    InventoryLog: [],
    CashBalanceLog: [],
    AdminEmails: [],
    Discount: [],
    TimeLog: [],
    NurseShift: [],
    ChargeAccounts: [],
    Immunization: [
      {
        'Row ID': 'D1',
        i_PatientRef: 'PAT',
        i_BranchRef: 'Cubao',
        i_VaccineType: 'Anti Rabies - PEP',
        i_VaccineRoute: 'IM',
        i_DosageCount: 1,
        i_Timestamp_Actual: '2026-01-01T08:00:00+08:00',
        'i_IsAdministered?': true,
      },
      {
        'Row ID': 'D2',
        i_PatientRef: 'PAT',
        i_BranchRef: 'Cubao',
        i_VaccineType: 'Anti Rabies - PEP',
        i_VaccineRoute: 'IM',
        i_DosageCount: 2,
        i_Timestamp_Ideal: '2026-01-04T08:00:00+08:00',
        'i_IsAdministered?': false,
      },
    ],
  }
}

describe('resolveRabiesClinicalCourses', () => {
  it('keeps explicit plans and derives only trailing regimen slots', () => {
    const result = resolveRabiesClinicalCourses({
      source: source(),
      ledger: {
        events: [
          {
            eventId: 'IMM::D1',
            kind: 'local_administration',
            patientLegacyId: 'PAT',
            branchLegacyId: 'Cubao',
            serviceId: 'ARVPEP_IM',
            doseNumber: 1,
            confidence: 'deterministic',
            evidence: [{ source: 'appsheet_immunization', rowId: 'D1' }],
            administeredAt: '2026-01-01T08:00:00+08:00',
            route: 'IM',
          },
        ],
        exceptions: [],
      },
      existingEncounterLegacyIds: new Set(['PAT::Cubao::2026-01-01']),
      cutoffAt: new Date('2026-02-20T23:59:59+08:00'),
    })

    expect(result.courses).toHaveLength(1)
    expect(result.counts).toMatchObject({
      explicitScheduled: 1,
      templateDerivedScheduled: 3,
      interiorGapsWithheld: 0,
    })
    expect(result.courses[0]!.eventIds).toHaveLength(5)
    expect(result.ledger.events.filter((event) => event.kind === 'scheduled_dose')).toHaveLength(4)
  })

  it('flags an interior gap and never creates its missing slot', () => {
    const input = source()
    input.Immunization[1] = {
      ...input.Immunization[1]!,
      'Row ID': 'D3',
      i_DosageCount: 3,
      i_Timestamp_Actual: '2026-01-08T08:00:00+08:00',
      i_Timestamp_Ideal: null,
      'i_IsAdministered?': true,
    }
    const result = resolveRabiesClinicalCourses({
      source: input,
      ledger: {
        events: ['D1', 'D3'].map((rowId, index) => ({
          eventId: `IMM::${rowId}`,
          kind: 'local_administration' as const,
          patientLegacyId: 'PAT',
          branchLegacyId: 'Cubao',
          serviceId: 'ARVPEP_IM',
          doseNumber: index === 0 ? 1 : 3,
          confidence: 'deterministic' as const,
          evidence: [{ source: 'appsheet_immunization' as const, rowId }],
          administeredAt: index === 0 ? '2026-01-01T08:00:00+08:00' : '2026-01-08T08:00:00+08:00',
          route: 'IM' as const,
        })),
        exceptions: [],
      },
      existingEncounterLegacyIds: new Set(['PAT::Cubao::2026-01-01']),
      cutoffAt: new Date('2026-02-20T23:59:59+08:00'),
    })
    expect(result.counts.interiorGapsWithheld).toBe(1)
    expect(result.counts.templateDerivedScheduled).toBe(0)
    expect(result.blocks.some((block) => block.code === 'RABIES_INTERIOR_GAP')).toBe(true)
  })
})
