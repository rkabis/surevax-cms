import { useState } from 'react'
import { Building2, Download, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  PageHeader,
  KpiCell,
  KpiStrip,
  ListEmpty,
  DetailSheet,
  TableCard,
  PageToolbar,
  ComingSoonButton,
} from '@/components/layout'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePayerProfiles, type PayerType } from './payerProfilesApi'
import PayerProfileDetail from './components/PayerProfileDetail'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'

type TypeFilter = PayerType | 'all'

const FILTERS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'HMO', label: 'HMO' },
  { value: 'Government', label: 'Govt' },
  { value: 'Corporate', label: 'Corporate' },
  { value: 'Promo', label: 'Promo' },
]

export default function PayerProfilesPage() {
  const [filter, setFilter] = useState<TypeFilter>('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data, isLoading, isError } = usePayerProfiles(filter)
  const rows = data?.data ?? []

  const filtered = search
    ? rows.filter(
        (p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.payerType.toLowerCase().includes(search.toLowerCase()),
      )
    : rows

  const activeCount = rows.filter((p) => p.isActive).length
  const hmoCount = rows.filter((p) => p.payerType === 'HMO').length
  const corpCount = rows.filter((p) => p.payerType === 'Corporate').length
  const govCount = rows.filter((p) => p.payerType === 'Government').length

  return (
    <div className="h-full flex flex-col">
      {/* Page head */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="Payer Profiles"
          description={
            isLoading
              ? 'Loading…'
              : `${rows.length} payer${rows.length !== 1 ? 's' : ''} · ${activeCount} active`
          }
          actions={
            <>
              <ComingSoonButton size="sm" icon={<Download className="h-3.5 w-3.5" aria-hidden />}>
                Claim ledger
              </ComingSoonButton>
              <ComingSoonButton size="sm" icon={<Plus className="h-3.5 w-3.5" aria-hidden />}>
                Add payer
              </ComingSoonButton>
            </>
          }
        />
      </div>

      {/* KPI strip */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-b border-border bg-card">
        <KpiStrip>
          <KpiCell
            label="Active payers"
            value={isLoading ? '—' : activeCount}
            subtitle={`of ${rows.length} total`}
          />
          <KpiCell
            label="HMO"
            value={isLoading ? '—' : hmoCount}
            subtitle="health maintenance orgs"
          />
          <KpiCell
            label="Corporate"
            value={isLoading ? '—' : corpCount}
            subtitle="direct billing accounts"
          />
          <KpiCell
            label="Government"
            value={isLoading ? '—' : govCount}
            subtitle="PhilHealth · SC/PWD"
          />
        </KpiStrip>
      </div>

      {/* Filter tabs + search */}
      <PageToolbar>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as TypeFilter)}>
          <TabsList className="h-8">
            {FILTERS.map((f) => (
              <TabsTrigger key={f.value} value={f.value} className="text-xs px-3 h-7">
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input
          placeholder="Search payer…"
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
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          )}

          {isError && (
            <div className="py-12 text-center">
              <p className="text-sm text-destructive">Failed to load payer profiles.</p>
            </div>
          )}

          {!isLoading && !isError && filtered.length === 0 && (
            <ListEmpty icon={Building2} message="No payer profiles found." />
          )}

          {!isLoading && !isError && filtered.length > 0 && (
            <TableCard>
              <Table className="w-full text-sm">
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="text-left px-6 font-medium">Name</TableHead>
                    <TableHead className="text-left px-4 font-medium">Type</TableHead>
                    <TableHead className="text-left px-4 font-medium">Contact</TableHead>
                    <TableHead className="text-left px-4 font-medium">Phone</TableHead>
                    <TableHead className="text-right px-4 font-medium">Payment terms</TableHead>
                    <TableHead className="text-left px-4 font-medium">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => (
                    <TableRow
                      interactive
                      key={p.id}
                      onClick={() => setSelectedId(p.id)}
                      className="border-b border-border hover:bg-accent/50 transition-colors cursor-pointer"
                    >
                      <TableCell className="px-6 font-medium">{p.name}</TableCell>
                      <TableCell className="px-4">
                        <Badge variant="outline" className="text-xs">
                          {p.payerType}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-4 text-muted-foreground">
                        {p.contactName ?? '—'}
                      </TableCell>
                      <TableCell className="px-4 text-muted-foreground font-mono tabular-nums text-xs">
                        {p.contactNumber ?? '—'}
                      </TableCell>
                      <TableCell className="px-4 text-right font-mono tabular-nums text-xs text-muted-foreground">
                        {p.paymentTermsDays != null ? `${p.paymentTermsDays}d` : '—'}
                      </TableCell>
                      <TableCell className="px-4">
                        {p.isActive ? (
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
          {filtered.length} payer profile{filtered.length !== 1 ? 's' : ''}
          {filter !== 'all' ? ` (${filter})` : ''}
        </p>
      </div>

      {/* Detail drawer */}
      <Sheet open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DetailSheet>
          <SheetHeader className="px-6 py-4 border-b border-border">
            <SheetTitle>Payer Profile</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-hidden">
            {selectedId && <PayerProfileDetail payerProfileId={selectedId} />}
          </div>
        </DetailSheet>
      </Sheet>
    </div>
  )
}
