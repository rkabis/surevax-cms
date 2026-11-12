import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Building2, ChevronRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  DetailRail,
  DetailSheet,
  ErrorBanner,
  KpiCell,
  KpiStrip,
  ListEmpty,
  PageHeader,
  TableCard,
} from '@/components/layout'
import { formatDateTime, formatMoney } from '@/lib/format'
import { useGroupBills, type GroupBillListItem } from './api'

const STATUS_VARIANT: Record<GroupBillListItem['status'], 'ok' | 'due' | 'overdue' | 'outline'> = {
  Draft: 'outline',
  Pending: 'due',
  Paid: 'ok',
  Voided: 'overdue',
  Refunded: 'overdue',
}

function GroupBillDetail({ bill, onClose }: { bill: GroupBillListItem; onClose: () => void }) {
  const navigate = useNavigate()
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-lg font-semibold">{bill.id}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {bill.payer?.name ?? 'Corporate payer unavailable'}
          </p>
        </div>
        <Badge variant={STATUS_VARIANT[bill.status]}>{bill.status}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 rounded-md bg-muted px-4 py-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Listed total</p>
          <p className="font-mono tabular-nums font-medium">{formatMoney(bill.netAmount)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Outstanding AR</p>
          <p className="font-mono tabular-nums font-medium">
            {formatMoney(bill.amountOutstanding)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Patients</p>
          <p className="font-mono tabular-nums font-medium">{bill.patientCount}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Services</p>
          <p className="font-mono tabular-nums font-medium">{bill.itemCount}</p>
        </div>
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <span className="text-muted-foreground">Reference</span>
          <span className="font-mono">{bill.referenceNumber ?? '—'}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted-foreground">Created</span>
          <span>{formatDateTime(bill.createdAt)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted-foreground">Transaction</span>
          <span className="font-mono">{bill.transactionId}</span>
        </div>
      </div>
      <Button
        className="w-full"
        onClick={() => {
          onClose()
          navigate(`/transactions?selected=${encodeURIComponent(bill.transactionId)}`)
        }}
      >
        Open transaction — payment or void
      </Button>
      <p className="text-xs text-muted-foreground">
        Payments and reversals use the transaction record so existing attestation, approval, and
        audit controls remain in force.
      </p>
    </div>
  )
}

export default function GroupBillsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [scope, setScope] = useState<'open' | 'all'>(
    (searchParams.get('status') as 'open' | 'all') ?? 'open',
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { data, isLoading, isError } = useGroupBills(scope)
  const rows = useMemo(() => data?.data ?? [], [data?.data])
  const summary = data?.summary ?? {
    count: 0,
    netAmount: '0.00',
    amountPaid: '0.00',
    amountOutstanding: '0.00',
  }
  const selected = rows.find((row) => row.id === selectedId) ?? null

  useEffect(() => {
    const selectedParam = searchParams.get('selected')
    if (selectedParam && selectedParam !== selectedId) {
      setSelectedId(selectedParam)
      const next = new URLSearchParams(searchParams)
      next.delete('selected')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, selectedId, setSearchParams])

  function setStatus(next: 'open' | 'all') {
    setScope(next)
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous)
        if (next === 'open') params.delete('status')
        else params.set('status', next)
        return params
      },
      { replace: true },
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="Corporate group bills"
          description="One corporate payer across multiple patient services."
          actions={
            <Button asChild size="sm">
              <Link to="/group-bills/new">
                <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                New group bill
              </Link>
            </Button>
          }
        />
      </div>
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-b border-border bg-card">
        <KpiStrip>
          <KpiCell label="Open group bills" value={isLoading ? '—' : String(summary.count)} />
          <KpiCell
            label="Outstanding AR"
            value={formatMoney(summary.amountOutstanding)}
            tone="due"
          />
          <KpiCell label="Paid" value={formatMoney(summary.amountPaid)} tone="ok" />
        </KpiStrip>
      </div>
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-b border-border bg-card flex gap-2">
        <Button
          size="sm"
          variant={scope === 'open' ? 'default' : 'outline'}
          onClick={() => setStatus('open')}
        >
          Open
        </Button>
        <Button
          size="sm"
          variant={scope === 'all' ? 'default' : 'outline'}
          onClick={() => setStatus('all')}
        >
          All
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 xl:px-8 2xl:px-10 py-4">
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-11 w-full" />
            ))}
          </div>
        )}
        {isError && (
          <ErrorBanner
            message="Failed to load corporate group bills."
            className="py-12 justify-center"
          />
        )}
        {!isLoading && !isError && rows.length === 0 && (
          <ListEmpty
            icon={Building2}
            message={
              scope === 'open'
                ? 'No open corporate group bills.'
                : 'No corporate group bills found.'
            }
          />
        )}
        {!isLoading && !isError && rows.length > 0 && (
          <TableCard>
            <Table density="compact">
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead>Group bill</TableHead>
                  <TableHead>Payer</TableHead>
                  <TableHead className="text-right">Patients</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">AR</TableHead>
                  <TableHead className="w-[1.875rem]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((bill) => (
                  <TableRow
                    interactive
                    key={bill.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedId(bill.id)}
                  >
                    <TableCell>
                      <span className="font-mono text-xs">{bill.id}</span>
                      {bill.referenceNumber && (
                        <p className="text-xs text-muted-foreground">{bill.referenceNumber}</p>
                      )}
                    </TableCell>
                    <TableCell>{bill.payer?.name ?? '—'}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {bill.patientCount}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[bill.status]} className="text-2xs">
                        {bill.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatMoney(bill.netAmount)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatMoney(bill.amountPaid)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums font-medium">
                      {formatMoney(bill.amountOutstanding)}
                    </TableCell>
                    <TableCell>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        )}
      </div>
      <DetailRail open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DetailSheet width="standard">
          <SheetHeader className="px-6 pt-6 pb-2">
            <SheetTitle>Corporate group bill</SheetTitle>
            <SheetDescription>Payer receivable and transaction actions</SheetDescription>
          </SheetHeader>
          {selected ? (
            <GroupBillDetail bill={selected} onClose={() => setSelectedId(null)} />
          ) : (
            <ErrorBanner message="Group bill is not in the current view." className="p-6" />
          )}
        </DetailSheet>
      </DetailRail>
    </div>
  )
}
