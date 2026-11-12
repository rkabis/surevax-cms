import { useState } from 'react'
import {
  Download,
  Plus,
  Package,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpFromLine,
  Sliders,
} from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { formatTime, formatLongDate, DASH } from '@/lib/format'
import { manilaCalendarDate } from '@/lib/clinicDate'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  PageHeader,
  KpiCell,
  KpiStrip,
  ListEmpty,
  DetailSheet,
  TableCard,
  SortableHead,
  ComingSoonButton,
  DetailRail,
} from '@/components/layout'
import { useTableSort } from '@/lib/useTableSort'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import {
  useInventoryLots,
  useInventoryMovements,
  type InventoryFilter,
  type InventoryMovementRow,
} from './api'
import InventoryDetail from './components/InventoryDetail'
import ReceiveStockDialog from './components/ReceiveStockDialog'
import { lotRestrictionSignals } from './inventorySignals'

function todayISO(): string {
  return manilaCalendarDate()
}

function shiftDay(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function daysUntilExpiry(expiryDate: string): number {
  const diff = new Date(expiryDate).getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

function expiryCell(expiryDate: string) {
  const days = daysUntilExpiry(expiryDate)
  const dateStr = new Date(expiryDate).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const daysColor =
    days <= 7 ? 'text-destructive' : days <= 30 ? 'text-triage-due' : 'text-muted-foreground'
  return (
    <div className="flex flex-col">
      <span className="text-sm">{dateStr}</span>
      <span className={`text-xs font-mono ${daysColor}`}>
        {days <= 0 ? 'Expired' : `${days} days`}
      </span>
    </div>
  )
}

function stockBadge(qty: string | number) {
  const n = Number(qty)
  if (n === 0) return <span className="text-sm font-mono tabular-nums text-destructive">0</span>
  return <span className="text-sm font-mono tabular-nums font-medium">{n}</span>
}

function availabilityBadge(qty: string | number) {
  const n = Number(qty)
  if (n === 0)
    return (
      <Badge variant="destructive" className="text-xs">
        Out of stock
      </Badge>
    )
  return (
    <Badge variant="ok" className="text-xs">
      Available
    </Badge>
  )
}

// ── Component ───────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<InventoryFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [receiveOpen, setReceiveOpen] = useState(false)
  const { sort, toggleSort } = useTableSort({ defaultCol: 'expiry_date', defaultOrder: 'asc' })

  const { data, isLoading, isError } = useInventoryLots({
    q: query,
    filter,
    sort: sort?.col,
    order: sort?.order,
  })

  const lots = data?.data ?? []
  const summary = data?.summary ?? {
    totalUnits: 0,
    lowStockCount: 0,
    quarantinedCount: 0,
    expiringCount: 0,
  }

  return (
    <div className="h-full flex flex-col">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card shrink-0">
        <PageHeader
          title="Inventory"
          description={<>{lots.length} lots · sorted by earliest expiry</>}
          actions={
            // "Receive shipment" used to be a stub in the primary slot, so
            // stock-in (the reason most people open this page) led nowhere.
            // It is now the in-app restock path (readiness R9): record a
            // delivery directly, rather than needing an engineer to edit the
            // seed or hand-write SQL. Inter-branch transfers stay separate:
            // that path only moves stock that already exists at another
            // branch (PendingReceipt → Received), it cannot originate supply.
            <>
              <ComingSoonButton size="sm" icon={<Download className="h-3.5 w-3.5" aria-hidden />}>
                Reorder report
              </ComingSoonButton>
              <Button size="sm" variant="outline" onClick={() => setReceiveOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                Receive shipment
              </Button>
              <Button size="sm" onClick={() => navigate('/inventory-transfers')}>
                <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                Transfers
              </Button>
            </>
          }
        />
      </div>

      {/* ── KPI strip ──────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-b border-border bg-card shrink-0">
        <KpiStrip>
          {/* Value is `totalUnits` (sum across lots). The previous label
              "Lots in stock" read as if 119 were the lot count when the
              actual lot count is 10 (shown in the subtitle). Label now
              matches the value's semantic. */}
          <KpiCell label="Units in stock" value={summary.totalUnits} subtitle="total units" />
          <KpiCell
            label="Expiring ≤ 7 days"
            value={summary.expiringCount}
            subtitle="urgent attention"
            tone={summary.expiringCount > 0 ? 'overdue' : 'default'}
          />
          <KpiCell
            label="Out of stock"
            value={summary.lowStockCount}
            subtitle="zero quantity"
            tone={summary.lowStockCount > 0 ? 'overdue' : 'default'}
          />
          <KpiCell
            label="Quarantined"
            value={summary.quarantinedCount}
            subtitle="held for review"
            tone={summary.quarantinedCount > 0 ? 'due' : 'default'}
          />
        </KpiStrip>
      </div>

      {/* ── Today's movements + Lots table ──────────────────────────── */}
      <div className="flex-1 min-h-0 flex flex-col gap-4 px-4 sm:px-6 xl:px-8 2xl:px-10 pb-4 overflow-auto">
        <MovementsCard />

        {/* ── Lots table ────────────────────────────────────────────── */}
        <section className="flex flex-col shrink-0 space-y-3">
          <div className="flex items-start gap-3 flex-wrap">
            <div>
              <h3 className="text-base font-semibold">Lots</h3>
              <p className="text-sm text-muted-foreground">Earliest expiry first</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Input
                type="search"
                placeholder="Search by name or batch…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-8 h-8 text-sm w-56"
              />
              <Package
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
                aria-hidden
              />
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {(['all', 'low_stock', 'expiring_soon', 'quarantined'] as InventoryFilter[]).map(
                (f) => (
                  <Button
                    key={f}
                    variant={filter === f ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setFilter(f)}
                  >
                    {f === 'all' && 'All'}
                    {f === 'low_stock' && 'Low Stock'}
                    {f === 'expiring_soon' && 'Expiring Soon'}
                    {f === 'quarantined' && 'Quarantined'}
                  </Button>
                ),
              )}
            </div>
          </div>

          {/* Loading */}
          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}

          {/* Error */}
          {isError && (
            <div className="py-12 flex items-center justify-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4" aria-hidden />
              <span className="text-sm">Failed to load inventory.</span>
            </div>
          )}

          {/* Empty */}
          {!isLoading && !isError && lots.length === 0 && (
            <ListEmpty
              icon={Package}
              message={query ? `No lots matching "${query}"` : 'No lots match this filter'}
            />
          )}

          {/* Table */}
          {!isLoading && !isError && lots.length > 0 && (
            <TableCard>
              <Table density="compact">
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Lot</TableHead>
                    <SortableHead col="expiry_date" sort={sort} onToggle={toggleSort}>
                      Expires
                    </SortableHead>
                    <SortableHead
                      col="quantity_on_hand"
                      sort={sort}
                      onToggle={toggleSort}
                      className="text-right w-[6.25rem]"
                    >
                      Quantity
                    </SortableHead>
                    <TableHead className="w-[6.25rem]">Availability</TableHead>
                    <TableHead className="w-[9rem]">Hold / recall</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lots.map((lot) => (
                    <TableRow
                      interactive
                      key={lot.id}
                      className="cursor-pointer"
                      onClick={() => setSelectedId(lot.id)}
                    >
                      <TableCell className="text-sm font-medium">{lot.serviceName}</TableCell>
                      <TableCell className="text-sm font-mono">{lot.batchNumber}</TableCell>
                      <TableCell>{expiryCell(lot.expiryDate)}</TableCell>
                      <TableCell className="text-right">{stockBadge(lot.quantityOnHand)}</TableCell>
                      <TableCell>{availabilityBadge(lot.quantityOnHand)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          {lotRestrictionSignals(lot).length === 0 ? (
                            <Badge variant="outline" className="text-xs">
                              Not quarantined
                            </Badge>
                          ) : (
                            lotRestrictionSignals(lot).map((signal) => (
                              <Badge
                                key={signal}
                                variant={signal === 'Active recall' ? 'overdue' : 'due'}
                                className="text-xs"
                              >
                                {signal}
                              </Badge>
                            ))
                          )}
                          {lot.isQuarantined && lot.quarantineReason && (
                            <span className="text-xs text-muted-foreground">
                              {lot.quarantineReason}
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableCard>
          )}

          {/* Footer */}
          <p className="text-xs text-muted-foreground pt-1 border-t border-border pt-2">
            {lots.length} lot{lots.length !== 1 ? 's' : ''}
            {filter !== 'all' ? ` (filtered)` : ''}
            {' · '}Sorted by expiry date
          </p>
        </section>
      </div>

      {/* ── Detail drawer ──────────────────────────────────────────── */}
      <DetailRail open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DetailSheet>
          <SheetHeader className="px-6 py-4 border-b border-border">
            <SheetTitle>Inventory lot</SheetTitle>
            <SheetDescription>
              Full lot details including service, stock, and audit trail.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 min-h-0">
            {selectedId && <InventoryDetail lotId={selectedId} />}
          </div>
        </DetailSheet>
      </DetailRail>

      {/* ── Receive stock dialog ────────────────────────────────────── */}
      <ReceiveStockDialog open={receiveOpen} onOpenChange={setReceiveOpen} />
    </div>
  )
}

// ── Movements card (day-scoped EOD reconciliation lens) ─────────────────────

function directionMeta(d: InventoryMovementRow['direction']) {
  if (d === 'in') return { variant: 'ok' as const, Icon: ArrowDownToLine, label: 'in' }
  if (d === 'out') return { variant: 'info' as const, Icon: ArrowUpFromLine, label: 'out' }
  return { variant: 'outline' as const, Icon: Sliders, label: 'adjust' }
}

function MovementsCard() {
  const [searchParams, setSearchParams] = useSearchParams()
  const date = searchParams.get('movDate') ?? todayISO()
  const setDate = (next: string) => {
    const params = new URLSearchParams(searchParams)
    params.set('movDate', next || todayISO())
    setSearchParams(params, { replace: true })
  }

  const { data, isLoading, isError } = useInventoryMovements(date)
  const rows = data?.rows ?? []
  const totals = data?.totals

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-semibold">Today's movements</h3>
          <p className="text-sm text-muted-foreground">
            {totals
              ? `${totals.count} movements · ${totals.byDirection.in} in · ${totals.byDirection.out} out · ${totals.byDirection.adjust} adjust`
              : 'Branch-day stock movement log'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2"
            onClick={() => setDate(shiftDay(date, -1))}
            aria-label="Previous day"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-8 max-w-[10.625rem] text-sm"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2"
            onClick={() => setDate(shiftDay(date, 1))}
            aria-label="Next day"
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button
            variant={date === todayISO() ? 'default' : 'outline'}
            size="sm"
            className="h-8 text-xs"
            onClick={() => setDate(todayISO())}
          >
            Today
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}
      {isError && (
        <div className="py-8 text-center">
          <AlertCircle className="h-6 w-6 text-destructive/60 mx-auto mb-2" aria-hidden />
          <p className="text-sm text-destructive">Failed to load movements.</p>
        </div>
      )}
      {!isLoading && !isError && rows.length === 0 && (
        <ListEmpty
          icon={Package}
          message={`No inventory movements on ${formatLongDate(date)}.`}
          className="py-8"
        />
      )}
      {!isLoading && !isError && rows.length > 0 && (
        <TableCard>
          <Table density="compact">
            <TableHeader className="sticky top-0 bg-card z-10">
              <TableRow>
                <TableHead className="text-xs">Time</TableHead>
                <TableHead className="text-xs">Direction</TableHead>
                <TableHead className="text-xs">Lot</TableHead>
                <TableHead className="text-xs">Service</TableHead>
                <TableHead className="text-xs text-right">Qty</TableHead>
                <TableHead className="text-xs">Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const meta = directionMeta(r.direction)
                return (
                  <TableRow key={r.movementId}>
                    <TableCell className="text-sm font-mono tabular-nums">
                      {formatTime(r.occurredAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={meta.variant} className="gap-1 text-xs">
                        <meta.Icon className="h-3 w-3" />
                        {meta.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm font-mono tabular-nums">{r.lotNumber}</TableCell>
                    <TableCell className="text-sm">{r.serviceName}</TableCell>
                    <TableCell className="text-sm font-mono tabular-nums text-right">
                      {r.quantity}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.reason ?? DASH}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableCard>
      )}
    </section>
  )
}
