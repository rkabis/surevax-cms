/**
 * Patient-account reads: balance, ledger, and the clinic-wide receivables
 * roll-up. Pure SELECTs; the writes (pay-on-account, credit draw) live in
 * `transactions/db.ts`, which owns the module-private payment internals.
 *
 * Every figure here is DERIVED. Nothing about a patient's balance is stored:
 * `amount_outstanding` is a GENERATED column per bill, and credit is
 * `amount_paid - SUM(draws funded by the deposit)`.
 */
import { sql } from 'drizzle-orm'
import { withTenantTx, type TenantCtx, type Tx } from '../../shared/db/withTenantTx.js'
import { toCents, fromCents } from '../../shared/utils/money.js'
import { LifecycleError } from '../transactions/db.js'
import { clinicCalendarDateString } from '../../shared/utils/clinicDate.js'

/**
 * What counts as a CHARGE against a patient.
 *
 * One definition, imported by all three readers, because the moment this drifts
 * the balance, the ledger, and the AR worklist stop agreeing. `is_prepayment`
 * is excluded because a deposit is a liability (money held), never a charge:
 * counting it would double-count once the credit is drawn against a real bill.
 *
 * Attribution note: this filters on `transactions.patient_id`, the bill-to
 * party. On a family bill the whole balance lands on the primary patient, since
 * the money columns live only on the header and `transaction_patients` has none.
 * Do NOT "fix" that by joining transaction_patients: payments hang off the
 * header, so there is nothing to apportion against. Corporate group bills are
 * different: their header remains technically patient-shaped for the shared
 * money engine, but payer AR owns the receivable, so every patient-account read
 * excludes transaction rows carrying a group_bills wrapper.
 */
const NOT_GROUP_BILL_PREDICATE = sql`
  NOT EXISTS (
    SELECT 1 FROM group_bills gb
    WHERE gb.transaction_id = t.id AND gb.tenant_id = t.tenant_id
  )
`

const CHARGE_PREDICATE = sql`
  t.deleted_at    IS NULL
  AND t.is_prepayment = false
  AND t.status        NOT IN ('Voided', 'Refunded')
  AND ${NOT_GROUP_BILL_PREDICATE}
`

/**
 * The OPEN subset of charges. `('Draft','Pending')` matches dashboard/db.ts
 * exactly, so `dashboard.unsettledTotal` and the AR total agree to the centavo.
 * That agreement is asserted in the integration tests.
 */
const OPEN_PREDICATE = sql`${CHARGE_PREDICATE} AND t.status IN ('Draft', 'Pending')`

type PatientRow = {
  id: number
  displayId: string
  mrn: string
  firstName: string
  lastName: string
  contactNumber: string | null
  address: string | null
  dateOfBirth: string | null
}

async function loadPatient(
  tx: Tx,
  tenantId: string,
  patientDisplayId: string,
): Promise<PatientRow> {
  const [row] = await tx.execute<PatientRow>(sql`
    SELECT p.id::int          AS "id",
           p.display_id       AS "displayId",
           p.mrn              AS "mrn",
           p.first_name       AS "firstName",
           p.last_name        AS "lastName",
           p.contact_number   AS "contactNumber",
           p.address          AS "address",
           p.date_of_birth::text AS "dateOfBirth"
    FROM patients p
    WHERE p.tenant_id = ${tenantId} AND p.display_id = ${patientDisplayId}
    LIMIT 1
  `)
  if (!row) throw new LifecycleError('Patient not found', 'NOT_FOUND', 404)
  return row
}

/**
 * Spendable credit, clamped PER DEPOSIT before summing.
 *
 * The per-row GREATEST matters: without it one over-drawn deposit would offset
 * another's balance and understate the credit available. Mirrors the JS clamp in
 * `getPatientCredit`.
 */
// A voided payment is a corrected-and-replaced row (the original stays for
// audit, a new row carries the fixed method/amount): it must not double-count
// alongside its replacement, so every draw-sum below excludes voided_at rows.
const CREDIT_REMAINING_SQL = sql`
  GREATEST(t.amount_paid - COALESCE((
    SELECT SUM(p.amount) FROM payments p
    WHERE p.funded_by_transaction_id = t.id AND p.tenant_id = t.tenant_id
      AND p.voided_at IS NULL
  ), 0), 0)
`

export type PatientBalance = {
  patient: { displayId: string; mrn: string; firstName: string; lastName: string }
  asOf: string
  grossOutstanding: string
  availableCredit: string
  netOutstanding: string
  creditOnAccount: string
  openBillCount: number
  oldestOpenBillDate: string | null
  oldestOpenBillAgeDays: number | null
  lastPaymentAt: string | null
  aging: { d0_30: string; d31_60: string; d61_90: string; d90plus: string }
  openBills: Array<{
    id: string
    transactedAt: string
    netAmount: string
    amountPaid: string
    amountOutstanding: string
    status: 'Draft' | 'Pending' | 'Paid' | 'Voided' | 'Refunded'
    itemCount: number
    ageDays: number
    isMultiPatient: boolean
  }>
  deposits: Array<{
    id: string
    depositAmount: string
    funded: string
    consumed: string
    remaining: string
    status: string
    createdAt: string
  }>
}

export async function getPatientBalance(
  args: TenantCtx & { patientDisplayId: string; asOf?: string },
): Promise<PatientBalance> {
  const asOf = args.asOf ?? clinicCalendarDateString()

  return withTenantTx(args, async (tx) => {
    const patient = await loadPatient(tx, args.tenantId, args.patientDisplayId)

    const billRows = await tx.execute<{
      id: string
      transactedAt: string
      netAmount: string
      amountPaid: string
      amountOutstanding: string
      status: 'Draft' | 'Pending' | 'Paid' | 'Voided' | 'Refunded'
      itemCount: number
      ageDays: number
      isMultiPatient: boolean
    }>(sql`
      SELECT t.display_id                          AS "id",
             t.transacted_at::text                 AS "transactedAt",
             t.net_amount::numeric(12,2)::text     AS "netAmount",
             t.amount_paid::numeric(12,2)::text    AS "amountPaid",
             t.amount_outstanding::numeric(12,2)::text AS "amountOutstanding",
             t.status                              AS "status",
             (SELECT COUNT(*)::int FROM transaction_items ti
                WHERE ti.transaction_id = t.id AND ti.tenant_id = t.tenant_id) AS "itemCount",
             (${asOf}::date - (t.transacted_at AT TIME ZONE 'Asia/Manila')::date)::int AS "ageDays",
             EXISTS (SELECT 1 FROM transaction_patients tp
                WHERE tp.transaction_id = t.id AND tp.patient_id <> t.patient_id) AS "isMultiPatient"
      FROM transactions t
      WHERE t.tenant_id = ${args.tenantId}
        AND t.patient_id = ${patient.id}
        AND ${OPEN_PREDICATE}
        AND t.amount_outstanding > 0
      ORDER BY t.transacted_at ASC, t.id ASC
    `)

    const depositRows = await tx.execute<{
      id: string
      depositAmount: string
      funded: string
      consumed: string
      remaining: string
      status: string
      createdAt: string
    }>(sql`
      SELECT t.display_id                       AS "id",
             t.net_amount::numeric(12,2)::text  AS "depositAmount",
             t.amount_paid::numeric(12,2)::text AS "funded",
             -- Same voided_at exclusion as CREDIT_REMAINING_SQL: a voided draw
             -- is a corrected-and-replaced row, not a second draw on the deposit.
             COALESCE((SELECT SUM(p.amount) FROM payments p
                WHERE p.funded_by_transaction_id = t.id AND p.tenant_id = t.tenant_id
                  AND p.voided_at IS NULL
             ), 0)::numeric(12,2)::text         AS "consumed",
             ${CREDIT_REMAINING_SQL}::numeric(12,2)::text AS "remaining",
             t.status                           AS "status",
             t.created_at::text                 AS "createdAt"
      FROM transactions t
      WHERE t.tenant_id = ${args.tenantId}
        AND t.patient_id = ${patient.id}
        AND t.deleted_at IS NULL
        AND t.is_prepayment = true
        AND t.status NOT IN ('Voided', 'Refunded')
      ORDER BY t.transacted_at ASC, t.id ASC
    `)

    // A voided payment was corrected and replaced by a new row, so it never
    // reads as "the last payment" once its replacement lands.
    const [lastPay] = await tx.execute<{ lastPaymentAt: string | null }>(sql`
      SELECT MAX(p.received_at)::text AS "lastPaymentAt"
      FROM payments p
      JOIN transactions t ON t.id = p.transaction_id AND t.tenant_id = p.tenant_id
      WHERE t.tenant_id = ${args.tenantId}
        AND t.patient_id = ${patient.id}
        AND t.deleted_at IS NULL
        AND t.status NOT IN ('Voided', 'Refunded')
        AND ${NOT_GROUP_BILL_PREDICATE}
        AND p.voided_at IS NULL
    `)

    // A legacy overpayment, or a payment whose charge falls beyond the
    // requested as-of boundary, is still patient value. New pay-on-account
    // flows bank excess as a dedicated prepayment transaction, but older or
    // imported rows may not. Derive that unapplied remainder rather than
    // letting amount_outstanding's zero floor erase it from the headline.
    const [unapplied] = await tx.execute<{ amount: string }>(sql`
      WITH per_transaction AS (
        SELECT t.id,
               CASE WHEN (t.transacted_at AT TIME ZONE 'Asia/Manila')::date <= ${asOf}::date
                    THEN t.net_amount ELSE 0 END AS visible_charge,
               COALESCE(SUM(p.amount) FILTER (
                 WHERE p.voided_at IS NULL
                   AND p.method <> 'Credit'
                   AND (p.received_at AT TIME ZONE 'Asia/Manila')::date <= ${asOf}::date
               ), 0) AS visible_payments
        FROM transactions t
        LEFT JOIN payments p
          ON p.transaction_id = t.id AND p.tenant_id = t.tenant_id
        WHERE t.tenant_id = ${args.tenantId}
          AND t.patient_id = ${patient.id}
          AND t.deleted_at IS NULL
          AND t.is_prepayment = false
          AND t.status NOT IN ('Voided', 'Refunded')
          AND ${NOT_GROUP_BILL_PREDICATE}
        GROUP BY t.id, t.transacted_at, t.net_amount
      )
      SELECT COALESCE(SUM(GREATEST(visible_payments - visible_charge, 0)), 0)
               ::numeric(12,2)::text AS amount
      FROM per_transaction
    `)

    const grossCents = billRows.reduce((s, b) => s + toCents(b.amountOutstanding), 0)
    const creditCents =
      depositRows.reduce((s, d) => s + toCents(d.remaining), 0) +
      toCents(unapplied?.amount ?? '0.00')

    const bucket = { d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 }
    for (const b of billRows) {
      const cents = toCents(b.amountOutstanding)
      if (b.ageDays <= 30) bucket.d0_30 += cents
      else if (b.ageDays <= 60) bucket.d31_60 += cents
      else if (b.ageDays <= 90) bucket.d61_90 += cents
      else bucket.d90plus += cents
    }

    const oldest = billRows[0] ?? null

    return {
      patient: {
        displayId: patient.displayId,
        mrn: patient.mrn,
        firstName: patient.firstName,
        lastName: patient.lastName,
      },
      asOf,
      grossOutstanding: fromCents(grossCents),
      availableCredit: fromCents(creditCents),
      netOutstanding: fromCents(Math.max(grossCents - creditCents, 0)),
      creditOnAccount: fromCents(Math.max(creditCents - grossCents, 0)),
      openBillCount: billRows.length,
      oldestOpenBillDate: oldest ? oldest.transactedAt.slice(0, 10) : null,
      oldestOpenBillAgeDays: oldest ? oldest.ageDays : null,
      lastPaymentAt: lastPay?.lastPaymentAt ?? null,
      aging: {
        d0_30: fromCents(bucket.d0_30),
        d31_60: fromCents(bucket.d31_60),
        d61_90: fromCents(bucket.d61_90),
        d90plus: fromCents(bucket.d90plus),
      },
      openBills: billRows,
      deposits: depositRows,
    }
  })
}

// ── Ledger ───────────────────────────────────────────────────────────────────

type LedgerKind = 'charge' | 'payment' | 'credit_draw' | 'deposit'

/** Deterministic ordering for events that share a timestamp. */
const KIND_RANK: Record<LedgerKind, number> = {
  charge: 0,
  payment: 1,
  credit_draw: 2,
  deposit: 3,
}

export type PatientLedgerRow = {
  key: string
  kind: LedgerKind
  occurredAt: string
  transactionId: string
  paymentId: string | null
  receiptNo: string | null
  branchSeq: number | null
  status: 'Draft' | 'Pending' | 'Paid' | 'Voided' | 'Refunded'
  description: string
  method: string | null
  debit: string
  credit: string
  balanceDue: string
  creditBalance: string
  affectsBalance: boolean
  isMultiPatient: boolean
  fundedByTransactionId: string | null
  /**
   * Set when the underlying payment itself was voided (a corrected-and-
   * replaced row), independent of the parent transaction's own status. The
   * row is kept in the statement so the correction is visible, but
   * `affectsBalance` is false and the UI should render it distinctly (e.g. a
   * "Voided" tag next to the payment) from a merely-Voided/Refunded bill.
   */
  paymentVoidedAt: string | null
}

export type PatientLedger = {
  patient: {
    displayId: string
    mrn: string
    firstName: string
    lastName: string
    contactNumber: string | null
    address: string | null
    dateOfBirth: string | null
  }
  branch: {
    code: string
    name: string
    address: string | null
    city: string | null
    province: string | null
    contactNumber: string | null
  } | null
  asOf: string
  generatedAt: string
  rows: PatientLedgerRow[]
  closingBalanceDue: string
  closingCreditBalance: string
  closingNetDue: string
  totalCharges: string
  totalPayments: string
  totalCreditDraws: string
  totalDeposits: string
  aging: { d0_30: string; d31_60: string; d61_90: string; d90plus: string }
  relatedBills: Array<{
    transactionId: string
    transactedAt: string
    billedToPatient: { displayId: string; firstName: string; lastName: string }
    patientSubtotal: string
    status: 'Draft' | 'Pending' | 'Paid' | 'Voided' | 'Refunded'
  }>
}

export async function getPatientLedger(
  args: TenantCtx & { patientDisplayId: string; asOf?: string; includeSettled?: boolean },
): Promise<PatientLedger> {
  const asOf = args.asOf ?? clinicCalendarDateString()
  const includeSettled = args.includeSettled ?? true

  return withTenantTx(args, async (tx) => {
    const patient = await loadPatient(tx, args.tenantId, args.patientDisplayId)

    /**
     * Four event legs.
     *
     * Voided and Refunded rows ARE selected, so the statement is honest about
     * what happened, but carry affectsBalance=false and move neither running
     * total. The deposit HEADER is deliberately not an event: only its funding
     * payments are, which avoids double-counting a partly-funded deposit and
     * dates the credit from when the money actually arrived.
     *
     * A voided PAYMENT (the row is corrected-and-replaced, `payments.voided_at`
     * set, independent of the parent transaction's own status) is kept on the
     * statement for the same "honest about what happened" reason, projected as
     * "paymentVoidedAt" below so the reducer can exclude it from every running
     * total without dropping the row. The charge leg has no payment, so it
     * always projects NULL.
     */
    const rows = await tx.execute<{
      kind: LedgerKind
      refId: string
      occurredAt: string
      transactionId: string
      paymentId: string | null
      receiptNo: string | null
      branchSeq: number | null
      status: 'Draft' | 'Pending' | 'Paid' | 'Voided' | 'Refunded'
      description: string
      method: string | null
      debit: string
      credit: string
      isMultiPatient: boolean
      fundedByTransactionId: string | null
      paymentVoidedAt: string | null
    }>(sql`
      -- charges: one row per non-deposit bill
      SELECT 'charge'::text                       AS "kind",
             ('t' || t.id::text)                  AS "refId",
             t.transacted_at::text                AS "occurredAt",
             t.display_id                         AS "transactionId",
             NULL::text                           AS "paymentId",
             t.receipt_no                         AS "receiptNo",
             t.branch_seq                         AS "branchSeq",
             t.status                             AS "status",
             CASE WHEN (SELECT COUNT(*) FROM transaction_items ti
                          WHERE ti.transaction_id = t.id) = 0
                  THEN 'Charge'
                  ELSE 'Charge (' || (SELECT COUNT(*)::text FROM transaction_items ti
                          WHERE ti.transaction_id = t.id) || ' items)'
             END                                  AS "description",
             NULL::text                           AS "method",
             t.net_amount::numeric(12,2)::text    AS "debit",
             '0.00'::text                         AS "credit",
             EXISTS (SELECT 1 FROM transaction_patients tp
                WHERE tp.transaction_id = t.id AND tp.patient_id <> t.patient_id) AS "isMultiPatient",
             NULL::text                           AS "fundedByTransactionId",
             NULL::text                           AS "paymentVoidedAt"
      FROM transactions t
      WHERE t.tenant_id = ${args.tenantId}
        AND t.patient_id = ${patient.id}
        AND t.deleted_at IS NULL
        AND t.is_prepayment = false
        AND ${NOT_GROUP_BILL_PREDICATE}
        AND (t.transacted_at AT TIME ZONE 'Asia/Manila')::date <= ${asOf}::date

      UNION ALL

      -- payments + credit draws against those bills
      SELECT CASE WHEN p.method = 'Credit' THEN 'credit_draw' ELSE 'payment' END AS "kind",
             ('p' || p.id::text)                  AS "refId",
             p.received_at::text                  AS "occurredAt",
             t.display_id                         AS "transactionId",
             p.display_id                         AS "paymentId",
             t.receipt_no                         AS "receiptNo",
             t.branch_seq                         AS "branchSeq",
             t.status                             AS "status",
             CASE WHEN p.method = 'Credit' THEN 'Credit applied' ELSE 'Payment' END AS "description",
             p.method::text                       AS "method",
             '0.00'::text                         AS "debit",
             p.amount::numeric(12,2)::text        AS "credit",
             false                                AS "isMultiPatient",
             (SELECT d.display_id FROM transactions d
                WHERE d.id = p.funded_by_transaction_id AND d.tenant_id = p.tenant_id) AS "fundedByTransactionId",
             p.voided_at::text                    AS "paymentVoidedAt"
      FROM payments p
      JOIN transactions t ON t.id = p.transaction_id AND t.tenant_id = p.tenant_id
      WHERE t.tenant_id = ${args.tenantId}
        AND t.patient_id = ${patient.id}
        AND t.deleted_at IS NULL
        AND t.is_prepayment = false
        AND ${NOT_GROUP_BILL_PREDICATE}
        AND (p.received_at AT TIME ZONE 'Asia/Manila')::date <= ${asOf}::date

      UNION ALL

      -- deposit fundings: money in, raises creditBalance (never a charge)
      SELECT 'deposit'::text                      AS "kind",
             ('p' || p.id::text)                  AS "refId",
             p.received_at::text                  AS "occurredAt",
             d.display_id                         AS "transactionId",
             p.display_id                         AS "paymentId",
             d.receipt_no                         AS "receiptNo",
             d.branch_seq                         AS "branchSeq",
             d.status                             AS "status",
             'Deposit received'::text             AS "description",
             p.method::text                       AS "method",
             '0.00'::text                         AS "debit",
             p.amount::numeric(12,2)::text        AS "credit",
             false                                AS "isMultiPatient",
             NULL::text                           AS "fundedByTransactionId",
             p.voided_at::text                    AS "paymentVoidedAt"
      FROM payments p
      JOIN transactions d ON d.id = p.transaction_id AND d.tenant_id = p.tenant_id
      WHERE d.tenant_id = ${args.tenantId}
        AND d.patient_id = ${patient.id}
        AND d.deleted_at IS NULL
        AND d.is_prepayment = true
        AND d.status NOT IN ('Voided', 'Refunded')
        AND p.method <> 'Credit'
        AND (p.received_at AT TIME ZONE 'Asia/Manila')::date <= ${asOf}::date
    `)

    const ordered = [...rows].sort((a, b) => {
      if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? -1 : 1
      const rank = KIND_RANK[a.kind] - KIND_RANK[b.kind]
      if (rank !== 0) return rank
      return a.refId < b.refId ? -1 : a.refId > b.refId ? 1 : 0
    })

    let balanceCents = 0
    let creditCents = 0
    let chargesCents = 0
    let paymentsCents = 0
    let drawsCents = 0
    let depositsCents = 0
    const remainingByTransaction = new Map<string, number>()
    const paymentBeforeCharge = new Map<string, number>()
    const creditDrawBeforeCharge = new Map<string, number>()

    const out: PatientLedgerRow[] = []
    for (const r of ordered) {
      // A voided payment is a corrected-and-replaced row (its replacement is
      // its own ledger row), so it must move no running total even when the
      // parent transaction's own status is untouched. The row still renders
      // (see the query comment above) so the correction is visible.
      const affectsBalance = r.status !== 'Voided' && r.status !== 'Refunded' && !r.paymentVoidedAt
      if (affectsBalance) {
        if (r.kind === 'charge') {
          const chargedCents = toCents(r.debit)
          const earlyPaymentCents = paymentBeforeCharge.get(r.transactionId) ?? 0
          const earlyDrawCents = creditDrawBeforeCharge.get(r.transactionId) ?? 0
          const externalAppliedCents = Math.min(chargedCents, earlyPaymentCents)
          const afterExternalCents = chargedCents - externalAppliedCents
          const drawAppliedCents = Math.min(afterExternalCents, earlyDrawCents)
          const remainingCents = afterExternalCents - drawAppliedCents

          // An external payment received before its dated charge was exposed
          // as credit at receipt time; consume only the portion allocated to
          // this transaction when the charge becomes visible.
          creditCents -= externalAppliedCents
          // A credit draw was reserved at receipt time. Return any impossible
          // surplus rather than losing patient value if imported data exceeds
          // the later-visible charge.
          creditCents += Math.max(earlyDrawCents - drawAppliedCents, 0)
          balanceCents += remainingCents
          remainingByTransaction.set(r.transactionId, remainingCents)
          chargesCents += chargedCents
        } else if (r.kind === 'payment') {
          const paidCents = toCents(r.credit)
          const remainingCents = remainingByTransaction.get(r.transactionId)
          if (remainingCents === undefined) {
            paymentBeforeCharge.set(
              r.transactionId,
              (paymentBeforeCharge.get(r.transactionId) ?? 0) + paidCents,
            )
            creditCents += paidCents
          } else {
            const appliedCents = Math.min(remainingCents, paidCents)
            balanceCents -= appliedCents
            remainingByTransaction.set(r.transactionId, remainingCents - appliedCents)
            creditCents += paidCents - appliedCents
          }
          paymentsCents += paidCents
        } else if (r.kind === 'credit_draw') {
          const drawCents = toCents(r.credit)
          const remainingCents = remainingByTransaction.get(r.transactionId)
          if (remainingCents === undefined) {
            creditDrawBeforeCharge.set(
              r.transactionId,
              (creditDrawBeforeCharge.get(r.transactionId) ?? 0) + drawCents,
            )
            creditCents -= drawCents
          } else {
            const appliedCents = Math.min(remainingCents, drawCents)
            balanceCents -= appliedCents
            creditCents -= appliedCents
            remainingByTransaction.set(r.transactionId, remainingCents - appliedCents)
          }
          drawsCents += drawCents
        } else {
          creditCents += toCents(r.credit)
          depositsCents += toCents(r.credit)
        }
      }

      out.push({
        key: `${r.kind}:${r.refId}`,
        kind: r.kind,
        occurredAt: r.occurredAt,
        transactionId: r.transactionId,
        paymentId: r.paymentId,
        receiptNo: r.receiptNo,
        branchSeq: r.branchSeq,
        status: r.status,
        description: r.description,
        method: r.method,
        debit: r.debit,
        credit: r.credit,
        balanceDue: fromCents(balanceCents),
        creditBalance: fromCents(creditCents),
        affectsBalance,
        isMultiPatient: r.isMultiPatient,
        fundedByTransactionId: r.fundedByTransactionId,
        paymentVoidedAt: r.paymentVoidedAt,
      })
    }

    // Aging/open-bill detail still comes from the balance reader. Closing
    // figures come from the ledger events themselves so payment-only and
    // legacy overpayment rows remain visible as unapplied credit rather than
    // disappearing behind generated amount_outstanding's zero floor.
    const balance = await getPatientBalance({ ...args, asOf })

    const [branch] = await tx.execute<{
      code: string
      name: string
      address: string | null
      city: string | null
      province: string | null
      contactNumber: string | null
    }>(sql`
      SELECT b.code, b.name, b.address, b.city, b.province,
             b.contact_number AS "contactNumber"
      FROM transactions t
      JOIN branches b ON b.id = t.branch_id
      WHERE t.tenant_id = ${args.tenantId}
        AND t.patient_id = ${patient.id}
        AND t.deleted_at IS NULL
        AND ${NOT_GROUP_BILL_PREDICATE}
      ORDER BY t.transacted_at DESC, t.id DESC
      LIMIT 1
    `)

    /**
     * Bills this patient is a member of but is not billed for. Outside every
     * running total on purpose: the money lives on the primary's header.
     */
    const relatedBills = await tx.execute<{
      transactionId: string
      transactedAt: string
      billedToDisplayId: string
      billedToFirstName: string
      billedToLastName: string
      patientSubtotal: string
      status: 'Draft' | 'Pending' | 'Paid' | 'Voided' | 'Refunded'
    }>(sql`
      SELECT t.display_id            AS "transactionId",
             t.transacted_at::text   AS "transactedAt",
             bp.display_id           AS "billedToDisplayId",
             bp.first_name           AS "billedToFirstName",
             bp.last_name            AS "billedToLastName",
             COALESCE((
               SELECT SUM(ti.subtotal) FROM transaction_items ti
               WHERE ti.transaction_id = t.id
                 AND COALESCE(ti.patient_id, t.patient_id) = ${patient.id}
             ), 0)::numeric(12,2)::text AS "patientSubtotal",
             t.status                AS "status"
      FROM transaction_patients tp
      JOIN transactions t ON t.id = tp.transaction_id AND t.tenant_id = tp.tenant_id
      JOIN patients bp ON bp.id = t.patient_id
      WHERE tp.tenant_id = ${args.tenantId}
        AND tp.patient_id = ${patient.id}
        AND t.patient_id <> ${patient.id}
        AND t.deleted_at IS NULL
        AND ${NOT_GROUP_BILL_PREDICATE}
        AND (t.transacted_at AT TIME ZONE 'Asia/Manila')::date <= ${asOf}::date
      ORDER BY t.transacted_at DESC, t.id DESC
    `)

    return {
      patient: {
        displayId: patient.displayId,
        mrn: patient.mrn,
        firstName: patient.firstName,
        lastName: patient.lastName,
        contactNumber: patient.contactNumber,
        address: patient.address,
        dateOfBirth: patient.dateOfBirth,
      },
      branch: branch ?? null,
      asOf,
      generatedAt: new Date().toISOString(),
      rows: includeSettled ? out : out.filter((r) => r.kind !== 'charge' || r.status !== 'Paid'),
      closingBalanceDue: fromCents(balanceCents),
      closingCreditBalance: fromCents(creditCents),
      closingNetDue: fromCents(Math.max(balanceCents - creditCents, 0)),
      totalCharges: fromCents(chargesCents),
      totalPayments: fromCents(paymentsCents),
      totalCreditDraws: fromCents(drawsCents),
      totalDeposits: fromCents(depositsCents),
      aging: balance.aging,
      relatedBills: relatedBills.map((r) => ({
        transactionId: r.transactionId,
        transactedAt: r.transactedAt,
        billedToPatient: {
          displayId: r.billedToDisplayId,
          firstName: r.billedToFirstName,
          lastName: r.billedToLastName,
        },
        patientSubtotal: r.patientSubtotal,
        status: r.status,
      })),
    }
  })
}

// ── Clinic-wide receivables ──────────────────────────────────────────────────

export type ReceivablesRow = {
  patient: {
    displayId: string
    mrn: string
    firstName: string
    lastName: string
    contactNumber: string | null
  }
  openBillCount: number
  oldestOpenBillDate: string
  oldestOpenBillAgeDays: number
  bucket: 'd0_30' | 'd31_60' | 'd61_90' | 'd90plus'
  grossOutstanding: string
  availableCredit: string
  netOutstanding: string
  aging: { d0_30: string; d31_60: string; d61_90: string; d90plus: string }
  lastPaymentAt: string | null
  branchCode: string | null
}

export type ReceivablesResult = {
  data: ReceivablesRow[]
  /** Computed over the unfiltered set, so the aging tab cannot move the KPIs. */
  totals: {
    patientCount: number
    filteredCount: number
    grossOutstanding: string
    availableCredit: string
    netOutstanding: string
    over30Count: number
    over30Total: string
    oldestAgeDays: number
    aging: { d0_30: string; d31_60: string; d61_90: string; d90plus: string }
  }
  asOf: string
  scope: 'branch' | 'tenant'
}

function bucketFor(ageDays: number): ReceivablesRow['bucket'] {
  if (ageDays <= 30) return 'd0_30'
  if (ageDays <= 60) return 'd31_60'
  if (ageDays <= 90) return 'd61_90'
  return 'd90plus'
}

export async function listReceivables(
  args: TenantCtx & {
    scope: 'branch' | 'tenant'
    q?: string
    bucket?: 'all' | 'd0_30' | 'd31_60' | 'd61_90' | 'd90plus'
    sort?: 'age' | 'amount' | 'name'
    order?: 'asc' | 'desc'
    limit?: number
    asOf?: string
  },
): Promise<ReceivablesResult> {
  const asOf = args.asOf ?? clinicCalendarDateString()
  const limit = args.limit ?? 200
  const order = args.order ?? 'desc'
  const sort = args.sort ?? 'age'

  // scope=tenant maps to branchId:null, which the RLS branch policy reads as
  // "no branch filter", the documented admin operational cross-branch read.
  // It emits no break-glass grant rows (that is reserved for PHI chart reveal).
  const ctx: TenantCtx = { ...args, branchId: args.scope === 'tenant' ? null : args.branchId }

  return withTenantTx(ctx, async (tx) => {
    // Defense-in-depth alongside the RLS branch policy (gotchas.md: both layers,
    // always). Omitted entirely for a tenant-wide read.
    const branchFilter =
      args.scope === 'branch' && args.branchId !== null
        ? sql` AND t.branch_id = ${args.branchId}`
        : sql``

    const search = args.q?.trim()
    const searchFilter = search
      ? sql` AND (pt.full_name ILIKE ${'%' + search + '%'} OR pt.mrn ILIKE ${'%' + search + '%'})`
      : sql``

    const rows = await tx.execute<{
      displayId: string
      mrn: string
      firstName: string
      lastName: string
      contactNumber: string | null
      branchCode: string | null
      openBillCount: number
      oldestOpenBillDate: string
      oldestOpenBillAgeDays: number
      grossOutstanding: string
      availableCredit: string
      netOutstanding: string
      d0_30: string
      d31_60: string
      d61_90: string
      d90plus: string
      lastPaymentAt: string | null
    }>(sql`
      WITH open_bills AS (
        SELECT t.patient_id, t.branch_id, t.transacted_at, t.amount_outstanding,
               (${asOf}::date - (t.transacted_at AT TIME ZONE 'Asia/Manila')::date)::int AS age_days
        FROM transactions t
        WHERE t.tenant_id = ${args.tenantId}
          AND ${OPEN_PREDICATE}
          AND t.amount_outstanding > 0${branchFilter}
      ),
      per_patient AS (
        SELECT patient_id,
               COUNT(*)::int                                                     AS open_bill_count,
               MIN(transacted_at)                                                AS oldest_at,
               MAX(age_days)::int                                                AS oldest_age_days,
               SUM(amount_outstanding)                                           AS gross,
               SUM(amount_outstanding) FILTER (WHERE age_days <= 30)             AS d0_30,
               SUM(amount_outstanding) FILTER (WHERE age_days BETWEEN 31 AND 60) AS d31_60,
               SUM(amount_outstanding) FILTER (WHERE age_days BETWEEN 61 AND 90) AS d61_90,
               SUM(amount_outstanding) FILTER (WHERE age_days > 90)              AS d90plus,
               (array_agg(branch_id ORDER BY transacted_at ASC))[1]              AS oldest_branch_id
        FROM open_bills GROUP BY patient_id
      ),
      credit AS (
        SELECT t.patient_id, SUM(${CREDIT_REMAINING_SQL})::numeric(12,2) AS available
        FROM transactions t
        WHERE t.tenant_id = ${args.tenantId}
          AND t.is_prepayment = true
          AND t.deleted_at IS NULL
          AND t.status NOT IN ('Voided', 'Refunded')
        GROUP BY t.patient_id
      ),
      -- A voided payment was corrected and replaced, so it never counts as
      -- "the last payment" once its replacement lands.
      last_pay AS (
        SELECT t.patient_id, MAX(p.received_at) AS last_payment_at
        FROM payments p
        JOIN transactions t ON t.id = p.transaction_id AND t.tenant_id = p.tenant_id
        WHERE t.tenant_id = ${args.tenantId}
          AND t.deleted_at IS NULL
          AND t.status NOT IN ('Voided', 'Refunded')
          AND ${NOT_GROUP_BILL_PREDICATE}
          AND p.voided_at IS NULL
        GROUP BY t.patient_id
      )
      SELECT pt.display_id        AS "displayId",
             pt.mrn               AS "mrn",
             pt.first_name        AS "firstName",
             pt.last_name         AS "lastName",
             pt.contact_number    AS "contactNumber",
             b.code               AS "branchCode",
             pp.open_bill_count   AS "openBillCount",
             (pp.oldest_at AT TIME ZONE 'Asia/Manila')::date::text AS "oldestOpenBillDate",
             pp.oldest_age_days   AS "oldestOpenBillAgeDays",
             pp.gross::numeric(12,2)::text AS "grossOutstanding",
             COALESCE(c.available, 0)::numeric(12,2)::text AS "availableCredit",
             GREATEST(pp.gross - COALESCE(c.available, 0), 0)::numeric(12,2)::text AS "netOutstanding",
             COALESCE(pp.d0_30, 0)::numeric(12,2)::text   AS "d0_30",
             COALESCE(pp.d31_60, 0)::numeric(12,2)::text  AS "d31_60",
             COALESCE(pp.d61_90, 0)::numeric(12,2)::text  AS "d61_90",
             COALESCE(pp.d90plus, 0)::numeric(12,2)::text AS "d90plus",
             lp.last_payment_at::text AS "lastPaymentAt"
      FROM per_patient pp
      JOIN patients pt ON pt.id = pp.patient_id
      LEFT JOIN branches b  ON b.id = pp.oldest_branch_id
      LEFT JOIN credit   c  ON c.patient_id = pp.patient_id
      LEFT JOIN last_pay lp ON lp.patient_id = pp.patient_id
      WHERE GREATEST(pp.gross - COALESCE(c.available, 0), 0) > 0${searchFilter}
      ORDER BY ${
        sort === 'name'
          ? sql`pt.last_name`
          : sort === 'amount'
            ? sql`pp.gross`
            : sql`pp.oldest_age_days`
      } ${order === 'asc' ? sql`ASC` : sql`DESC`}, pp.gross DESC
      LIMIT ${limit}
    `)

    const mapped: ReceivablesRow[] = rows.map((r) => ({
      patient: {
        displayId: r.displayId,
        mrn: r.mrn,
        firstName: r.firstName,
        lastName: r.lastName,
        contactNumber: r.contactNumber,
      },
      openBillCount: r.openBillCount,
      oldestOpenBillDate: r.oldestOpenBillDate,
      oldestOpenBillAgeDays: r.oldestOpenBillAgeDays,
      bucket: bucketFor(r.oldestOpenBillAgeDays),
      grossOutstanding: r.grossOutstanding,
      availableCredit: r.availableCredit,
      netOutstanding: r.netOutstanding,
      aging: { d0_30: r.d0_30, d31_60: r.d31_60, d61_90: r.d61_90, d90plus: r.d90plus },
      lastPaymentAt: r.lastPaymentAt,
      branchCode: r.branchCode,
    }))

    const filtered =
      args.bucket && args.bucket !== 'all' ? mapped.filter((r) => r.bucket === args.bucket) : mapped

    /**
     * Totals are computed over the UNFILTERED set, deliberately.
     *
     * The aging tab filters the table, not the KPI band. If totals followed the
     * bucket filter, clicking "90+" would silently redefine "Total outstanding"
     * to mean "outstanding in this bucket", and the operator would have no way to
     * see the clinic-wide figure. Same convention as the transactions list, whose
     * stats sidecar ignores the status pills.
     *
     * `over30*` is served rather than derived client-side so the KPI stays right
     * even when the table is filtered down to one band.
     */
    const totals = mapped.reduce(
      (acc, r) => {
        acc.gross += toCents(r.grossOutstanding)
        acc.credit += toCents(r.availableCredit)
        acc.net += toCents(r.netOutstanding)
        acc.d0_30 += toCents(r.aging.d0_30)
        acc.d31_60 += toCents(r.aging.d31_60)
        acc.d61_90 += toCents(r.aging.d61_90)
        acc.d90plus += toCents(r.aging.d90plus)
        if (r.oldestOpenBillAgeDays > 30) {
          acc.over30Count += 1
          acc.over30 += toCents(r.grossOutstanding)
        }
        return acc
      },
      {
        gross: 0,
        credit: 0,
        net: 0,
        d0_30: 0,
        d31_60: 0,
        d61_90: 0,
        d90plus: 0,
        over30: 0,
        over30Count: 0,
      },
    )

    return {
      data: filtered,
      totals: {
        // Every patient owing in scope, not just the rows the tab is showing.
        patientCount: mapped.length,
        // How many rows the current bucket filter left on the table.
        filteredCount: filtered.length,
        grossOutstanding: fromCents(totals.gross),
        availableCredit: fromCents(totals.credit),
        netOutstanding: fromCents(totals.net),
        over30Count: totals.over30Count,
        over30Total: fromCents(totals.over30),
        oldestAgeDays: mapped.reduce((m, r) => Math.max(m, r.oldestOpenBillAgeDays), 0),
        aging: {
          d0_30: fromCents(totals.d0_30),
          d31_60: fromCents(totals.d31_60),
          d61_90: fromCents(totals.d61_90),
          d90plus: fromCents(totals.d90plus),
        },
      },
      asOf,
      scope: args.scope,
    }
  })
}
