import { useState } from 'react'
import { Download, TriangleAlert } from 'lucide-react'
import { useLabOrder, useAcknowledgeCritical } from '../api'
import { maskSensitive } from '@/lib/sensitive'
import { DASH, formatDateTime } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'
import { ErrorBanner } from '@/components/layout'
import { UserLabel } from '@/components/UserLabel'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { MarkLabSentDialog } from './MarkLabSentDialog'
import { EnterLabResultDialog } from './EnterLabResultDialog'
import { UploadLabResultDialog } from './UploadLabResultDialog'

type Observation = {
  code: string
  value: string
  units?: string
  refRange?: string
  interpretation?: 'Normal' | 'Low' | 'High' | 'Critical'
}

function interpretationVariant(
  i: Observation['interpretation'],
): 'ok' | 'due' | 'overdue' | 'outline' {
  switch (i) {
    case 'Normal':
      return 'ok'
    case 'Low':
    case 'High':
      return 'due'
    case 'Critical':
      return 'overdue'
    default:
      return 'outline'
  }
}

type Props = {
  labOrderId: string
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm">{value ?? DASH}</div>
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  )
}

export default function LabOrderDetail({ labOrderId }: Props) {
  const { data: order, isLoading, isError } = useLabOrder(labOrderId)
  const ackCritical = useAcknowledgeCritical(labOrderId)
  const [markSentOpen, setMarkSentOpen] = useState(false)
  const [enterResultOpen, setEnterResultOpen] = useState(false)
  const [uploadResultOpen, setUploadResultOpen] = useState(false)

  async function handleAcknowledge() {
    try {
      await ackCritical.mutateAsync()
      toast('Critical value acknowledged', {
        description: 'The critical lab value has been documented.',
      })
    } catch {
      toast.error('Error', { description: 'Failed to acknowledge critical value.' })
    }
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-32" />
        <Separator />
        <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      </div>
    )
  }

  if (isError || !order) {
    return <ErrorBanner message="Failed to load lab order." className="p-6" />
  }

  const resultDataRaw = order.resultData
    ? (maskSensitive(order.resultData) as Record<string, unknown>)
    : null

  const needsAck = order.hasCriticalValue && !order.criticalValueAcknowledgedAt

  return (
    <ScrollArea className="h-full">
      <div className="p-6 xl:p-8 space-y-6">
        {/* Critical value banner */}
        {order.hasCriticalValue && (
          <div
            className={`rounded-md border p-3 flex items-start gap-3 ${needsAck ? 'border-destructive bg-destructive/5' : 'border-border bg-muted/50'}`}
          >
            <TriangleAlert
              className={`h-4 w-4 mt-0.5 shrink-0 ${needsAck ? 'text-destructive' : 'text-muted-foreground'}`}
            />
            <div className="flex-1 min-w-0">
              {needsAck ? (
                <>
                  <p className="text-sm font-semibold text-destructive">
                    Critical value — action required
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    This result contains a critical value that requires acknowledgement.
                  </p>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="mt-2"
                    disabled={ackCritical.isPending}
                    onClick={() => void handleAcknowledge()}
                  >
                    {ackCritical.isPending ? 'Acknowledging…' : 'Acknowledge critical value'}
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium">Critical value acknowledged</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Acknowledged {formatDateTime(order.criticalValueAcknowledgedAt)} by{' '}
                    {order.criticalValueAcknowledgedById ?? 'unknown'}
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {/* Title row */}
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <p className="text-xs text-muted-foreground font-mono truncate">{order.id}</p>
            <h2 className="text-base font-semibold">{order.serviceName ?? DASH}</h2>
          </div>
          <Badge variant="outline" className="shrink-0">
            {order.status}
          </Badge>
        </div>

        {/* Status-driven actions */}
        {order.status === 'Pending' && (
          <div className="flex gap-2">
            <Button onClick={() => setMarkSentOpen(true)}>Mark Sent</Button>
          </div>
        )}
        {order.status === 'Sent' && (
          <div className="flex gap-2">
            <Button onClick={() => setEnterResultOpen(true)}>Enter Result</Button>
            <Button variant="outline" onClick={() => setUploadResultOpen(true)}>
              Upload Result PDF
            </Button>
          </div>
        )}

        <Separator />

        {/* Order */}
        <section className="space-y-3">
          <SectionHeading>Order</SectionHeading>
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
            <Field label="Status" value={order.status} />
            <Field label="Sent at" value={formatDateTime(order.sentAt)} />
            <Field label="Result received at" value={formatDateTime(order.resultReceivedAt)} />
            <Field label="Notes" value={order.notes ?? DASH} />
          </div>
        </section>

        <Separator />

        {/* Linked */}
        <section className="space-y-3">
          <SectionHeading>Linked</SectionHeading>
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
            <Field label="Service" value={order.serviceName ?? DASH} />
            <Field label="Patient" value={order.patientName ?? DASH} />
            <Field label="Laboratory" value={order.laboratoryName ?? DASH} />
            <Field
              label="Clinical order ID"
              value={<span className="font-mono text-xs">{order.clinicalOrderId}</span>}
            />
          </div>
        </section>

        <Separator />

        {/* Result */}
        <section className="space-y-3">
          <SectionHeading>Result</SectionHeading>
          <div className="space-y-3">
            <Field
              label="Result file attachment ID"
              value={
                order.resultFileAttachmentId != null ? String(order.resultFileAttachmentId) : DASH
              }
            />
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Result data</p>
              {resultDataRaw && Object.keys(resultDataRaw).length > 0 ? (
                <dl className="space-y-1">
                  {Object.entries(resultDataRaw).map(([k, v]) => {
                    const humanKey = k
                      .replace(/[_-]+/g, ' ')
                      .replace(/([a-z])([A-Z])/g, '$1 $2')
                      .replace(/^./, (c) => c.toUpperCase())
                    const isSimple =
                      v === null ||
                      v === undefined ||
                      typeof v === 'string' ||
                      typeof v === 'number' ||
                      typeof v === 'boolean'
                    return (
                      <div key={k} className="flex justify-between gap-3 py-1 text-sm">
                        <dt className="text-muted-foreground shrink-0">{humanKey}</dt>
                        <dd className="font-medium break-words text-right">
                          {isSimple ? (
                            v === null || v === undefined || v === '' ? (
                              DASH
                            ) : typeof v === 'boolean' ? (
                              v ? (
                                'Yes'
                              ) : (
                                'No'
                              )
                            ) : (
                              String(v)
                            )
                          ) : Array.isArray(v) && v.length === 0 ? (
                            DASH
                          ) : (
                            <pre className="text-xs bg-muted rounded p-2 overflow-x-auto font-mono text-left">
                              {JSON.stringify(v, null, 2)}
                            </pre>
                          )}
                        </dd>
                      </div>
                    )
                  })}
                </dl>
              ) : (
                <p className="text-sm">{DASH}</p>
              )}
            </div>
          </div>
        </section>

        <Separator />

        {/* Result data — observations table (ResultReceived only) */}
        {order.status === 'ResultReceived' &&
          Array.isArray((order.resultData as { observations?: Observation[] })?.observations) && (
            <>
              <Separator />
              <section className="space-y-3">
                <SectionHeading>Result</SectionHeading>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead>Units</TableHead>
                      <TableHead>Ref range</TableHead>
                      <TableHead>Interpretation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {((order.resultData as { observations: Observation[] }).observations ?? []).map(
                      (obs, i) => (
                        <TableRow key={`${obs.code}-${i}`}>
                          <TableCell className="font-mono text-xs">{obs.code}</TableCell>
                          <TableCell className="tabular-nums">{obs.value}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {obs.units ?? DASH}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {obs.refRange ?? DASH}
                          </TableCell>
                          <TableCell>
                            {obs.interpretation ? (
                              <Badge variant={interpretationVariant(obs.interpretation)}>
                                {obs.interpretation}
                              </Badge>
                            ) : (
                              DASH
                            )}
                          </TableCell>
                        </TableRow>
                      ),
                    )}
                  </TableBody>
                </Table>
                {order.resultFileAttachmentId != null && (
                  <Button variant="outline" size="sm" disabled>
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    Result file attached (ID: {order.resultFileAttachmentId})
                  </Button>
                )}
              </section>
            </>
          )}

        <Separator />

        {/* Audit */}
        <section className="space-y-3">
          <SectionHeading>Audit</SectionHeading>
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
            <Field label="Created at" value={formatDateTime(order.createdAt)} />
            <Field label="Updated at" value={formatDateTime(order.updatedAt)} />
            <Field label="Created by" value={<UserLabel user={order.createdBy} />} />
          </div>
        </section>
      </div>

      <MarkLabSentDialog orderId={order.id} open={markSentOpen} onOpenChange={setMarkSentOpen} />
      <EnterLabResultDialog
        orderId={order.id}
        open={enterResultOpen}
        onOpenChange={setEnterResultOpen}
      />
      <UploadLabResultDialog
        orderId={order.id}
        open={uploadResultOpen}
        onOpenChange={setUploadResultOpen}
      />
    </ScrollArea>
  )
}
