import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle } from 'lucide-react'
import { useScheduledOrder } from '@/features/scheduled-orders/api'

interface ClinicalOrderDetailProps {
  orderId: string
}

export default function ClinicalOrderDetail({ orderId }: ClinicalOrderDetailProps) {
  const { data: order, isLoading, isError } = useScheduledOrder(orderId)

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    )
  }

  if (isError || !order) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" aria-hidden />
          <AlertDescription>Failed to load order details.</AlertDescription>
        </Alert>
      </div>
    )
  }

  const patientName = order.patient ? `${order.patient.firstName} ${order.patient.lastName}` : '—'

  const serviceName = order.service?.name ?? '—'
  const doseLabel = order.doseNumber !== null ? `Dose ${order.doseNumber}` : '—'
  const standingOrderName = order.standingOrder?.template?.name ?? '—'
  const scheduledDate = order.currentScheduledDate
    ? new Date(order.currentScheduledDate).toLocaleDateString('en-PH', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '—'
  const completedDate = order.completedAt
    ? new Date(order.completedAt).toLocaleString('en-PH', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'

  return (
    <ScrollArea className="h-full p-6">
      <div className="space-y-6">
        {/* Status header */}
        <div>
          <p className="text-sm text-muted-foreground">Status</p>
          <p className="text-base font-semibold mt-0.5">{order.status}</p>
        </div>

        {/* Core fields */}
        <div className="rounded-md border bg-muted/40 px-4 py-3 space-y-2 text-sm">
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Order ID</span>
            <span className="font-mono tabular-nums font-medium">{order.id}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Patient</span>
            <span className="font-medium">{patientName}</span>
          </div>
          {order.patient?.dateOfBirth && (
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Date of Birth</span>
              <span className="font-mono tabular-nums">
                {new Date(order.patient.dateOfBirth).toLocaleDateString('en-PH', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Service</span>
            <span className="font-medium">{serviceName}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Dose</span>
            <span className="font-mono tabular-nums">{doseLabel}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Order Type</span>
            <span className="font-medium">{order.orderType}</span>
          </div>
        </div>

        {/* Dates */}
        <div className="rounded-md border bg-muted/40 px-4 py-3 space-y-2 text-sm">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            Dates
          </h4>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Scheduled</span>
            <span className="font-mono tabular-nums">{scheduledDate}</span>
          </div>
          {order.originalScheduledDate && (
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Originally scheduled</span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {new Date(order.originalScheduledDate).toLocaleDateString('en-PH', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Completed</span>
            <span className="font-mono tabular-nums text-muted-foreground">{completedDate}</span>
          </div>
        </div>

        {/* Standing order */}
        {order.standingOrder && (
          <div className="rounded-md border bg-muted/40 px-4 py-3 space-y-2 text-sm">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Standing Order
            </h4>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Template</span>
              <span className="font-medium text-right">{standingOrderName}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">PSO ID</span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {order.patientStandingOrderId ?? '—'}
              </span>
            </div>
            {order.standingOrder.status && (
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">PSO Status</span>
                <span className="font-medium">{order.standingOrder.status}</span>
              </div>
            )}
          </div>
        )}

        {/* Administration details */}
        {(order.administrationRoute || order.administrationSite || order.indication) && (
          <div className="rounded-md border bg-muted/40 px-4 py-3 space-y-2 text-sm">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Administration
            </h4>
            {order.administrationRoute && (
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Route</span>
                <span className="font-medium">{order.administrationRoute}</span>
              </div>
            )}
            {order.administrationSite && (
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Site</span>
                <span className="font-medium">{order.administrationSite}</span>
              </div>
            )}
            {order.indication && (
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Indication</span>
                <span className="font-medium text-right">{order.indication}</span>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Quantity</span>
              <span className="font-mono tabular-nums">{order.quantity}</span>
            </div>
          </div>
        )}

        {/* Consent */}
        {order.consent && (
          <div className="rounded-md border bg-muted/40 px-4 py-3 space-y-2 text-sm">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Consent
            </h4>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">VIS Provided</span>
              <span>{order.consent.visProvided ? 'Yes' : 'No'}</span>
            </div>
            {order.consent.visVersion && (
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">VIS Version</span>
                <span className="font-mono tabular-nums">{order.consent.visVersion}</span>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Consent obtained</span>
              <span>{order.consent.consentObtained ? 'Yes' : 'No'}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Consent by</span>
              <span className="font-medium">{order.consent.consentBy}</span>
            </div>
            {order.consent.consentTimestamp && (
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Timestamp</span>
                <span className="font-mono tabular-nums text-muted-foreground">
                  {new Date(order.consent.consentTimestamp).toLocaleString('en-PH')}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Payment */}
        <div className="rounded-md border bg-muted/40 px-4 py-3 space-y-2 text-sm">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            Payment
          </h4>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Status</span>
            <span className="font-medium">{order.paymentStatus ?? 'No payment linked'}</span>
          </div>
        </div>

        {/* Audit info */}
        <div className="text-xs text-muted-foreground space-y-1 border-t pt-4">
          <div className="flex justify-between gap-2">
            <span>Created</span>
            <span className="font-mono tabular-nums">
              {order.createdAt ? new Date(order.createdAt).toLocaleString('en-PH') : '—'}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span>Updated</span>
            <span className="font-mono tabular-nums">
              {order.updatedAt ? new Date(order.updatedAt).toLocaleString('en-PH') : '—'}
            </span>
          </div>
        </div>
      </div>
    </ScrollArea>
  )
}
