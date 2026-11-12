import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, ClipboardList, PhoneCall, Timer } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useEncounters } from '@/features/encounters/api'
import { useScheduledOrders } from '@/features/scheduled-orders/api'
import { useShift } from '@/features/shift/context'

function isToday(iso: string | null | undefined): boolean {
  if (!iso) return false
  const d = new Date(iso)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

function formatDuration(ms: number): string {
  if (ms < 0) ms = 0
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

function useLiveDuration(startIso: string | null | undefined): string | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!startIso) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [startIso])
  if (!startIso) return null
  const start = new Date(startIso).getTime()
  if (Number.isNaN(start)) return null
  return formatDuration(now - start)
}

export function NurseWidgets() {
  const navigate = useNavigate()
  const { activeShift, isLoading: shiftLoading } = useShift()

  const encountersQuery = useEncounters()
  const scheduledOrdersQuery = useScheduledOrders('', 'today')

  const todayEncountersCount = useMemo(() => {
    const rows = encountersQuery.data?.data ?? []
    return rows.filter((r) => isToday(r.startedAt)).length
  }, [encountersQuery.data])

  const pendingScheduledCount = useMemo(() => {
    const rows = scheduledOrdersQuery.data?.data ?? []
    return rows.filter((r) => r.status === 'Scheduled' || r.status === 'Pending').length
  }, [scheduledOrdersQuery.data])

  const shiftDuration = useLiveDuration(activeShift?.clockInAt ?? null)

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 xl:gap-6">
      <NurseWidgetCard
        icon={ClipboardList}
        title="Today's encounters"
        isLoading={encountersQuery.isLoading}
        value={todayEncountersCount}
        cta="View encounters"
        onClick={() => navigate('/encounters')}
      />
      <NurseWidgetCard
        icon={PhoneCall}
        title="Scheduled today"
        isLoading={scheduledOrdersQuery.isLoading}
        value={pendingScheduledCount}
        cta="Open scheduled orders"
        onClick={() => navigate('/scheduled-orders')}
      />
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Timer className="h-4 w-4 text-muted-foreground" aria-hidden />
            <CardTitle className="text-sm font-semibold">Active shift</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {shiftLoading ? (
            <Skeleton className="h-8 w-32" />
          ) : shiftDuration ? (
            <p className="text-2xl font-semibold tabular-nums" aria-label="Active shift duration">
              {shiftDuration}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Not clocked in.</p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            {activeShift?.clockInAt
              ? `Started ${new Date(activeShift.clockInAt).toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                })}`
              : 'Clock in from the shift menu to start tracking.'}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function NurseWidgetCard({
  icon: Icon,
  title,
  value,
  cta,
  onClick,
  isLoading,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  value: number
  cta: string
  onClick: () => void
  isLoading: boolean
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <Skeleton className="h-8 w-12" />
        ) : (
          <p className="text-2xl font-semibold">{value}</p>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1 mt-2 -ml-2"
          onClick={onClick}
        >
          {cta} <ArrowRight className="h-3 w-3" aria-hidden />
        </Button>
      </CardContent>
    </Card>
  )
}
