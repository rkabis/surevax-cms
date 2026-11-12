import { describe, expect, it } from 'vitest'
import { emptyEventLedger } from '../../../src/modules/data_migration/eventLedger.js'
import { applyManualAugmentations } from '../../../src/modules/data_migration/manualAugmentations.js'

const SOURCE_HASH = 'a'.repeat(64)
const options = {
  expectedFrozenSourceHash: SOURCE_HASH,
  references: {
    patientLegacyIds: new Set(['PAT-1']),
    branchLegacyIds: new Set(['Cubao']),
    serviceIds: new Set(['ARVPEP_ID']),
    patientStandingOrderLegacyIds: new Set(['PSO-1']),
  },
}

function approval(augmentationId: string) {
  return {
    augmentationId,
    disposition: 'approved' as const,
    approvedBy: 'app-owner',
    approvedAt: '2026-08-16T10:00:00+08:00',
    reasonCode: 'OWNER_APPROVED_ADDITION',
    rationale: 'Recovered from selected branch ledger and reviewed remarks.',
    match: {
      patientLegacyId: 'PAT-1',
      branchLegacyId: 'Cubao',
      rule: 'unique_multifield_match' as const,
      confidence: 'manual_verified' as const,
    },
    evidence: [
      {
        source: 'manual_sales_tracker' as const,
        fileId: 'drive-file-1',
        revisionId: 'rev-1',
        workbookTitle: 'Manual Sales Tracker - Cubao',
        workbookBranchLegacyId: 'Cubao',
        sheet: 'Manual Sales 2026',
        rowNumber: 19,
        rowHash: 'b'.repeat(64),
      },
    ],
  }
}

describe('manual migration augmentations', () => {
  it('appends approved administration and schedule facts without mutating the ledger', () => {
    const original = emptyEventLedger()
    const result = applyManualAugmentations(
      original,
      {
        schemaVersion: 1,
        runId: 'RUN-2026-08-16',
        frozenSourceHash: SOURCE_HASH,
        entries: [
          {
            ...approval('ADMIN-1'),
            kind: 'local_administration',
            serviceId: 'ARVPEP_ID',
            doseNumber: 2,
            administeredAt: '2026-08-16T09:00:00+08:00',
            route: 'ID',
          },
          {
            ...approval('SCHED-1'),
            kind: 'scheduled_dose',
            serviceId: 'ARVPEP_ID',
            doseNumber: 3,
            patientStandingOrderLegacyId: 'PSO-1',
            scheduledAt: '2026-08-20T09:00:00+08:00',
            scheduleBasis: 'template_derived',
          },
        ],
      },
      options,
    )

    expect(original.events).toEqual([])
    expect(result.ledger.events.map((event) => event.kind)).toEqual([
      'local_administration',
      'scheduled_dose',
    ])
    expect(result.appliedAugmentationIds).toEqual(['ADMIN-1', 'SCHED-1'])
    expect(result.targetBlockedEventIds).toEqual([])
  })

  it('preserves an owner-approved unknown-date external dose without fabricating a date', () => {
    const result = applyManualAugmentations(
      emptyEventLedger(),
      {
        schemaVersion: 1,
        runId: 'RUN-2026-08-16',
        frozenSourceHash: SOURCE_HASH,
        entries: [
          {
            ...approval('EXT-D1'),
            kind: 'external_administration',
            serviceId: 'ARVPEP_ID',
            doseNumber: 1,
            administeredAt: null,
            datePrecision: 'unknown',
            dateBasis: 'unknown_owner_assumption',
            match: {
              patientLegacyId: 'PAT-1',
              branchLegacyId: null,
              rule: 'remarks_checked_external_d1',
              confidence: 'owner_approved',
            },
            remarksReview: {
              checkedRemarkRowIds: ['REM-1'],
              conclusion: 'no_contradiction',
              note: 'First verified local ARV row is dose 2; no contrary remark.',
            },
          },
        ],
      },
      options,
    )

    expect(result.ledger.events[0]).toMatchObject({
      kind: 'external_administration',
      doseNumber: 1,
      administeredAt: null,
      datePrecision: 'unknown',
      dateBasis: 'unknown_owner_assumption',
    })
    expect(result.targetBlockedEventIds).toEqual([])
    expect(result.ledger.exceptions).toEqual([])
  })

  it('rejects source-pack drift, duplicates, fabricated dates, and unknown fields', () => {
    const validExternal = {
      ...approval('EXT-D1'),
      kind: 'external_administration',
      serviceId: 'ARVPEP_ID',
      doseNumber: 1,
      administeredAt: null,
      datePrecision: 'unknown',
      dateBasis: 'unknown_owner_assumption',
      match: {
        patientLegacyId: 'PAT-1',
        branchLegacyId: null,
        rule: 'remarks_checked_external_d1',
        confidence: 'owner_approved',
      },
      remarksReview: {
        checkedRemarkRowIds: [],
        conclusion: 'no_contradiction',
        note: 'Remarks table checked; no attributable rows and no contradiction.',
      },
    }
    const bundle = {
      schemaVersion: 1,
      runId: 'RUN-2026-08-16',
      frozenSourceHash: SOURCE_HASH,
      entries: [validExternal],
    }

    expect(() =>
      applyManualAugmentations(emptyEventLedger(), bundle, {
        ...options,
        expectedFrozenSourceHash: 'c'.repeat(64),
      }),
    ).toThrow(/frozenSourceHash/)
    expect(() =>
      applyManualAugmentations(
        emptyEventLedger(),
        { ...bundle, entries: [validExternal, validExternal] },
        options,
      ),
    ).toThrow(/duplicate augmentationId/)
    expect(() =>
      applyManualAugmentations(
        emptyEventLedger(),
        {
          ...bundle,
          entries: [
            {
              ...validExternal,
              administeredAt: '2026-08-01T09:00:00+08:00',
              unexpectedMutation: true,
            },
          ],
        },
        options,
      ),
    ).toThrow()
  })

  it('rejects unresolved patient, branch, service, and standing-order references', () => {
    const scheduled = {
      ...approval('SCHED-UNKNOWN'),
      kind: 'scheduled_dose',
      serviceId: 'ARVPEP_ID',
      doseNumber: 3,
      patientStandingOrderLegacyId: 'PSO-MISSING',
      scheduledAt: '2026-08-20T09:00:00+08:00',
      scheduleBasis: 'template_derived',
    }
    expect(() =>
      applyManualAugmentations(
        emptyEventLedger(),
        {
          schemaVersion: 1,
          runId: 'RUN-2026-08-16',
          frozenSourceHash: SOURCE_HASH,
          entries: [scheduled],
        },
        options,
      ),
    ).toThrow(/unknown patientStandingOrderLegacyId/)
  })
})
