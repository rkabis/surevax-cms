/**
 * Seed section — patient emergency contacts.
 *
 * Fills the "Emergency contact" block on the patient detail rail for a
 * representative spread of patients (adults with next-of-kin, seniors with
 * adult children). No display_id — scoped to patient via FK.
 */

import * as s from '../schema.js'
import { db } from './db.js'
import {
  PAT_DELACRUZ_DISPLAY_ID,
  PAT_TORRES_DISPLAY_ID,
  PAT_LIM_DISPLAY_ID,
  PAT_SANTOS_DISPLAY_ID,
  PAT_BAUTISTA_DISPLAY_ID,
  PAT_OCAMPO_DISPLAY_ID,
  PAT_JAVIER_DISPLAY_ID,
  PAT_RIVERA_DISPLAY_ID,
} from './constants.js'

type ContactSeed = {
  patientDisplayId: string
  name: string
  relationship: string
  phoneNumber: string
  email?: string
  isPrimary: boolean
}

const CONTACT_ROWS: ContactSeed[] = [
  {
    patientDisplayId: PAT_DELACRUZ_DISPLAY_ID,
    name: 'Antonio Dela Cruz',
    relationship: 'Spouse',
    phoneNumber: '0917-123-0000',
    isPrimary: true,
  },
  {
    patientDisplayId: PAT_TORRES_DISPLAY_ID,
    name: 'Carmen Torres',
    relationship: 'Mother',
    phoneNumber: '0918-234-0000',
    isPrimary: true,
  },
  {
    patientDisplayId: PAT_LIM_DISPLAY_ID,
    name: 'Henry Lim',
    relationship: 'Spouse',
    phoneNumber: '0919-345-0000',
    email: 'henry.lim@company.com',
    isPrimary: true,
  },
  {
    patientDisplayId: PAT_SANTOS_DISPLAY_ID,
    name: 'Liza Santos',
    relationship: 'Spouse',
    phoneNumber: '0921-567-0000',
    isPrimary: true,
  },
  {
    patientDisplayId: PAT_BAUTISTA_DISPLAY_ID,
    name: 'Marco Bautista',
    relationship: 'Son',
    phoneNumber: '0926-012-0000',
    isPrimary: true,
  },
  {
    patientDisplayId: PAT_OCAMPO_DISPLAY_ID,
    name: 'Teresa Ocampo',
    relationship: 'Daughter',
    phoneNumber: '0934-890-0000',
    email: 'teresa.ocampo@email.com',
    isPrimary: true,
  },
  {
    patientDisplayId: PAT_JAVIER_DISPLAY_ID,
    name: 'Marites Javier',
    relationship: 'Spouse',
    phoneNumber: '0931-567-0000',
    isPrimary: true,
  },
  {
    patientDisplayId: PAT_RIVERA_DISPLAY_ID,
    name: 'Ramon Rivera',
    relationship: 'Spouse',
    phoneNumber: '0935-901-0000',
    isPrimary: true,
  },
]

export async function seedPatientEmergencyContacts(args: {
  tenantId: string
  patients: Map<string, number>
  createdById: number
}): Promise<void> {
  const { tenantId, patients, createdById } = args

  let inserted = 0
  for (const c of CONTACT_ROWS) {
    const patientId = patients.get(c.patientDisplayId)
    if (patientId === undefined) {
      throw new Error(`seedPatientEmergencyContacts: missing patient ${c.patientDisplayId}`)
    }
    const row = await db
      .insert(s.patientEmergencyContacts)
      .values({
        tenantId,
        patientId,
        name: c.name,
        relationship: c.relationship,
        phoneNumber: c.phoneNumber,
        email: c.email ?? null,
        isPrimary: c.isPrimary,
        createdById,
      })
      .onConflictDoNothing()
      .returning({ id: s.patientEmergencyContacts.id })

    if (row[0]) inserted++
  }

  console.log(`  ✓ patient emergency contacts (${inserted})`)
}
