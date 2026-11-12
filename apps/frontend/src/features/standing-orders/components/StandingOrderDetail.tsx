import { AlertCircle, Lock } from 'lucide-react'
import { Sheet, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { formatDateTime } from '@/lib/format'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { DetailSheet, TableCard } from '@/components/layout'
import { UserLabel } from '@/components/UserLabel'
import { useStandingOrderTemplate } from '../api'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'

type Props = {
  templateId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const NULL_DASH = '—'

function KvRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-border/50 last:border-0">
      <dt className="text-xs text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-sm text-right">{value ?? NULL_DASH}</dd>
    </div>
  )
}

export default function StandingOrderDetail({ templateId, open, onOpenChange }: Props) {
  const { data, isLoading, isError } = useStandingOrderTemplate(templateId)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <DetailSheet width="wide">
        <ScrollArea className="h-full">
          <div className="p-6 space-y-6">
            {/* Header */}
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                {isLoading ? (
                  <Skeleton className="h-6 w-48" />
                ) : (
                  <>
                    {data?.name ?? 'Standing Order'}
                    {data?.isLocked && (
                      <Badge variant="secondary" className="gap-1 text-xs">
                        <Lock className="h-3 w-3" aria-hidden />
                        Locked
                      </Badge>
                    )}
                  </>
                )}
              </SheetTitle>
              <SheetDescription className="font-mono text-xs">
                {data ? data.code : 'Standing order template details'}
              </SheetDescription>
            </SheetHeader>

            {/* Loading skeleton */}
            {isLoading && (
              <div className="space-y-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-24 w-full" />
              </div>
            )}

            {/* Error */}
            {isError && (
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-4 w-4" aria-hidden />
                <span className="text-sm">Failed to load standing order.</span>
              </div>
            )}

            {data && (
              <>
                {/* Identity */}
                <section aria-label="Identity">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                    Identity
                  </h3>
                  <dl className="space-y-0">
                    <KvRow
                      label="Code"
                      value={<span className="font-mono text-xs">{data.code}</span>}
                    />
                    <KvRow label="Name" value={data.name} />
                    <KvRow label="Description" value={data.description ?? NULL_DASH} />
                    <KvRow
                      label="Version"
                      value={
                        <span className="font-mono tabular-nums text-xs">v{data.version}</span>
                      }
                    />
                  </dl>
                </section>

                <Separator />

                {/* Settings */}
                <section aria-label="Settings">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                    Settings
                  </h3>
                  <dl className="space-y-0">
                    <KvRow
                      label="Physician auth"
                      value={
                        <Badge variant={data.requiresPhysicianAuth ? 'due' : 'outline'}>
                          {data.requiresPhysicianAuth ? 'Required' : 'Not required'}
                        </Badge>
                      }
                    />
                    <KvRow
                      label="Status"
                      value={
                        <Badge variant={data.isActive ? 'ok' : 'overdue'}>
                          {data.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      }
                    />
                    <KvRow
                      label="Locked"
                      value={
                        data.isLocked ? (
                          <Badge variant="secondary" className="gap-1 text-xs">
                            <Lock className="h-3 w-3" aria-hidden />
                            Locked
                          </Badge>
                        ) : (
                          <Badge variant="outline">Editable</Badge>
                        )
                      }
                    />
                    {data.supersedesId && (
                      <KvRow
                        label="Supersedes"
                        value={<span className="font-mono text-xs">{data.supersedesId}</span>}
                      />
                    )}
                  </dl>
                </section>

                <Separator />

                {/* Dose items */}
                <section aria-label="Items">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                    Dose items ({data.items?.length ?? 0})
                  </h3>
                  {(data.items?.length ?? 0) === 0 ? (
                    <p className="text-sm text-muted-foreground">No items in this template.</p>
                  ) : (
                    <TableCard>
                      <Table className="w-full text-sm">
                        <TableHeader className="bg-muted/50 text-xs text-muted-foreground">
                          <TableRow>
                            <TableHead className="text-left font-medium px-4 w-16">Day</TableHead>
                            <TableHead className="text-left font-medium px-4 w-12">Seq</TableHead>
                            <TableHead className="text-left font-medium px-4">Service</TableHead>
                            <TableHead className="text-left font-medium px-4 w-16">Qty</TableHead>
                            <TableHead className="text-left font-medium px-4">
                              Instructions
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(data.items ?? []).map((item) => (
                            <TableRow key={item.id} className="border-t">
                              <TableCell className="px-4 font-mono tabular-nums text-xs">
                                D{item.dayOffset}
                              </TableCell>
                              <TableCell className="px-4 font-mono tabular-nums text-xs">
                                {item.sequence}
                              </TableCell>
                              <TableCell className="px-4">
                                <div className="font-medium text-sm">{item.serviceName}</div>
                                <div className="text-xs text-muted-foreground font-mono">
                                  {item.serviceCode}
                                </div>
                              </TableCell>
                              <TableCell className="px-4 font-mono tabular-nums text-sm">
                                {item.quantity}
                              </TableCell>
                              <TableCell className="px-4 text-muted-foreground text-xs">
                                {item.instructions ?? NULL_DASH}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableCard>
                  )}
                </section>

                <Separator />

                {/* Audit */}
                <section aria-label="Audit">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                    Audit
                  </h3>
                  <dl className="space-y-0">
                    <KvRow label="Created at" value={formatDateTime(data.createdAt)} />
                    <KvRow label="Updated at" value={formatDateTime(data.updatedAt)} />
                    <KvRow label="Created by" value={<UserLabel user={data.createdBy} />} />
                  </dl>
                </section>
              </>
            )}
          </div>
        </ScrollArea>
      </DetailSheet>
    </Sheet>
  )
}
