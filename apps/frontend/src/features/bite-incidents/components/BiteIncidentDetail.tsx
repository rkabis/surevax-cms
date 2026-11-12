import { useState } from 'react'
import { useBiteIncident } from '../api'
import { formatDate } from '@/lib/format'
import { humanizeStatus } from '@/lib/status'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { DetailSheet, ErrorBanner } from '@/components/layout'
import { SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import RecordOutcomeDialog from './RecordOutcomeDialog'

type Props = {
  id: string | null
}

function outcomeVariant(
  outcome: string | null,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (!outcome) return 'outline'
  if (outcome === 'AliveHealthy') return 'default'
  if (outcome === 'LostToFollowup') return 'destructive'
  return 'secondary'
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'Completed') return 'default'
  if (status === 'Cancelled') return 'destructive'
  return 'secondary'
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground uppercase tracking-wide">{label}</span>
      <span className="text-sm">{value ?? '—'}</span>
    </div>
  )
}

export default function BiteIncidentDetail({ id }: Props) {
  const { data, isLoading, isError } = useBiteIncident(id)
  const [outcomeOpen, setOutcomeOpen] = useState(false)

  if (!id) return null

  if (isLoading) {
    return (
      <DetailSheet>
        <div className="p-6 space-y-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </DetailSheet>
    )
  }

  if (isError || !data) {
    return (
      <DetailSheet>
        <div className="p-6">
          <ErrorBanner message="Failed to load bite incident" />
        </div>
      </DetailSheet>
    )
  }

  const followup = data.followup
  const canRecordOutcome = followup && followup.status === 'Pending'

  return (
    <DetailSheet>
      <SheetHeader className="px-6 pt-6 pb-4 border-b border-border">
        <SheetTitle className="flex items-center gap-2">
          <span>{data.id}</span>
          <Badge variant="outline" className="text-xs font-mono">
            Cat.&nbsp;{data.exposureCategory}
          </Badge>
        </SheetTitle>
        <p className="text-sm text-muted-foreground">
          {data.patientFirstName} {data.patientLastName} · {data.species} bite
        </p>
      </SheetHeader>

      <div className="px-6 py-4 space-y-6 overflow-y-auto">
        {/* Incident facts */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Incident</h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label="Date" value={formatDate(data.incidentDate)} />
            <Field label="Species" value={data.species} />
            <Field label="Bite site" value={data.biteSite} />
            <Field label="Exposure category" value={`Category ${data.exposureCategory}`} />
            <Field
              label="Animal vaccination"
              value={
                data.animalVaccinationStatus === 'NotVaccinated'
                  ? 'Not vaccinated'
                  : data.animalVaccinationStatus
              }
            />
            {data.animalAgeMonths != null && (
              <Field label="Animal age" value={`${data.animalAgeMonths} mo`} />
            )}
            {data.animalVaccinationDocDate && (
              <Field label="Vax doc date" value={formatDate(data.animalVaccinationDocDate)} />
            )}
          </div>
        </section>

        <Separator />

        {/* Day-14 followup */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Day-14 Observation</h3>
            {canRecordOutcome && (
              <Button size="sm" variant="outline" onClick={() => setOutcomeOpen(true)}>
                Record Outcome
              </Button>
            )}
          </div>

          {followup ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Due date" value={formatDate(followup.dueDate)} />
              <Field
                label="Status"
                value={<Badge variant={statusVariant(followup.status)}>{followup.status}</Badge>}
              />
              {followup.outcome && (
                <Field
                  label="Outcome"
                  value={
                    <Badge variant={outcomeVariant(followup.outcome)}>
                      {humanizeStatus(followup.outcome)}
                    </Badge>
                  }
                />
              )}
              {followup.fatTestResult && (
                <Field label="FAT result" value={followup.fatTestResult} />
              )}
              {followup.outcomeRecordedAt && (
                <Field label="Recorded at" value={formatDate(followup.outcomeRecordedAt)} />
              )}
              {followup.notes && <Field label="Notes" value={followup.notes} />}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No followup task found.</p>
          )}
        </section>

        <Separator />

        {/* Metadata */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Audit</h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label="Created" value={formatDate(data.createdAt)} />
            {data.createdByName && <Field label="Created by" value={data.createdByName} />}
            <Field label="Last updated" value={formatDate(data.updatedAt)} />
          </div>
        </section>
      </div>

      {followup && canRecordOutcome && (
        <RecordOutcomeDialog
          open={outcomeOpen}
          onOpenChange={setOutcomeOpen}
          biteIncidentId={data.id}
          followup={followup}
        />
      )}
    </DetailSheet>
  )
}
