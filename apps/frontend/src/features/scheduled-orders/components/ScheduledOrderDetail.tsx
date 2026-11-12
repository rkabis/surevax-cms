import { useEffect, useState } from 'react'
import { differenceInYears } from 'date-fns'

import { useScheduledOrder, useTimeline, useRecomputePreview, type TimelineEntry } from '../api'
import { AdministerPanel } from './AdministerDialog'
import { CollectPaymentPanel } from './CollectPaymentDialog'
import RescheduleDialog from './RescheduleDialog'
import { useAuth } from '@/features/auth/context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ErrorBanner } from '@/components/layout'
import { humanizeStatus } from '@/lib/status'

type Props = { orderId: string }

// ── continuous flow steps (Pattern 35) ────────────────────────────────────────

type FlowStep = 'review' | 'administer' | 'collect'

const FLOW_STEPS: Array<{ key: FlowStep; label: string }> = [
  { key: 'review', label: 'Review' },
  { key: 'administer', label: 'Administer' },
  { key: 'collect', label: 'Collect' },
]

function FlowStepRail({ step }: { step: FlowStep }) {
  const activeIdx = FLOW_STEPS.findIndex((st) => st.key === step)
  return (
    <ol className="flex items-center gap-2" aria-label="Flow steps">
      {FLOW_STEPS.map((st, i) => (
        <li key={st.key} className="flex items-center gap-2">
          {i > 0 && <span aria-hidden className="w-4 h-px bg-border" />}
          <span
            aria-current={st.key === step ? 'step' : undefined}
            className={
              st.key === step
                ? 'inline-flex items-center gap-1.5 text-2xs font-mono font-semibold uppercase tracking-wider text-primary'
                : i < activeIdx
                  ? 'inline-flex items-center gap-1.5 text-2xs font-mono uppercase tracking-wider text-triage-ok'
                  : 'inline-flex items-center gap-1.5 text-2xs font-mono uppercase tracking-wider text-muted-foreground/60'
            }
          >
            <span
              aria-hidden
              className={
                st.key === step
                  ? 'h-1.5 w-1.5 rounded-full bg-primary'
                  : i < activeIdx
                    ? 'h-1.5 w-1.5 rounded-full bg-triage-ok'
                    : 'h-1.5 w-1.5 rounded-full bg-muted-foreground/30'
              }
            />
            {st.label}
          </span>
        </li>
      ))}
    </ol>
  )
}

// ── timeline helpers ──────────────────────────────────────────────────────────

type TimelineSev = 'ok' | 'overdue' | 'info'

function timelineStateSev(state: TimelineEntry['state']): TimelineSev {
  if (state === 'completed') return 'ok'
  if (state === 'overdue') return 'overdue'
  return 'info'
}

function timelineStateLabel(state: TimelineEntry['state']): string {
  if (state === 'completed') return 'done'
  if (state === 'overdue') return 'overdue'
  if (state === 'cancelled') return 'cancelled'
  if (state === 'due') return 'due today'
  return 'upcoming'
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-PH', { day: 'numeric', month: 'short' })
}

function formatShortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
}

// ── status badge variant ──────────────────────────────────────────────────────

function statusBadgeVariant(status: string): 'ok' | 'overdue' | 'due' | 'info' | 'outline' {
  if (status === 'Completed') return 'ok'
  if (status === 'Missed') return 'overdue'
  if (status === 'Pending') return 'due'
  return 'outline'
}

function payBadgeVariant(paymentStatus: string | null): 'ok' | 'overdue' | 'info' | 'outline' {
  if (paymentStatus === 'Paid') return 'ok'
  if (paymentStatus === 'Voided' || paymentStatus === 'Refunded') return 'overdue'
  return 'info'
}

// ── main component ────────────────────────────────────────────────────────────

export default function ScheduledOrderDetail({ orderId }: Props) {
  // Continuous flow (Pattern 35): review → administer → collect happen
  // INSIDE the rail — no stacked dialogs. Panels reset by unmounting.
  const [step, setStep] = useState<FlowStep>('review')
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const { user } = useAuth()

  // New order selected → restart the flow at review.
  useEffect(() => {
    setStep('review')
  }, [orderId])

  const { data: order, isLoading, isError } = useScheduledOrder(orderId)
  const { data: timeline, isLoading: timelineLoading } = useTimeline(orderId)
  const { data: preview, isLoading: previewLoading } = useRecomputePreview(orderId)

  const isCompleted = order?.status === 'Completed'

  // ⌘↵ / Ctrl+↵ advances review → administer while the rail is open and the
  // order is not yet completed. (The administer step's own ⌘↵ commits —
  // AdministerPanel binds it only while mounted.) AppShell binds ⌘K (key 'k')
  // globally — different key, no collision.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !isCompleted && step === 'review') {
        e.preventDefault()
        setStep('administer')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isCompleted, step])

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
        <Separator className="my-3" />
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      </div>
    )
  }

  if (isError || !order) {
    return <ErrorBanner message="Failed to load scheduled order." className="p-6" />
  }

  const patient = order.patient
  const dob = patient?.dateOfBirth ?? null
  const age = dob ? differenceInYears(new Date(), new Date(dob + 'T00:00:00')) : null

  const paymentStatus = order.paymentStatus
  const administerBlocked = isCompleted

  const patientName = patient ? `${patient.firstName} ${patient.lastName}` : 'Unknown patient'
  const serviceName = order.service?.name ?? '—'

  const timelineEntries = timeline ?? []
  const downstreamEntries = preview?.downstream ?? []
  const changedDownstreamEntries = downstreamEntries.filter((entry) => entry.deltaDays !== 0)

  return (
    <>
      <ScrollArea className="h-full">
        <div className="p-6 space-y-0">
          <SheetHeader className="mb-4 p-0 text-left">
            <span className="eyebrow mb-1">Scheduled order</span>
            <SheetTitle className="text-xl">{patientName}</SheetTitle>
            <SheetDescription asChild>
              <div className="flex items-center gap-1.5 flex-wrap mt-1">
                {age !== null && <span className="text-xs text-muted-foreground">{age} yrs</span>}
                {order.indication && (
                  <span className="text-xs text-muted-foreground">· {order.indication}</span>
                )}
              </div>
            </SheetDescription>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge variant={statusBadgeVariant(order.status)} className="text-xs">
                {humanizeStatus(order.status)}
              </Badge>
              <Badge variant={payBadgeVariant(paymentStatus)} className="text-xs">
                {paymentStatus ? humanizeStatus(paymentStatus) : 'No payment'}
              </Badge>
            </div>
          </SheetHeader>

          <FlowStepRail step={step} />

          <Separator className="my-3" />

          {step === 'administer' && (
            <AdministerPanel
              orderId={orderId}
              orderSummary={{
                patientName,
                patientMrn: patient?.mrn ?? null,
                patientDateOfBirth: patient?.dateOfBirth ?? null,
                serviceName,
                serviceCode: order.service?.id ?? null,
                requiresDoseCalculation: order.service?.requiresDoseCalculation ?? false,
                doseNumber: order.doseNumber,
                scheduledDate: order.currentScheduledDate,
                quantity: order.quantity,
                administrationRoute: order.administrationRoute,
                administrationSite: order.administrationSite,
                indication: order.indication,
                allergies: patient?.allergies ?? [],
                activeConditions: patient?.activeConditions ?? [],
              }}
              onClose={() => setStep('review')}
              onCollectPayment={patient ? () => setStep('collect') : undefined}
            />
          )}

          {step === 'collect' && patient && (
            <CollectPaymentPanel
              orderId={orderId}
              patientId={patient.id}
              patientName={patientName}
              onClose={() => setStep('review')}
            />
          )}

          {step === 'review' && (
            <>
              <section>
                <span className="eyebrow">
                  Protocol timeline · {order.standingOrder?.template?.name ?? '—'}
                </span>

                {timelineLoading && (
                  <div className="mt-3 space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-10" />
                    ))}
                  </div>
                )}

                {!timelineLoading && timelineEntries.length === 0 && (
                  <p className="mt-3 text-sm text-muted-foreground">No timeline yet.</p>
                )}

                {!timelineLoading && timelineEntries.length > 0 && (
                  <ol className="mt-3 space-y-0 relative">
                    {timelineEntries.map((entry, idx) => {
                      const sev = timelineStateSev(entry.state)
                      const isLast = idx === timelineEntries.length - 1
                      const shortDate = formatShortDate(entry.scheduledAt)
                      const shortTime = entry.administeredAt
                        ? formatShortTime(entry.administeredAt)
                        : null

                      return (
                        <li key={entry.id} className="flex gap-3 relative">
                          <div className="flex flex-col items-center w-4 shrink-0 relative">
                            <span
                              className="dot mt-1"
                              data-severity={sev}
                              style={{ width: 9, height: 9 }}
                            />
                            {!isLast && (
                              <div className="flex-1 w-px bg-border mt-1 mb-0 min-h-[1.25rem]" />
                            )}
                          </div>

                          <div className="pb-4 flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold">Dose {entry.day}</span>
                              <Badge variant={sev} className="text-xs">
                                {timelineStateLabel(entry.state)}
                              </Badge>
                              <span className="font-mono tabular-nums text-xs text-muted-foreground">
                                {shortDate}
                                {shortTime ? ` · ${shortTime}` : ''}
                              </span>
                            </div>

                            <p className="text-xs text-muted-foreground mt-0.5">
                              {entry.byClinician && <>by {entry.byClinician} · </>}
                              <span className="font-mono tabular-nums">{entry.doseSize}</span>
                            </p>

                            {entry.note && (
                              <p className="text-xs text-muted-foreground italic mt-0.5">
                                {entry.note}
                              </p>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                )}
              </section>

              <Separator className="my-3" />

              <section>
                <span className="eyebrow">On completion · schedule update</span>

                {previewLoading && (
                  <div className="mt-3 space-y-2">
                    <Skeleton className="h-8" />
                    <Skeleton className="h-8" />
                  </div>
                )}

                {!previewLoading && !preview && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    No downstream doses to recompute.
                  </p>
                )}

                {!previewLoading && preview && (
                  <Card className="mt-3">
                    <CardContent className="pt-4 pb-3 px-4">
                      {downstreamEntries.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No downstream doses to recompute.
                        </p>
                      ) : (
                        <ol className="space-y-2.5">
                          {downstreamEntries.map((effect, idx) => (
                            <li key={effect.id} className="flex items-start gap-2.5">
                              <span className="font-mono tabular-nums text-xs text-muted-foreground w-4 shrink-0 mt-0.5">
                                {idx + 1}.
                              </span>
                              <span className="dot mt-1 shrink-0" data-severity="info" />
                              <p className="text-sm leading-snug">
                                Day {effect.day}{' '}
                                <span className="font-mono tabular-nums">
                                  {formatShortDate(effect.fromDate)}
                                </span>{' '}
                                →{' '}
                                <span className="font-mono tabular-nums">
                                  {formatShortDate(effect.toDate)}
                                </span>
                                {effect.deltaDays !== 0 ? (
                                  <span className="text-muted-foreground">
                                    {' '}
                                    ({effect.deltaDays > 0 ? '+' : ''}
                                    {effect.deltaDays}d)
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground"> (unchanged)</span>
                                )}
                              </p>
                            </li>
                          ))}
                        </ol>
                      )}
                    </CardContent>
                  </Card>
                )}
              </section>

              <Separator className="my-3" />

              <div className="space-y-2 pt-1 pb-4">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setRescheduleOpen(true)}
                    disabled={isCompleted}
                  >
                    Reschedule
                  </Button>
                  <Button
                    variant="default"
                    className="flex-[1.5] gap-2"
                    disabled={administerBlocked}
                    onClick={() => setStep('administer')}
                  >
                    Review administration
                    <kbd className="inline-flex h-5 select-none items-center gap-1 rounded border border-primary-foreground/30 bg-primary-foreground/20 px-1.5 font-mono text-xs font-medium">
                      ⌘↵
                    </kbd>
                  </Button>
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={!patient}
                  onClick={() => setStep('collect')}
                >
                  Collect payment
                </Button>

                <p className="text-xs text-muted-foreground text-center">
                  Authorized by{' '}
                  <span className="font-mono tabular-nums">
                    {user ? `Dr. ${user.firstName[0]}. ${user.lastName}` : 'Dr. P. Lim'}
                  </span>{' '}
                  · the final confirmation records the dose
                  {changedDownstreamEntries.length > 0
                    ? ` and shifts ${changedDownstreamEntries.length} downstream dose${changedDownstreamEntries.length === 1 ? '' : 's'}`
                    : '; the downstream schedule is unchanged'}
                </p>
              </div>
            </>
          )}
        </div>
      </ScrollArea>

      <RescheduleDialog
        open={rescheduleOpen}
        onOpenChange={setRescheduleOpen}
        orderId={orderId}
        orderSummary={{
          patientName,
          serviceName,
          doseNumber: order.doseNumber,
        }}
      />
    </>
  )
}
