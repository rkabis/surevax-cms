/**
 * Seed section — adverse events (AEFI surveillance).
 *
 * Each row links a real administered clinical_order + encounter so the AEFI
 * detail drawer renders the implicated vaccine/dose. Severity + outcome span
 * the FDA/DOH reporting spectrum, including one serious case escalated to the
 * authority.
 *
 *   severity : Mild | Moderate | Severe | LifeThreatening | Fatal
 *   outcome  : Recovered | Recovering | NotRecovered | Fatal | Unknown
 *
 * Resolves clinical_order + encounter bigints from the maps returned by
 * seedEncounters (clinicalOrdersByKey + byKey). Rows whose order key is absent
 * (encounter chain not seeded) are soft-skipped.
 *
 * Two-tier IDs: `adverse_events.id` bigserial; `display_id` = `AVE_…`.
 */

import * as s from '../schema.js'
import { db } from './db.js'
import { daysAgo, seqSuffix } from './helpers.js'
import {
  PAT_LIM_DISPLAY_ID,
  PAT_SANTOS_DISPLAY_ID,
  PAT_REYES_DISPLAY_ID,
  PAT_NAVARRO_DISPLAY_ID,
  SVC_FLU_QUAD,
  SVC_TT,
  SVC_ARVPEP_IM,
} from './constants.js'

type Severity = 'Mild' | 'Moderate' | 'Severe' | 'LifeThreatening' | 'Fatal'
type Outcome = 'Recovered' | 'Recovering' | 'NotRecovered' | 'Fatal' | 'Unknown'

type AdverseSeed = {
  patientDisplayId: string
  /** encounter key in seedEncounters.byKey */
  encounterKey: string
  /** clinical_order lookup key: `<encKey>:<serviceId>:<doseNumber>` */
  orderKey: string
  reportedAt: Date
  onsetAt: Date
  severity: Severity
  outcome: Outcome
  description: string
  symptomsCoded: string[]
  treatmentGiven?: string
  caseNo?: string
  reportedToAuthorityAt?: Date
  authorityReferenceNumber?: string
}

const ADVERSE_ROWS: AdverseSeed[] = [
  {
    patientDisplayId: PAT_LIM_DISPLAY_ID,
    encounterKey: 'lim',
    orderKey: `lim:${SVC_FLU_QUAD}:1`,
    reportedAt: daysAgo(0, 13, 0),
    onsetAt: daysAgo(0, 11, 0),
    severity: 'Mild',
    outcome: 'Recovered',
    description: 'Soreness and low-grade fever (37.8°C) within hours of flu vaccination.',
    symptomsCoded: ['injection-site-pain', 'low-grade-fever'],
    treatmentGiven: 'Paracetamol PRN; reassurance.',
  },
  {
    patientDisplayId: PAT_SANTOS_DISPLAY_ID,
    encounterKey: 'santos',
    orderKey: `santos:${SVC_TT}:1`,
    reportedAt: daysAgo(0, 10, 30),
    onsetAt: daysAgo(0, 10, 0),
    severity: 'Moderate',
    outcome: 'Recovering',
    description: 'Localized swelling and induration (~4 cm) at the tetanus injection site.',
    symptomsCoded: ['injection-site-swelling', 'induration'],
    treatmentGiven: 'Cold compress; antihistamine; follow-up advised.',
  },
  {
    patientDisplayId: PAT_REYES_DISPLAY_ID,
    encounterKey: 'reyes',
    orderKey: `reyes:${SVC_ARVPEP_IM}:1`,
    reportedAt: daysAgo(2, 9, 45),
    onsetAt: daysAgo(2, 9, 40),
    severity: 'Mild',
    outcome: 'Recovered',
    description: 'Transient dizziness immediately post-injection, resolved after 15 min rest.',
    symptomsCoded: ['dizziness', 'vasovagal'],
    treatmentGiven: 'Supine rest, fluids; observed 30 min.',
    caseNo: 'AEFI-2026-0017',
  },
  {
    patientDisplayId: PAT_NAVARRO_DISPLAY_ID,
    encounterKey: 'navarro',
    orderKey: `navarro:${SVC_FLU_QUAD}:1`,
    reportedAt: daysAgo(1, 10, 30),
    onsetAt: daysAgo(1, 10, 15),
    severity: 'Severe',
    outcome: 'Recovering',
    description:
      'Generalized urticaria and mild wheezing ~30 min after flu vaccination; no airway compromise.',
    symptomsCoded: ['urticaria', 'wheezing', 'allergic-reaction'],
    treatmentGiven:
      'IM adrenaline standby, antihistamine + hydrocortisone given; observed 2h, stable on discharge.',
    caseNo: 'AEFI-2026-0021',
    reportedToAuthorityAt: daysAgo(1, 14, 0),
    authorityReferenceNumber: 'FDA-AEFI-2026-0042',
  },
]

export async function seedAdverseEvents(args: {
  tenantId: string
  patients: Map<string, number>
  encounters: Map<string, number>
  clinicalOrders: Map<string, number>
  reportedById: number
}): Promise<void> {
  const { tenantId, patients, encounters, clinicalOrders, reportedById } = args

  let inserted = 0
  let skipped = 0
  for (const [aeIdx, a] of ADVERSE_ROWS.entries()) {
    const patientId = patients.get(a.patientDisplayId)
    if (patientId === undefined) {
      throw new Error(`seedAdverseEvents: missing patient ${a.patientDisplayId}`)
    }
    const clinicalOrderId = clinicalOrders.get(a.orderKey) ?? null
    const encounterId = encounters.get(a.encounterKey) ?? null
    if (clinicalOrderId === null) {
      // Encounter/order chain not seeded — keep the AEFI report but unlinked.
      skipped++
    }

    const row = await db
      .insert(s.adverseEvents)
      .values({
        // Index-derived, NOT a random `displayId()` — see transactions.ts.
        displayId: `AVE_${seqSuffix(aeIdx, 8)}`,
        caseNo: a.caseNo ?? null,
        tenantId,
        patientId,
        clinicalOrderId,
        encounterId,
        lotId: null,
        reportedAt: a.reportedAt,
        reportedById,
        onsetAt: a.onsetAt,
        severity: a.severity,
        outcome: a.outcome,
        description: a.description,
        symptomsCoded: JSON.stringify(a.symptomsCoded),
        treatmentGiven: a.treatmentGiven ?? null,
        reportedToAuthorityAt: a.reportedToAuthorityAt ?? null,
        authorityReferenceNumber: a.authorityReferenceNumber ?? null,
        createdById: reportedById,
      })
      .onConflictDoNothing()
      .returning({ id: s.adverseEvents.id })

    if (row[0]) inserted++
  }

  const suffix = skipped > 0 ? ` — ${skipped} unlinked (no clinical order)` : ''
  console.log(`  ✓ adverse events (${inserted})${suffix}`)
}
