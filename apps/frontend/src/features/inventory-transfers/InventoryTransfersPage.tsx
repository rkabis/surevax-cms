import { useState } from 'react'
import { ArrowRightLeft, Plus } from 'lucide-react'
import { useInventoryTransfers, type TransferStatus } from './api'
import { formatDateTime } from '@/lib/format'
import { humanizeStatus } from '@/lib/status'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  PageHeader,
  KpiCell,
  KpiStrip,
  ListEmpty,
  TableCard,
  PageToolbar,
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
import TransferDetail from './components/TransferDetail'
import ShipTransferDialog from './components/ShipTransferDialog'

const STATUS_TABS: Array<{ value: TransferStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'PendingReceipt', label: 'Pending' },
  { value: 'Received', label: 'Received' },
  { value: 'Cancelled', label: 'Cancelled' },
]

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'Received') return 'default'
  if (status === 'Cancelled') return 'destructive'
  return 'secondary'
}

export default function InventoryTransfersPage() {
  const [tab, setTab] = useState<TransferStatus | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [shipOpen, setShipOpen] = useState(false)

  const filters = tab !== 'all' ? { status: tab } : {}
  const { data: transfers = [], isLoading } = useInventoryTransfers(filters)

  const pending = transfers.filter((t) => t.status === 'PendingReceipt').length
  const received = transfers.filter((t) => t.status === 'Received').length
  const cancelled = transfers.filter((t) => t.status === 'Cancelled').length

  return (
    <div className="h-full flex flex-col">
      {/* Page header */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="Inventory Transfers"
          description="Branch-to-branch inventory transfers with receipt confirmation"
          actions={
            <Button size="sm" onClick={() => setShipOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Ship Transfer
            </Button>
          }
        />
      </div>

      {/* KPI strip */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-b border-border bg-card">
        <KpiStrip>
          <KpiCell label="Pending Receipt" value={pending} />
          <KpiCell label="Received" value={received} />
          <KpiCell label="Cancelled" value={cancelled} />
        </KpiStrip>
      </div>

      {/* Toolbar */}
      <PageToolbar>
        <Tabs value={tab} onValueChange={(v) => setTab(v as TransferStatus | 'all')}>
          <TabsList>
            {STATUS_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </PageToolbar>

      {/* Table */}
      <ScrollArea className="flex-1">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4">
          <TableCard>
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead>Transfer ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Source → Destination</TableHead>
                  <TableHead>Lot</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Shipped</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <TableRow key={i}>
                      {[...Array(6)].map((__, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : transfers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <ListEmpty icon={ArrowRightLeft} message="No inventory transfers found." />
                    </TableCell>
                  </TableRow>
                ) : (
                  transfers.map((t) => (
                    <TableRow
                      interactive
                      key={t.id}
                      className="cursor-pointer"
                      onClick={() => setSelectedId(t.id)}
                    >
                      <TableCell className="font-mono text-xs">{t.id}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(t.status)}>{humanizeStatus(t.status)}</Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">
                          {t.sourceBranchName ?? t.sourceBranchDisplayId} →{' '}
                          {t.destinationBranchName ?? t.destinationBranchDisplayId}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">{t.productName ?? 'Unknown product'}</span>
                        <span className="block font-mono tabular-nums text-xs text-muted-foreground">
                          {t.lotBatchNumber ?? t.lotDisplayId}
                        </span>
                      </TableCell>
                      <TableCell>{t.quantity}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatDateTime(t.shippedAt)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableCard>
        </div>
      </ScrollArea>

      {/* Detail sheet */}
      <Sheet open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <TransferDetail id={selectedId} />
      </Sheet>

      {/* Ship dialog */}
      <ShipTransferDialog open={shipOpen} onOpenChange={setShipOpen} />
    </div>
  )
}
