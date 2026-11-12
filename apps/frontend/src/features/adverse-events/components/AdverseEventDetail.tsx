import { useState } from 'react'

import { useAdverseEvent } from '../api'
import { authorityReportingStatus } from '../authorityReporting'
import UpdateAdverseEventDialog from './UpdateAdverseEventDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ErrorBanner } from '@/components/layout'

// ── badge helpers ─────────────────────────────────────────────────────────────

export type SeverityVariant = 'info' | 'due' | 'overdue' | 'destructive'

export function severityVariant(severity: string): SeverityVariant {
  if (severity === 'Mild') return 'info'
  if (severity === 'Moderate') return 'due'
  if (severity === 'Severe') return 'overdue'
  return 'destructive'
}

export type OutcomeVariant = 'ok' | 'info' | 'secondary' | 'destructive'

export function outcomeVariant(outcome: string | null): OutcomeVariant {
  if (outcome === 'Recovered') return 'ok'
  if (outcome === 'Recovering') return 'info'
  if (outcome === 'Fatal') return 'destructive'
  return 'secondary'
}

function fmt(val: string | null | undefined): string {
  return val ?? '—'
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-PH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ── component ─────────────────────────────────────────────────────────────────

type Props = { eventId: string }

export default function AdverseEventDetail({ eventId }: Props) {
  const [updateOpen, setUpdateOpen] = useState(false)

  const { data: event, isLoading, isError } = useAdverseEvent(eventId)

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-8 w-48" />
        <Separator className="my-3" />
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      </div>
    )
  }

  if (isError || !event) {
    return <ErrorBanner message="Failed to load adverse event." className="p-6" />
  }

  const hasSymptomsData =
    event.symptomsCoded != null &&
    !(
      typeof event.symptomsCoded === 'object' &&
      !Array.isArray(event.symptomsCoded) &&
      Object.keys(event.symptomsCoded as object).length === 0
    )

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-5">
        <SheetHeader className="mb-2">
          <SheetTitle className="font-mono tabular-nums text-base">{event.id}</SheetTitle>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={severityVariant(event.severity)}>{event.severity}</Badge>
            {event.outcome && (
              <Badge variant={outcomeVariant(event.outcome)}>{event.outcome}</Badge>
            )}
          </div>
        </SheetHeader>

        <Separator />

        {/* Identity */}
        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
            Identity
          </p>
          <dl className="grid grid-cols-[8.75rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">Patient ID</dt>
            <dd className="font-mono tabular-nums">{event.patientId}</dd>
            <dt className="text-muted-foreground">Encounter ID</dt>
            <dd className="font-mono tabular-nums">{fmt(event.encounterId)}</dd>
            <dt className="text-muted-foreground">Clinical Order ID</dt>
            <dd className="font-mono tabular-nums">{fmt(event.clinicalOrderId)}</dd>
            <dt className="text-muted-foreground">Reported By</dt>
            <dd className="font-mono tabular-nums">
              {event.reportedById != null ? String(event.reportedById) : '—'}
            </dd>
          </dl>
        </section>

        <Separator />

        {/* Event details */}
        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
            Event Details
          </p>
          <dl className="grid grid-cols-[8.75rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">Reported At</dt>
            <dd className="font-mono tabular-nums">{fmtDate(event.reportedAt)}</dd>
            <dt className="text-muted-foreground">Onset At</dt>
            <dd className="font-mono tabular-nums">{fmtDate(event.onsetAt)}</dd>
            <dt className="text-muted-foreground">Severity</dt>
            <dd>
              <Badge variant={severityVariant(event.severity)}>{event.severity}</Badge>
            </dd>
            <dt className="text-muted-foreground">Outcome</dt>
            <dd>
              {event.outcome ? (
                <Badge variant={outcomeVariant(event.outcome)}>{event.outcome}</Badge>
              ) : (
                '—'
              )}
            </dd>
          </dl>
          <div className="mt-2 space-y-1">
            <p className="text-xs text-muted-foreground">Description</p>
            <p className="text-sm">{event.description}</p>
          </div>
          {event.treatmentGiven && (
            <div className="mt-2 space-y-1">
              <p className="text-xs text-muted-foreground">Treatment Given</p>
              <p className="text-sm">{event.treatmentGiven}</p>
            </div>
          )}
          {hasSymptomsData && (
            <div className="mt-2 space-y-1">
              <p className="text-xs text-muted-foreground">Symptoms Coded</p>
              {Array.isArray(event.symptomsCoded) ? (
                <ul className="space-y-1">
                  {(
                    event.symptomsCoded as Array<{
                      system?: string
                      code?: string
                      display?: string
                    }>
                  ).map((s, i) => (
                    <li key={i} className="text-sm">
                      {s.display ?? '—'}
                      {(s.system || s.code) && (
                        <span className="text-xs text-muted-foreground ml-1">
                          ({[s.system, s.code].filter(Boolean).join(': ')})
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <dl className="space-y-1">
                  {Object.entries(event.symptomsCoded as Record<string, unknown>).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3 py-0.5 text-sm">
                      <dt className="text-muted-foreground shrink-0">
                        {k.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase())}
                      </dt>
                      <dd className="font-medium break-words text-right">
                        {v === null || v === undefined ? '—' : String(v)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}
        </section>

        <Separator />

        {/* Authority */}
        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
            Authority Reporting
          </p>
          <dl className="grid grid-cols-[8.75rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">Status</dt>
            <dd>{authorityReportingStatus(event)}</dd>
            <dt className="text-muted-foreground">Reported at</dt>
            <dd className="font-mono tabular-nums">{fmtDate(event.reportedToAuthorityAt)}</dd>
            <dt className="text-muted-foreground">Reference No.</dt>
            <dd className="font-mono tabular-nums">{fmt(event.authorityReferenceNumber)}</dd>
          </dl>
        </section>

        <Separator />

        {/* Audit */}
        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
            Audit
          </p>
          <dl className="grid grid-cols-[8.75rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">Created At</dt>
            <dd className="font-mono tabular-nums">{fmtDate(event.createdAt)}</dd>
            <dt className="text-muted-foreground">Updated At</dt>
            <dd className="font-mono tabular-nums">{fmtDate(event.updatedAt)}</dd>
          </dl>
        </section>

        <div className="pt-2">
          <Button size="sm" onClick={() => setUpdateOpen(true)}>
            Update
          </Button>
        </div>

        <UpdateAdverseEventDialog event={event} open={updateOpen} onOpenChange={setUpdateOpen} />
      </div>
    </ScrollArea>
  )
}
