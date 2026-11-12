import { displayId } from '../../../shared/utils/displayId.js'
import { money, num, str, ts } from '../normalize.js'
import type { SrcChargeAccount, SrcImmunization, SrcTransaction } from '../types.js'
import type { TargetPayment, TargetTransaction, TargetTransactionItem } from '../targets.js'

/**
 * Transactions + Immunization → transactions + transaction_items + payments.
 *
 *   1. Link txns↔imms via the UNION of i_TransactionRef (inverse) and
 *      t_ImmunizationRef comma-list (forward; up to 80 items).
 *   2. Each txn → 1 header + N items + 1-5 payments (one per non-zero method).
 *   3. t_MiscPaymentType → payer_code; ChargeAccounts is only a derived
 *      per-item reconciliation overlay for the misc/partner payment.
 *
 * Discount mapping (existing schema, no lookup table):
 *   • Senior → OSCA; PWD → PWD; SoloParent/FullyPaid/QCID/DMCI/BFP/PPSV3 → Other
 *   • FullyPaid → discount_amount 200, number FULLY_PAID_COURSE
 *
 * NOTE (deep-dive, not yet folded in): the full 8-code discount map +
 * AyalaMalls-as-uplift are pending (DESIGN.md "not yet applied" §2/§4). This
 * version maps the original 4 codes; others fall through to null.
 *
 * t_TransactionValueNonService is a discount-base/component field. It is
 * already included in t_TransactionValue and must never be added to the
 * transaction header a second time.
 */

export type TransactionTransformResult = {
  transactions: TargetTransaction[]
  items: TargetTransactionItem[]
  payments: TargetPayment[]
  immunizationsInTxnList: Set<string>
  fullyPaidPatientLegacyIds: Set<string>
  unresolvedTransactions: Array<{ rowId: string; patientRef: string }>
  correctedPaymentTransactions: Array<{
    rowId: string
    rule: 'PAYMENT_LEGS_MATCH_FINAL_BILL' | 'EXPLICIT_ONE_CENT_SHORTFALL'
  }>
  unresolvedPaymentTransactions: Array<{
    rowId: string
    reason: 'PAYMENT_LEGS_DISAGREE_WITH_HEADER_AND_FINAL_BILL'
  }>
  unresolvedHeaderTransactions: Array<{
    rowId: string
    reason:
      | 'FINAL_BILL_FORMULA_DISAGREEMENT'
      | 'FULLY_PAID_DISCOUNT_NOT_MATERIALISED'
      | 'NEGATIVE_REFUND_REQUIRES_ORIGINAL_TRANSACTION'
      | 'NEGATIVE_PAYMENT_LEG_REQUIRES_REFUND_GRAPH'
  }>
}

const DISCOUNT_MAPPING: Record<
  string,
  { type: TargetTransaction['discountIdType']; number: string | null; fixedAmount?: number }
> = {
  Senior: { type: 'OSCA', number: 'SENIOR_LEGACY' },
  'Senior Citizen': { type: 'OSCA', number: 'SENIOR_LEGACY' },
  PWD: { type: 'PWD', number: 'PWD_LEGACY' },
  SoloParent: { type: 'Other', number: 'SOLO_PARENT' },
  'Solo Parent': { type: 'Other', number: 'SOLO_PARENT' },
  FullyPaid: { type: 'Other', number: 'FULLY_PAID_COURSE', fixedAmount: 200 },
}

const PAYMENT_COLUMNS: Array<{ col: keyof SrcTransaction; method: TargetPayment['method'] }> = [
  { col: 't_AmountPaid_Cash', method: 'Cash' },
  { col: 't_AmountPaid_GCash', method: 'GCash' },
  { col: 't_AmountPaid_BankTransfer', method: 'BankTransfer' },
  { col: 't_AmountPaid_PayMongo', method: 'PayMongo' },
  { col: 't_AmountPaid_Misc', method: 'Other' },
]

export function transformTransactions(
  txnSrc: SrcTransaction[],
  immSrc: SrcImmunization[],
  chargeSrc: SrcChargeAccount[],
  tenantSlug: string,
  serviceCodeByLegacyRef: ReadonlyMap<string, string>,
  validPatientLegacyIds?: ReadonlySet<string>,
): TransactionTransformResult {
  // forward: txn → imm ids (from t_ImmunizationRef list)
  const forwardMap = new Map<string, Set<string>>()
  for (const t of txnSrc) {
    const txnRowId = str(t['Row ID'])
    const ref = t.t_ImmunizationRef
    if (!txnRowId || !ref) continue
    const ids = String(ref)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (ids.length > 0) forwardMap.set(txnRowId, new Set(ids))
  }
  // inverse: imm → txn (from i_TransactionRef)
  const immBackref = new Map<string, string>()
  for (const i of immSrc) {
    const immRow = str(i['Row ID'])
    const txnRef = str(i.i_TransactionRef)
    if (immRow && txnRef) immBackref.set(immRow, txnRef)
  }
  // merged: txn → imm ids (union)
  const immsByTxn = new Map<string, Set<string>>()
  for (const [txnRowId, set] of forwardMap) immsByTxn.set(txnRowId, new Set(set))
  for (const [immRow, txnRef] of immBackref) {
    const s = immsByTxn.get(txnRef) ?? new Set<string>()
    s.add(immRow)
    immsByTxn.set(txnRef, s)
  }
  const immunizationsInTxnList = new Set<string>()
  for (const s of immsByTxn.values()) for (const x of s) immunizationsInTxnList.add(x)

  const immByRowId = new Map<string, SrcImmunization>()
  for (const i of immSrc) {
    const id = str(i['Row ID'])
    if (id) immByRowId.set(id, i)
  }
  const chargesByTxn = new Map<string, SrcChargeAccount[]>()
  for (const c of chargeSrc) {
    const id = str(c['Transaction ID'])
    if (!id) continue
    const charges = chargesByTxn.get(id) ?? []
    charges.push(c)
    chargesByTxn.set(id, charges)
  }

  const out: TransactionTransformResult = {
    transactions: [],
    items: [],
    payments: [],
    immunizationsInTxnList,
    fullyPaidPatientLegacyIds: new Set(),
    unresolvedTransactions: [],
    correctedPaymentTransactions: [],
    unresolvedPaymentTransactions: [],
    unresolvedHeaderTransactions: [],
  }

  for (const row of txnSrc) {
    const rowId = str(row['Row ID'])
    const patientRef = str(row.t_PatientRef)
    const branchRef = str(row.t_BranchRef)
    const txAt = ts(row.t_Timestamp)
    if (!rowId || !patientRef || !branchRef || !txAt) continue
    const patientFirst = patientRef.split(',')[0]!.trim()
    if (validPatientLegacyIds && !validPatientLegacyIds.has(patientFirst)) {
      out.unresolvedTransactions.push({ rowId, patientRef })
      continue
    }

    const gross = num(row.t_TransactionValue) ?? 0
    const adjustment = num(row.t_Adjustment) ?? 0
    const explicitTotal = num(row.t_TotalAmount)
    const sourceTotalPaid = num(row.t_TotalAmountPaid) ?? 0
    const discountRaw = str(row.t_DiscountRef)
    const mapping = discountRaw ? DISCOUNT_MAPPING[discountRaw] : null
    if (explicitTotal !== null && !nearlyEqual(explicitTotal, gross + adjustment)) {
      out.unresolvedHeaderTransactions.push({ rowId, reason: 'FINAL_BILL_FORMULA_DISAGREEMENT' })
      continue
    }
    if ((explicitTotal ?? gross + adjustment) < 0) {
      out.unresolvedHeaderTransactions.push({
        rowId,
        reason: 'NEGATIVE_REFUND_REQUIRES_ORIGINAL_TRANSACTION',
      })
      continue
    }
    if (mapping?.fixedAmount !== undefined && !nearlyEqual(adjustment, -mapping.fixedAmount)) {
      out.unresolvedHeaderTransactions.push({
        rowId,
        reason: 'FULLY_PAID_DISCOUNT_NOT_MATERIALISED',
      })
      continue
    }
    const discountAmount = adjustment < 0 ? -adjustment : 0

    // t_TotalAmount is the materialised final bill and equals
    // t_TransactionValue + t_Adjustment for 41,352/41,362 frozen rows. Preserve
    // that explicit source value; represent positive markups inside gross and
    // negative adjustments as a discount so gross - discount remains net.
    const net = explicitTotal ?? gross + adjustment
    const headerGross = gross + Math.max(adjustment, 0)
    const charges = chargesByTxn.get(rowId) ?? []
    const payerCode = mapPayerCode(str(row.t_MiscPaymentType))

    const rowPayments: TargetPayment[] = []
    for (const { col, method } of PAYMENT_COLUMNS) {
      const amt = num(row[col])
      if (amt === null || amt === 0) continue
      if (amt < 0) {
        out.unresolvedHeaderTransactions.push({
          rowId,
          reason: 'NEGATIVE_PAYMENT_LEG_REQUIRES_REFUND_GRAPH',
        })
        break
      }
      const ref = method === 'Other' ? (str(row.t_MiscPaymentType) ?? 'Misc') : null
      rowPayments.push({
        displayId: displayId('PMT'),
        tenantId: tenantSlug,
        transactionLegacyId: rowId,
        method,
        amount: amt.toFixed(2),
        referenceNumber: ref,
        reconciliationStatus: method === 'Other' ? reconciliationStatus(charges) : 'Cleared',
        receivedAt: txAt,
      })
    }
    if (out.unresolvedHeaderTransactions.at(-1)?.rowId === rowId) continue
    const paymentLegTotal = rowPayments.reduce((sum, payment) => sum + Number(payment.amount), 0)
    let totalPaid = sourceTotalPaid
    if (!nearlyEqual(paymentLegTotal, sourceTotalPaid)) {
      if (paymentLegTotal > 0 && nearlyEqual(paymentLegTotal, net)) {
        totalPaid = paymentLegTotal
        out.correctedPaymentTransactions.push({ rowId, rule: 'PAYMENT_LEGS_MATCH_FINAL_BILL' })
      } else if (
        Math.abs(paymentLegTotal - sourceTotalPaid) <= 0.011 &&
        /centavo|one cent|1 cent/i.test(str(row.t_Remarks) ?? '')
      ) {
        totalPaid = paymentLegTotal
        out.correctedPaymentTransactions.push({ rowId, rule: 'EXPLICIT_ONE_CENT_SHORTFALL' })
      } else {
        out.unresolvedPaymentTransactions.push({
          rowId,
          reason: 'PAYMENT_LEGS_DISAGREE_WITH_HEADER_AND_FINAL_BILL',
        })
        continue
      }
    }
    const isPaid = totalPaid >= net && net > 0

    out.transactions.push({
      displayId: displayId('TXN'),
      tenantId: tenantSlug,
      branchDisplayId: branchRef,
      patientLegacyId: patientFirst,
      cashierUserLegacyId: str(row.t_NurseRef),
      payerCode,
      status: isPaid ? 'Paid' : 'Pending',
      grossAmount: money(headerGross),
      discountAmount: money(discountAmount),
      vatAmount: '0.00',
      netAmount: money(net),
      amountPaid: money(totalPaid),
      discountIdType: mapping?.type ?? null,
      discountIdNumber: mapping?.number ?? null,
      transactedAt: txAt,
      legacyAppsheetId: rowId,
    })
    if (mapping?.number === 'FULLY_PAID_COURSE') out.fullyPaidPatientLegacyIds.add(patientFirst)

    const linkedImmIds = immsByTxn.get(rowId) ?? new Set()
    for (const immId of linkedImmIds) {
      const imm = immByRowId.get(immId)
      if (!imm) continue
      const vaccineRef = str(imm.i_VaccineRef)
      const serviceId = vaccineRef ? serviceCodeByLegacyRef.get(vaccineRef) : undefined
      if (!serviceId) continue
      const unit = num(imm.i_DosagePrice) ?? 0
      const qty = num(imm.i_DosageCount) ?? 1
      out.items.push({
        displayId: displayId('TXI'),
        tenantId: tenantSlug,
        transactionLegacyId: rowId,
        serviceId,
        clinicalOrderLegacyId: immId,
        quantity: qty.toFixed(2),
        unitPrice: unit.toFixed(2),
        subtotal: (unit * qty).toFixed(2),
        discountAmount: '0.00',
        vatAmount: '0.00',
        performedByUserLegacyId: null,
      })
    }

    out.payments.push(...rowPayments)
  }
  return out
}

function mapPayerCode(miscPaymentType: string | null): string | null {
  if (!miscPaymentType) return null
  const norm = miscPaymentType.toLowerCase()
  if (norm.includes('intellicare')) return 'PAYER_INTELLICARE'
  if (norm.includes('avega')) return 'PAYER_AVEGA'
  if (norm.includes('hati')) return 'PAYER_HATI_HEALTH'
  if (norm.includes('forticare')) return 'PAYER_FORTICARE'
  if (norm.includes('medasia') || norm.includes('llbi')) return 'PAYER_MEDASIA'
  if (norm.includes('philbritish')) return 'PAYER_PHILBRITISH'
  if (norm.includes('wellcare')) return 'PAYER_MWELL'
  if (norm.includes('ayala')) return 'PAYER_AYALA_MALLS'
  // Internal settlement and a named individual are not payer organisations.
  if (norm.includes('surevax') || norm.includes('luis sia')) return null
  return null
}

function reconciliationStatus(charges: SrcChargeAccount[]): string {
  if (charges.length === 0) return 'Pending'
  const statuses = charges.map((charge) =>
    mapReconciliationStatus(str(charge['Reconciliation Status'])),
  )
  if (statuses.some((status) => status === 'Mismatch')) return 'Mismatch'
  if (statuses.every((status) => status === 'Cleared')) return 'Cleared'
  return 'Pending'
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.005
}

function mapReconciliationStatus(s: string | null): string {
  if (!s) return 'Pending'
  if (/^OK$/i.test(s)) return 'Cleared'
  if (/MISMATCH/i.test(s)) return 'Mismatch'
  return s
}

export const __testing__ = {
  mapPayerCode,
  mapReconciliationStatus,
  reconciliationStatus,
  DISCOUNT_MAPPING,
  PAYMENT_COLUMNS,
}
