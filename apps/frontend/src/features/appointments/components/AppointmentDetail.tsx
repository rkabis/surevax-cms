import { useState } from 'react'
import { XCircle } from 'lucide-react'
import { formatLongDateTime as fmtDT } from '@/lib/format'
import { useAppointment, useCancelAppointment } from '../api'
import { apiErrorMessage } from '@/lib/apiErrors'
import { toast } from '@/components/ui/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { AttachmentList } from '@/components/ui/attachment-list'
import { AttachmentDropzone } from '@/components/ui/attachment-dropzone'

import { APPOINTMENT_STATUS_VARIANT as STATUS_VARIANT } from '@/lib/status'
import { ErrorBanner } from '@/components/layout'

// ── helpers ───────────────────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm break-all">{value ?? '—'}</p>
    </div>
  )
}

// ── component ─────────────────────────────────────────────────────────────────

type Props = {
  appointmentId: string
}

export default function AppointmentDetail({ appointmentId }: Props) {
  const { data: appt, isLoading, isError } = useAppointment(appointmentId)
  const cancelMutation = useCancelAppointment()
  const [cancelReason, setCancelReason] = useState('')

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-32" />
        <Separator />
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      </div>
    )
  }

  if (isError || !appt) {
    return <ErrorBanner message="Failed to load appointment." className="p-6" />
  }

  const canCancel = appt.status === 'Scheduled'

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-mono text-muted-foreground">{appt.id}</p>
            <h2 className="text-lg font-semibold mt-0.5">{appt.appointmentType}</h2>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant={STATUS_VARIANT[appt.status] ?? 'outline'} className="text-xs">
                {appt.status}
              </Badge>
            </div>
          </div>

          {canCancel && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 text-destructive">
                  <XCircle className="h-4 w-4" aria-hidden />
                  Cancel
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel appointment?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will mark the appointment as cancelled. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <Textarea
                  placeholder="Reason for cancellation (optional)"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="resize-none"
                  rows={3}
                />
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={() => setCancelReason('')}>
                    Keep appointment
                  </AlertDialogCancel>
                  <AlertDialogAction
                    disabled={!cancelReason.trim()}
                    onClick={() => {
                      cancelMutation.mutate(
                        {
                          id: appt.id,
                          body: { reason: cancelReason.trim() },
                        },
                        {
                          onError: (err) => {
                            toast.error('Failed to cancel appointment', {
                              description: apiErrorMessage(err),
                            })
                          },
                        },
                      )
                      setCancelReason('')
                    }}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Cancel appointment
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        {/* Schedule */}
        <section aria-label="Schedule">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Schedule
          </h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <Field label="Start" value={fmtDT(appt.scheduledStartAt)} />
            <Field label="End" value={fmtDT(appt.scheduledEndAt)} />
            <Field label="Type" value={appt.appointmentType} />
          </div>
        </section>

        <Separator />

        {/* Participants */}
        <section aria-label="Participants">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Participants
          </h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Patient</p>
              <p className="text-sm break-all">
                {appt.patientFirstName
                  ? `${appt.patientLastName}, ${appt.patientFirstName}`
                  : appt.patientId}
              </p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Provider</p>
              <p className="text-sm break-all">{appt.providerName ?? appt.providerId ?? '—'}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Branch</p>
              <p className="text-sm break-all">{appt.branchName ?? appt.branchId}</p>
            </div>
            <Field
              label="Location"
              value={
                appt.locationName ?? (appt.locationId != null ? String(appt.locationId) : null)
              }
            />
          </div>
        </section>

        <Separator />

        {/* Clinical */}
        <section aria-label="Clinical details">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Clinical
          </h3>
          <div className="space-y-3">
            <Field label="Reason" value={appt.reason} />
            <Field label="Notes" value={appt.notes} />
            <Field
              label="Encounter"
              value={
                appt.encounterDisplayId ??
                (appt.encounterId != null ? String(appt.encounterId) : null)
              }
            />
          </div>
        </section>

        {/* Cancellation (only when cancelled) */}
        {appt.status === 'Cancelled' && (
          <>
            <Separator />
            <section aria-label="Cancellation">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Cancellation
              </h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <Field label="Cancelled at" value={fmtDT(appt.cancelledAt)} />
                <Field
                  label="Cancelled by"
                  value={
                    appt.cancelledByName ??
                    (appt.cancelledById != null ? String(appt.cancelledById) : null)
                  }
                />
                <div className="col-span-2">
                  <Field label="Cancellation reason" value={appt.cancellationReason} />
                </div>
              </div>
            </section>
          </>
        )}

        <Separator />

        {/* Audit */}
        <section aria-label="Audit">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Audit
          </h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <Field label="Created at" value={fmtDT(appt.createdAt)} />
            <Field label="Updated at" value={fmtDT(appt.updatedAt)} />
          </div>
        </section>

        <Separator />

        {/* Attachments */}
        <section aria-label="Attachments">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Attachments
          </h3>
          {/* ownerType="patient" is intentional: attachments from an appointment
              belong to the patient's clinical record, not the appointment itself.
              The backend ownerTypeEnum does not include 'appointment', and files
              attached here should persist even if the appointment is deleted. */}
          <AttachmentDropzone
            ownerType="patient"
            ownerId={appt.patientDisplayId ?? String(appt.patientId)}
          />
          <AttachmentList
            ownerType="patient"
            ownerId={appt.patientDisplayId ?? String(appt.patientId)}
          />
        </section>
      </div>
    </ScrollArea>
  )
}
