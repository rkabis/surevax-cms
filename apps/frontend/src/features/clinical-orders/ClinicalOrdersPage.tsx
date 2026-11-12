import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ClipboardList,
  AlertCircle,
  Search,
  Syringe,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { useScheduledOrders, type ScheduledOrder } from '@/features/scheduled-orders/api'
import { useAdministeredOrders, type AdministeredOrderRow } from './api'
import ClinicalOrderDetail from './components/ClinicalOrderDetail'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageHeader, ListEmpty, DetailSheet, TableCard, DetailRail } from '@/components/layout'
import { formatTime, formatDate } from '@/lib/format'
import { clinicalOrderStatusVariant, humanizeStatus } from '@/lib/status'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'

// ── Helpers ────────────────────────────────────────────────────────────────────

type StatusSev = 'overdue' | 'due' | 'ok' | 'info'

function severityForStatus(status: string): StatusSev {
  switch (status) {
    case 'Missed':
    case 'Refused':
      return 'overdue'
    case 'Scheduled':
    case 'Pending':
      return 'due'
    case 'Completed':
      return 'ok'
    case 'Cancelled':
    default:
      return 'info'
  }
}

function localDateStr(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function stepDate(dateStr: string, delta: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + delta)
  return localDateStr(d)
}

// ── Worklist tab (Pending/Open/etc.) ──────────────────────────────────────────

function WorklistTab({ setSelectedId }: { setSelectedId: (id: string | null) => void }) {
  // Local input state for snappy typing; the query param is debounced.
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 250)
    return () => clearTimeout(id)
  }, [query])

  const { data, isLoading, isError } = useScheduledOrders(debouncedQuery, 'all')
  const rows: ScheduledOrder[] = data?.data ?? []

  return (
    <div className="p-4 sm:p-6 xl:p-8 space-y-4">
      <div className="relative max-w-sm">
        <Search
          className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          placeholder="Search patient or service…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8"
          aria-label="Search clinical orders"
        />
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-4 w-4" aria-hidden />
          <span className="text-sm">Failed to load clinical orders.</span>
        </div>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <ListEmpty icon={ClipboardList} message="No clinical orders found." className="px-0" />
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <TableCard>
          <Table density="compact" className="w-full text-sm">
            <TableHeader className="sticky top-0 bg-card z-10">
              <TableRow className="text-left">
                <TableHead className="px-3 font-medium font-mono tabular-nums">Order ID</TableHead>
                <TableHead className="px-3 font-medium">Patient</TableHead>
                <TableHead className="px-3 font-medium">Service</TableHead>
                <TableHead className="px-3 font-medium">Status</TableHead>
                <TableHead className="px-3 font-medium font-mono tabular-nums">
                  Scheduled Date
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((order) => {
                const sev = severityForStatus(order.status)
                return (
                  <TableRow
                    interactive
                    key={order.id}
                    data-severity={sev}
                    className="stripe cursor-pointer border-t hover:bg-accent/30 transition-colors"
                    onClick={() => setSelectedId(order.id)}
                  >
                    <TableCell className="px-3 font-mono tabular-nums">{order.id}</TableCell>
                    <TableCell className="px-3">{order.patientName}</TableCell>
                    <TableCell className="px-3">{order.service ?? '—'}</TableCell>
                    <TableCell className="px-3">
                      <Badge variant={clinicalOrderStatusVariant(order.status)} className="text-xs">
                        {humanizeStatus(order.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-3 font-mono tabular-nums text-muted-foreground">
                      {order.scheduledDate ? formatDate(order.scheduledDate + 'T00:00:00') : '—'}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableCard>
      )}
    </div>
  )
}

// ── Administered tab ──────────────────────────────────────────────────────────

function AdministeredTab() {
  const [searchParams, setSearchParams] = useSearchParams()
  const today = localDateStr(new Date())
  const date = searchParams.get('administeredOn') ?? today

  function setDate(d: string) {
    setSearchParams((prev) => {
      const next = new Map(prev)
      next.set('administeredOn', d)
      return Object.fromEntries(next)
    })
  }

  const { data: rows = [], isLoading, isError } = useAdministeredOrders(date)

  const displayDate = formatDate(date + 'T00:00:00')

  return (
    <div className="p-4 sm:p-6 xl:p-8 space-y-4">
      {/* Date scope controls */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDate(stepDate(date, -1))}
          aria-label="Earlier day"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Earlier
        </Button>
        <Input
          type="date"
          value={date}
          max={today}
          onChange={(e) => {
            if (e.target.value) setDate(e.target.value)
          }}
          className="w-40"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDate(stepDate(date, 1))}
          disabled={date >= today}
          aria-label="Later day"
        >
          Later
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      {/* Count strip */}
      {!isLoading && !isError && (
        <p className="text-sm text-muted-foreground">
          {rows.length} administration{rows.length !== 1 ? 's' : ''} on {displayDate}
        </p>
      )}

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-4 w-4" aria-hidden />
          <span className="text-sm">Failed to load administrations.</span>
        </div>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <ListEmpty
          icon={Syringe}
          message={`No administrations on ${displayDate}.`}
          className="px-0"
        />
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <TableCard>
          <Table density="compact" className="w-full text-sm">
            <TableHeader className="sticky top-0 bg-card z-10">
              <TableRow className="text-left">
                <TableHead className="px-3 font-medium font-mono tabular-nums">Time</TableHead>
                <TableHead className="px-3 font-medium">Patient</TableHead>
                <TableHead className="px-3 font-medium">Service</TableHead>
                <TableHead className="px-3 font-medium font-mono tabular-nums">Lot</TableHead>
                <TableHead className="px-3 font-medium">Nurse</TableHead>
                <TableHead className="px-3 font-medium">Encounter</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row: AdministeredOrderRow) => (
                <TableRow
                  key={row.id}
                  className="stripe border-t hover:bg-accent/30 transition-colors"
                >
                  <TableCell className="px-3 font-mono tabular-nums text-muted-foreground">
                    {formatTime(row.administeredAt)}
                  </TableCell>
                  <TableCell className="px-3">
                    <span>{row.patientName}</span>
                  </TableCell>
                  <TableCell className="px-3">{row.serviceName}</TableCell>
                  <TableCell className="px-3 font-mono tabular-nums">
                    {row.lotNumber ?? '—'}
                  </TableCell>
                  <TableCell className="px-3">{row.administeredByName ?? '—'}</TableCell>
                  <TableCell className="px-3 font-mono tabular-nums text-muted-foreground">
                    {row.encounterId ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

type TabId = 'worklist' | 'administered'

export default function ClinicalOrdersPage() {
  const [activeTab, setActiveTab] = useState<TabId>('worklist')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [, setSearchParams] = useSearchParams()

  function handleTabChange(tab: TabId) {
    setActiveTab(tab)
    if (tab !== 'administered') {
      // Clear administered date param when leaving the tab
      setSearchParams((prev) => {
        const next = new Map(prev)
        next.delete('administeredOn')
        return Object.fromEntries(next)
      })
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="Clinical Orders"
          description={
            activeTab === 'worklist' ? 'Active worklist' : 'Date-scoped administration log'
          }
        />

        {/* Tab bar */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => handleTabChange(v as typeof activeTab)}
          className="mt-3"
        >
          <TabsList>
            <TabsTrigger value="worklist">Worklist</TabsTrigger>
            <TabsTrigger value="administered">Administered</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <ScrollArea className="flex-1">
        {activeTab === 'worklist' && <WorklistTab setSelectedId={setSelectedId} />}
        {activeTab === 'administered' && <AdministeredTab />}
      </ScrollArea>

      <DetailRail
        open={!!selectedId}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
      >
        <DetailSheet width="narrow">
          <SheetHeader className="p-6 pb-2">
            <SheetTitle>Clinical Order Detail</SheetTitle>
            <SheetDescription>Read-only view of the selected order.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 min-h-0">
            {selectedId && <ClinicalOrderDetail orderId={selectedId} />}
          </div>
        </DetailSheet>
      </DetailRail>
    </div>
  )
}
