import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { useAdminBranchesList } from './branchesApi'

type StatusFilter = 'all' | 'active' | 'inactive'

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

export default function BranchesPage() {
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')

  // Fetch all branches (active + inactive) so client-side tabs work without extra round trips
  const { data, isLoading, isError } = useAdminBranchesList({ includeInactive: true })
  const rows = data ?? []

  const activeCount = rows.filter((b) => b.isActive).length
  const inactiveCount = rows.filter((b) => !b.isActive).length

  const filtered = rows.filter((b) => {
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && b.isActive) ||
      (statusFilter === 'inactive' && !b.isActive)

    const q = search.toLowerCase()
    const matchesSearch =
      !q ||
      b.code.toLowerCase().includes(q) ||
      b.name.toLowerCase().includes(q) ||
      (b.city ?? '').toLowerCase().includes(q)

    return matchesStatus && matchesSearch
  })

  return (
    <div className="h-full flex flex-col">
      {/* Page head */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="Branches"
          description={
            isLoading
              ? 'Loading…'
              : `${rows.length} branch${rows.length !== 1 ? 'es' : ''} · ${activeCount} active`
          }
        />
      </div>

      {/* KPI strip */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-b border-border bg-card">
        <KpiStrip>
          <KpiCell label="Total branches" value={isLoading ? '—' : rows.length} />
          <KpiCell
            label="Active"
            value={isLoading ? '—' : activeCount}
            subtitle="accepting patients"
          />
          <KpiCell
            label="Inactive"
            value={isLoading ? '—' : inactiveCount}
            subtitle="disabled or archived"
          />
          <KpiCell label="Tenant" value="SVX" subtitle="SureVax clinic network" />
        </KpiStrip>
      </div>

      {/* Filter tabs + search */}
      <PageToolbar>
        <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <TabsList className="h-8">
            {STATUS_FILTERS.map((f) => (
              <TabsTrigger key={f.value} value={f.value} className="text-xs px-3 h-7">
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input
          placeholder="Search by code or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-sm max-w-xs xl:max-w-md ml-auto"
        />
      </PageToolbar>

      {/* List */}
      <ScrollArea className="flex-1">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4">
          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          )}

          {isError && (
            <div className="py-12 text-center">
              <p className="text-sm text-destructive">Failed to load branches.</p>
            </div>
          )}

          {!isLoading && !isError && filtered.length === 0 && (
            <ListEmpty icon={Building2} message="No branches found." />
          )}

          {!isLoading && !isError && filtered.length > 0 && (
            <TableCard>
              <Table className="w-full text-sm">
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="text-left px-6 font-medium">Code</TableHead>
                    <TableHead className="text-left px-4 font-medium">Name</TableHead>
                    <TableHead className="text-left px-4 font-medium">City</TableHead>
                    <TableHead className="text-left px-4 font-medium">Contact</TableHead>
                    <TableHead className="text-left px-4 font-medium">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((b) => (
                    <TableRow
                      interactive
                      key={b.id}
                      onClick={() => navigate(`/admin/branches/${encodeURIComponent(b.id)}`)}
                      className="border-b border-border hover:bg-accent/50 transition-colors cursor-pointer"
                    >
                      <TableCell className="px-6 font-mono text-xs font-medium">{b.code}</TableCell>
                      <TableCell className="px-4 font-medium">{b.name}</TableCell>
                      <TableCell className="px-4 text-muted-foreground">{b.city ?? '—'}</TableCell>
                      <TableCell className="px-4 text-muted-foreground text-xs font-mono tabular-nums">
                        {b.contactNumber ?? '—'}
                      </TableCell>
                      <TableCell className="px-4">
                        {b.isActive ? (
                          <Badge variant="default" className="text-xs">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            Inactive
                          </Badge>
                        )}
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
          {filtered.length} branch{filtered.length !== 1 ? 'es' : ''}
          {statusFilter !== 'all' ? ` · ${statusFilter}` : ''}
        </p>
      </div>
    </div>
  )
}
