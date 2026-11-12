import { describe, expect, it } from 'vitest'
import {
  classifyAnimalDeathRemark,
  classifyPendingAnimalFollowup,
  classifyRemark,
  decideExternalDoseOne,
  trackerRemarkNegatesAdministration,
} from '../../../src/modules/data_migration/remarkSemantics.js'

describe('owner-approved remark semantics', () => {
  it.each([
    ['Dose 1 at another hospital', 'explicit_external_administration'],
    ['No prior ARV received', 'contradicts_prior_dose'],
    ['Refused ARV injection', 'refused'],
    ['ARV dose cancelled', 'cancelled'],
    ['Dose not yet administered', 'not_administered'],
    ['Deposit for ARV only', 'purchase_or_future_only'],
    ['Tolerated well', 'neutral'],
  ])('classifies %s', (remark, expected) => {
    expect(classifyRemark(remark)).toBe(expected)
  })

  it('lets contrary tracker remarks override the normal administration default', () => {
    expect(trackerRemarkNegatesAdministration('for next visit')).toBe(true)
    expect(trackerRemarkNegatesAdministration('administered and tolerated')).toBe(false)
  })

  it('uses explicit external evidence before the owner assumption', () => {
    expect(decideExternalDoseOne(2, ['First dose at hospital'])).toEqual({
      action: 'create_external_dose_1',
      basis: 'explicit_remark',
    })
    expect(decideExternalDoseOne(2, ['Tolerated well'])).toEqual({
      action: 'create_external_dose_1',
      basis: 'owner_assumption',
    })
  })

  it('routes a contradiction to P1 and does not infer a dose', () => {
    expect(decideExternalDoseOne(2, ['No prior anti-rabies dose'])).toEqual({
      action: 'manual_review',
      priority: 'P1',
      reason: 'contradictory_remark',
    })
  })

  it('does nothing when the first local dose is dose 1 or unknown', () => {
    expect(decideExternalDoseOne(1, [])).toMatchObject({ action: 'none' })
    expect(decideExternalDoseOne(null, [])).toMatchObject({ action: 'none' })
  })

  it.each([
    ['stray cat died last 07/30 (nasagasaan ng kotse)', 'died_accidentally'],
    ['Dog was killed and sent for FAT testing', 'killed_for_testing'],
    ['Pet dog died naturally on day 10', 'died_naturally'],
    ['The biting dog died', 'death_confirmed_unspecified'],
    ['ERIG (-) Skin Test', 'none'],
    ['Negative ATS skin test', 'none'],
  ])(
    'classifies animal-death evidence without confusing treatment tests: %s',
    (remark, expected) => {
      expect(classifyAnimalDeathRemark(remark)).toBe(expected)
    },
  )

  it('computes a Pending Day-14 follow-up across a month boundary', () => {
    expect(
      classifyPendingAnimalFollowup({
        humanFirstArvDate: '2026-07-31',
        cutoffDate: '2026-08-14',
        incidentAnchor: 'unique',
      }),
    ).toEqual({
      sourceOutcome: 'Pending',
      timing: 'overdue',
      dueDate: '2026-08-14',
      queuePriority: 'P3',
      migrationAction: 'retain_pending_followup',
      treatmentAction: 'continue_pep',
      reason: 'unique_incident_overdue',
    })
  })

  it('keeps a not-yet-due Pending follow-up out of the manual queue', () => {
    expect(
      classifyPendingAnimalFollowup({
        humanFirstArvDate: '2026-08-10',
        cutoffDate: '2026-08-17',
        incidentAnchor: 'unique',
      }),
    ).toMatchObject({
      timing: 'not_yet_due',
      dueDate: '2026-08-24',
      queuePriority: null,
      migrationAction: 'retain_pending_followup',
      treatmentAction: 'continue_pep',
    })
  })

  it('routes an ambiguous incident to P1 without changing treatment', () => {
    expect(
      classifyPendingAnimalFollowup({
        humanFirstArvDate: '2026-08-01',
        cutoffDate: '2026-08-17',
        incidentAnchor: 'ambiguous',
      }),
    ).toMatchObject({
      timing: 'overdue',
      queuePriority: 'P1',
      migrationAction: 'preserve_raw_pending',
      treatmentAction: 'continue_pep',
      reason: 'incident_ambiguous',
    })
  })

  it('preserves raw Pending when the first ARV date is absent or invalid', () => {
    for (const humanFirstArvDate of [null, '2026-02-30']) {
      expect(
        classifyPendingAnimalFollowup({
          humanFirstArvDate,
          cutoffDate: '2026-08-17',
          incidentAnchor: 'unique',
        }),
      ).toMatchObject({
        timing: 'date_unknown',
        dueDate: null,
        queuePriority: 'P3',
        migrationAction: 'preserve_raw_pending',
        treatmentAction: 'continue_pep',
        reason: 'first_arv_date_missing_or_invalid',
      })
    }
  })

  it('fails closed on an invalid cutover date', () => {
    expect(() =>
      classifyPendingAnimalFollowup({
        humanFirstArvDate: '2026-08-01',
        cutoffDate: '2026-13-01',
        incidentAnchor: 'unique',
      }),
    ).toThrow('cutoffDate must be a real YYYY-MM-DD date')
  })
})
