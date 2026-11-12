/**
 * Seed section — appointments (the scheduling / "next week" surface).
 *
 * Dates are RELATIVE to the seed run (via daysAgo/today/daysFromNow), so the
 * appointment calendar always has activity centred on "today" plus the coming
 * week. Status coverage spans the full lifecycle:
 *   Scheduled · Confirmed · CheckedIn · InProgress · Completed · Cancelled · NoShow
 *
 * Provider double-booking guard: `appointments_provider_no_overlap` is an
 * EXCLUDE constraint on (provider_id, during) WHERE status NOT IN
 * ('Cancelled','NoShow'). Same-provider active rows therefore MUST NOT overlap
 * in time — every same-day slot below uses a distinct hour.
 *
 * Two-tier IDs: `appointments.id` bigserial; `display_id` = `APT_<8 base32>`.
 */

import * as s from '../schema.js'
import { db } from './db.js'
import { daysAgo, today, daysFromNow, seqSuffix } from './helpers.js'
import {
  PAT_DELACRUZ_DISPLAY_ID,
  PAT_TORRES_DISPLAY_ID,
  PAT_LIM_DISPLAY_ID,
  PAT_GARCIA_DISPLAY_ID,
  PAT_REYES_DISPLAY_ID,
  PAT_MENDOZA_DISPLAY_ID,
  PAT_CRUZ_DISPLAY_ID,
  PAT_AGUILAR_DISPLAY_ID,
  PAT_HERRERA_DISPLAY_ID,
  PAT_JAVIER_DISPLAY_ID,
  PAT_NAVARRO_DISPLAY_ID,
  PAT_LUNA_DISPLAY_ID,
  PAT_OCAMPO_DISPLAY_ID,
  PAT_BAUTISTA_DISPLAY_ID,
  PAT_SANTOS_DISPLAY_ID,
  PAT_FERNANDEZ_DISPLAY_ID,
  PAT_GONZALES_DISPLAY_ID,
} from './constants.js'

type ApptStatus =
  | 'Scheduled'
  | 'Confirmed'
  | 'CheckedIn'
  | 'InProgress'
  | 'Completed'
  | 'Cancelled'
  | 'NoShow'

type ApptType = 'Consultation' | 'Vaccination' | 'LabDraw' | 'Procedure' | 'FollowUp'

type ApptSeed = {
  patientDisplayId: string
  type: ApptType
  status: ApptStatus
  start: Date
  /** Slot length in minutes (end = start + durationMin). */
  durationMin: number
  reason: string
  /** Pass false for walk-ins / no fixed provider (skips the overlap guard). */
  withProvider?: boolean
}

const SLOT = 30

const APPOINTMENT_ROWS: ApptSeed[] = [
  // ── Today — the live clinic board ─────────────────────────────────────────
  {
    patientDisplayId: PAT_DELACRUZ_DISPLAY_ID,
    type: 'Vaccination',
    status: 'CheckedIn',
    start: today(9, 0),
    durationMin: SLOT,
    reason: 'Rabies PEP — Day 0 (dog bite, right hand)',
  },
  {
    patientDisplayId: PAT_TORRES_DISPLAY_ID,
    type: 'Vaccination',
    status: 'InProgress',
    start: today(10, 0),
    durationMin: SLOT,
    reason: 'Rabies PEP — Day 0 + ERIG infiltration (cat bite)',
  },
  {
    patientDisplayId: PAT_LIM_DISPLAY_ID,
    type: 'Consultation',
    status: 'Completed',
    start: today(11, 0),
    durationMin: SLOT,
    reason: 'Annual flu vaccination + BP check',
  },
  {
    patientDisplayId: PAT_GARCIA_DISPLAY_ID,
    type: 'Vaccination',
    status: 'Scheduled',
    start: today(14, 0),
    durationMin: SLOT,
    reason: 'Rabies PEP — new exposure assessment',
  },
  // ── Tomorrow ────────────────────────────────────────────────────────────────
  {
    patientDisplayId: PAT_REYES_DISPLAY_ID,
    type: 'FollowUp',
    status: 'Confirmed',
    start: daysFromNow(1, 9, 0),
    durationMin: SLOT,
    reason: 'Rabies PEP — Day 3 dose',
  },
  {
    patientDisplayId: PAT_MENDOZA_DISPLAY_ID,
    type: 'Consultation',
    status: 'Scheduled',
    start: daysFromNow(1, 10, 30),
    durationMin: SLOT,
    reason: 'Asthma follow-up + maintenance review',
  },
  // ── Next week ───────────────────────────────────────────────────────────────
  {
    patientDisplayId: PAT_CRUZ_DISPLAY_ID,
    type: 'FollowUp',
    status: 'Scheduled',
    start: daysFromNow(4, 9, 0),
    durationMin: SLOT,
    reason: 'Rabies PEP — Day 7 dose',
  },
  {
    patientDisplayId: PAT_AGUILAR_DISPLAY_ID,
    type: 'FollowUp',
    status: 'Scheduled',
    start: daysFromNow(4, 10, 0),
    durationMin: SLOT,
    reason: 'Rabies PEP — Day 14 dose',
  },
  {
    patientDisplayId: PAT_HERRERA_DISPLAY_ID,
    type: 'Procedure',
    status: 'Scheduled',
    start: daysFromNow(5, 13, 0),
    durationMin: 45,
    reason: 'Wound debridement + dressing change',
  },
  {
    patientDisplayId: PAT_JAVIER_DISPLAY_ID,
    type: 'LabDraw',
    status: 'Scheduled',
    start: daysFromNow(6, 8, 30),
    durationMin: SLOT,
    reason: 'Fasting lipid panel + HbA1c',
    withProvider: false,
  },
  {
    patientDisplayId: PAT_NAVARRO_DISPLAY_ID,
    type: 'Vaccination',
    status: 'Scheduled',
    start: daysFromNow(7, 9, 30),
    durationMin: SLOT,
    reason: 'Annual flu vaccination',
  },
  {
    patientDisplayId: PAT_LUNA_DISPLAY_ID,
    type: 'FollowUp',
    status: 'Confirmed',
    start: daysFromNow(7, 11, 0),
    durationMin: SLOT,
    reason: 'Rabies PEP — Day 28 dose',
  },
  {
    patientDisplayId: PAT_OCAMPO_DISPLAY_ID,
    type: 'Consultation',
    status: 'Scheduled',
    start: daysFromNow(8, 14, 0),
    durationMin: SLOT,
    reason: 'Geriatric review — COPD + cardiac',
  },
  {
    patientDisplayId: PAT_BAUTISTA_DISPLAY_ID,
    type: 'Vaccination',
    status: 'Scheduled',
    start: daysFromNow(10, 10, 0),
    durationMin: SLOT,
    reason: 'Senior flu vaccination (SC discount)',
  },
  // ── Past — closed history ─────────────────────────────────────────────────
  {
    patientDisplayId: PAT_SANTOS_DISPLAY_ID,
    type: 'Vaccination',
    status: 'Completed',
    start: daysAgo(2, 9, 0),
    durationMin: SLOT,
    reason: 'Tetanus booster (wound)',
  },
  {
    patientDisplayId: PAT_FERNANDEZ_DISPLAY_ID,
    type: 'Consultation',
    status: 'NoShow',
    start: daysAgo(3, 10, 0),
    durationMin: SLOT,
    reason: 'General consultation — did not arrive',
  },
  {
    patientDisplayId: PAT_GONZALES_DISPLAY_ID,
    type: 'Consultation',
    status: 'Cancelled',
    start: daysAgo(5, 11, 0),
    durationMin: SLOT,
    reason: 'Cardiac review — rescheduled at patient request',
  },
]

// Phone-readable booking handle (6-char Crockford base32, deterministic by index).
function bookingRef(idx: number): string {
  const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  let n = idx + 100000 // offset so refs are 6 chars and look non-sequential
  let out = ''
  for (let i = 0; i < 6; i++) {
    out = A[n % 32] + out
    n = Math.floor(n / 32)
  }
  return out
}

export async function seedAppointments(args: {
  tenantId: string
  patients: Map<string, number>
  branchId: number
  providerId: number
  createdById: number
}): Promise<void> {
  const { tenantId, patients, branchId, providerId, createdById } = args

  let inserted = 0
  for (const [idx, a] of APPOINTMENT_ROWS.entries()) {
    const patientId = patients.get(a.patientDisplayId)
    if (patientId === undefined) {
      throw new Error(`seedAppointments: missing patient ${a.patientDisplayId}`)
    }
    const end = new Date(a.start.getTime() + a.durationMin * 60 * 1000)
    const isCancelled = a.status === 'Cancelled' || a.status === 'NoShow'

    const row = await db
      .insert(s.appointments)
      .values({
        // Index-derived, NOT a random `displayId()`: a random id never collides,
        // so `onConflictDoNothing` never skipped and each `pnpm db:seed` re-run
        // inserted another full copy. See transactions.ts for the same fix.
        displayId: `APT_${seqSuffix(idx, 8)}`,
        bookingRef: bookingRef(idx),
        tenantId,
        patientId,
        branchId,
        providerId: a.withProvider === false ? null : providerId,
        scheduledStartAt: a.start,
        scheduledEndAt: end,
        appointmentType: a.type,
        status: a.status,
        reason: a.reason,
        cancelledAt: isCancelled ? a.start : null,
        cancelledById: isCancelled ? createdById : null,
        cancellationReason:
          a.status === 'Cancelled'
            ? 'Rescheduled at patient request'
            : a.status === 'NoShow'
              ? 'Patient did not arrive'
              : null,
        createdById,
      })
      .onConflictDoNothing()
      .returning({ id: s.appointments.id })

    if (row[0]) inserted++
  }

  console.log(`  ✓ appointments (${inserted})`)
}
