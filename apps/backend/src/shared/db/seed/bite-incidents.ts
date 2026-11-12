/**
 * Seed section — bite incidents + animal observation follow-ups.
 *
 * The core rabies-clinic intake artefact: who was bitten, by what, the WHO/DOH
 * exposure category, and the 14-day animal-observation schedule that can cancel
 * the Day-28 dose if the animal stays healthy.
 *
 * Dates are RELATIVE so observation due dates land across the live window:
 *   - villanueva → due TODAY (incident 14 days ago)
 *   - luna       → due in ~4 days (this week)
 *   - aguilar / cruz / reyes → due next week
 *   - herrera    → already Completed (AliveHealthy → Day-28 cancellable)
 *
 * Two-tier IDs: bite_incidents `display_id` = `BIT_…`; followups = `AOF_…`.
 * `incident_date` / `due_date` are DATE columns → seed as YYYY-MM-DD strings.
 */

import { and, desc, eq } from 'drizzle-orm'
import * as s from '../schema.js'
import { db } from './db.js'
import { daysAgo, today, dateStr, seqSuffix } from './helpers.js'
import {
  PAT_DELACRUZ_DISPLAY_ID,
  PAT_TORRES_DISPLAY_ID,
  PAT_REYES_DISPLAY_ID,
  PAT_VILLANUEVA_DISPLAY_ID,
  PAT_CRUZ_DISPLAY_ID,
  PAT_AGUILAR_DISPLAY_ID,
  PAT_LUNA_DISPLAY_ID,
  PAT_HERRERA_DISPLAY_ID,
  PAT_GARCIA_DISPLAY_ID,
} from './constants.js'

type Species = 'Dog' | 'Cat' | 'Bat' | 'Monkey' | 'Other'
type VaxStatus = 'Vaccinated' | 'NotVaccinated' | 'Unknown'
type Category = 'I' | 'II' | 'III'
type Outcome =
  | 'AliveHealthy'
  | 'AliveSick'
  | 'DiedNaturally'
  | 'KilledForTesting'
  | 'LostToFollowup'

type FollowupPlan = {
  /** Days from incident date to the observation due date (DOH = 14). */
  dueOffset: number
  status: 'Pending' | 'Completed' | 'Cancelled'
  outcome?: Outcome
  /** When the outcome was recorded (only for Completed). */
  recordedAt?: Date
  notes?: string
}

type BiteSeed = {
  patientDisplayId: string
  incidentDate: Date
  species: Species
  animalVaccinationStatus: VaxStatus
  exposureCategory: Category
  biteSite: string
  requiresObservation: boolean
  metadata?: Record<string, unknown>
  followup: FollowupPlan
}

const BITE_ROWS: BiteSeed[] = [
  {
    patientDisplayId: PAT_DELACRUZ_DISPLAY_ID,
    incidentDate: today(),
    species: 'Dog',
    animalVaccinationStatus: 'NotVaccinated',
    exposureCategory: 'III',
    biteSite: 'Right hand, dorsum',
    requiresObservation: true,
    metadata: { provoked: false, ownedAnimal: false, locationOfIncident: 'Batasan Hills' },
    followup: { dueOffset: 14, status: 'Pending', notes: 'Stray dog — owner not traceable.' },
  },
  {
    patientDisplayId: PAT_TORRES_DISPLAY_ID,
    incidentDate: today(),
    species: 'Cat',
    animalVaccinationStatus: 'Unknown',
    exposureCategory: 'III',
    biteSite: 'Left forearm',
    requiresObservation: true,
    metadata: { provoked: true, ownedAnimal: true, ownerContacted: true },
    followup: {
      dueOffset: 14,
      status: 'Pending',
      notes: 'Neighbour-owned cat; owner cooperative.',
    },
  },
  {
    patientDisplayId: PAT_REYES_DISPLAY_ID,
    incidentDate: daysAgo(2),
    species: 'Dog',
    animalVaccinationStatus: 'Vaccinated',
    exposureCategory: 'II',
    biteSite: 'Left lower leg',
    requiresObservation: true,
    metadata: { provoked: false, ownedAnimal: true, animalVaccinationDoc: 'vet-card-2025' },
    followup: { dueOffset: 14, status: 'Pending', notes: 'Owner provided vet vaccination card.' },
  },
  {
    patientDisplayId: PAT_VILLANUEVA_DISPLAY_ID,
    incidentDate: daysAgo(14),
    species: 'Dog',
    animalVaccinationStatus: 'Unknown',
    exposureCategory: 'III',
    biteSite: 'Right calf, multiple punctures',
    requiresObservation: true,
    metadata: { provoked: false, ownedAnimal: false },
    followup: { dueOffset: 14, status: 'Pending', notes: 'Day-14 observation due today.' },
  },
  {
    patientDisplayId: PAT_CRUZ_DISPLAY_ID,
    incidentDate: daysAgo(3),
    species: 'Cat',
    animalVaccinationStatus: 'NotVaccinated',
    exposureCategory: 'II',
    biteSite: 'Right hand, scratch',
    requiresObservation: true,
    metadata: { provoked: true, ownedAnimal: true },
    followup: { dueOffset: 14, status: 'Pending' },
  },
  {
    patientDisplayId: PAT_AGUILAR_DISPLAY_ID,
    incidentDate: daysAgo(5),
    species: 'Dog',
    animalVaccinationStatus: 'Unknown',
    exposureCategory: 'III',
    biteSite: 'Left thigh',
    requiresObservation: true,
    metadata: { provoked: false, ownedAnimal: false },
    followup: { dueOffset: 14, status: 'Pending' },
  },
  {
    patientDisplayId: PAT_LUNA_DISPLAY_ID,
    incidentDate: daysAgo(10),
    species: 'Dog',
    animalVaccinationStatus: 'NotVaccinated',
    exposureCategory: 'III',
    biteSite: 'Right forearm + hand',
    requiresObservation: true,
    metadata: { provoked: false, ownedAnimal: false },
    followup: { dueOffset: 14, status: 'Pending', notes: 'Day-14 observation due this week.' },
  },
  {
    patientDisplayId: PAT_HERRERA_DISPLAY_ID,
    incidentDate: daysAgo(16),
    species: 'Dog',
    animalVaccinationStatus: 'Vaccinated',
    exposureCategory: 'II',
    biteSite: 'Left hand',
    requiresObservation: true,
    metadata: { provoked: true, ownedAnimal: true },
    followup: {
      dueOffset: 14,
      status: 'Completed',
      outcome: 'AliveHealthy',
      recordedAt: daysAgo(2, 11, 0),
      notes: 'Animal alive and healthy at Day 14 — Day-28 dose may be omitted.',
    },
  },
  {
    patientDisplayId: PAT_GARCIA_DISPLAY_ID,
    incidentDate: today(),
    species: 'Dog',
    animalVaccinationStatus: 'Unknown',
    exposureCategory: 'III',
    biteSite: 'Right ankle',
    requiresObservation: true,
    metadata: { provoked: false, ownedAnimal: false },
    followup: { dueOffset: 14, status: 'Pending' },
  },
]

export async function seedBiteIncidents(args: {
  tenantId: string
  patients: Map<string, number>
  recordedById: number
}): Promise<void> {
  const { tenantId, patients, recordedById } = args

  let incidents = 0
  let followups = 0

  for (const [bIdx, b] of BITE_ROWS.entries()) {
    const patientId = patients.get(b.patientDisplayId)
    if (patientId === undefined) {
      throw new Error(`seedBiteIncidents: missing patient ${b.patientDisplayId}`)
    }

    // Link to the patient's most-recent standing order (the rabies PEP series),
    // if one exists. Optional FK — null is acceptable when absent.
    const [pso] = await db
      .select({ id: s.patientStandingOrders.id })
      .from(s.patientStandingOrders)
      .where(
        and(
          eq(s.patientStandingOrders.tenantId, tenantId),
          eq(s.patientStandingOrders.patientId, patientId),
        ),
      )
      .orderBy(desc(s.patientStandingOrders.id))
      .limit(1)

    const incidentBit = await db
      .insert(s.biteIncidents)
      .values({
        // Index-derived, NOT a random `displayId()`: a random id never collides,
        // so `onConflictDoNothing` never skipped and each `pnpm db:seed` re-run
        // inserted another full copy. See transactions.ts for the same fix.
        displayId: `BIT_${seqSuffix(bIdx, 8)}`,
        tenantId,
        patientId,
        patientStandingOrderId: pso?.id ?? null,
        incidentDate: dateStr(b.incidentDate),
        species: b.species,
        animalVaccinationStatus: b.animalVaccinationStatus,
        animalAgeMonths: null,
        exposureCategory: b.exposureCategory,
        biteSite: b.biteSite,
        requiresObservation: b.requiresObservation,
        metadata: b.metadata ? JSON.stringify(b.metadata) : null,
        createdById: recordedById,
      })
      .onConflictDoNothing()
      .returning({ id: s.biteIncidents.id })

    if (!incidentBit[0]) continue // idempotent rerun — skip dependent followup
    incidents++

    const dueDate = new Date(b.incidentDate.getTime())
    dueDate.setDate(dueDate.getDate() + b.followup.dueOffset)

    const fu = await db
      .insert(s.animalObservationFollowups)
      .values({
        displayId: `AOF_${seqSuffix(bIdx, 8)}`,
        tenantId,
        biteIncidentId: incidentBit[0].id,
        dueDate: dateStr(dueDate),
        status: b.followup.status,
        outcome: b.followup.outcome ?? null,
        fatTestResult: null,
        outcomeRecordedAt: b.followup.recordedAt ?? null,
        outcomeRecordedById: b.followup.status === 'Completed' ? recordedById : null,
        notes: b.followup.notes ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: s.animalObservationFollowups.id })

    if (fu[0]) followups++
  }

  console.log(`  ✓ bite incidents (${incidents}) + animal observation follow-ups (${followups})`)
}
