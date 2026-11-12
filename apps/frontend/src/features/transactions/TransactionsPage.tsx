import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ReceiptText,
  Search,
  Plus,
  Wallet,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  PageHeader,
  KpiCell,
  KpiStrip,
  DetailSheet,
  TableCard,
  SortableHead,
  DetailRail,
} from '@/components/layout'
import { useTableSort } from '@/lib/useTableSort'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { useTransactions, type TransactionStatus } from './api'
import { usePatient } from '@/features/patients/api'
import { useCurrentShift } from '@/features/shift/api'
import { useDashboard } from '@/features/dashboard/api'
import { formatMoney } from '@/lib/format'
import { toCents, fromCents } from '@/lib/money'
import TransactionDetail from './components/TransactionDetail'
import RecordDepositDialog from './components/RecordDepositDialog'
import { TRANSACTION_STATUS_VARIANT as STATUS_VARIANT, humanizeStatus } from '@/lib/status'
import { manilaCalendarDate } from '@/lib/clinicDate'

const STATUS_TRIAGE: Record<string, 'ok' | 'due' | 'overdue' | 'info'> = {
  Draft: 'info',
  Pending: 'due',
  Paid: 'ok',
  Voided: 'overdue',
  Refunded: 'overdue',
}

const todayISO = manilaCalendarDate

function formatTimeShort(dt: string) {
  const date = new Date(dt)
  const isToday = manilaCalendarDate(date) === manilaCalendarDate()
  const time = date.toLocaleTimeString('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Manila',
  })
  if (isToday) return time
  return (
    date.toLocaleDateString('en-PH', {
      month: 'short',
      day: 'numeric',
      timeZone: 'Asia/Manila',
    }) +
    '\n' +
    time
  )
}

function calcShiftMinutes(openedAt: string | undefined | null): string {
  if (!openedAt) return '—'
  const ms = Date.now() - new Date(openedAt).getTime()
  // Guard against negative/NaN: produced '-1:--1' when openedAt was slightly
  // in the future (clock skew) OR when the page was viewing a past date and
  // the drawer's openedAt was newer than "now of that past date" arithmetic.
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const mins = Math.floor(ms / 60_000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

type StatusFilter = 'all' | TransactionStatus
const STATUS_FILTERS: StatusFilter[] = ['all', 'Paid', 'Pending', 'Draft', 'Voided']

export default function TransactionsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const patientFilterId = searchParams.get('patient')

  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  // URL-as-state (Pattern 34): ?status= survives refresh and powers
  // deep links (topbar unsettled chip, Today cockpit).
  const [statusFilter, setStatusFilterState] = useState<StatusFilter>(() => {
    const fromUrl = searchParams.get('status') as StatusFilter | null
    return fromUrl && STATUS_FILTERS.includes(fromUrl) ? fromUrl : 'all'
  })
  const setStatusFilter = (next: StatusFilter) => {
    setStatusFilterState(next)
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (next === 'all') p.delete('status')
        else p.set('status', next)
        return p
      },
      { replace: true },
    )
  }
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [depositOpen, setDepositOpen] = useState(false)

  // Branch-day scope: defaults to today, persists via ?date=YYYY-MM-DD.
  const date = searchParams.get('date') ?? todayISO()
  const setDate = (next: string) => {
    const params = new URLSearchParams(searchParams)
    params.set('date', next || todayISO())
    setSearchParams(params, { replace: true })
  }
  const shiftDay = (days: number) => {
    const d = new Date(date + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() + days)
    setDate(d.toISOString().slice(0, 10))
  }

  // View mode: 'day' scopes to the selected date; 'all' removes the date filter.
  const viewMode = (searchParams.get('view') ?? 'day') as 'day' | 'all'
  const setViewMode = (next: 'day' | 'all') => {
    const params = new URLSearchParams(searchParams)
    if (next === 'day') {
      params.delete('view')
    } else {
      params.set('view', next)
    }
    setSearchParams(params, { replace: true })
  }

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250)
    return () => clearTimeout(t)
  }, [query])

  const shift = useCurrentShift()
  const drawer = shift.data?.data ?? null

  const { data: filteredPatient } = usePatient(patientFilterId ?? null)
  const filteredPatientLabel = useMemo(() => {
    if (!patientFilterId) return null
    if (!filteredPatient) return patientFilterId
    return `${filteredPatient.lastName}, ${filteredPatient.firstName}`
  }, [patientFilterId, filteredPatient])

  useEffect(() => {
    const sel = searchParams.get('selected')
    if (sel && sel !== selectedId) {
      setSelectedId(sel)
      const next = new URLSearchParams(searchParams)
      next.delete('selected')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, selectedId, setSearchParams])

  const { sort, toggleSort } = useTableSort({ defaultCol: 'created_at', defaultOrder: 'desc' })

  const { data, isLoading, isError } = useTransactions({
    q: debouncedQuery,
    status: statusFilter,
    patient: patientFilterId ?? undefined,
    date: viewMode === 'day' ? date : undefined,
    sort: sort?.col,
    order: sort?.order,
  })

  const rows = useMemo(() => data?.data ?? [], [data?.data])
  const stats = data?.stats
  const dayStats = data?.dayStats ?? null

  // AR in all-mode is not a day figure: it is every open bill, whenever it was
  // raised. The dashboard already computes it server-side from the GENERATED
  // amount_outstanding column (MONEY-4), so read it rather than summing rows.
  const { data: dash } = useDashboard()
  const arStats = dash?.stats ?? null

  // 7-day revenue trend + day-over-day delta from the stats sidecar. The
  // series is Paid-only and today-anchored, matching stats.todayRevenue —
  // so only attach it in all-mode. Day view derives its revenue value from
  // dayStats (non-Voided/Refunded incl. Pending), a different filter; pairing
  // it with this sparkline would put two revenue definitions on one cell.
  const showTrend = viewMode !== 'day'
  const revenueTrend = useMemo(
    () => (stats?.trend7d?.revenue ?? []).map((v) => parseFloat(v)),
    [stats],
  )
  const revenueDeltaLine = useMemo(() => {
    const raw = stats?.revenueVsPrevDay
    if (raw == null) return undefined
    const cents = Math.round(parseFloat(raw) * 100)
    if (!Number.isFinite(cents)) return undefined
    if (cents === 0) return 'Flat vs yesterday'
    const sign = cents > 0 ? '+' : '−'
    return `${sign}${formatMoney(fromCents(Math.abs(cents)))} vs yesterday`
  }, [stats])

  const kpis = useMemo(() => {
    if (!data) return null

    // When scoped to a specific day, derive KPIs from dayStats so the cards
    // reflect the selected date rather than always showing today's figures.
    if (viewMode === 'day' && dayStats) {
      const cashEntry = dayStats.byMethod.find((m) => m.method === 'Cash')
      const nonCashEntries = dayStats.byMethod.filter((m) => m.method !== 'Cash')
      const cashTotal = toCents(cashEntry?.total ?? '0')
      const nonCashTotal = nonCashEntries.reduce((sum, m) => sum + toCents(m.total), 0)
      const totalNet = toCents(dayStats.totalRevenue)
      const pendingCount = dayStats.byStatus.find((s) => s.status === 'Pending')?.count ?? 0
      const arAmount = parseFloat(dayStats.totalUnsettled)

      return {
        revenueLabel: date === todayISO() ? "Today's revenue" : 'Revenue',
        revenue: {
          value: formatMoney(dayStats.totalRevenue),
          delta: `${dayStats.count} transactions`,
          deltaKind: 'up' as const,
        },
        cash: {
          value: cashTotal > 0 ? formatMoney(fromCents(cashTotal)) : '—',
          delta: totalNet > 0 ? `${Math.round((cashTotal / totalNet) * 100)}%` : undefined,
        },
        nonCash: {
          value: nonCashTotal > 0 ? formatMoney(fromCents(nonCashTotal)) : '—',
          delta: totalNet > 0 ? `${Math.round((nonCashTotal / totalNet) * 100)}%` : undefined,
        },
        ar: {
          value: arAmount > 0 ? formatMoney(dayStats.totalUnsettled) : '—',
          delta: pendingCount > 0 ? `${pendingCount} pending` : 'All settled',
          deltaKind: arAmount > 0 ? ('down' as const) : ('neutral' as const),
        },
      }
    }

    // All-mode or no dayStats — fall back to today's global stats.
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayRows = rows.filter((r) => {
      const d = new Date(r.transactedAt)
      d.setHours(0, 0, 0, 0)
      return d.getTime() === today.getTime()
    })
    const cashTotal = todayRows
      .filter((r) => r.paymentMethod === 'Cash')
      .reduce((sum, r) => sum + toCents(r.netAmount), 0)
    const nonCashTotal = todayRows
      .filter((r) => r.paymentMethod !== null && r.paymentMethod !== 'Cash')
      .reduce((sum, r) => sum + toCents(r.netAmount), 0)
    const allTodayNet = todayRows.reduce((sum, r) => sum + toCents(r.netAmount), 0)
    // Server-computed, tenant-wide, net of every downpayment already collected.
    // Summing netAmount over Pending rows (the pre-2026-07 behaviour) reported a
    // partly-paid bill at its full value, so downpayments never moved the KPI.
    const arOutstanding = arStats?.unsettledTotal ?? null
    const arCents = arOutstanding === null ? 0 : toCents(arOutstanding)

    return {
      revenueLabel: "Today's revenue",
      revenue: {
        value: formatMoney(stats?.todayRevenue ?? '0.00'),
        delta: `${stats?.todayCount ?? 0} transactions`,
        deltaKind: 'up' as const,
      },
      cash: {
        value: cashTotal > 0 ? formatMoney(fromCents(cashTotal)) : '—',
        delta: allTodayNet > 0 ? `${Math.round((cashTotal / allTodayNet) * 100)}%` : undefined,
      },
      nonCash: {
        value: nonCashTotal > 0 ? formatMoney(fromCents(nonCashTotal)) : '—',
        delta: allTodayNet > 0 ? `${Math.round((nonCashTotal / allTodayNet) * 100)}%` : undefined,
      },
      ar: {
        value: arCents > 0 ? formatMoney(arOutstanding ?? '0.00') : '—',
        delta:
          (arStats?.pendingPayments ?? 0) > 0
            ? `${arStats?.pendingPayments} open`
            : arOutstanding === null
              ? undefined
              : 'All settled',
        deltaKind: arCents > 0 ? ('down' as const) : ('neutral' as const),
      },
    }
  }, [data, rows, stats, dayStats, arStats, viewMode, date])

  const pillRefs = useRef<Array<HTMLButtonElement | null>>([])
  function handlePillKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, idx: number) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      const next = (idx + 1) % STATUS_FILTERS.length
      pillRefs.current[next]?.focus()
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = (idx - 1 + STATUS_FILTERS.length) % STATUS_FILTERS.length
      pillRefs.current[prev]?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      pillRefs.current[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      pillRefs.current[STATUS_FILTERS.length - 1]?.focus()
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setStatusFilter(STATUS_FILTERS[idx]!)
    }
  }

  const skeletonRowCount = 8

  function clearPatientFilter() {
    const next = new URLSearchParams(searchParams)
    next.delete('patient')
    setSearchParams(next, { replace: true })
  }

  // Clear the selection when the patient filter CHANGES, but never on first
  // mount: the `?selected=` effect above also runs on mount, and because effects
  // fire in declaration order this one used to overwrite it with null, silently
  // dropping every deep link into the rail (the Today cockpit's "Collect" action
  // and the patient Account tab's row click both arrive that way). Caught by the
  // E2E journey spec.
  const prevPatientFilter = useRef<string | null>(patientFilterId)
  useEffect(() => {
    if (prevPatientFilter.current === patientFilterId) return
    prevPatientFilter.current = patientFilterId
    setSelectedId(null)
  }, [patientFilterId])

  const isToday = date === todayISO()
  const subtitle = useMemo(() => {
    const parts: string[] = []
    if (drawer) {
      // `drawer.id` is the display-id-typed string per the frontend convention.
      // The literal "#12" was a Wave 1 audit finding (hardcoded chrome).
      parts.push(`Drawer ${drawer.id} · ${formatMoney(drawer.floatAmount)}`)
    }
    // "X into shift" is only meaningful on today's page — past-date views
    // would otherwise show negative/garbage values (Wave 1 audit `-1:--1` bug).
    if (drawer?.openedAt && isToday) {
      parts.push(`${calcShiftMinutes(drawer.openedAt)} into shift`)
    }
    if (stats?.todayCount) {
      parts.push(`${stats.todayCount} ${isToday ? 'today' : 'on date'}`)
    }
    return parts.length > 0 ? parts.join(' · ') : 'No active shift'
  }, [drawer, stats, isToday])

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="Transactions"
          description={subtitle}
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => setDepositOpen(true)}>
                <Wallet className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                Record deposit
              </Button>
              <Button asChild size="sm">
                <Link to="/transactions/new">
                  <Plus className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                  New Transaction
                </Link>
              </Button>
            </>
          }
        />
      </div>

      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-b border-border bg-card">
        <KpiStrip>
          {isLoading ? (
            <>
              <div className="p-3 space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-28" />
                <Skeleton className="h-3 w-16" />
              </div>
              <div className="p-3 space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-28" />
                <Skeleton className="h-3 w-16" />
              </div>
              <div className="p-3 space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-28" />
                <Skeleton className="h-3 w-16" />
              </div>
              <div className="p-3 space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-28" />
                <Skeleton className="h-3 w-16" />
              </div>
            </>
          ) : (
            <>
              <KpiCell
                label={kpis?.revenueLabel ?? "Today's revenue"}
                value={kpis?.revenue.value ?? '—'}
                subtitle={kpis?.revenue.delta}
                trend={showTrend && revenueTrend.length >= 2 ? revenueTrend : undefined}
                delta={showTrend ? revenueDeltaLine : undefined}
              />
              <KpiCell label="Cash" value={kpis?.cash.value ?? '—'} subtitle={kpis?.cash.delta} />
              <KpiCell
                label="Non-Cash"
                value={kpis?.nonCash.value ?? '—'}
                subtitle={kpis?.nonCash.delta}
              />
              <KpiCell
                label="Account receivable"
                value={kpis?.ar.value ?? '—'}
                subtitle={kpis?.ar.delta}
                tone={kpis?.ar.value && kpis.ar.value !== '—' ? 'overdue' : 'default'}
              />
            </>
          )}
        </KpiStrip>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 space-y-4">
          {patientFilterId && (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1.5 pr-1 text-xs">
                <span>
                  Filtered by patient: <span className="font-medium">{filteredPatientLabel}</span>
                </span>
                <button
                  type="button"
                  onClick={clearPatientFilter}
                  aria-label="Clear patient filter"
                  className="rounded-sm hover:bg-accent p-0.5 focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </Badge>
            </div>
          )}

          {/* View mode toggle + day-scope picker */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant={viewMode === 'day' ? 'default' : 'outline'}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setViewMode('day')}
            >
              By Day
            </Button>
            <Button
              variant={viewMode === 'all' ? 'default' : 'outline'}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setViewMode('all')}
            >
              All
            </Button>
            {viewMode === 'day' && (
              <>
                <div className="w-px h-5 bg-border mx-1" />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2"
                  onClick={() => shiftDay(-1)}
                  aria-label="Previous day"
                >
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="h-8 max-w-[10.625rem] text-sm"
                  aria-label="Filter by date"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2"
                  onClick={() => shiftDay(1)}
                  aria-label="Next day"
                >
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button
                  variant={date === todayISO() ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setDate(todayISO())}
                >
                  Today
                </Button>
                {dayStats && (
                  <span className="text-xs text-muted-foreground ml-2 font-mono tabular-nums">
                    {dayStats.count} txn · {formatMoney(dayStats.totalRevenue)} revenue
                    {parseFloat(dayStats.totalUnsettled) > 0 && (
                      <span className="text-destructive ml-2">
                        · {formatMoney(dayStats.totalUnsettled)} unsettled
                      </span>
                    )}
                  </span>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[10rem] sm:max-w-sm xl:max-w-md">
              <Search
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
                aria-hidden
              />
              <Input
                type="search"
                placeholder="Search patient or ref #…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
            <div
              role="radiogroup"
              aria-label="Status filter"
              className="flex items-center gap-1.5 flex-wrap"
            >
              {STATUS_FILTERS.map((f, idx) => {
                const active = statusFilter === f
                return (
                  <Button
                    key={f}
                    ref={(el) => {
                      pillRefs.current[idx] = el
                    }}
                    variant={active ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 text-xs"
                    role="radio"
                    aria-checked={active}
                    tabIndex={active ? 0 : -1}
                    onKeyDown={(e) => handlePillKeyDown(e, idx)}
                    onClick={() => setStatusFilter(f)}
                  >
                    {f === 'all' ? 'All' : f}
                  </Button>
                )
              })}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold">
                {viewMode === 'all'
                  ? 'All transactions'
                  : date === todayISO()
                    ? "Today's transactions"
                    : new Date(date + 'T00:00:00').toLocaleDateString('en-PH', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
              </h2>
              <p className="text-xs text-muted-foreground">{rows.length} entries</p>
            </div>

            {isLoading && (
              <div className="space-y-2">
                {Array.from({ length: skeletonRowCount }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            )}

            {isError && !isLoading && (
              <div className="py-12 text-center">
                <AlertCircle className="h-8 w-8 text-destructive/50 mx-auto mb-2" aria-hidden />
                <p className="text-sm text-destructive">Failed to load transactions.</p>
              </div>
            )}

            {!isLoading && !isError && rows.length === 0 && (
              <div className="py-12 text-center">
                <ReceiptText
                  className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2"
                  aria-hidden
                />
                <p className="text-sm text-muted-foreground">
                  {query || statusFilter !== 'all' || patientFilterId
                    ? 'No transactions found.'
                    : 'No transactions yet.'}
                </p>
                {query && viewMode === 'day' && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Searching within{' '}
                    {date === todayISO()
                      ? 'today'
                      : new Date(date + 'T00:00:00').toLocaleDateString('en-PH', {
                          month: 'short',
                          day: 'numeric',
                        })}
                    .{' '}
                    <button
                      type="button"
                      className="underline underline-offset-2 hover:text-foreground"
                      onClick={() => setViewMode('all')}
                    >
                      Search all dates
                    </button>
                  </p>
                )}
              </div>
            )}

            {!isLoading && !isError && rows.length > 0 && (
              <TableCard>
                <Table density="compact">
                  <TableHeader className="sticky top-0 bg-card z-10">
                    <TableRow>
                      <SortableHead
                        col="created_at"
                        sort={sort}
                        onToggle={toggleSort}
                        className="w-[3.75rem]"
                      >
                        Time
                      </SortableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Patient · Items</TableHead>
                      <SortableHead col="status" sort={sort} onToggle={toggleSort}>
                        Status
                      </SortableHead>
                      <SortableHead
                        col="net_amount"
                        sort={sort}
                        onToggle={toggleSort}
                        className="text-right"
                      >
                        Total
                      </SortableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <SortableHead
                        col="amount_outstanding"
                        sort={sort}
                        onToggle={toggleSort}
                        className="text-right"
                      >
                        Balance
                      </SortableHead>
                      <TableHead className="w-[1.875rem]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((txn) => {
                      const triageVariant = STATUS_TRIAGE[txn.status] ?? 'info'
                      return (
                        <TableRow
                          interactive
                          key={txn.id}
                          className="cursor-pointer"
                          data-severity={triageVariant}
                          onClick={() => setSelectedId(txn.id)}
                        >
                          <TableCell className="font-mono tabular-nums text-xs">
                            {formatTimeShort(txn.transactedAt)}
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-xs text-muted-foreground">
                              {txn.id.slice(-8)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div>
                              <p className="text-sm font-medium">{txn.patientName}</p>
                              <p className="text-xs text-muted-foreground">
                                {txn.itemCount} item{txn.itemCount !== 1 ? 's' : ''}
                                {txn.paymentMethod ? ` · ${txn.paymentMethod}` : ''}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={STATUS_VARIANT[txn.status] ?? 'outline'}
                              className="text-2xs"
                            >
                              {txn.status === 'Paid' && txn.paymentMethod
                                ? `Paid · ${txn.paymentMethod}`
                                : humanizeStatus(txn.status)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums font-medium">
                            {formatMoney(txn.netAmount)}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                            {formatMoney(txn.amountPaid)}
                          </TableCell>
                          <TableCell
                            className={`text-right font-mono tabular-nums ${
                              toCents(txn.amountOutstanding) > 0
                                ? 'font-medium text-triage-due'
                                : 'text-muted-foreground'
                            }`}
                          >
                            {formatMoney(txn.amountOutstanding)}
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
      </div>

      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-2 border-t border-border">
        <p className="text-xs text-muted-foreground">
          {rows.length} transaction{rows.length !== 1 ? 's' : ''}
          {statusFilter !== 'all' || patientFilterId ? ' (filtered)' : ''}
        </p>
      </div>

      <DetailRail open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DetailSheet width="wide">
          <SheetHeader className="px-6 pt-6 pb-2">
            <SheetTitle>Transaction</SheetTitle>
            <SheetDescription>Full billing record detail</SheetDescription>
          </SheetHeader>
          <div className="flex-1 min-h-0">
            {selectedId && <TransactionDetail transactionId={selectedId} />}
          </div>
        </DetailSheet>
      </DetailRail>

      <RecordDepositDialog open={depositOpen} onOpenChange={setDepositOpen} />
    </div>
  )
}
