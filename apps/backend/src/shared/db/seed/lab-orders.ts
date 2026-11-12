/**
 * Seed section — lab orders.
 *
 * Restored in W3.b.3 (2026-05-19) and rewired in the 2026-05-19 follow-up:
 *   - `lab_orders.id` is bigserial; `display_id` = `LBO_<8 base32>` via the
 *     `displayId('LBO')` helper.
 *   - `branch_id` is denormalized from `encounters.branch_id` via
 *     `clinical_orders` (queried per row to keep this seed simple).
 *   - `laboratory_id` is a bigint FK; resolved from the `partnerLabs` Map.
 *
 * Lookup contract:
 *   The `clinicalOrders` map keys are `<encounter_key>:<service_catalog_code>:<doseNumber>`
 *   (see `seedEncounters` `ClinicalOrderLookupKey`). E.g. `'torres:SVC_ERIG_INF:1'`.
 *   This avoids depending on display_id literals (which are seqSuffix-derived
 *   random strings constrained to `^ORD_[0-9A-HJKMNPQRSTVWXYZ]{8}$`).
 *
 * Rows that require a missing FK are soft-skipped (logged, not errored), so
 * the seed remains safe even before clinical_orders are wired up.
 */

import * as s from '../schema.js'
import { db } from './db.js'
import { eq, and } from 'drizzle-orm'
import { daysAgo, today, seqSuffix } from './helpers.js'
import {
  LAB_HIPRECISION_DISPLAY_ID,
  LAB_STLUKES_DISPLAY_ID,
  LAB_RITM_DISPLAY_ID,
  SVC_ARVPEP_IM,
  SVC_ERIG_INF,
  SVC_FLU_QUAD,
} from './constants.js'

type LabOrderSpec = {
  /**
   * Logical key for the parent clinical_order:
   * `<encounter_key>:<service_catalog_id>:<doseNumber>`.
   */
  clinicalOrderLookupKey: string
  /** Description used in seed log + comments. */
  description: string
  /** Display id of the partner laboratory. */
  laboratoryDisplayId: string | null
  status: 'Pending' | 'Sent' | 'ResultReceived' | 'Cancelled'
  sentAt: Date | null
  resultReceivedAt?: Date | null
  notes: string | null
  resultData: string | null
  /** Flag the result as critical (drives the acknowledge banner in LabOrderDetail). */
  hasCriticalValue?: boolean
}

const LAB_ORDER_SPECS: LabOrderSpec[] = [
  {
    // Torres — ERIG order → FNAT at HiPrecision
    clinicalOrderLookupKey: `torres:${SVC_ERIG_INF}:1`,
    description: 'Torres ERIG → HiPrecision FNAT',
    laboratoryDisplayId: LAB_HIPRECISION_DISPLAY_ID,
    status: 'Sent',
    sentAt: today(10, 30),
    notes: 'FNAT requested. Animal confirmed rabid per barangay report. Expedite.',
    resultData: null,
  },
  {
    // Luna — D1 order → FNAT at RITM. Flagged critical so the Wave 11
    // critical-value acknowledge flow has a row to operate on.
    clinicalOrderLookupKey: `luna:${SVC_ARVPEP_IM}:1`,
    description: 'Luna D1 → RITM FNAT (critical)',
    laboratoryDisplayId: LAB_RITM_DISPLAY_ID,
    status: 'ResultReceived',
    sentAt: daysAgo(10, 9, 30),
    resultReceivedAt: daysAgo(7, 14, 0),
    notes: 'FNAT confirmatory for rabies exposure. Critical: titer below protective threshold.',
    resultData: JSON.stringify({
      testName: 'Fluorescent Antibody Neutralization Test',
      result: 'Negative (adequate immunity not yet achieved — continue PEP)',
      titerValue: '<0.5 IU/mL',
      referenceRange: '≥0.5 IU/mL considered protective',
      performedBy: 'RITM Rabies Unit',
      reviewedBy: 'Dr. Maria Santos',
      criticalFlag: true,
    }),
    hasCriticalValue: true,
  },
  {
    // Aguilar — D1 order → Wound culture at HiPrecision
    clinicalOrderLookupKey: `aguilar:${SVC_ARVPEP_IM}:1`,
    description: 'Aguilar D1 → HiPrecision wound culture',
    laboratoryDisplayId: LAB_HIPRECISION_DISPLAY_ID,
    status: 'ResultReceived',
    sentAt: daysAgo(5, 9, 0),
    resultReceivedAt: daysAgo(4, 16, 0),
    notes: 'Wound culture ordered. Clean wound noted on follow-up.',
    resultData: JSON.stringify({
      testName: 'Wound Culture & Sensitivity',
      result: 'No growth after 48 hours',
      performedBy: 'HiPrecision Diagnostics Lab',
    }),
  },
  {
    // Herrera — D1 order → FNAT at St. Luke's (pending send)
    clinicalOrderLookupKey: `herrera:${SVC_ARVPEP_IM}:1`,
    description: "Herrera D1 → St. Luke's FNAT (pending)",
    laboratoryDisplayId: LAB_STLUKES_DISPLAY_ID,
    status: 'Pending',
    sentAt: null,
    notes: 'FNAT to be sent if animal not captured within 10 days.',
    resultData: null,
  },
  {
    // Ocampo — Flu order → CBC at HiPrecision (cancelled)
    clinicalOrderLookupKey: `ocampo:${SVC_FLU_QUAD}:1`,
    description: 'Ocampo Flu → HiPrecision CBC (cancelled)',
    laboratoryDisplayId: LAB_HIPRECISION_DISPLAY_ID,
    status: 'Cancelled',
    sentAt: null,
    notes:
      'Pre-flu CBC ordered but cancelled — physician determined not required for this patient.',
    resultData: null,
  },
]

export async function seedLabOrders(opts: {
  tenantId: string
  branchId: number
  createdById: number
  /**
   * Map<lookupKey, clinical_order bigint PK> from `seedEncounters`. Lookup keys
   * are `<encounter_key>:<service_catalog_id>:<doseNumber>`. Skip rows when
   * the parent clinical_order is absent.
   */
  encounters?: Map<string, number>
  /** Map<lab.display_id, bigint PK> from seedPartnerLabs */
  partnerLabs?: Map<string, number>
}): Promise<void> {
  const { tenantId, branchId, createdById, encounters, partnerLabs } = opts

  if (!encounters || encounters.size === 0) {
    console.log('  ↷ lab orders (skipped — clinical orders not yet seeded)')
    return
  }

  let inserted = 0
  let skipped = 0

  for (const [loIdx, spec] of LAB_ORDER_SPECS.entries()) {
    const clinicalOrderId = encounters.get(spec.clinicalOrderLookupKey)
    if (!clinicalOrderId) {
      skipped++
      continue
    }

    // Resolve branch_id for this clinical_order via its encounter.
    const [co] = await db
      .select({ encounterId: s.clinicalOrders.encounterId })
      .from(s.clinicalOrders)
      .where(and(eq(s.clinicalOrders.tenantId, tenantId), eq(s.clinicalOrders.id, clinicalOrderId)))
      .limit(1)

    const encBranchId = co?.encounterId
      ? await db
          .select({ branchId: s.encounters.branchId })
          .from(s.encounters)
          .where(eq(s.encounters.id, co.encounterId))
          .limit(1)
          .then((rows) => rows[0]?.branchId ?? null)
      : null

    const resolvedBranchId = encBranchId ?? branchId

    const laboratoryId = spec.laboratoryDisplayId
      ? (partnerLabs?.get(spec.laboratoryDisplayId) ?? null)
      : null

    await db
      .insert(s.labOrders)
      .values({
        // Index-derived, NOT a random `displayId()`: a random id never collides,
        // so `onConflictDoNothing` never skipped and each `pnpm db:seed` re-run
        // inserted another full copy. See transactions.ts for the same fix.
        displayId: `LBO_${seqSuffix(loIdx, 8)}`,
        tenantId,
        clinicalOrderId,
        branchId: resolvedBranchId,
        laboratoryId,
        status: spec.status,
        sentAt: spec.sentAt,
        resultReceivedAt: spec.resultReceivedAt ?? null,
        notes: spec.notes,
        resultData: spec.resultData,
        hasCriticalValue: spec.hasCriticalValue ?? false,
        createdById,
      })
      .onConflictDoNothing()

    inserted++
  }

  console.log(`  ✓ lab orders (${inserted} inserted, ${skipped} skipped — missing clinical orders)`)
}
