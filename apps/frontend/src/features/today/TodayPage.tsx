import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  UserPlus,
  CalendarCheck,
  ArrowRight,
  RefreshCw,
  WifiOff,
  AlertTriangle,
  KeyRound,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader, KpiStrip, KpiCell } from '@/components/layout'
import { useAuth, type AuthUser } from '@/features/auth/context'
import { useBranchStaff } from '@/features/branch/api'
import { useDashboard } from '@/features/dashboard/api'
import {
  useSetTodayRosterOwner,
  useTodayRoster,
  type TodayRosterRow,
} from '@/features/day-summary/api'
import { useScheduledOrders, type ScheduledOrder } from '@/features/scheduled-orders/api'
import { useTransactions } from '@/features/transactions/api'
import { ApiError } from '@/lib/apiFetch'
import { formatMoney, formatTime } from '@/lib/format'
import { clinicCalendarDateString } from '@/lib/clinicDate'
import { cn } from '@/lib/utils'

type LaneSeverity = 'overdue' | 'due' | 'ok' | 'info'

export const TODAY_REFRESH_INTERVAL_MS = 45_000
export const TODAY_STALE_AFTER_MS = 90_000

export function canAutoRefreshToday(
  visibilityState: DocumentVisibilityState,
  online: boolean,
): boolean {
  return visibilityState === 'visible' && online
}

const handoffLabels: Record<TodayRosterRow['handoffState'], string> = {
  waiting_clinical: 'Waiting',
  in_care: 'In care',
  on_hold: 'On hold',
  awaiting_payment: 'Payment',
  complete: 'Complete',
  closed: 'Closed',
}

/**
 * Workflow-first daily worklist (PATTERNS.md Pattern 33). A branch normally
 * has one or two nurses with patients trickling in, so this keeps a compact
 * status summary and two calm, prioritized work areas instead of a dense
 * four-lane command centre. Each card still carries ONE next action that
 * deep-links into the owning surface with the record pre-selected via URL
 * state (`?selected=`).
 *
 * This page is primarily an aggregator. Its roster comes from a dedicated
 * branch-day snapshot; the only local mutation is the lightweight ownership
 * claim/handoff, while clinical actions remain on their owning surfaces.
 */
export default function TodayPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [ownerTarget, setOwnerTarget] = useState<TodayRosterRow | null>(null)
  // The transactions date filter is a clinic calendar date, not a UTC date.
  // Before 08:00 PHT, `toISOString().slice(0, 10)` would fetch yesterday.
  const today = clinicCalendarDateString()

  const {
    data: dash,
    dataUpdatedAt: dashUpdatedAt,
    isFetching: dashFetching,
    isError: dashError,
    refetch: refetchDash,
  } = useDashboard()
  const {
    data: rosterSnapshot,
    isLoading: rosterLoading,
    dataUpdatedAt: rosterUpdatedAt,
    isFetching: rosterFetching,
    isError: rosterError,
    refetch: refetchRoster,
  } = useTodayRoster(today)
  const {
    data: dueData,
    isLoading: dueLoading,
    dataUpdatedAt: dueUpdatedAt,
    isFetching: dueFetching,
    isError: dueError,
    refetch: refetchDue,
  } = useScheduledOrders('', 'today')
  const {
    data: overdueData,
    isLoading: overdueLoading,
    dataUpdatedAt: overdueUpdatedAt,
    isFetching: overdueFetching,
    isError: overdueError,
    refetch: refetchOverdue,
  } = useScheduledOrders('', 'overdue')
  const {
    data: completedOrderData,
    isLoading: completedOrderLoading,
    dataUpdatedAt: completedOrderUpdatedAt,
    isFetching: completedOrderFetching,
    isError: completedOrderError,
    refetch: refetchCompletedOrders,
  } = useScheduledOrders('', 'completed_today')
  const {
    data: pendingTx,
    isLoading: txLoading,
    dataUpdatedAt: txUpdatedAt,
    isFetching: txFetching,
    isError: txError,
    refetch: refetchTx,
  } = useTransactions({
    date: today,
    status: 'Pending',
  })

  const roster = rosterSnapshot?.roster ?? []
  const inClinic = roster.filter((e) => !['Completed', 'Cancelled', 'NoShow'].includes(e.status))
  const doneEncounters = roster.filter((e) => e.status === 'Completed')

  // Overdue first, then due-today not yet completed.
  const dueLane = useMemo(() => {
    const overdue = (overdueData?.data ?? []).filter((o) => o.status !== 'Completed')
    const seen = new Set(overdue.map((o) => o.id))
    const due = (dueData?.data ?? []).filter((o) => o.status !== 'Completed' && !seen.has(o.id))
    return { overdue, due }
  }, [dueData, overdueData])

  const pending = pendingTx?.data ?? []
  // A completed dose can still be clinically active until an explicit
  // discharge acknowledgement. `dischargedAt` is authoritative: time passing
  // alone never removes a patient from this lane.
  const activeObservations = (completedOrderData?.data ?? []).filter(
    (order) =>
      order.observation &&
      !order.observation.dischargedAt &&
      order.observation.state !== 'Discharged',
  )
  const urgentObservationCount = activeObservations.filter(
    (order) => order.observation?.state === 'Reaction' || order.observation?.state === 'Escalated',
  ).length
  const stats = dash?.stats
  const orderStats = dueData?.stats
  const dueNowCount = dueLane.overdue.length + dueLane.due.length
  const completedCount = (orderStats?.completedToday ?? 0) + doneEncounters.length
  const careDataReady = Boolean(rosterSnapshot && dueData && overdueData && completedOrderData)

  const dateLabel = new Date().toLocaleDateString('en-PH', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [freshnessClock, setFreshnessClock] = useState(() => Date.now())

  // Use the oldest successful source timestamp: reporting only the newest
  // query made a partially refreshed cockpit look current.
  const fetchedAt = Math.min(
    ...[
      rosterUpdatedAt,
      dashUpdatedAt,
      dueUpdatedAt,
      overdueUpdatedAt,
      completedOrderUpdatedAt,
      txUpdatedAt,
    ].filter((value) => value > 0),
  )
  const hasFetchedData = Number.isFinite(fetchedAt)
  const isStale = hasFetchedData && freshnessClock - fetchedAt > TODAY_STALE_AFTER_MS
  const anyError =
    rosterError || dashError || dueError || overdueError || completedOrderError || txError
  const anyFetching =
    rosterFetching ||
    dashFetching ||
    dueFetching ||
    overdueFetching ||
    completedOrderFetching ||
    txFetching

  const refreshAll = useCallback(() => {
    void Promise.all([
      refetchRoster(),
      refetchDash(),
      refetchDue(),
      refetchOverdue(),
      refetchCompletedOrders(),
      refetchTx(),
    ])
  }, [refetchCompletedOrders, refetchDash, refetchDue, refetchOverdue, refetchRoster, refetchTx])
  const refreshRef = useRef(refreshAll)
  refreshRef.current = refreshAll

  useEffect(() => {
    const refreshIfVisible = () => {
      if (canAutoRefreshToday(document.visibilityState, navigator.onLine)) {
        refreshRef.current()
      }
    }
    const updateConnectivity = () => {
      setIsOnline(navigator.onLine)
      if (navigator.onLine) refreshIfVisible()
    }
    const poll = window.setInterval(refreshIfVisible, TODAY_REFRESH_INTERVAL_MS)
    const clock = window.setInterval(() => setFreshnessClock(Date.now()), 15_000)
    document.addEventListener('visibilitychange', refreshIfVisible)
    window.addEventListener('online', updateConnectivity)
    window.addEventListener('offline', updateConnectivity)
    return () => {
      window.clearInterval(poll)
      window.clearInterval(clock)
      document.removeEventListener('visibilitychange', refreshIfVisible)
      window.removeEventListener('online', updateConnectivity)
      window.removeEventListener('offline', updateConnectivity)
    }
  }, [])

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="Today"
          description={dateLabel}
          actions={
            <>
              <span className="text-xs text-muted-foreground font-mono tabular-nums mr-1">
                {rosterSnapshot?.generatedAt
                  ? `snapshot ${formatTime(rosterSnapshot.generatedAt)}`
                  : ''}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={refreshAll}
                disabled={anyFetching}
                aria-label="Refresh today's data"
              >
                <RefreshCw
                  className={cn('h-3.5 w-3.5 mr-1.5', anyFetching && 'animate-spin')}
                  aria-hidden
                />
                Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate('/day-summary')}>
                <CalendarCheck className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                Day summary
              </Button>
              <Button size="sm" onClick={() => navigate('/arrivals')}>
                <UserPlus className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                New arrival
              </Button>
            </>
          }
        />
      </div>

      {(!isOnline || anyError || isStale) && (
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 pt-3 bg-card">
          <Alert variant={!isOnline || anyError ? 'destructive' : 'default'}>
            {!isOnline ? (
              <WifiOff className="h-4 w-4" aria-hidden />
            ) : (
              <AlertTriangle className="h-4 w-4" aria-hidden />
            )}
            <AlertTitle>
              {!isOnline ? 'Offline' : anyError ? 'Refresh incomplete' : 'View may be stale'}
            </AlertTitle>
            <AlertDescription>
              {!isOnline
                ? `Showing the last available clinic view${hasFetchedData ? ` from ${formatTime(new Date(fetchedAt))}` : ''}. Changes from other workstations will appear after reconnecting.`
                : anyError
                  ? `Some lanes could not refresh. Verify before acting${hasFetchedData ? `; the oldest visible data is from ${formatTime(new Date(fetchedAt))}` : '.'}`
                  : `The oldest visible lane was refreshed at ${formatTime(new Date(fetchedAt))}. Refresh before coordinating the next handoff.`}
            </AlertDescription>
          </Alert>
        </div>
      )}

      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-b border-border bg-card">
        <KpiStrip minColWidth="10rem">
          <KpiCell
            label="Care now"
            value={careDataReady ? inClinic.length + dueNowCount + activeObservations.length : '—'}
            subtitle={
              careDataReady
                ? `${inClinic.length} in clinic · ${dueNowCount} due · ${activeObservations.length} observation${activeObservations.length === 1 ? '' : 's'}${dueLane.overdue.length || urgentObservationCount ? ` · ${dueLane.overdue.length + urgentObservationCount} overdue` : ''}`
                : 'Loading…'
            }
            tone={dueLane.overdue.length + urgentObservationCount > 0 ? 'overdue' : 'default'}
          />
          <KpiCell
            label="Awaiting payment"
            value={pendingTx ? pending.length : '—'}
            subtitle={stats ? `${formatMoney(stats.unsettledTotal)} unsettled` : 'Loading…'}
            tone={pending.length > 0 ? 'due' : 'default'}
          />
          <KpiCell
            label="Done today"
            value={rosterSnapshot && dueData ? completedCount : '—'}
            subtitle={rosterSnapshot && dueData ? 'doses + encounters' : 'Loading…'}
            tone="ok"
          />
          <KpiCell
            label="Cash today"
            value={stats ? formatMoney(stats.cashCollectedToday) : '—'}
            subtitle="collected to drawer"
          />
        </KpiStrip>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-5 max-w-screen-2xl space-y-7">
          <WorkArea
            title="Care now"
            description="Patients present and doses that need clinical attention."
          >
            <Lane title="Due now" count={dueNowCount} loading={dueLoading || overdueLoading}>
              {dueLane.overdue.map((o) => (
                <DoseCard key={o.id} order={o} severity="overdue" />
              ))}
              {dueLane.due.map((o) => (
                <DoseCard key={o.id} order={o} severity="due" />
              ))}
              {!dueLoading && !overdueLoading && dueNowCount === 0 && (
                <LaneEmpty>No doses due.</LaneEmpty>
              )}
            </Lane>

            <Lane title="In clinic" count={inClinic.length} loading={rosterLoading}>
              {inClinic.map((e) => (
                <LaneCard
                  key={e.id}
                  severity={e.status === 'Open' ? 'info' : 'due'}
                  title={e.patientName}
                  sub={`${e.specialty} · waiting since ${formatTime(e.waitingSince)} · last action ${formatTime(e.lastActionAt)}`}
                  meta={`Claimed by ${e.claimedBy?.name ?? 'unassigned'} · Next: ${e.nextOwner?.label ?? 'none'}`}
                  badge={handoffLabels[e.handoffState]}
                  badgeTone={e.status === 'Open' ? 'info' : 'due'}
                  secondaryActionLabel={e.claimedBy ? 'Handoff' : 'Claim'}
                  onSecondaryAction={() => setOwnerTarget(e)}
                  actionLabel="Open"
                  onAction={() => navigate(`/encounters?selected=${e.id}`)}
                />
              ))}
              {!rosterLoading && inClinic.length === 0 && <LaneEmpty>No one in clinic.</LaneEmpty>}
            </Lane>

            <Lane
              title="Post-dose observation"
              count={activeObservations.length}
              loading={completedOrderLoading}
            >
              {activeObservations.map((order) => (
                <ObservationCard key={order.id} order={order} />
              ))}
              {!completedOrderLoading && activeObservations.length === 0 && (
                <LaneEmpty>No active observations.</LaneEmpty>
              )}
            </Lane>
          </WorkArea>

          <WorkArea
            title="Follow-up"
            description="Settlement and completed encounters remain available without competing with care now."
          >
            <Lane title="Awaiting payment" count={pending.length} loading={txLoading}>
              {pending.map((t) => (
                <LaneCard
                  key={t.id}
                  severity="due"
                  title={t.patientName}
                  sub={`${formatMoney(t.netAmount)} · ${t.itemCount} item${t.itemCount === 1 ? '' : 's'}`}
                  actionLabel="Collect"
                  onAction={() => navigate(`/transactions?selected=${t.id}`)}
                />
              ))}
              {!txLoading && pending.length === 0 && <LaneEmpty>Nothing unsettled.</LaneEmpty>}
            </Lane>

            <Lane title="Done today" count={doneEncounters.length} loading={rosterLoading}>
              {doneEncounters.map((e) => (
                <LaneCard
                  key={e.id}
                  severity="ok"
                  title={e.patientName}
                  sub={`${e.specialty} · last action ${formatTime(e.lastActionAt)}`}
                  meta={`Claimed by ${e.claimedBy?.name ?? 'unassigned'} · Next: ${e.nextOwner?.label ?? 'none'}`}
                  badge={handoffLabels[e.handoffState]}
                  badgeTone="ok"
                  actionLabel="View"
                  onAction={() => navigate(`/encounters?selected=${e.id}`)}
                />
              ))}
              {!rosterLoading && doneEncounters.length === 0 && (
                <LaneEmpty>Nothing completed yet.</LaneEmpty>
              )}
            </Lane>
          </WorkArea>
        </div>
      </ScrollArea>

      <ClinicalOwnerDialog
        row={ownerTarget}
        date={today}
        user={user}
        onClose={() => setOwnerTarget(null)}
      />
    </div>
  )
}

function WorkArea({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  const sectionId = `today-${title.toLowerCase().replace(/ /g, '-')}`

  return (
    <section aria-labelledby={sectionId}>
      <div className="mb-3">
        <h2 id={sectionId} className="text-sm font-semibold">
          {title}
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">{children}</div>
    </section>
  )
}

function Lane({
  title,
  count,
  loading,
  children,
}: {
  title: string
  count: number
  loading?: boolean
  children: React.ReactNode
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2 min-w-0">
      <div className="flex items-baseline justify-between px-0.5">
        <span className="eyebrow">{title}</span>
        <span className="text-xs font-mono tabular-nums text-muted-foreground">
          {loading ? '—' : count}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {loading ? (
          <>
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </>
        ) : (
          children
        )}
      </div>
    </section>
  )
}

function LaneEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-muted-foreground border border-dashed border-border rounded-lg px-3 py-4 text-center">
      {children}
    </p>
  )
}

function LaneCard({
  severity,
  title,
  sub,
  meta,
  badge,
  badgeTone,
  actionLabel,
  actionAriaLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
}: {
  severity: LaneSeverity
  title: string
  sub: string
  meta?: string
  badge?: string
  badgeTone?: LaneSeverity
  actionLabel: string
  actionAriaLabel?: string
  onAction: () => void
  secondaryActionLabel?: string
  onSecondaryAction?: () => void
}) {
  return (
    <div
      data-severity={severity}
      className="stripe rounded-lg border border-border bg-card shadow-sm px-3 py-2.5 flex items-center gap-3 min-w-0"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm font-medium truncate">{title}</p>
          {badge && (
            <Badge variant={badgeTone ?? 'info'} className="text-2xs shrink-0">
              {badge}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground font-mono tabular-nums truncate mt-0.5">
          {sub}
        </p>
        {meta && <p className="text-xs text-muted-foreground truncate mt-0.5">{meta}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {secondaryActionLabel && onSecondaryAction && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={onSecondaryAction}
          >
            {secondaryActionLabel}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={onAction}
          aria-label={actionAriaLabel}
        >
          {actionLabel}
          <ArrowRight className="h-3 w-3 ml-1" aria-hidden />
        </Button>
      </div>
    </div>
  )
}

const CLINICAL_OWNER_ROLES = ['Nurse', 'Physician', 'BranchAdmin', 'TenantAdmin']

function ClinicalOwnerDialog({
  row,
  date,
  user,
  onClose,
}: {
  row: TodayRosterRow | null
  date: string
  user: AuthUser | null
  onClose: () => void
}) {
  const staffQuery = useBranchStaff({ enabled: Boolean(row) })
  const mutation = useSetTodayRosterOwner(date)
  const [assigneeId, setAssigneeId] = useState('')
  const [pin, setPin] = useState('')

  const clinicians = useMemo(() => {
    return (staffQuery.data?.data ?? [])
      .filter((staff) => staff.isActive && CLINICAL_OWNER_ROLES.includes(staff.role))
      .sort((a, b) => {
        const shiftDelta = Number(Boolean(b.activeShift)) - Number(Boolean(a.activeShift))
        if (shiftDelta !== 0) return shiftDelta
        return `${a.lastName}${a.firstName}`.localeCompare(`${b.lastName}${b.firstName}`)
      })
  }, [staffQuery.data])

  useEffect(() => {
    setAssigneeId('')
    setPin('')
    mutation.reset()
    // Reset the form only when a different encounter is opened or closed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id])

  useEffect(() => {
    if (!row || assigneeId || clinicians.length === 0) return
    const self = user && clinicians.find((staff) => staff.id === user.id)
    const onShift = clinicians.find((staff) => staff.activeShift)
    setAssigneeId((self ?? onShift)?.id ?? '')
  }, [assigneeId, clinicians, row, user])

  const selected = clinicians.find((staff) => staff.id === assigneeId)
  const isSelf = Boolean(user && assigneeId === user.id && CLINICAL_OWNER_ROLES.includes(user.role))
  const requiresPin = Boolean(assigneeId && !isSelf)
  const actionLabel = row?.claimedBy ? 'Hand off' : 'Claim patient'
  const error = mutation.error
  const isStale = error instanceof ApiError && error.code === 'STALE_ENCOUNTER'

  const close = () => {
    if (!mutation.isPending) onClose()
  }

  const submit = () => {
    if (!row || !assigneeId || (requiresPin && !/^\d{4}$/.test(pin))) return
    mutation.mutate(
      {
        encounterId: row.id,
        body: {
          assigneeId,
          ...(requiresPin ? { attestationPin: pin } : {}),
          expectedRowVersion: row.rowVersion,
        },
      },
      { onSuccess: onClose },
    )
  }

  return (
    <Dialog open={Boolean(row)} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-md xl:max-w-lg">
        <DialogHeader>
          <DialogTitle>{actionLabel}</DialogTitle>
          <DialogDescription>
            {row
              ? `Name the clinician taking responsibility for ${row.patientName}. The roster will show this owner to the whole branch.`
              : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="today-clinical-owner">Clinical owner</Label>
            <Select
              value={assigneeId}
              onValueChange={(value) => {
                setAssigneeId(value)
                setPin('')
                mutation.reset()
              }}
              disabled={mutation.isPending || staffQuery.isPending}
            >
              <SelectTrigger id="today-clinical-owner">
                <SelectValue
                  placeholder={staffQuery.isPending ? 'Loading staff…' : 'Select clinician'}
                />
              </SelectTrigger>
              <SelectContent>
                {clinicians.map((staff) => (
                  <SelectItem key={staff.id} value={staff.id}>
                    {staff.lastName}, {staff.firstName}
                    {staff.activeShift ? ' · on shift' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {staffQuery.isError && (
              <p className="text-xs text-destructive">
                The branch staff roster could not be loaded. Refresh before assigning ownership.
              </p>
            )}
            {!staffQuery.isPending && !staffQuery.isError && clinicians.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No eligible clinical staff are assigned to this branch.
              </p>
            )}
          </div>

          {requiresPin && (
            <div className="space-y-1.5">
              <Label htmlFor="today-owner-pin">
                {selected ? `${selected.firstName}'s PIN` : 'Clinician PIN'}
              </Label>
              <div className="relative">
                <KeyRound
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="today-owner-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  placeholder="••••"
                  className="pl-9 font-mono tabular-nums tracking-[0.5em]"
                  value={pin}
                  onChange={(event) => {
                    setPin(event.target.value.replace(/\D/g, '').slice(0, 4))
                    mutation.reset()
                  }}
                  disabled={mutation.isPending}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Use the same 4-digit PIN as clock-in. This proves the named clinician accepted the
                handoff.
              </p>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertTitle>{isStale ? 'Roster changed' : 'Ownership not updated'}</AlertTitle>
              <AlertDescription>
                {isStale
                  ? 'Someone changed this encounter. Close this window, refresh Today, and try again.'
                  : error.message}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={
              mutation.isPending ||
              !assigneeId ||
              (requiresPin && !/^\d{4}$/.test(pin)) ||
              staffQuery.isError
            }
          >
            {mutation.isPending ? 'Saving…' : actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DoseCard({ order, severity }: { order: ScheduledOrder; severity: LaneSeverity }) {
  const navigate = useNavigate()
  const doseLabel = order.totalDoses
    ? `Dose ${order.doseNumber} of ${order.totalDoses}`
    : `Dose ${order.doseNumber}`
  return (
    <LaneCard
      severity={severity}
      title={order.patientName}
      sub={`${order.patientMrn ?? 'MRN unavailable'}${order.patientDateOfBirth ? ` · DOB ${order.patientDateOfBirth}` : ''} · ${order.service ?? '—'} · ${doseLabel}`}
      badge={severity === 'overdue' ? 'Overdue' : 'Due'}
      badgeTone={severity}
      actionLabel="Administer"
      actionAriaLabel={`Administer ${order.patientName}, ${order.patientMrn ?? 'MRN unavailable'}, ${doseLabel}`}
      onAction={() =>
        navigate(
          `/scheduled-orders?selected=${order.id}${severity === 'overdue' ? '&tab=overdue' : ''}`,
        )
      }
    />
  )
}

function ObservationCard({ order }: { order: ScheduledOrder }) {
  const navigate = useNavigate()
  const observation = order.observation
  if (!observation || observation.dischargedAt) return null

  const state = observation.state
  const urgent = state === 'Reaction' || state === 'Escalated'
  const ready = state === 'ReadyForDischarge'
  const severity: LaneSeverity = urgent ? 'overdue' : ready ? 'due' : 'info'
  const badge = urgent
    ? state
    : ready
      ? 'Ready for discharge'
      : state === 'Observing'
        ? 'Observing'
        : state
  const sub =
    state === 'Observing'
      ? `${order.service} · observe until ${formatTime(observation.observeUntil)}`
      : urgent
        ? `${order.service} · response overdue · observation deadline ${formatTime(observation.observeUntil)}`
        : `${order.service} · observation ended ${formatTime(observation.observeUntil)}`

  return (
    <LaneCard
      severity={severity}
      title={order.patientName}
      sub={sub}
      badge={badge}
      badgeTone={severity}
      actionLabel={urgent ? 'Respond' : ready ? 'Discharge' : 'Review'}
      actionAriaLabel={`${urgent ? 'Respond to' : ready ? 'Discharge' : 'Review'} post-dose observation for ${order.patientName}`}
      onAction={() => navigate(`/scheduled-orders?tab=completed&selected=${order.id}`)}
    />
  )
}
