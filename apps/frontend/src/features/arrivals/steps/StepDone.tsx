import { useState } from 'react'
import { Navigate, useNavigate, Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, ArrowRight, RefreshCw, MessageSquare } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { usePatient } from '@/features/patients/api'
import CollectPaymentDialog from '@/features/scheduled-orders/components/CollectPaymentDialog'
import TextPatientDialog from '@/features/scheduled-orders/components/TextPatientDialog'
import { useArrival, useWizardGuardTarget } from '../context'
import { MANUAL_REMINDER_HANDOFF_COPY } from './reminderHandoff'

export default function StepDone() {
  const navigate = useNavigate()
  const { selectedPatientId, encounterId, standingOrderId, reset } = useArrival()
  const { data: patient, isLoading: patientLoading } = usePatient(selectedPatientId)
  const [searchParams] = useSearchParams()
  const [collectOpen, setCollectOpen] = useState(false)
  const [textOpen, setTextOpen] = useState(false)
  // A chain order id (ORD_…) carried from Step 3 so we can open Collect payment
  // for the Day-0 doses without leaving the wizard.
  const day0OrderId = searchParams.get('day0OrderId')
  const patientName = patient ? `${patient.lastName}, ${patient.firstName}` : undefined

  // Guard: redirect to the earliest unlocked step if deep-linked.
  const guardTarget = useWizardGuardTarget(4)
  if (guardTarget) return <Navigate replace to={guardTarget} />

  function startAnother() {
    reset()
    navigate('/arrivals/identify')
  }

  return (
    <div className="h-full flex flex-col">
      <header className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-primary shrink-0" aria-hidden />
          <h2 className="text-lg font-semibold">Arrival complete</h2>
          <span className="dot" data-severity="ok" aria-label="complete" />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 xl:px-8 2xl:px-10 py-8">
        <div className="max-w-2xl xl:max-w-3xl mx-auto space-y-4">
          {/* Atomic commit summary — what was written */}
          <Card>
            <CardHeader className="pb-3">
              <span className="eyebrow">On commit · single transaction</span>
              <CardTitle className="text-base flex items-center gap-2 mt-0.5">
                <CheckCircle2 className="h-4 w-4 text-primary shrink-0" aria-hidden />
                Patient ready for billing
              </CardTitle>
              <CardDescription>Day-0 services must be paid before administration.</CardDescription>
            </CardHeader>

            <CardContent>
              <Separator className="mb-4" />

              {/* KV detail rows — what was created atomically */}
              <dl className="space-y-0 divide-y divide-border rounded-md border overflow-hidden">
                <KvRow label="Patient">
                  {patientLoading ? (
                    <Skeleton className="h-4 w-40" />
                  ) : patient ? (
                    <span className="font-medium">
                      {patient.lastName}, {patient.firstName}
                      {patient.middleName ? ` ${patient.middleName[0]}.` : ''}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </KvRow>

                <KvRow label="Encounter">
                  {encounterId ? (
                    <div className="flex items-center gap-2">
                      <span className="font-mono tabular-nums text-xs">{encounterId}</span>
                      <Badge variant="ok" className="text-2xs">
                        created
                      </Badge>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </KvRow>

                <KvRow label="Protocol">
                  {standingOrderId ? (
                    <div className="flex items-center gap-2">
                      <span className="font-mono tabular-nums text-xs">{standingOrderId}</span>
                      <Badge variant="ok" className="text-2xs">
                        scheduled
                      </Badge>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </KvRow>

                <KvRow label="Billing">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Day-0 charge — collect now
                    </span>
                    <Badge variant="due" className="text-2xs">
                      unsettled
                    </Badge>
                  </div>
                </KvRow>

                <KvRow label="Inventory">
                  <span className="text-xs text-muted-foreground">
                    Day-0 stock confirmed available
                  </span>
                </KvRow>
              </dl>
            </CardContent>

            <CardFooter className="flex flex-wrap items-center gap-2 border-t pt-4">
              {day0OrderId && selectedPatientId ? (
                <Button className="gap-1.5" onClick={() => setCollectOpen(true)}>
                  Collect Day-0 payment
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
              ) : (
                <Button asChild className="gap-1.5">
                  <Link to="/transactions">
                    Hand off to billing
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </Button>
              )}
              <Button variant="outline" onClick={startAnother} className="gap-1.5">
                <RefreshCw className="h-4 w-4" aria-hidden />
                Start another arrival
              </Button>
              {day0OrderId && patientName && (
                <Button variant="outline" onClick={() => setTextOpen(true)} className="gap-1.5">
                  <MessageSquare className="h-4 w-4" aria-hidden />
                  Prepare text QR
                </Button>
              )}
            </CardFooter>
          </Card>

          {/* Next steps info */}
          <div className="rounded-md border border-border bg-muted/20 px-4 py-3 space-y-1.5">
            <span className="eyebrow">Next steps</span>
            <ul className="space-y-1 mt-1">
              {[
                { sev: 'overdue' as const, text: 'Cashier: collect Day-0 payment' },
                { sev: 'due' as const, text: 'Nurse: administer once payment confirmed' },
                {
                  sev: 'info' as const,
                  text: MANUAL_REMINDER_HANDOFF_COPY,
                },
              ].map(({ sev, text }) => (
                <li key={text} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="dot shrink-0" data-severity={sev} aria-hidden />
                  {text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {day0OrderId && selectedPatientId && (
        <CollectPaymentDialog
          open={collectOpen}
          onOpenChange={setCollectOpen}
          orderId={day0OrderId}
          patientId={selectedPatientId}
          patientName={patientName}
          preselectDueToday
        />
      )}
      {day0OrderId && patientName && (
        <TextPatientDialog
          open={textOpen}
          onOpenChange={setTextOpen}
          orderId={day0OrderId}
          patientName={patientName}
        />
      )}
    </div>
  )
}

function KvRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-4 px-3 py-2.5">
      <dt className="text-2xs font-medium text-muted-foreground uppercase tracking-wide w-24 shrink-0">
        {label}
      </dt>
      <dd className="text-sm flex-1 min-w-0">{children}</dd>
    </div>
  )
}
