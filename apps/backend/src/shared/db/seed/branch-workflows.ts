/**
 * Seed section — minimal per-branch workflow fixtures.
 *
 * `docs/nurse-testing-readiness.md` (R6, R9) flags a real gap: every seeded
 * lot lived at HST and every seeded patient but one (Rivera, at TMG for the
 * R3 cross-branch masking fixture) was homed at HST, so a nurse logging into
 * any other branch's kiosk saw an empty worklist and no administrable stock.
 *
 * This module tops up every OTHER seeded branch with the minimum needed to
 * exercise the daily loop there: one patient, one dose due today (Scheduled,
 * not yet administered — a nurse should be able to work it live), the stock
 * to administer it, and one paid transaction so R4/R10 have per-branch data
 * too. Deliberately separate from patients.ts/encounters.ts/inventory.ts/
 * transactions.ts rather than folded into their hand-authored fixture lists,
 * so this doesn't disturb the 21-patient/15-encounter golden fixture set
 * other tests and docs already depend on by exact display_id.
 *
 * Every branch gets the SAME shape on purpose (Tetanus Booster: single dose,
 * no physician auth, `AbhayTox` the only eligible product) — the point is
 * broad, uniform coverage per branch, not clinical variety.
 */

import { and, eq, sql } from 'drizzle-orm'
import * as s from '../schema.js'
import { db } from './db.js'
import { today, dateStr, daysFromNow, seqSuffix } from './helpers.js'
import { formatMrn } from '../../utils/displayId.js'
import {
  TENANT_SLUG_LC,
  SVC_TT,
  SVC_CONSULTATION,
  SOT_TT_BOOSTER,
  PAT_RAMOS_DISPLAY_ID,
  PAT_DOMINGO_DISPLAY_ID,
  PAT_CASTILLO_DISPLAY_ID,
  PAT_SALAZAR_DISPLAY_ID,
  PAT_MANALO_DISPLAY_ID,
  PAT_PASCUAL_DISPLAY_ID,
  PAT_AQUINO_DISPLAY_ID,
  PAT_FLORES_DISPLAY_ID,
  PAT_MARQUEZ_DISPLAY_ID,
  PAT_VALDEZ_DISPLAY_ID,
  PAT_TOLENTINO_DISPLAY_ID,
  PAT_RAMIREZ_DISPLAY_ID,
  PAT_ESPINO_DISPLAY_ID,
} from './constants.js'

/**
 * Offset for this module's deterministic `seqSuffix` display IDs.
 *
 * Every display_id here MUST be derived from the row index, never from
 * `displayId()` (random). `onConflictDoNothing()` can only skip a re-inserted
 * row if something actually conflicts, and a fresh random display_id never
 * does — so a second `pnpm db:seed` silently duplicated every dose, lot and
 * transaction this module writes. (Observed for real: a redundant reseed took
 * Railway from 64 to 77 clinical_orders and 29 to 58 transactions.) The seed
 * is documented as safe to re-run mid-pilot, so it has to hold.
 *
 * 500 keeps these clear of the ranges the golden fixtures already use:
 * encounters.ts allocates PSO/ORD/CNS from 0, inventory.ts allocates LOT 1-28.
 */
const SEQ_BASE = 500

type BranchWorkflowSeed = {
  branchCode: string
  patientDisplayId: string
  firstName: string
  lastName: string
  contactNumber: string
  sex: 'Male' | 'Female'
  dateOfBirth: string
}

const BRANCH_WORKFLOW_ROWS: BranchWorkflowSeed[] = [
  {
    branchCode: 'TMG',
    patientDisplayId: PAT_RAMOS_DISPLAY_ID,
    firstName: 'Beatriz',
    lastName: 'Ramos',
    contactNumber: '0936-100-2001',
    sex: 'Female',
    dateOfBirth: '1991-02-14',
  },
  {
    branchCode: 'ABF',
    patientDisplayId: PAT_DOMINGO_DISPLAY_ID,
    firstName: 'Ferdinand',
    lastName: 'Domingo',
    contactNumber: '0936-100-2002',
    sex: 'Male',
    dateOfBirth: '1988-06-21',
  },
  {
    branchCode: 'TAG',
    patientDisplayId: PAT_CASTILLO_DISPLAY_ID,
    firstName: 'Corazon',
    lastName: 'Castillo',
    contactNumber: '0936-100-2003',
    sex: 'Female',
    dateOfBirth: '1994-09-03',
  },
  {
    branchCode: 'SAL',
    patientDisplayId: PAT_SALAZAR_DISPLAY_ID,
    firstName: 'Emmanuel',
    lastName: 'Salazar',
    contactNumber: '0936-100-2004',
    sex: 'Male',
    dateOfBirth: '1979-12-11',
  },
  {
    branchCode: 'MYS',
    patientDisplayId: PAT_MANALO_DISPLAY_ID,
    firstName: 'Divina',
    lastName: 'Manalo',
    contactNumber: '0936-100-2005',
    sex: 'Female',
    dateOfBirth: '2001-04-27',
  },
  {
    branchCode: 'CNT',
    patientDisplayId: PAT_PASCUAL_DISPLAY_ID,
    firstName: 'Rolando',
    lastName: 'Pascual',
    contactNumber: '0936-100-2006',
    sex: 'Male',
    dateOfBirth: '1986-08-09',
  },
  {
    branchCode: 'SJN',
    patientDisplayId: PAT_AQUINO_DISPLAY_ID,
    firstName: 'Imelda',
    lastName: 'Aquino',
    contactNumber: '0936-100-2007',
    sex: 'Female',
    dateOfBirth: '1993-01-30',
  },
  {
    branchCode: 'NOV',
    patientDisplayId: PAT_FLORES_DISPLAY_ID,
    firstName: 'Bienvenido',
    lastName: 'Flores',
    contactNumber: '0936-100-2008',
    sex: 'Male',
    dateOfBirth: '1997-07-16',
  },
  {
    branchCode: 'MRK',
    patientDisplayId: PAT_MARQUEZ_DISPLAY_ID,
    firstName: 'Remedios',
    lastName: 'Marquez',
    contactNumber: '0936-100-2009',
    sex: 'Female',
    dateOfBirth: '1984-11-05',
  },
  {
    branchCode: 'PSG',
    patientDisplayId: PAT_VALDEZ_DISPLAY_ID,
    firstName: 'Alfredo',
    lastName: 'Valdez',
    contactNumber: '0936-100-2010',
    sex: 'Male',
    dateOfBirth: '1990-03-22',
  },
  {
    branchCode: 'STM',
    patientDisplayId: PAT_TOLENTINO_DISPLAY_ID,
    firstName: 'Josefina',
    lastName: 'Tolentino',
    contactNumber: '0936-100-2011',
    sex: 'Female',
    dateOfBirth: '1982-05-18',
  },
  {
    branchCode: 'ALB',
    patientDisplayId: PAT_RAMIREZ_DISPLAY_ID,
    firstName: 'Gregorio',
    lastName: 'Ramirez',
    contactNumber: '0936-100-2012',
    sex: 'Male',
    dateOfBirth: '1996-10-08',
  },
  {
    branchCode: 'VRT',
    patientDisplayId: PAT_ESPINO_DISPLAY_ID,
    firstName: 'Marissa',
    lastName: 'Espino',
    contactNumber: '0936-100-2013',
    sex: 'Female',
    dateOfBirth: '1989-02-25',
  },
]

export async function seedBranchWorkflows(args: {
  tenantId: string
  /** Every seeded branch bigint id, keyed by its 3-letter code. */
  branchIdByCode: Map<string, number>
  /** `manufacturer name -> product bigint`, from `seedCatalog()`. */
  products: Map<string, number>
  providerId: number
  nurseId: number
  cashierId: number
}): Promise<void> {
  const { tenantId, branchIdByCode, products, providerId, nurseId, cashierId } = args

  const abhayToxProductId = products.get('AbhayTox')
  if (abhayToxProductId === undefined) {
    console.log('  ↷ branch workflows (skipped: AbhayTox product not seeded)')
    return
  }

  // Single-item template — resolve once, reused for every branch.
  const [ttItem] = await db
    .select({
      dayOffset: s.standingOrderTemplateItems.dayOffset,
      sequence: s.standingOrderTemplateItems.sequence,
      quantity: s.standingOrderTemplateItems.quantity,
    })
    .from(s.standingOrderTemplateItems)
    .where(
      and(
        eq(s.standingOrderTemplateItems.tenantId, tenantId),
        eq(s.standingOrderTemplateItems.templateId, SOT_TT_BOOSTER),
      ),
    )
    .limit(1)
  if (!ttItem) {
    throw new Error(
      'seedBranchWorkflows: SOT_TT_BOOSTER has no template items — did seedStandingOrders run first?',
    )
  }

  const startedAt = today()
  const expiryDate = dateStr(daysFromNow(600))

  let patientsInserted = 0
  let dosesInserted = 0
  let lotsInserted = 0
  let transactionsInserted = 0

  for (const [i, row] of BRANCH_WORKFLOW_ROWS.entries()) {
    const branchId = branchIdByCode.get(row.branchCode)
    if (branchId === undefined) {
      console.log(`  ↷ branch workflow for ${row.branchCode} skipped: branch not seeded`)
      continue
    }

    // ── Patient ────────────────────────────────────────────────────────────
    const seqName = `mrn_seq_${TENANT_SLUG_LC}`
    const [seqRow] = (await db.execute(
      sql`SELECT nextval(${seqName}) AS next`,
    )) as unknown as Array<{ next: number | string }>
    const mrn = formatMrn(Number(seqRow!.next))

    const insertedPatient = await db
      .insert(s.patients)
      .values({
        displayId: row.patientDisplayId,
        tenantId,
        mrn,
        homeBranchId: branchId,
        firstName: row.firstName,
        lastName: row.lastName,
        contactNumber: row.contactNumber,
        sex: row.sex,
        dateOfBirth: row.dateOfBirth,
        civilStatus: 'Single',
        nationality: 'Filipino',
        address: `${row.branchCode} branch catchment area`,
        city: 'Metro Manila',
        province: 'Metro Manila',
        smsOptIn: true,
        onboardingChannel: 'Walk-in',
        createdById: nurseId,
      })
      .onConflictDoNothing()
      .returning({ id: s.patients.id })

    let patientId = insertedPatient[0]?.id
    if (patientId === undefined) {
      const [existing] = await db
        .select({ id: s.patients.id })
        .from(s.patients)
        .where(
          and(eq(s.patients.tenantId, tenantId), eq(s.patients.displayId, row.patientDisplayId)),
        )
        .limit(1)
      if (!existing)
        throw new Error(`seedBranchWorkflows: failed to resolve ${row.patientDisplayId}`)
      patientId = existing.id
    } else {
      patientsInserted++
    }

    // ── Encounter (Open) + PSO (Active) + one Scheduled dose due today ──────
    const encounterDisplayId = `ENC_${seqSuffix(SEQ_BASE + i, 8)}`
    const [encounter] = await db
      .insert(s.encounters)
      .values({
        displayId: encounterDisplayId,
        tenantId,
        patientId,
        branchId,
        providerId,
        createdById: nurseId,
        specialty: 'Vaccination',
        status: 'Open',
        visitNo: 1,
        startedAt,
      })
      .onConflictDoNothing()
      .returning({ id: s.encounters.id, displayId: s.encounters.displayId })

    let encounterId = encounter?.id
    let resolvedEncounterDisplayId = encounter?.displayId
    if (encounterId === undefined) {
      const [existing] = await db
        .select({ id: s.encounters.id, displayId: s.encounters.displayId })
        .from(s.encounters)
        .where(
          and(
            eq(s.encounters.tenantId, tenantId),
            eq(s.encounters.patientId, patientId),
            eq(s.encounters.startedAt, startedAt),
          ),
        )
        .limit(1)
      encounterId = existing?.id
      resolvedEncounterDisplayId = existing?.displayId
    }

    if (encounterId !== undefined) {
      // Informed consent (H7 — assertActiveConsent gates every clinical
      // write path). Without this, administering the due-today dose seeded
      // below would 403 CONSENT_REVOKED for every one of these patients.
      await db
        .insert(s.consents)
        .values({
          displayId: `CNS_${seqSuffix(SEQ_BASE + i, 8)}`,
          tenantId,
          patientId,
          encounterId,
          consentType: 'informed_consent',
          scope: 'encounter',
          scopeRefType: 'encounter',
          scopeRefId: resolvedEncounterDisplayId ?? encounterDisplayId,
          consenterRelation: 'Patient',
          visProvided: true,
          visLanguage: 'en',
          obtainedAt: startedAt,
          obtainedById: nurseId,
          consentLanguage: 'en',
          createdById: nurseId,
        })
        .onConflictDoNothing()

      const [pso] = await db
        .insert(s.patientStandingOrders)
        .values({
          displayId: `PSO_${seqSuffix(SEQ_BASE + i, 8)}`,
          tenantId,
          patientId,
          templateId: SOT_TT_BOOSTER,
          initiatingEncounterId: encounterId,
          authorizingProviderId: providerId,
          status: 'Active',
          startDate: startedAt,
          createdById: nurseId,
        })
        .onConflictDoNothing()
        .returning({ id: s.patientStandingOrders.id })

      let psoId = pso?.id
      if (psoId === undefined) {
        const [existing] = await db
          .select({ id: s.patientStandingOrders.id })
          .from(s.patientStandingOrders)
          .where(
            and(
              eq(s.patientStandingOrders.tenantId, tenantId),
              eq(s.patientStandingOrders.patientId, patientId),
              eq(s.patientStandingOrders.templateId, SOT_TT_BOOSTER),
            ),
          )
          .limit(1)
        psoId = existing?.id
      }

      if (psoId !== undefined) {
        const scheduled = new Date(startedAt.getTime())
        scheduled.setUTCDate(scheduled.getUTCDate() + ttItem.dayOffset)

        const insertedOrder = await db
          .insert(s.clinicalOrders)
          .values({
            displayId: `ORD_${seqSuffix(SEQ_BASE + i, 8)}`,
            tenantId,
            patientStandingOrderId: psoId,
            patientId,
            serviceId: SVC_TT,
            encounterId,
            orderType: 'Standing_Order',
            status: 'Scheduled',
            originalScheduledDate: scheduled,
            currentScheduledDate: scheduled,
            quantity: ttItem.quantity,
            doseNumber: 1,
            createdById: nurseId,
          })
          .onConflictDoNothing()
          .returning({ id: s.clinicalOrders.id })
        if (insertedOrder[0]) dosesInserted++
      }
    }

    // ── Inventory: one AbhayTox lot at this branch, in-date, in stock ───────
    const lotDisplayId = `LOT_${seqSuffix(SEQ_BASE + i, 8)}`
    const insertedLot = await db
      .insert(s.inventoryLots)
      .values({
        displayId: lotDisplayId,
        tenantId,
        branchId,
        productId: abhayToxProductId,
        batchNumber: `TT-2026-${row.branchCode}`,
        manufacturer: 'AbhayTox',
        expiryDate,
        quantityOnHand: '50',
        quantityReceived: '50',
        unitCost: '100.0000',
        supplierName: 'Sanofi Pasteur',
        receivedAt: startedAt,
        createdById: cashierId,
      })
      .onConflictDoNothing()
      .returning({ id: s.inventoryLots.id })

    if (insertedLot[0]) {
      lotsInserted++
      await db
        .insert(s.inventoryMovements)
        .values({
          displayId: `MVT_${seqSuffix(SEQ_BASE + i, 8)}`,
          tenantId,
          lotId: insertedLot[0].id,
          branchId,
          movementType: 'In',
          quantityDelta: '50',
          unitCostSnapshot: '100.0000',
          notes: 'Initial stock receipt (seed — per-branch top-up)',
          performedById: cashierId,
          createdById: cashierId,
        })
        .onConflictDoNothing()
    }

    // ── One paid transaction (consultation fee, unrelated to the due-today
    //    dose — that dose stays unbilled so it can be worked live) ──────────
    const insertedTxn = await db
      .insert(s.transactions)
      .values({
        displayId: `TXN_${seqSuffix(SEQ_BASE + i, 8)}`,
        tenantId,
        branchId,
        patientId,
        cashierId,
        status: 'Paid',
        grossAmount: '500.00',
        discountAmount: '0.00',
        vatAmount: '0.00',
        netAmount: '500.00',
        transactedAt: startedAt,
        createdById: cashierId,
      })
      .onConflictDoNothing()
      .returning({ id: s.transactions.id })

    if (insertedTxn[0]) {
      const transactionId = insertedTxn[0].id
      await db
        .insert(s.transactionItems)
        .values({
          displayId: `TXI_${seqSuffix(SEQ_BASE + i, 8)}`,
          tenantId,
          transactionId,
          serviceId: SVC_CONSULTATION,
          quantity: '1',
          unitPrice: '500.00',
          subtotal: '500.00',
          discountAmount: '0.00',
          vatAmount: '0.00',
          isVatExempt: false,
          isPrepaid: false,
          performedById: providerId,
          createdById: cashierId,
        })
        .onConflictDoNothing()
      await db
        .insert(s.payments)
        .values({
          displayId: `PMT_${seqSuffix(SEQ_BASE + i, 8)}`,
          tenantId,
          transactionId,
          method: 'Cash',
          amount: '500.00',
          referenceNumber: null,
          receivedById: cashierId,
          createdById: cashierId,
        })
        .onConflictDoNothing()
      transactionsInserted++
    }
  }

  console.log(
    `  ✓ branch workflows (${BRANCH_WORKFLOW_ROWS.length} branches): ` +
      `${patientsInserted} patients, ${dosesInserted} doses due today, ` +
      `${lotsInserted} lots, ${transactionsInserted} paid transactions`,
  )
}
