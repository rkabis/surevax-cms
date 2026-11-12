import { describe, expect, it } from 'vitest'
import {
  projectCanonicalClinicalHistory,
  type ClinicalProjectionInput,
} from '../../../src/modules/data_migration/canonicalClinicalProjection.js'
import type { CanonicalEventLedger } from '../../../src/modules/data_migration/eventLedger.js'
import type { SourceEnvelope } from '../../../src/modules/data_migration/sourceEnvelope.js'

const evidence: SourceEnvelope = {
  source: 'appsheet_immunization',
  fileId: 'appsheet-freeze',
  sheet: 'Immunization',
  rowId: 'source-row',
}

const idFactory: ClinicalProjectionInput['idFactory'] = (kind, stableKey) =>
  `${kind}_${stableKey
    .replaceAll(/[^A-Za-z0-9]/g, '')
    .slice(-8)
    .padStart(8, '0')}`

function input(
  events: CanonicalEventLedger['events'],
  options: Partial<
    Omit<ClinicalProjectionInput, 'tenantId' | 'ledger' | 'courses' | 'idFactory'>
  > = {},
): ClinicalProjectionInput {
  return {
    tenantId: 'SVX',
    ledger: { events, exceptions: [] },
    evaluatedAt: new Date('2026-08-01T00:00:00+08:00'),
    idFactory,
    ...options,
    courses: [
      {
        courseId: 'PEP-1',
        patientLegacyId: 'PAT-1',
        templateId: 'SOT_RABIES_PEP_ID',
        initiatingEncounterLegacyId: 'ENC-1',
        planningAnchor: { at: '2026-06-01T09:00:00+08:00', basis: 'source_ideal' },
        route: 'ID',
        indication: 'Post-Exposure Prophylaxis',
        eventIds: events.map((event) => event.eventId),
      },
    ],
  }
}

describe('projectCanonicalClinicalHistory', () => {
  it('projects local, exact external, and unknown-date external facts without fabricating the external date', () => {
    const result = projectCanonicalClinicalHistory(
      input([
        {
          eventId: 'LOCAL-2',
          kind: 'local_administration',
          patientLegacyId: 'PAT-1',
          branchLegacyId: 'Cubao',
          serviceId: 'ARVPEP_ID',
          doseNumber: 2,
          confidence: 'deterministic',
          evidence: [{ ...evidence, rowId: 'local-2' }],
          administeredAt: '2026-06-04T09:00:00+08:00',
          route: 'ID',
          site: 'Left deltoid',
        },
        {
          eventId: 'EXTERNAL-1-UNKNOWN',
          kind: 'external_administration',
          patientLegacyId: 'PAT-1',
          branchLegacyId: null,
          serviceId: 'ARVPEP_ID',
          doseNumber: 1,
          confidence: 'owner_approved',
          evidence: [{ ...evidence, source: 'owner_decision', rowId: 'E33' }],
          administeredAt: null,
          datePrecision: 'unknown',
          dateBasis: 'unknown_owner_assumption',
        },
        {
          eventId: 'EXTERNAL-3-EXACT',
          kind: 'external_administration',
          patientLegacyId: 'PAT-1',
          branchLegacyId: null,
          serviceId: 'ARVPEP_ID',
          doseNumber: 3,
          confidence: 'manual_verified',
          evidence: [{ ...evidence, source: 'appsheet_remark', rowId: 'remark-3' }],
          administeredAt: '2026-06-08T10:00:00+08:00',
          datePrecision: 'exact',
          dateBasis: 'explicit_source_date',
          externalClinicName: 'Other clinic',
        },
      ]),
    )

    expect(result.blocks).toEqual([])
    expect(result.patientStandingOrders).toHaveLength(1)
    expect(result.patientStandingOrders[0]!.target.status).toBe('Active')
    expect(result.clinicalOrders.map((order) => order.target.status)).toEqual([
      'Completed',
      'Completed',
      'Completed',
    ])
    const externalUnknown = result.clinicalOrders.find((order) => order.target.doseNumber === 1)!
    expect(externalUnknown.target).toMatchObject({
      completedAt: null,
      completedAtUnknown: true,
      administeredAtExternalClinic: true,
    })
    expect(externalUnknown.provenance.statusDerivation).toBe('external_administration_unknown_date')
    expect(externalUnknown.provenance.planningAnchor).toEqual({
      at: '2026-06-01T09:00:00+08:00',
      basis: 'source_ideal',
    })
  })

  it('does not mark a planned slot missed until the start of Manila Day 31, then records E43 provenance', () => {
    const events: CanonicalEventLedger['events'] = [
      {
        eventId: 'SCHEDULED-2',
        kind: 'scheduled_dose',
        patientLegacyId: 'PAT-1',
        branchLegacyId: 'Cubao',
        serviceId: 'ARVPEP_ID',
        doseNumber: 2,
        confidence: 'deterministic',
        evidence: [{ ...evidence, rowId: 'scheduled-2' }],
        patientStandingOrderLegacyId: 'LEGACY-PSO-1',
        scheduledAt: '2026-06-01T09:00:00+08:00',
        scheduleBasis: 'source_explicit',
      },
    ]
    const guards = new Map([['SCHEDULED-2', { scheduledEventId: 'SCHEDULED-2' }]])

    const day30 = projectCanonicalClinicalHistory(
      input(events, { evaluatedAt: new Date('2026-07-01T00:00:00+08:00'), missedGuards: guards }),
    )
    expect(day30.clinicalOrders[0]!.target.status).toBe('Scheduled')

    const day31 = projectCanonicalClinicalHistory(
      input(events, { evaluatedAt: new Date('2026-07-02T00:00:00+08:00'), missedGuards: guards }),
    )
    expect(day31.clinicalOrders[0]!.target.status).toBe('Missed')
    expect(day31.clinicalOrders[0]!.target.status).not.toBe('Cancelled')
    expect(day31.clinicalOrders[0]!.provenance.missedEvaluation).toMatchObject({
      reason: 'AUTO_MISSED_30_DAYS_NO_EVIDENCE',
      fullManilaDaysElapsed: 31,
      scheduledDate: '2026-06-01',
    })

    // A later credible outside-clinic fact supersedes the operational state on
    // the next projection; it is not treated as a cancelled/restarted course.
    const corrected = projectCanonicalClinicalHistory(
      input(
        [
          ...events,
          {
            eventId: 'EXTERNAL-2-LATER',
            kind: 'external_administration',
            patientLegacyId: 'PAT-1',
            branchLegacyId: null,
            serviceId: 'ARVPEP_ID',
            doseNumber: 2,
            confidence: 'manual_verified',
            evidence: [{ ...evidence, source: 'appsheet_remark', rowId: 'later-external-2' }],
            administeredAt: '2026-06-10T11:00:00+08:00',
            datePrecision: 'exact',
            dateBasis: 'explicit_source_date',
          },
        ],
        { evaluatedAt: new Date('2026-07-02T00:00:00+08:00'), missedGuards: guards },
      ),
    )
    expect(corrected.clinicalOrders[0]!.target).toMatchObject({
      status: 'Completed',
      completedAtUnknown: false,
      administeredAtExternalClinic: true,
    })
    expect(corrected.clinicalOrders[0]!.provenance.missedEvaluation).toBeUndefined()
  })

  it('keeps an old scheduled slot live when later-dose sequencing is ambiguous and does not synthesize the interior gap', () => {
    const result = projectCanonicalClinicalHistory(
      input(
        [
          {
            eventId: 'SCHEDULED-1',
            kind: 'scheduled_dose',
            patientLegacyId: 'PAT-1',
            branchLegacyId: 'Cubao',
            serviceId: 'ARVPEP_ID',
            doseNumber: 1,
            confidence: 'deterministic',
            evidence: [{ ...evidence, rowId: 'scheduled-1' }],
            patientStandingOrderLegacyId: 'LEGACY-PSO-1',
            scheduledAt: '2026-06-01T09:00:00+08:00',
            scheduleBasis: 'source_explicit',
          },
          {
            eventId: 'LOCAL-3',
            kind: 'local_administration',
            patientLegacyId: 'PAT-1',
            branchLegacyId: 'Cubao',
            serviceId: 'ARVPEP_ID',
            doseNumber: 3,
            confidence: 'deterministic',
            evidence: [{ ...evidence, rowId: 'local-3' }],
            administeredAt: '2026-06-08T09:00:00+08:00',
          },
        ],
        {
          missedGuards: new Map([
            ['SCHEDULED-1', { scheduledEventId: 'SCHEDULED-1', hasLaterDoseAmbiguity: true }],
          ]),
        },
      ),
    )

    expect(result.clinicalOrders.map((order) => order.target.doseNumber)).toEqual([1, 3])
    expect(result.clinicalOrders[0]!.target.status).toBe('Scheduled')
    expect(result.blocks).toContainEqual(
      expect.objectContaining({ code: 'E43_GUARD_BLOCKED', eventIds: ['SCHEDULED-1'] }),
    )
  })

  it('withholds duplicate planned evidence for one logical dose instead of choosing a row', () => {
    const result = projectCanonicalClinicalHistory(
      input([
        {
          eventId: 'SCHEDULED-2-A',
          kind: 'scheduled_dose',
          patientLegacyId: 'PAT-1',
          branchLegacyId: 'Cubao',
          serviceId: 'ARVPEP_ID',
          doseNumber: 2,
          confidence: 'deterministic',
          evidence: [{ ...evidence, rowId: 'scheduled-2a' }],
          patientStandingOrderLegacyId: 'LEGACY-PSO-1',
          scheduledAt: '2026-06-04T09:00:00+08:00',
          scheduleBasis: 'source_explicit',
        },
        {
          eventId: 'SCHEDULED-2-B',
          kind: 'scheduled_dose',
          patientLegacyId: 'PAT-1',
          branchLegacyId: 'Cubao',
          serviceId: 'ARVPEP_ID',
          doseNumber: 2,
          confidence: 'deterministic',
          evidence: [{ ...evidence, rowId: 'scheduled-2b' }],
          patientStandingOrderLegacyId: 'LEGACY-PSO-1',
          scheduledAt: '2026-06-04T09:00:00+08:00',
          scheduleBasis: 'source_explicit',
        },
      ]),
    )

    expect(result.clinicalOrders).toEqual([])
    expect(result.patientStandingOrders).toEqual([])
    expect(result.blocks).toContainEqual(
      expect.objectContaining({
        code: 'DUPLICATE_SCHEDULE_EVIDENCE',
        eventIds: ['SCHEDULED-2-A', 'SCHEDULED-2-B'],
      }),
    )
  })
})
