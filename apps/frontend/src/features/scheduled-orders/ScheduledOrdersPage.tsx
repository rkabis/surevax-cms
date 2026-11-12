import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, AlertTriangle, Inbox, MessageSquare } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  PageHeader,
  ListEmpty,
  DetailSheet,
  TableCard,
  PageToolbar,
  DetailRail,
} from '@/components/layout'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  useScheduledOrders,
  type ScheduledOrder,
  type ScheduledOrdersFilterMode,
  type TextDraftBlockedReason,
} from './api'
import ScheduledOrderDetail from './components/ScheduledOrderDetail'
import TextPatientDialog from './components/TextPatientDialog'
import { formatLongDate } from '@/lib/format'
import { clinicCalendarDateString } from '@/lib/clinicDate'

// ── Text patient action (R2) ─────────────────────────────────────────────────

/** Mirrors the two hard blocks the backend enforces (GET .../text-draft). */
function textBlockedReason(order: ScheduledOrder): TextDraftBlockedReason | null {
  if (!order.contactNumber) return 'no_contact_number'
  if (!order.smsOptIn) return 'sms_opt_in_false'
  return null
}

function TextPatientButton({
  order,
  onOpen,
}: {
  order: ScheduledOrder
  onOpen: (order: ScheduledOrder) => void
}) {
  const blockedReason = textBlockedReason(order)

  if (!blockedReason) {
    return (
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8 shrink-0"
        aria-label="Text patient"
        onClick={(e) => {
          e.stopPropagation()
          onOpen(order)
        }}
      >
        <MessageSquare className="h-3.5 w-3.5" aria-hidden />
      </Button>
    )
  }

  // Blocked: NOT the native `disabled` attribute, since a disabled element
  // cannot receive keyboard focus and the reason must be reachable without
  // a mouse. `aria-disabled` keeps it focusable (Playwright's
  // `toBeDisabled()` still matches on aria-disabled) while the click
  // handler below no-ops.
  const reasonText =
    blockedReason === 'no_contact_number'
      ? 'No mobile number on file.'
      : 'No SMS opt-in on file for this patient.'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0 opacity-50"
          aria-disabled="true"
          aria-label={`Text patient: ${reasonText}`}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
          }}
        >
          <MessageSquare className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{reasonText}</TooltipContent>
    </Tooltip>
  )
}

// ── helpers ──────────────────────────────────────────────────────────────────

function laneFor(order: ScheduledOrder): 'overdue' | 'due' | 'info' {
  if (order.priorityState === 'overdue' || order.priorityState === 'missed') return 'overdue'
  if (order.priorityState === 'due') return 'due'
  return 'info'
}

function formatDueLabel(dateStr: string | null, today: string): string {
  if (!dateStr) return '—'
  const date = new Date(dateStr + 'T00:00:00')
  const todayDate = new Date(today + 'T00:00:00')
  const diff = Math.round((date.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24))

  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) {
    return `${date.toLocaleDateString('en-PH', { day: 'numeric', month: 'short' })} · 1d late`
  }
  if (diff < -1) {
    return `${date.toLocaleDateString('en-PH', { day: 'numeric', month: 'short' })} · ${Math.abs(diff)}d late`
  }
  if (diff <= 7)
    return `${date.toLocaleDateString('en-PH', { weekday: 'short', day: 'numeric', month: 'short' })}`
  return date.toLocaleDateString('en-PH', { day: 'numeric', month: 'short' })
}

// ── lane config ──────────────────────────────────────────────────────────────

type ActiveTab = 'due' | 'backfill' | 'overdue' | 'upcoming' | 'missed' | 'completed'
type LaneSev = 'overdue' | 'due' | 'info' | 'ok'

const LANE_MAP: Record<LaneSev, { title: string; emptyText: string }> = {
  due: { title: 'Due today', emptyText: 'No courses due today' },
  overdue: { title: 'Overdue', emptyText: 'No overdue courses' },
  info: {
    title: 'Upcoming · next 2 days',
    emptyText: 'No doses due tomorrow or the following day',
  },
  ok: { title: 'Completed today', emptyText: 'No completed orders today' },
}

// Tab → API filter mode.
const TAB_TO_FILTER: Record<ActiveTab, ScheduledOrdersFilterMode> = {
  due: 'today',
  backfill: 'backfill',
  overdue: 'overdue',
  upcoming: 'upcoming',
  missed: 'missed',
  completed: 'completed_today',
}

const TAB_LANES: Record<ActiveTab, LaneSev[]> = {
  due: ['due'],
  backfill: ['overdue'],
  overdue: ['overdue'],
  upcoming: ['info'],
  missed: ['overdue'],
  completed: ['ok'],
}

// ── ScheduledOrdersTable (swimlane inner table) ──────────────────────────────

interface ScheduledOrdersTableProps {
  orders: ScheduledOrder[]
  sev: LaneSev
  today: string
  selectedId: string | null
  onSelect: (id: string) => void
  onTextPatient: (order: ScheduledOrder) => void
}

function ScheduledOrdersTable({
  orders,
  sev,
  today,
  selectedId,
  onSelect,
  onTextPatient,
}: ScheduledOrdersTableProps) {
  return (
    <Table density="compact">
      <TableHeader className="sticky top-0 bg-card z-10">
        <TableRow className="text-xs">
          <TableHead>Patient</TableHead>
          <TableHead>Course</TableHead>
          <TableHead>Step</TableHead>
          <TableHead className="font-mono tabular-nums">Due</TableHead>
          <TableHead>Payment</TableHead>
          <TableHead className="w-[9rem]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="py-4 text-center text-sm text-muted-foreground">
              {LANE_MAP[sev].emptyText}
            </TableCell>
          </TableRow>
        ) : (
          orders.map((order) => {
            return (
              <TableRow
                interactive
                key={order.id}
                data-severity={sev}
                data-state={selectedId === order.id ? 'selected' : undefined}
                className="stripe cursor-pointer"
                onClick={() => onSelect(order.id)}
              >
                <TableCell>
                  <p className="text-sm font-medium leading-tight">{order.patientName}</p>
                  <p className="text-xs text-muted-foreground font-mono tabular-nums">
                    {order.patientMrn ?? '—'}
                    {order.patientDateOfBirth
                      ? ` · DOB ${formatLongDate(order.patientDateOfBirth)}`
                      : ''}
                  </p>
                </TableCell>

                <TableCell className="max-w-[10rem]">
                  <p
                    className="text-sm whitespace-normal break-words"
                    title={order.standingOrderName ?? order.service ?? undefined}
                  >
                    {order.standingOrderName ?? order.service ?? '—'}
                  </p>
                  {order.indication && (
                    <p className="text-xs text-muted-foreground truncate">{order.indication}</p>
                  )}
                </TableCell>

                <TableCell>
                  <p className="text-sm">
                    Dose {order.doseNumber}
                    {order.totalDoses ? ` of ${order.totalDoses}` : ''}
                  </p>
                </TableCell>

                <TableCell>
                  <span className="font-mono tabular-nums text-sm">
                    {formatDueLabel(order.scheduledDate, today)}
                  </span>
                </TableCell>

                <TableCell>
                  {order.paymentStatus === 'Paid' ? (
                    <Badge variant="ok" className="text-xs">
                      Paid
                    </Badge>
                  ) : order.paymentStatus === 'Pending' ? (
                    <Badge variant="overdue" className="text-xs">
                      Unpaid
                    </Badge>
                  ) : order.paymentStatus === 'Draft' ? (
                    <Badge variant="info" className="text-xs">
                      Draft
                    </Badge>
                  ) : order.paymentStatus === 'Voided' ? (
                    <Badge variant="outline" className="text-xs">
                      Voided
                    </Badge>
                  ) : order.paymentStatus === 'Refunded' ? (
                    <Badge variant="outline" className="text-xs">
                      Refunded
                    </Badge>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>

                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <TextPatientButton order={order} onOpen={onTextPatient} />
                    <Button
                      variant={sev === 'overdue' || sev === 'due' ? 'default' : 'outline'}
                      size="sm"
                      // No `h-7` override: this is the action a nurse clicks
                      // dozens of times a day and it was the SMALLEST button on
                      // the page (28px), a step below the app's own `sm` (32px).
                      // The row is dense enough to carry the standard size.
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelect(order.id)
                      }}
                      aria-label={`${sev === 'due' ? 'Review administration for' : 'Open'} ${order.patientName}, ${order.patientMrn ?? 'MRN unavailable'}, dose ${order.doseNumber}`}
                    >
                      {order.hasBlockingOverdue
                        ? 'Review course →'
                        : sev === 'overdue'
                          ? 'Recompute →'
                          : sev === 'due'
                            ? 'Administer →'
                            : 'Open →'}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )
          })
        )}
      </TableBody>
    </Table>
  )
}

// ── LaneSection ──────────────────────────────────────────────────────────────

interface LaneSectionProps {
  sev: LaneSev
  title: string
  orders: ScheduledOrder[]
  today: string
  selectedId: string | null
  onSelect: (id: string) => void
  onTextPatient: (order: ScheduledOrder) => void
}

function LaneSection({
  sev,
  title,
  orders,
  today,
  selectedId,
  onSelect,
  onTextPatient,
}: LaneSectionProps) {
  return (
    <section>
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur flex items-center gap-2 py-2 px-1 mb-1">
        <span className="dot" data-severity={sev} />
        <h3 className="text-sm font-semibold">{title}</h3>
        <Badge variant={sev} className="text-xs tabular-nums">
          {orders.length}
        </Badge>
        <div className="flex-1" />
      </div>

      <TableCard>
        <ScheduledOrdersTable
          orders={orders}
          sev={sev}
          today={today}
          selectedId={selectedId}
          onSelect={onSelect}
          onTextPatient={onTextPatient}
        />
      </TableCard>
    </section>
  )
}

// ── ScheduledOrdersPage ──────────────────────────────────────────────────────

export default function ScheduledOrdersPage() {
  const [searchParams, setSearchParams] = useSearchParams()

  // Local input state for snappy typing; URL write is debounced.
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '')
  const [debouncedQuery, setDebouncedQuery] = useState(() => searchParams.get('q') ?? '')
  const [activeTab, setActiveTab] = useState<ActiveTab>(
    () => (searchParams.get('tab') as ActiveTab | null) ?? 'due',
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Text patient (R2): which row's QR draft dialog is open, if any. Not
  // URL-backed (unlike selectedId) - it's a transient action, not a
  // navigable record view.
  const [textPatientOrder, setTextPatientOrder] = useState<ScheduledOrder | null>(null)

  // URL-as-state (Pattern 34): consume ?selected= one-shot (Today cockpit
  // deep-links here with the order pre-selected), then strip it so closing
  // the rail doesn't re-open on back/refresh.
  useEffect(() => {
    const sel = searchParams.get('selected')
    if (sel && sel !== selectedId) {
      setSelectedId(sel)
      const next = new URLSearchParams(searchParams)
      next.delete('selected')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, selectedId, setSearchParams])

  // Debounce URL write for search (250 ms) — keeps history clean.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(query)
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (query) {
            next.set('q', query)
          } else {
            next.delete('q')
          }
          return next
        },
        { replace: true },
      )
    }, 250)
    return () => clearTimeout(t)
  }, [query, setSearchParams])

  function handleTabChange(tab: ActiveTab) {
    setActiveTab(tab)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (tab === 'due') {
          next.delete('tab')
        } else {
          next.set('tab', tab)
        }
        return next
      },
      { replace: true },
    )
  }

  const filter = TAB_TO_FILTER[activeTab]
  const { data, isLoading, isFetching, isError } = useScheduledOrders(debouncedQuery, filter)

  const today = clinicCalendarDateString()
  const orders = data?.data ?? []
  // Do not manufacture zeroes while the first response is in flight. In a
  // clinical worklist, "0 overdue" is an assertion, not a loading placeholder.
  // Once React Query has data, keep rendering that last known snapshot during a
  // background refresh and label it as updating below.
  const stats = data?.stats
  const countLabel = (value: number | undefined) => (stats ? value : '—')
  const recomputeNeededCount = stats?.recomputeNeededCount ?? 0

  const laneOrders: Record<LaneSev, ScheduledOrder[]> = { overdue: [], due: [], info: [], ok: [] }
  for (const o of orders) {
    if (o.status === 'Completed') {
      laneOrders.ok.push(o)
    } else {
      laneOrders[laneFor(o)].push(o)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Page header */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="Scheduled Orders"
          description={
            stats
              ? `${stats.todayCount} due today · ${stats.overdueCount} overdue · ${stats.completedToday} completed today · ${stats.activeCoursesCount} active courses${isFetching ? ' · updating…' : ''}`
              : 'Loading clinical worklist…'
          }
          actions={
            stats ? (
              <div className="flex items-center gap-2">
                <Badge variant={stats.overdueCount > 0 ? 'overdue' : 'outline'}>
                  {stats.overdueCount} overdue
                </Badge>
                <Badge variant={recomputeNeededCount > 0 ? 'due' : 'outline'}>
                  {recomputeNeededCount} need recompute
                </Badge>
              </div>
            ) : undefined
          }
        />
      </div>

      {/* Search + filter tabs */}
      <PageToolbar>
        <div className="relative min-w-[12.5rem] max-w-xs xl:max-w-md flex-1">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Search patient or vaccine…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8 h-8 text-sm pr-10"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-xs font-medium opacity-100 sm:flex">
            /
          </kbd>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => handleTabChange(v as ActiveTab)}>
          <TabsList className="h-8">
            <TabsTrigger value="due" className="text-xs h-7 px-3">
              Today
              <span className="ml-1.5 font-mono tabular-nums text-muted-foreground">
                {countLabel(stats?.todayCount)}
              </span>
            </TabsTrigger>
            <TabsTrigger value="backfill" className="text-xs h-7 px-3">
              Backfill · overdue ≤3d
              <span className="ml-1.5 font-mono tabular-nums text-muted-foreground">
                {countLabel(stats?.backfillCount)}
              </span>
            </TabsTrigger>
            <TabsTrigger value="overdue" className="text-xs h-7 px-3">
              Overdue
              <span className="ml-1.5 font-mono tabular-nums text-muted-foreground">
                {countLabel(stats?.overdueCount)}
              </span>
            </TabsTrigger>
            <TabsTrigger value="upcoming" className="text-xs h-7 px-3">
              Upcoming · 2d
              <span className="ml-1.5 font-mono tabular-nums text-muted-foreground">
                {countLabel(stats?.upcomingCount)}
              </span>
            </TabsTrigger>
            <TabsTrigger value="missed" className="text-xs h-7 px-3">
              Missed
              <span className="ml-1.5 font-mono tabular-nums text-muted-foreground">
                {countLabel(stats?.missedCount)}
              </span>
            </TabsTrigger>
            <TabsTrigger value="completed" className="text-xs h-7 px-3">
              Completed today
              <span className="ml-1.5 font-mono tabular-nums text-muted-foreground">
                {countLabel(stats?.completedToday)}
              </span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </PageToolbar>

      <div className="flex-1 overflow-auto">
        <div className="p-4 sm:p-6 xl:p-8 space-y-6">
          {recomputeNeededCount > 0 && (
            <Alert variant="destructive" className="py-2 flex items-center gap-3">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              <div className="flex-1 min-w-0">
                <AlertTitle className="text-sm">
                  {recomputeNeededCount} course
                  {recomputeNeededCount === 1 ? '' : 's'} need
                  {recomputeNeededCount === 1 ? 's' : ''} late-dose recompute.
                </AlertTitle>
                <AlertDescription className="text-xs">
                  Scheduled window has passed. Recompute to shift future doses.
                </AlertDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 h-7 text-xs"
                onClick={() => handleTabChange('overdue')}
              >
                Review →
              </Button>
            </Alert>
          )}
          {isLoading && (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-32 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          )}

          {isError && (
            <div className="py-12 text-center text-destructive">
              <AlertTriangle className="h-8 w-8 mx-auto mb-2" aria-hidden />
              <p className="text-sm">Failed to load scheduled orders.</p>
            </div>
          )}

          {!isLoading && !isError && orders.length === 0 && (
            <ListEmpty
              icon={Inbox}
              message={
                query ? `No orders matching "${query}"` : 'No scheduled orders for this filter'
              }
              className="px-0"
            />
          )}

          {!isLoading &&
            !isError &&
            orders.length > 0 &&
            TAB_LANES[activeTab].map((sev) => (
              <LaneSection
                key={sev}
                sev={sev}
                title={
                  activeTab === 'backfill'
                    ? 'Backfill · overdue within 3 days'
                    : LANE_MAP[sev].title
                }
                orders={laneOrders[sev]}
                today={today}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onTextPatient={setTextPatientOrder}
              />
            ))}
        </div>
      </div>

      <DetailRail open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DetailSheet width="narrow">
          <SheetHeader className="px-6 pt-6 pb-2 shrink-0">
            <SheetTitle className="sr-only">Scheduled order detail</SheetTitle>
            <SheetDescription className="sr-only">
              Review the selected clinical order, administration checkpoint, and payment flow.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 min-h-0">
            {selectedId && <ScheduledOrderDetail orderId={selectedId} />}
          </div>
        </DetailSheet>
      </DetailRail>

      {textPatientOrder && (
        <TextPatientDialog
          open={!!textPatientOrder}
          onOpenChange={(open) => !open && setTextPatientOrder(null)}
          orderId={textPatientOrder.id}
          patientName={textPatientOrder.patientName}
        />
      )}
    </div>
  )
}
