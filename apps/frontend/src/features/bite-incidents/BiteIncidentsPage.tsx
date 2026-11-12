import { useState } from 'react'
import { Dog, Plus } from 'lucide-react'
import { useBiteIncidents } from './api'
import { formatDate } from '@/lib/format'
import { humanizeStatus } from '@/lib/status'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { Skeleton } from '@/components/ui/skeleton'
import {
  PageHeader,
  KpiCell,
  KpiStrip,
  ListEmpty,
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
import { ScrollArea } from '@/components/ui/scroll-area'
import BiteIncidentDetail from './components/BiteIncidentDetail'
import CaptureIncidentDialog from './components/CaptureIncidentDialog'

function exposureBadgeVariant(cat: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (cat === 'III') return 'destructive'
  if (cat === 'II') return 'secondary'
  return 'outline'
}

function followupStatusVariant(
  status: string | undefined,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (!status) return 'outline'
  if (status === 'Completed') return 'default'
  if (status === 'Cancelled') return 'destructive'
  return 'secondary'
}

export default function BiteIncidentsPage() {
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [captureOpen, setCaptureOpen] = useState(false)

  const { data, isLoading } = useBiteIncidents()

  const filtered = (data ?? []).filter((row) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      row.id.toLowerCase().includes(q) ||
      row.patientFirstName?.toLowerCase().includes(q) ||
      row.patientLastName?.toLowerCase().includes(q) ||
      row.species.toLowerCase().includes(q) ||
      row.biteSite.toLowerCase().includes(q)
    )
  })

  const total = data?.length ?? 0
  const pending = (data ?? []).filter((r) => r.followup?.status === 'Pending').length
  const catIII = (data ?? []).filter((r) => r.exposureCategory === 'III').length

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="Bite Incidents"
          description="Animal-bite exposure registry with Day-14 observation tracking"
          actions={
            <Button size="sm" onClick={() => setCaptureOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              Capture Incident
            </Button>
          }
        />
      </div>

      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-b border-border bg-card">
        <KpiStrip>
          <KpiCell label="Total incidents" value={String(total)} />
          <KpiCell label="Pending observation" value={String(pending)} />
          <KpiCell label="Category III" value={String(catIII)} />
        </KpiStrip>
      </div>

      <PageToolbar>
        <Input
          placeholder="Search by patient, species, bite site…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </PageToolbar>

      <ScrollArea className="flex-1">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4">
          <TableCard>
            <Table density="compact">
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Species</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Bite site</TableHead>
                  <TableHead>Followup</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <ListEmpty
                        icon={Dog}
                        // CTA only when the list is genuinely empty — on a
                        // search miss the next step is editing the query.
                        {...(search
                          ? {}
                          : {
                              action: (
                                <Button size="sm" onClick={() => setCaptureOpen(true)}>
                                  <Dog className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                                  Record bite incident
                                </Button>
                              ),
                            })}
                        message={
                          search ? 'No incidents match your search.' : 'No bite incidents recorded.'
                        }
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((row) => (
                    <TableRow
                      interactive
                      key={row.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedId(row.id)}
                    >
                      <TableCell className="font-mono text-xs">{row.id}</TableCell>
                      <TableCell>
                        {row.patientLastName}, {row.patientFirstName}
                      </TableCell>
                      <TableCell>{formatDate(row.incidentDate)}</TableCell>
                      <TableCell>{row.species}</TableCell>
                      <TableCell>
                        <Badge variant={exposureBadgeVariant(row.exposureCategory)}>
                          Cat.&nbsp;{row.exposureCategory}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[10rem] truncate">{row.biteSite}</TableCell>
                      <TableCell>
                        {row.followup ? (
                          <Badge variant={followupStatusVariant(row.followup.status)}>
                            {row.followup.outcome
                              ? humanizeStatus(row.followup.outcome)
                              : humanizeStatus(row.followup.status)}
                          </Badge>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableCard>
        </div>
      </ScrollArea>

      <DetailRail open={!!selectedId} onOpenChange={(o) => !o && setSelectedId(null)}>
        <BiteIncidentDetail id={selectedId} />
      </DetailRail>

      <CaptureIncidentDialog open={captureOpen} onOpenChange={setCaptureOpen} />
    </div>
  )
}
