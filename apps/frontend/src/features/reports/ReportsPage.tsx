import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Download, FileWarning, ReceiptText, Syringe } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sheet, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DetailSheet,
  ErrorBanner,
  KpiCell,
  KpiStrip,
  ListEmpty,
  PageHeader,
  PageToolbar,
  TableCard,
} from '@/components/layout'
import { Skeleton } from '@/components/ui/skeleton'
import { apiErrorMessage } from '@/lib/apiErrors'
import { clinicCalendarDateString } from '@/lib/clinicDate'
import { formatDate, formatDateTime, formatMoney } from '@/lib/format'
import {
  useArAging,
  useDailyRevenue,
  useDailyRevenueExport,
  usePaymentExceptions,
  useReportOptions,
  useUnbilled,
  type ArRow,
  type DailyRevenue,
  type DailyRevenueExport,
  type PaymentExceptionRow,
  type UnbilledRow,
} from './api'

type Tab = 'ar' | 'unbilled' | 'exceptions' | 'daily'
type Selected =
  | { kind: 'ar'; row: ArRow }
  | { kind: 'unbilled'; row: UnbilledRow }
  | { kind: 'exception'; row: PaymentExceptionRow }
const todayIso = () => clinicCalendarDateString()
const moneyCell = 'text-right font-mono tabular-nums whitespace-nowrap'

function downloadDailyCsv(data: DailyRevenueExport) {
  const blob = new Blob([data.csv], { type: data.contentType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = data.fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

function LoadingTable() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 7 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  )
}
function Pager({
  page,
  total,
  limit,
  onPage,
}: {
  page: number
  total: number
  limit: number
  onPage: (page: number) => void
}) {
  const lastPage = Math.max(1, Math.ceil(total / limit))
  if (total <= limit) return null
  return (
    <div className="flex items-center justify-end gap-2 pt-3">
      <span className="text-xs text-muted-foreground font-mono tabular-nums">
        Page {page} of {lastPage}
      </span>
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= lastPage}
        onClick={() => onPage(page + 1)}
      >
        Next
      </Button>
    </div>
  )
}

export default function ReportsPage() {
  const options = useReportOptions()
  const [tab, setTab] = useState<Tab>('ar')
  const [scope, setScope] = useState<'branch' | 'tenant'>('branch')
  const [branchId, setBranchId] = useState('')
  const [payerId, setPayerId] = useState('all')
  const [bucket, setBucket] = useState<'all' | 'd0_30' | 'd31_60' | 'd61_90' | 'd90plus'>('all')
  const [status, setStatus] = useState('all')
  const [date, setDate] = useState(todayIso)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [query, setQuery] = useState('')
  const [pages, setPages] = useState<Record<Tab, number>>({
    ar: 1,
    unbilled: 1,
    exceptions: 1,
    daily: 1,
  })
  const [selected, setSelected] = useState<Selected | null>(null)
  const dailyExport = useDailyRevenueExport()
  const canViewFinancial = options.data?.canViewFinancial ?? false

  useEffect(() => {
    if (options.data && !options.data.canViewFinancial) setTab('unbilled')
  }, [options.data])
  useEffect(() => {
    setPages({ ar: 1, unbilled: 1, exceptions: 1, daily: 1 })
  }, [scope, branchId, payerId, bucket, status, date, from, to, query])

  const common = { scope, ...(branchId ? { branchId } : {}), limit: 50 }
  const ar = useArAging(
    { ...common, page: pages.ar, asOf: date, bucket, ...(payerId !== 'all' ? { payerId } : {}) },
    tab === 'ar' && canViewFinancial,
  )
  const unbilled = useUnbilled(
    {
      ...common,
      page: pages.unbilled,
      ...(query ? { q: query } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    },
    tab === 'unbilled' && !!options.data,
  )
  const exceptions = usePaymentExceptions(
    {
      ...common,
      page: pages.exceptions,
      ...(payerId !== 'all' && payerId !== 'self-pay' ? { payerId } : {}),
      ...(status !== 'all'
        ? {
            status: status as
              | 'AwaitingReconciliation'
              | 'Disputed'
              | 'Failed'
              | 'Mismatch'
              | 'Pending',
          }
        : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    },
    tab === 'exceptions' && canViewFinancial,
  )
  // In branch scope, omitting branchId deliberately lets the backend resolve
  // the authenticated branch. Tenant scope still requires an explicit branch
  // because combining cash/deposit facts would conceal their provenance.
  const dailyHasBranch = scope === 'branch' || !!branchId
  const daily = useDailyRevenue(
    { scope: 'branch', ...(branchId ? { branchId } : {}), date },
    tab === 'daily' && canViewFinancial && dailyHasBranch,
  )
  const current =
    tab === 'ar' ? ar : tab === 'unbilled' ? unbilled : tab === 'exceptions' ? exceptions : daily

  if (options.isError)
    return (
      <div className="p-6">
        <PageHeader title="Reports" description="Revenue integrity" />
        <ErrorBanner
          className="mt-4"
          message={apiErrorMessage(options.error, 'Failed to load report permissions.')}
        />
      </div>
    )

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="Revenue integrity reports"
          description={
            options.data
              ? canViewFinancial
                ? 'Billed, unbilled, reconciled, and deposited facts.'
                : 'Branch clinical work that has no active billing link.'
              : 'Loading authorized report scope…'
          }
          actions={
            tab === 'daily' && daily.data ? (
              <Button
                variant="outline"
                size="sm"
                disabled={dailyExport.isPending}
                onClick={() =>
                  dailyExport.mutate(
                    { scope: 'branch', ...(branchId ? { branchId } : {}), date },
                    { onSuccess: downloadDailyCsv },
                  )
                }
              >
                <Download className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                {dailyExport.isPending ? 'Preparing audited CSV…' : 'Export daily CSV'}
              </Button>
            ) : undefined
          }
        />
      </div>

      {tab === 'daily' && dailyExport.isError && (
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 pt-4">
          <ErrorBanner
            message={apiErrorMessage(
              dailyExport.error,
              'The audited CSV could not be prepared. No file was downloaded.',
            )}
          />
        </div>
      )}

      <PageToolbar className="gap-2">
        {options.data?.allowedScopes.includes('tenant') && (
          <Select
            value={scope}
            onValueChange={(value) => {
              setScope(value as 'branch' | 'tenant')
              setBranchId('')
            }}
          >
            <SelectTrigger className="h-8 w-[10rem]" aria-label="Report scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="branch">One branch</SelectItem>
              <SelectItem value="tenant">All branches</SelectItem>
            </SelectContent>
          </Select>
        )}
        {options.data && (options.data.branches.length > 1 || scope === 'tenant') && (
          <Select
            value={branchId || (scope === 'tenant' ? 'all' : 'current')}
            onValueChange={(value) =>
              setBranchId(value === 'all' || value === 'current' ? '' : value)
            }
          >
            <SelectTrigger className="h-8 w-[13rem]" aria-label="Branch filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {scope === 'tenant' ? (
                <SelectItem value="all">All branches</SelectItem>
              ) : (
                <SelectItem value="current">My branch</SelectItem>
              )}
              {options.data.branches.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.code} · {branch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as Tab)
            setSelected(null)
          }}
          className="ml-auto"
        >
          <TabsList className="h-8">
            {canViewFinancial && (
              <TabsTrigger className="h-7 text-xs" value="ar">
                AR aging
              </TabsTrigger>
            )}
            <TabsTrigger className="h-7 text-xs" value="unbilled">
              Unbilled work
            </TabsTrigger>
            {canViewFinancial && (
              <TabsTrigger className="h-7 text-xs" value="exceptions">
                Payment exceptions
              </TabsTrigger>
            )}
            {canViewFinancial && (
              <TabsTrigger className="h-7 text-xs" value="daily">
                Daily summary
              </TabsTrigger>
            )}
          </TabsList>
        </Tabs>
      </PageToolbar>

      {canViewFinancial && tab === 'ar' && <ArKpis data={ar.data} loading={ar.isLoading} />}
      {tab === 'unbilled' && <UnbilledKpis data={unbilled.data} loading={unbilled.isLoading} />}
      {canViewFinancial && tab === 'exceptions' && (
        <ExceptionKpis data={exceptions.data} loading={exceptions.isLoading} />
      )}
      {canViewFinancial && tab === 'daily' && dailyHasBranch && (
        <DailyKpis data={daily.data} loading={daily.isLoading} />
      )}

      <PageToolbar className="gap-2">
        {tab === 'ar' && (
          <>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value || todayIso())}
              className="h-8 w-[10.5rem]"
              aria-label="AR as-of date"
            />
            <Select value={bucket} onValueChange={(value) => setBucket(value as typeof bucket)}>
              <SelectTrigger className="h-8 w-[10rem]" aria-label="Aging bucket">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All aging</SelectItem>
                <SelectItem value="d0_30">0-30 days</SelectItem>
                <SelectItem value="d31_60">31-60 days</SelectItem>
                <SelectItem value="d61_90">61-90 days</SelectItem>
                <SelectItem value="d90plus">90+ days</SelectItem>
              </SelectContent>
            </Select>
          </>
        )}
        {tab === 'unbilled' && (
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search patient, MRN, or service…"
            className="h-8 max-w-sm"
          />
        )}
        {(tab === 'unbilled' || tab === 'exceptions') && (
          <>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-8 w-[10.5rem]"
              aria-label="From date"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-8 w-[10.5rem]"
              aria-label="To date"
            />
          </>
        )}
        {canViewFinancial && (tab === 'ar' || tab === 'exceptions') && options.data && (
          <Select value={payerId} onValueChange={setPayerId}>
            <SelectTrigger className="h-8 w-[14rem]" aria-label="Responsible payer filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All responsible payers</SelectItem>
              {tab === 'ar' && <SelectItem value="self-pay">Patient / self-pay</SelectItem>}
              {options.data.payers.map((payer) => (
                <SelectItem key={payer.id} value={payer.id}>
                  {payer.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {tab === 'exceptions' && (
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 w-[13rem]" aria-label="Reconciliation status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All exceptions</SelectItem>
              <SelectItem value="AwaitingReconciliation">Awaiting reconciliation</SelectItem>
              <SelectItem value="Disputed">Disputed</SelectItem>
              <SelectItem value="Failed">Failed</SelectItem>
              <SelectItem value="Mismatch">Mismatch</SelectItem>
              <SelectItem value="Pending">Pending</SelectItem>
            </SelectContent>
          </Select>
        )}
        {tab === 'daily' && (
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value || todayIso())}
            className="h-8 w-[10.5rem]"
            aria-label="Daily summary date"
          />
        )}
      </PageToolbar>

      <ScrollArea className="flex-1">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4">
          {current.isLoading && <LoadingTable />}
          {current.isError && (
            <ErrorBanner
              message={apiErrorMessage(current.error, 'Failed to load report data.')}
              className="py-12 justify-center"
            />
          )}
          {!current.isLoading && !current.isError && tab === 'ar' && (
            <ArTable
              data={ar.data}
              onSelect={(row) => setSelected({ kind: 'ar', row })}
              onPage={(page) => setPages((old) => ({ ...old, ar: page }))}
            />
          )}
          {!current.isLoading && !current.isError && tab === 'unbilled' && (
            <UnbilledTable
              data={unbilled.data}
              onSelect={(row) => setSelected({ kind: 'unbilled', row })}
              onPage={(page) => setPages((old) => ({ ...old, unbilled: page }))}
            />
          )}
          {!current.isLoading && !current.isError && tab === 'exceptions' && (
            <ExceptionsTable
              data={exceptions.data}
              onSelect={(row) => setSelected({ kind: 'exception', row })}
              onPage={(page) => setPages((old) => ({ ...old, exceptions: page }))}
            />
          )}
          {!current.isLoading && !current.isError && tab === 'daily' && (
            <DailyTable data={daily.data} />
          )}
        </div>
      </ScrollArea>
      <ReportDetail
        selected={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      />
    </div>
  )
}

function KpiLoading() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <div className="p-3 space-y-2" key={i}>
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-28" />
        </div>
      ))}
    </>
  )
}
function KpiBand({ children }: { children: ReactNode }) {
  return (
    <div className="border-b border-border bg-card">
      <KpiStrip>{children}</KpiStrip>
    </div>
  )
}
function ArKpis({
  data,
  loading,
}: {
  data: ReturnType<typeof useArAging>['data']
  loading: boolean
}) {
  return (
    <KpiBand>
      {loading ? (
        <KpiLoading />
      ) : (
        <>
          <KpiCell
            label="Outstanding"
            value={formatMoney(data?.totals.outstanding)}
            tone="overdue"
          />
          <KpiCell label="Open invoices" value={String(data?.totals.invoiceCount ?? 0)} />
          <KpiCell label="Responsible payers" value={String(data?.totals.payerCount ?? 0)} />
          <KpiCell
            label="90+ days"
            value={formatMoney(data?.totals.aging.d90plus)}
            tone={Number(data?.totals.aging.d90plus ?? 0) > 0 ? 'overdue' : 'default'}
          />
        </>
      )}
    </KpiBand>
  )
}
function UnbilledKpis({
  data,
  loading,
}: {
  data: ReturnType<typeof useUnbilled>['data']
  loading: boolean
}) {
  return (
    <KpiBand>
      {loading ? (
        <KpiLoading />
      ) : (
        <>
          <KpiCell
            label="Unbilled administrations"
            value={String(data?.totals.count ?? 0)}
            tone={data?.totals.count ? 'overdue' : 'ok'}
          />
          <KpiCell
            label="Legacy recon signal"
            value={String(data?.totals.reconciliationRequiredCount ?? 0)}
            tone={data?.totals.reconciliationRequiredCount ? 'due' : 'default'}
          />
          <KpiCell label="Current page" value={String(data?.rows.length ?? 0)} />
          <KpiCell label="Scope" value={data?.scope === 'tenant' ? 'Tenant' : 'Branch'} />
        </>
      )}
    </KpiBand>
  )
}
function ExceptionKpis({
  data,
  loading,
}: {
  data: ReturnType<typeof usePaymentExceptions>['data']
  loading: boolean
}) {
  return (
    <KpiBand>
      {loading ? (
        <KpiLoading />
      ) : (
        <>
          <KpiCell
            label="Payment exceptions"
            value={String(data?.totals.count ?? 0)}
            tone={data?.totals.count ? 'overdue' : 'ok'}
          />
          <KpiCell
            label="Amount awaiting review"
            value={formatMoney(data?.totals.amount)}
            tone={data?.totals.count ? 'due' : 'default'}
          />
          <KpiCell label="Current page" value={String(data?.rows.length ?? 0)} />
          <KpiCell label="Scope" value={data?.scope === 'tenant' ? 'Tenant' : 'Branch'} />
        </>
      )}
    </KpiBand>
  )
}
function DailyKpis({ data, loading }: { data: DailyRevenue | undefined; loading: boolean }) {
  return (
    <KpiBand>
      {loading ? (
        <KpiLoading />
      ) : (
        <>
          <KpiCell
            label="Transaction net total"
            value={formatMoney(data?.revenue.transactionNetTotal)}
          />
          <KpiCell
            label="Tendered"
            value={formatMoney(
              data?.tenders.reduce((sum, row) => sum + Number(row.total), 0).toFixed(2),
            )}
          />
          <KpiCell label="Actual deposits" value={formatMoney(data?.deposits.total)} />
          <KpiCell
            label="Drawer variance"
            value={formatMoney(data?.drawer.variance)}
            tone={Number(data?.drawer.variance ?? 0) === 0 ? 'ok' : 'overdue'}
          />
        </>
      )}
    </KpiBand>
  )
}

function ArTable({
  data,
  onSelect,
  onPage,
}: {
  data: ReturnType<typeof useArAging>['data']
  onSelect: (row: ArRow) => void
  onPage: (page: number) => void
}) {
  if (!data?.rows.length)
    return (
      <ListEmpty
        icon={ReceiptText}
        message="No open receivables match these branch, payer, and aging filters."
      />
    )
  return (
    <>
      <TableCard>
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10">
            <TableRow>
              <TableHead>Responsible payer</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead className="text-right">Invoices</TableHead>
              <TableHead className="text-right">0-30</TableHead>
              <TableHead className="text-right">31-60</TableHead>
              <TableHead className="text-right">61-90</TableHead>
              <TableHead className="text-right">90+</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => (
              <TableRow
                key={`${row.branch.id}:${row.responsiblePayer?.id ?? 'self-pay'}`}
                className="cursor-pointer"
                onClick={() => onSelect(row)}
              >
                <TableCell className="font-medium">
                  {row.responsiblePayer?.name ?? 'Patient / self-pay'}
                  <p className="text-xs text-muted-foreground">
                    {row.responsiblePayer?.type ?? 'Direct responsibility'}
                  </p>
                </TableCell>
                <TableCell>
                  {row.branch.code}
                  <p className="text-xs text-muted-foreground">{row.branch.name}</p>
                </TableCell>
                <TableCell className={moneyCell}>{row.invoiceCount}</TableCell>
                <TableCell className={moneyCell}>{formatMoney(row.aging.d0_30)}</TableCell>
                <TableCell className={moneyCell}>{formatMoney(row.aging.d31_60)}</TableCell>
                <TableCell className={moneyCell}>{formatMoney(row.aging.d61_90)}</TableCell>
                <TableCell className={moneyCell}>{formatMoney(row.aging.d90plus)}</TableCell>
                <TableCell className={`${moneyCell} font-semibold`}>
                  {formatMoney(row.outstanding)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
      <Pager
        page={data.pagination.page}
        total={data.pagination.total}
        limit={data.pagination.limit}
        onPage={onPage}
      />
    </>
  )
}
function UnbilledTable({
  data,
  onSelect,
  onPage,
}: {
  data: ReturnType<typeof useUnbilled>['data']
  onSelect: (row: UnbilledRow) => void
  onPage: (page: number) => void
}) {
  if (!data?.rows.length)
    return (
      <ListEmpty
        icon={Syringe}
        message="No completed clinical work is missing an active billing link."
      />
    )
  return (
    <>
      <TableCard>
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10">
            <TableRow>
              <TableHead>Patient</TableHead>
              <TableHead>Service</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Completed</TableHead>
              <TableHead>Administered by</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => (
              <TableRow
                key={row.orderId}
                data-severity={row.reconciliationRequired ? 'overdue' : 'due'}
                className="stripe cursor-pointer"
                onClick={() => onSelect(row)}
              >
                <TableCell className="font-medium">
                  {row.patient.name}
                  <p className="text-xs text-muted-foreground font-mono">{row.patient.mrn}</p>
                </TableCell>
                <TableCell>
                  {row.serviceName}
                  <p className="text-xs text-muted-foreground font-mono">{row.orderId}</p>
                </TableCell>
                <TableCell>{row.branch.code}</TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatDateTime(row.completedAt)}
                </TableCell>
                <TableCell>{row.administeredByName ?? 'Not recorded'}</TableCell>
                <TableCell>
                  <Badge variant={row.reconciliationRequired ? 'overdue' : 'due'}>
                    {row.reason}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
      <Pager
        page={data.pagination.page}
        total={data.pagination.total}
        limit={data.pagination.limit}
        onPage={onPage}
      />
    </>
  )
}
function ExceptionsTable({
  data,
  onSelect,
  onPage,
}: {
  data: ReturnType<typeof usePaymentExceptions>['data']
  onSelect: (row: PaymentExceptionRow) => void
  onPage: (page: number) => void
}) {
  if (!data?.rows.length)
    return (
      <ListEmpty
        icon={FileWarning}
        message="No live payments require reconciliation for these filters."
      />
    )
  return (
    <>
      <TableCard>
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10">
            <TableRow>
              <TableHead>Payment</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Responsible payer</TableHead>
              <TableHead>Method / reference</TableHead>
              <TableHead>Received</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => (
              <TableRow
                key={row.paymentId}
                data-severity={
                  row.status === 'Failed' || row.status === 'Disputed' || row.status === 'Mismatch'
                    ? 'overdue'
                    : 'due'
                }
                className="stripe cursor-pointer"
                onClick={() => onSelect(row)}
              >
                <TableCell className="font-mono text-xs">
                  {row.paymentId}
                  <p className="text-muted-foreground">{row.branch.code}</p>
                </TableCell>
                <TableCell>
                  {row.patient.name}
                  <p className="text-xs text-muted-foreground font-mono">{row.patient.mrn}</p>
                </TableCell>
                <TableCell>{row.responsiblePayer?.name ?? 'Patient / self-pay'}</TableCell>
                <TableCell>
                  {row.method}
                  <p className="text-xs text-muted-foreground font-mono">
                    {row.referenceNumber ?? 'No reference'}
                  </p>
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatDate(row.receivedAt)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      row.status === 'Failed' ||
                      row.status === 'Disputed' ||
                      row.status === 'Mismatch'
                        ? 'overdue'
                        : 'due'
                    }
                  >
                    {row.status.replace(/([A-Z])/g, ' $1').trim()}
                  </Badge>
                </TableCell>
                <TableCell className={`${moneyCell} font-semibold`}>
                  {formatMoney(row.amount)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
      <Pager
        page={data.pagination.page}
        total={data.pagination.total}
        limit={data.pagination.limit}
        onPage={onPage}
      />
    </>
  )
}
function DailyTable({ data }: { data: DailyRevenue | undefined }) {
  if (!data)
    return (
      <ListEmpty icon={AlertTriangle} message="Select a branch to load its daily revenue truth." />
    )
  if (!data.revenue.transactionCount && !data.tenders.length && !data.deposits.count)
    return (
      <ListEmpty
        icon={ReceiptText}
        message="No revenue, tender, or deposit activity exists for this branch and date."
      />
    )
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Tender by method</h2>
        <p className="text-xs text-muted-foreground mb-2">
          Live non-voided payments attached to the day’s financial headers.
        </p>
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Payments</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.tenders.map((row) => (
                <TableRow key={row.method}>
                  <TableCell>{row.method}</TableCell>
                  <TableCell className={moneyCell}>{row.count}</TableCell>
                  <TableCell className={moneyCell}>{formatMoney(row.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Fact
          label="Actual bank deposits"
          value={formatMoney(data.deposits.total)}
          note={`${data.deposits.count} non-voided deposit record${data.deposits.count === 1 ? '' : 's'}`}
        />
        <Fact
          label="Drawer declared"
          value={formatMoney(data.drawer.declaredTotal)}
          note={`${data.drawer.sessionCount} drawer session${data.drawer.sessionCount === 1 ? '' : 's'}`}
        />
        <Fact
          label="Unsettled revenue"
          value={formatMoney(data.revenue.outstanding)}
          note="Authoritative transaction-header balance"
        />
      </div>
    </div>
  )
}
function Fact({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="eyebrow">{label}</p>
      <p className="text-xl font-semibold font-mono tabular-nums mt-1">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{note}</p>
    </div>
  )
}

function ReportDetail({
  selected,
  onOpenChange,
}: {
  selected: Selected | null
  onOpenChange: (open: boolean) => void
}) {
  const title =
    selected?.kind === 'ar'
      ? (selected.row.responsiblePayer?.name ?? 'Patient / self-pay')
      : selected?.kind === 'unbilled'
        ? selected.row.serviceName
        : selected?.row.paymentId
  return (
    <Sheet open={!!selected} onOpenChange={onOpenChange}>
      <DetailSheet width="narrow">
        <SheetHeader className="px-6 py-4 border-b border-border">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {selected?.kind === 'ar'
              ? 'Responsible payer and aging facts'
              : selected?.kind === 'unbilled'
                ? 'Completed clinical work without active billing'
                : 'Payment reconciliation exception'}
          </SheetDescription>
        </SheetHeader>
        {selected && (
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
            {selected.kind === 'ar' ? (
              <>
                <Fact
                  label="Outstanding"
                  value={formatMoney(selected.row.outstanding)}
                  note={`${selected.row.invoiceCount} invoices · ${selected.row.patientCount} patients`}
                />
                <Fact
                  label="Oldest invoice"
                  value={`${selected.row.oldestAgeDays} days`}
                  note={`${selected.row.branch.code} · ${selected.row.branch.name}`}
                />
              </>
            ) : selected.kind === 'unbilled' ? (
              <>
                <Fact
                  label="Patient"
                  value={selected.row.patient.name}
                  note={`${selected.row.patient.mrn} · ${selected.row.patient.id}`}
                />
                <Fact
                  label="Completed"
                  value={formatDateTime(selected.row.completedAt)}
                  note={selected.row.administeredByName ?? 'Administering staff not recorded'}
                />
                <Badge variant={selected.row.reconciliationRequired ? 'overdue' : 'due'}>
                  {selected.row.reason}
                </Badge>
              </>
            ) : (
              <>
                <Fact
                  label="Amount"
                  value={formatMoney(selected.row.amount)}
                  note={`${selected.row.method} · ${selected.row.referenceNumber ?? 'No reference'}`}
                />
                <Fact
                  label="Patient"
                  value={selected.row.patient.name}
                  note={`${selected.row.patient.mrn} · ${selected.row.transactionId}`}
                />
                <Badge
                  variant={
                    selected.row.status === 'Failed' ||
                    selected.row.status === 'Disputed' ||
                    selected.row.status === 'Mismatch'
                      ? 'overdue'
                      : 'due'
                  }
                >
                  {selected.row.status}
                </Badge>
                <p className="text-xs text-muted-foreground">
                  Responsible payer: {selected.row.responsiblePayer?.name ?? 'Patient / self-pay'}.
                  Tender payer: {selected.row.tenderPayer?.name ?? 'Not assigned'}.
                </p>
              </>
            )}
          </div>
        )}
      </DetailSheet>
    </Sheet>
  )
}
