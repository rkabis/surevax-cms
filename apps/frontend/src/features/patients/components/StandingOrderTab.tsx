import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { CalendarCheck, CalendarClock, CalendarX, AlertCircle, PiggyBank } from 'lucide-react'
import { useStandingOrderProgress, usePatientStandingOrders } from '../api'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import CollectPaymentDialog from '@/features/scheduled-orders/components/CollectPaymentDialog'
import { cn } from '@/lib/utils'

type Props = {
  patientId: string
  patientName?: string
  /**
   * True when this patient is homed at a different branch than the caller's
   * session (same signal PatientDetail.tsx computes for the cross-branch
   * banner/masking). Cross-branch writes are rejected server-side, so the
   * prepay affordance is not offered here rather than offered and left to
   * fail later.
   */
  isCrossBranch?: boolean
}

const STATUS_BADGE: Record<string, 'ok' | 'due' | 'overdue' | 'outline'> = {
  completed: 'ok',
  pending: 'outline',
  missed: 'overdue',
}

const STATUS_ICON: Record<string, typeof CalendarCheck> = {
  completed: CalendarCheck,
  pending: CalendarClock,
  missed: CalendarX,
}

function PrepayTrigger({ onClick }: { onClick: () => void }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1 px-2" onClick={onClick}>
            <PiggyBank className="h-3.5 w-3.5" aria-hidden />
            Prepay a dose
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Collect payment ahead for any unbilled dose in this schedule, regardless of date. Does not
          administer anything.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function DoseCard({
  label,
  doseNumber,
  status,
  scheduledDate,
  administeredAt,
}: {
  label: string
  doseNumber: number
  status: 'completed' | 'pending' | 'missed'
  scheduledDate: string | null
  administeredAt: string | null
}) {
  const Icon = STATUS_ICON[status] ?? CalendarClock

  return (
    <div
      data-severity={status === 'missed' ? 'overdue' : status === 'completed' ? 'ok' : 'info'}
      className="stripe flex items-start gap-3 rounded-lg border bg-card p-3"
    >
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
          status === 'completed' && 'border-triage-ok/35 bg-triage-ok-soft text-triage-ok',
          status === 'missed' &&
            'border-triage-overdue/35 bg-triage-overdue-soft text-triage-overdue',
          status === 'pending' && 'border-border bg-muted text-muted-foreground',
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">
            {label}
            <span className="ml-1.5 font-mono text-xs text-muted-foreground">
              (Dose {doseNumber})
            </span>
          </p>
          <Badge variant={STATUS_BADGE[status] ?? 'outline'} className="text-xs">
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </Badge>
        </div>
        <div className="mt-1.5 flex items-center gap-4 text-xs text-muted-foreground">
          <span>
            Scheduled:{' '}
            <span className="font-medium text-foreground">
              {scheduledDate ? format(new Date(scheduledDate), 'MMM d, yyyy') : '—'}
            </span>
          </span>
          {administeredAt && (
            <span>
              Given:{' '}
              <span className="font-medium text-triage-ok">
                {format(new Date(administeredAt), 'MMM d, yyyy h:mm a')}
              </span>
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function StandingOrderTab({ patientId, patientName, isCrossBranch = false }: Props) {
  const { data, isLoading, isError } = useStandingOrderProgress(patientId)
  const standingOrdersQuery = usePatientStandingOrders(patientId)
  const [prepayOpen, setPrepayOpen] = useState(false)

  // Any order belonging to this same indication's chain works: the collect
  // picker (`getPrepayableDoses`) loads the WHOLE chain from any one order id
  // in it. Prefer one that is actually unbilled so the picker opens with it
  // preselected; falling back to any chain order would still work but would
  // preselect nothing. Cancelled orders never appear in this list at all, so
  // "nothing with paymentStatus === null" already means a cancelled chain or
  // a fully paid-and-completed one, both of which are the "cannot work"
  // cases this affordance must suppress for.
  //
  // Deliberately independent of `data.status`: `startStandingOrderTx`
  // (backend) now writes `clinical_orders.indication` from the template's own
  // identity (nurse-testing-readiness fix), so `useStandingOrderProgress`
  // classifies PEP/PrEP correctly for any course created through the app from
  // here on. Rows created before that fix still carry `indication: null` and
  // read back as `status: "not-started"` regardless of real progress, so this
  // stays computed from the independently-correct `usePatientStandingOrders`
  // list rather than gated on `data.status`, which keeps the prepay
  // affordance reachable for both old and new data, and it is shown in both
  // the schedule view and the "no orders" empty state below.
  const prepayOrder = useMemo(() => {
    const rows = standingOrdersQuery.data?.data ?? []
    const chain = rows.filter((o) => !data?.indication || o.indication === data.indication)
    return chain.find(isEligiblePrepaymentOrder) ?? null
  }, [standingOrdersQuery.data, data?.indication])

  const canPrepay = !isCrossBranch && !!prepayOrder

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive">
        <AlertCircle className="h-4 w-4" aria-hidden />
        Failed to load standing order schedule.
      </div>
    )
  }

  if (!data || data.status === 'not-started') {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm">Standing order schedule</CardTitle>
                <CardDescription>No standing orders found for this patient.</CardDescription>
              </div>
              {canPrepay && <PrepayTrigger onClick={() => setPrepayOpen(true)} />}
            </div>
          </CardHeader>
        </Card>
        {prepayOrder && (
          <CollectPaymentDialog
            open={prepayOpen}
            onOpenChange={setPrepayOpen}
            orderId={prepayOrder.id}
            patientId={patientId}
            patientName={patientName}
            prepaymentOnly
          />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm">
                {data.indication ?? 'Standing order schedule'}
              </CardTitle>
              <CardDescription>
                {data.completedDoses} of {data.totalDoses} doses completed
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {canPrepay && <PrepayTrigger onClick={() => setPrepayOpen(true)} />}
              <Badge
                variant={
                  data.status === 'completed'
                    ? 'ok'
                    : data.status === 'missed'
                      ? 'overdue'
                      : data.status === 'in-progress'
                        ? 'due'
                        : 'outline'
                }
              >
                {data.status === 'in-progress'
                  ? 'In progress'
                  : data.status.charAt(0).toUpperCase() + data.status.slice(1)}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.doses.map((dose) => (
            <DoseCard
              key={dose.doseNumber}
              label={dose.label}
              doseNumber={dose.doseNumber}
              status={dose.status}
              scheduledDate={dose.scheduledDate}
              administeredAt={dose.administeredAt}
            />
          ))}
        </CardContent>
      </Card>
      {prepayOrder && (
        <CollectPaymentDialog
          open={prepayOpen}
          onOpenChange={setPrepayOpen}
          orderId={prepayOrder.id}
          patientId={patientId}
          patientName={patientName}
          prepaymentOnly
        />
      )}
    </div>
  )
}

/** Patient-account prepay can only start from a live, unbilled order. */
export function isEligiblePrepaymentOrder(order: {
  status: string
  paymentStatus: string | null
}): boolean {
  return (
    order.paymentStatus === null && order.status !== 'Completed' && order.status !== 'Cancelled'
  )
}
