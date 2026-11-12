/**
 * Corporate group billing persists one non-financial wrapper around an ordinary
 * transaction. The transaction module remains the exclusive money engine:
 * transaction_items/patients keep exact allocations, payments drive status,
 * and voiding continues to unwind inventory/clinical bundle fan-out.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { withTenantTx, type TenantCtx } from '../../shared/db/withTenantTx.js'
import { groupBills, payerProfiles } from '../../shared/db/schema.js'
import { displayId } from '../../shared/utils/displayId.js'
import { fromCents, toCents } from '../../shared/utils/money.js'
import {
  addPayment,
  createTransaction,
  LifecycleError,
  voidTransaction,
  type MoneyCallerContext,
  type PaymentMethod,
} from '../transactions/db.js'
import type { GroupBillCreateInput, GroupBillPaymentInput } from './contract.js'

type GroupBillStatus = 'Draft' | 'Pending' | 'Paid' | 'Voided' | 'Refunded'

export type GroupBillListRow = {
  id: string
  transactionId: string
  payer: { id: string; name: string }
  patientCount: number
  itemCount: number
  netAmount: string
  amountPaid: string
  amountOutstanding: string
  status: GroupBillStatus
  createdAt: string
  referenceNumber: string | null
}

export type GroupBillListResult = {
  data: GroupBillListRow[]
  summary: { count: number; netAmount: string; amountPaid: string; amountOutstanding: string }
}

type GroupBillContext = {
  id: string
  transactionId: string
  payerId: string
  status: GroupBillStatus
}

/** Return a group row only when RLS permits the caller's branch scope. */
async function loadGroupBillContext(
  args: TenantCtx,
  groupBillDisplayId: string,
): Promise<GroupBillContext> {
  return withTenantTx(args, async (tx) => {
    const [row] = await tx.execute<GroupBillContext>(sql`
      SELECT gb.display_id AS "id", t.display_id AS "transactionId",
             pp.display_id AS "payerId", t.status AS "status"
      FROM group_bills gb
      JOIN transactions t ON t.id = gb.transaction_id AND t.tenant_id = gb.tenant_id
      JOIN payer_profiles pp ON pp.id = gb.payer_id AND pp.tenant_id = gb.tenant_id
      WHERE gb.tenant_id = ${args.tenantId}
        AND gb.display_id = ${groupBillDisplayId}
        AND gb.deleted_at IS NULL
      LIMIT 1
    `)
    if (!row) throw new LifecycleError('Group bill not found', 'NOT_FOUND', 404)
    return row
  })
}

export async function createGroupBill(
  args: TenantCtx & {
    userId: number
    branchId: number
    moneyCaller: MoneyCallerContext
    idempotencyKey?: string
    payload: GroupBillCreateInput
  },
): Promise<
  | { ok: true; id: string; transactionId: string; status: 'Draft' | 'Pending' | 'Paid' }
  | { ok: false; status: number; error: string; code: string; details?: unknown }
> {
  const primary = args.payload.patients[0]!
  const groupBillDisplayId = displayId('GBL')

  const result = await createTransaction({
    tenantId: args.tenantId,
    userId: args.userId,
    branchId: args.branchId,
    moneyCaller: args.moneyCaller,
    idempotencyKey: args.idempotencyKey,
    payload: {
      patientId: primary.patientId,
      encounterId: primary.encounterId,
      payerId: args.payload.payerId,
      discount: primary.discount ?? null,
      patients: args.payload.patients.slice(1).map((patient) => ({
        patientId: patient.patientId,
        encounterId: patient.encounterId,
        discount: patient.discount ?? null,
      })),
      items: args.payload.patients.flatMap((patient) =>
        patient.items.map((item) => ({ ...item, patientId: patient.patientId })),
      ),
    },
    afterTransactionCreated: async ({ tx, transactionId, tenantId, branchId, payerId }) => {
      // Active is deliberately checked at creation only. Disabling a payer later
      // must preserve (not invalidate) historic receivables and payment audit.
      const [payer] = await tx
        .select({ id: payerProfiles.id })
        .from(payerProfiles)
        .where(
          and(
            eq(payerProfiles.id, payerId ?? -1),
            eq(payerProfiles.tenantId, tenantId),
            eq(payerProfiles.payerType, 'Corporate'),
            eq(payerProfiles.isActive, true),
            isNull(payerProfiles.deletedAt),
          ),
        )
        .limit(1)
      if (!payer || payerId === null) {
        throw new LifecycleError(
          'Group billing requires an active Corporate payer',
          'GROUP_PAYER_INVALID',
          422,
        )
      }

      await tx.insert(groupBills).values({
        displayId: groupBillDisplayId,
        tenantId,
        branchId,
        transactionId,
        payerId,
        referenceNumber: args.payload.referenceNumber ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
        createdById: args.userId,
      })
    },
  })

  if (!result.ok) return result
  return {
    ok: true,
    id: groupBillDisplayId,
    transactionId: result.id,
    status: result.status,
  }
}

export async function listGroupBills(
  args: TenantCtx & { status?: 'open' | 'all' },
): Promise<GroupBillListResult> {
  return withTenantTx(args, async (tx) => {
    const rows = await tx.execute<GroupBillListRow>(sql`
      SELECT gb.display_id AS "id",
             t.display_id AS "transactionId",
             json_build_object('id', pp.display_id, 'name', pp.name) AS "payer",
             (SELECT COUNT(*)::int FROM transaction_patients tp
                WHERE tp.transaction_id = t.id AND tp.tenant_id = t.tenant_id) AS "patientCount",
             (SELECT COUNT(*)::int FROM transaction_items ti
                WHERE ti.transaction_id = t.id AND ti.tenant_id = t.tenant_id) AS "itemCount",
             t.net_amount::numeric(12,2)::text AS "netAmount",
             t.amount_paid::numeric(12,2)::text AS "amountPaid",
             CASE WHEN t.status IN ('Voided', 'Refunded') THEN '0.00'
                  ELSE t.amount_outstanding::numeric(12,2)::text END AS "amountOutstanding",
             t.status AS "status", gb.created_at::text AS "createdAt",
             gb.reference_number AS "referenceNumber"
      FROM group_bills gb
      JOIN transactions t ON t.id = gb.transaction_id AND t.tenant_id = gb.tenant_id
      JOIN payer_profiles pp ON pp.id = gb.payer_id AND pp.tenant_id = gb.tenant_id
      WHERE gb.tenant_id = ${args.tenantId} AND gb.deleted_at IS NULL
        AND (
          ${args.status ?? 'open'} = 'all'
          OR (t.status IN ('Draft', 'Pending') AND t.amount_outstanding > 0)
        )
      ORDER BY gb.created_at DESC, gb.id DESC
    `)

    return {
      data: rows,
      summary: rows.reduce(
        (summary, row) => ({
          count: summary.count + 1,
          netAmount: fromCents(toCents(summary.netAmount) + toCents(row.netAmount)),
          amountPaid: fromCents(toCents(summary.amountPaid) + toCents(row.amountPaid)),
          amountOutstanding: fromCents(
            toCents(summary.amountOutstanding) + toCents(row.amountOutstanding),
          ),
        }),
        { count: 0, netAmount: '0.00', amountPaid: '0.00', amountOutstanding: '0.00' },
      ),
    }
  })
}

export async function getGroupBill(
  args: TenantCtx,
  groupBillDisplayId: string,
): Promise<
  GroupBillListRow & {
    patients: Array<{
      patient: { id: string; firstName: string; lastName: string }
      encounterId: string | null
      discount: { idType: 'OSCA' | 'PWD' | 'Other'; idNumber: string | null } | null
      items: Array<{
        id: string
        serviceId: string
        clinicalOrderId: string | null
        quantity: string
        unitPrice: string
        discountAmount: string
        vatAmount: string
        subtotal: string
      }>
    }>
    payments: Array<{
      id: string
      method: string
      amount: string
      referenceNumber: string | null
      receivedAt: string
      voidedAt: string | null
    }>
  }
> {
  return withTenantTx(args, async (tx) => {
    const [header] = await tx.execute<GroupBillListRow>(sql`
      SELECT gb.display_id AS "id", t.display_id AS "transactionId",
             json_build_object('id', pp.display_id, 'name', pp.name) AS "payer",
             (SELECT COUNT(*)::int FROM transaction_patients tp WHERE tp.transaction_id = t.id) AS "patientCount",
             (SELECT COUNT(*)::int FROM transaction_items ti WHERE ti.transaction_id = t.id) AS "itemCount",
             t.net_amount::numeric(12,2)::text AS "netAmount", t.amount_paid::numeric(12,2)::text AS "amountPaid",
             CASE WHEN t.status IN ('Voided', 'Refunded') THEN '0.00' ELSE t.amount_outstanding::numeric(12,2)::text END AS "amountOutstanding",
             t.status AS "status", gb.created_at::text AS "createdAt", gb.reference_number AS "referenceNumber"
      FROM group_bills gb
      JOIN transactions t ON t.id = gb.transaction_id AND t.tenant_id = gb.tenant_id
      JOIN payer_profiles pp ON pp.id = gb.payer_id AND pp.tenant_id = gb.tenant_id
      WHERE gb.tenant_id = ${args.tenantId} AND gb.display_id = ${groupBillDisplayId} AND gb.deleted_at IS NULL
      LIMIT 1
    `)
    if (!header) throw new LifecycleError('Group bill not found', 'NOT_FOUND', 404)

    const patientRows = await tx.execute<{
      patientId: string
      firstName: string
      lastName: string
      encounterId: string | null
      discountIdType: 'OSCA' | 'PWD' | 'Other' | null
      discountIdNumber: string | null
    }>(sql`
      SELECT p.display_id AS "patientId", p.first_name AS "firstName", p.last_name AS "lastName",
             e.display_id AS "encounterId", tp.discount_id_type AS "discountIdType", tp.discount_id_number AS "discountIdNumber"
      FROM group_bills gb
      JOIN transaction_patients tp ON tp.transaction_id = gb.transaction_id AND tp.tenant_id = gb.tenant_id
      JOIN patients p ON p.id = tp.patient_id AND p.tenant_id = tp.tenant_id
      LEFT JOIN encounters e ON e.id = tp.encounter_id AND e.tenant_id = tp.tenant_id
      WHERE gb.tenant_id = ${args.tenantId} AND gb.display_id = ${groupBillDisplayId} AND gb.deleted_at IS NULL
      ORDER BY tp.id ASC
    `)
    const itemRows = await tx.execute<{
      patientId: string
      id: string
      serviceId: string
      clinicalOrderId: string | null
      quantity: string
      unitPrice: string
      discountAmount: string
      vatAmount: string
      subtotal: string
    }>(sql`
      SELECT p.display_id AS "patientId", ti.display_id AS "id", ti.service_id AS "serviceId",
             co.display_id AS "clinicalOrderId", ti.quantity::text AS "quantity", ti.unit_price::text AS "unitPrice",
             ti.discount_amount::text AS "discountAmount", ti.vat_amount::text AS "vatAmount", ti.subtotal::text AS "subtotal"
      FROM group_bills gb
      JOIN transactions t ON t.id = gb.transaction_id AND t.tenant_id = gb.tenant_id
      JOIN transaction_items ti ON ti.transaction_id = t.id AND ti.tenant_id = t.tenant_id
      JOIN patients p ON p.id = COALESCE(ti.patient_id, t.patient_id) AND p.tenant_id = ti.tenant_id
      LEFT JOIN clinical_orders co ON co.id = ti.clinical_order_id AND co.tenant_id = ti.tenant_id
      WHERE gb.tenant_id = ${args.tenantId} AND gb.display_id = ${groupBillDisplayId} AND gb.deleted_at IS NULL
      ORDER BY ti.id ASC
    `)
    const paymentRows = await tx.execute<{
      id: string
      method: string
      amount: string
      referenceNumber: string | null
      receivedAt: string
      voidedAt: string | null
    }>(sql`
      SELECT p.display_id AS "id", p.method::text AS "method", p.amount::text AS "amount",
             p.reference_number AS "referenceNumber", p.received_at::text AS "receivedAt", p.voided_at::text AS "voidedAt"
      FROM group_bills gb
      JOIN payments p ON p.transaction_id = gb.transaction_id AND p.tenant_id = gb.tenant_id
      WHERE gb.tenant_id = ${args.tenantId} AND gb.display_id = ${groupBillDisplayId} AND gb.deleted_at IS NULL
      ORDER BY p.received_at ASC, p.id ASC
    `)

    return {
      ...header,
      patients: patientRows.map((patient) => ({
        patient: {
          id: patient.patientId,
          firstName: patient.firstName,
          lastName: patient.lastName,
        },
        encounterId: patient.encounterId,
        discount: patient.discountIdType
          ? { idType: patient.discountIdType, idNumber: patient.discountIdNumber }
          : null,
        items: itemRows
          .filter((item) => item.patientId === patient.patientId)
          .map(({ patientId: _patientId, ...item }) => item),
      })),
      payments: paymentRows,
    }
  })
}

export async function addGroupBillPayment(
  args: TenantCtx & {
    userId: number
    branchId: number | null
    moneyCaller: MoneyCallerContext
    groupBillDisplayId: string
    idempotencyKey?: string
    payment: GroupBillPaymentInput & { attestedById?: string; attestationPin?: string }
  },
) {
  const group = await loadGroupBillContext(args, args.groupBillDisplayId)
  return addPayment({
    tenantId: args.tenantId,
    userId: args.userId,
    branchId: args.branchId,
    moneyCaller: args.moneyCaller,
    transactionDisplayId: group.transactionId,
    method: args.payment.method as PaymentMethod,
    amount: args.payment.amount,
    referenceNumber: args.payment.referenceNumber,
    // Never accept a caller-provided payer on a group settlement: it must
    // resolve to the group bill's corporate payer every time.
    payerDisplayId: group.payerId,
    notes: args.payment.notes,
    attestedById: args.payment.attestedById,
    attestationPin: args.payment.attestationPin,
    idempotencyKey: args.idempotencyKey,
  })
}

export async function voidGroupBill(
  args: TenantCtx & {
    userId: number
    callerRole: string
    groupBillDisplayId: string
    reason: string
  },
) {
  const group = await loadGroupBillContext(args, args.groupBillDisplayId)
  const result = await voidTransaction({
    tenantId: args.tenantId,
    userId: args.userId,
    branchId: args.branchId,
    callerRole: args.callerRole,
    transactionDisplayId: group.transactionId,
    reason: args.reason,
  })
  if (result.status !== 'Voided') {
    throw new LifecycleError('Group bill did not enter the Voided state', 'INVALID_STATE', 409)
  }
  return { id: group.id, transactionId: group.transactionId, status: 'Voided' as const }
}
