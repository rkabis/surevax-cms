import { sql } from 'drizzle-orm'
import type {
  ArAgingQuery,
  ArAgingResponse,
  DailyRevenueResponse,
  PaymentExceptionsQuery,
  PaymentExceptionsResponse,
  ReportsOptionsResponse,
  UnbilledQuery,
  UnbilledResponse,
} from '@surevax/shared/reports'
import { withTenantTx, type TenantCtx } from '../../shared/db/withTenantTx.js'
import { clinicCalendarDateString } from '../../shared/utils/clinicDate.js'
import { getDaySummary } from '../day_summary/service.js'

type ReportCtx = TenantCtx & { scope: 'branch' | 'tenant' }

const zeroAging = () => ({ d0_30: '0.00', d31_60: '0.00', d61_90: '0.00', d90plus: '0.00' })

export async function getReportOptions(
  args: ReportCtx & { isAdmin: boolean; canViewFinancial: boolean },
) {
  return withTenantTx(args, async (tx): Promise<ReportsOptionsResponse> => {
    const branchFilter =
      args.isAdmin || args.branchId === null ? sql`` : sql`AND b.id = ${args.branchId}`
    const branches = await tx.execute<{ id: string; code: string; name: string }>(sql`
      SELECT b.display_id AS id, b.code, b.name
      FROM branches b
      WHERE b.tenant_id = ${args.tenantId} AND b.is_active = true ${branchFilter}
      ORDER BY b.name
      LIMIT 200
    `)
    const payers = args.canViewFinancial
      ? await tx.execute<{
          id: string
          name: string
          type: 'HMO' | 'Corporate' | 'Government' | 'Promo'
        }>(sql`
          SELECT display_id AS id, name, payer_type AS type
          FROM payer_profiles
          WHERE tenant_id = ${args.tenantId} AND deleted_at IS NULL AND is_active = true
          ORDER BY name
          LIMIT 200
        `)
      : []
    return {
      allowedScopes: args.isAdmin ? ['branch', 'tenant'] : ['branch'],
      canViewFinancial: args.canViewFinancial,
      branches: [...branches],
      payers: [...payers],
    }
  })
}

export async function getArAging(
  args: ReportCtx & Omit<ArAgingQuery, 'branchId' | 'scope'>,
): Promise<ArAgingResponse> {
  const asOf = args.asOf ?? clinicCalendarDateString()
  const offset = (args.page - 1) * args.limit
  return withTenantTx(args, async (tx) => {
    const branchFilter = args.branchId === null ? sql`` : sql`AND t.branch_id = ${args.branchId}`
    const payerFilter =
      args.payerId === 'self-pay'
        ? sql`AND t.payer_id IS NULL`
        : args.payerId
          ? sql`AND rp.display_id = ${args.payerId}`
          : sql``
    const bucketFilter =
      args.bucket === 'd0_30'
        ? sql`AND (${asOf}::date - (t.transacted_at AT TIME ZONE 'Asia/Manila')::date) <= 30`
        : args.bucket === 'd31_60'
          ? sql`AND (${asOf}::date - (t.transacted_at AT TIME ZONE 'Asia/Manila')::date) BETWEEN 31 AND 60`
          : args.bucket === 'd61_90'
            ? sql`AND (${asOf}::date - (t.transacted_at AT TIME ZONE 'Asia/Manila')::date) BETWEEN 61 AND 90`
            : args.bucket === 'd90plus'
              ? sql`AND (${asOf}::date - (t.transacted_at AT TIME ZONE 'Asia/Manila')::date) > 90`
              : sql``

    const rows = await tx.execute<{
      branchId: string
      branchCode: string
      branchName: string
      payerId: string | null
      payerName: string | null
      payerType: 'HMO' | 'Corporate' | 'Government' | 'Promo' | null
      invoiceCount: number
      patientCount: number
      oldestAgeDays: number
      outstanding: string
      d0_30: string
      d31_60: string
      d61_90: string
      d90plus: string
    }>(sql`
      SELECT b.display_id AS "branchId", b.code AS "branchCode", b.name AS "branchName",
             rp.display_id AS "payerId", rp.name AS "payerName", rp.payer_type AS "payerType",
             COUNT(*)::int AS "invoiceCount", COUNT(DISTINCT t.patient_id)::int AS "patientCount",
             MAX((${asOf}::date - (t.transacted_at AT TIME ZONE 'Asia/Manila')::date))::int AS "oldestAgeDays",
             SUM(t.amount_outstanding)::numeric(12,2)::text AS outstanding,
             COALESCE(SUM(t.amount_outstanding) FILTER (WHERE (${asOf}::date - (t.transacted_at AT TIME ZONE 'Asia/Manila')::date) <= 30), 0)::numeric(12,2)::text AS "d0_30",
             COALESCE(SUM(t.amount_outstanding) FILTER (WHERE (${asOf}::date - (t.transacted_at AT TIME ZONE 'Asia/Manila')::date) BETWEEN 31 AND 60), 0)::numeric(12,2)::text AS "d31_60",
             COALESCE(SUM(t.amount_outstanding) FILTER (WHERE (${asOf}::date - (t.transacted_at AT TIME ZONE 'Asia/Manila')::date) BETWEEN 61 AND 90), 0)::numeric(12,2)::text AS "d61_90",
             COALESCE(SUM(t.amount_outstanding) FILTER (WHERE (${asOf}::date - (t.transacted_at AT TIME ZONE 'Asia/Manila')::date) > 90), 0)::numeric(12,2)::text AS "d90plus"
      FROM transactions t
      JOIN branches b ON b.id = t.branch_id AND b.tenant_id = t.tenant_id
      LEFT JOIN payer_profiles rp ON rp.id = t.payer_id AND rp.tenant_id = t.tenant_id
      WHERE t.tenant_id = ${args.tenantId} ${branchFilter} ${payerFilter} ${bucketFilter}
        AND t.deleted_at IS NULL AND t.is_prepayment = false
        AND t.status IN ('Draft', 'Pending') AND t.amount_outstanding > 0
      GROUP BY b.id, b.display_id, b.code, b.name, rp.id, rp.display_id, rp.name, rp.payer_type
      ORDER BY outstanding DESC, b.name, rp.name NULLS LAST
      LIMIT ${args.limit} OFFSET ${offset}
    `)

    const [totals] = await tx.execute<{
      invoiceCount: number
      payerCount: number
      branchCount: number
      groupCount: number
      outstanding: string
      d0_30: string
      d31_60: string
      d61_90: string
      d90plus: string
    }>(sql`
      SELECT COUNT(*)::int AS "invoiceCount",
             COUNT(DISTINCT COALESCE(t.payer_id::text, 'self-pay'))::int AS "payerCount",
             COUNT(DISTINCT t.branch_id)::int AS "branchCount",
             COUNT(DISTINCT (t.branch_id::text || ':' || COALESCE(t.payer_id::text, 'self-pay')))::int AS "groupCount",
             COALESCE(SUM(t.amount_outstanding), 0)::numeric(12,2)::text AS outstanding,
             COALESCE(SUM(t.amount_outstanding) FILTER (WHERE (${asOf}::date - (t.transacted_at AT TIME ZONE 'Asia/Manila')::date) <= 30), 0)::numeric(12,2)::text AS "d0_30",
             COALESCE(SUM(t.amount_outstanding) FILTER (WHERE (${asOf}::date - (t.transacted_at AT TIME ZONE 'Asia/Manila')::date) BETWEEN 31 AND 60), 0)::numeric(12,2)::text AS "d31_60",
             COALESCE(SUM(t.amount_outstanding) FILTER (WHERE (${asOf}::date - (t.transacted_at AT TIME ZONE 'Asia/Manila')::date) BETWEEN 61 AND 90), 0)::numeric(12,2)::text AS "d61_90",
             COALESCE(SUM(t.amount_outstanding) FILTER (WHERE (${asOf}::date - (t.transacted_at AT TIME ZONE 'Asia/Manila')::date) > 90), 0)::numeric(12,2)::text AS "d90plus"
      FROM transactions t
      LEFT JOIN payer_profiles rp ON rp.id = t.payer_id AND rp.tenant_id = t.tenant_id
      WHERE t.tenant_id = ${args.tenantId} ${branchFilter} ${payerFilter} ${bucketFilter}
        AND t.deleted_at IS NULL AND t.is_prepayment = false
        AND t.status IN ('Draft', 'Pending') AND t.amount_outstanding > 0
    `)
    const aging = totals
      ? {
          d0_30: totals.d0_30,
          d31_60: totals.d31_60,
          d61_90: totals.d61_90,
          d90plus: totals.d90plus,
        }
      : zeroAging()
    return {
      asOf,
      scope: args.scope,
      rows: rows.map((r) => ({
        branch: { id: r.branchId, code: r.branchCode, name: r.branchName },
        responsiblePayer: r.payerId
          ? { id: r.payerId, name: r.payerName!, type: r.payerType! }
          : null,
        invoiceCount: r.invoiceCount,
        patientCount: r.patientCount,
        oldestAgeDays: r.oldestAgeDays,
        outstanding: r.outstanding,
        aging: { d0_30: r.d0_30, d31_60: r.d31_60, d61_90: r.d61_90, d90plus: r.d90plus },
      })),
      totals: {
        invoiceCount: totals?.invoiceCount ?? 0,
        payerCount: totals?.payerCount ?? 0,
        branchCount: totals?.branchCount ?? 0,
        outstanding: totals?.outstanding ?? '0.00',
        aging,
      },
      pagination: { page: args.page, limit: args.limit, total: totals?.groupCount ?? 0 },
    }
  })
}

export async function getUnbilled(
  args: ReportCtx & Omit<UnbilledQuery, 'branchId' | 'scope'>,
): Promise<UnbilledResponse> {
  const offset = (args.page - 1) * args.limit
  return withTenantTx(args, async (tx) => {
    const branchFilter = args.branchId === null ? sql`` : sql`AND e.branch_id = ${args.branchId}`
    const searchFilter = args.q
      ? sql`AND (p.full_name ILIKE ${'%' + args.q + '%'} OR p.mrn ILIKE ${'%' + args.q + '%'} OR sc.name ILIKE ${'%' + args.q + '%'})`
      : sql``
    const fromFilter = args.from
      ? sql`AND (co.completed_at AT TIME ZONE 'Asia/Manila')::date >= ${args.from}::date`
      : sql``
    const toFilter = args.to
      ? sql`AND (co.completed_at AT TIME ZONE 'Asia/Manila')::date <= ${args.to}::date`
      : sql``
    const signalFilter =
      args.reconciliationRequired === 'true'
        ? sql`AND co.indication = 'paymentReconciliationRequired'`
        : args.reconciliationRequired === 'false'
          ? sql`AND co.indication IS DISTINCT FROM 'paymentReconciliationRequired'`
          : sql``
    const base = sql`
      co.tenant_id = ${args.tenantId} ${branchFilter} ${searchFilter} ${fromFilter} ${toFilter} ${signalFilter}
      AND co.status = 'Completed' AND co.completed_at IS NOT NULL AND co.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM transaction_items ti
        JOIN transactions t ON t.id = ti.transaction_id AND t.tenant_id = ti.tenant_id
        WHERE ti.tenant_id = co.tenant_id AND ti.clinical_order_id = co.id
          AND t.deleted_at IS NULL AND t.status NOT IN ('Voided', 'Refunded')
      )
      AND NOT EXISTS (
        SELECT 1 FROM transactions ft
        WHERE ft.tenant_id = co.tenant_id AND ft.id = co.fan_out_transaction_id
          AND ft.deleted_at IS NULL AND ft.status NOT IN ('Voided', 'Refunded')
      )
    `
    const rows = await tx.execute<{
      orderId: string
      patientId: string
      mrn: string
      patientName: string
      branchId: string
      branchCode: string
      branchName: string
      serviceName: string
      completedAt: string
      administeredByName: string | null
      reconciliationRequired: boolean
    }>(sql`
      SELECT co.display_id AS "orderId", p.display_id AS "patientId", p.mrn,
             p.full_name AS "patientName", b.display_id AS "branchId", b.code AS "branchCode",
             b.name AS "branchName", sc.name AS "serviceName", co.completed_at::text AS "completedAt",
             NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS "administeredByName",
             (co.indication = 'paymentReconciliationRequired') AS "reconciliationRequired"
      FROM clinical_orders co
      JOIN encounters e ON e.id = co.encounter_id AND e.tenant_id = co.tenant_id
      JOIN branches b ON b.id = e.branch_id AND b.tenant_id = co.tenant_id
      JOIN patients p ON p.id = co.patient_id AND p.tenant_id = co.tenant_id
      JOIN service_catalog sc ON sc.id = co.service_id AND sc.tenant_id = co.tenant_id
      LEFT JOIN users u ON u.id = co.administered_by_id AND u.tenant_id = co.tenant_id
      WHERE ${base}
      ORDER BY co.completed_at ASC, co.id ASC
      LIMIT ${args.limit} OFFSET ${offset}
    `)
    const [totals] = await tx.execute<{ count: number; reconciliationRequiredCount: number }>(sql`
      SELECT COUNT(*)::int AS count,
             COUNT(*) FILTER (WHERE co.indication = 'paymentReconciliationRequired')::int AS "reconciliationRequiredCount"
      FROM clinical_orders co
      JOIN encounters e ON e.id = co.encounter_id AND e.tenant_id = co.tenant_id
      JOIN patients p ON p.id = co.patient_id AND p.tenant_id = co.tenant_id
      JOIN service_catalog sc ON sc.id = co.service_id AND sc.tenant_id = co.tenant_id
      WHERE ${base}
    `)
    return {
      scope: args.scope,
      rows: rows.map((r) => ({
        orderId: r.orderId,
        patient: { id: r.patientId, mrn: r.mrn, name: r.patientName },
        branch: { id: r.branchId, code: r.branchCode, name: r.branchName },
        serviceName: r.serviceName,
        completedAt: r.completedAt,
        administeredByName: r.administeredByName,
        reconciliationRequired: r.reconciliationRequired,
        reason: r.reconciliationRequired ? 'Legacy reconciliation flag' : 'No active billing link',
      })),
      totals: {
        count: totals?.count ?? 0,
        reconciliationRequiredCount: totals?.reconciliationRequiredCount ?? 0,
      },
      pagination: { page: args.page, limit: args.limit, total: totals?.count ?? 0 },
    }
  })
}

export async function getPaymentExceptions(
  args: ReportCtx & Omit<PaymentExceptionsQuery, 'branchId' | 'scope'>,
): Promise<PaymentExceptionsResponse> {
  const offset = (args.page - 1) * args.limit
  return withTenantTx(args, async (tx) => {
    const branchFilter = args.branchId === null ? sql`` : sql`AND t.branch_id = ${args.branchId}`
    const payerFilter = args.payerId ? sql`AND rp.display_id = ${args.payerId}` : sql``
    const statusFilter = args.status
      ? sql`AND pay.reconciliation_status = ${args.status}`
      : sql`AND pay.reconciliation_status IN ('AwaitingReconciliation', 'Disputed', 'Failed', 'Mismatch', 'Pending')`
    const fromFilter = args.from
      ? sql`AND (pay.received_at AT TIME ZONE 'Asia/Manila')::date >= ${args.from}::date`
      : sql``
    const toFilter = args.to
      ? sql`AND (pay.received_at AT TIME ZONE 'Asia/Manila')::date <= ${args.to}::date`
      : sql``
    const base = sql`
      pay.tenant_id = ${args.tenantId} ${branchFilter} ${payerFilter} ${statusFilter} ${fromFilter} ${toFilter}
      AND pay.voided_at IS NULL AND t.deleted_at IS NULL AND t.status NOT IN ('Voided', 'Refunded')
    `
    const rows = await tx.execute<{
      paymentId: string
      transactionId: string
      patientId: string
      mrn: string
      patientName: string
      branchId: string
      branchCode: string
      branchName: string
      method: string
      amount: string
      status: 'AwaitingReconciliation' | 'Disputed' | 'Failed' | 'Mismatch' | 'Pending'
      referenceNumber: string | null
      receivedAt: string
      responsiblePayerId: string | null
      responsiblePayerName: string | null
      responsiblePayerType: 'HMO' | 'Corporate' | 'Government' | 'Promo' | null
      tenderPayerId: string | null
      tenderPayerName: string | null
      tenderPayerType: 'HMO' | 'Corporate' | 'Government' | 'Promo' | null
    }>(sql`
      SELECT pay.display_id AS "paymentId", t.display_id AS "transactionId",
             p.display_id AS "patientId", p.mrn, p.full_name AS "patientName",
             b.display_id AS "branchId", b.code AS "branchCode", b.name AS "branchName",
             pay.method::text, pay.amount::numeric(12,2)::text, pay.reconciliation_status AS status,
             pay.reference_number AS "referenceNumber", pay.received_at::text AS "receivedAt",
             rp.display_id AS "responsiblePayerId", rp.name AS "responsiblePayerName", rp.payer_type AS "responsiblePayerType",
             tp.display_id AS "tenderPayerId", tp.name AS "tenderPayerName", tp.payer_type AS "tenderPayerType"
      FROM payments pay
      JOIN transactions t ON t.id = pay.transaction_id AND t.tenant_id = pay.tenant_id
      JOIN branches b ON b.id = t.branch_id AND b.tenant_id = t.tenant_id
      JOIN patients p ON p.id = t.patient_id AND p.tenant_id = t.tenant_id
      LEFT JOIN payer_profiles rp ON rp.id = t.payer_id AND rp.tenant_id = t.tenant_id
      LEFT JOIN payer_profiles tp ON tp.id = pay.payer_id AND tp.tenant_id = pay.tenant_id
      WHERE ${base}
      ORDER BY pay.received_at ASC, pay.id ASC
      LIMIT ${args.limit} OFFSET ${offset}
    `)
    const [totals] = await tx.execute<{ count: number; amount: string }>(sql`
      SELECT COUNT(*)::int AS count, COALESCE(SUM(pay.amount), 0)::numeric(12,2)::text AS amount
      FROM payments pay
      JOIN transactions t ON t.id = pay.transaction_id AND t.tenant_id = pay.tenant_id
      LEFT JOIN payer_profiles rp ON rp.id = t.payer_id AND rp.tenant_id = t.tenant_id
      WHERE ${base}
    `)
    const payer = (
      id: string | null,
      name: string | null,
      type: 'HMO' | 'Corporate' | 'Government' | 'Promo' | null,
    ) => (id ? { id, name: name!, type: type! } : null)
    return {
      scope: args.scope,
      rows: rows.map((r) => ({
        paymentId: r.paymentId,
        transactionId: r.transactionId,
        patient: { id: r.patientId, mrn: r.mrn, name: r.patientName },
        branch: { id: r.branchId, code: r.branchCode, name: r.branchName },
        method: r.method,
        amount: r.amount,
        status: r.status,
        referenceNumber: r.referenceNumber,
        receivedAt: r.receivedAt,
        responsiblePayer: payer(
          r.responsiblePayerId,
          r.responsiblePayerName,
          r.responsiblePayerType,
        ),
        tenderPayer: payer(r.tenderPayerId, r.tenderPayerName, r.tenderPayerType),
      })),
      totals: { count: totals?.count ?? 0, amount: totals?.amount ?? '0.00' },
      pagination: { page: args.page, limit: args.limit, total: totals?.count ?? 0 },
    }
  })
}

export async function getDailyRevenue(
  args: TenantCtx & { date: string },
): Promise<DailyRevenueResponse> {
  if (args.branchId === null) throw new Error('branchId required for daily revenue')
  const [branch, summary] = await Promise.all([
    withTenantTx(args, async (tx) => {
      const [row] = await tx.execute<{ id: string; code: string; name: string }>(sql`
        SELECT display_id AS id, code, name FROM branches
        WHERE tenant_id = ${args.tenantId} AND id = ${args.branchId} LIMIT 1
      `)
      return row
    }),
    getDaySummary({
      tenantId: args.tenantId,
      userId: args.userId,
      branchId: args.branchId,
      date: args.date,
    }),
  ])
  if (!branch) throw new Error('Branch not found')
  return {
    date: args.date,
    branch,
    generatedAt: summary.generatedAt,
    revenue: {
      transactionCount: summary.transactions.count,
      // Day-summary includes every non-voided/non-refunded, non-prepayment
      // transaction regardless of collection state. Name the fact precisely;
      // it is not accounting revenue recognition.
      transactionNetTotal: summary.transactions.totalRevenue,
      outstanding: summary.transactions.totalUnsettled,
    },
    tenders: summary.transactions.byMethod,
    deposits: { count: summary.drawer.depositCount, total: summary.drawer.depositsTotal },
    drawer: {
      sessionCount: summary.drawer.sessionCount,
      declaredTotal: summary.drawer.declaredTotalTotal,
      variance: summary.drawer.varianceTotal,
    },
  }
}
