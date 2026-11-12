import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Banknote, ChevronDown, Fingerprint, LogOut, Plus, Printer } from 'lucide-react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { avatarColor } from '@/lib/avatarColor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { KpiCell, KpiStrip, PageHeader } from '@/components/layout'
import { humanizeStatus } from '@/lib/status'
import { formatMoney } from '@/lib/format'
import { ADMIN_ROLES } from '@/lib/roles'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAuth } from '@/features/auth/context'
import {
  useDashboard,
  useDashboardNudges,
  useAuditRecent,
  useCurrentShift,
  type DashboardEncounter,
  type DashboardLowStockLot,
  type CurrentShift,
} from './api'
import { NurseWidgets } from './NurseWidgets'
import { useCurrentDrawer } from '@/features/branch/api'
import { DrawerCloseDialog } from '@/features/branch/components/DrawerCloseDialog'

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatEyebrowDate(d: Date): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]
  return `${days[d.getDay()]} · ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const target = new Date(dateStr)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

function lotSeverity(dateStr: string | null): 'overdue' | 'due' | 'info' {
  const d = daysUntil(dateStr)
  if (d === null) return 'info'
  if (d <= 7) return 'overdue'
  if (d <= 14) return 'due'
  return 'info'
}

function lotExpiryLabel(dateStr: string | null): string {
  const d = daysUntil(dateStr)
  if (d === null) return '—'
  if (d < 0) return `Exp ${Math.abs(d)}d ago`
  if (d === 0) return 'Expires today'
  if (d === 1) return 'Expires tomorrow'
  return `Exp in ${d}d`
}

function encSeverity(status: string): 'overdue' | 'due' | 'ok' | 'info' {
  if (status === 'Cancelled') return 'overdue'
  if (status === 'Pending') return 'due'
  if (status === 'Completed') return 'ok'
  return 'info'
}

function auditSeverityToVariant(severity: 'warning' | 'info'): 'overdue' | 'due' | 'ok' | 'info' {
  if (severity === 'warning') return 'due'
  return 'info'
}

function formatTimestamp(isoStr: string): string {
  try {
    return new Date(isoStr).toLocaleTimeString('en-PH', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  } catch {
    return '—'
  }
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) {
    return (words[0] ?? '?').slice(0, 2).toUpperCase()
  }
  const firstWord = words[0] ?? '?'
  const lastWord = words[words.length - 1] ?? '?'
  return (firstWord.charAt(0) + lastWord.charAt(0)).toUpperCase()
}

/** Active statuses — wait time is counted against now. Closed statuses use completedAt. */
const ACTIVE_STATUSES = new Set(['Open', 'InProgress'])

function formatWaitMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function computeWaitTime(enc: DashboardEncounter): number | null {
  const pattern = /(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i
  const match = enc.time.match(pattern)
  if (!match) return null
  const hStr = match[1]
  const mStr = match[2]
  if (!hStr || !mStr) return null
  let hours = parseInt(hStr, 10)
  const mins = parseInt(mStr, 10)
  const meridiem = match[3]
  if (isNaN(hours) || isNaN(mins)) return null
  if (meridiem) {
    if (meridiem.toUpperCase() === 'PM' && hours !== 12) hours += 12
    if (meridiem.toUpperCase() === 'AM' && hours === 12) hours = 0
  }
  const now = new Date()
  const entryDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, mins)

  if (ACTIVE_STATUSES.has(enc.status)) {
    // Live elapsed: now − startedAt
    const elapsed = Math.round((now.getTime() - entryDate.getTime()) / (1000 * 60))
    return elapsed > 0 && elapsed < 1440 ? elapsed : null
  }

  // Closed encounter: completedAt − startedAt (actual duration)
  if (enc.completedAt) {
    const elapsed = Math.round(
      (new Date(enc.completedAt).getTime() - entryDate.getTime()) / (1000 * 60),
    )
    return elapsed > 0 && elapsed < 1440 ? elapsed : null
  }

  // No closure timestamp for a closed encounter — suppress the wait-time display
  return null
}

function shiftTimeDisplay(startedAt: string): string {
  return new Date(startedAt).toLocaleTimeString('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

// ── Skeleton helpers ─────────────────────────────────────────────────────────

function KpiSkeleton() {
  return (
    <div className="p-4 space-y-2">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-7 w-12" />
      <Skeleton className="h-3 w-28" />
    </div>
  )
}

function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2 py-1">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between py-1.5 px-3">
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </div>
  )
}

// ── Scheduled-orders severity derivation ─────────────────────────────────────

// ── Expiring lots (derived) ───────────────────────────────────────────────────

function expiringLots7d(lowStock: DashboardLowStockLot[]) {
  return lowStock.filter((l) => {
    const d = daysUntil(l.expiryDate)
    return d !== null && d <= 7
  })
}

// ── Shift dropdown ────────────────────────────────────────────────────────────

function ShiftDropdown({
  shift,
  onPrintEod,
  onCloseDrawer,
  canCloseDrawer,
}: {
  shift: CurrentShift | null
  onPrintEod: () => void
  onCloseDrawer: () => void
  canCloseDrawer: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          Shift <ChevronDown className="ml-1 h-4 w-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => onPrintEod()}>
          <Printer className="mr-2 h-4 w-4" aria-hidden />
          <span className="flex-1">Print EOD report</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canCloseDrawer}
          onSelect={(e) => {
            if (!canCloseDrawer) {
              e.preventDefault()
              return
            }
            onCloseDrawer()
          }}
          className={canCloseDrawer ? undefined : 'text-muted-foreground'}
        >
          <Banknote className="mr-2 h-4 w-4" aria-hidden />
          {/* Middot separator so the cashier name reads as a label, not a
              numeric drawer id. */}
          <span className="flex-1">Close drawer{shift ? ` · ${shift.cashierName}` : ''}</span>
          {!canCloseDrawer && (
            <Badge variant="secondary" className="ml-2 text-2xs uppercase">
              No drawer
            </Badge>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem
          aria-disabled="true"
          onSelect={(e) => e.preventDefault()}
          className="text-muted-foreground"
        >
          <LogOut className="mr-2 h-4 w-4" aria-hidden />
          <span className="flex-1">End shift</span>
          <Badge variant="secondary" className="ml-2 text-2xs uppercase">
            Soon
          </Badge>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ── Roster table (inlined, replaces ArrivalsTable) ────────────────────────────

function RosterTable({
  encounters,
  emptyMessage,
}: {
  encounters: DashboardEncounter[]
  emptyMessage: string
}) {
  const navigate = useNavigate()
  if (encounters.length === 0) {
    return <p className="text-xs text-muted-foreground px-4 py-3">{emptyMessage}</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-xs w-[4.875rem]">Time</TableHead>
          <TableHead className="text-xs">Patient</TableHead>
          <TableHead className="text-xs">Protocol · Step</TableHead>
          <TableHead className="text-xs w-[6.875rem]">Allergies</TableHead>
          <TableHead className="text-xs w-[13.75rem]">Next action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {encounters.map((enc) => {
          const sev = encSeverity(enc.status)
          const waited = computeWaitTime(enc)
          return (
            <TableRow key={enc.id} className="stripe" data-severity={sev}>
              <TableCell>
                <div className="font-mono tabular-nums text-xs">{enc.time || '—'}</div>
                {waited !== null && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    waited{' '}
                    <span
                      className={`font-mono tabular-nums${waited > 20 ? ' font-medium text-triage-overdue' : ''}`}
                    >
                      {formatWaitMinutes(waited)}
                    </span>
                  </div>
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback
                      className="text-xs text-white"
                      style={{ backgroundColor: avatarColor(enc.patientDisplayId) }}
                    >
                      {getInitials(enc.patientName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{enc.patientName}</div>
                    <div className="text-xs text-muted-foreground font-mono tabular-nums">
                      {enc.patientDisplayId}
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <div className="text-xs">{enc.specialty || '—'}</div>
                <div className="text-xs text-muted-foreground font-mono tabular-nums mt-0.5">
                  {humanizeStatus(enc.status)}
                </div>
              </TableCell>
              <TableCell>
                <span className="text-xs text-muted-foreground">—</span>
              </TableCell>
              <TableCell>
                {enc.status === 'Pending' ? (
                  <Button
                    size="sm"
                    variant="default"
                    className="text-xs"
                    onClick={() => navigate('/encounters')}
                  >
                    Take action
                  </Button>
                ) : enc.status === 'Completed' ? (
                  <Badge variant="ok" className="text-xs">
                    {humanizeStatus(enc.status)}
                  </Badge>
                ) : (
                  <Badge variant={sev} className="text-xs">
                    {humanizeStatus(enc.status)}
                  </Badge>
                )}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

// ADMIN_ROLES (@/lib/roles) is the one admin notion, shared with AppShell nav
// and PatientDetail. `/api/audit` is mounted requireRole('TenantAdmin',
// 'BranchAdmin'), narrower than that set, so a SuperAdmin (legacy, no longer
// seeded) could still see the card and hit a real 403; the isError branch
// below makes that visible instead of silent.

// ── Component ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth()
  const isAdmin = ADMIN_ROLES.has(user?.role ?? '')
  const { data, isLoading, isError, error } = useDashboard()
  const { data: nudges = [], isLoading: nudgesLoading } = useDashboardNudges()
  // Not fetched at all for roles that cannot load it (Branch, the only login
  // a real clinic uses): the request would always 403 for them, and firing
  // it anyway would risk that 403 being swallowed into an empty list. See
  // `isAdmin` gating on the card below and `auditError` for a genuine failure.
  const {
    data: auditData = [],
    isLoading: auditLoading,
    isError: auditError,
  } = useAuditRecent(24, { enabled: isAdmin })
  const { data: shiftResponse, isLoading: shiftLoading } = useCurrentShift()

  const shift = shiftResponse?.data ?? null

  const navigate = useNavigate()
  const qc = useQueryClient()
  const [closeDrawerOpen, setCloseDrawerOpen] = useState(false)
  // Fetch the live drawer session only when the shift reports an open drawer —
  // avoids 404-spamming /api/cash-drawer/current for accounts with no drawer.
  const { data: drawerSession } = useCurrentDrawer({
    enabled: shift?.drawerState === 'Open',
  })
  const canCloseDrawer = drawerSession?.state === 'Open'

  const stats = data?.stats ?? {
    patientsToday: 0,
    encountersToday: 0,
    scheduledOrdersDueToday: 0,
    pendingPayments: 0,
    walkInCount: 0,
    bookedCount: 0,
    unsettledTotal: '0.00',
    cashCollectedToday: '0.00',
    nonCashCollectedToday: '0.00',
    trend7d: { arrivals: [], revenue: [], unsettled: [] },
  }
  // Money series crosses the API as numeric(12,2) strings — parse for the sparkline.
  const revenueTrend = stats.trend7d.revenue.map((v) => parseFloat(v))
  const recentEncounters = data?.recentEncounters ?? []
  const lowStock = data?.lowStock ?? []

  const scheduledOrdersCounts = data?.scheduledOrderStats ?? {
    dueCount: 0,
    overdueCount: 0,
    backfillCount: 0,
    upcomingCount: 0,
  }
  const expiring7d = expiringLots7d(lowStock)
  const expiring7dSub =
    expiring7d.length > 0
      ? expiring7d
          .slice(0, 2)
          .map((l) => `${l.name} ${l.batchNumber}`)
          .join(', ')
      : 'No lots expiring soon'

  let waitingCount = 0
  let readyCount = 0
  for (const e of recentEncounters) {
    if (e.status === 'Pending') waitingCount++
    else if (e.status === 'Completed') readyCount++
  }
  const allCount = recentEncounters.length

  const today = new Date()

  const drawerValue = shift ? formatMoney(shift.drawerBalance) : '—'
  const drawerSub = shift
    ? `${shift.drawerState.toUpperCase()} · ${shift.cashierName}`
    : 'No open shift'

  const cashValue = formatMoney(stats.cashCollectedToday)
  const nonCashValue = formatMoney(stats.nonCashCollectedToday)

  const unsettledValue =
    stats.unsettledTotal && stats.unsettledTotal !== '0.00'
      ? formatMoney(stats.unsettledTotal)
      : 'PHP 0'

  const compliancePct = shift ? `${Math.round(shift.complianceRate * 100)}%` : '—'

  return (
    <ScrollArea className="h-full">
      <div className="p-6 xl:p-8 space-y-6 xl:space-y-8">
        {/* ── Page header ── */}
        <PageHeader
          title="Dashboard"
          description={`${formatEyebrowDate(today)}${shift ? ` · Shift ${shiftTimeDisplay(shift.startedAt)} · ${shift.cashierName}` : ''}`}
          actions={
            <>
              <ShiftDropdown
                shift={shift}
                onPrintEod={() => navigate('/day-summary?print=1')}
                onCloseDrawer={() => setCloseDrawerOpen(true)}
                canCloseDrawer={Boolean(canCloseDrawer)}
              />
              <Button asChild variant="outline" size="sm">
                <Link to="/branch/kiosk">
                  <Fingerprint className="h-3.5 w-3.5 mr-1.5" aria-hidden /> Staff kiosk
                </Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/arrivals">
                  <Plus className="h-3.5 w-3.5 mr-1.5" aria-hidden /> New arrival
                </Link>
              </Button>
            </>
          }
        />

        {drawerSession && (
          <DrawerCloseDialog
            session={drawerSession}
            open={closeDrawerOpen}
            onOpenChange={setCloseDrawerOpen}
            trigger={false}
            onSuccess={() => {
              void qc.invalidateQueries({ queryKey: ['shifts'] })
              void qc.invalidateQueries({ queryKey: ['cash-drawer'] })
              void qc.invalidateQueries({ queryKey: ['dashboard'] })
            }}
          />
        )}

        {user?.role === 'Nurse' && <NurseWidgets />}

        {isError && (
          <Card className="border-destructive/30">
            <CardContent className="p-4">
              <p className="text-sm text-destructive">
                Failed to load dashboard: {error instanceof Error ? error.message : 'Unknown error'}
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── KPI ruled strip — shared KpiStrip primitive (intrinsic auto-fit) ── */}
        <Card className="overflow-hidden">
          <KpiStrip>
            {isLoading ? (
              Array.from({ length: 7 }).map((_, i) => <KpiSkeleton key={i} />)
            ) : (
              <>
                <KpiCell
                  label="Arrivals today"
                  value={stats.patientsToday}
                  badgeLabel="Info"
                  badgeTone="info"
                  subtitle={`${stats.walkInCount} walk-in · ${stats.bookedCount} booked`}
                  trend={stats.trend7d.arrivals}
                />
                <KpiCell
                  label="Scheduled queue"
                  value={
                    scheduledOrdersCounts.dueCount +
                    scheduledOrdersCounts.overdueCount +
                    scheduledOrdersCounts.upcomingCount
                  }
                  badgeLabel="Overdue"
                  badgeTone="overdue"
                  subtitle={`${scheduledOrdersCounts.overdueCount} overdue · ${scheduledOrdersCounts.dueCount} due · ${scheduledOrdersCounts.upcomingCount} upcoming · backfill is ${scheduledOrdersCounts.backfillCount} of overdue`}
                />
                <KpiCell
                  label="Unsettled txns"
                  value={unsettledValue}
                  badgeLabel="Due"
                  badgeTone="due"
                  subtitle={`${stats.pendingPayments} transaction${stats.pendingPayments !== 1 ? 's' : ''}`}
                  trend={stats.trend7d.unsettled}
                />
                <KpiCell
                  label="Lots ≤7d expiry"
                  value={expiring7d.length}
                  badgeLabel="Due"
                  badgeTone={expiring7d.length > 0 ? 'due' : 'ok'}
                  subtitle={expiring7dSub}
                />
                <KpiCell
                  label="Drawer · Cashier"
                  value={shiftLoading ? '…' : drawerValue}
                  badgeLabel="Ok"
                  badgeTone="ok"
                  subtitle={shiftLoading ? '…' : drawerSub}
                />
                {/* Revenue 7d series rides on the daily-money cell — the strip
                    has no dedicated "Revenue today" KPI. */}
                <KpiCell
                  label="Cash today"
                  value={cashValue}
                  subtitle="Collected to drawer"
                  trend={revenueTrend}
                />
                <KpiCell
                  label="Non-cash today"
                  value={nonCashValue}
                  subtitle="GCash · card · HMO"
                />
              </>
            )}
          </KpiStrip>
        </Card>

        {/* ── grid-asym: roster (2fr) + alerts/nudges (1fr) ── */}
        <div className="grid lg:grid-cols-[2fr_1fr] gap-6 2xl:gap-8">
          {/* Left: Today's Roster */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <span className="eyebrow">Today&apos;s Roster</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {allCount > 0
                      ? `${allCount} on floor · ${waitingCount} waiting`
                      : 'No arrivals today'}
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-0">
              <Tabs defaultValue="all">
                <div className="px-4 pb-3">
                  <TabsList className="h-8">
                    <TabsTrigger value="all" className="text-xs px-2.5 gap-1.5">
                      Active{' '}
                      <Badge variant="secondary" className="text-2xs px-1.5 py-0">
                        {allCount}
                      </Badge>
                    </TabsTrigger>
                    <TabsTrigger value="waiting" className="text-xs px-2.5 gap-1.5">
                      Needs attention{' '}
                      <Badge variant="secondary" className="text-2xs px-1.5 py-0">
                        {waitingCount}
                      </Badge>
                    </TabsTrigger>
                    <TabsTrigger value="ready" className="text-xs px-2.5 gap-1.5">
                      Done{' '}
                      <Badge variant="secondary" className="text-2xs px-1.5 py-0">
                        {readyCount}
                      </Badge>
                    </TabsTrigger>
                  </TabsList>
                </div>

                {isLoading ? (
                  <ListSkeleton rows={5} />
                ) : (
                  <>
                    <TabsContent value="all" className="mt-0">
                      <RosterTable
                        encounters={recentEncounters.slice(0, 5)}
                        emptyMessage={
                          allCount === 0
                            ? 'No arrivals recorded yet.'
                            : 'No entries match this filter.'
                        }
                      />
                    </TabsContent>
                    <TabsContent value="waiting" className="mt-0">
                      <RosterTable
                        encounters={recentEncounters
                          .filter((e) => e.status === 'Pending')
                          .slice(0, 5)}
                        emptyMessage="No waiting arrivals."
                      />
                    </TabsContent>
                    <TabsContent value="ready" className="mt-0">
                      <RosterTable
                        encounters={recentEncounters
                          .filter((e) => e.status === 'Completed')
                          .slice(0, 5)}
                        emptyMessage="No completed arrivals yet."
                      />
                    </TabsContent>
                  </>
                )}
              </Tabs>
            </CardContent>
          </Card>

          {/* Right: Inventory Alerts + Other nudges */}
          <div className="flex flex-col gap-6">
            {/* Inventory Alerts */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="eyebrow">Inventory Alerts</span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {isLoading
                        ? '…'
                        : `${lowStock.length} lot${lowStock.length !== 1 ? 's' : ''} flagged`}
                    </p>
                  </div>
                  <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                    <Link to="/inventory">View all</Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {isLoading ? (
                  <ListSkeleton rows={3} />
                ) : lowStock.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-1">No inventory alerts.</p>
                ) : (
                  <div className="space-y-3">
                    {lowStock.slice(0, 5).map((lot) => {
                      const sev = lotSeverity(lot.expiryDate)
                      const label =
                        lot.quantityOnHand === 0 ? 'Out of stock' : lotExpiryLabel(lot.expiryDate)
                      return (
                        <div key={lot.id} className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">{lot.name}</div>
                            <div className="text-xs text-muted-foreground font-mono tabular-nums mt-0.5">
                              Lot {lot.batchNumber} · {lot.quantityOnHand} vials
                            </div>
                          </div>
                          <Badge variant={sev} className="text-xs shrink-0">
                            {label}
                          </Badge>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Other nudges */}
            <Card>
              <CardHeader className="pb-2">
                <span className="eyebrow">Other nudges</span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {nudgesLoading ? '…' : `${nudges.length} item${nudges.length !== 1 ? 's' : ''}`}
                </p>
              </CardHeader>
              <CardContent className="pt-0 px-0">
                {nudgesLoading ? (
                  <ListSkeleton rows={2} />
                ) : nudges.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-4 py-2">Nothing to surface.</p>
                ) : (
                  nudges.slice(0, 4).map((nudge, i) => (
                    <Link
                      key={nudge.id}
                      to={nudge.link}
                      className={`stripe flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors${
                        i > 0 ? ' border-t' : ''
                      }`}
                      data-severity={nudge.severity}
                    >
                      <Badge variant={nudge.severity} className="text-xs shrink-0">
                        {nudge.kind === 'overdue_order'
                          ? 'Overdue'
                          : nudge.kind === 'pending_transaction'
                            ? 'Pending'
                            : 'Expiry'}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{nudge.label}</div>
                        <div className="text-xs text-muted-foreground">{nudge.sub}</div>
                      </div>
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ── Lower 3-column row ── */}
        <div className="grid lg:grid-cols-3 gap-6 2xl:gap-8">
          {/* Shift card — wired */}
          <Card>
            <CardHeader className="pb-2">
              <span className="eyebrow">Current shift</span>
              <CardTitle className="text-sm font-semibold">Shift</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {shiftLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-5 w-full" />
                  ))}
                </div>
              ) : shift ? (
                <div className="space-y-2">
                  <ShiftRow label="Started" value={shiftTimeDisplay(shift.startedAt)} />
                  <ShiftRow label="Encounters" value={`${shift.encountersBookedToday} today`} />
                  <ShiftRow
                    label="Doses given"
                    value={`${shift.dosesAdministeredToday} of ${shift.dosesScheduledToday} sched.`}
                  />
                  <ShiftRow label="Compliance" value={compliancePct} />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No open shift for your account.</p>
              )}
            </CardContent>
          </Card>

          {/* Expiring lots — wired */}
          <Card>
            <CardHeader className="pb-2">
              <span className="eyebrow">Inventory · Expiry</span>
              <CardTitle className="text-sm font-semibold">Expiring lots</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 px-0 pb-0">
              {isLoading ? (
                <ListSkeleton rows={3} />
              ) : lowStock.length === 0 ? (
                <p className="text-xs text-muted-foreground px-4 py-2">No lots in watch list.</p>
              ) : (
                lowStock.slice(0, 3).map((lot, i) => {
                  const sev = lotSeverity(lot.expiryDate)
                  return (
                    <div
                      key={lot.id}
                      data-severity={sev}
                      className={`stripe flex items-center justify-between px-4 py-3 gap-3${i > 0 ? ' border-t' : ''}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{lot.name}</p>
                        <p className="text-xs text-muted-foreground font-mono tabular-nums mt-0.5">
                          {lot.batchNumber} · {lot.quantityOnHand} units
                        </p>
                      </div>
                      <Badge variant={sev} className="text-xs shrink-0 font-mono tabular-nums">
                        {lotExpiryLabel(lot.expiryDate)}
                      </Badge>
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>

          {/* Audit · last 24h, admin-only: the endpoint 403s for every other
              role (see `useAuditRecent`'s doc comment), so non-admins never
              see this card at all instead of a card that always reads
              "no events" for a reason unrelated to actual audit activity. */}
          {isAdmin && (
            <Card>
              <CardHeader className="pb-2">
                <span className="eyebrow">System · last 24h</span>
                <CardTitle className="text-sm font-semibold">Audit</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 px-0 pb-0">
                {auditLoading ? (
                  <ListSkeleton rows={3} />
                ) : auditError ? (
                  <p className="text-xs text-destructive px-4 py-3">
                    Could not load audit events. Refresh to try again.
                  </p>
                ) : auditData.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-4 py-3">
                    No audit events in the last 24h.
                  </p>
                ) : (
                  auditData.slice(0, 5).map((entry, i) => (
                    <div
                      key={entry.id}
                      data-severity={auditSeverityToVariant(entry.severity)}
                      className={`stripe flex items-start gap-3 px-4 py-3${i > 0 ? ' border-t' : ''}`}
                    >
                      <span className="text-xs text-muted-foreground font-mono tabular-nums shrink-0 pt-0.5">
                        {formatTimestamp(entry.timestamp)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground leading-snug">{entry.message}</p>
                        {(entry.structuredEntityId || entry.structuredEntityType) && (
                          <p className="text-xs text-muted-foreground mt-0.5 font-mono tabular-nums truncate">
                            {entry.structuredEntityType}
                            {entry.structuredEntityId ? ` · ${entry.structuredEntityId}` : ''}
                          </p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </ScrollArea>
  )
}

// ── Shift row helper ─────────────────────────────────────────────────────────

function ShiftRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-mono tabular-nums font-medium">{value}</span>
    </div>
  )
}
