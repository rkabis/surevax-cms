import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, Plus, Stethoscope, UserPlus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  PageHeader,
  KpiCell,
  KpiStrip,
  ListEmpty,
  TableCard,
  PageToolbar,
  SortableHead,
  ComingSoonButton,
} from '@/components/layout'
import { useTableSort } from '@/lib/useTableSort'
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useEncounters, type EncounterListItem } from '../api'

const STATUS_VARIANT: Record<string, 'default' | 'outline' | 'due' | 'overdue'> = {
  Open: 'outline',
  InProgress: 'due',
  Completed: 'default',
  Cancelled: 'overdue',
}

const STATUS_LABEL: Record<string, string> = {
  Open: 'In room',
  InProgress: 'In progress',
  Completed: 'Signed',
  Cancelled: 'Cancelled',
}

function formatTime(value: string): string {
  const d = new Date(value)
  return d.toLocaleString('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function patientName(e: EncounterListItem): string {
  const first = e.patientFirstName ?? ''
  const last = e.patientLastName ?? ''
  const name = `${last}${last && first ? ', ' : ''}${first}`.trim()
  return name || '—'
}

function patientInitials(e: EncounterListItem): string {
  const first = (e.patientFirstName ?? '')[0] ?? ''
  const last = (e.patientLastName ?? '')[0] ?? ''
  return `${last}${first}`.toUpperCase() || '?'
}

function clinicianName(e: EncounterListItem): string {
  const first = e.providerFirstName ?? ''
  const last = e.providerLastName ?? ''
  return [first, last].filter(Boolean).join(' ') || '—'
}

function isToday(iso: string): boolean {
  const d = new Date(iso)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

type FilterKey = 'all' | 'active' | 'completed' | 'cancelled'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
]

type Props = {
  selectedId: string | null
  onSelect: (id: string) => void
}

export default function EncounterList({ selectedId, onSelect }: Props) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // Read URL state once on mount; local state drives the input for snappy UX.
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '')
  const [debouncedQ, setDebouncedQ] = useState(() => searchParams.get('q') ?? '')
  const [filter, setFilter] = useState<FilterKey>(
    () => (searchParams.get('filter') as FilterKey | null) ?? 'all',
  )
  const searchRef = useRef<HTMLInputElement>(null)

  // Debounce URL write for search (250 ms) so each keystroke doesn't push history.
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

  // Sync filter to URL immediately on change.
  function handleFilterChange(key: FilterKey) {
    setFilter(key)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (key === 'all') {
          next.delete('filter')
        } else {
          next.set('filter', key)
        }
        return next
      },
      { replace: true },
    )
  }

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const tag = document.activeElement?.tagName
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [])

  const { sort, toggleSort } = useTableSort({ defaultCol: 'created_at', defaultOrder: 'desc' })
  const { data, isLoading, error } = useEncounters({ sort: sort?.col, order: sort?.order })
  const allEncounters = useMemo(() => data?.data ?? [], [data?.data])

  const filtered = useMemo(() => {
    let list = allEncounters

    if (filter === 'active')
      list = list.filter((e) => e.status === 'Open' || e.status === 'InProgress')
    else if (filter === 'completed') list = list.filter((e) => e.status === 'Completed')
    else if (filter === 'cancelled') list = list.filter((e) => e.status === 'Cancelled')

    const q = debouncedQ.trim().toLowerCase()
    if (q) {
      list = list.filter((e) => {
        const name = patientName(e).toLowerCase()
        return (
          name.includes(q) ||
          e.specialty.toLowerCase().includes(q) ||
          e.status.toLowerCase().includes(q) ||
          (e.chiefComplaint?.toLowerCase().includes(q) ?? false)
        )
      })
    }
    return list
  }, [allEncounters, filter, debouncedQ])

  const todayCount = useMemo(
    () => allEncounters.filter((e) => isToday(e.startedAt)).length,
    [allEncounters],
  )

  const activeCount = useMemo(
    () => allEncounters.filter((e) => e.status === 'Open' || e.status === 'InProgress').length,
    [allEncounters],
  )

  const completedCount = useMemo(
    () => allEncounters.filter((e) => e.status === 'Completed').length,
    [allEncounters],
  )

  const cancelledCount = useMemo(
    () => allEncounters.filter((e) => e.status === 'Cancelled').length,
    [allEncounters],
  )

  const avgWait = useMemo(() => {
    const done = allEncounters.filter(
      (e) => e.status === 'Completed' && isToday(e.startedAt) && e.completedAt,
    )
    if (done.length === 0) return null
    const mins = done.map((e) => {
      const start = new Date(e.startedAt).getTime()
      const end = new Date(e.completedAt!).getTime()
      return (end - start) / 60000
    })
    return Math.round(mins.reduce((a, b) => a + b, 0) / mins.length)
  }, [allEncounters])

  const counts = {
    all: allEncounters.length,
    active: activeCount,
    completed: completedCount,
    cancelled: cancelledCount,
  }

  return (
    <div className="flex flex-col h-full">
      {/* Page Header */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="Encounters"
          description={`${todayCount} today · ${activeCount} active${cancelledCount > 0 ? ` · ${cancelledCount} cancelled` : ''}`}
          actions={
            // "New Encounter" is not wired, and it was this page's only — and
            // therefore primary — action, so the first thing a user reached for
            // here was a dead end. It stays available but demoted; the real way
            // to open an encounter is the arrivals wizard, which is now the
            // primary CTA (Pattern 11: secondary left, primary rightmost).
            <>
              <ComingSoonButton size="sm" icon={<Plus className="h-3.5 w-3.5" aria-hidden />}>
                New Encounter
              </ComingSoonButton>
              <Button size="sm" onClick={() => navigate('/arrivals')}>
                <UserPlus className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                New arrival
              </Button>
            </>
          }
        />
      </div>

      {/* KPI Strip */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4">
        <KpiStrip>
          <KpiCell
            label="Today"
            value={todayCount}
            subtitle={todayCount >= (completedCount + activeCount) / 2 ? 'Busy day' : 'Quiet day'}
          />
          <KpiCell label="Completed" value={completedCount} subtitle="Today" />
          <KpiCell
            label="Pending"
            value={activeCount}
            subtitle={activeCount > 0 ? `${activeCount} in room` : 'None waiting'}
          />
          <KpiCell
            label="Avg wait"
            value={avgWait != null ? `${avgWait}m` : '—'}
            subtitle={cancelledCount > 0 ? `${cancelledCount} cancelled` : 'No cancellations'}
          />
        </KpiStrip>
      </div>

      {/* Search + Tabs */}
      <PageToolbar>
        <div className="relative flex-1 max-w-sm xl:max-w-md">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
            aria-hidden
          />
          <Input
            ref={searchRef}
            type="search"
            placeholder="Search name, specialty, status… (/)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => handleFilterChange(f.key)}
              className={cn(
                'px-3 py-1 text-sm rounded-sm transition-colors',
                filter === f.key
                  ? 'bg-background text-foreground shadow-sm font-medium'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f.label}
              <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                {counts[f.key]}
              </span>
            </button>
          ))}
        </div>
      </PageToolbar>

      {/* Table */}
      <div className="flex-1 px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 overflow-auto">
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        )}

        {error && (
          <div className="py-16 text-center">
            <p className="text-sm text-destructive">Failed to load encounters.</p>
          </div>
        )}

        {!isLoading && !error && filtered.length === 0 && (
          <ListEmpty
            icon={Stethoscope}
            message={debouncedQ ? `No encounters matching "${debouncedQ}"` : 'No encounters found.'}
          />
        )}

        {!isLoading && !error && filtered.length > 0 && (
          <TableCard>
            <Table density="compact">
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <SortableHead
                    col="created_at"
                    sort={sort}
                    onToggle={toggleSort}
                    className="w-[6.25rem]"
                  >
                    Time
                  </SortableHead>
                  <TableHead>Patient</TableHead>
                  <SortableHead col="specialty" sort={sort} onToggle={toggleSort}>
                    Type
                  </SortableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[5.625rem]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((enc) => (
                  <TableRow
                    interactive
                    key={enc.id}
                    data-state={enc.id === selectedId ? 'selected' : undefined}
                    className="cursor-pointer"
                    onClick={() => onSelect(enc.id)}
                  >
                    <TableCell>
                      <span className="font-mono tabular-nums text-sm">
                        {formatTime(enc.startedAt)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs bg-primary/10 text-primary">
                            {patientInitials(enc)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{patientName(enc)}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <Badge variant="outline" className="text-2xs px-1.5 py-0">
                          {enc.specialty}
                        </Badge>
                        <p className="text-xs text-muted-foreground mt-1">{clinicianName(enc)}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[enc.status] ?? 'outline'} className="text-2xs">
                        {STATUS_LABEL[enc.status] ?? enc.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelect(enc.id)
                        }}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        )}
      </div>

      {/* Footer */}
      {!isLoading && filtered.length > 0 && (
        <div className="px-6 xl:px-8 py-2 border-t border-border">
          <p className="text-xs text-muted-foreground">
            {filtered.length} of {allEncounters.length} encounter
            {allEncounters.length !== 1 ? 's' : ''}
          </p>
        </div>
      )}
    </div>
  )
}
