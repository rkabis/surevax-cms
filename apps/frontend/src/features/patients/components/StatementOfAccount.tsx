import type { PatientLedger } from '../accountApi'
import { DASH, formatLongDate, formatLongDateTime, formatMoney } from '@/lib/format'
import { toCents } from '@/lib/money'

// Pure presentational statement-of-account document. No data fetching here,
// see PatientStatementPage.tsx for the fetch + page shell. Modeled on the
// print-first idiom in features/transactions/components/AcknowledgementReceipt.tsx,
// but rendered with the app's theme tokens (font-mono tabular-nums for money,
// text-muted-foreground for de-emphasis) rather than hardcoded thermal-printer
// colors, since this is an A4 document, not an 80mm receipt.

type LedgerRow = PatientLedger['rows'][number]
type RelatedBill = PatientLedger['relatedBills'][number]

// The ledger endpoint takes only `asOf` and `includeSettled` query params,
// no period-start ("from") param, so `ledger.rows` always spans the
// patient's complete account history up to `asOf`. There is no prior,
// unshown balance to carry forward, so the opening balance is always 0.00.
const OPENING_BALANCE = '0.00'

export default function StatementOfAccount({ ledger }: { ledger: PatientLedger }) {
  const branch = ledger.branch
  const addressParts = [branch?.address, branch?.city, branch?.province].filter(Boolean)
  const clinicName = branch?.name ?? 'SureVax'
  const clinicAddress = addressParts.length > 0 ? addressParts.join(', ') : DASH
  const clinicPhone = branch?.contactNumber ?? DASH

  const hasClosingDue = toCents(ledger.closingBalanceDue) > 0
  const hasNetDue = toCents(ledger.closingNetDue) > 0

  return (
    <div className="statement-of-account text-xs text-foreground">
      {/* Clinic letterhead. Unlike TransactionDetail.branch (which carries
          `receipt.mode` + `receipt.bir` for BIR-registered branches, see
          receiptClinic.ts buildClinicInfo), the ledger contract's `branch`
          shape has no BIR receipt fields at all, so a statement can never
          tell whether the branch is BIR registered. It always renders as a
          plain, non-BIR letterhead, no TIN block, ever. */}
      <div className="text-center border-b-2 border-foreground pb-3 mb-3">
        <div className="text-base font-bold tracking-wide">{clinicName.toUpperCase()}</div>
        <div className="text-muted-foreground">{clinicAddress}</div>
        <div className="text-muted-foreground">{clinicPhone}</div>
      </div>

      <div className="text-center mb-4">
        <div className="text-lg font-bold tracking-wide">STATEMENT OF ACCOUNT</div>
        <div className="text-muted-foreground mt-1">
          As of {formatLongDate(ledger.asOf)}, generated {formatLongDateTime(ledger.generatedAt)}
        </div>
      </div>

      {/* Patient block */}
      <div className="grid grid-cols-2 gap-4 mb-4 pb-3 border-b border-border">
        <div>
          <div className="text-sm font-semibold">
            {ledger.patient.lastName}, {ledger.patient.firstName}
          </div>
          <div className="text-muted-foreground font-mono">
            MRN {ledger.patient.mrn ?? DASH} &middot; {ledger.patient.displayId}
          </div>
          <div className="mt-1">DOB: {formatLongDate(ledger.patient.dateOfBirth)}</div>
        </div>
        <div className="text-right">
          <div>{ledger.patient.contactNumber ?? DASH}</div>
          <div className="text-muted-foreground">{ledger.patient.address ?? DASH}</div>
        </div>
      </div>

      {/* Opening balance */}
      <div className="flex justify-between mb-2">
        <span className="text-muted-foreground">Opening balance</span>
        <span className="font-mono tabular-nums font-medium">{formatMoney(OPENING_BALANCE)}</span>
      </div>

      {/* Chronological ledger */}
      <table className="w-full border-collapse mb-4">
        <thead>
          <tr className="border-b-2 border-foreground text-left">
            <th className="py-1 pr-2 w-[10%] font-medium">Date</th>
            <th className="py-1 pr-2 w-[32%] font-medium">Description</th>
            <th className="py-1 pr-2 w-[20%] font-medium">Reference</th>
            <th className="py-1 pr-2 w-[12%] font-medium text-right">Charges</th>
            <th className="py-1 pr-2 w-[12%] font-medium text-right">Payments</th>
            <th className="py-1 w-[14%] font-medium text-right">Running balance</th>
          </tr>
        </thead>
        <tbody>
          {ledger.rows.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-center text-muted-foreground">
                No account activity on record.
              </td>
            </tr>
          )}
          {ledger.rows.map((row) => (
            <LedgerRowLine key={row.key} row={row} />
          ))}
        </tbody>
      </table>

      {/* Closing block */}
      <div className="grid grid-cols-3 gap-4 mb-4 pb-3 border-b border-border">
        <TotalCell
          label="Closing balance due"
          value={formatMoney(ledger.closingBalanceDue)}
          tone={hasClosingDue ? 'destructive' : 'default'}
          emphasize
        />
        <TotalCell label="Credit available" value={formatMoney(ledger.closingCreditBalance)} />
        <TotalCell
          label="Net due"
          value={formatMoney(ledger.closingNetDue)}
          tone={hasNetDue ? 'destructive' : 'default'}
          emphasize
        />
      </div>

      {/* Period totals, reconciles against the ledger table above */}
      <div className="grid grid-cols-4 gap-4 mb-4 pb-3 border-b border-border">
        <TotalCell label="Total charges" value={formatMoney(ledger.totalCharges)} />
        <TotalCell label="Total payments" value={formatMoney(ledger.totalPayments)} />
        <TotalCell label="Credit draws" value={formatMoney(ledger.totalCreditDraws)} />
        <TotalCell label="Deposits" value={formatMoney(ledger.totalDeposits)} />
      </div>

      {/* Aging summary */}
      <div className="mb-4 pb-3 border-b border-border">
        <div className="font-semibold uppercase tracking-wide text-muted-foreground mb-2 text-2xs">
          Aging summary
        </div>
        <div className="grid grid-cols-4 gap-4">
          <TotalCell label="0-30 days" value={formatMoney(ledger.aging.d0_30)} />
          <TotalCell label="31-60 days" value={formatMoney(ledger.aging.d31_60)} />
          <TotalCell label="61-90 days" value={formatMoney(ledger.aging.d61_90)} />
          <TotalCell
            label="90+ days"
            value={formatMoney(ledger.aging.d90plus)}
            tone={toCents(ledger.aging.d90plus) > 0 ? 'destructive' : 'default'}
          />
        </div>
      </div>

      {/* Related bills, dose given while billed on someone else's account
          (e.g. a guardian's bill for a child patient). Explicitly not part
          of the balance above. */}
      {ledger.relatedBills.length > 0 && (
        <div className="mb-4 pb-3 border-b border-border">
          <div className="font-semibold uppercase tracking-wide text-muted-foreground mb-1 text-2xs">
            Also treated on another patient's bill
          </div>
          <p className="text-muted-foreground mb-2 text-2xs">
            These amounts were billed to the patient named below, not to this account. They are not
            included in the balance shown above.
          </p>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-1 pr-2 w-[18%] font-medium">Date</th>
                <th className="py-1 pr-2 w-[42%] font-medium">Billed to</th>
                <th className="py-1 pr-2 w-[20%] font-medium text-right">Amount</th>
                <th className="py-1 w-[20%] font-medium text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {ledger.relatedBills.map((bill) => (
                <RelatedBillLine key={bill.transactionId} bill={bill} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Same wording as AcknowledgementReceipt.tsx's not-an-OR disclaimer */}
      <div className="border border-border rounded-md p-3 text-center mb-4">
        <div className="font-semibold mb-1">THIS IS NOT AN OFFICIAL RECEIPT</div>
        <div>Issued for acknowledgement only.</div>
        <div>An Official Receipt (BIR) is issued upon request.</div>
      </div>

      <div className="text-center text-muted-foreground text-2xs">
        Printed {formatLongDateTime(new Date())}
      </div>
    </div>
  )
}

function LedgerRowLine({ row }: { row: LedgerRow }) {
  const voided = !row.affectsBalance
  // A payment-method correction voids the original payment row (affectsBalance
  // false, same as a true void/refund) but the money never left the account,
  // it moved to the replacement payment. Tag it as superseded, not as money
  // that disappeared, so staff reading the statement don't mistake it for a
  // clawback.
  const corrected = !!row.paymentVoidedAt
  const reference = row.receiptNo ? `OR ${row.receiptNo}` : row.transactionId
  const referenceNote =
    row.branchSeq != null
      ? `Txn #${row.branchSeq}`
      : row.kind === 'credit_draw' && row.fundedByTransactionId
        ? `From deposit ${row.fundedByTransactionId}`
        : null
  const showStatus = row.kind === 'charge' && row.status !== 'Paid'

  return (
    <tr className={'border-b border-border/50 align-top' + (voided ? ' opacity-60' : '')}>
      <td className="py-1.5 pr-2 font-mono tabular-nums whitespace-nowrap">
        {formatLongDate(row.occurredAt)}
      </td>
      <td className="py-1.5 pr-2 break-words">
        <div className={voided ? 'line-through' : undefined}>{row.description}</div>
        {row.method && <div className="text-muted-foreground text-2xs">{row.method}</div>}
        {row.isMultiPatient && <div className="text-muted-foreground text-2xs">Family bill</div>}
        {voided && (
          <div
            className={corrected ? 'text-muted-foreground text-2xs' : 'text-destructive text-2xs'}
          >
            {corrected ? 'Corrected, replaced by a new payment' : 'Voided, excluded from balance'}
          </div>
        )}
      </td>
      <td className="py-1.5 pr-2 break-words">
        <div className="font-mono">{reference}</div>
        {referenceNote && <div className="text-muted-foreground text-2xs">{referenceNote}</div>}
        {showStatus && <div className="text-muted-foreground text-2xs">{row.status}</div>}
      </td>
      <td className="py-1.5 pr-2 text-right font-mono tabular-nums">
        {toCents(row.debit) > 0 ? formatMoney(row.debit) : DASH}
      </td>
      <td className="py-1.5 pr-2 text-right font-mono tabular-nums">
        {toCents(row.credit) > 0 ? formatMoney(row.credit) : DASH}
      </td>
      <td className="py-1.5 text-right font-mono tabular-nums font-medium">
        {formatMoney(row.balanceDue)}
        {toCents(row.creditBalance) > 0 && (
          <div className="text-muted-foreground font-normal text-2xs">
            Credit {formatMoney(row.creditBalance)}
          </div>
        )}
      </td>
    </tr>
  )
}

function RelatedBillLine({ bill }: { bill: RelatedBill }) {
  return (
    <tr className="border-b border-border/50">
      <td className="py-1 pr-2">{formatLongDate(bill.transactedAt)}</td>
      <td className="py-1 pr-2">
        {bill.billedToPatient.lastName}, {bill.billedToPatient.firstName}{' '}
        <span className="text-muted-foreground font-mono">({bill.billedToPatient.displayId})</span>
      </td>
      <td className="py-1 pr-2 text-right font-mono tabular-nums">
        {formatMoney(bill.patientSubtotal)}
      </td>
      <td className="py-1 text-right">{bill.status}</td>
    </tr>
  )
}

function TotalCell({
  label,
  value,
  tone = 'default',
  emphasize = false,
}: {
  label: string
  value: string
  tone?: 'default' | 'destructive'
  emphasize?: boolean
}) {
  return (
    <div>
      <div className="uppercase tracking-wide text-muted-foreground text-2xs">{label}</div>
      <div
        className={[
          'font-mono tabular-nums mt-0.5',
          emphasize ? 'text-sm font-bold' : 'font-medium',
          tone === 'destructive' ? 'text-destructive' : 'text-foreground',
        ].join(' ')}
      >
        {value}
      </div>
    </div>
  )
}
