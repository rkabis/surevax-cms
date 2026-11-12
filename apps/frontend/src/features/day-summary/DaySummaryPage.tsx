import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  Archive,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Download,
  Mail,
  Printer,
  Receipt,
  Syringe,
  Stethoscope,
  Package,
  Wallet,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'
import { ComingSoonButton, ErrorBanner, PageHeader, PageToolbar } from '@/components/layout'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { apiErrorMessage } from '@/lib/apiErrors'
import { clinicCalendarDateString } from '@/lib/clinicDate'
import { DASH, formatLongDate, formatLongDateTime, formatMoney, formatTime } from '@/lib/format'
import { useAuditEvent } from '@/hooks/useAuditEvent'
import {
  useCreateDaySnapshot,
  useDaySnapshot,
  useDaySummary,
  useLooseEnds,
  type LooseEnds,
  type DaySummaryAdministrations,
  type DaySummaryDrawer,
  type DaySummaryEncounters,
  type DaySummaryInventory,
  type DaySummaryTransactions,
} from './api'

function shiftDate(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DaySummaryPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const today = clinicCalendarDateString()
  const date = searchParams.get('date') ?? today

  const setDate = (next: string) => {
    const params = new URLSearchParams(searchParams)
    params.set('date', next)
    setSearchParams(params, { replace: true })
  }

  const { data, isLoading, isError, error } = useDaySummary(date)
  const { data: snapshot } = useDaySnapshot(date)
  const { data: looseEnds } = useLooseEnds(date)
  const createSnapshot = useCreateDaySnapshot()
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)
  const { recordPrint } = useAuditEvent()

  // Prints the report and records the DPA print-audit trail together.
  // window.print() has no success/cancel signal, so the event fires at the
  // point print is invoked against an already-loaded report, not after some
  // unobservable "print completed" state. `entityType: 'day_summary'` and
  // `entityId` is the archival snapshot's display id when the day has been
  // snapshotted; before that, the date itself is a stable, meaningful
  // identifier for a report that has no row yet (entityId carries no FK, so
  // this is safe: see apps/backend/src/modules/audit/routes.ts).
  const printReport = useCallback(() => {
    if (data) {
      recordPrint({
        entityType: 'day_summary',
        entityId: snapshot?.id ?? date,
        documentType: 'day_summary_report',
      })
    }
    window.print()
  }, [data, snapshot, date, recordPrint])

  // Auto-print when reached via the Dashboard's "Print EOD report" action
  // (/day-summary?print=1). Fires once per mount, after data has loaded, so the
  // print dialog captures the rendered report rather than the loading skeleton.
  const autoPrintedRef = useRef(false)
  useEffect(() => {
    if (autoPrintedRef.current) return
    if (searchParams.get('print') !== '1') return
    if (isLoading || isError || !data) return
    autoPrintedRef.current = true
    const t = setTimeout(() => printReport(), 350)
    return () => clearTimeout(t)
  }, [searchParams, isLoading, isError, data, printReport])

  function handleConfirmClose() {
    createSnapshot.mutate(
      { date },
      {
        onSuccess: () => {
          toast(snapshot ? 'Archival snapshot replaced' : 'Report snapshotted', {
            description: formatLongDate(date),
          })
          setConfirmCloseOpen(false)
        },
        onError: (err) => {
          toast.error('Failed to snapshot day', { description: apiErrorMessage(err) })
        },
      },
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Print stylesheet: turns the on-screen Day Summary into a clean A4
          end-of-day report: hides app chrome + interactive controls and lets
          the content flow off the fixed-height scroll viewport onto paper. */}
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm; }
          /* App chrome (sidebar, topbar, transient banners) carries
             print:hidden in AppShell. Here we just let the report flow off the
             fixed-height scroll viewport onto multiple pages instead of being
             clipped to one screenful. */
          #main-content,
          #main-content > div,
          [data-radix-scroll-area-viewport] {
            overflow: visible !important;
            height: auto !important;
            max-height: none !important;
          }
          .ds-print-hide { display: none !important; }
          * {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>
      {/* Page head */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title={
            <span className="flex items-center gap-2">
              <CalendarCheck className="h-5 w-5 text-primary" aria-hidden />
              Day Summary
            </span>
          }
          description={`${data?.branchName ? `${data.branchName} · ` : ''}${formatLongDate(date)}`}
          actions={
            <Button
              variant="outline"
              size="sm"
              className="ds-print-hide"
              onClick={printReport}
              disabled={isLoading || isError}
            >
              <Printer className="h-3.5 w-3.5 mr-1.5" aria-hidden />
              Print
            </Button>
          }
        />
      </div>

      {/* Date scope */}
      <PageToolbar className="gap-2 ds-print-hide">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDate(shiftDate(date, -1))}
          aria-label="Previous day"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Input
          type="date"
          aria-label="Summary date"
          value={date}
          onChange={(e) => setDate(e.target.value || today)}
          className="h-8 max-w-[11.25rem]"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDate(shiftDate(date, +1))}
          aria-label="Next day"
        >
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Button
          variant={date === today ? 'default' : 'outline'}
          size="sm"
          onClick={() => setDate(today)}
        >
          Today
        </Button>
        <div className="ml-auto flex items-center gap-3">
          {snapshot && (
            <Badge variant="ok" className="gap-1 text-xs">
              <Archive className="h-3 w-3" aria-hidden />
              Archived snapshot · {formatLongDateTime(snapshot.createdAt)}
            </Badge>
          )}
          {data?.generatedAt && (
            <span className="text-xs text-muted-foreground">
              Generated · {formatLongDateTime(data.generatedAt)}
            </span>
          )}
        </div>
      </PageToolbar>

      <ScrollArea className="flex-1">
        <div className="p-6 xl:px-8 space-y-4 max-w-6xl">
          {isError && (
            <ErrorBanner message={`Failed to load day summary. ${apiErrorMessage(error)}`} />
          )}

          {isLoading && <LoadingBlocks />}

          {!isLoading && data && (
            <>
              <SnapshotReadinessCard date={date} looseEnds={looseEnds} />
              <TransactionsBlock data={data.transactions} />
              <AdministrationsBlock data={data.administrations} />
              <EncountersBlock data={data.encounters} />
              <InventoryBlock data={data.inventory} />
              <DrawerBlock data={data.drawer} />
            </>
          )}
        </div>
      </ScrollArea>

      {/* Sticky action footer: archival reporting, not an operational close. */}
      <footer className="ds-print-hide border-t border-border bg-card px-6 xl:px-8 py-3 flex items-center justify-end gap-2">
        <ComingSoonButton
          size="sm"
          tooltipText="Coming soon"
          icon={<Mail className="h-3.5 w-3.5" aria-hidden />}
        >
          Email
        </ComingSoonButton>
        <ComingSoonButton
          size="sm"
          tooltipText="Coming soon"
          icon={<Download className="h-3.5 w-3.5" aria-hidden />}
        >
          Download report
        </ComingSoonButton>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => setConfirmCloseOpen(true)}
          disabled={isLoading || isError || createSnapshot.isPending}
        >
          <Archive className="h-3.5 w-3.5" aria-hidden />
          {snapshot ? 'Replace snapshot' : 'Snapshot report'}
        </Button>
      </footer>

      <AlertDialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {snapshot ? 'Replace archival snapshot?' : 'Snapshot this report?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {snapshot
                ? `Replaces the archival Day Summary for ${formatLongDate(date)} taken ${formatLongDateTime(snapshot.createdAt)}. This does not close the clinic day or resolve outstanding work.`
                : `Saves the current Day Summary for ${formatLongDate(date)} as an archival report. This does not close the clinic day, close the drawer, or attest a human closer.`}
              {looseEnds && looseEndCount(looseEnds) > 0
                ? ` ${looseEndCount(looseEnds)} prior loose end${looseEndCount(looseEnds) === 1 ? '' : 's'} remain and are not changed by this snapshot.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={createSnapshot.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleConfirmClose()
              }}
              disabled={createSnapshot.isPending}
            >
              {createSnapshot.isPending
                ? 'Snapshotting…'
                : snapshot
                  ? 'Replace snapshot'
                  : 'Snapshot report'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function looseEndCount(looseEnds: LooseEnds): number {
  return (
    looseEnds.unsettledTransactions.count +
    looseEnds.openPriorDrawers.count +
    looseEnds.undocumentedAdministrations.count
  )
}

function SnapshotReadinessCard({ date, looseEnds }: { date: string; looseEnds?: LooseEnds }) {
  const count = looseEnds ? looseEndCount(looseEnds) : 0
  return (
    <Card className="ds-print-hide">
      <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
        <AlertTriangle
          className={count > 0 ? 'h-4 w-4 text-triage-due' : 'h-4 w-4 text-muted-foreground'}
          aria-hidden
        />
        <div className="flex-1">
          <p className="text-sm font-medium">Snapshot readiness</p>
          <p className="text-xs text-muted-foreground">
            {looseEnds
              ? count > 0
                ? `${count} prior loose end${count === 1 ? '' : 's'} remain: ${looseEnds.unsettledTransactions.count} unsettled transaction${looseEnds.unsettledTransactions.count === 1 ? '' : 's'}, ${looseEnds.openPriorDrawers.count} prior open drawer${looseEnds.openPriorDrawers.count === 1 ? '' : 's'}, and ${looseEnds.undocumentedAdministrations.count} undocumented administration${looseEnds.undocumentedAdministrations.count === 1 ? '' : 's'}.`
                : 'No prior loose ends are reported by the current review contract.'
              : 'Checking prior loose ends…'}
            {' A snapshot archives this report; it does not resolve work or close the clinic day.'}
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to={`/review-center?date=${encodeURIComponent(date)}`}>
            Review outstanding work
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}

// ── Blocks ───────────────────────────────────────────────────────────────────

function BlockCard({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: typeof Receipt
  title: string
  count: number
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
          <CardTitle className="text-sm">{title}</CardTitle>
          <Badge variant="outline" className="ml-auto font-mono tabular-nums">
            {count.toLocaleString('en-PH')}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function EmptyState({ icon: Icon, label }: { icon: typeof Receipt; label: string }) {
  return (
    <div className="px-6 py-8 text-center">
      <Icon className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" aria-hidden />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  )
}

function TransactionsBlock({ data }: { data: DaySummaryTransactions }) {
  return (
    <BlockCard icon={Receipt} title="Transactions" count={data.count}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <TotalCell label="Revenue" value={formatMoney(data.totalRevenue)} />
        <TotalCell
          label="Unsettled"
          value={formatMoney(data.totalUnsettled)}
          tone={parseFloat(data.totalUnsettled) > 0 ? 'destructive' : 'default'}
        />
        <TotalCell
          label="Methods"
          value={data.byMethod.length > 0 ? `${data.byMethod.length}` : DASH}
        />
      </div>

      {data.count === 0 ? (
        <EmptyState icon={Receipt} label="No transactions on this date." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SubTable title="By method">
            {data.byMethod.length === 0 ? (
              <p className="text-xs text-muted-foreground">{DASH}</p>
            ) : (
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="text-xs">Method</TableHead>
                    <TableHead className="text-xs text-right">Count</TableHead>
                    <TableHead className="text-xs text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byMethod.map((r) => (
                    <TableRow key={r.method}>
                      <TableCell className="text-sm">{r.method}</TableCell>
                      <TableCell className="text-sm font-mono tabular-nums text-right">
                        {r.count}
                      </TableCell>
                      <TableCell className="text-sm font-mono tabular-nums text-right">
                        {formatMoney(r.total)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SubTable>

          <SubTable title="By status">
            {data.byStatus.length === 0 ? (
              <p className="text-xs text-muted-foreground">{DASH}</p>
            ) : (
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs text-right">Count</TableHead>
                    <TableHead className="text-xs text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byStatus.map((r) => (
                    <TableRow key={r.status}>
                      <TableCell className="text-sm">
                        <Badge variant="outline" className="text-xs">
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm font-mono tabular-nums text-right">
                        {r.count}
                      </TableCell>
                      <TableCell className="text-sm font-mono tabular-nums text-right">
                        {formatMoney(r.total)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SubTable>
        </div>
      )}
    </BlockCard>
  )
}

function AdministrationsBlock({ data }: { data: DaySummaryAdministrations }) {
  return (
    <BlockCard icon={Syringe} title="Administrations" count={data.count}>
      {data.count === 0 ? (
        <EmptyState icon={Syringe} label="No administrations on this date." />
      ) : (
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10">
            <TableRow>
              <TableHead className="text-xs">Time</TableHead>
              <TableHead className="text-xs">Patient</TableHead>
              <TableHead className="text-xs">Service</TableHead>
              <TableHead className="text-xs">Lot</TableHead>
              <TableHead className="text-xs">Administered by</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((r) => (
              <TableRow key={r.orderId}>
                <TableCell className="text-sm font-mono tabular-nums">
                  {formatTime(r.administeredAt)}
                </TableCell>
                <TableCell className="text-sm">
                  <div className="flex flex-col">
                    <span>{r.patientName}</span>
                    <span className="text-xs text-muted-foreground font-mono tabular-nums">
                      {r.patientId}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-sm">{r.serviceName}</TableCell>
                <TableCell className="text-sm font-mono tabular-nums">
                  {r.lotNumber ?? DASH}
                </TableCell>
                <TableCell className="text-sm">{r.administeredByName ?? DASH}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </BlockCard>
  )
}

function EncountersBlock({ data }: { data: DaySummaryEncounters }) {
  const showWho = data.byWhoCategory.length > 0
  return (
    <BlockCard icon={Stethoscope} title="Encounters" count={data.count}>
      {data.count === 0 ? (
        <EmptyState icon={Stethoscope} label="No encounters on this date." />
      ) : (
        <div className={`grid grid-cols-1 ${showWho ? 'md:grid-cols-2' : ''} gap-4`}>
          <SubTable title="By bundle">
            {data.byBundle.length === 0 ? (
              <p className="text-xs text-muted-foreground">{DASH}</p>
            ) : (
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="text-xs">Bundle</TableHead>
                    <TableHead className="text-xs text-right">Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byBundle.map((r) => (
                    <TableRow key={r.bundleLabel}>
                      <TableCell className="text-sm">{r.bundleLabel || DASH}</TableCell>
                      <TableCell className="text-sm font-mono tabular-nums text-right">
                        {r.count}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SubTable>
          {showWho && (
            <SubTable title="WHO triage (rabies)">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="text-xs">Category</TableHead>
                    <TableHead className="text-xs text-right">Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byWhoCategory.map((r) => (
                    <TableRow key={r.category}>
                      <TableCell className="text-sm">{r.category}</TableCell>
                      <TableCell className="text-sm font-mono tabular-nums text-right">
                        {r.count}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </SubTable>
          )}
        </div>
      )}
    </BlockCard>
  )
}

function InventoryBlock({ data }: { data: DaySummaryInventory }) {
  return (
    <BlockCard icon={Package} title="Inventory movements" count={data.movementCount}>
      {data.movementCount === 0 ? (
        <EmptyState icon={Package} label="No inventory movements on this date." />
      ) : (
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10">
            <TableRow>
              <TableHead className="text-xs">Time</TableHead>
              <TableHead className="text-xs">Lot</TableHead>
              <TableHead className="text-xs">Service</TableHead>
              <TableHead className="text-xs">Direction</TableHead>
              <TableHead className="text-xs text-right">Qty</TableHead>
              <TableHead className="text-xs">Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((r) => (
              <TableRow key={r.movementId}>
                <TableCell className="text-sm font-mono tabular-nums">
                  {formatTime(r.occurredAt)}
                </TableCell>
                <TableCell className="text-sm font-mono tabular-nums">{r.lotNumber}</TableCell>
                <TableCell className="text-sm">{r.serviceName}</TableCell>
                <TableCell className="text-sm">
                  <Badge
                    variant={
                      r.direction === 'in' ? 'ok' : r.direction === 'out' ? 'info' : 'outline'
                    }
                    className="text-xs"
                  >
                    {r.direction}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm font-mono tabular-nums text-right">
                  {r.quantity}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {r.reasonCode ?? DASH}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </BlockCard>
  )
}

function DrawerBlock({ data }: { data: DaySummaryDrawer }) {
  const varianceTone = useMemo(() => {
    const v = parseFloat(data.varianceTotal)
    if (!Number.isFinite(v) || v === 0) return 'default'
    return Math.abs(v) > 0 ? 'destructive' : 'default'
  }, [data.varianceTotal])

  return (
    <BlockCard icon={Wallet} title="Cash drawer" count={data.sessionCount}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <TotalCell label="Opening float" value={formatMoney(data.openingFloatTotal)} />
        <TotalCell label="Declared close" value={formatMoney(data.declaredTotalTotal)} />
        <TotalCell label="Variance" value={formatMoney(data.varianceTotal)} tone={varianceTone} />
      </div>

      {data.sessionCount === 0 ? (
        <EmptyState icon={Wallet} label="No drawer sessions on this date." />
      ) : (
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10">
            <TableRow>
              <TableHead className="text-xs">Session</TableHead>
              <TableHead className="text-xs">State</TableHead>
              <TableHead className="text-xs">Opened</TableHead>
              <TableHead className="text-xs">Closed</TableHead>
              <TableHead className="text-xs text-right">Float</TableHead>
              <TableHead className="text-xs text-right">Declared</TableHead>
              <TableHead className="text-xs text-right">Variance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((r) => (
              <TableRow key={r.sessionId}>
                <TableCell className="text-sm font-mono tabular-nums">{r.sessionId}</TableCell>
                <TableCell className="text-sm">
                  <Badge variant={r.state === 'Open' ? 'info' : 'ok'} className="text-xs">
                    {r.state}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm font-mono tabular-nums">
                  {formatTime(r.openedAt)}
                </TableCell>
                <TableCell className="text-sm font-mono tabular-nums">
                  {r.closedAt ? formatTime(r.closedAt) : DASH}
                </TableCell>
                <TableCell className="text-sm font-mono tabular-nums text-right">
                  {formatMoney(r.openingFloat)}
                </TableCell>
                <TableCell className="text-sm font-mono tabular-nums text-right">
                  {formatMoney(r.declaredTotal)}
                </TableCell>
                <TableCell className="text-sm font-mono tabular-nums text-right">
                  {formatMoney(r.variance)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </BlockCard>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function TotalCell({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'destructive'
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      <p
        className={
          'text-lg font-semibold font-mono tabular-nums mt-0.5 ' +
          (tone === 'destructive' ? 'text-destructive' : 'text-foreground')
        }
      >
        {value}
      </p>
    </div>
  )
}

function SubTable({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border">
      <div className="px-3 py-2 border-b border-border bg-muted/40">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      </div>
      <div className="p-2">{children}</div>
    </div>
  )
}

function LoadingBlocks() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </CardContent>
        </Card>
      ))}
    </>
  )
}
