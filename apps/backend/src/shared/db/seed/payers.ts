/**
 * Seed section — payer profiles (HMOs, government, corporate wellness).
 *
 * Returns `byDisplayId: Map<displayId, bigint>` so dependent seeds
 * (transactions, claims) can resolve payer FKs without re-querying.
 */

import { and, eq } from 'drizzle-orm'
import * as s from '../schema.js'
import { db } from './db.js'
import {
  PAYER_MAXICARE_DISPLAY_ID,
  PAYER_INTELLICARE_DISPLAY_ID,
  PAYER_GLOBE_DISPLAY_ID,
  PAYER_PHILHEALTH_DISPLAY_ID,
  PAYER_HATI_HEALTH_DISPLAY_ID,
  PAYER_FORTICARE_DISPLAY_ID,
  PAYER_MEDASIA_DISPLAY_ID,
  PAYER_PHILBRITISH_DISPLAY_ID,
  PAYER_HMO_DISPLAY_ID,
  PAYER_HPPI_DISPLAY_ID,
  PAYER_MWELL_DISPLAY_ID,
  PAYER_AYALA_MALLS_DISPLAY_ID,
  PAYER_AVEGA_DISPLAY_ID,
} from './constants.js'

export async function seedPayers(opts: {
  tenantId: string
  createdById: number
}): Promise<{ byDisplayId: Map<string, number> }> {
  const payerRows = [
    {
      displayId: PAYER_MAXICARE_DISPLAY_ID,
      name: 'Maxicare Health Corp',
      payerType: 'HMO' as const,
      contactName: 'Carla Domingo',
      contactNumber: '(02) 8799-9100',
      email: 'corporate@maxicare.com.ph',
      address: '3/F Maxicare Tower, 1286 Acacia Ave, Alabang',
      paymentTermsDays: 30,
      notes: 'LOA required per visit. Accreditation #: MC-SVRX-2024-001',
    },
    {
      displayId: PAYER_INTELLICARE_DISPLAY_ID,
      name: 'Intellicare (PhilCare)',
      payerType: 'HMO' as const,
      contactName: 'Rogelio Macaraeg',
      contactNumber: '(02) 8580-0005',
      email: 'accreditation@intellicare.com.ph',
      address: '33 Paseo de Roxas, Makati City',
      paymentTermsDays: 30,
      notes: 'E-LOA accepted. Max coverage PHP 5,000 per visit.',
    },
    {
      displayId: PAYER_GLOBE_DISPLAY_ID,
      name: 'Globe Telecom, Inc.',
      payerType: 'Corporate' as const,
      contactName: 'HR Benefits — Marivic Santos',
      contactNumber: '(02) 7730-1000',
      email: 'hrbenefits@globe.com.ph',
      address: 'The Globe Tower, 32nd St. cor. 7th Ave., BGC',
      paymentTermsDays: 45,
      notes: 'Annual wellness package. 50 covered employees.',
    },
    {
      displayId: PAYER_PHILHEALTH_DISPLAY_ID,
      name: 'PhilHealth',
      payerType: 'Government' as const,
      contactName: 'Accreditation Unit',
      contactNumber: '(02) 8441-7444',
      email: 'accreditation@philhealth.gov.ph',
      address: '709 CityState Centre Bldg., Shaw Blvd., Pasig',
      paymentTermsDays: 60,
      notes: 'Accreditation #: PH-QC-2023-ABTC. Quarterly billing cycle.',
    },
    // Corporate wellness partners — drive partner-rate pricing via service_prices.
    {
      displayId: PAYER_HATI_HEALTH_DISPLAY_ID,
      name: 'Hati Health',
      payerType: 'Corporate' as const,
      contactName: 'Hati Health Partnerships',
      contactNumber: '(02) 5310-8888',
      email: 'partners@hatihealth.com',
      address: 'BGC, Taguig',
      paymentTermsDays: 30,
      notes: 'Corporate wellness partner — discounted rates wired via service_prices.',
    },
    {
      displayId: PAYER_FORTICARE_DISPLAY_ID,
      name: 'Forticare',
      payerType: 'Corporate' as const,
      contactName: 'Forticare Accounts',
      contactNumber: '(02) 8888-5555',
      email: 'accounts@forticare.com.ph',
      address: 'Ortigas Center, Pasig',
      paymentTermsDays: 30,
      notes: 'Premium corporate wellness — uplift pricing per service_prices.',
    },
    {
      displayId: PAYER_MEDASIA_DISPLAY_ID,
      name: 'MedAsia / Forticare / LLBI',
      payerType: 'Corporate' as const,
      contactName: 'MedAsia Partner Network',
      contactNumber: '(02) 7000-1234',
      email: 'partner@medasia.ph',
      address: 'Makati City',
      paymentTermsDays: 45,
      notes: 'Partner network rate for ABTC services (Anti-Rabies + adjuncts).',
    },
    {
      displayId: PAYER_PHILBRITISH_DISPLAY_ID,
      name: 'Philbritish',
      payerType: 'Corporate' as const,
      contactName: 'Philbritish Wellness',
      contactNumber: '(02) 8123-4567',
      email: 'wellness@philbritish.com.ph',
      address: 'Makati City',
      paymentTermsDays: 30,
      notes: 'Discounted consultation rate (₱400) for member employees.',
    },
    // ── The three tiers the clinic's own Vaccine sheet prices against ────────
    {
      displayId: PAYER_HMO_DISPLAY_ID,
      name: 'HMO (standard card rate)',
      payerType: 'HMO' as const,
      contactName: 'HMO desk',
      contactNumber: null,
      email: null,
      address: null,
      paymentTermsDays: 45,
      notes:
        'The clinic-wide HMO card rate, the highest tier in the Vaccine sheet (`HMO` on 19 rows). Not one insurer: any card-paying patient bills at this rate unless their own insurer has a contract. Named insurers (Maxicare, Intellicare) keep their own profiles.',
    },
    {
      displayId: PAYER_HPPI_DISPLAY_ID,
      name: 'HPPI',
      payerType: 'Corporate' as const,
      contactName: 'HPPI accounts',
      contactNumber: null,
      email: null,
      address: null,
      paymentTermsDays: 30,
      notes:
        'Sits just under the HMO rate. Present only on the anti-rabies line (PEP IM/ID, ERIG, HRIG, HTIG, ATS, TT): the sheet has no HPPI price for any elective vaccine.',
    },
    {
      displayId: PAYER_MWELL_DISPLAY_ID,
      name: 'mWell',
      payerType: 'Corporate' as const,
      contactName: 'mWell PH partnerships',
      contactNumber: null,
      email: null,
      address: null,
      paymentTermsDays: 30,
      notes:
        'Telehealth marketplace partner, the broadest partner tier in the sheet (24 rows). Prices are a small uplift on the base rate (ARV PEP unchanged, most vaccines +₱135 to ₱890), consistent with a platform commission.',
    },
    {
      // A4-approved prerequisite. Its +15% source markup remains a separate
      // effective-dated service-price import; this profile itself asserts no
      // unobserved rate.
      displayId: PAYER_AYALA_MALLS_DISPLAY_ID,
      name: 'Ayala Malls (UPTC)',
      payerType: 'Corporate' as const,
      contactName: null,
      contactNumber: null,
      email: null,
      address: null,
      paymentTermsDays: null,
      notes: 'Legacy migration payer approved in A4; source records a +15% partner markup.',
    },
    {
      displayId: PAYER_AVEGA_DISPLAY_ID,
      name: 'Avega Managed Care',
      payerType: 'HMO' as const,
      contactName: null,
      contactNumber: null,
      email: null,
      address: null,
      paymentTermsDays: null,
      notes:
        'Legacy transaction payer present in the closed AppSheet payment enum; no price or contract terms inferred.',
    },
  ]

  const byDisplayId = new Map<string, number>()

  for (const p of payerRows) {
    const [inserted] = await db
      .insert(s.payerProfiles)
      .values({
        ...p,
        tenantId: opts.tenantId,
        createdById: opts.createdById,
      })
      .onConflictDoNothing()
      .returning({ id: s.payerProfiles.id, displayId: s.payerProfiles.displayId })

    if (inserted) {
      byDisplayId.set(inserted.displayId, inserted.id)
      continue
    }

    // onConflictDoNothing returned nothing — re-query to keep the map populated
    // on idempotent re-runs.
    const [existing] = await db
      .select({ id: s.payerProfiles.id, displayId: s.payerProfiles.displayId })
      .from(s.payerProfiles)
      .where(
        and(
          eq(s.payerProfiles.tenantId, opts.tenantId),
          eq(s.payerProfiles.displayId, p.displayId),
        ),
      )
      .limit(1)
    if (existing) byDisplayId.set(existing.displayId, existing.id)
  }

  console.log(`  ✓ payer profiles (${byDisplayId.size})`)
  return { byDisplayId }
}
