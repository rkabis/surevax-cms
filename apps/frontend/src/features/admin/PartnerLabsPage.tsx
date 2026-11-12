import { useState } from 'react'
import { FlaskConical, Plus } from 'lucide-react'
import { formatDate } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  PageHeader,
  KpiCell,
  KpiStrip,
  ListEmpty,
  TableCard,
  ComingSoonButton,
} from '@/components/layout'
import { usePartnerLabs } from './partnerLabsApi'
import PartnerLabDetail from './components/PartnerLabDetail'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'

export default function PartnerLabsPage() {
  const { data, isLoading, error } = usePartnerLabs()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const labs = data ?? []
  const activeCount = labs.filter((l) => l.isActive).length
  const inactiveCount = labs.length - activeCount

  return (
    <div className="h-full flex flex-col">
      {/* Page head */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="Partner Laboratories"
          description={
            isLoading
              ? 'Loading…'
              : `${labs.length} partner${labs.length !== 1 ? 's' : ''} · ${activeCount} active`
          }
          actions={
            <ComingSoonButton size="sm" icon={<Plus className="h-3.5 w-3.5" aria-hidden />}>
              Add partner
            </ComingSoonButton>
          }
        />
      </div>

      {/* KPI strip */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-b border-border bg-card">
        <KpiStrip>
          <KpiCell
            label="Total partners"
            value={isLoading ? '—' : labs.length}
            subtitle="registered labs"
          />
          <KpiCell
            label="Active"
            value={isLoading ? '—' : activeCount}
            subtitle="integrated labs"
          />
          <KpiCell
            label="Inactive"
            value={isLoading ? '—' : inactiveCount}
            subtitle="disabled / legacy"
          />
          <KpiCell
            label="With contact email"
            value={isLoading ? '—' : labs.filter((l) => !!l.email).length}
            subtitle="email on file"
          />
        </KpiStrip>
      </div>

      {/* Table */}
      <ScrollArea className="flex-1">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4">
          {error && (
            <div className="py-12 text-center">
              <FlaskConical className="h-8 w-8 text-destructive/50 mx-auto mb-2" aria-hidden />
              <p className="text-sm text-destructive">Failed to load partner laboratories.</p>
            </div>
          )}

          {isLoading && (
            <div className="space-y-2" role="status" aria-label="Loading partner labs">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          )}

          {!isLoading && !error && labs.length === 0 && (
            <ListEmpty icon={FlaskConical} message="No partner laboratories yet" />
          )}

          {!isLoading && !error && labs.length > 0 && (
            <TableCard>
              <Table className="w-full text-sm">
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="text-left px-6 font-medium">Name</TableHead>
                    <TableHead className="text-left px-4 font-medium">Contact</TableHead>
                    <TableHead className="text-left px-4 font-medium">Email</TableHead>
                    <TableHead className="text-left px-4 font-medium">Phone</TableHead>
                    <TableHead className="text-left px-4 font-medium">Status</TableHead>
                    <TableHead className="text-left px-4 font-medium">Added</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {labs.map((lab) => (
                    <TableRow
                      interactive
                      key={lab.id}
                      onClick={() => setSelectedId(lab.id)}
                      className="border-b border-border hover:bg-accent/50 transition-colors cursor-pointer"
                    >
                      <TableCell className="px-6">
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 shrink-0 rounded-full bg-muted flex items-center justify-center">
                            <FlaskConical
                              className="h-3.5 w-3.5 text-muted-foreground"
                              aria-hidden
                            />
                          </div>
                          <span className="font-medium">{lab.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="px-4 text-muted-foreground">
                        {lab.contactName ?? '—'}
                      </TableCell>
                      <TableCell className="px-4 text-muted-foreground font-mono tabular-nums text-xs">
                        {lab.email ?? '—'}
                      </TableCell>
                      <TableCell className="px-4 text-muted-foreground font-mono tabular-nums text-xs">
                        {lab.contactNumber ?? '—'}
                      </TableCell>
                      <TableCell className="px-4">
                        <Badge variant={lab.isActive ? 'default' : 'outline'} className="text-xs">
                          {lab.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-4 text-muted-foreground text-xs font-mono tabular-nums">
                        {formatDate(lab.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableCard>
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="px-6 py-2 xl:px-8 border-t border-border">
        <p className="text-xs text-muted-foreground">
          {labs.length} laborator{labs.length !== 1 ? 'ies' : 'y'}
        </p>
      </div>

      <PartnerLabDetail
        id={selectedId}
        open={!!selectedId}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
      />
    </div>
  )
}
