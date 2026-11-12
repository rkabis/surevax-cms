import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, Users, ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import {
  PageHeader,
  KpiCell,
  KpiStrip,
  DetailSheet,
  DetailRail,
  TableCard,
  PageToolbar,
  SortableHead,
  ListEmpty,
  ErrorBanner,
} from '@/components/layout'
import { useTableSort } from '@/lib/useTableSort'
import { PatientLabel } from '@/components/PatientLabel'
import { useReceivables, type ReceivableRow } from '@/features/transactions/api'
import { formatMoney } from '@/lib/format'
import { apiErrorMessage } from '@/lib/apiErrors'
import ReceivableDetail from './components/ReceivableDetail'

type BucketFilter = 'all' | 'd0_30' | 'd31_60' | 'd61_90' | 'd90plus'

const BUCKET_TABS: { value: BucketFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'd0_30', label: '1-30' },
  { value: 'd31_60', label: '31-60' },
  { value: 'd61_90', label: '61-90' },
  { value: 'd90plus', label: '90+' },
]

type Severity = 'overdue' | 'due' | 'info'

function severityFor(ageDays: number): Severity {
  if (ageDays > 30) return 'overdue'
  if (ageDays >= 1) return 'due'
  return 'info'
}

const OLDEST_TONE_CLASS: Record<Severity, string> = {
  overdue: 'text-triage-overdue font-medium',
  due: 'text-triage-due font-medium',
  info: 'text-triage-info',
}

export default function ReceivablesPage() {
  const [searchParams, setSearchParams] = useSearchParams()

  // Local input state for snappy typing; URL write is debounced (Pattern 34).
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '')
  const [debouncedQuery, setDebouncedQuery] = useState(() => searchParams.get('q') ?? '')
  const [tab, setTabState] = useState<BucketFilter>(() => {
    const fromUrl = searchParams.get('tab') as BucketFilter | null
    return fromUrl && BUCKET_TABS.some((b) => b.value === fromUrl) ? fromUrl : 'all'
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const setTab = (next: BucketFilter) => {
    setTabState(next)
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (next === 'all') p.delete('tab')
        else p.set('tab', next)
        return p
      },
      { replace: true },
    )
  }

  // Debounce URL write for search (250 ms): keeps history clean.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(query)
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (query) next.set('q', query)
          else next.delete('q')
          return next
        },
        { replace: true },
      )
    }, 250)
    return () => clearTimeout(t)
  }, [query, setSearchParams])

  // Consume ?selected= one-shot, then strip it so closing the rail doesn't
  // re-open it on refresh/back (Pattern 34).
  useEffect(() => {
    const sel = searchParams.get('selected')
    if (sel && sel !== selectedId) {
      setSelectedId(sel)
      const next = new URLSearchParams(searchParams)
      next.delete('selected')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, selectedId, setSearchParams])

  const { sort, toggleSort } = useTableSort({ defaultCol: 'age', defaultOrder: 'desc' })

  const { data, isLoading, isError, error } = useReceivables({
    q: debouncedQuery,
    bucket: tab,
    sort: sort?.col,
    order: sort?.order,
  })

  const rows = useMemo(() => data?.data ?? [], [data?.data])
  const totals = data?.totals

  const selectedRow = useMemo(
    () => rows.find((r) => r.patient.displayId === selectedId) ?? null,
    [rows, selectedId],
  )

  // The KPI band reads the server `totals`, which are computed over the
  // UNFILTERED set: the aging tab filters the table, not these figures. Deriving
  // them from `rows` instead would make "Total outstanding" collapse to the
  // selected band, so the operator could never see the clinic-wide number.
  const description = useMemo(() => {
    if (!totals) return undefined
    if (totals.patientCount === 0) return 'No open patient balances.'
    return `${totals.patientCount} patient${totals.patientCount === 1 ? '' : 's'} owe ${formatMoney(
      totals.grossOutstanding,
    )}, oldest ${totals.oldestAgeDays}d`
  }, [totals])

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader title="Receivables" description={description} />
      </div>

      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-b border-border bg-card">
        <KpiStrip>
          {isLoading ? (
            <>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="p-3 space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-6 w-28" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </>
          ) : (
            <>
              <KpiCell
                label="Total outstanding"
                value={formatMoney(totals?.grossOutstanding)}
                tone="overdue"
              />
              <KpiCell label="Patients owing" value={String(totals?.patientCount ?? 0)} />
              <KpiCell
                label="Over 30 days"
                value={formatMoney(totals?.over30Total)}
                subtitle={
                  totals
                    ? `${totals.over30Count} patient${totals.over30Count === 1 ? '' : 's'}`
                    : undefined
                }
                tone={totals && totals.over30Count > 0 ? 'overdue' : 'default'}
              />
              <KpiCell
                label="Credit on file"
                value={formatMoney(totals?.availableCredit)}
                tone="ok"
              />
              <KpiCell label="Net owed" value={formatMoney(totals?.netOutstanding)} />
            </>
          )}
        </KpiStrip>
      </div>

      <PageToolbar>
        <div className="relative flex-1 min-w-[10rem] sm:max-w-sm xl:max-w-md">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Search patient or MRN…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Tabs value={tab} onValueChange={(v) => setTab(v as BucketFilter)}>
          <TabsList className="h-8">
            {BUCKET_TABS.map((b) => (
              <TabsTrigger key={b.value} value={b.value} className="text-xs h-7 px-3">
                {b.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </PageToolbar>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4">
          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}

          {isError && !isLoading && (
            <ErrorBanner
              message={apiErrorMessage(error, 'Failed to load receivables.')}
              className="py-12 justify-center"
            />
          )}

          {!isLoading && !isError && rows.length === 0 && (
            <ListEmpty
              icon={Users}
              message={query || tab !== 'all' ? 'No patients found.' : 'No outstanding balances.'}
            />
          )}

          {!isLoading && !isError && rows.length > 0 && (
            <TableCard>
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <SortableHead col="name" sort={sort} onToggle={toggleSort}>
                      Patient
                    </SortableHead>
                    <TableHead className="text-right">Open bills</TableHead>
                    <SortableHead
                      col="age"
                      sort={sort}
                      onToggle={toggleSort}
                      className="text-right"
                    >
                      Oldest
                    </SortableHead>
                    <TableHead className="text-right">1-30</TableHead>
                    <TableHead className="text-right">31-60</TableHead>
                    <TableHead className="text-right">61-90</TableHead>
                    <TableHead className="text-right">90+</TableHead>
                    <SortableHead
                      col="amount"
                      sort={sort}
                      onToggle={toggleSort}
                      className="text-right"
                    >
                      Balance
                    </SortableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead className="w-[1.875rem]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row: ReceivableRow) => {
                    const severity = severityFor(row.oldestOpenBillAgeDays)
                    return (
                      <TableRow
                        key={row.patient.displayId}
                        className="cursor-pointer stripe"
                        data-severity={severity}
                        onClick={() => setSelectedId(row.patient.displayId)}
                      >
                        <TableCell>
                          <PatientLabel patient={row.patient} showMrn />
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {row.openBillCount}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono tabular-nums ${OLDEST_TONE_CLASS[severity]}`}
                        >
                          {row.oldestOpenBillAgeDays}d
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatMoney(row.aging.d0_30)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatMoney(row.aging.d31_60)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatMoney(row.aging.d61_90)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatMoney(row.aging.d90plus)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums font-medium">
                          {formatMoney(row.grossOutstanding)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatMoney(row.availableCredit)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums font-medium">
                          {formatMoney(row.netOutstanding)}
                        </TableCell>
                        <TableCell>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableCard>
          )}
        </div>
      </div>

      <DetailRail open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DetailSheet width="standard">
          <SheetHeader className="px-6 pt-6 pb-2">
            <SheetTitle>Patient balance</SheetTitle>
            <SheetDescription>Outstanding position and payment actions</SheetDescription>
          </SheetHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {selectedId && selectedRow ? (
              <ReceivableDetail
                patientId={selectedId}
                row={selectedRow}
                onClose={() => setSelectedId(null)}
              />
            ) : selectedId && !isLoading ? (
              <ErrorBanner message="Patient not found in the current view." className="p-6" />
            ) : null}
          </div>
        </DetailSheet>
      </DetailRail>
    </div>
  )
}
