import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wallet, PiggyBank, FileText, Receipt, History } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table'
import { KpiStrip, KpiCell, TableCard, ListEmpty, ErrorBanner } from '@/components/layout'
import { DASH, formatMoney, formatDate } from '@/lib/format'
import { fromCents, toCents } from '@/lib/money'
import { TRANSACTION_STATUS_VARIANT, humanizeStatus } from '@/lib/status'
import {
  usePatientBalance,
  usePatientLedger,
  type PatientBalance,
  type PatientLedger,
} from '../accountApi'
import PayBalanceDialog from '@/features/transactions/components/PayBalancePanel'
import RecordDepositDialog from '@/features/transactions/components/RecordDepositDialog'
import { cn } from '@/lib/utils'

type OpenBill = PatientBalance['openBills'][number]
type Deposit = PatientBalance['deposits'][number]
type LedgerRow = PatientLedger['rows'][number]

const LEDGER_KIND_LABEL: Record<LedgerRow['kind'], string> = {
  charge: 'Charge',
  payment: 'Payment',
  credit_draw: 'Credit applied',
  deposit: 'Deposit',
}

const LEDGER_KIND_VARIANT: Record<LedgerRow['kind'], 'outline' | 'ok' | 'info' | 'default'> = {
  charge: 'outline',
  payment: 'ok',
  credit_draw: 'info',
  deposit: 'default',
}

/** Aging-bucket severity for an open bill's age, matching the aging buckets
 * already returned by the balance endpoint (d0_30 / d31_60 / d61_90 / d90plus). */
function billSeverity(ageDays: number): 'info' | 'due' | 'overdue' {
  if (ageDays > 60) return 'overdue'
  if (ageDays > 30) return 'due'
  return 'info'
}

type Props = {
  patientId: string
  patientName?: string
}

/**
 * Patient account tab: outstanding position, quick actions (pay balance,
 * record deposit, statement), the open-bills payment queue, the full
 * ledger, and credit on file. Rendered inside the `PatientDetail` Account
 * tab, so no `PageHeader` / `PageToolbar` chrome.
 */
export default function PatientAccountTab({ patientId, patientName }: Props) {
  const navigate = useNavigate()
  const balanceQuery = usePatientBalance(patientId)
  const ledgerQuery = usePatientLedger(patientId)
  const [payOpen, setPayOpen] = useState(false)
  const [depositOpen, setDepositOpen] = useState(false)

  if (balanceQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-8 w-28" />
        </div>
        <Skeleton className="h-48" />
      </div>
    )
  }

  const balance = balanceQuery.data
  if (balanceQuery.isError || !balance) {
    return <ErrorBanner message="Failed to load patient account." className="p-6" />
  }

  const ledger = ledgerQuery.data

  // Once the ledger resolves, drive the headline from its own authoritative
  // closing figures. The balance endpoint uses the same derivation server-side;
  // this prevents independently loaded surfaces from presenting contradictory
  // account positions during handoff.
  const grossCents = toCents(ledger?.closingBalanceDue ?? balance.grossOutstanding)
  const creditCents = toCents(ledger?.closingCreditBalance ?? balance.availableCredit)
  const signedNetCents = grossCents - creditCents
  const netOutstandingCents = Math.max(signedNetCents, 0)
  const creditOnAccountCents = Math.max(-signedNetCents, 0)

  // netOutstanding and creditOnAccount are two floored halves of one signed
  // figure (gross minus credit). Recombine them for a single "net position"
  // reading: positive means still owed after credit, negative means the
  // patient is carrying a credit surplus.
  const netValue =
    netOutstandingCents > 0
      ? formatMoney(fromCents(netOutstandingCents))
      : creditOnAccountCents > 0
        ? `-${formatMoney(fromCents(creditOnAccountCents))}`
        : formatMoney('0.00')
  const netTone = netOutstandingCents > 0 ? 'overdue' : creditOnAccountCents > 0 ? 'ok' : 'default'
  const netSubtitle =
    netOutstandingCents > 0
      ? 'Owed after credit'
      : creditOnAccountCents > 0
        ? 'Credit surplus'
        : 'Settled'

  const oldestValue =
    balance.openBillCount > 0 && balance.oldestOpenBillAgeDays != null
      ? `${balance.oldestOpenBillAgeDays}d`
      : DASH

  // Oldest-first so the table reads as the payment queue.
  const openBillsSorted = [...balance.openBills].sort(
    (a, b) => new Date(a.transactedAt).getTime() - new Date(b.transactedAt).getTime(),
  )

  return (
    <div className="space-y-4">
      {/* Position strip */}
      <Card className="overflow-hidden">
        <KpiStrip>
          <KpiCell
            label="Outstanding"
            value={formatMoney(fromCents(grossCents))}
            tone={grossCents > 0 ? 'overdue' : 'default'}
            subtitle={
              grossCents > 0
                ? `${balance.openBillCount} open bill${balance.openBillCount !== 1 ? 's' : ''}`
                : 'Nothing owed'
            }
          />
          <KpiCell
            label="Credit available"
            value={formatMoney(fromCents(creditCents))}
            tone={creditCents > 0 ? 'ok' : 'default'}
            subtitle={creditCents > 0 ? 'Available to apply' : 'None on file'}
          />
          <KpiCell label="Net position" value={netValue} tone={netTone} subtitle={netSubtitle} />
          <KpiCell
            label="Oldest unpaid"
            value={oldestValue}
            subtitle={
              balance.oldestOpenBillDate ? formatDate(balance.oldestOpenBillDate) : undefined
            }
          />
        </KpiStrip>
      </Card>

      {/* Action row */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="h-8 text-xs gap-1.5 px-3"
          onClick={() => setPayOpen(true)}
          disabled={grossCents <= 0}
        >
          <Wallet className="h-3.5 w-3.5" aria-hidden />
          Pay balance
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs gap-1.5 px-3"
          onClick={() => setDepositOpen(true)}
        >
          <PiggyBank className="h-3.5 w-3.5" aria-hidden />
          Record deposit
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs gap-1.5 px-3"
          onClick={() => navigate(`/patients/${patientId}/statement`)}
        >
          <FileText className="h-3.5 w-3.5" aria-hidden />
          Statement
        </Button>
      </div>

      {/* Open bills */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Open bills</h3>
        {openBillsSorted.length === 0 ? (
          <ListEmpty icon={Receipt} message="No open bills." />
        ) : (
          <TableCard>
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {openBillsSorted.map((bill: OpenBill) => (
                  <TableRow
                    key={bill.id}
                    data-severity={billSeverity(bill.ageDays)}
                    className="stripe cursor-pointer"
                    onClick={() => navigate(`/transactions?selected=${bill.id}`)}
                  >
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(bill.transactedAt)}
                    </TableCell>
                    <TableCell className="text-xs font-mono">{bill.id}</TableCell>
                    <TableCell className="text-xs font-mono tabular-nums">
                      {bill.ageDays}d
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums font-medium">
                      {formatMoney(bill.netAmount)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {formatMoney(bill.amountPaid)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-mono tabular-nums',
                        toCents(bill.amountOutstanding) > 0
                          ? 'font-medium text-triage-due'
                          : 'text-muted-foreground',
                      )}
                    >
                      {formatMoney(bill.amountOutstanding)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={TRANSACTION_STATUS_VARIANT[bill.status] ?? 'outline'}
                        className="text-xs"
                      >
                        {humanizeStatus(bill.status)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        )}
      </div>

      {/* Ledger */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Ledger</h3>
        {ledgerQuery.isLoading ? (
          <Skeleton className="h-40" />
        ) : ledgerQuery.isError || !ledger ? (
          <ErrorBanner message="Failed to load ledger." />
        ) : ledger.rows.length === 0 ? (
          <ListEmpty icon={History} message="No ledger activity yet." />
        ) : (
          <TableCard>
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">Running balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.rows.map((row: LedgerRow) => (
                  <TableRow key={row.key} className={cn(!row.affectsBalance && 'opacity-50')}>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(row.occurredAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={LEDGER_KIND_VARIANT[row.kind]} className="text-xs">
                        {LEDGER_KIND_LABEL[row.kind]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs font-mono">{row.transactionId}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {toCents(row.debit) > 0 ? formatMoney(row.debit) : DASH}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {toCents(row.credit) > 0 ? formatMoney(row.credit) : DASH}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums font-medium">
                      {formatSignedAccountPosition(row.balanceDue, row.creditBalance)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        )}
      </div>

      {/* Credit on file */}
      {creditCents > 0 && balance.deposits.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Credit on file</h3>
          <TableCard>
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead>Deposit</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Funded</TableHead>
                  <TableHead className="text-right">Consumed</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {balance.deposits.map((deposit: Deposit) => (
                  <TableRow key={deposit.id}>
                    <TableCell className="text-xs font-mono">{deposit.id}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(deposit.createdAt)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatMoney(deposit.funded)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {formatMoney(deposit.consumed)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums font-medium">
                      {formatMoney(deposit.remaining)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        </div>
      )}

      <PayBalanceDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        patientId={patientId}
        patientName={patientName}
      />
      <RecordDepositDialog
        open={depositOpen}
        onOpenChange={setDepositOpen}
        patientId={patientId}
        patientName={patientName}
      />
    </div>
  )
}

/** Signed convention: positive is owed; negative is unapplied patient credit. */
export function formatSignedAccountPosition(balanceDue: string, creditBalance: string): string {
  const signedCents = toCents(balanceDue) - toCents(creditBalance)
  return signedCents < 0
    ? `-${formatMoney(fromCents(Math.abs(signedCents)))}`
    : formatMoney(fromCents(signedCents))
}
