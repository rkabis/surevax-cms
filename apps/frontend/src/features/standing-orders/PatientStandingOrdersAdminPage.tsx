import { useState } from 'react'
import { AlertCircle, PauseCircle, PlayCircle, Workflow } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'
import { Sheet, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { PageHeader, ListEmpty, DetailSheet, TableCard } from '@/components/layout'
import { formatDate, formatDateTime } from '@/lib/format'
import { humanizeStatus } from '@/lib/status'
import { apiErrorMessage } from '@/lib/apiErrors'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import {
  usePatientStandingOrders,
  usePatientStandingOrderDetail,
  useSetPatientStandingOrderStatus,
  type PatientStandingOrderRow,
} from './api'

function statusVariant(status: string): 'overdue' | 'due' | 'ok' | 'info' {
  switch (status) {
    case 'Active':
      return 'ok'
    case 'Suspended':
      return 'due'
    case 'Discontinued':
      return 'overdue'
    case 'Completed':
    default:
      return 'info'
  }
}

function PsoDetail({ psoId, onClose }: { psoId: string; onClose: () => void }) {
  const { data, isLoading, isError } = usePatientStandingOrderDetail(psoId)
  const statusMutation = useSetPatientStandingOrderStatus()

  async function setStatus(status: 'Active' | 'Suspended') {
    try {
      await statusMutation.mutateAsync({ psoId, status })
      toast(status === 'Suspended' ? 'Schedule paused' : 'Schedule resumed')
    } catch (err) {
      toast.error('Could not update schedule', { description: apiErrorMessage(err) })
    }
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="p-6 flex items-center gap-2 text-destructive text-sm">
        <AlertCircle className="h-4 w-4" aria-hidden />
        Failed to load standing order.
      </div>
    )
  }

  const pausable = data.status === 'Active' || data.status === 'Suspended'

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="px-6 pb-6 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={statusVariant(data.status)}>{humanizeStatus(data.status)}</Badge>
          <span className="font-mono text-xs text-muted-foreground">{data.id}</span>
        </div>

        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Template</dt>
            <dd className="text-right">{data.templateId}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Start date</dt>
            <dd className="font-mono tabular-nums">{formatDate(data.startDate)}</dd>
          </div>
          {data.suspendedAt && (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Paused at</dt>
              <dd className="font-mono tabular-nums">{formatDateTime(data.suspendedAt)}</dd>
            </div>
          )}
        </dl>

        {pausable && (
          <div className="flex gap-2">
            {data.status === 'Active' ? (
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                disabled={statusMutation.isPending}
                onClick={() => setStatus('Suspended')}
              >
                <PauseCircle className="h-3.5 w-3.5" aria-hidden />
                Pause schedule
              </Button>
            ) : (
              <Button
                size="sm"
                className="gap-1"
                disabled={statusMutation.isPending}
                onClick={() => setStatus('Active')}
              >
                <PlayCircle className="h-3.5 w-3.5" aria-hidden />
                Resume schedule
              </Button>
            )}
          </div>
        )}

        <div>
          <h3 className="text-sm font-semibold mb-2">Dose schedule</h3>
          <div className="border border-border rounded-md divide-y divide-border">
            {data.clinicalOrders.map((dose) => (
              <div key={dose.id} className="px-3 py-2 flex items-center gap-3">
                <span className="font-mono tabular-nums text-xs font-semibold w-14 shrink-0">
                  Dose {dose.doseNumber ?? '—'}
                </span>
                <span className="text-xs flex-1 min-w-0 truncate">{dose.serviceId}</span>
                <span className="font-mono tabular-nums text-xs text-muted-foreground">
                  {dose.currentScheduledDate ? formatDate(dose.currentScheduledDate) : '—'}
                </span>
                <Badge
                  variant={statusVariant(dose.status === 'Completed' ? 'Completed' : 'Active')}
                >
                  {humanizeStatus(dose.status)}
                </Badge>
              </div>
            ))}
            {data.clinicalOrders.length === 0 && (
              <p className="px-3 py-4 text-sm text-muted-foreground">No doses generated.</p>
            )}
          </div>
        </div>

        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </ScrollArea>
  )
}

export default function PatientStandingOrdersAdminPage() {
  const { data: rows = [], isLoading, isError } = usePatientStandingOrders()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="Patient standing orders"
          description="Every initiated protocol schedule — open one to pause or resume it."
        />
      </div>

      <ScrollArea className="flex-1">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4">
          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}

          {isError && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4" aria-hidden />
              Failed to load patient standing orders.
            </div>
          )}

          {!isLoading && !isError && rows.length === 0 && (
            <ListEmpty icon={Workflow} message="No patient standing orders yet." />
          )}

          {!isLoading && !isError && rows.length > 0 && (
            <TableCard>
              <Table className="w-full text-sm">
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow className="text-left">
                    <TableHead className="px-3 font-medium">Patient</TableHead>
                    <TableHead className="px-3 font-medium">Protocol</TableHead>
                    <TableHead className="px-3 font-medium">Status</TableHead>
                    <TableHead className="px-3 font-medium font-mono tabular-nums">
                      Start date
                    </TableHead>
                    <TableHead className="px-3 font-medium font-mono tabular-nums">Doses</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((pso: PatientStandingOrderRow) => (
                    <TableRow
                      interactive
                      key={pso.id}
                      data-severity={statusVariant(pso.status)}
                      className="stripe cursor-pointer border-t hover:bg-accent/30 transition-colors"
                      onClick={() => setSelectedId(pso.id)}
                    >
                      <TableCell className="px-3">{pso.patientName}</TableCell>
                      <TableCell className="px-3">{pso.templateName ?? pso.templateId}</TableCell>
                      <TableCell className="px-3">
                        <Badge variant={statusVariant(pso.status)}>
                          {humanizeStatus(pso.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-3 font-mono tabular-nums text-muted-foreground">
                        {formatDate(pso.startDate)}
                      </TableCell>
                      <TableCell className="px-3 font-mono tabular-nums">
                        {pso.dosesCompleted}/{pso.dosesTotal}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableCard>
          )}
        </div>
      </ScrollArea>

      <Sheet
        open={!!selectedId}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
      >
        <DetailSheet width="standard">
          <SheetHeader className="p-6 pb-3">
            <SheetTitle>Standing order</SheetTitle>
            <SheetDescription>Schedule detail — pause or resume the course.</SheetDescription>
          </SheetHeader>
          {selectedId && <PsoDetail psoId={selectedId} onClose={() => setSelectedId(null)} />}
        </DetailSheet>
      </Sheet>
    </div>
  )
}
