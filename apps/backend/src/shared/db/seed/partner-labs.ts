/**
 * Seed section — partner laboratories.
 *
 * Returns `byCode: Map<string, number>` (displayId → bigint PK) so dependent
 * seeds (lab_orders) can resolve laboratory FKs without re-querying.
 *
 * Restored in W3.b.3 (2026-05-19) with two-tier ID model:
 *   - `displayId` column holds `LAB_<8-char Crockford base32>`
 *   - Internal bigint PK returned via .returning()
 */

import { and, eq } from 'drizzle-orm'
import * as s from '../schema.js'
import { db } from './db.js'
import {
  LAB_HIPRECISION_DISPLAY_ID,
  LAB_STLUKES_DISPLAY_ID,
  LAB_RITM_DISPLAY_ID,
} from './constants.js'

export async function seedPartnerLabs(opts: {
  tenantId: string
  createdById: number
}): Promise<{ byCode: Map<string, number> }> {
  const labRows = [
    {
      displayId: LAB_HIPRECISION_DISPLAY_ID,
      name: 'HiPrecision Diagnostics',
      contactName: 'Dr. Rosario Manalo',
      contactNumber: '(02) 8887-3500',
      email: 'lab@hiprecision.com.ph',
      address: '3F Regis Center, 327 Katipunan Ave, QC',
      apiConfig: JSON.stringify({
        baseUrl: 'https://api.hiprecision.com.ph/v2',
        authType: 'bearer',
        apiKey: '***REDACTED***',
        turnaroundHours: 24,
        supported_tests: ['FNAT', 'CBC', 'Wound Culture'],
      }),
    },
    {
      displayId: LAB_STLUKES_DISPLAY_ID,
      name: "St. Luke's Medical Center Laboratory",
      contactName: 'Lab Coordinator',
      contactNumber: '(02) 8723-0101',
      email: 'laboratory@stlukes.com.ph',
      address: '279 E Rodriguez Sr. Ave, QC',
      apiConfig: null,
    },
    {
      displayId: LAB_RITM_DISPLAY_ID,
      name: 'Research Institute for Tropical Medicine (RITM)',
      contactName: 'Rabies Unit',
      contactNumber: '(02) 8809-9712',
      email: 'rabiesunit@ritm.doh.gov.ph',
      address: 'Filinvest Corporate City, Alabang, Muntinlupa',
      apiConfig: JSON.stringify({
        baseUrl: 'https://elims.ritm.gov.ph/api',
        authType: 'api_key',
        apiKey: '***REDACTED***',
        turnaroundHours: 72,
        supported_tests: ['FNAT', 'Direct Fluorescent Antibody'],
      }),
    },
  ]

  const byCode = new Map<string, number>()

  for (const lab of labRows) {
    const [inserted] = await db
      .insert(s.partnerLaboratories)
      .values({
        ...lab,
        tenantId: opts.tenantId,
        createdById: opts.createdById,
      })
      .onConflictDoNothing()
      .returning({ id: s.partnerLaboratories.id, displayId: s.partnerLaboratories.displayId })

    if (inserted) {
      byCode.set(inserted.displayId, inserted.id)
      continue
    }

    // onConflictDoNothing returned nothing — re-query to keep the map populated
    // on idempotent re-runs.
    const [existing] = await db
      .select({ id: s.partnerLaboratories.id, displayId: s.partnerLaboratories.displayId })
      .from(s.partnerLaboratories)
      .where(
        and(
          eq(s.partnerLaboratories.tenantId, opts.tenantId),
          eq(s.partnerLaboratories.displayId, lab.displayId),
        ),
      )
      .limit(1)
    if (existing) byCode.set(existing.displayId, existing.id)
  }

  console.log(`  ✓ partner labs (${byCode.size})`)
  return { byCode }
}
