import { useState } from 'react'
import { CreditCard, Ban, Undo2, Wallet, Printer, X, Pencil } from 'lucide-react'
import { DASH, formatDateTime, formatMoney } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTransaction, usePatientCredit, type TransactionDetail as TxnDetail } from '../api'
import AddPaymentDialog from './AddPaymentDialog'
import VoidDialog from './VoidDialog'
import RefundDialog from './RefundDialog'
import ApplyCreditDialog from './ApplyCreditDialog'
import CorrectPaymentMethodDialog from './CorrectPaymentMethodDialog'
import AcknowledgementReceipt from './AcknowledgementReceipt'
import PrintOptionsDialog from './PrintOptionsDialog'
import { buildClinicInfo } from '../receiptClinic'
import { useAuth } from '@/features/auth/context'
import { toCents } from '@/lib/money'
import { UserLabel } from '@/components/UserLabel'

type Props = {
  transactionId: string
}

import { TRANSACTION_STATUS_VARIANT as STATUS_VARIANT } from '@/lib/status'
import { ErrorBanner } from '@/components/layout'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'

/** Returns true if a stringified numeric value is a negative number (e.g. refund). */
function isNegativeMoney(val: string | null | undefined): boolean {
  if (val === null || val === undefined || val === '') return false
  const num = parseFloat(val)
  if (Number.isNaN(num)) return false
  return num < 0
}

function fmtQty(val: string | null | undefined): string {
  if (val === null || val === undefined || val === '') return DASH
  const num = parseFloat(val)
  if (Number.isNaN(num)) return DASH
  return num.toString()
}

function nullable<T>(v: T | null | undefined): string {
  if (v === null || v === undefined || v === '') return DASH
  return String(v)
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm break-words">{value ?? DASH}</p>
    </div>
  )
}

function SectionHeader({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h3
      id={id}
      className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3"
    >
      {children}
    </h3>
  )
}

function ItemsTable({ items, showPatient }: { items: TxnDetail['items']; showPatient?: boolean }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No line items.</p>
  }
  return (
    <div className="overflow-x-auto rounded border border-border">
      <Table className="w-full text-xs">
        <TableHeader className="bg-muted/50 text-muted-foreground">
          <TableRow>
            <TableHead className="text-left font-medium px-2">Service</TableHead>
            {showPatient && <TableHead className="text-left font-medium px-2">Patient</TableHead>}
            <TableHead className="text-right font-medium px-2">Qty</TableHead>
            <TableHead className="text-right font-medium px-2">Unit</TableHead>
            <TableHead className="text-right font-medium px-2">Disc</TableHead>
            <TableHead className="text-right font-medium px-2">VAT</TableHead>
            <TableHead className="text-right font-medium px-2">Subtotal</TableHead>
            <TableHead className="text-center font-medium px-2">Flags</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((it) => (
            <TableRow key={it.id} className="border-t border-border">
              <TableCell className="px-2">
                <div className="font-medium">{it.service?.name ?? DASH}</div>
                <div className="text-muted-foreground font-mono text-2xs">
                  {it.service?.code ?? DASH}
                  {it.service?.serviceType ? ` · ${it.service.serviceType}` : ''}
                </div>
              </TableCell>
              {showPatient && (
                <TableCell className="px-2">
                  {it.patient ? `${it.patient.lastName}, ${it.patient.firstName}` : DASH}
                </TableCell>
              )}
              <TableCell className="px-2 text-right font-mono">{fmtQty(it.quantity)}</TableCell>
              <TableCell className="px-2 text-right font-mono">
                {formatMoney(it.unitPrice)}
              </TableCell>
              <TableCell className="px-2 text-right font-mono">
                {formatMoney(it.discountAmount)}
              </TableCell>
              <TableCell className="px-2 text-right font-mono">
                {formatMoney(it.vatAmount)}
              </TableCell>
              <TableCell
                className={`px-2 py-1.5 text-right font-mono font-medium ${isNegativeMoney(it.subtotal) ? 'text-red-700 dark:text-red-400' : ''}`}
              >
                {formatMoney(it.subtotal)}
              </TableCell>
              <TableCell className="px-2 text-center">
                <div className="flex items-center justify-center gap-1">
                  {it.isVatExempt && (
                    <Badge variant="outline" className="text-2xs">
                      VAT-Ex
                    </Badge>
                  )}
                  {it.isPrepaid && (
                    <Badge variant="outline" className="text-2xs">
                      Prepaid
                    </Badge>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function PaymentsTable({
  payments,
  canCorrectAny,
  onCorrect,
}: {
  payments: TxnDetail['payments']
  /** False when the parent transaction is Voided/Refunded, no row offers the action. */
  canCorrectAny: boolean
  onCorrect: (payment: TxnDetail['payments'][number]) => void
}) {
  if (payments.length === 0) {
    return <p className="text-sm text-muted-foreground">No payments recorded.</p>
  }
  return (
    <div className="overflow-x-auto rounded border border-border">
      <Table className="w-full text-xs">
        <TableHeader className="bg-muted/50 text-muted-foreground">
          <TableRow>
            <TableHead className="text-left font-medium px-2">Method</TableHead>
            <TableHead className="text-right font-medium px-2">Amount</TableHead>
            <TableHead className="text-left font-medium px-2">Reference</TableHead>
            <TableHead className="text-left font-medium px-2">Received</TableHead>
            <TableHead className="text-left font-medium px-2">Payer</TableHead>
            <TableHead className="text-right font-medium px-2">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.map((p) => {
            const voided = !!p.voidedAt
            // A Credit row is a draw against patient credit, reissued only via
            // applyPrepayment. The backend refuses correct-method on it
            // (CREDIT_NOT_CORRECTABLE); don't offer the action at all.
            const canCorrect = canCorrectAny && !voided && p.method !== 'Credit'
            return (
              <TableRow
                key={p.id}
                className={`border-t border-border ${voided ? 'opacity-60' : ''}`}
              >
                <TableCell className="px-2">
                  <div className={voided ? 'line-through' : undefined}>{p.method}</div>
                  {voided && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="outline" className="text-2xs mt-0.5">
                          Corrected
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        {p.voidReason || 'Payment method was corrected.'}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell
                  className={`px-2 py-1.5 text-right font-mono font-medium ${voided ? 'line-through' : ''} ${isNegativeMoney(p.amount) ? 'text-red-700 dark:text-red-400' : ''}`}
                >
                  {formatMoney(p.amount)}
                </TableCell>
                <TableCell className="px-2 font-mono">{nullable(p.referenceNumber)}</TableCell>
                <TableCell className="px-2">{formatDateTime(p.receivedAt)}</TableCell>
                <TableCell className="px-2">
                  {p.payer ? (
                    <div>
                      <div>{p.payer.name}</div>
                      <div className="text-2xs text-muted-foreground">{p.payer.payerType}</div>
                    </div>
                  ) : (
                    DASH
                  )}
                </TableCell>
                <TableCell className="px-2 text-right">
                  {canCorrect && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 gap-1 px-2 text-2xs"
                      onClick={() => onCorrect(p)}
                    >
                      <Pencil className="h-3 w-3" aria-hidden />
                      Correct method
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

export default function TransactionDetail({ transactionId }: Props) {
  const { data: txn, isLoading, isError } = useTransaction(transactionId)
  const { user } = useAuth()
  const credit = usePatientCredit(txn?.patient?.id ?? null)
  const clinic = buildClinicInfo(txn, user)
  const [payOpen, setPayOpen] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const [refundOpen, setRefundOpen] = useState(false)
  const [applyOpen, setApplyOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [printOptionsOpen, setPrintOptionsOpen] = useState(false)
  const [correctingPayment, setCorrectingPayment] = useState<TxnDetail['payments'][number] | null>(
    null,
  )

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-32" />
        <Separator />
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      </div>
    )
  }

  if (isError || !txn) {
    return <ErrorBanner message="Failed to load transaction." className="p-6" />
  }

  const statusVariant = STATUS_VARIANT[txn.status] ?? 'outline'
  // Read the balance from the server, never recompute it. `amountPaid` is
  // maintained by the sync_transaction_amounts trigger and `amountOutstanding`
  // is a GENERATED column (net - paid, floored at 0), so these are the only
  // figures that can never drift from what the allocator and the aggregates see.
  const paidStr = txn.amountPaid
  const balanceStr = txn.amountOutstanding
  const balanceCents = toCents(balanceStr)
  const canAddPayment = txn.status !== 'Voided' && txn.status !== 'Refunded' && balanceCents > 0
  const canVoid = txn.status !== 'Voided' && txn.status !== 'Refunded'
  const canRefund = txn.status === 'Paid'
  const canCorrectPaymentMethod = txn.status !== 'Voided' && txn.status !== 'Refunded'
  // Credit is applicable whenever this bill still owes money and the patient
  // has drawable credit, keyed on the patient's id, never on a name match.
  const canApplyCredit = balanceCents > 0 && toCents(credit.data?.available) > 0

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold font-mono">{txn.id}</h2>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge variant={statusVariant} className="text-xs">
                  {txn.status}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {formatDateTime(txn.transactedAt)}
                </span>
                {txn.isPrepayment && (
                  <Badge variant="outline" className="text-xs">
                    Patient credit
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Void banner — surfaces void reason at the top so it's not buried in Lifecycle. */}
        {txn.status === 'Voided' && (
          <div
            role="status"
            aria-live="polite"
            className="rounded border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40 p-3 text-sm"
          >
            <p className="font-medium text-red-800 dark:text-red-200">Voided</p>
            {txn.voidedAt && (
              <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">
                {formatDateTime(txn.voidedAt)}
              </p>
            )}
            {txn.voidReason && (
              <p className="text-sm text-red-900 dark:text-red-100 mt-1 break-words">
                {txn.voidReason}
              </p>
            )}
          </div>
        )}

        <Separator />

        {/* Actions */}
        <section aria-label="Actions">
          <div className="flex flex-wrap items-center gap-2">
            {canAddPayment && (
              <Button size="sm" onClick={() => setPayOpen(true)} className="gap-1.5">
                <CreditCard className="h-3.5 w-3.5" aria-hidden />
                Add payment
              </Button>
            )}
            {canVoid && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setVoidOpen(true)}
                className="gap-1.5"
              >
                <Ban className="h-3.5 w-3.5" aria-hidden />
                Void
              </Button>
            )}
            {canRefund && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRefundOpen(true)}
                className="gap-1.5"
              >
                <Undo2 className="h-3.5 w-3.5" aria-hidden />
                Refund
              </Button>
            )}
            {canApplyCredit && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setApplyOpen(true)}
                className="gap-1.5"
              >
                <Wallet className="h-3.5 w-3.5" aria-hidden />
                Apply patient credit
              </Button>
            )}
            {!canAddPayment && !canVoid && !canRefund && !canApplyCredit && (
              <p className="text-xs text-muted-foreground">No further actions available.</p>
            )}
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setPrintOpen(true)}
            >
              <Printer className="h-3.5 w-3.5" aria-hidden />
              Print Receipt
            </Button>
          </div>
        </section>

        <Separator />

        {/* Amounts */}
        <section aria-labelledby="txn-amounts-heading">
          <SectionHeader id="txn-amounts-heading">Amounts</SectionHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
            <Field
              label="Gross"
              value={
                <span
                  className={`font-mono ${isNegativeMoney(txn.grossAmount) ? 'text-red-700 dark:text-red-400' : ''}`}
                >
                  {formatMoney(txn.grossAmount)}
                </span>
              }
            />
            <Field
              label="Discount"
              value={<span className="font-mono">{formatMoney(txn.discountAmount)}</span>}
            />
            <Field
              label="VAT"
              value={<span className="font-mono">{formatMoney(txn.vatAmount)}</span>}
            />
            <Field
              label="Net"
              value={
                <span
                  className={`font-mono font-medium ${isNegativeMoney(txn.netAmount) ? 'text-red-700 dark:text-red-400' : ''}`}
                >
                  {formatMoney(txn.netAmount)}
                </span>
              }
            />
            <Field
              label="Amount paid"
              value={<span className="font-mono">{formatMoney(paidStr)}</span>}
            />
            <Field
              label="Balance due"
              value={
                <span
                  className={`font-mono font-medium ${balanceCents > 0 ? 'text-triage-due' : ''}`}
                >
                  {formatMoney(balanceStr)}
                </span>
              }
            />
            <Field label="Discount ID type" value={nullable(txn.discountIdType)} />
            <Field label="Discount ID number" value={nullable(txn.discountIdNumber)} />
          </div>
        </section>

        <Separator />

        {/* Patients on the bill (multi-patient transactions) */}
        {txn.patients.length > 1 && (
          <>
            <section aria-labelledby="txn-patients-heading">
              <SectionHeader id="txn-patients-heading">
                Patients ({txn.patients.length})
              </SectionHeader>
              <div className="overflow-x-auto rounded border border-border">
                <Table className="w-full text-xs">
                  <TableHeader className="bg-muted/50 text-muted-foreground">
                    <TableRow>
                      <TableHead className="text-left font-medium px-2">Patient</TableHead>
                      <TableHead className="text-left font-medium px-2">Discount</TableHead>
                      <TableHead className="text-right font-medium px-2">Subtotal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {txn.patients.map((p) => (
                      <TableRow key={p.patient.id} className="border-t border-border">
                        <TableCell className="px-2">
                          {p.patient.lastName}, {p.patient.firstName}
                          <span className="text-muted-foreground font-mono text-2xs ml-1">
                            {p.patient.id}
                          </span>
                        </TableCell>
                        <TableCell className="px-2">
                          {p.discountIdType
                            ? `${p.discountIdType}${p.discountIdNumber ? ` · ${p.discountIdNumber}` : ''}`
                            : DASH}
                        </TableCell>
                        <TableCell className="px-2 text-right font-mono">
                          {formatMoney(p.subtotal)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
            <Separator />
          </>
        )}

        {/* Line items */}
        <section aria-labelledby="txn-items-heading">
          <SectionHeader id="txn-items-heading">Line Items ({txn.items.length})</SectionHeader>
          <ItemsTable items={txn.items} showPatient={txn.patients.length > 1} />
        </section>

        <Separator />

        {/* Payments */}
        <section aria-labelledby="txn-payments-heading">
          {/* Count the LIVE payments only. Superseded rows stay in the table so
              the correction is auditable, but counting them would say
              "Payments (2)" for one real payment, which is the same
              double-charge misread the struck-through styling exists to stop. */}
          <SectionHeader id="txn-payments-heading">
            Payments ({txn.payments.filter((p) => !p.voidedAt).length})
          </SectionHeader>
          <PaymentsTable
            payments={txn.payments}
            canCorrectAny={canCorrectPaymentMethod}
            onCorrect={setCorrectingPayment}
          />
        </section>

        <Separator />

        {/* Lifecycle */}
        <section aria-labelledby="txn-lifecycle-heading">
          <SectionHeader id="txn-lifecycle-heading">Lifecycle</SectionHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
            <Field label="Voided at" value={formatDateTime(txn.voidedAt)} />
            <Field label="Voided by" value={nullable(txn.voidedById)} />
            <Field label="Void reason" value={nullable(txn.voidReason)} />
            <Field label="Is prepayment" value={txn.isPrepayment ? 'Yes' : 'No'} />
            <Field label="Prepayment applied" value={formatDateTime(txn.prepaymentAppliedAt)} />
            <Field label="Deleted at" value={formatDateTime(txn.deletedAt)} />
          </div>
        </section>

        <Separator />

        {/* Parties */}
        <section aria-labelledby="txn-parties-heading">
          <SectionHeader id="txn-parties-heading">Parties</SectionHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
            <Field
              label="Patient"
              value={txn.patient ? `${txn.patient.lastName}, ${txn.patient.firstName}` : DASH}
            />
            <Field
              label="Payer"
              value={
                txn.payer ? (
                  <span>
                    {txn.payer.name}{' '}
                    <span className="text-xs text-muted-foreground">({txn.payer.payerType})</span>
                  </span>
                ) : (
                  DASH
                )
              }
            />
            <Field
              label="Cashier"
              value={txn.cashier ? `${txn.cashier.firstName} ${txn.cashier.lastName}` : DASH}
            />
            <Field label="Encounter" value={nullable(txn.encounterId)} />
          </div>
        </section>

        <Separator />

        {/* Audit */}
        <section aria-labelledby="txn-audit-heading">
          <SectionHeader id="txn-audit-heading">Audit</SectionHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
            <Field label="Created at" value={formatDateTime(txn.createdAt)} />
            <Field label="Updated at" value={formatDateTime(txn.updatedAt)} />
            <Field label="Created by" value={<UserLabel user={txn.createdBy} />} />
            <Field
              label="Transaction ID"
              value={<span className="font-mono text-xs">{txn.id}</span>}
            />
          </div>
        </section>
      </div>

      {/* Receipt print dialog */}
      <Dialog open={printOpen} onOpenChange={setPrintOpen}>
        <DialogContent className="max-w-sm p-0 gap-0">
          <style>{`
            @media print {
              body * { visibility: hidden; }
              .receipt-print-target, .receipt-print-target * { visibility: visible; }
              .receipt-print-target { position: fixed; top: 0; left: 0; padding: 8px; }
              @page { size: 80mm auto; margin: 4mm; }
            }
          `}</style>
          <DialogHeader className="px-4 pt-4 pb-3 border-b border-border print:hidden">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-sm">Receipt preview</DialogTitle>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setPrintOpen(false)}
              >
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          </DialogHeader>
          <div className="overflow-y-auto max-h-[70vh] p-4">
            <div className="receipt-print-target">
              <AcknowledgementReceipt transaction={txn} clinic={clinic} />
            </div>
          </div>
          <div className="px-4 py-3 border-t border-border flex justify-end print:hidden">
            <Button size="sm" className="gap-1.5" onClick={() => setPrintOptionsOpen(true)}>
              <Printer className="h-3.5 w-3.5" aria-hidden />
              Print…
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <PrintOptionsDialog
        open={printOptionsOpen}
        onOpenChange={setPrintOptionsOpen}
        transaction={txn}
        clinic={clinic}
        onStandardPrint={() => window.print()}
      />

      {/* Lifecycle dialogs */}
      <AddPaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        transactionId={txn.id}
        defaultAmount={balanceCents > 0 ? balanceStr : undefined}
        outstanding={balanceStr}
      />
      <VoidDialog open={voidOpen} onOpenChange={setVoidOpen} transactionId={txn.id} />
      <RefundDialog open={refundOpen} onOpenChange={setRefundOpen} transactionId={txn.id} />
      <ApplyCreditDialog
        open={applyOpen}
        onOpenChange={setApplyOpen}
        transactionId={txn.id}
        patientId={txn.patient.id}
        outstanding={balanceStr}
      />
      {correctingPayment && (
        <CorrectPaymentMethodDialog
          open={!!correctingPayment}
          onOpenChange={(open) => {
            if (!open) setCorrectingPayment(null)
          }}
          transactionId={txn.id}
          paymentId={correctingPayment.id}
          currentMethod={correctingPayment.method}
          currentReferenceNumber={correctingPayment.referenceNumber}
          amount={correctingPayment.amount}
        />
      )}
    </ScrollArea>
  )
}
