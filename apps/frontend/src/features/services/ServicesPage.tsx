import { useState } from 'react'
import { Search, Wrench, AlertCircle, Plus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader, KpiCell, KpiStrip, ListEmpty, TableCard } from '@/components/layout'
import { formatMoney } from '@/lib/format'
import { CATALOG_WRITE_ROLES, hasRole } from '@/lib/roles'
import { useAuth } from '@/features/auth/context'
import { useServices } from './api'
import ServiceDetail from './components/ServiceDetail'
import CreateServiceDialog from './components/CreateServiceDialog'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'

export default function ServicesPage() {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  // Mirrors the backend gate on the catalog write routes, so a Nurse, Cashier
  // or the shared `Branch` login is never shown a create affordance that 403s.
  const { user } = useAuth()
  const canEditCatalog = hasRole(user, CATALOG_WRITE_ROLES)

  const { data: services, isLoading, isError } = useServices(query)

  function handleRowClick(id: string) {
    setSelectedId(id)
    setDetailOpen(true)
  }

  const rows = services ?? []

  return (
    <div className="h-full flex flex-col">
      {/* Page header — design system pattern */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="Services & Pricing"
          description={`${rows.length} active · prices effective May 1, 2026`}
          actions={
            canEditCatalog ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                New service
              </Button>
            ) : null
          }
        />

        <KpiStrip className="mt-4">
          <KpiCell label="Active services" value={rows.length} subtitle="across categories" />
          <KpiCell
            label="Consult"
            value={rows.filter((r) => r.serviceType === 'Consultation').length}
            subtitle="general · PEP · tele"
          />
          <KpiCell
            label="Vaccine"
            value={rows.filter((r) => r.serviceType === 'Vaccine').length}
            subtitle="ARV · TT · HPV · Hep B"
          />
          <KpiCell
            label="Lab · Procedure"
            value={
              rows.filter((r) => ['Lab', 'Procedure', 'Product'].includes(r.serviceType)).length
            }
            subtitle="lab · procedure · product"
          />
        </KpiStrip>

        {/* Search */}
        <div className="relative flex-1 max-w-sm xl:max-w-md mt-4">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Search by name or code…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>

      {/* Table */}
      <ScrollArea className="flex-1">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4">
          {isLoading && (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          )}

          {isError && !isLoading && (
            <div className="py-12 text-center flex items-center justify-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4" aria-hidden />
              <span className="text-sm">Failed to load services.</span>
            </div>
          )}

          {!isLoading && !isError && rows.length === 0 && (
            <ListEmpty
              icon={Wrench}
              message={query ? `No services matching "${query}"` : 'No services found'}
              // CTA only when the catalog is genuinely empty (on a search miss
              // the next step is editing the query), and only for the roles
              // the backend lets create one.
              {...(query || !canEditCatalog
                ? {}
                : {
                    action: (
                      <Button size="sm" onClick={() => setCreateOpen(true)}>
                        <Plus className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                        New service
                      </Button>
                    ),
                  })}
            />
          )}

          {!isLoading && !isError && rows.length > 0 && (
            <TableCard>
              <Table className="w-full text-sm">
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="text-left px-4 font-medium w-[7.5rem]">Code</TableHead>
                    <TableHead className="text-left px-4 font-medium">Name</TableHead>
                    <TableHead className="text-left px-4 font-medium w-[8.75rem]">Type</TableHead>
                    <TableHead className="text-left px-4 font-medium w-[8.75rem]">
                      Category
                    </TableHead>
                    <TableHead className="text-right px-4 font-medium w-[8.75rem]">
                      Default Price
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((s) => (
                    <TableRow
                      interactive
                      key={s.id}
                      onClick={() => handleRowClick(s.id)}
                      className="border-b border-border hover:bg-accent/50 transition-colors cursor-pointer"
                    >
                      <TableCell className="px-4 text-xs font-mono truncate">{s.code}</TableCell>
                      <TableCell className="px-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{s.name}</p>
                          {!s.isActive && (
                            <Badge variant="overdue" className="text-2xs mt-0.5">
                              Inactive
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="px-4">
                        <Badge variant="outline" className="text-xs">
                          {s.serviceType}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-4 text-xs text-muted-foreground truncate">
                        {s.category ?? '—'}
                      </TableCell>
                      <TableCell className="px-4 text-sm text-right font-medium tabular-nums whitespace-nowrap">
                        {formatMoney(s.basePrice)}
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
      <div className="px-6 xl:px-8 py-2 border-t border-border">
        <p className="text-xs text-muted-foreground">
          {rows.length} service{rows.length !== 1 ? 's' : ''}
          {query ? ' (filtered)' : ''}
        </p>
      </div>

      <ServiceDetail
        serviceId={selectedId}
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open)
          if (!open) setSelectedId(null)
        }}
      />

      {/* Kept mounted unconditionally: every trigger that can open it is
          already role-gated, and unmounting on a late role change would throw
          away whatever the operator had typed. */}
      <CreateServiceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
