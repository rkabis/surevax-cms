/**
 * Seed section — tenant + branches.
 *
 * Two-tier IDs (W2, 2026-05-19):
 *   - `tenants.id` IS the slug (text). No prefix.
 *   - `branches.id` is bigserial; `display_id` = `${slug}.${code}`.
 *
 * Returns the captured bigint branch IDs so downstream seeds can FK against
 * them. The tenant's slug stays text (same as `tenants.id`).
 */

import { sql } from 'drizzle-orm'
import * as s from '../schema.js'
import { db } from './db.js'
import { branchDisplayId } from '../../utils/displayId.js'
import {
  TENANT_SLUG,
  TENANT_SLUG_LC,
  BRANCH_CODE_HST,
  BRANCH_CODE_TMG,
  BRANCH_CODE_ABF,
  BRANCH_CODE_TAG,
  BRANCH_CODE_SAL,
  BRANCH_CODE_MYS,
  BRANCH_CODE_CNT,
  BRANCH_CODE_SJN,
  BRANCH_CODE_NOV,
  BRANCH_CODE_MRK,
  BRANCH_CODE_PSG,
  BRANCH_CODE_STM,
  BRANCH_CODE_ALB,
  BRANCH_CODE_VRT,
} from './constants.js'

export type SeededBranches = {
  hst: number
  /** Timog. Key stays `tim` for callers; the branch CODE is `TMG` (see constants). */
  tim: number
  abf: number
  tag: number
  sal: number
  mys: number
  cnt: number
  sjn: number
  nov: number
  mrk: number
  psg: number
  stm: number
  alb: number
  vrt: number
}

export type SeededTenant = {
  tenantId: string // slug, e.g. 'SVX'
  branches: SeededBranches
  /** Every seeded branch id keyed by its 3-letter code. */
  branchIdByCode: Map<string, number>
}

export async function seedTenantAndBranches(): Promise<SeededTenant> {
  // ── Tenant ────────────────────────────────────────────────────────────────
  await db
    .insert(s.tenants)
    .values({
      id: TENANT_SLUG,
      name: 'SureVax Demo Clinic',
      // tenants.id and tenants.slug carry the same value — the legacy
      // `surevax-demo` lowercase slug was retired so callers send a single
      // consistent X-Tenant-Slug header regardless of resolution path.
      slug: TENANT_SLUG,
    })
    .onConflictDoNothing()

  // Provision the per-tenant MRN sequence (idempotent — the SQL function uses
  // `CREATE SEQUENCE IF NOT EXISTS`).
  await db.execute(sql`SELECT provision_tenant_counters(${TENANT_SLUG_LC})`)

  // ── Branches ──────────────────────────────────────────────────────────────
  const branchRows = [
    {
      code: BRANCH_CODE_HST,
      name: 'SureVax Holy Spirit Branch',
      address: 'Unit 119, 70 Holy Spirit Dr, Quezon City, 1127 Metro Manila',
      city: 'Quezon City',
      province: 'Metro Manila',
      contactNumber: '02-8123-4567',
      email: 'surevax.hs@gmail.com',
    },
    {
      code: BRANCH_CODE_TMG,
      name: 'SureVax Timog Avenue Branch',
      address: 'Unit 205, ENC Tower, Mother Ignacia Avenue, Quezon City',
      city: 'Quezon City',
      province: 'Metro Manila',
      contactNumber: null,
      email: 'surevax.timog@gmail.com',
    },
    {
      code: BRANCH_CODE_ABF,
      name: 'SureVax Aguirre Branch',
      address: 'C2WF+48F, Aguirre Ave, Parañaque, 1700 Metro Manila',
      city: 'Parañaque',
      province: 'Metro Manila',
      contactNumber: null,
      email: 'surevax.abf@gmail.com',
    },
    {
      code: BRANCH_CODE_TAG,
      name: 'SureVax Taguig Branch',
      address:
        'Unit No. 3B, JTC Commercial Building, 6140 P Cayetano Blvd, Taguig, 1639 Metro Manila',
      city: 'Taguig',
      province: 'Metro Manila',
      contactNumber: null,
      email: 'surevax.taguig@gmail.com',
    },
    {
      code: BRANCH_CODE_SAL,
      name: 'SureVax Salcedo Branch',
      address:
        'Unit LG-08, Alfaro Place, Salcedo Village, 146 L.P. Leviste Street, Makati, 1227 Metro Manila',
      city: 'Makati',
      province: 'Metro Manila',
      contactNumber: null,
      email: 'surevax.salcedo@gmail.com',
    },
    {
      code: BRANCH_CODE_MYS,
      name: 'SureVax Maysilo Branch',
      address: 'Unit 3C, 315 Maysilo Cir, Mandaluyong City, 1550 Metro Manila',
      city: 'Mandaluyong',
      province: 'Metro Manila',
      contactNumber: null,
      email: 'surevax.maysilo@gmail.com',
    },
    {
      code: BRANCH_CODE_CNT,
      name: 'SureVax Cainta Branch',
      address:
        'Unit 15, Ledor Commercial Center, A. Bonifacio Avenue, Corner Samonte St, Cainta, 1900 Rizal',
      city: 'Cainta',
      province: 'Rizal',
      contactNumber: null,
      email: 'surevax.cainta@gmail.com',
    },
    {
      code: BRANCH_CODE_SJN,
      name: 'SureVax San Juan Branch',
      address: 'Unit 2, Little Baguio, 19 Barasoain, San Juan City, 1500 Metro Manila',
      city: 'San Juan',
      province: 'Metro Manila',
      contactNumber: null,
      email: 'surevax.sanjuan@gmail.com',
    },
    {
      code: BRANCH_CODE_NOV,
      name: 'SureVax Novaliches Branch',
      address: 'Unit 4 Level 2, 917 Quirino Hwy, Novaliches, Quezon City, 1117 Metro Manila',
      city: 'Quezon City',
      province: 'Metro Manila',
      contactNumber: null,
      email: 'surevax.novaliches@gmail.com',
    },
    {
      code: BRANCH_CODE_MRK,
      name: 'SureVax Marikina Branch',
      address: 'Unit C1 Building, 2/F, 1 Liwasang Kalayaan, Marikina, 1800 Metro Manila',
      city: 'Quezon City',
      province: 'Metro Manila',
      contactNumber: null,
      email: 'surevax.marikina@gmail.com',
    },
    {
      code: BRANCH_CODE_PSG,
      name: 'SureVax Pasig Branch',
      address: 'Unit 212, Pelbel Building I, 2019 Shaw Blvd, Pasig, 1603 Metro Manila',
      city: 'Pasig',
      province: 'Metro Manila',
      contactNumber: null,
      email: 'surevax.pasig@gmail.com',
    },
    {
      code: BRANCH_CODE_STM,
      name: 'SureVax Sta Mesa Branch',
      address: 'Unit 201B, Residencia de Manila Suites, Sta Mesa, Manila, Metro Manila',
      city: 'Manila',
      province: 'Metro Manila',
      contactNumber: null,
      email: 'surevax.stamesa@gmail.com',
    },
    {
      code: BRANCH_CODE_ALB,
      name: 'SureVax Alabang Branch',
      address: 'Unit 810, Filinvest Corporate City, Alabang, Muntinlupa, 1781 Metro Manila',
      city: 'Muntinlupa',
      province: 'Metro Manila',
      contactNumber: null,
      email: 'surevax.alabang15@gmail.com',
    },
    {
      // Teleconsult / home-service book of business, not a room. Kept as a real
      // branch row because the roster assigns 13 nurses to it and doses booked
      // against it still need a branch to hang from.
      code: BRANCH_CODE_VRT,
      name: 'SureVax Virtual Branch',
      address: 'Teleconsult and home service (no physical site)',
      city: 'Quezon City',
      province: 'Metro Manila',
      contactNumber: null,
      email: 'surevax.virtual@gmail.com',
    },
  ]

  const byCode = new Map<string, number>()
  for (const branch of branchRows) {
    const [row] = await db
      .insert(s.branches)
      .values({
        tenantId: TENANT_SLUG,
        displayId: branchDisplayId(TENANT_SLUG, branch.code),
        code: branch.code,
        name: branch.name,
        address: branch.address,
        city: branch.city,
        province: branch.province,
        contactNumber: branch.contactNumber,
        email: branch.email,
      })
      .onConflictDoNothing()
      .returning({ id: s.branches.id, code: s.branches.code })

    if (row) {
      byCode.set(row.code, row.id)
    } else {
      // ON CONFLICT path — row already exists. Look it up.
      const [existing] = await db
        .select({ id: s.branches.id, code: s.branches.code })
        .from(s.branches)
        .where(sql`${s.branches.tenantId} = ${TENANT_SLUG} AND ${s.branches.code} = ${branch.code}`)
        .limit(1)
      if (existing) byCode.set(existing.code, existing.id)
    }
  }

  const need = (code: string): number => {
    const id = byCode.get(code)
    if (id === undefined) throw new Error(`seedTenantAndBranches: missing branch ${code}`)
    return id
  }

  console.log(`  ✓ tenant + ${branchRows.length} branches`)

  return {
    tenantId: TENANT_SLUG,
    branches: {
      hst: need(BRANCH_CODE_HST),
      tim: need(BRANCH_CODE_TMG),
      abf: need(BRANCH_CODE_ABF),
      tag: need(BRANCH_CODE_TAG),
      sal: need(BRANCH_CODE_SAL),
      mys: need(BRANCH_CODE_MYS),
      cnt: need(BRANCH_CODE_CNT),
      sjn: need(BRANCH_CODE_SJN),
      nov: need(BRANCH_CODE_NOV),
      mrk: need(BRANCH_CODE_MRK),
      psg: need(BRANCH_CODE_PSG),
      stm: need(BRANCH_CODE_STM),
      alb: need(BRANCH_CODE_ALB),
      vrt: need(BRANCH_CODE_VRT),
    },
    /** Every branch by code: used to attach the nursing roster and the
     *  per-branch `Branch` kiosk logins. */
    branchIdByCode: byCode,
  }
}
