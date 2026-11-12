/**
 * Seed section — patients + normalized allergies/conditions + tag definitions
 * + patient tags.
 *
 * Two-tier IDs (W2, 2026-05-19):
 *   - `patients.id` is bigserial; `display_id` = `PAT_<8 base32>` (deterministic
 *     in seed for stable downstream FKs).
 *   - `patients.mrn` is allocated from `mrn_seq_<slug>` (per-tenant sequence
 *     provisioned by `provision_tenant_counters(slug)`).
 *   - Allergies/conditions/tags are bigserial children.
 *
 * Returns a map of `displayId → bigint id` so downstream seeds (encounters,
 * transactions, lab orders, etc.) can FK against patient bigints.
 */

import { sql } from 'drizzle-orm'
import * as s from '../schema.js'
import { db } from './db.js'
import { displayId, formatMrn } from '../../utils/displayId.js'
import {
  TENANT_SLUG,
  TENANT_SLUG_LC,
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
  PAT_BAUTISTA_DISPLAY_ID,
  PAT_FERNANDEZ_DISPLAY_ID,
  PAT_GONZALES_DISPLAY_ID,
  PAT_HERRERA_DISPLAY_ID,
  PAT_ILAGAN_DISPLAY_ID,
  PAT_JAVIER_DISPLAY_ID,
  PAT_KATIPUNAN_DISPLAY_ID,
  PAT_LUNA_DISPLAY_ID,
  PAT_NAVARRO_DISPLAY_ID,
  PAT_OCAMPO_DISPLAY_ID,
  PAT_RIVERA_DISPLAY_ID,
} from './constants.js'

export type SeededPatients = {
  byDisplayId: Map<string, number>
  delacruz: number
  torres: number
  lim: number
  villanueva: number
  cruz: number
  santos: number
  reyes: number
  garcia: number
  mendoza: number
  aguilar: number
  bautista: number
  fernandez: number
  gonzales: number
  herrera: number
  ilagan: number
  javier: number
  katipunan: number
  luna: number
  navarro: number
  ocampo: number
  rivera: number
}

type PatientSeed = {
  displayId: string
  key: keyof Omit<SeededPatients, 'byDisplayId'>
  firstName: string
  lastName: string
  contactNumber: string | null
  sex: 'Male' | 'Female'
  dateOfBirth: string
  civilStatus: string
  nationality: string
  address: string
  city?: string
  province?: string
  barangay?: string
  email?: string
  insuranceProvider?: string
  insurancePolicyNumber?: string
  guardianName?: string
  guardianRelationship?: string
  guardianContact?: string
  allergens?: string[]
  conditions?: string[]
  onboardingChannel?: string
  /**
   * 'secondary' homes this patient at `args.secondaryBranchId` (TMG) instead
   * of `args.homeBranchId` (HST, the default for every other seeded
   * patient). Fixture for the Cross-Branch PHI RFC masking checks (R3).
   */
  homeBranch?: 'primary' | 'secondary'
}

// Backfill rotation for seeded patients — channels that don't require a payer ref,
// so list/report surfaces have realistic non-null "lead source" variety on fresh seed.
const SEED_ONBOARDING_CHANNEL_ROTATION = [
  'Walk-in',
  'Referral',
  'Vaccination drive',
  'Social media',
  'Returning patient',
] as const

const PATIENT_ROWS: PatientSeed[] = [
  {
    displayId: PAT_DELACRUZ_DISPLAY_ID,
    key: 'delacruz',
    firstName: 'Maria',
    lastName: 'Dela Cruz',
    contactNumber: '0917-123-4567',
    sex: 'Female',
    dateOfBirth: '1985-03-15',
    civilStatus: 'Married',
    nationality: 'Filipino',
    address: '45 Batangas St.',
    barangay: 'Batasan Hills',
    email: 'maria.delacruz@email.com',
  },
  {
    displayId: PAT_TORRES_DISPLAY_ID,
    key: 'torres',
    firstName: 'Miguel',
    lastName: 'Torres',
    contactNumber: '0918-234-5678',
    sex: 'Male',
    dateOfBirth: '1990-07-22',
    civilStatus: 'Single',
    nationality: 'Filipino',
    address: '12 Mindanao Ave',
    barangay: 'Tandang Sora',
  },
  {
    displayId: PAT_LIM_DISPLAY_ID,
    key: 'lim',
    firstName: 'Grace',
    lastName: 'Lim',
    contactNumber: '0919-345-6789',
    sex: 'Female',
    dateOfBirth: '1978-11-08',
    civilStatus: 'Married',
    nationality: 'Filipino-Chinese',
    address: '88 Banawe St.',
    barangay: 'Santa Mesa Heights',
    email: 'grace.lim@company.com',
    insuranceProvider: 'Intellicare',
    insurancePolicyNumber: 'IC-2024-0045678',
    allergens: ['Penicillin'],
    conditions: ['Hypertension'],
  },
  {
    displayId: PAT_VILLANUEVA_DISPLAY_ID,
    key: 'villanueva',
    firstName: 'Mark',
    lastName: 'Villanueva',
    contactNumber: '0920-456-7890',
    sex: 'Male',
    dateOfBirth: '1995-01-30',
    civilStatus: 'Single',
    nationality: 'Filipino',
    address: '7 Maginoo St.',
    barangay: 'Paligsahan',
  },
  {
    displayId: PAT_CRUZ_DISPLAY_ID,
    key: 'cruz',
    firstName: 'Elena',
    lastName: 'Cruz',
    contactNumber: null,
    sex: 'Female',
    dateOfBirth: '2000-06-12',
    civilStatus: 'Single',
    nationality: 'Filipino',
    address: '23 Katipunan Ave',
    barangay: 'Loyola Heights',
    guardianName: 'Roberto Cruz',
    guardianRelationship: 'Father',
    guardianContact: '0917-999-0001',
  },
  {
    displayId: PAT_SANTOS_DISPLAY_ID,
    key: 'santos',
    firstName: 'Juan',
    lastName: 'Santos',
    contactNumber: '0921-567-8901',
    sex: 'Male',
    dateOfBirth: '1982-09-25',
    civilStatus: 'Married',
    nationality: 'Filipino',
    address: '156 Quezon Ave',
    barangay: 'South Triangle',
    conditions: ['Diabetes Type 2'],
  },
  {
    displayId: PAT_REYES_DISPLAY_ID,
    key: 'reyes',
    firstName: 'Ana',
    lastName: 'Reyes',
    contactNumber: '0922-678-9012',
    sex: 'Female',
    dateOfBirth: '1992-04-18',
    civilStatus: 'Single',
    nationality: 'Filipino',
    address: '34 Scout Alcaraz',
    barangay: 'Sacred Heart',
    email: 'ana.reyes@email.com',
  },
  {
    displayId: PAT_GARCIA_DISPLAY_ID,
    key: 'garcia',
    firstName: 'Pedro',
    lastName: 'Garcia',
    contactNumber: '0923-789-0123',
    sex: 'Male',
    dateOfBirth: '1975-12-03',
    civilStatus: 'Married',
    nationality: 'Filipino',
    address: '89 Tomas Morato Ave',
    barangay: 'South Triangle',
    allergens: ['Aspirin'],
    conditions: ['Hypertension', 'Gout'],
  },
  {
    displayId: PAT_MENDOZA_DISPLAY_ID,
    key: 'mendoza',
    firstName: 'Sofia',
    lastName: 'Mendoza',
    contactNumber: '0924-890-1234',
    sex: 'Female',
    dateOfBirth: '1988-08-20',
    civilStatus: 'Married',
    nationality: 'Filipino',
    address: '22 Malingap St.',
    barangay: 'Teachers Village',
    email: 'sofia.mendoza@email.com',
    insuranceProvider: 'Maxicare',
    insurancePolicyNumber: 'MC-2024-9012345',
    conditions: ['Asthma'],
  },
  {
    displayId: PAT_AGUILAR_DISPLAY_ID,
    key: 'aguilar',
    firstName: 'Roberto',
    lastName: 'Aguilar',
    contactNumber: '0925-901-2345',
    sex: 'Male',
    dateOfBirth: '1980-05-10',
    civilStatus: 'Married',
    nationality: 'Filipino',
    address: '4 Mapagkawanggawa St.',
    barangay: 'Pinyahan',
  },
  {
    displayId: PAT_BAUTISTA_DISPLAY_ID,
    key: 'bautista',
    firstName: 'Lourdes',
    lastName: 'Bautista',
    contactNumber: '0926-012-3456',
    sex: 'Female',
    dateOfBirth: '1955-03-28',
    civilStatus: 'Widowed',
    nationality: 'Filipino',
    address: '67 Doña Hemady',
    barangay: 'New Manila',
    insuranceProvider: 'PhilHealth',
    insurancePolicyNumber: 'PH-0000-12345678-0',
    allergens: ['Sulfa drugs'],
    conditions: ['Hypertension', 'Osteoarthritis', 'Type 2 Diabetes'],
  },
  {
    displayId: PAT_FERNANDEZ_DISPLAY_ID,
    key: 'fernandez',
    firstName: 'Carlo',
    lastName: 'Fernandez',
    contactNumber: '0927-123-4560',
    sex: 'Male',
    dateOfBirth: '2002-11-14',
    civilStatus: 'Single',
    nationality: 'Filipino',
    address: '10 Maamo St.',
    barangay: 'Diliman',
    guardianName: 'Perla Fernandez',
    guardianRelationship: 'Mother',
    guardianContact: '0917-888-0002',
  },
  {
    displayId: PAT_GONZALES_DISPLAY_ID,
    key: 'gonzales',
    firstName: 'Nena',
    lastName: 'Gonzales',
    contactNumber: '0928-234-5601',
    sex: 'Female',
    dateOfBirth: '1950-07-04',
    civilStatus: 'Widowed',
    nationality: 'Filipino',
    address: '3 Sampaguita St.',
    barangay: 'Bagong Pag-Asa',
    insuranceProvider: 'PhilHealth',
    insurancePolicyNumber: 'PH-0000-99887766-0',
    allergens: ['NSAIDs'],
    conditions: ['Heart Disease', 'Hypertension', 'Arthritis'],
  },
  {
    displayId: PAT_HERRERA_DISPLAY_ID,
    key: 'herrera',
    firstName: 'Patrick',
    lastName: 'Herrera',
    contactNumber: '0929-345-6702',
    sex: 'Male',
    dateOfBirth: '1995-08-19',
    civilStatus: 'Single',
    nationality: 'Filipino',
    address: '15 Kamuning Rd',
    barangay: 'Kamuning',
    email: 'p.herrera@globe.com.ph',
    insuranceProvider: 'Maxicare',
    insurancePolicyNumber: 'MC-2024-7654321',
  },
  {
    displayId: PAT_ILAGAN_DISPLAY_ID,
    key: 'ilagan',
    firstName: 'Rowena',
    lastName: 'Ilagan',
    contactNumber: '0930-456-7803',
    sex: 'Female',
    dateOfBirth: '1987-12-22',
    civilStatus: 'Married',
    nationality: 'Filipino',
    address: '78 Visayas Ave',
    barangay: 'Vasra',
    conditions: ['Hearing Impairment'],
  },
  {
    displayId: PAT_JAVIER_DISPLAY_ID,
    key: 'javier',
    firstName: 'Joselito',
    lastName: 'Javier',
    contactNumber: '0931-567-8904',
    sex: 'Male',
    dateOfBirth: '1973-02-08',
    civilStatus: 'Married',
    nationality: 'Filipino',
    address: '200 Panay Ave',
    barangay: 'South Triangle',
    email: 'joselito.javier@email.com',
    allergens: ['Penicillin', 'Amoxicillin'],
    conditions: ['Hypertension', 'Hyperlipidemia'],
  },
  {
    displayId: PAT_KATIPUNAN_DISPLAY_ID,
    key: 'katipunan',
    firstName: 'Kristine',
    lastName: 'Katipunan',
    contactNumber: null,
    sex: 'Female',
    dateOfBirth: '2010-09-30',
    civilStatus: 'Single',
    nationality: 'Filipino',
    address: '5 Acacia Lane',
    barangay: 'Loyola Heights',
    guardianName: 'Ernesto Katipunan',
    guardianRelationship: 'Father',
    guardianContact: '0917-777-0003',
  },
  {
    displayId: PAT_LUNA_DISPLAY_ID,
    key: 'luna',
    firstName: 'Dennis',
    lastName: 'Luna',
    contactNumber: '0932-678-9005',
    sex: 'Male',
    dateOfBirth: '1990-04-03',
    civilStatus: 'Single',
    nationality: 'Filipino',
    address: '33 Libertas St.',
    city: 'Marikina City',
    barangay: 'Concepcion Uno',
    email: 'dennis.luna@email.com',
  },
  {
    displayId: PAT_NAVARRO_DISPLAY_ID,
    key: 'navarro',
    firstName: 'Maricel',
    lastName: 'Navarro',
    contactNumber: '0933-789-0106',
    sex: 'Female',
    dateOfBirth: '1983-06-15',
    civilStatus: 'Married',
    nationality: 'Filipino',
    address: '11 Masigla St.',
    barangay: 'Diliman',
    email: 'maricel.navarro@email.com',
  },
  {
    displayId: PAT_OCAMPO_DISPLAY_ID,
    key: 'ocampo',
    firstName: 'Leonardo',
    lastName: 'Ocampo',
    contactNumber: '0934-890-1207',
    sex: 'Male',
    dateOfBirth: '1945-01-17',
    civilStatus: 'Widowed',
    nationality: 'Filipino',
    address: '9 Pagkakaisa Rd',
    barangay: 'Paligsahan',
    insuranceProvider: 'PhilHealth',
    insurancePolicyNumber: 'PH-0000-44556677-0',
    allergens: ['Aspirin', 'NSAIDs'],
    conditions: ['COPD', 'Heart Disease', 'Type 2 Diabetes', 'Hypertension'],
  },
  {
    displayId: PAT_RIVERA_DISPLAY_ID,
    key: 'rivera',
    firstName: 'Teresa',
    lastName: 'Rivera',
    contactNumber: '0935-901-2348',
    sex: 'Female',
    dateOfBirth: '1979-10-05',
    civilStatus: 'Married',
    nationality: 'Filipino',
    address: '18 Timog Ave',
    barangay: 'South Triangle',
    email: 'teresa.rivera@email.com',
    allergens: ['Penicillin'],
    conditions: ['Hypertension'],
    // Homed at TMG, not HST: the fixture for the cross-branch masking
    // checks (R3). See the file-level docblock and `homeBranch` on
    // `PatientSeed`.
    homeBranch: 'secondary',
  },
]

export async function seedPatients(args: {
  homeBranchId: number
  /**
   * Second branch (TMG) for the one seeded patient with `homeBranch:
   * 'secondary'`, every other row uses `homeBranchId`. Required so the
   * cross-branch masking checks (R3) have a real patient to open: without
   * this, every seeded patient is homed at the same branch and the "patient
   * homed elsewhere" case can't be exercised at all.
   */
  secondaryBranchId: number
  createdById: number
}): Promise<SeededPatients> {
  const byDisplayId = new Map<string, number>()

  for (const [i, p] of PATIENT_ROWS.entries()) {
    // Allocate MRN from per-tenant sequence (atomic; gaps acceptable).
    const seqName = `mrn_seq_${TENANT_SLUG_LC}`
    const [seqRow] = (await db.execute(
      sql`SELECT nextval(${seqName}) AS next`,
    )) as unknown as Array<{ next: number | string }>
    const mrn = formatMrn(Number(seqRow!.next))

    const inserted = await db
      .insert(s.patients)
      .values({
        displayId: p.displayId,
        tenantId: TENANT_SLUG,
        mrn,
        homeBranchId: p.homeBranch === 'secondary' ? args.secondaryBranchId : args.homeBranchId,
        firstName: p.firstName,
        lastName: p.lastName,
        contactNumber: p.contactNumber,
        sex: p.sex,
        dateOfBirth: p.dateOfBirth,
        civilStatus: p.civilStatus,
        nationality: p.nationality,
        address: p.address,
        city: p.city ?? 'Quezon City',
        province: p.province ?? 'Metro Manila',
        barangay: p.barangay,
        email: p.email,
        // Messaging-consent flag (nurse-testing-readiness R2): opt every
        // seeded patient with a real contact number into SMS so the texting
        // pilot has someone to reach. New registrations rely on the
        // PatientForm.tsx checkbox instead of this seed default.
        smsOptIn: p.contactNumber != null,
        guardianName: p.guardianName,
        guardianRelationship: p.guardianRelationship,
        guardianContact: p.guardianContact,
        insuranceProvider: p.insuranceProvider,
        insurancePolicyNumber: p.insurancePolicyNumber,
        onboardingChannel:
          p.onboardingChannel ??
          SEED_ONBOARDING_CHANNEL_ROTATION[i % SEED_ONBOARDING_CHANNEL_ROTATION.length],
        createdById: args.createdById,
      })
      .onConflictDoNothing()
      .returning({ id: s.patients.id })

    let id = inserted[0]?.id
    if (id === undefined) {
      const [existing] = await db
        .select({ id: s.patients.id })
        .from(s.patients)
        .where(
          sql`${s.patients.tenantId} = ${TENANT_SLUG} AND ${s.patients.displayId} = ${p.displayId}`,
        )
        .limit(1)
      if (!existing) throw new Error(`seedPatients: failed to resolve ${p.displayId}`)
      id = existing.id
    }
    byDisplayId.set(p.displayId, id)

    // Allergies (one row per allergen).
    if (p.allergens) {
      for (const allergen of p.allergens) {
        await db
          .insert(s.patientAllergies)
          .values({
            tenantId: TENANT_SLUG,
            patientId: id,
            allergen,
            source: 'PatientReported',
            recordedById: args.createdById,
            createdById: args.createdById,
          })
          .onConflictDoNothing()
      }
    }

    // Conditions (one row per condition).
    if (p.conditions) {
      for (const conditionName of p.conditions) {
        await db
          .insert(s.patientConditions)
          .values({
            tenantId: TENANT_SLUG,
            patientId: id,
            conditionName,
            status: 'Active',
            recordedById: args.createdById,
            createdById: args.createdById,
          })
          .onConflictDoNothing()
      }
    }
  }

  console.log(`  ✓ patients (${PATIENT_ROWS.length}) + normalized allergies + conditions`)

  // ── Tag Definitions ───────────────────────────────────────────────────────
  const tagCatalog = [
    'cat3-bite',
    'dog-bite',
    'cat-bite',
    'cat2-scratch',
    'missed-dose',
    'annual-flu',
    'HMO-Intellicare',
    'HMO-Maxicare',
    'senior-citizen',
    'SC-discount',
    'PWD',
    'PWD-discount',
    'penicillin-allergy',
    'corporate-Globe',
    'pediatric',
    'guardian-required',
    'high-risk',
    // Migration-owned definitions. Source rows can emit these tags, but they
    // remain ordinary tenant configuration and must exist before patient_tags
    // are loaded.
    'FULLY_PAID_PEP_COURSE',
    'POTENTIAL_DUPLICATE',
    'LEGACY_NOTE_NEEDS_CLINICAL_REVIEW',
  ]
  const tagDefIdByTag = new Map<string, number>()
  for (const tag of tagCatalog) {
    const inserted = await db
      .insert(s.tagDefinitions)
      .values({
        displayId: displayId('TGD'),
        tenantId: TENANT_SLUG,
        tag,
        createdById: args.createdById,
      })
      .onConflictDoNothing()
      .returning({ id: s.tagDefinitions.id })

    let id = inserted[0]?.id
    if (id === undefined) {
      const [existing] = await db
        .select({ id: s.tagDefinitions.id })
        .from(s.tagDefinitions)
        .where(
          sql`${s.tagDefinitions.tenantId} = ${TENANT_SLUG} AND ${s.tagDefinitions.tag} = ${tag}`,
        )
        .limit(1)
      if (!existing) throw new Error(`seedPatients: failed to resolve tag_definition ${tag}`)
      id = existing.id
    }
    tagDefIdByTag.set(tag, id)
  }

  console.log(`  ✓ tag definitions (${tagCatalog.length})`)

  // ── Patient Tags ──────────────────────────────────────────────────────────
  const tagRows: Array<{ patientDisplayId: string; tag: string }> = [
    { patientDisplayId: PAT_DELACRUZ_DISPLAY_ID, tag: 'cat3-bite' },
    { patientDisplayId: PAT_DELACRUZ_DISPLAY_ID, tag: 'dog-bite' },
    { patientDisplayId: PAT_TORRES_DISPLAY_ID, tag: 'cat3-bite' },
    { patientDisplayId: PAT_TORRES_DISPLAY_ID, tag: 'cat-bite' },
    { patientDisplayId: PAT_VILLANUEVA_DISPLAY_ID, tag: 'cat3-bite' },
    { patientDisplayId: PAT_VILLANUEVA_DISPLAY_ID, tag: 'dog-bite' },
    { patientDisplayId: PAT_CRUZ_DISPLAY_ID, tag: 'cat2-scratch' },
    { patientDisplayId: PAT_REYES_DISPLAY_ID, tag: 'cat3-bite' },
    { patientDisplayId: PAT_REYES_DISPLAY_ID, tag: 'missed-dose' },
    { patientDisplayId: PAT_LIM_DISPLAY_ID, tag: 'annual-flu' },
    { patientDisplayId: PAT_LIM_DISPLAY_ID, tag: 'HMO-Intellicare' },
    { patientDisplayId: PAT_MENDOZA_DISPLAY_ID, tag: 'HMO-Maxicare' },
    { patientDisplayId: PAT_BAUTISTA_DISPLAY_ID, tag: 'senior-citizen' },
    { patientDisplayId: PAT_BAUTISTA_DISPLAY_ID, tag: 'SC-discount' },
    { patientDisplayId: PAT_GONZALES_DISPLAY_ID, tag: 'senior-citizen' },
    { patientDisplayId: PAT_GONZALES_DISPLAY_ID, tag: 'SC-discount' },
    { patientDisplayId: PAT_ILAGAN_DISPLAY_ID, tag: 'PWD' },
    { patientDisplayId: PAT_ILAGAN_DISPLAY_ID, tag: 'PWD-discount' },
    { patientDisplayId: PAT_JAVIER_DISPLAY_ID, tag: 'penicillin-allergy' },
    { patientDisplayId: PAT_HERRERA_DISPLAY_ID, tag: 'HMO-Maxicare' },
    { patientDisplayId: PAT_HERRERA_DISPLAY_ID, tag: 'corporate-Globe' },
    { patientDisplayId: PAT_KATIPUNAN_DISPLAY_ID, tag: 'pediatric' },
    { patientDisplayId: PAT_KATIPUNAN_DISPLAY_ID, tag: 'guardian-required' },
    { patientDisplayId: PAT_OCAMPO_DISPLAY_ID, tag: 'senior-citizen' },
    { patientDisplayId: PAT_OCAMPO_DISPLAY_ID, tag: 'SC-discount' },
    { patientDisplayId: PAT_OCAMPO_DISPLAY_ID, tag: 'high-risk' },
    { patientDisplayId: PAT_AGUILAR_DISPLAY_ID, tag: 'cat3-bite' },
    { patientDisplayId: PAT_LUNA_DISPLAY_ID, tag: 'cat3-bite' },
    { patientDisplayId: PAT_LUNA_DISPLAY_ID, tag: 'dog-bite' },
  ]

  for (const t of tagRows) {
    const patientId = byDisplayId.get(t.patientDisplayId)
    const tagDefinitionId = tagDefIdByTag.get(t.tag)
    if (patientId === undefined || tagDefinitionId === undefined) {
      throw new Error(`seedPatients: missing patient or tag for ${t.patientDisplayId} / ${t.tag}`)
    }
    await db
      .insert(s.patientTags)
      .values({
        tenantId: TENANT_SLUG,
        patientId,
        tagDefinitionId,
        appliedById: args.createdById,
        createdById: args.createdById,
      })
      .onConflictDoNothing()
  }

  console.log(`  ✓ patient tags (${tagRows.length})`)

  const get = (displayId: string): number => {
    const id = byDisplayId.get(displayId)
    if (id === undefined) throw new Error(`seedPatients: missing ${displayId}`)
    return id
  }

  return {
    byDisplayId,
    delacruz: get(PAT_DELACRUZ_DISPLAY_ID),
    torres: get(PAT_TORRES_DISPLAY_ID),
    lim: get(PAT_LIM_DISPLAY_ID),
    villanueva: get(PAT_VILLANUEVA_DISPLAY_ID),
    cruz: get(PAT_CRUZ_DISPLAY_ID),
    santos: get(PAT_SANTOS_DISPLAY_ID),
    reyes: get(PAT_REYES_DISPLAY_ID),
    garcia: get(PAT_GARCIA_DISPLAY_ID),
    mendoza: get(PAT_MENDOZA_DISPLAY_ID),
    aguilar: get(PAT_AGUILAR_DISPLAY_ID),
    bautista: get(PAT_BAUTISTA_DISPLAY_ID),
    fernandez: get(PAT_FERNANDEZ_DISPLAY_ID),
    gonzales: get(PAT_GONZALES_DISPLAY_ID),
    herrera: get(PAT_HERRERA_DISPLAY_ID),
    ilagan: get(PAT_ILAGAN_DISPLAY_ID),
    javier: get(PAT_JAVIER_DISPLAY_ID),
    katipunan: get(PAT_KATIPUNAN_DISPLAY_ID),
    luna: get(PAT_LUNA_DISPLAY_ID),
    navarro: get(PAT_NAVARRO_DISPLAY_ID),
    ocampo: get(PAT_OCAMPO_DISPLAY_ID),
    rivera: get(PAT_RIVERA_DISPLAY_ID),
  }
}
