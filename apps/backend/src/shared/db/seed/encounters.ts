/**
 * Seed section — encounters + patient_standing_orders + clinical_orders +
 * informed-consent rows.
 *
 * Two-tier IDs (W3.a.2 + 2026-05-19 follow-up):
 *   - `encounters.id` is bigserial; `display_id` = `ENC_<8 base32>`.
 *   - PSO + clinical_orders + consents display_ids use `seqSuffix` for
 *     deterministic, format-compliant (`PREFIX_<8 Crockford base32>`) values
 *     across reruns. Format checks on each table reject anything outside
 *     `[0-9A-HJKMNPQRSTVWXYZ]{8}`.
 *   - Idempotent reruns resolve existing rows by display_id and skip
 *     duplicate inserts.
 *
 * PSO + clinical_orders + consents:
 *   - Each Rabies/Flu/Vaccination encounter gets a PSO from a
 *     specialty-appropriate template; doses become clinical_orders.
 *   - The returned `clinicalOrdersByKey` map uses logical keys
 *     `<encounter_key>:<service_code>:<doseNumber>` so `seedLabOrders` can
 *     resolve specific rows without depending on display_id literals (which
 *     are random/seq-derived, not human-readable).
 *   - One informed-consent row per encounter (polymorphic scope
 *     `consents.scope_ref_type='encounter'` / `scope_ref_id=<ENC display_id>`).
 *   - Encounter status drives dose status: Completed → dose 1 = Completed at
 *     `completedAt`, remaining doses = Pending; InProgress (past) → dose 1 =
 *     Completed at `startedAt`, remaining = Pending; Open → all Scheduled.
 */

import { eq, and, asc } from 'drizzle-orm'
import * as s from '../schema.js'
import { db } from './db.js'
import { daysAgo, today, seqSuffix } from './helpers.js'
import {
  TENANT_SLUG,
  PAT_DELACRUZ_DISPLAY_ID,
  PAT_TORRES_DISPLAY_ID,
  PAT_LIM_DISPLAY_ID,
  PAT_VILLANUEVA_DISPLAY_ID,
  PAT_CRUZ_DISPLAY_ID,
  PAT_SANTOS_DISPLAY_ID,
  PAT_REYES_DISPLAY_ID,
  PAT_GARCIA_DISPLAY_ID,
  PAT_MENDOZA_DISPLAY_ID,
  PAT_AGUILAR_DISPLAY_ID,
  PAT_HERRERA_DISPLAY_ID,
  PAT_KATIPUNAN_DISPLAY_ID,
  PAT_LUNA_DISPLAY_ID,
  PAT_NAVARRO_DISPLAY_ID,
  PAT_OCAMPO_DISPLAY_ID,
  SOT_RABIES_PEP_IM,
  SOT_ERIG,
  SOT_FLU,
  SOT_TT_BOOSTER,
} from './constants.js'

type EncounterKey =
  | 'delacruz'
  | 'torres'
  | 'lim'
  | 'santos'
  | 'reyes'
  | 'garcia'
  | 'mendoza'
  | 'villanueva'
  | 'cruz'
  | 'aguilar'
  | 'luna'
  | 'herrera'
  | 'katipunan'
  | 'navarro'
  | 'ocampo'

/**
 * Compound lookup key for a clinical_order. Format:
 *   `<encounter_key>:<service_catalog.id>:<doseNumber>`
 *
 * Example: `'torres:SVC_ERIG_INF:1'` resolves Torres' ERIG infiltration order.
 */
export type ClinicalOrderLookupKey = string

export type SeededEncounters = {
  /** Map of seed-key → encounter bigint id. */
  byKey: Map<EncounterKey, number>
  /**
   * Map of compound key (`<encKey>:<serviceId>:<doseNumber>`) →
   * clinical_order bigint id. Consumed by seedLabOrders.
   */
  clinicalOrdersByKey: Map<ClinicalOrderLookupKey, number>
}

type EncounterSeed = {
  key: EncounterKey
  patientDisplayId: string
  specialty: 'Rabies' | 'Flu' | 'Vaccination' | 'General'
  status: 'Open' | 'InProgress' | 'Completed' | 'Cancelled'
  startedAt: Date
  completedAt?: Date
}

type PsoPlan = {
  templateId: string
}

/**
 * Per-encounter PSO plan. mendoza (General check-up) has no PSO.
 * ocampo's Flu PSO is created under a General-specialty encounter to
 * provide a flu clinical_order for the Ocampo lab-orders.ts spec.
 */
const PSO_PLANS_BY_ENCOUNTER: Partial<Record<EncounterKey, PsoPlan[]>> = {
  delacruz: [{ templateId: SOT_RABIES_PEP_IM }],
  torres: [{ templateId: SOT_RABIES_PEP_IM }, { templateId: SOT_ERIG }],
  lim: [{ templateId: SOT_FLU }],
  santos: [{ templateId: SOT_TT_BOOSTER }],
  reyes: [{ templateId: SOT_RABIES_PEP_IM }],
  garcia: [{ templateId: SOT_RABIES_PEP_IM }],
  villanueva: [{ templateId: SOT_RABIES_PEP_IM }],
  cruz: [{ templateId: SOT_RABIES_PEP_IM }],
  aguilar: [{ templateId: SOT_RABIES_PEP_IM }],
  luna: [{ templateId: SOT_RABIES_PEP_IM }],
  herrera: [{ templateId: SOT_RABIES_PEP_IM }],
  katipunan: [{ templateId: SOT_TT_BOOSTER }],
  navarro: [{ templateId: SOT_FLU }],
  ocampo: [{ templateId: SOT_FLU }],
}

export async function seedEncounters(args: {
  patients: Map<string, number>
  branchId: number
  providerId: number
  createdById: number
}): Promise<SeededEncounters> {
  const { patients, branchId, providerId, createdById } = args

  const encounterRows: EncounterSeed[] = [
    {
      key: 'delacruz',
      patientDisplayId: PAT_DELACRUZ_DISPLAY_ID,
      specialty: 'Rabies',
      status: 'InProgress',
      startedAt: today(10, 30),
    },
    {
      key: 'torres',
      patientDisplayId: PAT_TORRES_DISPLAY_ID,
      specialty: 'Rabies',
      status: 'InProgress',
      startedAt: today(10, 0),
    },
    {
      key: 'lim',
      patientDisplayId: PAT_LIM_DISPLAY_ID,
      specialty: 'Flu',
      status: 'Completed',
      startedAt: today(9, 15),
      completedAt: today(9, 45),
    },
    {
      key: 'santos',
      patientDisplayId: PAT_SANTOS_DISPLAY_ID,
      specialty: 'Vaccination',
      status: 'Completed',
      startedAt: today(9, 45),
      completedAt: today(10, 15),
    },
    {
      key: 'reyes',
      patientDisplayId: PAT_REYES_DISPLAY_ID,
      specialty: 'Rabies',
      status: 'Completed',
      startedAt: daysAgo(2),
      completedAt: daysAgo(2, 9, 30),
    },
    {
      key: 'garcia',
      patientDisplayId: PAT_GARCIA_DISPLAY_ID,
      specialty: 'Rabies',
      status: 'Open',
      startedAt: today(11, 0),
    },
    {
      key: 'mendoza',
      patientDisplayId: PAT_MENDOZA_DISPLAY_ID,
      specialty: 'General',
      status: 'Completed',
      startedAt: today(8, 30),
      completedAt: today(9, 0),
    },
    {
      key: 'villanueva',
      patientDisplayId: PAT_VILLANUEVA_DISPLAY_ID,
      specialty: 'Rabies',
      status: 'InProgress',
      startedAt: daysAgo(14),
    },
    {
      key: 'cruz',
      patientDisplayId: PAT_CRUZ_DISPLAY_ID,
      specialty: 'Rabies',
      status: 'InProgress',
      startedAt: daysAgo(3),
    },
    {
      key: 'aguilar',
      patientDisplayId: PAT_AGUILAR_DISPLAY_ID,
      specialty: 'Rabies',
      status: 'InProgress',
      startedAt: daysAgo(5),
    },
    {
      key: 'luna',
      patientDisplayId: PAT_LUNA_DISPLAY_ID,
      specialty: 'Rabies',
      status: 'InProgress',
      startedAt: daysAgo(10),
    },
    {
      key: 'herrera',
      patientDisplayId: PAT_HERRERA_DISPLAY_ID,
      specialty: 'Rabies',
      status: 'Completed',
      startedAt: daysAgo(3),
      completedAt: daysAgo(3, 10, 0),
    },
    {
      key: 'katipunan',
      patientDisplayId: PAT_KATIPUNAN_DISPLAY_ID,
      specialty: 'Vaccination',
      status: 'Completed',
      startedAt: daysAgo(1),
      completedAt: daysAgo(1, 9, 30),
    },
    {
      key: 'navarro',
      patientDisplayId: PAT_NAVARRO_DISPLAY_ID,
      specialty: 'Flu',
      status: 'Completed',
      startedAt: daysAgo(1),
      completedAt: daysAgo(1, 10, 0),
    },
    {
      key: 'ocampo',
      patientDisplayId: PAT_OCAMPO_DISPLAY_ID,
      specialty: 'General',
      status: 'Completed',
      startedAt: daysAgo(2),
      completedAt: daysAgo(2, 10, 0),
    },
  ]

  // ── Encounters ────────────────────────────────────────────────────────────
  const visitCount = new Map<string, number>()
  const byKey = new Map<EncounterKey, number>()
  const encounterDisplayIdByKey = new Map<EncounterKey, string>()
  const patientBigintByKey = new Map<EncounterKey, number>()

  for (const [encIdx, enc] of encounterRows.entries()) {
    const patientBigint = patients.get(enc.patientDisplayId)
    if (patientBigint === undefined) {
      throw new Error(`seedEncounters: missing patient ${enc.patientDisplayId}`)
    }
    patientBigintByKey.set(enc.key, patientBigint)

    const visitNo = (visitCount.get(enc.patientDisplayId) ?? 0) + 1
    visitCount.set(enc.patientDisplayId, visitNo)

    const inserted = await db
      .insert(s.encounters)
      .values({
        // Index-derived, NOT `displayId()`: a random id never collides, so
        // `onConflictDoNothing` never skipped and every re-run of `pnpm db:seed`
        // inserted a second copy of all 15 encounters (the patientId+startedAt
        // fallback lookup below could never fire). Same class of bug as the one
        // fixed in transactions.ts and branch-workflows.ts.
        displayId: `ENC_${seqSuffix(encIdx, 8)}`,
        tenantId: TENANT_SLUG,
        patientId: patientBigint,
        branchId,
        providerId,
        createdById,
        specialty: enc.specialty,
        status: enc.status,
        visitNo,
        startedAt: enc.startedAt,
        completedAt: enc.completedAt ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: s.encounters.id, displayId: s.encounters.displayId })

    let resolvedId: number
    let resolvedDisplayId: string
    if (inserted[0]) {
      resolvedId = inserted[0].id
      resolvedDisplayId = inserted[0].displayId
    } else {
      const [existing] = await db
        .select({ id: s.encounters.id, displayId: s.encounters.displayId })
        .from(s.encounters)
        .where(
          and(
            eq(s.encounters.tenantId, TENANT_SLUG),
            eq(s.encounters.patientId, patientBigint),
            eq(s.encounters.startedAt, enc.startedAt),
          ),
        )
        .limit(1)
      if (!existing) throw new Error(`seedEncounters: failed to resolve ${enc.key}`)
      resolvedId = existing.id
      resolvedDisplayId = existing.displayId
    }
    byKey.set(enc.key, resolvedId)
    encounterDisplayIdByKey.set(enc.key, resolvedDisplayId)
  }

  console.log(`  ✓ encounters (${encounterRows.length})`)

  // ── Cache template items (one query per distinct template) ────────────────
  const templateItemsByTemplate = new Map<
    string,
    Array<{ serviceId: string; dayOffset: number; sequence: number; quantity: string }>
  >()
  for (const plans of Object.values(PSO_PLANS_BY_ENCOUNTER)) {
    if (!plans) continue
    for (const plan of plans) {
      if (templateItemsByTemplate.has(plan.templateId)) continue
      const items = await db
        .select({
          serviceId: s.standingOrderTemplateItems.serviceId,
          dayOffset: s.standingOrderTemplateItems.dayOffset,
          sequence: s.standingOrderTemplateItems.sequence,
          quantity: s.standingOrderTemplateItems.quantity,
        })
        .from(s.standingOrderTemplateItems)
        .where(
          and(
            eq(s.standingOrderTemplateItems.tenantId, TENANT_SLUG),
            eq(s.standingOrderTemplateItems.templateId, plan.templateId),
          ),
        )
        .orderBy(
          asc(s.standingOrderTemplateItems.dayOffset),
          asc(s.standingOrderTemplateItems.sequence),
        )
      templateItemsByTemplate.set(plan.templateId, items)
    }
  }

  // ── PSO + clinical_orders ─────────────────────────────────────────────────
  //
  // Deterministic display_id indexes: a global counter for PSOs and clinical
  // orders ensures `seqSuffix` produces unique compliant strings while
  // staying stable across reruns (encounter order is fixed).
  const clinicalOrdersByKey = new Map<ClinicalOrderLookupKey, number>()
  let psoIdx = 0
  let orderIdx = 0
  let psoCount = 0
  let orderCount = 0

  const startOfToday = today()

  for (let encIdx = 0; encIdx < encounterRows.length; encIdx++) {
    const enc = encounterRows[encIdx]!
    const plans = PSO_PLANS_BY_ENCOUNTER[enc.key]
    if (!plans) continue

    const encounterBigint = byKey.get(enc.key)!
    const patientBigint = patientBigintByKey.get(enc.key)!

    for (const plan of plans) {
      const items = templateItemsByTemplate.get(plan.templateId) ?? []
      if (items.length === 0) {
        throw new Error(
          `seedEncounters: template ${plan.templateId} has no items — did seedStandingOrders run first?`,
        )
      }

      const psoDisplayId = `PSO_${seqSuffix(psoIdx++, 8)}`
      const psoInserted = await db
        .insert(s.patientStandingOrders)
        .values({
          displayId: psoDisplayId,
          tenantId: TENANT_SLUG,
          patientId: patientBigint,
          templateId: plan.templateId,
          initiatingEncounterId: encounterBigint,
          authorizingProviderId: providerId,
          status: 'Active',
          startDate: enc.startedAt,
          createdById,
        })
        .onConflictDoNothing()
        .returning({ id: s.patientStandingOrders.id })

      let psoBigint: number
      if (psoInserted[0]) {
        psoBigint = psoInserted[0].id
        psoCount++
      } else {
        const [existing] = await db
          .select({ id: s.patientStandingOrders.id })
          .from(s.patientStandingOrders)
          .where(
            and(
              eq(s.patientStandingOrders.tenantId, TENANT_SLUG),
              eq(s.patientStandingOrders.displayId, psoDisplayId),
            ),
          )
          .limit(1)
        if (!existing) throw new Error(`seedEncounters: failed to resolve PSO ${psoDisplayId}`)
        psoBigint = existing.id
      }

      const isInProgressPast = enc.status === 'InProgress' && enc.startedAt < startOfToday

      const orderSpecs = items.map((item, idx) => {
        const doseNumber = idx + 1
        const scheduled = new Date(enc.startedAt.getTime())
        scheduled.setUTCDate(scheduled.getUTCDate() + item.dayOffset)

        let orderStatus: 'Pending' | 'Completed' | 'Scheduled' | 'Cancelled'
        let completedAt: Date | null = null
        let administeredById: number | null = null
        let documentedById: number | null = null
        let administeringEncounterId: number | null = null

        if (enc.status === 'Cancelled') {
          orderStatus = 'Cancelled'
        } else if (enc.status === 'Open') {
          orderStatus = 'Scheduled'
        } else if (doseNumber === 1 && (enc.status === 'Completed' || isInProgressPast)) {
          orderStatus = 'Completed'
          completedAt = enc.completedAt ?? enc.startedAt
          administeredById = providerId
          documentedById = createdById
          administeringEncounterId = encounterBigint
        } else {
          orderStatus = 'Pending'
        }

        const orderDisplayId = `ORD_${seqSuffix(orderIdx++, 8)}`
        const lookupKey = `${enc.key}:${item.serviceId}:${doseNumber}`

        return {
          orderDisplayId,
          lookupKey,
          values: {
            displayId: orderDisplayId,
            tenantId: TENANT_SLUG,
            patientStandingOrderId: psoBigint,
            patientId: patientBigint,
            serviceId: item.serviceId,
            encounterId: encounterBigint,
            orderType: 'Standing_Order' as const,
            status: orderStatus,
            originalScheduledDate: scheduled,
            currentScheduledDate: scheduled,
            completedAt,
            administeringEncounterId,
            administeredById,
            documentedById,
            quantity: item.quantity,
            doseNumber,
            createdById,
          },
        }
      })

      const insertedOrders = await db
        .insert(s.clinicalOrders)
        .values(orderSpecs.map((o) => o.values))
        .onConflictDoNothing()
        .returning({ id: s.clinicalOrders.id, displayId: s.clinicalOrders.displayId })

      // Map inserted rows back to their lookup keys via display_id.
      const idByDisplayId = new Map(insertedOrders.map((o) => [o.displayId, o.id]))
      for (const spec of orderSpecs) {
        const id = idByDisplayId.get(spec.orderDisplayId)
        if (id !== undefined) {
          clinicalOrdersByKey.set(spec.lookupKey, id)
          orderCount++
        }
      }

      // Resolve any rows that conflicted (idempotent rerun) via display_id.
      if (insertedOrders.length < orderSpecs.length) {
        for (const spec of orderSpecs) {
          if (clinicalOrdersByKey.has(spec.lookupKey)) continue
          const [existing] = await db
            .select({ id: s.clinicalOrders.id })
            .from(s.clinicalOrders)
            .where(
              and(
                eq(s.clinicalOrders.tenantId, TENANT_SLUG),
                eq(s.clinicalOrders.displayId, spec.orderDisplayId),
              ),
            )
            .limit(1)
          if (existing) clinicalOrdersByKey.set(spec.lookupKey, existing.id)
        }
      }
    }
  }

  console.log(`  ✓ patient_standing_orders (${psoCount}) + clinical_orders (${orderCount})`)

  // ── Informed-consent rows (one per encounter) ─────────────────────────────
  //
  // Polymorphic scope: scope_ref_type='encounter', scope_ref_id = encounter
  // display_id. Models the broad "I consent to today's visit" signature
  // collected at intake.
  let consentIdx = 0
  let consentCount = 0
  for (const enc of encounterRows) {
    const patientBigint = patientBigintByKey.get(enc.key)!
    const encDisplayId = encounterDisplayIdByKey.get(enc.key)!
    const encBigint = byKey.get(enc.key)!

    const inserted = await db
      .insert(s.consents)
      .values({
        displayId: `CNS_${seqSuffix(consentIdx++, 8)}`,
        tenantId: TENANT_SLUG,
        patientId: patientBigint,
        encounterId: encBigint,
        consentType: 'informed_consent',
        scope: 'encounter',
        scopeRefType: 'encounter',
        scopeRefId: encDisplayId,
        consenterRelation: 'Patient',
        consenterName: null,
        visProvided: true,
        visLanguage: 'en',
        obtainedAt: enc.startedAt,
        obtainedById: createdById,
        consentLanguage: 'en',
        createdById,
      })
      .onConflictDoNothing()
      .returning({ id: s.consents.id })
    if (inserted[0]) consentCount++
  }

  console.log(`  ✓ informed-consents (${consentCount})`)

  // ── Encounter vitals + diagnoses ──────────────────────────────────────────
  //
  // One vitals row per encounter (so the encounter detail rail isn't empty),
  // plus a specialty-appropriate ICD-10 diagnosis. Vitals are deterministic
  // functions of the encounter index so reruns are stable.
  const DIAGNOSES_BY_SPECIALTY: Record<
    EncounterSeed['specialty'],
    Array<{ icd10Code: string; description: string; isPrimary: boolean }>
  > = {
    Rabies: [
      {
        icd10Code: 'Z20.3',
        description: 'Contact with and (suspected) exposure to rabies',
        isPrimary: true,
      },
      { icd10Code: 'W54.0', description: 'Bitten by dog', isPrimary: false },
    ],
    Flu: [{ icd10Code: 'Z23', description: 'Encounter for immunization', isPrimary: true }],
    Vaccination: [{ icd10Code: 'Z23', description: 'Encounter for immunization', isPrimary: true }],
    General: [
      {
        icd10Code: 'Z00.00',
        description: 'General adult medical examination without abnormal findings',
        isPrimary: true,
      },
    ],
  }

  let vitalsCount = 0
  let diagnosisCount = 0
  for (let i = 0; i < encounterRows.length; i++) {
    const enc = encounterRows[i]!
    const encBigint = byKey.get(enc.key)!
    const patientBigint = patientBigintByKey.get(enc.key)!

    const weightKg = 55 + (i % 8) * 4
    const heightCm = 158 + (i % 6) * 3
    const bmi = weightKg / (heightCm / 100) ** 2

    const vitalsInserted = await db
      .insert(s.encounterVitals)
      .values({
        tenantId: TENANT_SLUG,
        encounterId: encBigint,
        patientId: patientBigint,
        recordedAt: enc.startedAt,
        recordedById: createdById,
        temperatureC: (36.5 + (i % 4) * 0.3).toFixed(1),
        heartRateBpm: 68 + (i % 6) * 3,
        respiratoryRateBpm: 16 + (i % 3),
        systolicBp: 110 + (i % 5) * 5,
        diastolicBp: 70 + (i % 4) * 3,
        spo2Percent: (97 + (i % 3)).toFixed(2),
        weightKg: weightKg.toFixed(2),
        heightCm: heightCm.toFixed(1),
        bmi: bmi.toFixed(2),
        painScore: i % 4,
        createdById,
      })
      .onConflictDoNothing()
      .returning({ id: s.encounterVitals.id })
    if (vitalsInserted[0]) vitalsCount++

    for (const dx of DIAGNOSES_BY_SPECIALTY[enc.specialty]) {
      const dxInserted = await db
        .insert(s.encounterDiagnoses)
        .values({
          tenantId: TENANT_SLUG,
          encounterId: encBigint,
          patientId: patientBigint,
          icd10Code: dx.icd10Code,
          description: dx.description,
          isPrimary: dx.isPrimary,
          diagnosisType: dx.isPrimary ? 'Primary' : 'Secondary',
          recordedById: providerId,
          createdById,
        })
        .onConflictDoNothing()
        .returning({ id: s.encounterDiagnoses.id })
      if (dxInserted[0]) diagnosisCount++
    }
  }

  console.log(`  ✓ encounter vitals (${vitalsCount}) + diagnoses (${diagnosisCount})`)

  return { byKey, clinicalOrdersByKey }
}
