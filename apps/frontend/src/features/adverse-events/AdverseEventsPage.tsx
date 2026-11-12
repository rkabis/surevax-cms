import { useState } from 'react'
import { AlertTriangle, Plus } from 'lucide-react'
import { useAdverseEvents, type AdverseEvent } from './api'
import { humanizeStatus } from '@/lib/status'
import { PatientLabel } from '@/components/PatientLabel'
import AdverseEventDetail from './components/AdverseEventDetail'
import ReportAdverseEventDialog from './components/ReportAdverseEventDialog'
import { severityVariant, outcomeVariant } from './components/AdverseEventDetail'
import { isAuthorityReported } from './authorityReporting'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  PageHeader,
  KpiCell,
  KpiStrip,
  DetailSheet,
  TableCard,
  PageToolbar,
  DetailRail,
} from '@/components/layout'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// ── tab config ────────────────────────────────────────────────────────────────

type SeverityTab = 'All' | 'Mild' | 'Moderate' | 'Severe' | 'LifeThreatening' | 'Fatal'

const SEVERITY_TABS: SeverityTab[] = [
  'All',
  'Mild',
  'Moderate',
  'Severe',
  'LifeThreatening',
  'Fatal',
]

// ── helpers ───────────────────────────────────────────────────────────────────

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '…' : str
}

function formatReportedDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-PH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// ── empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <TableRow>
      <TableCell colSpan={6} className="p-0">
        <div className="px-6 py-12 text-center">
          <AlertTriangle className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" aria-hidden />
          <p className="text-sm text-muted-foreground">No adverse events found.</p>
        </div>
      </TableCell>
    </TableRow>
  )
}

// ── main component ────────────────────────────────────────────────────────────

export default function AdverseEventsPage() {
  const [activeTab, setActiveTab] = useState<SeverityTab>('All')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reportOpen, setReportOpen] = useState(false)

  const filters = activeTab === 'All' ? {} : { severity: activeTab }
  const { data: events, isLoading, isError } = useAdverseEvents(filters)

  // Sort most recent first
  const sorted = events
    ? [...events].sort(
        (a, b) => new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime(),
      )
    : []

  const total = sorted.length
  const openCount = sorted.filter((e) => !e.outcome || e.outcome === 'Recovering').length
  const seriousCount = sorted.filter(
    (e) => e.severity === 'Severe' || e.severity === 'LifeThreatening' || e.severity === 'Fatal',
  ).length
  const authorityReportedCount = sorted.filter(isAuthorityReported).length

  function handleRowClick(event: AdverseEvent) {
    setSelectedId((prev) => (prev === event.id ? null : event.id))
  }

  return (
    <div className="flex flex-col h-full">
      {/* Page head */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="AEFI Reports"
          description="Local adverse-event records; external reporting is shown only when recorded"
          actions={
            <Button size="sm" onClick={() => setReportOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" aria-hidden />
              New report
            </Button>
          }
        />
      </div>

      {/* KPI strip */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-b border-border bg-card">
        <KpiStrip>
          <KpiCell label="YTD" value={total} subtitle="reports total" />
          <KpiCell label="Open" value={openCount} subtitle="awaiting review" />
          <KpiCell
            label="Serious"
            value={seriousCount}
            subtitle="severe / life-threatening"
            tone="overdue"
          />
          <KpiCell
            label="Authority reported"
            value={authorityReportedCount}
            subtitle="external timestamp recorded"
          />
        </KpiStrip>
      </div>

      {/* Severity filter tabs */}
      <PageToolbar>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as SeverityTab)}>
          <TabsList className="h-8">
            {SEVERITY_TABS.map((tab) => (
              <TabsTrigger key={tab} value={tab} className="text-xs h-7 px-3">
                {tab === 'LifeThreatening' ? 'Life-Threatening' : tab}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </PageToolbar>

      {/* Table */}
      <div className="flex-1 overflow-auto px-4 sm:px-6 xl:px-8 2xl:px-10 py-4">
        {isError ? (
          <div className="py-12 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2" aria-hidden />
            <p className="text-sm text-destructive">Failed to load adverse events.</p>
          </div>
        ) : (
          <TableCard>
            <Table density="compact">
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow className="text-xs">
                  <TableHead className="w-[11.25rem]">Event ID</TableHead>
                  <TableHead className="w-[12.5rem]">Patient</TableHead>
                  <TableHead className="w-[8.75rem]">Reported</TableHead>
                  <TableHead className="w-[7.5rem]">Severity</TableHead>
                  <TableHead className="w-[7.5rem]">Outcome</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="p-0">
                      <div className="px-6 py-3 space-y-3">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Skeleton key={i} className="h-8 w-full" />
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : sorted.length === 0 ? (
                  <EmptyState />
                ) : (
                  sorted.map((event) => (
                    <TableRow
                      interactive
                      key={event.id}
                      data-severity={severityVariant(event.severity)}
                      data-state={selectedId === event.id ? 'selected' : undefined}
                      className="stripe cursor-pointer"
                      onClick={() => handleRowClick(event)}
                    >
                      <TableCell className="font-mono tabular-nums text-xs">{event.id}</TableCell>
                      <TableCell>
                        {event.patientFirstName ? (
                          <PatientLabel
                            patient={{
                              displayId: event.patientId,
                              firstName: event.patientFirstName,
                              lastName: event.patientLastName ?? '',
                            }}
                            showMrn={false}
                          />
                        ) : (
                          <span className="font-mono tabular-nums text-xs">{event.patientId}</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono tabular-nums text-xs">
                        {formatReportedDate(event.reportedAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={severityVariant(event.severity)}>
                          {humanizeStatus(event.severity)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {event.outcome ? (
                          <Badge variant={outcomeVariant(event.outcome)}>
                            {humanizeStatus(event.outcome)}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {truncate(event.description, 60)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableCard>
        )}
      </div>

      {/* Detail sheet */}
      <DetailRail open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DetailSheet width="narrow">
          {selectedId && <AdverseEventDetail eventId={selectedId} />}
        </DetailSheet>
      </DetailRail>

      {/* Report dialog */}
      <ReportAdverseEventDialog open={reportOpen} onOpenChange={setReportOpen} />
    </div>
  )
}
