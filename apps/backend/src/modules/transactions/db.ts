import {
  and,
  eq,
  isNull,
  sql,
  desc,
  ilike,
  or,
  asc,
  inArray,
  notInArray,
  type Column,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { withTenantTx, type TenantCtx } from '../../shared/db/withTenantTx.js'
import {
  transactions,
  transactionItems,
  transactionPatients,
  patients,
  payments,
  users,
  serviceCatalog,
  payerProfiles,
  encounters,
  branches,
  clinicalOrders,
  cashDrawerSessions,
  inventoryLots,
  products,
  approvalRequests,
  groupBills,
} from '../../shared/db/schema.js'
import { displayId } from '../../shared/utils/displayId.js'
import { clinicCalendarDateString } from '../../shared/utils/clinicDate.js'
import { assertActiveConsent } from '../../shared/utils/consent.js'
import { allocateCounter } from '../../shared/db/counters.js'
import {
  computeTransactionTotals,
  type DiscountType,
  type ServicePriceLookup,
  type TotalsResult,
} from './service.js'
import { resolveServicePrice } from '../../shared/lib/pricing.js'
import { toCents, fromCents, sumMoney } from '../../shared/utils/money.js'
import { initialReconciliationStatus } from '../payments_verifier/index.js'
import { isBundleService, fanOutBundle } from '../clinical_orders/bundleFanOut.js'
import { unwindFanOutForVoid } from '../clinical_orders/fanOutVoid.js'
import type { Tx } from '../../shared/db/withTenantTx.js'
import { planAllocation, planCreditDraw, type OpenBill, type CreditSource } from './allocate.js'
import { auditLog } from '../../shared/utils/auditLog.js'
import { resolveMoneyHandler } from '../../shared/utils/clinicianAttestation.js'

/**
 * Lifecycle errors are raised as `LifecycleError` so routes can map them to
 * structured 409 responses.
 */
export class LifecycleError extends Error {
  constructor(
    message: string,
    public code: string,
    public httpStatus = 409,
    /**
     * Machine-readable context the client needs to recover, spread into the
     * error response by `sendLifecycleError`. Pay-on-account uses it to hand
     * back the computed excess on OVERPAYMENT_NOT_ALLOWED and the payable
     * ceiling on D2_CROSS_BRANCH_DEPOSIT, so the UI can retry with a value
     * that will succeed instead of guessing.
     */
    public details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'LifecycleError'
  }
}

/**
 * Every money-facing service call must declare where its caller identity came
 * from. HTTP routes carry the authenticated user identity; trusted internal
 * callers must opt out explicitly. Omission is neither typed nor accepted at
 * runtime, so adding a new route cannot silently attribute a payment to the
 * shared Branch service account.
 */
export type MoneyCallerContext =
  | { kind: 'http'; role: string; displayId: string }
  | { kind: 'internal' }

type MoneyAttestationFields = {
  moneyCaller: MoneyCallerContext
  attestedById?: string | undefined
  attestationPin?: string | undefined
}

/**
 * Resolve who actually took a payment, PIN-attested when the caller is on the
 * shared `Branch` login. Trusted internal calls still attribute the act to the
 * explicit `userId`; their opt-out bypasses only the interactive PIN prompt,
 * never receiver attribution.
 *
 * MUST be awaited BEFORE the caller opens its own `withTenantTx`: verifying a
 * PIN performs its own writes (the `pin_attempts` lockout counters), which
 * must not ride on, or be rolled back with, the financial transaction. Every
 * call site below sits above its `withTenantTx` call for this reason.
 */
async function resolveReceivedById(
  tenantId: string,
  branchId: number | null,
  userId: number,
  fields: MoneyAttestationFields,
): Promise<number> {
  // Runtime guard complements the required TypeScript field. It catches a JS
  // caller, stale compiled route, or unsafe cast that omitted the context.
  if (!fields.moneyCaller) {
    throw new LifecycleError(
      'Payment caller context is required',
      'MONEY_CALLER_CONTEXT_REQUIRED',
      500,
    )
  }
  if (fields.moneyCaller.kind === 'internal') return userId
  if (!fields.moneyCaller.role || !fields.moneyCaller.displayId) {
    throw new LifecycleError(
      'Authenticated payment caller identity is incomplete',
      'MONEY_CALLER_CONTEXT_REQUIRED',
      500,
    )
  }
  return resolveMoneyHandler({
    tenantId,
    branchId,
    caller: {
      id: userId,
      role: fields.moneyCaller.role,
      displayId: fields.moneyCaller.displayId,
    },
    attestedById: fields.attestedById,
    attestationPin: fields.attestationPin,
  })
}

export type TransactionStatusFilter = 'all' | 'Draft' | 'Pending' | 'Paid' | 'Voided' | 'Refunded'

// Map allow-listed sort keys → Drizzle column references.
//
// `TRANSACTION_SORT_COLUMNS` is the single source of truth for what the route
// will accept: routes.ts imports it rather than keeping its own literal list.
// The two used to be separate, and adding `amount_outstanding` here alone left
// the route silently discarding it and falling back to date order.
const TRANSACTION_SORT_COLS = {
  created_at: transactions.transactedAt,
  net_amount: transactions.netAmount,
  // GENERATED column (net - paid, floored at 0). Sortable so a cashier can
  // work the largest open balances first.
  amount_outstanding: transactions.amountOutstanding,
  status: transactions.status,
} satisfies Record<string, Column>

export const TRANSACTION_SORT_COLUMNS = Object.keys(
  TRANSACTION_SORT_COLS,
) as ReadonlyArray<TransactionSortCol>

export type TransactionSortCol = keyof typeof TRANSACTION_SORT_COLS

// ── Display-id resolvers ─────────────────────────────────────────────────────
//
// Public handles are display_ids (TXN_/PAT_/USR_/…). The DB FKs are bigint.
// These helpers translate at handler boundaries so callers (and routes) deal
// only with display_ids; internal layers use bigints.

async function resolveTransactionId(
  tx: Tx,
  tenantId: string,
  displayId: string,
): Promise<number | null> {
  const [row] = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.displayId, displayId), eq(transactions.tenantId, tenantId)))
    .limit(1)
  return row?.id ?? null
}

async function resolvePatientId(
  tx: Tx,
  tenantId: string,
  displayId: string,
): Promise<number | null> {
  const [row] = await tx
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.displayId, displayId), eq(patients.tenantId, tenantId)))
    .limit(1)
  return row?.id ?? null
}

async function resolveEncounterId(
  tx: Tx,
  tenantId: string,
  displayId: string,
): Promise<{ id: number; patientId: number } | null> {
  const [row] = await tx
    .select({ id: encounters.id, patientId: encounters.patientId })
    .from(encounters)
    .where(and(eq(encounters.displayId, displayId), eq(encounters.tenantId, tenantId)))
    .limit(1)
  return row ?? null
}

async function resolvePayerId(tx: Tx, tenantId: string, displayId: string): Promise<number | null> {
  const [row] = await tx
    .select({ id: payerProfiles.id })
    .from(payerProfiles)
    .where(and(eq(payerProfiles.displayId, displayId), eq(payerProfiles.tenantId, tenantId)))
    .limit(1)
  return row?.id ?? null
}

async function resolveClinicalOrderId(
  tx: Tx,
  tenantId: string,
  displayId: string,
): Promise<{
  id: number
  patientId: number
  serviceId: string
  status: 'Scheduled' | 'Pending' | 'Completed' | 'Missed' | 'Cancelled'
} | null> {
  const [row] = await tx
    .select({
      id: clinicalOrders.id,
      patientId: clinicalOrders.patientId,
      serviceId: clinicalOrders.serviceId,
      status: clinicalOrders.status,
    })
    .from(clinicalOrders)
    .where(
      and(
        eq(clinicalOrders.displayId, displayId),
        eq(clinicalOrders.tenantId, tenantId),
        isNull(clinicalOrders.deletedAt),
      ),
    )
    // Prepayment eligibility is a clinical/financial hand-off. Lock the order
    // until this transaction commits so an administration cannot change the
    // status after we validate it but before the bill line is inserted.
    .for('update')
    .limit(1)
  return row ?? null
}

export function isClinicalOrderPrepayable(
  status: 'Scheduled' | 'Pending' | 'Completed' | 'Missed' | 'Cancelled',
): boolean {
  return status === 'Scheduled' || status === 'Pending'
}

/**
 * For lines that bill an ALREADY-ADMINISTERED dose, the nurse's chosen lot has
 * fixed the brand — so the bill must price that brand, not the abstract
 * service's base rate. Maps clinical-order display_id → { lotId, productId }
 * for every supplied order that carries a lot (one query, no N+1).
 *
 * Orders not yet administered have `lot_id IS NULL` and are simply absent from
 * the map: their line prices brand-agnostically, which is correct — a bill
 * raised in advance cannot know which brand the nurse will pick. If the
 * administered brand later costs more, `administerOrderTx` records a
 * BRAND_PRICE_VARIANCE audit row instead of mutating the settled bill.
 */
export async function resolveAdministeredBrands(
  tx: Tx,
  tenantId: string,
  orderDisplayIds: string[],
): Promise<Map<string, { lotId: number; productId: number }>> {
  const out = new Map<string, { lotId: number; productId: number }>()
  if (orderDisplayIds.length === 0) return out

  const rows = await tx
    .select({
      orderDisplayId: clinicalOrders.displayId,
      lotId: inventoryLots.id,
      productId: inventoryLots.productId,
    })
    .from(clinicalOrders)
    .innerJoin(inventoryLots, eq(clinicalOrders.lotId, inventoryLots.id))
    .where(
      and(
        eq(clinicalOrders.tenantId, tenantId),
        inArray(clinicalOrders.displayId, orderDisplayIds),
        isNull(clinicalOrders.deletedAt),
      ),
    )

  for (const r of rows) {
    out.set(r.orderDisplayId, { lotId: r.lotId, productId: r.productId })
  }
  return out
}

async function resolveBranchByCode(
  tx: Tx,
  tenantId: string,
  branchCode: string,
): Promise<{ id: number; code: string } | null> {
  const [row] = await tx
    .select({ id: branches.id, code: branches.code })
    .from(branches)
    .where(and(eq(branches.code, branchCode), eq(branches.tenantId, tenantId)))
    .limit(1)
  return row ?? null
}

/**
 * D2 branch-invariant mirror for SECONDARY patients on a multi-patient
 * transaction. The DB trigger (`0003_invariants.sql` enforce_transaction_branch_invariant)
 * only validates the header/primary `patient_id` on INSERT, so secondary item
 * patients are checked here in app code. Returns the patient's last-administered
 * branch (the branch of their most-recent Completed clinical_order), or null when
 * they have no completed order (first-ever — any branch is allowed).
 */
async function lastAdministeredBranchId(
  tx: Tx,
  tenantId: string,
  patientId: number,
): Promise<number | null> {
  const [row] = await tx
    .select({ branchId: encounters.branchId })
    .from(clinicalOrders)
    .innerJoin(encounters, eq(encounters.id, clinicalOrders.encounterId))
    .where(
      and(
        eq(clinicalOrders.patientId, patientId),
        eq(clinicalOrders.tenantId, tenantId),
        eq(clinicalOrders.status, 'Completed'),
        isNull(clinicalOrders.deletedAt),
        sql`${clinicalOrders.completedAt} IS NOT NULL`,
      ),
    )
    .orderBy(desc(clinicalOrders.completedAt))
    .limit(1)
  return row?.branchId ?? null
}

// ── List ─────────────────────────────────────────────────────────────────────

export async function listTransactions(opts: {
  tenantId: string
  q?: string
  status?: TransactionStatusFilter
  /** Patient display_id (PAT_…). */
  patientDisplayId?: string
  /** Encounter display_id (ENC_…). */
  encounterDisplayId?: string
  /**
   * Calendar-day filter (YYYY-MM-DD), interpreted in the Asia/Manila clinic timezone.
   */
  date?: string
  limit?: number
  sort?: string
  order?: 'asc' | 'desc'
}) {
  return withTenantTx({ tenantId: opts.tenantId, userId: 0, branchId: null }, async (tx) => {
    // Resolve patient / encounter display_ids to bigints if filters supplied.
    let patientId: number | undefined
    if (opts.patientDisplayId) {
      const [p] = await tx
        .select({ id: patients.id })
        .from(patients)
        .where(
          and(eq(patients.displayId, opts.patientDisplayId), eq(patients.tenantId, opts.tenantId)),
        )
        .limit(1)
      if (!p) {
        return []
      }
      patientId = p.id
    }
    let encounterId: number | undefined
    if (opts.encounterDisplayId) {
      const [e] = await tx
        .select({ id: encounters.id })
        .from(encounters)
        .where(
          and(
            eq(encounters.displayId, opts.encounterDisplayId),
            eq(encounters.tenantId, opts.tenantId),
          ),
        )
        .limit(1)
      if (!e) {
        return []
      }
      encounterId = e.id
    }

    const conditions = [eq(transactions.tenantId, opts.tenantId), isNull(transactions.deletedAt)]

    if (opts.q) {
      const q = `%${opts.q}%`
      conditions.push(
        or(
          ilike(transactions.displayId, q),
          ilike(transactions.receiptNo, q),
          ilike(patients.lastName, q),
          ilike(patients.firstName, q),
        )!,
      )
    }

    if (opts.status && opts.status !== 'all') {
      conditions.push(eq(transactions.status, opts.status))
    }

    if (patientId !== undefined) {
      conditions.push(eq(transactions.patientId, patientId))
    }

    if (encounterId !== undefined) {
      conditions.push(eq(transactions.encounterId, encounterId))
    }

    if (opts.date) {
      conditions.push(
        sql`(${transactions.transactedAt} AT TIME ZONE 'Asia/Manila')::date = ${opts.date}::date`,
      )
    }

    const baseQuery = tx
      .select({
        id: transactions.id,
        displayId: transactions.displayId,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
        status: transactions.status,
        grossAmount: transactions.grossAmount,
        discountAmount: transactions.discountAmount,
        netAmount: transactions.netAmount,
        amountPaid: transactions.amountPaid,
        amountOutstanding: transactions.amountOutstanding,
        vatRate: transactions.vatRate,
        transactedAt: transactions.transactedAt,
        cashierFirstName: users.firstName,
        cashierLastName: users.lastName,
      })
      .from(transactions)
      .innerJoin(patients, eq(transactions.patientId, patients.id))
      .leftJoin(users, eq(transactions.cashierId, users.id))
      .where(and(...conditions))
      .orderBy(
        (() => {
          // `opts.sort` is a free string at this boundary; the route allow-lists
          // it against TRANSACTION_SORT_COLUMNS, and an unknown key still falls
          // back to the transacted-at default rather than throwing.
          const col =
            (TRANSACTION_SORT_COLS as Record<string, Column | undefined>)[
              opts.sort ?? 'created_at'
            ] ?? transactions.transactedAt
          const dirFn = opts.order === 'asc' ? asc : desc
          return dirFn(col)
        })(),
      )

    const rows = opts.limit ? await baseQuery.limit(opts.limit) : await baseQuery

    // Item counts and payment methods, keyed by transaction bigint id.
    const txnIds = rows.map((r) => r.id)
    let itemCounts: Map<number, number> = new Map()
    const paymentMethods: Map<number, string> = new Map()
    if (txnIds.length > 0) {
      const [counts, pmRows] = await Promise.all([
        tx
          .select({
            transactionId: transactionItems.transactionId,
            count: sql<number>`count(*)`,
          })
          .from(transactionItems)
          .where(inArray(transactionItems.transactionId, txnIds))
          .groupBy(transactionItems.transactionId),
        tx
          .select({
            transactionId: payments.transactionId,
            method: payments.method,
          })
          .from(payments)
          .where(inArray(payments.transactionId, txnIds)),
      ])
      itemCounts = new Map(counts.map((c) => [c.transactionId, Number(c.count)]))
      for (const pm of pmRows) {
        if (!paymentMethods.has(pm.transactionId)) {
          paymentMethods.set(pm.transactionId, pm.method)
        }
      }
    }

    return rows.map((r) => ({
      // Public surface: display_id only.
      id: r.displayId,
      patientName: `${r.patientLastName}, ${r.patientFirstName}`,
      status: r.status,
      // Money crosses the API as raw numeric(12,2) strings ("4820.00") —
      // comma-grouped pre-formatting broke the frontend's Number()/parseFloat
      // consumers for amounts ≥ 1,000. Formatting is the frontend's job.
      grossAmount: r.grossAmount,
      discountAmount: r.discountAmount,
      netAmount: r.netAmount,
      amountPaid: r.amountPaid,
      amountOutstanding: r.amountOutstanding,
      vatRate: r.vatRate,
      paymentMethod: paymentMethods.get(r.id) ?? null,
      itemCount: itemCounts.get(r.id) ?? 0,
      transactedAt: r.transactedAt.toISOString(),
      cashierName: r.cashierFirstName ? `${r.cashierFirstName[0]}. ${r.cashierLastName}` : null,
    }))
  })
}

export async function getTransactionStats(tenantId: string) {
  const today = clinicCalendarDateString()

  const { result, trendRows } = await withTenantTx(
    { tenantId, userId: 0, branchId: null },
    async (tx) => {
      const [agg] = await tx
        .select({
          todayCount: sql<number>`COUNT(*) FILTER (WHERE (${transactions.transactedAt} AT TIME ZONE 'Asia/Manila')::date = ${today}::date)`,
          todayRevenue: sql<string>`COALESCE(SUM(CAST(${transactions.netAmount} AS numeric)) FILTER (WHERE ${transactions.status} = 'Paid' AND ${transactions.isPrepayment} = false AND (${transactions.transactedAt} AT TIME ZONE 'Asia/Manila')::date = ${today}::date), 0)`,
          pendingCount: sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} = 'Pending')`,
        })
        .from(transactions)
        .where(and(eq(transactions.tenantId, tenantId), isNull(transactions.deletedAt)))

      // 7-day trend (oldest → newest), one point per calendar day, today last.
      // generate_series drives the axis so zero-activity days appear as
      // '0.00' instead of missing points. The series annotates the
      // todayRevenue KPI, so it carries the SAME filter (Paid-only, deposits
      // excluded) and the SAME explicit Asia/Manila clinic date, independent
      // of the database server's session timezone.
      const trendRows = await tx.execute<{ day: string; revenue: string }>(sql`
        SELECT
          d.day::text AS day,
          COALESCE(SUM(t.net_amount) FILTER (
            WHERE t.status = 'Paid' AND t.is_prepayment = false
          ), 0)::numeric(12,2)::text AS revenue
        FROM generate_series(${today}::date - 6, ${today}::date, interval '1 day') AS d(day)
        LEFT JOIN transactions t
          ON (t.transacted_at AT TIME ZONE 'Asia/Manila')::date = d.day::date
          AND t.tenant_id = ${tenantId}
          AND t.deleted_at IS NULL
        GROUP BY d.day
        ORDER BY d.day
      `)

      return { result: agg, trendRows }
    },
  )

  // Money stays a numeric string end-to-end; delta math runs in integer cents.
  const revenueSeries = trendRows.map((r) => r.revenue)
  const toCents = (v: string) => Math.round(parseFloat(v) * 100)
  const last = revenueSeries.length - 1
  const deltaCents =
    revenueSeries.length >= 2
      ? toCents(revenueSeries[last]!) - toCents(revenueSeries[last - 1]!)
      : 0
  const revenueVsPrevDay = (deltaCents / 100).toFixed(2)

  return {
    todayCount: Number(result?.todayCount ?? 0),
    // Raw numeric string — the frontend formats. See listTransactions.
    todayRevenue: String(result?.todayRevenue ?? '0'),
    pendingCount: Number(result?.pendingCount ?? 0),
    // 7 daily points, oldest → newest; today is the final point. Paid-only,
    // matching todayRevenue above.
    trend7d: {
      revenue: revenueSeries,
    },
    // Signed numeric string: today's Paid revenue minus yesterday's (e.g. "-120.00").
    revenueVsPrevDay,
  }
}

/**
 * Day-scoped stats — count + revenue + unsettled + breakdowns by method/status
 * for transactions whose Manila clinic date matches the given calendar day.
 */
export async function getTransactionDayStats(tenantId: string, date: string) {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    // Revenue + AR exclude Voided and Refunded rows. See parallel logic in
    // day_summary/db.ts for the rationale (voided collected nothing; refunds
    // double-deduct if both sides count).
    const [agg] = await tx.execute<{
      count: string
      totalRevenue: string
      totalUnsettled: string
    }>(sql`
      SELECT
        COUNT(*)::text AS count,
        COALESCE(SUM(net_amount) FILTER (
          WHERE status NOT IN ('Voided', 'Refunded') AND is_prepayment = false
        ), 0)::numeric(12,2)::text AS "totalRevenue",
        COALESCE(SUM(amount_outstanding) FILTER (
          WHERE status NOT IN ('Voided', 'Refunded') AND is_prepayment = false
        ), 0)::numeric(12,2)::text AS "totalUnsettled"
      FROM transactions
      WHERE tenant_id = ${tenantId}
        AND (transacted_at AT TIME ZONE 'Asia/Manila')::date = ${date}::date
        AND deleted_at IS NULL
    `)

    // Deposits (is_prepayment) are a liability, not revenue — the cash that
    // funded them is recognized when drawn (a 'Credit' payment on the real
    // consuming txn). Exclude deposit rows so cash isn't double-counted.
    const byMethod = await tx.execute<{ method: string; count: string; total: string }>(sql`
      SELECT
        p.method,
        COUNT(*)::text AS count,
        SUM(p.amount)::numeric(12,2)::text AS total
      FROM payments p
      JOIN transactions t ON t.id = p.transaction_id
      WHERE t.tenant_id = ${tenantId}
        AND (t.transacted_at AT TIME ZONE 'Asia/Manila')::date = ${date}::date
        AND t.deleted_at IS NULL
        AND t.status NOT IN ('Voided', 'Refunded')
        AND t.is_prepayment = false
        AND p.voided_at IS NULL
      GROUP BY p.method
      ORDER BY p.method
    `)

    const byStatus = await tx.execute<{ status: string; count: string }>(sql`
      SELECT
        status,
        COUNT(*)::text AS count
      FROM transactions
      WHERE tenant_id = ${tenantId}
        AND (transacted_at AT TIME ZONE 'Asia/Manila')::date = ${date}::date
        AND deleted_at IS NULL
      GROUP BY status
      ORDER BY status
    `)

    return {
      count: parseInt(agg?.count ?? '0', 10),
      totalRevenue: agg?.totalRevenue ?? '0.00',
      totalUnsettled: agg?.totalUnsettled ?? '0.00',
      byMethod: byMethod.map((r) => ({
        method: r.method,
        count: parseInt(r.count, 10),
        total: r.total,
      })),
      byStatus: byStatus.map((r) => ({
        status: r.status,
        count: parseInt(r.count, 10),
      })),
    }
  })
}

// ── Transaction detail (joined across items, payments, patient, payer, cashier) ─

/**
 * Per-branch receipt configuration, read from `branches.settings` jsonb.
 *
 * Phase 1: every branch resolves to `mode: 'acknowledgement'` (no BIR block in
 * settings) so receipts print as acknowledgement receipts, NOT BIR Official
 * Receipts — the clinic issues manual ORs on request. The pivot to a real
 * BIR-accredited OR is data-only: populate `settings.receipt.bir` on the branch
 * (TIN / permit / OR series) and the receipt renderers switch to official mode.
 */
type BranchReceiptConfig = {
  mode: 'acknowledgement' | 'bir_official'
  bir: {
    tin: string
    registeredName: string
    permitNo: string
    accreditationNo: string | null
    orSeries: string | null
  } | null
}

function extractBranchReceiptConfig(settings: unknown): BranchReceiptConfig {
  const s = (settings ?? {}) as Record<string, unknown>
  const r = (s['receipt'] ?? {}) as Record<string, unknown>
  const raw = r['bir'] as Record<string, unknown> | undefined
  const bir =
    raw && typeof raw['tin'] === 'string' && raw['tin'].length > 0
      ? {
          tin: String(raw['tin']),
          registeredName: String(raw['registeredName'] ?? ''),
          permitNo: String(raw['permitNo'] ?? ''),
          accreditationNo: raw['accreditationNo'] != null ? String(raw['accreditationNo']) : null,
          orSeries: raw['orSeries'] != null ? String(raw['orSeries']) : null,
        }
      : null
  return { mode: bir ? 'bir_official' : 'acknowledgement', bir }
}

export async function getTransaction(opts: { tenantId: string; displayId: string }) {
  const { tenantId, displayId: txnDisplayId } = opts

  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    // We re-select display_ids for joined entities by adding inner aliases.
    const patientsAlias = patients
    const cashierAlias = users
    const payerAlias = payerProfiles
    const prepaidAlias = transactions
    const createdByUser = alias(users, 'created_by_user')
    const itemPatient = alias(patients, 'item_patient')
    const itemLot = alias(inventoryLots, 'item_lot')
    const itemProduct = alias(products, 'item_product')
    const paymentReceiver = alias(users, 'payment_receiver')
    const tpPatient = alias(patients, 'tp_patient')
    const tpEncounter = alias(encounters, 'tp_encounter')

    const [row] = await tx
      .select({
        // transactions
        id: transactions.id,
        displayId: transactions.displayId,
        tenantId: transactions.tenantId,
        branchId: transactions.branchId,
        patientId: transactions.patientId,
        patientDisplayId: patientsAlias.displayId,
        encounterId: transactions.encounterId,
        cashierId: transactions.cashierId,
        cashierDisplayId: cashierAlias.displayId,
        payerId: transactions.payerId,
        payerDisplayId: payerAlias.displayId,
        status: transactions.status,
        receiptNo: transactions.receiptNo,
        branchSeq: transactions.branchSeq,
        discountIdType: transactions.discountIdType,
        discountIdNumber: transactions.discountIdNumber,
        grossAmount: transactions.grossAmount,
        discountAmount: transactions.discountAmount,
        vatAmount: transactions.vatAmount,
        netAmount: transactions.netAmount,
        amountPaid: transactions.amountPaid,
        amountOutstanding: transactions.amountOutstanding,
        vatRate: transactions.vatRate,
        payerContractId: transactions.payerContractId,
        cashDrawerSessionId: transactions.cashDrawerSessionId,
        orSeriesId: transactions.orSeriesId,
        appliedToTransactionId: transactions.appliedToTransactionId,
        replacementTransactionId: transactions.replacementTransactionId,
        refundedFromTransactionId: transactions.refundedFromTransactionId,
        idempotencyKey: transactions.idempotencyKey,
        isPrepayment: transactions.isPrepayment,
        prepaymentAppliedAt: transactions.prepaymentAppliedAt,
        voidedAt: transactions.voidedAt,
        voidedById: transactions.voidedById,
        voidReason: transactions.voidReason,
        transactedAt: transactions.transactedAt,
        deletedAt: transactions.deletedAt,
        createdAt: transactions.createdAt,
        updatedAt: transactions.updatedAt,
        createdById: transactions.createdById,
        // patient
        patientFirstName: patientsAlias.firstName,
        patientLastName: patientsAlias.lastName,
        // cashier
        cashierFirstName: cashierAlias.firstName,
        cashierLastName: cashierAlias.lastName,
        // payer
        payerName: payerAlias.name,
        payerType: payerAlias.payerType,
        // createdBy
        createdByUserId: createdByUser.id,
        createdByDisplayId: createdByUser.displayId,
        createdByFirstName: createdByUser.firstName,
        createdByLastName: createdByUser.lastName,
        // branch (receipt header — values vary per branch of sale)
        branchCode: branches.code,
        branchName: branches.name,
        branchAddress: branches.address,
        branchCity: branches.city,
        branchProvince: branches.province,
        branchContactNumber: branches.contactNumber,
        branchEmail: branches.email,
        branchSettings: branches.settings,
      })
      .from(transactions)
      .innerJoin(patientsAlias, eq(transactions.patientId, patientsAlias.id))
      .leftJoin(cashierAlias, eq(transactions.cashierId, cashierAlias.id))
      .leftJoin(payerAlias, eq(transactions.payerId, payerAlias.id))
      .leftJoin(createdByUser, eq(createdByUser.id, transactions.createdById))
      .leftJoin(branches, eq(transactions.branchId, branches.id))
      .where(and(eq(transactions.displayId, txnDisplayId), eq(transactions.tenantId, tenantId)))
      .limit(1)

    if (!row) return null

    // Resolve display_ids for FK references that need surfacing.
    const [items, paymentRows, encounterRow, prepaidRow, subHeaderRows] = await Promise.all([
      tx
        .select({
          id: transactionItems.id,
          displayId: transactionItems.displayId,
          serviceId: transactionItems.serviceId,
          clinicalOrderId: transactionItems.clinicalOrderId,
          clinicalOrderDisplayId: clinicalOrders.displayId,
          quantity: transactionItems.quantity,
          unitPrice: transactionItems.unitPrice,
          discountAmount: transactionItems.discountAmount,
          vatAmount: transactionItems.vatAmount,
          subtotal: transactionItems.subtotal,
          isVatExempt: transactionItems.isVatExempt,
          isPrepaid: transactionItems.isPrepaid,
          prepaidTransactionId: transactionItems.prepaidTransactionId,
          prepaidTransactionDisplayId: prepaidAlias.displayId,
          // display_id, not the internal bigint: this column is now actually
          // populated (the administered brand), so the old bare-number
          // projection would leak a bigint to the client.
          lotId: itemLot.displayId,
          lotBatchNumber: itemLot.batchNumber,
          lotProductName: itemProduct.name,
          unitCostSnapshot: transactionItems.unitCostSnapshot,
          servicePriceId: transactionItems.servicePriceId,
          performedById: transactionItems.performedById,
          serviceName: serviceCatalog.name,
          serviceCode: serviceCatalog.code,
          serviceType: serviceCatalog.serviceType,
          // Per-line patient (NULL ⇒ header/primary patient — resolved in the map).
          itemPatientDisplayId: itemPatient.displayId,
          itemPatientFirstName: itemPatient.firstName,
          itemPatientLastName: itemPatient.lastName,
        })
        .from(transactionItems)
        .leftJoin(serviceCatalog, eq(transactionItems.serviceId, serviceCatalog.id))
        .leftJoin(clinicalOrders, eq(transactionItems.clinicalOrderId, clinicalOrders.id))
        .leftJoin(prepaidAlias, eq(transactionItems.prepaidTransactionId, prepaidAlias.id))
        .leftJoin(itemPatient, eq(transactionItems.patientId, itemPatient.id))
        .leftJoin(itemLot, eq(transactionItems.lotId, itemLot.id))
        .leftJoin(itemProduct, eq(itemLot.productId, itemProduct.id))
        .where(
          and(eq(transactionItems.transactionId, row.id), eq(transactionItems.tenantId, tenantId)),
        )
        .orderBy(asc(transactionItems.createdAt)),
      tx
        .select({
          id: payments.id,
          displayId: payments.displayId,
          method: payments.method,
          amount: payments.amount,
          payerId: payments.payerId,
          payerDisplayId: payerProfiles.displayId,
          payerName: payerProfiles.name,
          payerType: payerProfiles.payerType,
          referenceNumber: payments.referenceNumber,
          receivedByDisplayId: paymentReceiver.displayId,
          receivedAt: payments.receivedAt,
          notes: payments.notes,
          cashDrawerSessionId: payments.cashDrawerSessionId,
          externalProcessorFee: payments.externalProcessorFee,
          reconciliationStatus: payments.reconciliationStatus,
          clearedAt: payments.clearedAt,
          idempotencyKey: payments.idempotencyKey,
          // A corrected payment stays on the detail view (the correction is
          // meant to be auditable), so the row MUST carry what marks it as
          // superseded. Without these two, a corrected bill renders as two
          // live payments for the same amount, which reads as a double
          // charge to whoever is looking at the receipt.
          voidedAt: payments.voidedAt,
          voidReason: payments.voidReason,
        })
        .from(payments)
        .leftJoin(payerProfiles, eq(payments.payerId, payerProfiles.id))
        .leftJoin(paymentReceiver, eq(payments.receivedById, paymentReceiver.id))
        .where(and(eq(payments.transactionId, row.id), eq(payments.tenantId, tenantId)))
        .orderBy(asc(payments.receivedAt)),
      row.encounterId
        ? tx
            .select({ displayId: encounters.displayId })
            .from(encounters)
            .where(and(eq(encounters.id, row.encounterId), eq(encounters.tenantId, tenantId)))
            .limit(1)
        : Promise.resolve([] as { displayId: string }[]),
      row.appliedToTransactionId
        ? tx
            .select({ displayId: transactions.displayId })
            .from(transactions)
            .where(
              and(
                eq(transactions.id, row.appliedToTransactionId),
                eq(transactions.tenantId, tenantId),
              ),
            )
            .limit(1)
        : Promise.resolve([] as { displayId: string }[]),
      // Per-patient sub-headers (multi-patient). Empty for legacy/seed rows →
      // the return synthesizes a single entry from the header patient.
      tx
        .select({
          patientDisplayId: tpPatient.displayId,
          patientFirstName: tpPatient.firstName,
          patientLastName: tpPatient.lastName,
          encounterDisplayId: tpEncounter.displayId,
          discountIdType: transactionPatients.discountIdType,
          discountIdNumber: transactionPatients.discountIdNumber,
        })
        .from(transactionPatients)
        .innerJoin(tpPatient, eq(transactionPatients.patientId, tpPatient.id))
        .leftJoin(tpEncounter, eq(transactionPatients.encounterId, tpEncounter.id))
        .where(
          and(
            eq(transactionPatients.transactionId, row.id),
            eq(transactionPatients.tenantId, tenantId),
          ),
        )
        .orderBy(asc(transactionPatients.id)),
    ])

    // Items with their effective patient (per-line, else header/primary).
    const itemsOut = items.map((it) => ({
      id: it.displayId,
      serviceId: it.serviceId,
      clinicalOrderId: it.clinicalOrderDisplayId ?? null,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      discountAmount: it.discountAmount,
      vatAmount: it.vatAmount,
      subtotal: it.subtotal,
      isVatExempt: it.isVatExempt,
      isPrepaid: it.isPrepaid,
      prepaidTransactionId: it.prepaidTransactionDisplayId ?? null,
      lotId: it.lotId,
      // The brand actually dispensed for this line, when it bills a dose.
      lot:
        it.lotId && it.lotBatchNumber
          ? {
              id: it.lotId,
              batchNumber: it.lotBatchNumber,
              productName: it.lotProductName ?? null,
            }
          : null,
      unitCostSnapshot: it.unitCostSnapshot,
      servicePriceId: it.servicePriceId,
      performedById: it.performedById,
      service: it.serviceName
        ? {
            id: it.serviceId,
            name: it.serviceName,
            code: it.serviceCode,
            serviceType: it.serviceType,
          }
        : null,
      patient: it.itemPatientDisplayId
        ? {
            id: it.itemPatientDisplayId,
            firstName: it.itemPatientFirstName!,
            lastName: it.itemPatientLastName!,
          }
        : {
            id: row.patientDisplayId,
            firstName: row.patientFirstName,
            lastName: row.patientLastName,
          },
    }))

    // Per-patient net subtotal = sum of line subtotals grouped by effective patient.
    const subtotalCentsByPatient = new Map<string, number>()
    for (const it of itemsOut) {
      subtotalCentsByPatient.set(
        it.patient.id,
        (subtotalCentsByPatient.get(it.patient.id) ?? 0) + toCents(it.subtotal),
      )
    }

    // Per-patient sub-headers. Legacy/seed transactions have no rows → synthesize
    // a single entry from the header patient + header discount.
    const patientsOut =
      subHeaderRows.length > 0
        ? subHeaderRows.map((sh) => ({
            patient: {
              id: sh.patientDisplayId,
              firstName: sh.patientFirstName,
              lastName: sh.patientLastName,
            },
            encounterId: sh.encounterDisplayId ?? null,
            discountIdType: sh.discountIdType,
            discountIdNumber: sh.discountIdNumber,
            subtotal: fromCents(subtotalCentsByPatient.get(sh.patientDisplayId) ?? 0),
          }))
        : [
            {
              patient: {
                id: row.patientDisplayId,
                firstName: row.patientFirstName,
                lastName: row.patientLastName,
              },
              encounterId: encounterRow[0]?.displayId ?? null,
              discountIdType: row.discountIdType,
              discountIdNumber: row.discountIdNumber,
              subtotal: row.netAmount,
            },
          ]

    return {
      id: row.displayId,
      tenantId: row.tenantId,
      branchId: row.branchId,
      patientId: row.patientDisplayId,
      encounterId: encounterRow[0]?.displayId ?? null,
      cashierId: row.cashierDisplayId ?? null,
      payerId: row.payerDisplayId ?? null,
      status: row.status,
      receiptNo: row.receiptNo,
      branchSeq: row.branchSeq,
      discountIdType: row.discountIdType,
      discountIdNumber: row.discountIdNumber,
      grossAmount: row.grossAmount,
      discountAmount: row.discountAmount,
      vatAmount: row.vatAmount,
      netAmount: row.netAmount,
      amountPaid: row.amountPaid,
      amountOutstanding: row.amountOutstanding,
      vatRate: row.vatRate,
      payerContractId: row.payerContractId,
      cashDrawerSessionId: row.cashDrawerSessionId,
      orSeriesId: row.orSeriesId,
      appliedToTransactionId: prepaidRow[0]?.displayId ?? null,
      replacementTransactionId: row.replacementTransactionId,
      refundedFromTransactionId: row.refundedFromTransactionId,
      idempotencyKey: row.idempotencyKey,
      isPrepayment: row.isPrepayment,
      prepaymentAppliedAt: row.prepaymentAppliedAt ? row.prepaymentAppliedAt.toISOString() : null,
      voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
      voidedById: row.voidedById,
      voidReason: row.voidReason,
      transactedAt: row.transactedAt.toISOString(),
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      createdById: row.createdById,
      createdBy: row.createdByUserId
        ? {
            id: row.createdByUserId,
            displayId: row.createdByDisplayId!,
            firstName: row.createdByFirstName!,
            lastName: row.createdByLastName!,
          }
        : null,
      branch: row.branchName
        ? {
            code: row.branchCode!,
            name: row.branchName,
            address: row.branchAddress,
            city: row.branchCity,
            province: row.branchProvince,
            contactNumber: row.branchContactNumber,
            email: row.branchEmail,
            receipt: extractBranchReceiptConfig(row.branchSettings),
          }
        : null,
      patient: {
        id: row.patientDisplayId,
        firstName: row.patientFirstName,
        lastName: row.patientLastName,
      },
      cashier: row.cashierDisplayId
        ? {
            id: row.cashierDisplayId,
            firstName: row.cashierFirstName,
            lastName: row.cashierLastName,
          }
        : null,
      payer: row.payerDisplayId
        ? {
            id: row.payerDisplayId,
            name: row.payerName,
            payerType: row.payerType,
          }
        : null,
      patients: patientsOut,
      items: itemsOut,
      payments: paymentRows.map((p) => ({
        id: p.displayId,
        method: p.method,
        amount: p.amount,
        payerId: p.payerDisplayId ?? null,
        referenceNumber: p.referenceNumber,
        receivedById: p.receivedByDisplayId,
        receivedAt: p.receivedAt.toISOString(),
        notes: p.notes,
        cashDrawerSessionId: p.cashDrawerSessionId,
        externalProcessorFee: p.externalProcessorFee,
        reconciliationStatus: p.reconciliationStatus,
        clearedAt: p.clearedAt ? p.clearedAt.toISOString() : null,
        idempotencyKey: p.idempotencyKey,
        voidedAt: p.voidedAt ? p.voidedAt.toISOString() : null,
        voidReason: p.voidReason,
        payer: p.payerDisplayId
          ? { id: p.payerDisplayId, name: p.payerName, payerType: p.payerType }
          : null,
      })),
    }
  })
}

// ── Create transaction ───────────────────────────────────────────────────────

export type CreateTransactionInput = MoneyAttestationFields & {
  tenantId: string
  /** users.id (bigint) — caller, from req.user.id. */
  userId: number
  /** branches.id (bigint) — caller's primary branch, from req.user.branchId. */
  branchId: number
  idempotencyKey?: string
  /**
   * Module-internal extension point for an entity that must be committed with
   * the transaction header/items/fan-out (for example group_bills). It runs
   * inside this function's `withTenantTx`, after all billable rows exist and
   * before inline payment legs. It is intentionally not exposed by HTTP
   * contracts and must not perform a nested transaction.
   */
  afterTransactionCreated?: (args: {
    tx: Tx
    transactionId: number
    transactionDisplayId: string
    tenantId: string
    branchId: number
    payerId: number | null
    patientIds: readonly number[]
  }) => Promise<void>
  payload: {
    /** patient display_id (PAT_…). */
    patientId: string
    /** encounter display_id (ENC_…). */
    encounterId?: string
    /** payer display_id (PYR_…). */
    payerId?: string
    /** branch display_id is not accepted here; the caller's branchId is used. */
    isPrepayment?: boolean
    /**
     * Free-standing patient credit (deposit). When `isPrepayment` is true and
     * `items` is empty, this is the credit amount stored as the transaction's
     * net — no service lines, no pricing, no bundle fan-out. Drawn down later
     * via Credit payments (see applyPrepayment). NUMERIC(12,2) string.
     */
    depositAmount?: string
    discount?: { idType: DiscountType; idNumber?: string } | null
    items: Array<{
      /** service code (text PK on service_catalog.id). */
      serviceId: string
      /**
       * patient display_id (PAT_…) this line is billed for. Must be the
       * primary `patientId` or appear in `patients[]`. Omit ⇒ primary patient.
       */
      patientId?: string
      /** clinical_order display_id (ORD_…). */
      clinicalOrderId?: string
      quantity: number
      isVatExempt?: boolean
      isPrepaid?: boolean
      /** prepaid transaction display_id (TXN_…). */
      prepaidTransactionId?: string
    }>
    /**
     * Multi-patient sub-headers: per-patient discount + optional encounter for
     * each ADDITIONAL patient on the bill. The top-level `patientId` is the
     * primary; if it also appears here, this entry's discount/encounter wins.
     */
    patients?: Array<{
      /** patient display_id (PAT_…). */
      patientId: string
      /** encounter display_id (ENC_…). */
      encounterId?: string
      discount?: { idType: DiscountType; idNumber?: string } | null
    }>
    payment?: {
      method: PaymentMethod
      amount: string
      referenceNumber?: string
      /** payer display_id (PYR_…). */
      payerId?: string
      notes?: string
    }
    /**
     * Split tender — multiple payment legs applied atomically inside the create
     * transaction. Each leg becomes its own `payments` row. Mutually exclusive
     * with `payment`; when both are present, `payments` takes precedence.
     */
    payments?: Array<{
      method: PaymentMethod
      amount: string
      referenceNumber?: string
      /** payer display_id (PYR_…). */
      payerId?: string
      notes?: string
    }>
    /**
     * Who physically took the inline payment (single `payment` leg, or every
     * leg in `payments[]`): one attestation for the whole create call. See
     * `MoneyAttestationFields`.
     */
    attestedById?: string
    attestationPin?: string
  }
}

export type CreateTransactionResult =
  | {
      ok: true
      /** transaction display_id (TXN_…). */
      id: string
      status: 'Draft' | 'Pending' | 'Paid'
      receiptNo: string | null
      /** payment display_id (PMT_…) or null. */
      paymentId: string | null
    }
  | { ok: false; status: number; error: string; code: string; details?: unknown }

/**
 * BIR senior-citizen / PWD discount id type. Derived from the table's insert
 * model so the enum values stay in one place (`OSCA` | `PWD` | `Other`).
 */
type DiscountIdType = (typeof transactions.$inferInsert)['discountIdType']

/**
 * Inserts a transaction header, allocating the gapless per-branch sequence.
 *
 * Shared by `createTransaction` (itemised bills AND free-standing deposits) and
 * `payOnAccount` (the deposit that banks an overpayment as patient credit), so
 * the header shape has exactly one definition. A second copy would drift the
 * first time a column is added, and three of these fields carry non-obvious
 * rules: `branch_seq` comes from the TXN counter, `amount_outstanding` is
 * GENERATED and must never be written, and `receipt_no` stays NULL here because
 * `addPaymentTx` mints it on the leg that crosses to Paid.
 */
async function insertTransactionHeaderTx(
  tx: Tx,
  args: {
    tenantId: string
    branchId: number
    userId: number
    patientId: number
    encounterId: number | null
    payerId: number | null
    discountIdType: DiscountIdType
    discountIdNumber: string | null
    grossAmount: string
    discountAmount: string
    vatAmount: string
    netAmount: string
    isPrepayment: boolean
    idempotencyKey?: string | null
    transactedAt: Date
  },
): Promise<{ id: number; displayId: string; branchSeq: number }> {
  const txnDisplayId = displayId('TXN')

  // Gapless per-branch sequence, allocated atomically in this tx (FOR UPDATE on
  // the tenant_counters row). counter_kind='TXN' is the convention shared with
  // peekCounter callers (e.g. the admin/branches roster). Distinct from the BIR
  // receipt_no, which is tenant-issued and allocated on the Paid transition.
  const branchSeq = await allocateCounter(tx, {
    tenantId: args.tenantId,
    branchId: args.branchId,
    counterKind: 'TXN',
  })

  const [inserted] = await tx
    .insert(transactions)
    .values({
      displayId: txnDisplayId,
      tenantId: args.tenantId,
      branchId: args.branchId,
      branchSeq,
      patientId: args.patientId,
      encounterId: args.encounterId,
      cashierId: args.userId,
      payerId: args.payerId,
      status: 'Pending',
      // receipt_no is NULL on insert; addPaymentTx allocates it when a payment
      // pushes the row to Paid.
      discountIdType: args.discountIdType,
      discountIdNumber: args.discountIdNumber,
      grossAmount: args.grossAmount,
      discountAmount: args.discountAmount,
      vatAmount: args.vatAmount,
      netAmount: args.netAmount,
      // amount_outstanding is GENERATED, never set.
      isPrepayment: args.isPrepayment,
      idempotencyKey: args.idempotencyKey ?? null,
      transactedAt: args.transactedAt,
      createdById: args.userId,
    })
    .returning({ id: transactions.id })

  return { id: inserted!.id, displayId: txnDisplayId, branchSeq }
}

/**
 * Inserts the per-patient sub-headers. Always at least one row (the primary):
 * omitting it makes the transaction read as a legacy row and sends the detail
 * endpoint down its header-patient fallback instead of the `patients[]` path.
 */
async function insertTransactionPatientsTx(
  tx: Tx,
  args: {
    tenantId: string
    transactionId: number
    userId: number
    rows: ReadonlyArray<{
      patientId: number
      encounterId: number | null
      discountIdType: DiscountIdType
      discountIdNumber: string | null
    }>
  },
): Promise<void> {
  await tx.insert(transactionPatients).values(
    args.rows.map((r) => ({
      tenantId: args.tenantId,
      transactionId: args.transactionId,
      patientId: r.patientId,
      encounterId: r.encounterId,
      discountIdType: r.discountIdType,
      discountIdNumber: r.discountIdNumber,
      createdById: args.userId,
    })),
  )
}

/** One tender leg, with the payer still as a display_id (resolved per leg). */
type PaymentLegInput = {
  method: PaymentMethod
  amount: string
  referenceNumber?: string | null
  /** payer display_id (PYR_…), resolved per leg. */
  payerId?: string | null
  /** Already-resolved payers.id, so a caller that resolved once need not re-look-up per leg. */
  resolvedPayerId?: number | null
  notes?: string | null
  idempotencyKey?: string
}

/**
 * Walks N tender legs through `addPaymentTx` in order, inside the caller's tx.
 *
 * Sequential by design: the running sum is what transitions the status
 * Pending -> Paid, mints the BIR receipt on the crossing leg, and lets MONEY-5
 * cap each leg at the balance still outstanding (so an over-allocated split is
 * rejected). Throws `LifecycleError`; callers that need a result envelope map it.
 */
async function applyPaymentLegsTx(
  tx: Tx,
  args: {
    tenantId: string
    userId: number
    branchId: number | null
    transactionId: number
    initialStatus: 'Draft' | 'Pending' | 'Paid'
    legs: ReadonlyArray<PaymentLegInput>
    fundedByTransactionId?: number | null
    /** Who took every leg in this batch: one attestation per call, already resolved. */
    receivedById?: number
  },
): Promise<{
  paymentDisplayId: string | null
  status: 'Draft' | 'Pending' | 'Paid'
  receiptNo: string | null
  legs: Array<{ paymentDisplayId: string; amount: string; status: 'Draft' | 'Pending' | 'Paid' }>
}> {
  let paymentDisplayId: string | null = null
  let status = args.initialStatus
  let receiptNo: string | null = null
  const applied: Array<{
    paymentDisplayId: string
    amount: string
    status: 'Draft' | 'Pending' | 'Paid'
  }> = []

  for (const leg of args.legs) {
    let legPayerId: number | null = leg.resolvedPayerId ?? null
    if (legPayerId === null && leg.payerId) {
      legPayerId = await resolvePayerId(tx, args.tenantId, leg.payerId)
      if (legPayerId === null) {
        throw new LifecycleError('Payment payer not found', 'PAYER_NOT_FOUND', 404)
      }
    }
    const result = await addPaymentTx(tx, {
      tenantId: args.tenantId,
      userId: args.userId,
      branchId: args.branchId,
      transactionId: args.transactionId,
      method: leg.method,
      amount: leg.amount,
      referenceNumber: leg.referenceNumber ?? null,
      payerId: legPayerId,
      notes: leg.notes ?? null,
      ...(leg.idempotencyKey ? { idempotencyKey: leg.idempotencyKey } : {}),
      ...(args.fundedByTransactionId != null
        ? { fundedByTransactionId: args.fundedByTransactionId }
        : {}),
      ...(args.receivedById !== undefined ? { receivedById: args.receivedById } : {}),
    })
    // Report the FIRST leg's payment id (back-compat with the single-payment
    // shape); status + receiptNo reflect the latest leg, i.e. the final state.
    paymentDisplayId = paymentDisplayId ?? result.payment.displayId
    status = result.status
    receiptNo = result.receiptNo
    applied.push({
      paymentDisplayId: result.payment.displayId,
      amount: leg.amount,
      status: result.status,
    })
  }

  return { paymentDisplayId, status, receiptNo, legs: applied }
}

/**
 * Inserts a new transaction header + items inside a single tenant-scoped
 * transaction with RLS context set. Public surface uses display_ids; internal
 * FKs are bigints captured via `.returning()`.
 *
 * `receipt_no` (BIR Official Receipt) is NOT auto-generated. The column is
 * nullable; a future `tenant_counters` table will issue gapless sequential
 * numbers once BIR registration completes. `amount_outstanding` is a
 * GENERATED column — never INSERT/UPDATE it.
 */
export async function createTransaction(
  input: CreateTransactionInput,
): Promise<CreateTransactionResult> {
  const { tenantId, userId, branchId, idempotencyKey, payload } = input

  // A free-standing patient credit (isPrepayment + depositAmount) is the only
  // shape allowed to have no service lines. Everything else needs ≥1 item.
  const isDeposit = (payload.isPrepayment ?? false) && payload.items.length === 0
  if (payload.items.length === 0 && !isDeposit) {
    return { ok: false, status: 400, error: 'At least one item is required', code: 'NO_ITEMS' }
  }
  if (isDeposit && !payload.depositAmount) {
    return {
      ok: false,
      status: 400,
      error: 'A deposit requires depositAmount',
      code: 'DEPOSIT_AMOUNT_REQUIRED',
    }
  }

  const discounts = [
    { path: 'discount', value: payload.discount },
    ...(payload.patients ?? []).map((patient, index) => ({
      path: `patients.${index}.discount`,
      value: patient.discount,
    })),
  ]
  const missingDiscountId = discounts.find(
    ({ value }) => (value?.idType === 'OSCA' || value?.idType === 'PWD') && !value.idNumber?.trim(),
  )
  if (missingDiscountId) {
    return {
      ok: false,
      status: 400,
      error: 'Senior/PWD ID number is required',
      code: 'DISCOUNT_ID_REQUIRED',
      details: { path: `${missingDiscountId.path}.idNumber` },
    }
  }

  // Inline payment leg(s), computed here (pure, no DB) so the money
  // attestation below can resolve BEFORE the tx opens: see
  // resolveReceivedById's doc comment. Split tender (`payments`) takes
  // precedence over the singular `payment`; re-read again at step 9 for the
  // actual apply.
  const inlinePaymentLegs =
    payload.payments && payload.payments.length > 0
      ? payload.payments
      : payload.payment
        ? [payload.payment]
        : []
  // The scheduled-order collect flow deliberately creates the bill first and
  // applies payment second. When it supplies attestation with that create,
  // validate the human/PIN before opening the financial transaction even
  // though there is no inline payment leg yet. A bad PIN therefore cannot
  // leave an orphan Pending bill for a later retry to duplicate.
  const shouldValidateAttestation =
    inlinePaymentLegs.length > 0 ||
    payload.attestedById !== undefined ||
    payload.attestationPin !== undefined
  const receivedById = shouldValidateAttestation
    ? await resolveReceivedById(tenantId, branchId, userId, {
        moneyCaller: input.moneyCaller,
        attestedById: payload.attestedById,
        attestationPin: payload.attestationPin,
      })
    : undefined

  const creation = withTenantTx({ tenantId, userId, branchId }, async (tx) => {
    // 1. Resolve patient display_id → bigint.
    const patientId = await resolvePatientId(tx, tenantId, payload.patientId)
    if (patientId === null) {
      return {
        ok: false as const,
        status: 404,
        error: 'Patient not found',
        code: 'PATIENT_NOT_FOUND',
      }
    }

    // 2. Resolve optional encounter display_id; verify same patient.
    let encounterId: number | null = null
    if (payload.encounterId) {
      const enc = await resolveEncounterId(tx, tenantId, payload.encounterId)
      if (!enc) {
        return {
          ok: false as const,
          status: 404,
          error: 'Encounter not found',
          code: 'ENCOUNTER_NOT_FOUND',
        }
      }
      if (enc.patientId !== patientId) {
        return {
          ok: false as const,
          status: 400,
          error: 'Encounter does not belong to the given patient',
          code: 'ENCOUNTER_PATIENT_MISMATCH',
        }
      }
      encounterId = enc.id
    }

    // 3. Resolve optional payer display_id.
    let payerId: number | null = null
    if (payload.payerId) {
      payerId = await resolvePayerId(tx, tenantId, payload.payerId)
      if (payerId === null) {
        return {
          ok: false as const,
          status: 404,
          error: 'Payer not found',
          code: 'PAYER_NOT_FOUND',
        }
      }
    }

    // 3b. Multi-patient resolution. Build per-patient sub-headers (the primary
    //     is always present), keyed by bigint patient id, plus a display_id→bigint
    //     map for resolving each line's patient. transactions.patient_id stays the
    //     primary / bill-to patient; additional patients may own line items.
    type SubHeader = {
      patientId: number
      encounterId: number | null
      discountIdType: 'OSCA' | 'PWD' | 'Other' | null
      discountIdNumber: string | null
      discountType: DiscountType | null
    }
    const toIdType = (d: DiscountType | null): 'OSCA' | 'PWD' | 'Other' | null =>
      d && d !== 'NA' ? (d as 'OSCA' | 'PWD' | 'Other') : null
    const headerDiscountType: DiscountType | null = payload.discount?.idType ?? null

    const subHeaders = new Map<number, SubHeader>()
    const pidByDisplay = new Map<string, number>()
    pidByDisplay.set(payload.patientId, patientId)
    subHeaders.set(patientId, {
      patientId,
      encounterId,
      discountIdType: toIdType(headerDiscountType),
      discountIdNumber: payload.discount?.idNumber?.trim() || null,
      discountType: headerDiscountType,
    })

    for (const p of payload.patients ?? []) {
      const pid = await resolvePatientId(tx, tenantId, p.patientId)
      if (pid === null) {
        return {
          ok: false as const,
          status: 404,
          error: `Patient not found: ${p.patientId}`,
          code: 'PATIENT_NOT_FOUND',
        }
      }
      let pEncounterId: number | null = pid === patientId ? encounterId : null
      if (p.encounterId) {
        const enc = await resolveEncounterId(tx, tenantId, p.encounterId)
        if (!enc) {
          return {
            ok: false as const,
            status: 404,
            error: 'Encounter not found',
            code: 'ENCOUNTER_NOT_FOUND',
          }
        }
        if (enc.patientId !== pid) {
          return {
            ok: false as const,
            status: 400,
            error: 'Encounter does not belong to the given patient',
            code: 'ENCOUNTER_PATIENT_MISMATCH',
          }
        }
        pEncounterId = enc.id
      }
      const pDiscountType: DiscountType | null = p.discount?.idType ?? null
      pidByDisplay.set(p.patientId, pid)
      subHeaders.set(pid, {
        patientId: pid,
        encounterId: pEncounterId,
        discountIdType: toIdType(pDiscountType),
        discountIdNumber: p.discount?.idNumber?.trim() || null,
        discountType: pDiscountType,
      })
    }

    // Resolve each line's patient (default = primary). Reject a line whose
    // patient was not declared (the primary `patientId` or an entry in patients[]).
    const itemPatientIds: number[] = []
    for (const item of payload.items) {
      if (item.patientId) {
        const ip = pidByDisplay.get(item.patientId)
        if (ip === undefined) {
          return {
            ok: false as const,
            status: 400,
            error: `Line patient ${item.patientId} is not declared on this transaction (add it to patients[])`,
            code: 'ITEM_PATIENT_NOT_DECLARED',
          }
        }
        itemPatientIds.push(ip)
      } else {
        itemPatientIds.push(patientId)
      }
    }

    // Effective patients on this transaction = primary ∪ every line's patient.
    const effectivePatientIds = Array.from(new Set<number>([patientId, ...itemPatientIds]))

    if (!isDeposit) {
      // DPA consent gate — once per unique effective patient. Throws
      // LifecycleError('CONSENT_REVOKED', 403) (handled by the route). This also
      // closes a pre-existing gap: non-bundle creates previously ran no consent
      // check at all during transaction creation.
      for (const pid of effectivePatientIds) {
        await assertActiveConsent(tx, tenantId, pid)
      }

      // D2 branch invariant for SECONDARY patients. The DB trigger only validates
      // the header/primary patient on INSERT, so check each secondary here.
      for (const pid of effectivePatientIds) {
        if (pid === patientId) continue
        const lastBranch = await lastAdministeredBranchId(tx, tenantId, pid)
        if (lastBranch !== null && lastBranch !== branchId) {
          return {
            ok: false as const,
            status: 409,
            error:
              'A patient on this transaction was last administered at a different branch. Cross-branch transactions are forbidden.',
            code: 'D2_CROSS_BRANCH_SECONDARY',
          }
        }
      }
    }

    // 4–6. Service validation, pricing, totals, and per-item FK resolution.
    //      A free-standing deposit (isDeposit) has no service lines: its net is
    //      the depositAmount verbatim, so the whole block below is skipped.
    let totals: TotalsResult
    const resolvedItems: Array<{
      clinicalOrderId: number | null
      prepaidTransactionId: number | null
    }> = []
    // clinical-order display_id → the lot/brand already administered for it.
    // Populated in step 4b; read again in step 8 to stamp `transaction_items.lot_id`.
    let administeredBrands = new Map<string, { lotId: number; productId: number }>()

    if (isDeposit) {
      const depositAmt = payload.depositAmount!
      if (toCents(depositAmt) <= 0) {
        return {
          ok: false as const,
          status: 400,
          error: 'Deposit amount must be greater than zero',
          code: 'INVALID_DEPOSIT_AMOUNT',
        }
      }
      totals = {
        grossAmount: depositAmt,
        discountAmount: '0.00',
        vatAmount: '0.00',
        netAmount: depositAmt,
        lines: [],
      }
    } else {
      // 4. Validate services exist + are active, then snapshot prices using
      //    the transaction's (branchId, payerId) so partner/HMO contracts apply.
      const serviceIds = Array.from(new Set(payload.items.map((i) => i.serviceId)))
      const svcRows = await tx
        .select({ id: serviceCatalog.id, isActive: serviceCatalog.isActive })
        .from(serviceCatalog)
        .where(and(eq(serviceCatalog.tenantId, tenantId), inArray(serviceCatalog.id, serviceIds)))

      if (svcRows.length !== serviceIds.length) {
        const found = new Set(svcRows.map((s) => s.id))
        const missing = serviceIds.filter((id) => !found.has(id))
        return {
          ok: false as const,
          status: 400,
          error: 'One or more services not found',
          code: 'SERVICE_NOT_FOUND',
          details: { missing },
        }
      }
      const inactive = svcRows.filter((s) => !s.isActive).map((s) => s.id)
      if (inactive.length > 0) {
        return {
          ok: false as const,
          status: 400,
          error: 'One or more services are inactive',
          code: 'SERVICE_INACTIVE',
          details: { inactive },
        }
      }

      // Resolve payer/branch-specific prices in parallel (most-specific-wins via
      // resolveServicePrice scoring). This replaces the hardcoded isNull(branchId)
      // + isNull(payerId) join so partner/HMO rates are applied correctly.
      const priceEntries = await Promise.all(
        serviceIds.map(async (serviceId) => {
          const unitPrice = await resolveServicePrice(tx, {
            tenantId,
            serviceId,
            branchId,
            payerId,
          })
          return [serviceId, { id: serviceId, basePrice: unitPrice }] as const
        }),
      )
      const catalog: ServicePriceLookup = Object.fromEntries(priceEntries)

      // 4b. Brand-aware pricing for lines billing an already-administered dose.
      //     The chosen lot fixes the product, which may carry its own price
      //     (payer rows still outrank it — see shared/lib/pricing.ts).
      administeredBrands = await resolveAdministeredBrands(
        tx,
        tenantId,
        payload.items.map((i) => i.clinicalOrderId).filter((id): id is string => !!id),
      )
      const brandPriceCache = new Map<string, string>()
      for (const item of payload.items) {
        const brand = item.clinicalOrderId
          ? administeredBrands.get(item.clinicalOrderId)
          : undefined
        if (!brand) continue
        const key = `${item.serviceId}|${brand.productId}`
        if (brandPriceCache.has(key)) continue
        brandPriceCache.set(
          key,
          await resolveServicePrice(tx, {
            tenantId,
            serviceId: item.serviceId,
            branchId,
            payerId,
            productId: brand.productId,
          }),
        )
      }
      const brandUnitPrice = (item: { serviceId: string; clinicalOrderId?: string }) => {
        const brand = item.clinicalOrderId
          ? administeredBrands.get(item.clinicalOrderId)
          : undefined
        return brand ? (brandPriceCache.get(`${item.serviceId}|${brand.productId}`) ?? null) : null
      }

      // 5. Compute totals (cent-integer math). Each line uses ITS patient's
      //    SC/PWD discount (multi-patient); the header discount remains the
      //    transaction-wide fallback for the primary / single-patient path.
      totals = computeTransactionTotals(
        payload.items.map((i, idx) => ({
          serviceId: i.serviceId,
          quantity: i.quantity,
          isVatExempt: i.isVatExempt ?? false,
          isPrepaid: i.isPrepaid ?? false,
          discountType: subHeaders.get(itemPatientIds[idx]!)?.discountType ?? null,
          unitPriceOverride: brandUnitPrice(i),
        })),
        headerDiscountType,
        catalog,
      )

      // 6. Resolve clinical_order + prepaid_transaction display_ids per item.
      for (const [itemIndex, item] of payload.items.entries()) {
        let clinicalOrderId: number | null = null
        if (item.clinicalOrderId) {
          const clinicalOrder = await resolveClinicalOrderId(tx, tenantId, item.clinicalOrderId)
          if (clinicalOrder === null) {
            return {
              ok: false as const,
              status: 404,
              error: `Clinical order not found: ${item.clinicalOrderId}`,
              code: 'CLINICAL_ORDER_NOT_FOUND',
            }
          }
          if (clinicalOrder.patientId !== itemPatientIds[itemIndex]) {
            return {
              ok: false as const,
              status: 422,
              error: `Clinical order belongs to a different patient: ${item.clinicalOrderId}`,
              code: 'CLINICAL_ORDER_PATIENT_MISMATCH',
            }
          }
          if (clinicalOrder.serviceId !== item.serviceId) {
            return {
              ok: false as const,
              status: 422,
              error: `Clinical order service does not match the billed service: ${item.clinicalOrderId}`,
              code: 'CLINICAL_ORDER_SERVICE_MISMATCH',
            }
          }
          if (item.isPrepaid && !isClinicalOrderPrepayable(clinicalOrder.status)) {
            return {
              ok: false as const,
              status: 422,
              error: `Clinical order is not eligible for prepayment: ${item.clinicalOrderId}`,
              code: 'CLINICAL_ORDER_NOT_PREPAYABLE',
            }
          }
          clinicalOrderId = clinicalOrder.id
        }
        let prepaidTransactionId: number | null = null
        if (item.prepaidTransactionId) {
          prepaidTransactionId = await resolveTransactionId(tx, tenantId, item.prepaidTransactionId)
          if (prepaidTransactionId === null) {
            return {
              ok: false as const,
              status: 404,
              error: `Prepaid transaction not found: ${item.prepaidTransactionId}`,
              code: 'PREPAID_NOT_FOUND',
            }
          }
        }
        resolvedItems.push({ clinicalOrderId, prepaidTransactionId })
      }

      const clinicalOrderIds = resolvedItems
        .map((item) => item.clinicalOrderId)
        .filter((id): id is number => id !== null)
      if (clinicalOrderIds.length > 0) {
        const [activeBilling] = await tx
          .select({
            clinicalOrderId: clinicalOrders.displayId,
            transactionId: transactions.displayId,
          })
          .from(transactionItems)
          .innerJoin(
            transactions,
            and(
              eq(transactions.tenantId, transactionItems.tenantId),
              eq(transactions.id, transactionItems.transactionId),
            ),
          )
          .innerJoin(
            clinicalOrders,
            and(
              eq(clinicalOrders.tenantId, transactionItems.tenantId),
              eq(clinicalOrders.id, transactionItems.clinicalOrderId),
            ),
          )
          .where(
            and(
              eq(transactionItems.tenantId, tenantId),
              inArray(transactionItems.clinicalOrderId, clinicalOrderIds),
              isNull(transactions.deletedAt),
              notInArray(transactions.status, ['Voided', 'Refunded']),
            ),
          )
          .limit(1)

        if (activeBilling) {
          return {
            ok: false as const,
            status: 409,
            error:
              'This clinical order is already billed on an active transaction. Void or refund that transaction before billing it again.',
            code: 'CLINICAL_ORDER_ALREADY_BILLED',
            details: activeBilling,
          }
        }
      }
    }

    // 7. Insert transaction header — capture bigint via .returning().
    const now = new Date()
    const status = 'Pending' as const
    const isPrepayment = payload.isPrepayment ?? false

    const header = await insertTransactionHeaderTx(tx, {
      tenantId,
      branchId,
      userId,
      patientId,
      encounterId,
      payerId,
      // Header discount mirrors the PRIMARY patient's sub-header (which may
      // have been overridden by a matching patients[] entry).
      discountIdType: subHeaders.get(patientId)!.discountIdType,
      discountIdNumber: subHeaders.get(patientId)!.discountIdNumber,
      grossAmount: totals.grossAmount,
      discountAmount: totals.discountAmount,
      vatAmount: totals.vatAmount,
      netAmount: totals.netAmount,
      isPrepayment,
      idempotencyKey: idempotencyKey ?? null,
      transactedAt: now,
    })
    const txnDisplayId = header.displayId
    const txnId = header.id

    // 8. Insert items.
    const itemRows = payload.items.map((item, idx) => {
      const line = totals.lines[idx]!
      const resolved = resolvedItems[idx]!
      return {
        displayId: displayId('TXI'),
        tenantId,
        transactionId: txnId,
        serviceId: item.serviceId,
        // Per-line patient: NULL when it's the primary (the row inherits the
        // header patient on read), else the bigint id (a secondary patient line).
        patientId: itemPatientIds[idx] === patientId ? null : itemPatientIds[idx]!,
        clinicalOrderId: resolved.clinicalOrderId,
        // Brand actually dispensed, when this line bills an administered dose.
        // Null for lines billed in advance — stamped later by administerOrderTx.
        lotId: item.clinicalOrderId
          ? (administeredBrands.get(item.clinicalOrderId)?.lotId ?? null)
          : null,
        quantity: String(item.quantity),
        unitPrice: line.unitPrice,
        discountAmount: line.discountAmount,
        isVatExempt: line.isVatExempt,
        vatAmount: line.vatAmount,
        subtotal: line.subtotal,
        isPrepaid: item.isPrepaid ?? false,
        prepaidTransactionId: resolved.prepaidTransactionId,
        createdById: userId,
      }
    })

    // A deposit has no item rows; Drizzle rejects an empty .values([]).
    if (itemRows.length > 0) {
      await tx.insert(transactionItems).values(itemRows)
    }

    // 8a. Insert per-patient sub-headers — always ≥1 (the primary), one per
    //     effective patient on the bill. Holds each patient's SC/PWD discount +
    //     optional encounter so reads are uniform across single- and multi-patient
    //     transactions.
    await insertTransactionPatientsTx(tx, {
      tenantId,
      transactionId: txnId,
      userId,
      rows: effectivePatientIds.map((pid) => {
        const sh = subHeaders.get(pid)!
        return {
          patientId: pid,
          encounterId: sh.encounterId,
          discountIdType: sh.discountIdType,
          discountIdNumber: sh.discountIdNumber,
        }
      }),
    })

    // 8b. Bundle fan-out — for each transaction item whose service_catalog row
    // has service_bundle_items constituents, atomically create one clinical_orders
    // row (non-Lab) or lab_orders row (Lab) per constituent. Driven by the ITEM's
    // patient + that patient's encounter (multi-patient), not the header.
    //
    // The bundle stays the single billable line in transaction_items (no change
    // to pricing or totals). Fan-out only creates the work-order rows that
    // downstream clinical flows (administer, lab send, etc.) operate on.
    //
    // BundleFanOutError propagates up to the withTenantTx boundary, rolling
    // back the entire transaction (header + items + any partial fan-out).
    for (let idx = 0; idx < payload.items.length; idx++) {
      const item = payload.items[idx]!
      const isBundle = await isBundleService(tenantId, item.serviceId, tx)
      if (isBundle) {
        const itemPid = itemPatientIds[idx]!
        await fanOutBundle({
          tenantId,
          branchId,
          userId,
          bundleServiceId: item.serviceId,
          encounterId: subHeaders.get(itemPid)?.encounterId ?? null,
          patientId: itemPid,
          transactionId: txnId,
          tx,
        })
      }
    }

    // Keep companion records that identify a specialized billing owner in the
    // same atomic unit as the money engine. Calling code receives only public
    // display ids; bigint values in this hook never cross an HTTP boundary.
    if (input.afterTransactionCreated) {
      await input.afterTransactionCreated({
        tx,
        transactionId: txnId,
        transactionDisplayId: txnDisplayId,
        tenantId,
        branchId,
        payerId,
        patientIds: effectivePatientIds,
      })
    }

    // 9. Optional inline payment(s). `payments` (split tender) takes precedence
    //    over the singular `payment`; otherwise fall back to the single leg.
    //    Each leg is walked through addPaymentTx in order inside this same tx —
    //    the running sum naturally transitions status Pending→Paid, allocates
    //    the BIR receipt on the crossing leg, and MONEY-5 caps each leg at the
    //    current outstanding balance (rejecting an over-allocated split).
    //    `inlinePaymentLegs` / `receivedById` were computed above, BEFORE this
    //    tx opened: see resolveReceivedById's doc comment.
    let legResult: Awaited<ReturnType<typeof applyPaymentLegsTx>>
    try {
      legResult = await applyPaymentLegsTx(tx, {
        tenantId,
        userId,
        branchId,
        transactionId: txnId,
        initialStatus: status,
        legs: inlinePaymentLegs,
        ...(receivedById !== undefined ? { receivedById } : {}),
      })
    } catch (err) {
      if (err instanceof LifecycleError) {
        return {
          ok: false as const,
          status: err.httpStatus,
          error: err.message,
          code: err.code,
          ...(err.details ? { details: err.details } : {}),
        }
      }
      throw err
    }

    return {
      ok: true as const,
      id: txnDisplayId,
      status: legResult.status,
      receiptNo: legResult.receiptNo,
      paymentId: legResult.paymentDisplayId,
    }
  })

  try {
    return await creation
  } catch (err) {
    const pg = err as { code?: string; constraint?: string; constraint_name?: string }
    if (
      pg.code === '23505' &&
      (pg.constraint === 'transaction_items_one_active_clinical_order' ||
        pg.constraint_name === 'transaction_items_one_active_clinical_order')
    ) {
      return {
        ok: false,
        status: 409,
        error:
          'This clinical order is already billed on an active transaction. Void or refund that transaction before billing it again.',
        code: 'CLINICAL_ORDER_ALREADY_BILLED',
      }
    }
    throw err
  }
}

// ── Lifecycle: addPayment / void / refund / applyPrepayment ──────────────────

export type PaymentMethod =
  | 'Cash'
  | 'GCash'
  | 'Maya'
  | 'BankTransfer'
  | 'Card'
  | 'PayMongo'
  | 'HMO'
  | 'Corporate'
  | 'Other'
  | 'Credit'

/**
 * Internal (already-resolved) payment args used by the tx-level helper. The
 * public-facing wrappers (`addPayment`) accept display_ids and resolve before
 * calling this.
 */
type InternalAddPaymentArgs = TenantCtx & {
  /** transactions.id (bigint) — already resolved. */
  transactionId: number
  method: PaymentMethod
  amount: string
  referenceNumber?: string | null
  /** payer_profiles.id (bigint) — already resolved. */
  payerId?: number | null
  notes?: string | null
  idempotencyKey?: string
  /**
   * When method='Credit', the source prepayment/deposit transaction (bigint)
   * whose balance funds this draw. Recorded on payments.funded_by_transaction_id
   * so the deposit's remaining balance is derivable.
   */
  fundedByTransactionId?: number | null
  /**
   * Who physically took the money, and when. Both default to the calling user
   * and now, which is right for an ordinary payment. `correctPaymentMethod`
   * overrides them to carry the ORIGINAL payment's values onto the
   * replacement: only the method was mis-recorded, the money still arrived
   * when it arrived and from whoever received it. Without the override a
   * correction silently reassigns the collection to whoever fixed the typo,
   * which moves both cashiers' `shifts.getCurrentShift` figures (it filters on
   * received_by_id + received_at). `created_by_id` still records the corrector.
   */
  receivedById?: number
  receivedAt?: Date
}

type PaymentResult = {
  payment: typeof payments.$inferSelect
  status: 'Draft' | 'Pending' | 'Paid'
  /** receipt_no remains null in this design (BIR sequence deferred). */
  receiptNo: string | null
}

/** Tx-aware payment insert + status transition. */
async function addPaymentTx(tx: Tx, args: InternalAddPaymentArgs): Promise<PaymentResult> {
  const [txn] = await tx
    .select({
      id: transactions.id,
      status: transactions.status,
      netAmount: transactions.netAmount,
      receiptNo: transactions.receiptNo,
    })
    .from(transactions)
    .where(and(eq(transactions.id, args.transactionId), eq(transactions.tenantId, args.tenantId)))
    .limit(1)
    // Lock the header for the rest of this transaction. The MONEY-5 check below
    // is read-then-write, and a row lock on `transactions` is what serializes it:
    // locking rows in `payments` cannot, because the race is two sessions both
    // INSERTing after both read the same outstanding. Without this, two
    // concurrent payments on one bill can each pass the cap and push amount_paid
    // above net_amount. Safe against the immutability trigger, which is
    // BEFORE UPDATE, and a row lock performs no UPDATE so fires no trigger.
    .for('update')
  if (!txn) throw new LifecycleError('Transaction not found', 'NOT_FOUND', 404)
  if (txn.status === 'Voided' || txn.status === 'Refunded') {
    throw new LifecycleError(`Cannot add payment to ${txn.status} transaction`, 'INVALID_STATE')
  }

  // MONEY-5: cap-and-reject overpayment for partial / single payments. The
  // payment ledger records the amount APPLIED to the bill, not cash tendered —
  // change due is a drawer concern, not a payment row — so a payment must never
  // push amount_paid above net_amount. Compute outstanding from the existing
  // (positive, live) partial payments and reject if this one would overshoot.
  // Voided rows (payment-method correction) never count toward this cap, a
  // corrected row's replacement is what's live. See "Revenue + AR aggregates"
  // in patterns.md.
  const [priorSumRow] = await tx
    .select({
      total: sql<string>`COALESCE(SUM(CAST(${payments.amount} AS numeric)), 0)`,
    })
    .from(payments)
    .where(
      and(
        eq(payments.transactionId, args.transactionId),
        eq(payments.tenantId, args.tenantId),
        isNull(payments.voidedAt),
      ),
    )
  const outstandingCents = toCents(txn.netAmount) - toCents(priorSumRow?.total ?? '0')

  // MONEY-5: guard against overpayment on an already-Paid transaction. Without
  // this check a second addPayment call (e.g. double-tap or manual API call)
  // inserts a new positive payment row, growing amount_paid above net_amount
  // silently (the generated amount_outstanding stays at 0 but the payment
  // ledger has phantom cash that reconciliation would overcount).
  //
  // Deliberately checks the LIVE outstanding (just computed above), not just
  // `txn.status === 'Paid'` in isolation: `correctPaymentMethod` voids the
  // payment it's replacing (and `sync_transaction_amounts` recomputes
  // `amount_paid` excluding it) in the SAME db transaction before calling this
  // function, but that trigger only touches `amount_paid`: it does NOT flip
  // `transactions.status` back off `Paid` (nor could an app-level UPDATE do
  // that directly: the immutability trigger in 0004 rejects any `Paid` → other
  // status transition that isn't Voided/Refunded). So a transaction can
  // legitimately be `status = 'Paid'` with a reopened positive outstanding
  // right now: that's exactly the reissue this helper exists to admit. A
  // genuinely-settled Paid transaction always has outstandingCents <= 0, so
  // this still rejects the real double-tap case with the same code.
  if (txn.status === 'Paid' && outstandingCents <= 0) {
    throw new LifecycleError('Transaction is already fully paid', 'ALREADY_PAID', 422)
  }

  if (toCents(args.amount) > outstandingCents) {
    throw new LifecycleError(
      `Payment of ${args.amount} exceeds the outstanding balance of ${fromCents(outstandingCents)}`,
      'OVERPAYMENT_NOT_ALLOWED',
      422,
    )
  }

  if (args.referenceNumber) {
    const [dup] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.transactionId, args.transactionId),
          eq(payments.tenantId, args.tenantId),
          eq(payments.method, args.method),
          eq(payments.referenceNumber, args.referenceNumber),
          // Match the partial unique index (payments_tenant_txn_method_ref_uniq
          // excludes voided rows): a voided payment must not block reusing its
          // own (method, reference) on the replacement a method correction
          // inserts.
          isNull(payments.voidedAt),
        ),
      )
      .limit(1)
    if (dup) {
      throw new LifecycleError(
        'A payment with this method and reference number already exists',
        'DUPLICATE_REFERENCE',
      )
    }
  }

  // CASH-1: link the payment to the cashier's currently-open drawer session so
  // drawer-close reconciliation can sum cash by session_id (the single source of
  // truth). Resolve the open session for this (tenant, user, branch); null when
  // no drawer is open (e.g. back-office payment) — the close query simply won't
  // count it. Only meaningful for Cash, but harmless to record for any method.
  // Credit draws carry no cash, so never link them to a drawer session.
  let cashDrawerSessionId: number | null = null
  if (args.branchId !== null && args.method !== 'Credit') {
    const [openSession] = await tx
      .select({ id: cashDrawerSessions.id })
      .from(cashDrawerSessions)
      .where(
        and(
          eq(cashDrawerSessions.tenantId, args.tenantId),
          // Branch-day scoped (shared drawer) — link to the branch's open
          // session whoever opened it, so reconciliation sums all cash there.
          eq(cashDrawerSessions.branchId, args.branchId),
          eq(cashDrawerSessions.state, 'Open'),
        ),
      )
      .orderBy(asc(cashDrawerSessions.openedAt))
      .limit(1)
    cashDrawerSessionId = openSession?.id ?? null
  }

  // CONC-5: catch a concurrent duplicate that races past the pre-check above.
  // Migration 0028 added a partial unique index:
  //   payments(tenant_id, transaction_id, method, reference_number) WHERE reference_number IS NOT NULL
  // so a double-submit that slips through the optimistic guard above will hit 23505
  // instead of silently inserting a second row. Translate to DUPLICATE_REFERENCE.
  let inserted: typeof payments.$inferSelect | undefined
  try {
    ;[inserted] = await tx
      .insert(payments)
      .values({
        displayId: displayId('PMT'),
        tenantId: args.tenantId,
        transactionId: args.transactionId,
        cashDrawerSessionId,
        fundedByTransactionId: args.fundedByTransactionId ?? null,
        method: args.method,
        amount: args.amount,
        payerId: args.payerId ?? null,
        referenceNumber: args.referenceNumber ?? null,
        // Cash / Credit → Cleared immediately; other methods → AwaitingReconciliation
        // so they can be confirmed by the payment processor webhook.
        reconciliationStatus: initialReconciliationStatus(args.method),
        // Default to the caller; a payment-method correction passes the
        // original row's values through so collection stays attributed to
        // whoever actually received the money. See InternalAddPaymentArgs.
        receivedById: args.receivedById ?? args.userId,
        receivedAt: args.receivedAt ?? new Date(),
        notes: args.notes ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
        createdById: args.userId,
      })
      .returning()
  } catch (insertErr: unknown) {
    const pgCode = (insertErr as { code?: string }).code
    if (pgCode === '23505') {
      throw new LifecycleError(
        'A payment with this method and reference number already exists',
        'DUPLICATE_REFERENCE',
      )
    }
    throw insertErr
  }

  // Recompute sum of payments and decide status. Voided rows excluded, see
  // the priorSumRow comment above.
  const [sumRow] = await tx
    .select({
      total: sql<string>`COALESCE(SUM(CAST(${payments.amount} AS numeric)), 0)`,
    })
    .from(payments)
    .where(
      and(
        eq(payments.transactionId, args.transactionId),
        eq(payments.tenantId, args.tenantId),
        isNull(payments.voidedAt),
      ),
    )
  const totalCents = toCents(sumRow?.total ?? '0')
  const netCents = toCents(txn.netAmount)

  let nextStatus: 'Draft' | 'Pending' | 'Paid' | null = null
  if (totalCents >= netCents) nextStatus = 'Paid'
  else if (totalCents > 0 && txn.status === 'Draft') nextStatus = 'Pending'

  // BIR receipt number allocation (handover §7 option 1):
  // When this payment pushes status to Paid AND the txn does not yet have a
  // receipt_no, allocate one from tenant_counters with counter_kind='BIR_RECEIPT'
  // (tenant-wide, branchId=null per the comment in 0012_tenant_counters.sql).
  // Format: 8-digit zero-padded counter value. BIR registration may revise the
  // format (`YYYY-NNNNNNNN`, OR-series prefix, etc.); the column type stays
  // text so a future migration can rewrite without schema change.
  const updates: Partial<typeof transactions.$inferInsert> = {}
  if (nextStatus && nextStatus !== txn.status) {
    updates.status = nextStatus
    updates.updatedAt = new Date()
  }

  let receiptNoForResponse: string | null = txn.receiptNo
  // Only on the actual TRANSITION into Paid. `txn.status !== 'Paid'` used to be
  // implied by the ALREADY_PAID guard rejecting every Paid transaction before
  // reaching here; now that a payment-method correction legitimately re-enters
  // this function on an already-Paid row, the guard has to be explicit.
  //
  // Without it, correcting a payment on a Paid transaction whose receipt_no is
  // NULL (seeded and legacy rows are like this: BIR allocation only started at
  // the Paid transition) tries to write receipt_no onto an immutable row, and
  // the 0004 trigger rejects the whole correction with a bare 500:
  //   "Paid transactions are immutable (status Paid); use void/refund flow"
  // A reissue is not a new Paid transition, so it must not mint a receipt.
  if (nextStatus === 'Paid' && txn.status !== 'Paid' && !txn.receiptNo) {
    const seq = await allocateCounter(tx, {
      tenantId: args.tenantId,
      branchId: null,
      counterKind: 'BIR_RECEIPT',
    })
    const allocatedReceiptNo = String(seq).padStart(8, '0')
    updates.receiptNo = allocatedReceiptNo
    receiptNoForResponse = allocatedReceiptNo
  }

  if (Object.keys(updates).length > 0) {
    await tx
      .update(transactions)
      .set(updates)
      .where(and(eq(transactions.id, args.transactionId), eq(transactions.tenantId, args.tenantId)))
  }

  return {
    payment: inserted!,
    status: nextStatus ?? txn.status,
    receiptNo: receiptNoForResponse,
  }
}

export type AddPaymentArgs = TenantCtx &
  MoneyAttestationFields & {
    /** Transaction display_id (TXN_…). */
    transactionDisplayId: string
    method: PaymentMethod
    amount: string
    referenceNumber?: string | null
    /** Payer display_id (PYR_…). */
    payerDisplayId?: string | null
    notes?: string | null
    idempotencyKey?: string
  }

export type AddPaymentResult = {
  /** payment display_id (PMT_…). */
  id: string
  status: 'Draft' | 'Pending' | 'Paid'
  receiptNo: string | null
}

export type AddPaymentsArgs = TenantCtx &
  MoneyAttestationFields & {
    transactionDisplayId: string
    payments: ReadonlyArray<{
      method: PaymentMethod
      amount: string
      referenceNumber?: string | null
      payerDisplayId?: string | null
      notes?: string | null
    }>
  }

export type AddPaymentsResult = AddPaymentResult & {
  payments: Array<{
    id: string
    amount: string
    status: 'Draft' | 'Pending' | 'Paid'
  }>
}

/**
 * Insert a payment row, then transition the parent transaction's status:
 *   sum(payments) >= netAmount → Paid
 *   0 < sum(payments) < net    → Pending (only if currently Draft)
 * Idempotency: a duplicate (txn, method, referenceNumber) is rejected.
 */
export async function addPayment(args: AddPaymentArgs): Promise<AddPaymentResult> {
  // Resolve BEFORE the tx opens: see resolveReceivedById's doc comment.
  const receivedById = await resolveReceivedById(args.tenantId, args.branchId, args.userId, args)

  return withTenantTx(args, async (tx) => {
    const txnId = await resolveTransactionId(tx, args.tenantId, args.transactionDisplayId)
    if (txnId === null) throw new LifecycleError('Transaction not found', 'NOT_FOUND', 404)

    const [groupBill] = await tx
      .select({ payerId: groupBills.payerId })
      .from(groupBills)
      .where(and(eq(groupBills.tenantId, args.tenantId), eq(groupBills.transactionId, txnId)))
      .limit(1)

    let payerId: number | null = groupBill?.payerId ?? null
    if (args.payerDisplayId) {
      const requestedPayerId = await resolvePayerId(tx, args.tenantId, args.payerDisplayId)
      if (requestedPayerId === null) {
        throw new LifecycleError('Payer not found', 'PAYER_NOT_FOUND', 404)
      }
      if (groupBill && requestedPayerId !== groupBill.payerId) {
        throw new LifecycleError(
          'A group-bill payment must use its corporate payer',
          'GROUP_PAYER_MISMATCH',
          422,
        )
      }
      payerId = requestedPayerId
    }

    const result = await addPaymentTx(tx, {
      tenantId: args.tenantId,
      userId: args.userId,
      branchId: args.branchId,
      transactionId: txnId,
      method: args.method,
      amount: args.amount,
      referenceNumber: args.referenceNumber ?? null,
      payerId,
      notes: args.notes ?? null,
      idempotencyKey: args.idempotencyKey,
      receivedById,
    })
    return {
      id: result.payment.displayId,
      status: result.status,
      receiptNo: result.receiptNo,
    }
  })
}

/**
 * Atomically apply a split tender to one existing transaction. Every payer and
 * the shared-session attestation are validated before the first payment write;
 * applyPaymentLegsTx then walks the legs in one DB transaction, so a cap or
 * duplicate-reference failure on a later leg rolls the entire batch back.
 */
export async function addPayments(args: AddPaymentsArgs): Promise<AddPaymentsResult> {
  if (args.payments.length < 2) {
    throw new LifecycleError(
      'At least two payment legs are required for split tender',
      'SPLIT_TENDER_REQUIRED',
      422,
    )
  }

  const receivedById = await resolveReceivedById(args.tenantId, args.branchId, args.userId, args)

  return withTenantTx(args, async (tx) => {
    const txnId = await resolveTransactionId(tx, args.tenantId, args.transactionDisplayId)
    if (txnId === null) throw new LifecycleError('Transaction not found', 'NOT_FOUND', 404)

    const [transaction] = await tx
      .select({ status: transactions.status })
      .from(transactions)
      .where(and(eq(transactions.tenantId, args.tenantId), eq(transactions.id, txnId)))
      .limit(1)
    if (!transaction || transaction.status === 'Voided' || transaction.status === 'Refunded') {
      throw new LifecycleError('Transaction cannot accept payments', 'INVALID_STATE', 422)
    }

    const [groupBill] = await tx
      .select({ payerId: groupBills.payerId })
      .from(groupBills)
      .where(and(eq(groupBills.tenantId, args.tenantId), eq(groupBills.transactionId, txnId)))
      .limit(1)

    const legs: PaymentLegInput[] = []
    for (const payment of args.payments) {
      let payerId: number | null = groupBill?.payerId ?? null
      if (payment.payerDisplayId) {
        const requestedPayerId = await resolvePayerId(tx, args.tenantId, payment.payerDisplayId)
        if (requestedPayerId === null) {
          throw new LifecycleError('Payer not found', 'PAYER_NOT_FOUND', 404)
        }
        if (groupBill && requestedPayerId !== groupBill.payerId) {
          throw new LifecycleError(
            'A group-bill payment must use its corporate payer',
            'GROUP_PAYER_MISMATCH',
            422,
          )
        }
        payerId = requestedPayerId
      }
      legs.push({
        method: payment.method,
        amount: payment.amount,
        referenceNumber: payment.referenceNumber ?? null,
        resolvedPayerId: payerId,
        notes: payment.notes ?? null,
      })
    }

    const result = await applyPaymentLegsTx(tx, {
      tenantId: args.tenantId,
      userId: args.userId,
      branchId: args.branchId,
      transactionId: txnId,
      initialStatus: transaction.status,
      legs,
      receivedById,
    })
    return {
      id: result.paymentDisplayId!,
      status: result.status,
      receiptNo: result.receiptNo,
      payments: result.legs.map((leg) => ({
        id: leg.paymentDisplayId,
        amount: leg.amount,
        status: leg.status,
      })),
    }
  })
}

// ── Money-control approval gate (void / refund) ─────────────────────────────
//
// Invariant (docs/ai-context/06-PRODUCT-WORKFLOWS.md:262): "Void/refund over
// PHP 1,000 requires manager approval. Refund over PHP 5,000 requires admin
// approval." Thresholds in integer cents, compared with strict ">" (exactly
// PHP 1,000.00 proceeds without a gate).
//
// Payment-method correction (`correctPaymentMethod`) does NOT go through this
// gate (removed 2026-08-02, was the `payment_correction` operation). The
// owner's standing decision (2026-07-06) is that record corrections are
// inline + warned + logged, NOT an approval queue: `approval_requests` is
// reserved for the void/refund money thresholds below. The gate also routed
// a correction to a `BranchAdmin` approver role no real user holds on the
// shared login, making it an unresolvable dead end. A correction is now
// PIN-attested (who is performing it) and flagged when it touches a closed
// accounting period (see `correctPaymentMethod`'s audit metadata) instead of
// being blocked.
const MANAGER_APPROVAL_THRESHOLD_CENTS = 100_000 // PHP 1,000.00
const ADMIN_APPROVAL_THRESHOLD_CENTS = 500_000 // PHP 5,000.00

type MoneyApprovalOperation = 'void' | 'refund'

/**
 * Money-control gate for void/refund. Throws LifecycleError('APPROVAL_REQUIRED', 403)
 * and refuses the caller when the compared amount is over the applicable
 * threshold and no consumable approval exists yet. Returns silently (no DB
 * writes) when the amount is at or under every applicable threshold.
 *
 * Which amount is compared, and why:
 *  - void: `amountPaidCents`, the cash ALREADY COLLECTED against the bill
 *    being cancelled, not net_amount. A Draft/Pending bill that never
 *    collected anything has no cash exposure, so a partially-paid PHP 6,000
 *    bill with only PHP 500 collected voids freely (PHP 500 is under PHP
 *    1,000). A bill that later becomes fully paid can only be voided if it
 *    somehow has zero payments (voidTransaction already refuses a Paid
 *    transaction with positive payments, sending it through refund
 *    instead), so the refund gate below takes over on the full amount.
 *  - refund: the refund amount itself (today always the full sum of the
 *    transaction's positive payments, since refundTransaction has no partial
 *    refund support yet), because that is money leaving the clinic right now.
 *
 * Idempotency: a second call while a Pending request already exists for this
 * exact (tenant, transaction, operation) returns that SAME request instead of
 * inserting a duplicate. This check-then-insert shape mirrors
 * fanOutRecallNotifications (modules/product_recalls/db.ts), which keys its
 * own idempotency off a metadata field for the identical reason: no unique
 * index expresses this compound key without a migration.
 *
 * Single-use: an Approved request is consumed via an atomic UPDATE (soft
 * delete, `deletedAt`) in the SAME db transaction as the caller's own
 * void/refund UPDATE, so one approval cannot authorize a second void/refund.
 * `entity_type` encodes the operation ('transaction_void' / 'transaction_refund')
 * alongside `entity_id` (the transaction's display_id), so an approval filed
 * for a void can never be consumed by a refund attempt on the same
 * transaction, or vice versa.
 *
 * `request_type` stays 'void_transaction' for both operations: it is the
 * only `approval_request_type` enum member that fits this control, and
 * there is no separate 'refund_transaction' value. Adding one would be a
 * schema migration, which is out of scope for this change.
 *
 * Runs in its OWN `withTenantTx` (a separate db.transaction from the
 * caller's), not the caller's `tx`. This is deliberate: the caller throws
 * this function's LifecycleError to roll back its own void/refund
 * transaction, but the Pending row filed here (or the Approved row consumed
 * here) must survive that rollback, otherwise the "a request has been
 * filed" side effect vanishes along with it, the idempotency check below
 * never finds it, and every retry mints a fresh duplicate request. Filing
 * (or consuming) the approval and refusing the operation are two separate
 * outcomes that cannot share one all-or-nothing transaction.
 */
async function enforceMoneyApprovalGate(args: {
  tenantId: string
  branchId: number
  userId: number
  txnDisplayId: string
  operation: MoneyApprovalOperation
  amountCents: number
}): Promise<void> {
  const { tenantId, branchId, userId, txnDisplayId, operation, amountCents } = args

  let approverRole: 'BranchAdmin' | 'TenantAdmin' | null = null
  let tier: 'manager' | 'admin' = 'manager'
  if (operation === 'refund' && amountCents > ADMIN_APPROVAL_THRESHOLD_CENTS) {
    approverRole = 'TenantAdmin'
    tier = 'admin'
  } else if (amountCents > MANAGER_APPROVAL_THRESHOLD_CENTS) {
    approverRole = 'BranchAdmin'
    tier = 'manager'
  }
  if (approverRole === null) return

  const entityType = operation === 'void' ? 'transaction_void' : 'transaction_refund'
  const operationLabel = operation === 'void' ? 'void' : 'refund'
  const approverLabel =
    tier === 'admin' ? 'an admin (TenantAdmin)' : 'a manager (BranchAdmin or TenantAdmin)'
  const thresholdCents =
    tier === 'admin' ? ADMIN_APPROVAL_THRESHOLD_CENTS : MANAGER_APPROVAL_THRESHOLD_CENTS

  type GateOutcome = { proceed: true } | { proceed: false; filedDisplayId: string }

  const outcome: GateOutcome = await withTenantTx(
    { tenantId, userId, branchId },
    async (tx): Promise<GateOutcome> => {
      // Single-use consume: an Approved-and-unconsumed request for this
      // exact transaction + operation wins the race atomically. If this
      // UPDATE affects a row, the void/refund is authorized to proceed.
      const [consumed] = await tx
        .update(approvalRequests)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(approvalRequests.tenantId, tenantId),
            eq(approvalRequests.entityType, entityType),
            eq(approvalRequests.entityId, txnDisplayId),
            eq(approvalRequests.requestType, 'void_transaction'),
            eq(approvalRequests.status, 'Approved'),
            isNull(approvalRequests.deletedAt),
          ),
        )
        .returning({ id: approvalRequests.id })
      if (consumed) return { proceed: true }

      // No usable approval. Idempotency: reuse an existing Pending request
      // for this exact transaction + operation instead of inserting a
      // duplicate.
      const [pending] = await tx
        .select({ displayId: approvalRequests.displayId })
        .from(approvalRequests)
        .where(
          and(
            eq(approvalRequests.tenantId, tenantId),
            eq(approvalRequests.entityType, entityType),
            eq(approvalRequests.entityId, txnDisplayId),
            eq(approvalRequests.requestType, 'void_transaction'),
            eq(approvalRequests.status, 'Pending'),
            isNull(approvalRequests.deletedAt),
          ),
        )
        .limit(1)
      if (pending) return { proceed: false, filedDisplayId: pending.displayId }

      const [created] = await tx
        .insert(approvalRequests)
        .values({
          displayId: displayId('APR'),
          tenantId,
          branchId,
          // requestType stays 'void_transaction' for both operations: it is
          // the only `approval_request_type` enum member that fits this
          // control (no 'refund_transaction' value exists, and adding one is
          // a schema migration out of scope for this change). `entityType`
          // (above) is what actually discriminates void vs refund for
          // consumption.
          requestType: 'void_transaction',
          description: `A ${operationLabel} of ${fromCents(amountCents)} on transaction ${txnDisplayId} requires ${approverLabel} approval.`,
          details: `Amount compared: ${
            operation === 'void' ? 'amount already collected (amount_paid)' : 'refund amount'
          }. Threshold: PHP ${fromCents(thresholdCents)}.`,
          status: 'Pending',
          entityType,
          entityId: txnDisplayId,
          requestedById: userId,
          requiredApprovers: 1,
          approverRole,
        })
        .returning({ displayId: approvalRequests.displayId })
      if (!created) {
        throw new LifecycleError('Failed to file approval request', 'APPROVAL_REQUEST_FAILED', 500)
      }
      return { proceed: false, filedDisplayId: created.displayId }
    },
  )

  if (outcome.proceed) return

  throw new LifecycleError(
    `This ${operationLabel} needs ${approverLabel} approval before it can proceed (over PHP ${fromCents(thresholdCents)}). A request has been filed (${outcome.filedDisplayId}); ask ${tier === 'admin' ? 'a TenantAdmin' : 'a BranchAdmin or TenantAdmin'} to approve it under Admin, Approvals.`,
    'APPROVAL_REQUIRED',
    403,
    { approvalRequestId: outcome.filedDisplayId, approverRole, requiredTier: tier },
  )
}

export type VoidArgs = TenantCtx & {
  /** Transaction display_id (TXN_…). */
  transactionDisplayId: string
  reason: string
  /** Required for group-bill lifecycle changes; ordinary transactions keep their existing rules. */
  callerRole?: string
}

const GROUP_BILL_LIFECYCLE_ROLES = new Set(['TenantAdmin', 'BranchAdmin'])

/**
 * Group bills move the receivable away from the compatibility header patient.
 * Their whole-bill void/refund/payment-correction boundary must therefore hold
 * even when a caller enters through the generic transaction API.
 */
async function assertGroupBillLifecycleRole(
  tx: Tx,
  tenantId: string,
  transactionId: number,
  callerRole?: string,
): Promise<void> {
  const [groupBill] = await tx
    .select({ id: groupBills.id })
    .from(groupBills)
    .where(and(eq(groupBills.tenantId, tenantId), eq(groupBills.transactionId, transactionId)))
    .limit(1)

  if (groupBill && (!callerRole || !GROUP_BILL_LIFECYCLE_ROLES.has(callerRole))) {
    throw new LifecycleError(
      'Only branch or tenant admins may reverse or correct a group bill',
      'GROUP_BILL_ADMIN_REQUIRED',
      403,
    )
  }
}

export async function voidTransaction(args: VoidArgs) {
  return withTenantTx(args, async (tx) => {
    const txnId = await resolveTransactionId(tx, args.tenantId, args.transactionDisplayId)
    if (txnId === null) throw new LifecycleError('Transaction not found', 'NOT_FOUND', 404)

    await assertGroupBillLifecycleRole(tx, args.tenantId, txnId, args.callerRole)

    const [txn] = await tx
      .select({
        id: transactions.id,
        status: transactions.status,
        branchId: transactions.branchId,
        amountPaid: transactions.amountPaid,
      })
      .from(transactions)
      .where(and(eq(transactions.id, txnId), eq(transactions.tenantId, args.tenantId)))
      .limit(1)
    if (!txn) throw new LifecycleError('Transaction not found', 'NOT_FOUND', 404)
    if (txn.status === 'Voided' || txn.status === 'Refunded') {
      throw new LifecycleError(`Already ${txn.status}`, 'INVALID_STATE')
    }
    if (txn.status === 'Paid') {
      const [pay] = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            eq(payments.transactionId, txnId),
            eq(payments.tenantId, args.tenantId),
            // A superseded row from a method correction is not collected money:
            // it no longer counts toward amount_paid, so it must not be what
            // decides that a refund is required first. Matches every other
            // payment predicate in this file.
            isNull(payments.voidedAt),
          ),
        )
        .limit(1)
      if (pay) {
        throw new LifecycleError(
          'Refund required before voiding a paid transaction',
          'REFUND_REQUIRED',
        )
      }
    }

    // Unwind bundle fan-out BEFORE the money-control gate below: if a
    // fanned-out clinical/lab order was already actioned, this throws
    // CLINICAL_WORK_COMPLETED and nothing is mutated: refusing here must
    // not first file or consume a manager-approval request for a void that
    // can never proceed. See fanOutVoid.ts for why voiding must own the
    // work its own transaction created (fanOutBundle deducts stock and
    // opens clinical/lab orders at BILL time, not at administer time, and
    // has no duplicate guard of its own).
    const unwind = await unwindFanOutForVoid(tx, {
      tenantId: args.tenantId,
      userId: args.userId,
      transactionId: txnId,
      transactionDisplayId: args.transactionDisplayId,
    })

    // Money-control gate: void of more than PHP 1,000 already collected
    // requires manager approval. See enforceMoneyApprovalGate for why
    // amount_paid (not net_amount) is the amount compared.
    await enforceMoneyApprovalGate({
      tenantId: args.tenantId,
      branchId: txn.branchId,
      userId: args.userId,
      txnDisplayId: args.transactionDisplayId,
      operation: 'void',
      amountCents: toCents(txn.amountPaid),
    })

    const [updated] = await tx
      .update(transactions)
      .set({
        status: 'Voided',
        voidedAt: new Date(),
        voidedById: args.userId,
        voidReason: args.reason,
        updatedAt: new Date(),
      })
      .where(and(eq(transactions.id, txnId), eq(transactions.tenantId, args.tenantId)))
      .returning({ displayId: transactions.displayId, status: transactions.status })
    if (!updated) throw new LifecycleError('Transaction not found', 'NOT_FOUND', 404)

    // Traceability: record what the void unwound, in addition to the
    // per-row CRUD audit the trigger already writes for the cancelled
    // clinical_orders/lab_orders/inventory_movements rows themselves.
    if (unwind.cancelledClinicalOrderIds.length > 0 || unwind.cancelledLabOrderIds.length > 0) {
      await auditLog(tx, {
        tenantId: args.tenantId,
        userId: args.userId,
        branchId: txn.branchId,
        action: 'TRANSACTION_MODIFY',
        entityType: 'transactions',
        entityId: args.transactionDisplayId,
        metadata: {
          reason: 'void_fanout_unwind',
          cancelledClinicalOrderIds: unwind.cancelledClinicalOrderIds,
          cancelledLabOrderIds: unwind.cancelledLabOrderIds,
          reversedMovementCount: unwind.reversedMovementCount,
        },
      })
    }

    return {
      displayId: updated.displayId,
      status: updated.status,
      cancelledClinicalOrderIds: unwind.cancelledClinicalOrderIds,
      cancelledLabOrderIds: unwind.cancelledLabOrderIds,
    }
  })
}

export type RefundArgs = TenantCtx & {
  /** Transaction display_id (TXN_…). */
  transactionDisplayId: string
  reason: string
  callerRole?: string
}

export async function refundTransaction(args: RefundArgs) {
  return withTenantTx(args, async (tx) => {
    const txnId = await resolveTransactionId(tx, args.tenantId, args.transactionDisplayId)
    if (txnId === null) throw new LifecycleError('Transaction not found', 'NOT_FOUND', 404)

    await assertGroupBillLifecycleRole(tx, args.tenantId, txnId, args.callerRole)

    const [txn] = await tx
      .select({ id: transactions.id, status: transactions.status, branchId: transactions.branchId })
      .from(transactions)
      .where(and(eq(transactions.id, txnId), eq(transactions.tenantId, args.tenantId)))
      .limit(1)
    if (!txn) throw new LifecycleError('Transaction not found', 'NOT_FOUND', 404)
    if (txn.status !== 'Paid') {
      throw new LifecycleError('Only Paid transactions can be refunded', 'INVALID_STATE')
    }

    const existing = await tx
      .select({ amount: payments.amount })
      .from(payments)
      .where(
        and(
          eq(payments.transactionId, txnId),
          eq(payments.tenantId, args.tenantId),
          // A voided-and-replaced payment must not be refunded twice: only the
          // live replacement counts toward the refund amount.
          isNull(payments.voidedAt),
        ),
      )

    const totalCents = toCents(sumMoney(existing.map((p) => p.amount)))
    if (totalCents <= 0) {
      throw new LifecycleError('Nothing to refund (no positive payments)', 'INVALID_STATE')
    }

    // Money-control gate: refund of more than PHP 1,000 requires manager
    // approval; more than PHP 5,000 requires admin approval. Gated on the
    // refund amount itself (currently always the full sum of the transaction's
    // positive payments), since that is money leaving the clinic right now.
    await enforceMoneyApprovalGate({
      tenantId: args.tenantId,
      branchId: txn.branchId,
      userId: args.userId,
      txnDisplayId: args.transactionDisplayId,
      operation: 'refund',
      amountCents: totalCents,
    })

    // We record the refund intent on the transaction itself — the `payments`
    // CHECK (amount > 0) means a refund can't be modelled as a negative row.
    //
    // MONEY-2: we deliberately do NOT mutate `amount_paid` here. It's an
    // invariant derived from the payment rows by the `sync_transaction_amounts`
    // trigger (amount_paid = SUM(payments.amount)); overwriting it in app code
    // would desync it from the still-present positive payment rows and be
    // reverted on the next payment change. Instead, cash reconciliation is
    // corrected at the aggregate layer: the drawer-close sums (cash_drawer/db.ts
    // + staff_time_logs/db.ts) and AR aggregates exclude Voided/Refunded
    // parents, so a refunded sale's cash drops out of expected drawer cash —
    // matching the physical cash returned. A negative/offsetting movement would
    // require either dropping the payments CHECK or a dedicated refunds ledger
    // (tracked as future work).
    const [updated] = await tx
      .update(transactions)
      .set({
        status: 'Refunded',
        voidedAt: new Date(),
        voidedById: args.userId,
        voidReason: args.reason,
        updatedAt: new Date(),
      })
      .where(and(eq(transactions.id, txnId), eq(transactions.tenantId, args.tenantId)))
      .returning({ displayId: transactions.displayId, status: transactions.status })
    if (!updated) throw new LifecycleError('Transaction not found', 'NOT_FOUND', 404)
    return { transaction: updated, refundedAmount: fromCents(totalCents) }
  })
}

// ── Lifecycle: correctPaymentMethod (void-and-reissue a posted payment) ─────

export type CorrectPaymentMethodArgs = TenantCtx &
  MoneyAttestationFields & {
    /** Transaction display_id (TXN_…). */
    transactionDisplayId: string
    /** Payment display_id (PMT_…), the row being corrected. */
    paymentDisplayId: string
    newMethod: PaymentMethod
    newReferenceNumber?: string | null
    reason: string
  }

export type CorrectPaymentMethodResult = {
  /** Transaction display_id (TXN_…). */
  transactionDisplayId: string
  /** display_id of the original payment, now voided. */
  voidedPaymentId: string
  /** display_id of the newly-inserted replacement payment. */
  replacementPaymentId: string
  status: 'Draft' | 'Pending' | 'Paid'
  receiptNo: string | null
}

/**
 * Correct a posted payment's method (and/or reference number) by voiding the
 * original row and inserting a replacement, never an in-place UPDATE of
 * `method`. A payment is already bound to a cash-drawer session and already
 * consumed by the byMethod/cashSplit aggregates, so mutating it in place
 * would retroactively falsify a closed drawer count; void-and-reissue keeps
 * every historical aggregate correct as-computed while landing the corrected
 * row in TODAY's drawer.
 *
 * Not usable on a `Credit` payment (a draw against a patient deposit,
 * correcting it would desync the deposit's derived remaining balance) nor to
 * assign `Credit` as the new method (internal-only, minted solely by
 * `applyPrepayment`).
 */
export async function correctPaymentMethod(
  args: CorrectPaymentMethodArgs,
): Promise<CorrectPaymentMethodResult> {
  // Resolve BEFORE the tx opens: see resolveReceivedById's doc comment. Note
  // this attestation is NOT written to `payments.received_by_id`: the
  // replacement payment below deliberately keeps carrying the ORIGINAL
  // payment's receiver (only the method was mis-recorded). This resolves who
  // is PERFORMING the correction, for the audit row only.
  const correctorUserId = await resolveReceivedById(args.tenantId, args.branchId, args.userId, args)
  const correctorDisplayId =
    args.attestedById ?? (args.moneyCaller.kind === 'http' ? args.moneyCaller.displayId : null)

  return withTenantTx(args, async (tx) => {
    const txnId = await resolveTransactionId(tx, args.tenantId, args.transactionDisplayId)
    if (txnId === null) throw new LifecycleError('Transaction not found', 'NOT_FOUND', 404)

    await assertGroupBillLifecycleRole(
      tx,
      args.tenantId,
      txnId,
      args.moneyCaller.kind === 'http' ? args.moneyCaller.role : undefined,
    )

    // Lock the header for the whole correction: void-then-reissue is a
    // read-then-write on the payments ledger, same reason addPaymentTx locks
    // it for its own MONEY-5 check.
    const [txn] = await tx
      .select({
        id: transactions.id,
        status: transactions.status,
        branchId: transactions.branchId,
      })
      .from(transactions)
      .where(and(eq(transactions.id, txnId), eq(transactions.tenantId, args.tenantId)))
      .limit(1)
      .for('update')
    if (!txn) throw new LifecycleError('Transaction not found', 'NOT_FOUND', 404)
    if (txn.status === 'Voided' || txn.status === 'Refunded') {
      throw new LifecycleError(
        `Cannot correct a payment on a ${txn.status} transaction`,
        'INVALID_STATE',
      )
    }

    const [payment] = await tx
      .select({
        id: payments.id,
        displayId: payments.displayId,
        method: payments.method,
        amount: payments.amount,
        payerId: payments.payerId,
        referenceNumber: payments.referenceNumber,
        voidedAt: payments.voidedAt,
        receivedById: payments.receivedById,
        receivedAt: payments.receivedAt,
        cashDrawerSessionId: payments.cashDrawerSessionId,
      })
      .from(payments)
      .where(
        and(
          eq(payments.tenantId, args.tenantId),
          eq(payments.transactionId, txnId),
          eq(payments.displayId, args.paymentDisplayId),
        ),
      )
      .limit(1)
    if (!payment) throw new LifecycleError('Payment not found', 'NOT_FOUND', 404)

    if (payment.voidedAt) {
      throw new LifecycleError('Payment is already voided', 'ALREADY_VOIDED')
    }
    if (payment.receivedById === null) {
      throw new LifecycleError(
        'The original payment has no receiver attribution. Repair that audit field before correcting its method.',
        'PAYMENT_RECEIVER_UNKNOWN',
        409,
      )
    }

    // 'Credit' is internal-only, minted solely by applyPrepayment; a client
    // must never mint one. paymentMethodSchema already excludes it from the
    // request body at the Zod layer: this is defense-in-depth for any other
    // internal caller of this function.
    if (args.newMethod === 'Credit') {
      throw new LifecycleError(
        "'Credit' cannot be assigned by a payment-method correction",
        'CREDIT_NOT_CORRECTABLE',
      )
    }
    // The EXISTING payment being 'Credit' is refused too: that row is a draw
    // against a deposit (funded_by_transaction_id), and getPatientCredit /
    // creditSourcesForPatient / applyPrepayment's drawnRow all derive the
    // deposit's remaining balance by summing live (non-voided) Credit draws
    // against it. Voiding-and-replacing a draw here (outside applyPrepayment)
    // would desync that derivation. Correcting a credit draw is out of scope.
    if (payment.method === 'Credit') {
      throw new LifecycleError(
        'A Credit payment (patient-deposit draw) cannot be corrected here',
        'CREDIT_NOT_CORRECTABLE',
      )
    }

    const newReferenceNumber = args.newReferenceNumber ?? null
    const oldReferenceNumber = payment.referenceNumber ?? null
    if (payment.method === args.newMethod && oldReferenceNumber === newReferenceNumber) {
      throw new LifecycleError(
        'Nothing to correct: method and reference number are unchanged',
        'NO_CHANGE',
        422,
      )
    }

    // No approval gate here (removed 2026-08-02): a method correction is
    // inline + warned + logged, never queued for approval. See the doc
    // comment on `enforceMoneyApprovalGate` and the "Sensitive Corrections
    // Logged Not Queued" convention. What replaces the gate is (a) PIN
    // attestation naming who is performing the correction, resolved above
    // into `correctorUserId` / `correctorDisplayId`, and (b) the
    // `touchesClosedPeriod` flag below, both recorded on the audit row.

    // Prior-period flag: true when the ORIGINAL payment's drawer session is
    // not (still) Open, including when it never had one. This is what an
    // exception report keys on: a correction inside the open drawer is
    // routine, one after the drawer closed changes a figure someone already
    // signed off on. Recorded for reporting only, never blocks the
    // correction (the owner's standing decision, 2026-07-06: record
    // corrections are inline + warned + logged, not an approval queue).
    let originalSessionState: 'Open' | 'Closed' | 'Reconciled' | 'Discrepancy' | null = null
    if (payment.cashDrawerSessionId != null) {
      const [session] = await tx
        .select({ state: cashDrawerSessions.state })
        .from(cashDrawerSessions)
        .where(
          and(
            eq(cashDrawerSessions.id, payment.cashDrawerSessionId),
            eq(cashDrawerSessions.tenantId, args.tenantId),
          ),
        )
        .limit(1)
      originalSessionState = session?.state ?? null
    }
    const touchesClosedPeriod = originalSessionState !== 'Open'

    // Void the original row. No immutability trigger guards `payments` (only
    // `transactions` / `clinical_orders` do: see 0004_immutability_and_generated.sql),
    // so this UPDATE is permitted; the generic CRUD audit trigger records it
    // automatically. `sync_transaction_amounts` recomputes `amount_paid`
    // excluding voided rows as soon as this commits, reopening
    // `amount_outstanding` (GENERATED) by exactly this payment's amount.
    await tx
      .update(payments)
      .set({
        voidedAt: new Date(),
        voidedById: args.userId,
        voidReason: args.reason,
        updatedAt: new Date(),
      })
      .where(and(eq(payments.id, payment.id), eq(payments.tenantId, args.tenantId)))

    // Insert the replacement via addPaymentTx, deliberate reuse: it inherits
    // the MONEY-5 cap (now admitting this reissue because the outstanding
    // just reopened, see addPaymentTx's ALREADY_PAID comment), the
    // Pending → Paid transition, and initialReconciliationStatus(newMethod).
    // It also re-resolves the CORRECTING user's currently-open drawer session
    // for this branch internally (never the original payment's
    // cash_drawer_session_id, addPaymentTx never even takes one as an
    // argument), so the corrected row always lands in TODAY's drawer, never
    // retroactively in a closed and reconciled one. `receipt_no` is already
    // allocated on this transaction (it was Paid, or partially paid) and
    // addPaymentTx only mints a receipt when `txn.receiptNo` is NULL, so the
    // original BIR receipt survives this reissue untouched.
    const replacement = await addPaymentTx(tx, {
      tenantId: args.tenantId,
      userId: args.userId,
      branchId: txn.branchId,
      transactionId: txnId,
      method: args.newMethod,
      amount: payment.amount,
      referenceNumber: newReferenceNumber,
      payerId: payment.payerId,
      notes: `Payment method correction (was ${payment.method}). Reason: ${args.reason}`,
      // Carry the ORIGINAL receipt attribution onto the replacement. Only the
      // method was mis-recorded: the money still arrived when it arrived, from
      // whoever took it. Defaulting these to the corrector would move the
      // amount off that cashier's shift total and onto the corrector's, so a
      // typo fix would silently rewrite two people's collection figures.
      // The corrector is still recorded, as created_by_id and on the audit row.
      receivedById: payment.receivedById,
      receivedAt: payment.receivedAt,
    })

    await tx
      .update(payments)
      .set({ replacedByPaymentId: replacement.payment.id, updatedAt: new Date() })
      .where(and(eq(payments.id, payment.id), eq(payments.tenantId, args.tenantId)))

    // Semantic audit row, the generic CRUD trigger already captured the
    // UPDATE on `payments`, but a named action is what an auditor greps for.
    await auditLog(tx, {
      tenantId: args.tenantId,
      userId: args.userId,
      branchId: txn.branchId,
      action: 'TRANSACTION_MODIFY',
      entityType: 'payments',
      entityId: payment.displayId,
      metadata: {
        reason: 'payment_method_correction',
        transactionDisplayId: args.transactionDisplayId,
        voidedPaymentId: payment.displayId,
        replacementPaymentId: replacement.payment.displayId,
        oldMethod: payment.method,
        newMethod: args.newMethod,
        oldReferenceNumber,
        newReferenceNumber,
        amount: payment.amount,
        correctionReason: args.reason,
        // Who is PERFORMING this correction (PIN-attested on the shared
        // `Branch` login, implicit for a real individual login). Distinct
        // from `payments.received_by_id` on the replacement row, which stays
        // the ORIGINAL payment's receiver: see the addPaymentTx call above.
        correctedByUserId: correctorUserId,
        correctedByDisplayId: correctorDisplayId,
        // Exception-report flag: true when the ORIGINAL payment's drawer
        // session is not (still) Open, including when it never had one. A
        // correction inside the open drawer is routine; one after the
        // drawer closed changes a figure someone already signed off on.
        // Never blocks the correction: see the doc comment above.
        touchesClosedPeriod,
        originalCashDrawerSessionState: originalSessionState,
      },
    })

    return {
      transactionDisplayId: args.transactionDisplayId,
      voidedPaymentId: payment.displayId,
      replacementPaymentId: replacement.payment.displayId,
      status: replacement.status,
      receiptNo: replacement.receiptNo,
    }
  })
}

export type ApplyPrepaymentArgs = TenantCtx & {
  /** Source prepayment/deposit transaction display_id (TXN_…). */
  prepaymentDisplayId: string
  /** Target consuming transaction display_id (TXN_…). */
  consumingDisplayId: string
}

export type ApplyPrepaymentResult = {
  applied: true
  /** Credit-payment display_id (PMT_…) recorded on the consuming txn. */
  paymentId: string
  /** Amount drawn from the patient's credit (numeric string). */
  amount: string
  /** Consuming transaction status after the draw. */
  status: 'Draft' | 'Pending' | 'Paid'
  /** Remaining credit on the source deposit after this draw (numeric string). */
  remainingCredit: string
}

/**
 * Draw a patient's prepaid credit/deposit against a consuming Draft/Pending
 * transaction.
 *
 * The deposit is a Paid (or partially-paid) liability and is NEVER mutated
 * here (the immutability trigger forbids it). Instead we insert a `Credit`
 * payment on the *consuming* transaction for `coverage = min(remainingCredit,
 * outstanding)`, funded by the deposit (payments.funded_by_transaction_id).
 * That reuses `addPaymentTx` so partial coverage → Pending, full coverage →
 * Paid, and MONEY-5 still caps overpayment. The deposit's remaining balance is
 * derived from the cash actually collected on it minus the sum of prior draws.
 *
 * Multi-draw-down is supported: a deposit can fund several consuming txns until
 * exhausted. The one allowed mutation on the (Paid) deposit — flipping
 * `prepayment_applied_at` NULL→timestamp — is done once, when it is exhausted.
 */
export async function applyPrepayment(args: ApplyPrepaymentArgs): Promise<ApplyPrepaymentResult> {
  return withTenantTx(args, async (tx) => {
    const prepayId = await resolveTransactionId(tx, args.tenantId, args.prepaymentDisplayId)
    if (prepayId === null) throw new LifecycleError('Patient credit not found', 'NOT_FOUND', 404)

    const consumingId = await resolveTransactionId(tx, args.tenantId, args.consumingDisplayId)
    if (consumingId === null) {
      throw new LifecycleError('Consuming transaction not found', 'NOT_FOUND', 404)
    }
    if (prepayId === consumingId) {
      throw new LifecycleError('A credit cannot be applied to itself', 'INVALID_STATE')
    }

    const [prepay] = await tx
      .select({
        id: transactions.id,
        patientId: transactions.patientId,
        isPrepayment: transactions.isPrepayment,
        prepaymentAppliedAt: transactions.prepaymentAppliedAt,
        amountPaid: transactions.amountPaid,
        status: transactions.status,
      })
      .from(transactions)
      .where(and(eq(transactions.id, prepayId), eq(transactions.tenantId, args.tenantId)))
      .limit(1)
    if (!prepay) throw new LifecycleError('Patient credit not found', 'NOT_FOUND', 404)
    if (!prepay.isPrepayment) {
      throw new LifecycleError('Source transaction is not a patient credit', 'INVALID_STATE')
    }
    if (prepay.status === 'Voided' || prepay.status === 'Refunded') {
      throw new LifecycleError(`Credit source is ${prepay.status}`, 'INVALID_STATE')
    }

    const [consuming] = await tx
      .select({
        id: transactions.id,
        patientId: transactions.patientId,
        status: transactions.status,
        netAmount: transactions.netAmount,
      })
      .from(transactions)
      .where(and(eq(transactions.id, consumingId), eq(transactions.tenantId, args.tenantId)))
      .limit(1)
    if (!consuming) throw new LifecycleError('Consuming transaction not found', 'NOT_FOUND', 404)
    const [consumingGroupBill] = await tx
      .select({ id: groupBills.id })
      .from(groupBills)
      .where(and(eq(groupBills.tenantId, args.tenantId), eq(groupBills.transactionId, consumingId)))
      .limit(1)
    if (consumingGroupBill) {
      throw new LifecycleError(
        'Patient credit cannot settle a payer-owned group bill',
        'GROUP_BILL_PATIENT_CREDIT_FORBIDDEN',
        422,
      )
    }
    if (consuming.patientId !== prepay.patientId) {
      throw new LifecycleError(
        'Consuming transaction belongs to a different patient',
        'INVALID_STATE',
      )
    }
    if (consuming.status !== 'Draft' && consuming.status !== 'Pending') {
      throw new LifecycleError('Consuming transaction must be Draft or Pending', 'INVALID_STATE')
    }

    // Remaining credit = cash collected on the deposit − sum of prior draws.
    // A voided Credit draw (payment-method correction) must stop counting
    // against the funding deposit's remaining balance.
    const [drawnRow] = await tx
      .select({ total: sql<string>`COALESCE(SUM(CAST(${payments.amount} AS numeric)), 0)` })
      .from(payments)
      .where(
        and(
          eq(payments.fundedByTransactionId, prepayId),
          eq(payments.tenantId, args.tenantId),
          isNull(payments.voidedAt),
        ),
      )
    const remainingCents = toCents(prepay.amountPaid) - toCents(drawnRow?.total ?? '0')
    if (remainingCents <= 0) {
      throw new LifecycleError('Patient credit is exhausted', 'CREDIT_EXHAUSTED', 422)
    }

    // Outstanding on the consuming txn = net − sum of its own (live) payments.
    const [paidRow] = await tx
      .select({ total: sql<string>`COALESCE(SUM(CAST(${payments.amount} AS numeric)), 0)` })
      .from(payments)
      .where(
        and(
          eq(payments.transactionId, consumingId),
          eq(payments.tenantId, args.tenantId),
          isNull(payments.voidedAt),
        ),
      )
    const outstandingCents = toCents(consuming.netAmount) - toCents(paidRow?.total ?? '0')
    if (outstandingCents <= 0) {
      throw new LifecycleError(
        'Consuming transaction has no outstanding balance',
        'NOTHING_OUTSTANDING',
        422,
      )
    }

    const coverageCents = Math.min(remainingCents, outstandingCents)
    const coverage = fromCents(coverageCents)

    const paymentResult = await addPaymentTx(tx, {
      tenantId: args.tenantId,
      userId: args.userId,
      branchId: args.branchId ?? null,
      transactionId: consumingId,
      method: 'Credit',
      amount: coverage,
      fundedByTransactionId: prepayId,
      notes: `Credit draw from ${args.prepaymentDisplayId}`,
    })

    // When the deposit is fully consumed, close it. Flipping prepayment_applied_at
    // NULL→timestamp is the one update the immutability trigger permits on a Paid
    // row (and it short-circuits the whole UPDATE, so appliedToTransactionId rides
    // along). Only attempt it once.
    const newRemainingCents = remainingCents - coverageCents
    if (newRemainingCents <= 0 && !prepay.prepaymentAppliedAt) {
      await tx
        .update(transactions)
        .set({
          prepaymentAppliedAt: new Date(),
          appliedToTransactionId: consumingId,
          updatedAt: new Date(),
        })
        .where(and(eq(transactions.id, prepayId), eq(transactions.tenantId, args.tenantId)))
    }

    return {
      applied: true,
      paymentId: paymentResult.payment.displayId,
      amount: coverage,
      status: paymentResult.status,
      remainingCredit: fromCents(Math.max(newRemainingCents, 0)),
    }
  })
}

export type PatientCreditDeposit = {
  /** Deposit transaction display_id (TXN_…). */
  id: string
  /** Original deposit amount (net). */
  depositAmount: string
  /** Cash actually collected on the deposit so far. */
  funded: string
  /** Sum of credit draws made against this deposit. */
  consumed: string
  /** funded − consumed, clamped at 0. */
  remaining: string
  status: string
  createdAt: string
}

export type PatientCreditResult = {
  /** Total spendable credit across the patient's deposits (numeric string). */
  available: string
  deposits: PatientCreditDeposit[]
}

/**
 * Sum a patient's spendable prepaid credit. A deposit's spendable balance is
 * the cash collected on it minus the credit draws funded by it; voided/refunded
 * and soft-deleted deposits are excluded.
 */
export async function getPatientCredit(
  args: TenantCtx & { patientDisplayId: string },
): Promise<PatientCreditResult> {
  return withTenantTx(args, async (tx) => {
    const patientId = await resolvePatientId(tx, args.tenantId, args.patientDisplayId)
    if (patientId === null) throw new LifecycleError('Patient not found', 'NOT_FOUND', 404)

    const rows = await tx.execute<{
      id: string
      depositAmount: string
      funded: string
      consumed: string
      status: string
      createdAt: string
    }>(sql`
      SELECT
        t.display_id AS "id",
        t.net_amount::numeric(12,2)::text AS "depositAmount",
        t.amount_paid::numeric(12,2)::text AS "funded",
        COALESCE((
          SELECT SUM(p.amount)
          FROM payments p
          WHERE p.funded_by_transaction_id = t.id
            AND p.tenant_id = t.tenant_id
            AND p.voided_at IS NULL
        ), 0)::numeric(12,2)::text AS "consumed",
        t.status AS "status",
        t.created_at::text AS "createdAt"
      FROM transactions t
      WHERE t.tenant_id = ${args.tenantId}
        AND t.patient_id = ${patientId}
        AND t.is_prepayment = true
        AND t.deleted_at IS NULL
        AND t.status NOT IN ('Voided', 'Refunded')
      ORDER BY t.created_at DESC
    `)

    let availableCents = 0
    const deposits: PatientCreditDeposit[] = []
    for (const r of rows) {
      const remainingCents = Math.max(toCents(r.funded) - toCents(r.consumed), 0)
      availableCents += remainingCents
      deposits.push({
        id: r.id,
        depositAmount: r.depositAmount,
        funded: r.funded,
        consumed: r.consumed,
        remaining: fromCents(remainingCents),
        status: r.status,
        createdAt: r.createdAt,
      })
    }

    return { available: fromCents(availableCents), deposits }
  })
}

// ── Pay on account (patient balance) ─────────────────────────────────────────

/**
 * Serialize every pay-on-account / apply-credit run for one patient.
 *
 * Taken as the FIRST statement, before any row lock, so lock ordering is global
 * and deadlock-free. Row locks alone are not enough: the overage calculation
 * depends on the TOTAL across the patient's bills, which per-row locks cannot
 * freeze (a concurrent session could settle a bill this one has not read yet).
 * Released automatically at commit or rollback.
 */
async function lockPatientAccount(tx: Tx, tenantId: string, patientId: number): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:payonacct:${String(patientId)}`}))`,
  )
}

/**
 * The patient's open bills, oldest-first and locked for the rest of the tx.
 *
 * "Oldest" is `transacted_at`, not `created_at`: migrated AppSheet rows carry
 * the legacy sale date in `transacted_at` and the import date in `created_at`,
 * so ordering by the latter would sort every migrated bill after every native
 * one. `id` is the deterministic tiebreak (both timestamps default to now(), so
 * two bills in the same millisecond would otherwise order nondeterministically
 * and make tests flaky).
 *
 * The balance is recomputed as `net_amount - SUM(payments)` rather than read
 * from the GENERATED `amount_outstanding`, using the identical expression
 * `addPaymentTx` uses for its MONEY-5 cap. That byte-identity is what makes an
 * over-allocated leg arithmetically impossible. It has to be a scalar subquery:
 * Postgres rejects FOR UPDATE alongside GROUP BY, aggregates, or a joined
 * relation, so a LEFT JOIN ... GROUP BY form would not even parse.
 */
async function lockOpenBillsForPatient(
  tx: Tx,
  tenantId: string,
  patientId: number,
  onlyTransactionId?: number | null,
): Promise<OpenBill[]> {
  const scope = onlyTransactionId != null ? sql` AND t.id = ${onlyTransactionId}` : sql``

  const rows = await tx.execute<{ id: string; outstanding: string }>(sql`
    SELECT t.id::text AS "id",
           (t.net_amount - COALESCE((
              SELECT SUM(p.amount) FROM payments p
              WHERE p.transaction_id = t.id AND p.tenant_id = t.tenant_id
                AND p.voided_at IS NULL
           ), 0))::numeric(12,2)::text AS "outstanding"
    FROM transactions t
    WHERE t.tenant_id      = ${tenantId}
      AND t.patient_id     = ${patientId}
      AND t.deleted_at     IS NULL
      AND t.is_prepayment  = false
      AND t.status         IN ('Draft', 'Pending')${scope}
      AND NOT EXISTS (
        SELECT 1 FROM group_bills gb
        WHERE gb.tenant_id = t.tenant_id AND gb.transaction_id = t.id
      )
    ORDER BY t.transacted_at ASC, t.id ASC
    FOR UPDATE
  `)

  return rows
    .map((r) => ({ transactionId: Number(r.id), outstandingCents: toCents(r.outstanding) }))
    .filter((b) => b.outstandingCents > 0)
}

/** Sum of the patient's open-bill balances, after the writes in this tx. */
async function patientBalanceCents(tx: Tx, tenantId: string, patientId: number): Promise<number> {
  const [row] = await tx.execute<{ total: string }>(sql`
    SELECT COALESCE(SUM(t.amount_outstanding), 0)::numeric(12,2)::text AS "total"
    FROM transactions t
    WHERE t.tenant_id     = ${tenantId}
      AND t.patient_id    = ${patientId}
      AND t.deleted_at    IS NULL
      AND t.is_prepayment = false
      AND t.status        IN ('Draft', 'Pending')
      AND NOT EXISTS (
        SELECT 1 FROM group_bills gb
        WHERE gb.tenant_id = t.tenant_id AND gb.transaction_id = t.id
      )
  `)
  return toCents(row?.total ?? '0')
}

/**
 * The patient's spendable deposits, oldest-first.
 *
 * Clamps per deposit before summing, mirroring `getPatientCredit`: without the
 * per-row GREATEST, one over-drawn deposit would offset another's balance and
 * understate the available credit.
 */
async function creditSourcesForPatient(
  tx: Tx,
  tenantId: string,
  patientId: number,
): Promise<Array<CreditSource & { appliedAt: Date | null }>> {
  const rows = await tx.execute<{
    id: string
    remaining: string
    appliedAt: string | null
  }>(sql`
    SELECT t.id::text AS "id",
           GREATEST(t.amount_paid - COALESCE((
             SELECT SUM(p.amount) FROM payments p
             WHERE p.funded_by_transaction_id = t.id AND p.tenant_id = t.tenant_id
               AND p.voided_at IS NULL
           ), 0), 0)::numeric(12,2)::text AS "remaining",
           t.prepayment_applied_at::text AS "appliedAt"
    FROM transactions t
    WHERE t.tenant_id      = ${tenantId}
      AND t.patient_id     = ${patientId}
      AND t.deleted_at     IS NULL
      AND t.is_prepayment  = true
      AND t.status         NOT IN ('Voided', 'Refunded')
    ORDER BY t.transacted_at ASC, t.id ASC
    FOR UPDATE
  `)

  return rows
    .map((r) => ({
      transactionId: Number(r.id),
      remainingCents: toCents(r.remaining),
      appliedAt: r.appliedAt ? new Date(r.appliedAt) : null,
    }))
    .filter((s) => s.remainingCents > 0)
}

/**
 * Mark a deposit as spent. The one-way NULL -> timestamp write on
 * `prepayment_applied_at` is the only UPDATE the immutability trigger permits on
 * a Paid row, and it short-circuits the whole check, which is why
 * `applied_to_transaction_id` can ride along on the same statement.
 */
async function closeExhaustedDeposit(
  tx: Tx,
  tenantId: string,
  depositId: number,
  consumingTransactionId: number,
): Promise<void> {
  await tx
    .update(transactions)
    .set({
      prepaymentAppliedAt: new Date(),
      appliedToTransactionId: consumingTransactionId,
      updatedAt: new Date(),
    })
    .where(and(eq(transactions.id, depositId), eq(transactions.tenantId, tenantId)))
}

type PayOnAccountTenderLeg = {
  method: PaymentMethod
  amount: string
  referenceNumber?: string | null
  payerDisplayId?: string | null
  notes?: string | null
}

type PayOnAccountTender =
  | PayOnAccountTenderLeg
  | {
      payments: ReadonlyArray<PayOnAccountTenderLeg>
    }

export type PayOnAccountArgs = TenantCtx &
  MoneyAttestationFields &
  PayOnAccountTender & {
    /** Patient display_id (PAT_…). */
    patientDisplayId: string
    /**
     * Tender above the total outstanding: false/omitted rejects with 422
     * OVERPAYMENT_NOT_ALLOWED (MONEY-5's default) and returns the computed excess
     * so the client can confirm; true banks the excess as patient credit.
     */
    allowCredit?: boolean
    idempotencyKey?: string
  }

export type PayOnAccountAllocation = {
  /** Bill display_id (TXN_…). */
  transactionId: string
  /** Payment display_id (PMT_…). */
  paymentId: string
  amount: string
  /** Bill status AFTER this leg. */
  status: 'Draft' | 'Pending' | 'Paid'
  /** BIR receipt, minted on the leg that crosses the bill to Paid. */
  receiptNo: string | null
  outstandingAfter: string
}

export type PayOnAccountResult = {
  /** Patient display_id (PAT_…). */
  patientId: string
  /** Total applied to bills. */
  appliedAmount: string
  /** Banked as patient credit ('0.00' when none). */
  creditedAmount: string
  allocations: PayOnAccountAllocation[]
  /** The overage deposit's display_id, or null. */
  creditTransactionId: string | null
  balanceAfter: string
  availableCreditAfter: string
  idempotentReplay: boolean
}

/**
 * Settle a tendered amount across a patient's open bills, oldest-first.
 *
 * Each bill that crosses to Paid mints its OWN BIR receipt number, because
 * nothing is special-cased: `addPaymentTx` owns the whole Paid transition and is
 * simply called once per bill. N settled bills therefore yield N receipts within
 * this one transaction (re-locking a `tenant_counters` row this tx already holds
 * is a no-op, so there is no self-deadlock).
 *
 * MONEY-5's cap can never fire on the legs: coverage is
 * `min(remaining, billOutstanding)` computed from the same expression on a row
 * held FOR UPDATE, zero-balance bills are filtered out, and every bill in the
 * set is Draft/Pending so ALREADY_PAID is unreachable.
 */
export async function payOnAccount(args: PayOnAccountArgs): Promise<PayOnAccountResult> {
  // Resolve BEFORE the tx opens so PIN-attempt writes are independent of the
  // financial transaction. The patient-account HTTP route supplies a required
  // authenticated caller context; trusted internal callers opt out explicitly.
  const receivedById = await resolveReceivedById(args.tenantId, args.branchId, args.userId, args)
  const tenderLegs: ReadonlyArray<PayOnAccountTenderLeg> =
    'payments' in args ? args.payments : [args]
  if (tenderLegs.length === 0 || tenderLegs.some((leg) => toCents(leg.amount) <= 0)) {
    throw new LifecycleError('At least one payment leg is required', 'INVALID_AMOUNT', 422)
  }
  const tenderedCents = tenderLegs.reduce((sum, leg) => sum + toCents(leg.amount), 0)
  const tenderedAmount = fromCents(tenderedCents)

  return withTenantTx(args, async (tx) => {
    // Resolve INSIDE the tx: under FORCE RLS a bare read outside the GUC returns
    // no rows, which reads as a spurious "not found".
    const patientId = await resolvePatientId(tx, args.tenantId, args.patientDisplayId)
    if (patientId === null) throw new LifecycleError('Patient not found', 'NOT_FOUND', 404)

    await lockPatientAccount(tx, args.tenantId, patientId)

    // Idempotency replay, inside the same tx so the partial unique index on
    // payments(tenant_id, idempotency_key) is the real guard. The guarantee is
    // that the effect is never re-applied; the body reproduces the first leg's
    // detail plus live-recomputed totals. A faithful multi-leg replay would need
    // a payment_batches table (deliberately out of scope).
    if (args.idempotencyKey) {
      const replay = await findPayOnAccountReplay(tx, args.tenantId, args.idempotencyKey)
      if (replay) {
        return {
          ...replay,
          patientId: args.patientDisplayId,
          balanceAfter: fromCents(await patientBalanceCents(tx, args.tenantId, patientId)),
          availableCreditAfter: fromCents(
            (await creditSourcesForPatient(tx, args.tenantId, patientId)).reduce(
              (s, c) => s + c.remainingCents,
              0,
            ),
          ),
          idempotentReplay: true,
        }
      }
    }

    // Resolve every payer before the first financial write. A bad payer on a
    // later split leg therefore cannot partially post the earlier legs.
    const resolvedTenderLegs: Array<PaymentLegInput & { amountCents: number }> = []
    for (const leg of tenderLegs) {
      let payerId: number | null = null
      if (leg.payerDisplayId) {
        payerId = await resolvePayerId(tx, args.tenantId, leg.payerDisplayId)
        if (payerId === null) {
          throw new LifecycleError('Payer not found', 'PAYER_NOT_FOUND', 404)
        }
      }
      resolvedTenderLegs.push({
        method: leg.method,
        amount: leg.amount,
        amountCents: toCents(leg.amount),
        referenceNumber: leg.referenceNumber ?? null,
        resolvedPayerId: payerId,
        notes: leg.notes ?? null,
      })
    }

    const payerIds = new Set(resolvedTenderLegs.map((leg) => leg.resolvedPayerId ?? null))
    const depositPayerId =
      payerIds.size === 1 ? (resolvedTenderLegs[0]?.resolvedPayerId ?? null) : null

    const openBills = await lockOpenBillsForPatient(tx, args.tenantId, patientId)
    const plan = planAllocation(tenderedCents, openBills)

    // Gate everything BEFORE any write, so a rejection costs no rollback.
    //
    // "Nothing owed" is checked FIRST, and deliberately so. With no open bills the
    // planner puts the whole tender into `excessCents`, so an overage check placed
    // ahead of this one would swallow the case and answer "tendered 500.00 exceeds
    // the total outstanding of 0.00": technically true, useless to a cashier, and
    // it made NOTHING_OUTSTANDING unreachable dead code. Caught by the integration
    // suite, which asserted the documented error and got the generic one.
    if (plan.legs.length === 0 && !args.allowCredit) {
      throw new LifecycleError(
        'This patient has no outstanding balance. Record a deposit to hold the money as patient credit.',
        'NOTHING_OUTSTANDING',
        422,
        { tendered: tenderedAmount, totalOutstanding: '0.00' },
      )
    }

    if (plan.excessCents > 0) {
      if (!args.allowCredit) {
        // Reached only when SOME of the tender was allocated: a pure "owes
        // nothing" tender is answered above.
        throw new LifecycleError(
          `Tendered ${tenderedAmount} exceeds the total outstanding of ${fromCents(plan.appliedCents)}`,
          'OVERPAYMENT_NOT_ALLOWED',
          422,
          {
            totalOutstanding: fromCents(plan.appliedCents),
            tendered: tenderedAmount,
            excess: fromCents(plan.excessCents),
          },
        )
      }
      if (args.branchId === null) {
        throw new LifecycleError(
          'A branch is required to bank an overpayment as patient credit',
          'NO_BRANCH',
          400,
        )
      }
      // The deposit INSERT is subject to the D2 branch-invariant trigger, which
      // rejects a financial row raised at a branch other than the one where the
      // patient was last treated. Pre-flight it so the cashier gets an
      // actionable ceiling instead of an opaque 23514 that rolls back legs
      // already applied.
      const lastBranch = await lastAdministeredBranchId(tx, args.tenantId, patientId)
      if (lastBranch !== null && lastBranch !== args.branchId) {
        throw new LifecycleError(
          "This patient's care is at another branch; the excess cannot be banked as credit here.",
          'D2_CROSS_BRANCH_DEPOSIT',
          409,
          {
            maxPayableHere: fromCents(plan.appliedCents),
            excess: fromCents(plan.excessCents),
          },
        )
      }
    }

    // Unreachable through the HTTP API, where positiveMoneySchema guarantees a
    // tender above zero. Kept as a guard for direct callers.
    if (plan.legs.length === 0 && plan.excessCents === 0) {
      throw new LifecycleError('Nothing to apply', 'INVALID_AMOUNT', 422)
    }

    // Consume the cashier-entered tender legs across bill allocations without
    // changing their methods. The cursor is local to this DB transaction; all
    // generated payment rows still commit or roll back together.
    let tenderIndex = 0
    let tenderRemainingCents = resolvedTenderLegs[0]?.amountCents ?? 0
    let firstPersistedLeg = true
    const consumeTender = (
      cents: number,
      referenceSuffix: string,
      fallbackNotes: string,
    ): PaymentLegInput[] => {
      let remaining = cents
      const pieces: PaymentLegInput[] = []
      while (remaining > 0) {
        const source = resolvedTenderLegs[tenderIndex]
        if (!source) {
          throw new LifecycleError('Split tender allocation is incomplete', 'INVALID_AMOUNT', 422)
        }
        const applied = Math.min(remaining, tenderRemainingCents)
        pieces.push({
          method: source.method,
          amount: fromCents(applied),
          referenceNumber: source.referenceNumber
            ? `${source.referenceNumber}-${referenceSuffix}`
            : null,
          resolvedPayerId: source.resolvedPayerId ?? null,
          notes: source.notes ?? fallbackNotes,
          ...(firstPersistedLeg && args.idempotencyKey
            ? { idempotencyKey: args.idempotencyKey }
            : {}),
        })
        firstPersistedLeg = false
        remaining -= applied
        tenderRemainingCents -= applied
        if (tenderRemainingCents === 0) {
          tenderIndex += 1
          tenderRemainingCents = resolvedTenderLegs[tenderIndex]?.amountCents ?? 0
        }
      }
      return pieces
    }

    const allocations: PayOnAccountAllocation[] = []
    for (const [i, leg] of plan.legs.entries()) {
      const allocatedTender = consumeTender(
        leg.amountCents,
        String(i + 1),
        `Pay on account (${i + 1}/${plan.legs.length})`,
      )
      const legResult = await applyPaymentLegsTx(tx, {
        tenantId: args.tenantId,
        userId: args.userId,
        branchId: args.branchId,
        transactionId: leg.transactionId,
        initialStatus: 'Pending',
        legs: allocatedTender,
        ...(receivedById !== undefined ? { receivedById } : {}),
      })
      allocations.push({
        transactionId: await displayIdForTransaction(tx, args.tenantId, leg.transactionId),
        paymentId: legResult.paymentDisplayId!,
        amount: fromCents(leg.amountCents),
        status: legResult.status,
        receiptNo: legResult.receiptNo,
        outstandingAfter: fromCents(leg.remainingAfterCents),
      })
    }

    // Bank the overage as an item-less deposit, funded with the same tender so
    // the cash still counts toward the drawer close.
    let creditTransactionId: string | null = null
    if (plan.excessCents > 0) {
      const excess = fromCents(plan.excessCents)
      const deposit = await insertTransactionHeaderTx(tx, {
        tenantId: args.tenantId,
        branchId: args.branchId!,
        userId: args.userId,
        patientId,
        encounterId: null,
        payerId: depositPayerId,
        discountIdType: null,
        discountIdNumber: null,
        grossAmount: excess,
        discountAmount: '0.00',
        vatAmount: '0.00',
        netAmount: excess,
        isPrepayment: true,
        // The key rides on the first bill leg when there is one; only an
        // overage-only call (no bills) can carry it here.
        idempotencyKey: plan.legs.length === 0 ? (args.idempotencyKey ?? null) : null,
        transactedAt: new Date(),
      })
      await insertTransactionPatientsTx(tx, {
        tenantId: args.tenantId,
        transactionId: deposit.id,
        userId: args.userId,
        rows: [
          {
            patientId,
            encounterId: null,
            discountIdType: null,
            discountIdNumber: null,
          },
        ],
      })
      // Funding settles the deposit to Paid, which also mints a BIR receipt for
      // it. That matches today's standalone-deposit behaviour. Under real BIR
      // rules an advance warrants a Collection/Acknowledgement Receipt with the
      // OR issued when service is rendered; every Phase-1 branch resolves to
      // acknowledgement mode, so this is moot until BIR registration. Flagged in
      // docs/STATUS.md, not changed here.
      await applyPaymentLegsTx(tx, {
        tenantId: args.tenantId,
        userId: args.userId,
        branchId: args.branchId,
        transactionId: deposit.id,
        initialStatus: 'Pending',
        legs: consumeTender(plan.excessCents, 'CR', 'Overpayment banked as patient credit'),
        ...(receivedById !== undefined ? { receivedById } : {}),
      })
      creditTransactionId = deposit.displayId
    }

    const creditAfter = (await creditSourcesForPatient(tx, args.tenantId, patientId)).reduce(
      (s, c) => s + c.remainingCents,
      0,
    )

    return {
      patientId: args.patientDisplayId,
      appliedAmount: fromCents(plan.appliedCents),
      creditedAmount: fromCents(plan.excessCents),
      allocations,
      creditTransactionId,
      balanceAfter: fromCents(await patientBalanceCents(tx, args.tenantId, patientId)),
      availableCreditAfter: fromCents(creditAfter),
      idempotentReplay: false,
    }
  })
}

/** Reverse-resolve a bigint transaction id to its display_id, inside the tx. */
async function displayIdForTransaction(tx: Tx, tenantId: string, id: number): Promise<string> {
  const [row] = await tx
    .select({ displayId: transactions.displayId })
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.tenantId, tenantId)))
    .limit(1)
  return row!.displayId
}

/**
 * Look for a prior pay-on-account run with this idempotency key.
 *
 * Returns the recorded first leg so a retry is observably a replay rather than a
 * second charge. Because the lookup and the insert share one transaction, and
 * the per-patient advisory lock serializes concurrent submits, a true
 * double-submit is queued and the second run lands here.
 */
async function findPayOnAccountReplay(
  tx: Tx,
  tenantId: string,
  idempotencyKey: string,
): Promise<Omit<
  PayOnAccountResult,
  'patientId' | 'balanceAfter' | 'availableCreditAfter' | 'idempotentReplay'
> | null> {
  const [row] = await tx
    .select({
      paymentDisplayId: payments.displayId,
      amount: payments.amount,
      transactionId: payments.transactionId,
    })
    .from(payments)
    .where(and(eq(payments.tenantId, tenantId), eq(payments.idempotencyKey, idempotencyKey)))
    .limit(1)
  if (!row) return null

  const [txn] = await tx
    .select({
      displayId: transactions.displayId,
      status: transactions.status,
      receiptNo: transactions.receiptNo,
      amountOutstanding: transactions.amountOutstanding,
      isPrepayment: transactions.isPrepayment,
    })
    .from(transactions)
    .where(and(eq(transactions.id, row.transactionId), eq(transactions.tenantId, tenantId)))
    .limit(1)
  if (!txn) return null

  const wasDeposit = txn.isPrepayment
  return {
    appliedAmount: wasDeposit ? '0.00' : row.amount,
    creditedAmount: wasDeposit ? row.amount : '0.00',
    allocations: wasDeposit
      ? []
      : [
          {
            transactionId: txn.displayId,
            paymentId: row.paymentDisplayId,
            amount: row.amount,
            status: txn.status as 'Draft' | 'Pending' | 'Paid',
            receiptNo: txn.receiptNo,
            outstandingAfter: txn.amountOutstanding,
          },
        ],
    creditTransactionId: wasDeposit ? txn.displayId : null,
  }
}

export type ApplyCreditArgs = TenantCtx & {
  /** Patient display_id (PAT_…). */
  patientDisplayId: string
  /** Scope the draw to one bill (TXN_…). Omit to work the whole balance. */
  transactionDisplayId?: string | null
  /** Cap the total drawn. Omit to draw min(available, outstanding). */
  amount?: string | null
}

export type ApplyCreditResult = {
  patientId: string
  /** Total credit drawn. */
  appliedAmount: string
  allocations: PayOnAccountAllocation[]
  balanceAfter: string
  availableCreditAfter: string
}

/**
 * Spend a patient's deposit credit against their open bills, oldest-first.
 *
 * Keyed on the patient, which is the point: the previous entry path started
 * from a deposit and matched candidate bills on the patient's display NAME,
 * so two patients with the same name could have credit applied to the wrong
 * bill. Optionally scoped to a single bill for the per-bill action.
 *
 * A draw is a `Credit` payment carrying `funded_by_transaction_id`, never a
 * mutation of the deposit: the deposit is Paid, and the immutability trigger
 * forbids writing a consumed_amount back to it.
 */
export async function applyCreditOnAccount(args: ApplyCreditArgs): Promise<ApplyCreditResult> {
  return withTenantTx(args, async (tx) => {
    const patientId = await resolvePatientId(tx, args.tenantId, args.patientDisplayId)
    if (patientId === null) throw new LifecycleError('Patient not found', 'NOT_FOUND', 404)

    await lockPatientAccount(tx, args.tenantId, patientId)

    let onlyTransactionId: number | null = null
    if (args.transactionDisplayId) {
      onlyTransactionId = await resolveTransactionId(tx, args.tenantId, args.transactionDisplayId)
      if (onlyTransactionId === null) {
        throw new LifecycleError('Transaction not found', 'NOT_FOUND', 404)
      }
    }

    const openBills = await lockOpenBillsForPatient(tx, args.tenantId, patientId, onlyTransactionId)
    if (openBills.length === 0) {
      throw new LifecycleError('Patient has no outstanding balance', 'NOTHING_OUTSTANDING', 422)
    }

    const sources = await creditSourcesForPatient(tx, args.tenantId, patientId)
    if (sources.length === 0) {
      throw new LifecycleError('Patient has no credit available', 'CREDIT_EXHAUSTED', 422)
    }

    const cap = args.amount ? toCents(args.amount) : Number.POSITIVE_INFINITY
    if (cap <= 0) throw new LifecycleError('Amount must be positive', 'INVALID_AMOUNT', 422)

    const plan = planCreditDraw(openBills, sources, cap)
    if (plan.legs.length === 0) {
      throw new LifecycleError('Nothing to apply', 'INVALID_AMOUNT', 422)
    }

    const allocations: PayOnAccountAllocation[] = []
    for (const leg of plan.legs) {
      const legResult = await applyPaymentLegsTx(tx, {
        tenantId: args.tenantId,
        userId: args.userId,
        branchId: args.branchId,
        transactionId: leg.transactionId,
        initialStatus: 'Pending',
        fundedByTransactionId: leg.fundedByTransactionId,
        legs: [
          {
            method: 'Credit',
            amount: fromCents(leg.amountCents),
            notes: 'Credit draw against patient deposit',
          },
        ],
      })

      // Close the deposit the first time it runs dry. The source rows were read
      // FOR UPDATE at the top of this tx, so `appliedAt` cannot have changed.
      if (leg.depositRemainingAfterCents <= 0) {
        const source = sources.find((s) => s.transactionId === leg.fundedByTransactionId)
        if (source && source.appliedAt === null) {
          await closeExhaustedDeposit(
            tx,
            args.tenantId,
            leg.fundedByTransactionId,
            leg.transactionId,
          )
        }
      }

      allocations.push({
        transactionId: await displayIdForTransaction(tx, args.tenantId, leg.transactionId),
        paymentId: legResult.paymentDisplayId!,
        amount: fromCents(leg.amountCents),
        status: legResult.status,
        receiptNo: legResult.receiptNo,
        outstandingAfter: fromCents(leg.billRemainingAfterCents),
      })
    }

    const creditAfter = (await creditSourcesForPatient(tx, args.tenantId, patientId)).reduce(
      (s, c) => s + c.remainingCents,
      0,
    )

    return {
      patientId: args.patientDisplayId,
      appliedAmount: fromCents(plan.drawnCents),
      allocations,
      balanceAfter: fromCents(await patientBalanceCents(tx, args.tenantId, patientId)),
      availableCreditAfter: fromCents(creditAfter),
    }
  })
}

// Suppress unused-import lint warning — kept for potential future use.
void resolveBranchByCode
