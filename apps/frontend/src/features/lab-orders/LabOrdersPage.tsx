import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FlaskConical, Search } from 'lucide-react'
import { useLabOrders } from './api'
import LabOrderDetail from './components/LabOrderDetail'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  PageHeader,
  KpiCell,
  KpiStrip,
  ListEmpty,
  DetailSheet,
  TableCard,
  ErrorBanner,
  PageToolbar,
  SortableHead,
  DetailRail,
} from '@/components/layout'
import { useTableSort } from '@/lib/useTableSort'
import { Skeleton } from '@/components/ui/skeleton'
import { SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { DASH, formatDateTime as formatTs } from '@/lib/format'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { humanizeStatus } from '@/lib/status'
import { cn } from '@/lib/utils'

// Backend status enum (schema.ts labOrderStatusEnum): Pending | Sent |
// ResultReceived | Cancelled. The previous filter values 'Collected' and
// 'Resulted' did not exist in the enum → KPIs always rendered zero and
// the In lab / Resulted tabs showed empty lists even when matching rows
// existed.
type StatusFilter = 'all' | 'Pending' | 'Sent' | 'ResultReceived' | 'Cancelled'
const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'Pending', label: 'Pending' },
  { key: 'Sent', label: 'In lab' },
  { key: 'ResultReceived', label: 'Resulted' },
  { key: 'Cancelled', label: 'Cancelled' },
]

export default function LabOrdersPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { sort, toggleSort } = useTableSort({ defaultCol: 'created_at', defaultOrder: 'desc' })
  const { data, isLoading, isError } = useLabOrders({ sort: sort?.col, order: sort?.order })
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Local input state for snappy typing; URL write is debounced.
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '')
  const [debouncedQ, setDebouncedQ] = useState(() => searchParams.get('q') ?? '')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    () => (searchParams.get('status') as StatusFilter | null) ?? 'all',
  )

  // Debounce URL write for search (250 ms).
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(query)
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (query) {
            next.set('q', query)
          } else {
            next.delete('q')
          }
          return next
        },
        { replace: true },
      )
    }, 250)
    return () => clearTimeout(t)
  }, [query, setSearchParams])

  function handleStatusChange(key: StatusFilter) {
    setStatusFilter(key)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (key === 'all') {
          next.delete('status')
        } else {
          next.set('status', key)
        }
        return next
      },
      { replace: true },
    )
  }

  // Backend returns a bare array (gotchas.md "List response is a bare array").
  const allRows = useMemo(() => data ?? [], [data])

  const rows = useMemo(() => {
    let list = allRows
    if (statusFilter !== 'all') {
      list = list.filter((r) => r.status === statusFilter)
    }
    const q = debouncedQ.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (r) =>
          r.serviceName.toLowerCase().includes(q) ||
          (r.laboratoryName?.toLowerCase().includes(q) ?? false) ||
          r.status.toLowerCase().includes(q),
      )
    }
    return list
  }, [allRows, statusFilter, debouncedQ])

  // Status values match the backend labOrderStatusEnum (schema.ts).
  const pendingCount = allRows.filter((r: { status?: string }) => r.status === 'Pending').length
  const collectedCount = allRows.filter((r: { status?: string }) => r.status === 'Sent').length
  const resultedCount = allRows.filter(
    (r: { status?: string }) => r.status === 'ResultReceived',
  ).length
  // "Sent out" = orders routed to an external partner laboratory.
  // laboratoryName is populated on the list response when the order is
  // tied to a partner lab (vs. in-house workup with no laboratoryId).
  const sentOutCount = allRows.filter(
    (r: { laboratoryName?: string | null }) => r.laboratoryName != null,
  ).length

  return (
    <div className="h-full flex flex-col">
      {/* Page header — design system pattern */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="Lab Orders"
          description={`${allRows.length} orders · ${resultedCount} resulted · ${pendingCount} pending`}
        />

        <KpiStrip className="mt-4">
          <KpiCell label="Pending collection" value={pendingCount} subtitle="awaiting draw" />
          <KpiCell label="In lab" value={collectedCount} subtitle="processing" />
          <KpiCell label="Resulted" value={resultedCount} subtitle="ready for review" tone="ok" />
          <KpiCell label="Sent out" value={sentOutCount} subtitle="external labs" />
        </KpiStrip>
      </div>

      {/* Search + status filter */}
      <PageToolbar>
        <div className="relative flex-1 max-w-sm xl:max-w-md">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Search service, lab, status…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => handleStatusChange(f.key)}
              className={cn(
                'px-3 py-1 text-sm rounded-sm transition-colors',
                statusFilter === f.key
                  ? 'bg-background text-foreground shadow-sm font-medium'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </PageToolbar>

      <ScrollArea className="flex-1">
        <div className="p-6 xl:p-8">
          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}

          {isError && <ErrorBanner message="Failed to load lab orders. Refresh to retry." />}

          {!isLoading && !isError && rows.length === 0 && (
            <ListEmpty
              icon={FlaskConical}
              message={debouncedQ ? `No lab orders matching "${debouncedQ}"` : 'No lab orders yet.'}
              className="px-0"
            />
          )}

          {!isLoading && !isError && rows.length > 0 && (
            <TableCard>
              <Table density="compact" className="w-full text-sm">
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow className="text-left">
                    <TableHead className="px-3 font-medium">Laboratory</TableHead>
                    <TableHead className="px-3 font-medium">Service</TableHead>
                    <SortableHead
                      col="status"
                      sort={sort}
                      onToggle={toggleSort}
                      className="px-3 py-2 font-medium"
                    >
                      Status
                    </SortableHead>
                    <SortableHead
                      col="sent_at"
                      sort={sort}
                      onToggle={toggleSort}
                      className="px-3 py-2 font-medium"
                    >
                      Sent at
                    </SortableHead>
                    <SortableHead
                      col="created_at"
                      sort={sort}
                      onToggle={toggleSort}
                      className="px-3 py-2 font-medium"
                    >
                      Created
                    </SortableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow
                      interactive
                      key={r.id}
                      onClick={() => setSelectedId(r.id)}
                      className="border-t cursor-pointer hover:bg-accent/30 transition-colors"
                    >
                      <TableCell className="px-3">{r.laboratoryName ?? DASH}</TableCell>
                      <TableCell className="px-3">{r.serviceName}</TableCell>
                      <TableCell className="px-3">
                        <Badge variant="outline" className="text-xs">
                          {humanizeStatus(r.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-3 text-muted-foreground">
                        {formatTs(r.sentAt)}
                      </TableCell>
                      <TableCell className="px-3 text-muted-foreground">
                        {formatTs(r.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableCard>
          )}
        </div>
      </ScrollArea>

      <DetailRail
        open={!!selectedId}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
      >
        <DetailSheet width="narrow">
          <SheetHeader className="p-6 pb-2">
            <SheetTitle>Lab Order Detail</SheetTitle>
            <SheetDescription>Read-only view of the selected lab order.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 min-h-0">
            {selectedId && <LabOrderDetail labOrderId={selectedId} />}
          </div>
        </DetailSheet>
      </DetailRail>
    </div>
  )
}
