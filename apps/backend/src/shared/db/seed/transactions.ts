/**
 * Seed section — transactions + items + payments.
 *
 * Two-tier IDs (W3.a.3, 2026-05-19):
 *   - `transactions.id`, `transaction_items.id`, `payments.id` are bigserial;
 *     `display_id` columns carry `TXN_<8 base32>` / `TXI_…` / `PMT_…`.
 *   - Patient + payer FKs arrive as `Map<displayId, bigint>` from the
 *     foundation seeds (W2).
 *   - `service_catalog.id` stays text (raw code, e.g. `ARVPEP_IM`); the
 *     `services` Map echoes code → code.
 *   - `transactions.receipt_no` is NULL on insert (BIR sequence allocator
 *     deferred — see spec lock #6).
 *   - `transactions.amount_outstanding` is a GENERATED column — never written.
 *
 * Clinical-order display_ids are resolved at function entry via a single
 * SELECT — the encounters/standing-orders seeds (later W3 waves) export the
 * map. For now, items that reference a non-existent CO key are silently
 * skipped so this section can run before those seeds land.
 */

import { sql, eq, and, inArray } from 'drizzle-orm'
import * as s from '../schema.js'
import { db } from './db.js'
import { daysAgo, today, seqSuffix } from './helpers.js'
import {
  PAT_DELACRUZ_DISPLAY_ID,
  PAT_TORRES_DISPLAY_ID,
  PAT_LIM_DISPLAY_ID,
  PAT_VILLANUEVA_DISPLAY_ID,
  PAT_SANTOS_DISPLAY_ID,
  PAT_REYES_DISPLAY_ID,
  PAT_GARCIA_DISPLAY_ID,
  PAT_MENDOZA_DISPLAY_ID,
  PAT_AGUILAR_DISPLAY_ID,
  PAT_BAUTISTA_DISPLAY_ID,
  PAT_HERRERA_DISPLAY_ID,
  PAT_KATIPUNAN_DISPLAY_ID,
  PAT_LUNA_DISPLAY_ID,
  PAT_NAVARRO_DISPLAY_ID,
  PAT_OCAMPO_DISPLAY_ID,
  SVC_ARVPEP_IM,
  SVC_ERIG_INF,
  SVC_FLU_QUAD,
  SVC_TT,
  SVC_CONSULTATION,
  SVC_WOUND,
  PAYER_MAXICARE_DISPLAY_ID,
  PAYER_INTELLICARE_DISPLAY_ID,
  PAYER_GLOBE_DISPLAY_ID,
} from './constants.js'

export type SeedTransactionsArgs = {
  tenantId: string
  /** Patient display_id → bigint id, from `seedPatients()`. */
  patients: Map<string, number>
  /** Branch bigint id (HST default). */
  branchId: number
  /** Cashier bigint id (creator). */
  createdById: number
  /** Admin bigint id (used as voided_by_id for voided txns). */
  adminId: number
  /** Physician bigint id (used as performed_by_id on consultation items). */
  physicianId: number
  /**
   * service_catalog code → code (text PK, no display_id). Pass an empty
   * Map to skip catalog FK lookups — the seed queries the live service
   * codes itself in that case.
   */
  services?: Map<string, string>
  /**
   * Payer display_id → bigint id, from `seedPayers()`. Optional — if not
   * supplied (payers seed not yet wired), payer-tagged transactions get
   * `payerId = null`.
   */
  payers?: Map<string, number>
  /**
   * Clinical-order key → bigint id, from `seedEncounters()` / standing-orders.
   * Optional — items that reference a missing key fall back to no FK.
   */
  clinicalOrders?: Map<string, number>
}

type TxnSeed = {
  key: string
  patientDisplayId: string
  status: 'Draft' | 'Pending' | 'Paid' | 'Voided' | 'Refunded'
  grossAmount: string
  discountAmount: string
  vatAmount: string
  netAmount: string
  transactedAt: Date
  payerDisplayId?: string
  discountIdType?: 'OSCA' | 'PWD' | 'Other'
  discountIdNumber?: string
  voidedAt?: Date
  voidReason?: string
  /** Prepayment fixture — collected cash sitting on the patient's account
   * awaiting application to a future transaction. Drives the Apply
   * Prepayment dialog (#14). */
  isPrepayment?: boolean
  amountPaid?: string
}

type ItemSeed = {
  txnKey: string
  serviceCode: string
  quantity: string
  unitPrice: string
  subtotal: string
  discountAmount: string
  clinicalOrderKey?: string
  performedByPhysician?: boolean
}

type PaymentSeed = {
  txnKey: string
  method: 'Cash' | 'GCash' | 'Maya' | 'BankTransfer' | 'Card' | 'HMO' | 'Corporate'
  amount: string
  referenceNumber: string | null
  payerDisplayId?: string
}

export async function seedTransactions(args: SeedTransactionsArgs): Promise<void> {
  const {
    tenantId,
    patients,
    branchId,
    createdById,
    adminId,
    physicianId,
    payers,
    clinicalOrders,
  } = args

  // Resolve service codes — verify they exist (or skip if absent).
  const requiredServiceCodes = [
    SVC_ARVPEP_IM,
    SVC_ERIG_INF,
    SVC_FLU_QUAD,
    SVC_TT,
    SVC_CONSULTATION,
    SVC_WOUND,
  ]
  const liveServiceRows = await db
    .select({ id: s.serviceCatalog.id })
    .from(s.serviceCatalog)
    .where(
      and(
        eq(s.serviceCatalog.tenantId, tenantId),
        inArray(s.serviceCatalog.id, requiredServiceCodes),
      ),
    )
  const liveServiceSet = new Set(liveServiceRows.map((r) => r.id))
  if (liveServiceSet.size === 0) {
    console.log('  ↷ transactions skipped (service_catalog not yet seeded)')
    return
  }

  // ── Transaction fixtures ──────────────────────────────────────────────────
  const txnRows: TxnSeed[] = [
    {
      key: 'TXN1',
      patientDisplayId: PAT_DELACRUZ_DISPLAY_ID,
      status: 'Paid',
      grossAmount: '2500.00',
      discountAmount: '0.00',
      vatAmount: '0.00',
      netAmount: '2500.00',
      transactedAt: today(10, 45),
    },
    {
      key: 'TXN2',
      patientDisplayId: PAT_TORRES_DISPLAY_ID,
      status: 'Pending',
      grossAmount: '4200.00',
      discountAmount: '0.00',
      vatAmount: '0.00',
      netAmount: '4200.00',
      transactedAt: today(10, 30),
    },
    {
      key: 'TXN3',
      patientDisplayId: PAT_LIM_DISPLAY_ID,
      status: 'Paid',
      grossAmount: '1800.00',
      discountAmount: '321.43',
      vatAmount: '0.00',
      netAmount: '1478.57',
      transactedAt: today(9, 15),
      payerDisplayId: PAYER_INTELLICARE_DISPLAY_ID,
      discountIdType: 'Other',
      discountIdNumber: 'IC-LOA-20260425',
    },
    {
      key: 'TXN4',
      patientDisplayId: PAT_REYES_DISPLAY_ID,
      status: 'Paid',
      grossAmount: '2500.00',
      discountAmount: '0.00',
      vatAmount: '0.00',
      netAmount: '2500.00',
      transactedAt: daysAgo(1, 10, 0),
    },
    {
      key: 'TXN5',
      patientDisplayId: PAT_GARCIA_DISPLAY_ID,
      status: 'Voided',
      grossAmount: '1200.00',
      discountAmount: '0.00',
      vatAmount: '0.00',
      netAmount: '1200.00',
      transactedAt: daysAgo(1, 11, 0),
      voidedAt: daysAgo(1, 14, 0),
      voidReason: 'Duplicate entry — patient charged twice for consultation',
    },
    {
      key: 'TXN6',
      patientDisplayId: PAT_MENDOZA_DISPLAY_ID,
      status: 'Paid',
      grossAmount: '5600.00',
      discountAmount: '1000.00',
      vatAmount: '0.00',
      netAmount: '4600.00',
      transactedAt: daysAgo(1, 9, 0),
      payerDisplayId: PAYER_MAXICARE_DISPLAY_ID,
    },
    {
      key: 'TXN7',
      patientDisplayId: PAT_VILLANUEVA_DISPLAY_ID,
      status: 'Draft',
      grossAmount: '2500.00',
      discountAmount: '0.00',
      vatAmount: '0.00',
      netAmount: '2500.00',
      transactedAt: daysAgo(1, 8, 30),
    },
    {
      key: 'TXN8',
      patientDisplayId: PAT_SANTOS_DISPLAY_ID,
      status: 'Paid',
      grossAmount: '800.00',
      discountAmount: '142.86',
      vatAmount: '0.00',
      netAmount: '657.14',
      transactedAt: daysAgo(2, 10, 0),
      discountIdType: 'PWD',
      discountIdNumber: 'PWD-0123456',
    },
    {
      key: 'TXN9',
      patientDisplayId: PAT_BAUTISTA_DISPLAY_ID,
      status: 'Paid',
      grossAmount: '1800.00',
      discountAmount: '321.43',
      vatAmount: '0.00',
      netAmount: '1478.57',
      transactedAt: daysAgo(2, 9, 30),
      discountIdType: 'OSCA',
      discountIdNumber: 'OSCA-QC-7788',
    },
    {
      key: 'TXN10',
      patientDisplayId: PAT_HERRERA_DISPLAY_ID,
      status: 'Paid',
      grossAmount: '2500.00',
      discountAmount: '0.00',
      vatAmount: '0.00',
      netAmount: '2500.00',
      transactedAt: daysAgo(3, 9, 0),
      payerDisplayId: PAYER_MAXICARE_DISPLAY_ID,
    },
    {
      key: 'TXN11',
      patientDisplayId: PAT_AGUILAR_DISPLAY_ID,
      status: 'Paid',
      grossAmount: '3250.00',
      discountAmount: '0.00',
      vatAmount: '0.00',
      netAmount: '3250.00',
      transactedAt: daysAgo(5, 9, 0),
    },
    {
      key: 'TXN12',
      patientDisplayId: PAT_LUNA_DISPLAY_ID,
      status: 'Paid',
      grossAmount: '6800.00',
      discountAmount: '0.00',
      vatAmount: '0.00',
      netAmount: '6800.00',
      transactedAt: daysAgo(10, 9, 0),
    },
    {
      key: 'TXN13',
      patientDisplayId: PAT_KATIPUNAN_DISPLAY_ID,
      status: 'Paid',
      grossAmount: '800.00',
      discountAmount: '0.00',
      vatAmount: '0.00',
      netAmount: '800.00',
      transactedAt: daysAgo(1, 9, 15),
    },
    {
      key: 'TXN14',
      patientDisplayId: PAT_OCAMPO_DISPLAY_ID,
      status: 'Paid',
      grossAmount: '1800.00',
      discountAmount: '321.43',
      vatAmount: '0.00',
      netAmount: '1478.57',
      transactedAt: daysAgo(2, 9, 0),
      discountIdType: 'OSCA',
      discountIdNumber: 'OSCA-QC-1122',
    },
    {
      key: 'TXN15',
      patientDisplayId: PAT_NAVARRO_DISPLAY_ID,
      status: 'Paid',
      grossAmount: '1800.00',
      discountAmount: '0.00',
      vatAmount: '0.00',
      netAmount: '1800.00',
      transactedAt: daysAgo(1, 10, 0),
      payerDisplayId: PAYER_GLOBE_DISPLAY_ID,
    },
    {
      // PREPAYMENT — collected cash on Dela Cruz's account, not yet applied.
      // Drives the Apply Prepayment dialog (#14 in preview coverage doc).
      key: 'TXN16_PREPAY',
      patientDisplayId: PAT_DELACRUZ_DISPLAY_ID,
      status: 'Paid',
      grossAmount: '500.00',
      discountAmount: '0.00',
      vatAmount: '0.00',
      netAmount: '500.00',
      amountPaid: '500.00',
      isPrepayment: true,
      transactedAt: daysAgo(1, 14, 0),
    },
  ]

  // ── Insert transactions, capture bigint ids via .returning() ──────────────
  const txnIdByKey = new Map<string, number>()

  for (const [txnIdx, row] of txnRows.entries()) {
    const patientId = patients.get(row.patientDisplayId)
    if (patientId === undefined) {
      throw new Error(`seedTransactions: patient ${row.patientDisplayId} not found in patients map`)
    }
    let payerId: number | null = null
    if (row.payerDisplayId) {
      payerId = payers?.get(row.payerDisplayId) ?? null
      // Soft-skip: if payers map isn't supplied, drop the payer FK.
    }

    const inserted = await db
      .insert(s.transactions)
      .values({
        displayId: `TXN_${seqSuffix(txnIdx, 8)}`,
        tenantId,
        branchId,
        patientId,
        cashierId: createdById,
        payerId,
        status: row.status,
        // receipt_no stays NULL (BIR sequence deferred).
        discountIdType: row.discountIdType ?? null,
        discountIdNumber: row.discountIdNumber ?? null,
        grossAmount: row.grossAmount,
        discountAmount: row.discountAmount,
        vatAmount: row.vatAmount,
        netAmount: row.netAmount,
        // amount_outstanding is GENERATED — never set.
        // amount_paid defaults to 0; for Paid rows we'd ideally bump it to
        // net_amount so the GENERATED column lands at 0. The
        // sync_transaction_amounts trigger keeps it consistent once a
        // payment lands, so leaving the default is OK for fixture data.
        ...(row.amountPaid ? { amountPaid: row.amountPaid } : {}),
        isPrepayment: row.isPrepayment ?? false,
        transactedAt: row.transactedAt,
        voidedAt: row.voidedAt ?? null,
        voidedById: row.voidedAt ? adminId : null,
        voidReason: row.voidReason ?? null,
        createdById,
      })
      .onConflictDoNothing()
      .returning({ id: s.transactions.id })

    if (inserted[0]) {
      txnIdByKey.set(row.key, inserted[0].id)
    }
    // Display IDs are index-derived (NOT `displayId()`), so a re-run collides
    // on the display_id unique index and `onConflictDoNothing` actually skips.
    // With random ids nothing ever conflicted and a second `pnpm db:seed`
    // silently doubled every transaction, item and payment — inflating revenue
    // on a pilot database. No fallback lookup is needed: the ids are stable, so
    // downstream sections resolve the same rows on every run.
  }

  console.log(`  ✓ transactions (${txnIdByKey.size}/${txnRows.length})`)

  // ── Items ─────────────────────────────────────────────────────────────────
  const itemRows: ItemSeed[] = [
    {
      txnKey: 'TXN1',
      serviceCode: SVC_ARVPEP_IM,
      quantity: '1',
      unitPrice: '2500.00',
      subtotal: '2500.00',
      discountAmount: '0.00',
      clinicalOrderKey: 'CO_DELACRUZ_D1',
    },
    {
      txnKey: 'TXN2',
      serviceCode: SVC_ERIG_INF,
      quantity: '1',
      unitPrice: '4200.00',
      subtotal: '4200.00',
      discountAmount: '0.00',
      clinicalOrderKey: 'CO_TORRES_ERIG',
    },
    {
      txnKey: 'TXN3',
      serviceCode: SVC_FLU_QUAD,
      quantity: '1',
      unitPrice: '1800.00',
      subtotal: '1478.57',
      discountAmount: '321.43',
      clinicalOrderKey: 'CO_LIM_FLU',
    },
    {
      txnKey: 'TXN4',
      serviceCode: SVC_ARVPEP_IM,
      quantity: '1',
      unitPrice: '2500.00',
      subtotal: '2500.00',
      discountAmount: '0.00',
      clinicalOrderKey: 'CO_DELACRUZ_D2',
    },
    {
      txnKey: 'TXN5',
      serviceCode: SVC_CONSULTATION,
      quantity: '1',
      unitPrice: '1200.00',
      subtotal: '1200.00',
      discountAmount: '0.00',
      performedByPhysician: true,
    },
    {
      txnKey: 'TXN6',
      serviceCode: SVC_ARVPEP_IM,
      quantity: '2',
      unitPrice: '2500.00',
      subtotal: '4100.00',
      discountAmount: '900.00',
      clinicalOrderKey: 'CO_AGUILAR_D1',
    },
    {
      txnKey: 'TXN6',
      serviceCode: SVC_CONSULTATION,
      quantity: '1',
      unitPrice: '600.00',
      subtotal: '500.00',
      discountAmount: '100.00',
      performedByPhysician: true,
    },
    {
      txnKey: 'TXN7',
      serviceCode: SVC_ARVPEP_IM,
      quantity: '1',
      unitPrice: '2500.00',
      subtotal: '2500.00',
      discountAmount: '0.00',
      clinicalOrderKey: 'CO_AGUILAR_D2',
    },
    {
      txnKey: 'TXN8',
      serviceCode: SVC_TT,
      quantity: '1',
      unitPrice: '800.00',
      subtotal: '657.14',
      discountAmount: '142.86',
      clinicalOrderKey: 'CO_SANTOS_TT_D2',
    },
    {
      txnKey: 'TXN9',
      serviceCode: SVC_FLU_QUAD,
      quantity: '1',
      unitPrice: '1800.00',
      subtotal: '1478.57',
      discountAmount: '321.43',
      clinicalOrderKey: 'CO_LUNA_FLU',
    },
    {
      txnKey: 'TXN10',
      serviceCode: SVC_ARVPEP_IM,
      quantity: '1',
      unitPrice: '2500.00',
      subtotal: '2500.00',
      discountAmount: '0.00',
      clinicalOrderKey: 'CO_LUNA_D1',
    },
    {
      txnKey: 'TXN11',
      serviceCode: SVC_ARVPEP_IM,
      quantity: '1',
      unitPrice: '2500.00',
      subtotal: '2500.00',
      discountAmount: '0.00',
      clinicalOrderKey: 'CO_LUNA_D2',
    },
    {
      txnKey: 'TXN11',
      serviceCode: SVC_WOUND,
      quantity: '1',
      unitPrice: '750.00',
      subtotal: '750.00',
      discountAmount: '0.00',
    },
    {
      txnKey: 'TXN12',
      serviceCode: SVC_ARVPEP_IM,
      quantity: '2',
      unitPrice: '2500.00',
      subtotal: '5000.00',
      discountAmount: '0.00',
      clinicalOrderKey: 'CO_HERRERA_D1',
    },
    {
      txnKey: 'TXN12',
      serviceCode: SVC_FLU_QUAD,
      quantity: '1',
      unitPrice: '1800.00',
      subtotal: '1800.00',
      discountAmount: '0.00',
    },
    {
      txnKey: 'TXN13',
      serviceCode: SVC_TT,
      quantity: '1',
      unitPrice: '800.00',
      subtotal: '800.00',
      discountAmount: '0.00',
      clinicalOrderKey: 'CO_KATIPUNAN_TT',
    },
    {
      txnKey: 'TXN14',
      serviceCode: SVC_FLU_QUAD,
      quantity: '1',
      unitPrice: '1800.00',
      subtotal: '1478.57',
      discountAmount: '321.43',
      clinicalOrderKey: 'CO_NAVARRO_FLU',
    },
    {
      txnKey: 'TXN15',
      serviceCode: SVC_FLU_QUAD,
      quantity: '1',
      unitPrice: '1800.00',
      subtotal: '1800.00',
      discountAmount: '0.00',
      clinicalOrderKey: 'CO_OCAMPO_FLU',
    },
  ]

  let itemsInserted = 0
  for (const [itemIdx, item] of itemRows.entries()) {
    const transactionId = txnIdByKey.get(item.txnKey)
    if (transactionId === undefined) continue
    if (!liveServiceSet.has(item.serviceCode)) continue

    const clinicalOrderId = item.clinicalOrderKey
      ? (clinicalOrders?.get(item.clinicalOrderKey) ?? null)
      : null

    await db
      .insert(s.transactionItems)
      .values({
        displayId: `TXI_${seqSuffix(itemIdx, 8)}`,
        tenantId,
        transactionId,
        serviceId: item.serviceCode,
        clinicalOrderId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        subtotal: item.subtotal,
        discountAmount: item.discountAmount,
        vatAmount: '0.00',
        isVatExempt: false,
        isPrepaid: false,
        performedById: item.performedByPhysician ? physicianId : null,
        createdById,
      })
      .onConflictDoNothing()
    itemsInserted++
  }

  console.log(`  ✓ transaction items (${itemsInserted})`)

  // ── Payments ──────────────────────────────────────────────────────────────
  const paymentRows: PaymentSeed[] = [
    { txnKey: 'TXN1', method: 'Cash', amount: '2500.00', referenceNumber: null },
    {
      txnKey: 'TXN3',
      method: 'GCash',
      amount: '1478.57',
      referenceNumber: 'GC-20260425-001',
      payerDisplayId: PAYER_INTELLICARE_DISPLAY_ID,
    },
    { txnKey: 'TXN4', method: 'Maya', amount: '2500.00', referenceNumber: 'MY-20260424-001' },
    { txnKey: 'TXN5', method: 'Cash', amount: '1200.00', referenceNumber: null },
    {
      txnKey: 'TXN6',
      method: 'HMO',
      amount: '4600.00',
      referenceNumber: 'MC-LOA-20260424',
      payerDisplayId: PAYER_MAXICARE_DISPLAY_ID,
    },
    { txnKey: 'TXN8', method: 'Card', amount: '657.14', referenceNumber: 'CC-20260423-001' },
    { txnKey: 'TXN9', method: 'Cash', amount: '1478.57', referenceNumber: null },
    {
      txnKey: 'TXN10',
      method: 'HMO',
      amount: '2500.00',
      referenceNumber: 'MC-LOA-20260422',
      payerDisplayId: PAYER_MAXICARE_DISPLAY_ID,
    },
    { txnKey: 'TXN11', method: 'Cash', amount: '3250.00', referenceNumber: null },
    { txnKey: 'TXN12', method: 'GCash', amount: '6800.00', referenceNumber: 'GC-20260415-001' },
    { txnKey: 'TXN13', method: 'Cash', amount: '800.00', referenceNumber: null },
    { txnKey: 'TXN14', method: 'Cash', amount: '1478.57', referenceNumber: null },
    {
      txnKey: 'TXN15',
      method: 'Corporate',
      amount: '1800.00',
      referenceNumber: 'GLOBE-WP-2026-025',
      payerDisplayId: PAYER_GLOBE_DISPLAY_ID,
    },
  ]

  let paymentsInserted = 0
  for (const [payIdx, pay] of paymentRows.entries()) {
    const transactionId = txnIdByKey.get(pay.txnKey)
    if (transactionId === undefined) continue
    const payerId = pay.payerDisplayId ? (payers?.get(pay.payerDisplayId) ?? null) : null

    await db
      .insert(s.payments)
      .values({
        displayId: `PMT_${seqSuffix(payIdx, 8)}`,
        tenantId,
        transactionId,
        method: pay.method,
        amount: pay.amount,
        referenceNumber: pay.referenceNumber,
        payerId,
        receivedById: createdById,
        createdById,
      })
      .onConflictDoNothing()
    paymentsInserted++
  }

  console.log(`  ✓ payments (${paymentsInserted})`)

  // Reference unused vars to keep TS happy if/when args shrink.
  void sql
}
