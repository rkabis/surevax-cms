import { useRef, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, UserPlus } from 'lucide-react'
import { type Patient } from '../api'
import { useRecentList } from '@/lib/useRecentList'
import { DoseStrip } from '@/components/clinical'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SortableHead, TableCard } from '@/components/layout'
import { useTableSort } from '@/lib/useTableSort'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { avatarColor } from '@/lib/avatarColor'
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { differenceInYears } from 'date-fns'
import { formatDate } from '@/lib/format'

type FilterTab = 'all' | 'active' | 'overdue'

function initials(firstName: string, lastName: string): string {
  return `${lastName[0] ?? ''}${firstName[0] ?? ''}`.toUpperCase()
}

function PatientRow({
  patient,
  onSelect,
  index,
}: {
  patient: Patient
  onSelect: () => void
  index: number
}) {
  const age = patient.dateOfBirth
    ? differenceInYears(new Date(), new Date(patient.dateOfBirth))
    : null
  const lastVisit = formatDate(patient.createdAt)

  return (
    <TableRow interactive data-index={index} onClick={onSelect} className="cursor-pointer">
      <TableCell>
        <div className="flex items-center gap-2">
          <Avatar className="h-7 w-7">
            <AvatarFallback
              className="text-2xs text-white"
              style={{ backgroundColor: avatarColor(patient.id) }}
            >
              {initials(patient.firstName, patient.lastName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">
              {patient.lastName}, {patient.firstName}
            </p>
            <p className="text-xs text-muted-foreground font-mono truncate">
              {age !== null ? `${age}${patient.sex?.[0] ?? ''}` : '—'}
            </p>
          </div>
        </div>
      </TableCell>
      <TableCell>
        {patient.pepTotal != null && patient.pepTotal > 0 ? (
          // Course progress as a compact dose strip (Pattern 13). The list
          // endpoint carries per-dose states (done/due/overdue/upcoming) for
          // the active standing-order course; 'upcoming' maps to DoseStrip's
          // '' (pending) state. Falls back to count-derived states if the
          // array is absent. Strips longer than 8 doses fall back to the
          // count badge.
          patient.pepTotal <= 8 ? (
            <div className="flex items-center gap-2">
              <DoseStrip
                size="sm"
                doses={(
                  patient.doseStates ??
                  Array.from({ length: patient.pepTotal }, (_, i) =>
                    i < (patient.pepCompleted ?? 0) ? ('done' as const) : ('upcoming' as const),
                  )
                ).map((state, i) => ({
                  label: `Dose ${i + 1}`,
                  state: state === 'upcoming' ? ('' as const) : state,
                }))}
              />
              <span className="text-xs font-mono tabular-nums text-muted-foreground">
                {patient.pepCompleted ?? 0}/{patient.pepTotal}
              </span>
            </div>
          ) : (
            <Badge
              variant={patient.pepCompleted === patient.pepTotal ? 'ok' : 'due'}
              className="text-xs"
            >
              {patient.pepCompleted ?? 0}/{patient.pepTotal}
            </Badge>
          )
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">{lastVisit}</TableCell>
      <TableCell>
        <Badge variant={patient.isActive ? 'ok' : 'overdue'} className="text-xs">
          {patient.isActive ? 'Active' : 'Inactive'}
        </Badge>
      </TableCell>
    </TableRow>
  )
}

export default function PatientList() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [filterTab, setFilterTab] = useState<FilterTab>('all')
  const searchRef = useRef<HTMLInputElement>(null)
  const { sort, toggleSort } = useTableSort({ defaultCol: 'last_name', defaultOrder: 'asc' })

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query), 250)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [])

  // Search-first records browse (Pattern 24): default = most recent 50,
  // search filters via backend, "Load older" button advances cursor manually.
  // Replaces the prior useInfiniteQuery + IntersectionObserver auto-scroll.
  const {
    rows: allPatients,
    totalCount,
    hasMore,
    isLoading,
    loadMore,
  } = useRecentList<Patient>({
    endpoint: '/api/patients',
    query: {
      q: debouncedQ,
      sort: sort?.col,
      order: sort?.order,
    },
    queryKey: ['patients', debouncedQ, sort?.col ?? '', sort?.order ?? ''],
    pageSize: 50,
  })

  const filtered =
    filterTab === 'all'
      ? allPatients
      : filterTab === 'active'
        ? allPatients.filter((p) => p.isActive)
        : allPatients.filter((p) => !p.isActive)

  const totalActive = allPatients.filter((p) => p.isActive).length

  const tableRef = useRef<HTMLTableElement>(null)

  function handleTableKeyDown(e: React.KeyboardEvent) {
    const items = tableRef.current?.querySelectorAll<HTMLTableRowElement>('tbody tr[data-index]')
    if (!items?.length) return
    const activeIdx = Array.from(items).findIndex(
      (el) => el === document.activeElement?.closest('tr'),
    )
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = activeIdx < items.length - 1 ? activeIdx + 1 : 0
      items[next]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = activeIdx > 0 ? activeIdx - 1 : items.length - 1
      items[prev]?.focus()
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      items[activeIdx]?.click()
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Page header */}
      <div className="px-4 xl:px-6 pt-4 pb-2">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold">Patients</h1>
            <p className="text-xs text-muted-foreground">
              {totalCount !== null
                ? totalCount.toLocaleString('en-PH')
                : allPatients.length.toLocaleString('en-PH')}{' '}
              total
              {totalActive > 0 && <> · {totalActive} active loaded</>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => navigate('/patients/new')}
              className="h-7 text-xs gap-1 px-2"
            >
              <UserPlus className="h-3.5 w-3.5" aria-hidden />
              Register
            </Button>
          </div>
        </div>
      </div>

      {/* Search + filter bar */}
      <div className="px-4 xl:px-6 pb-2 space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
              aria-hidden
            />
            <Input
              ref={searchRef}
              type="search"
              placeholder="Search name, MRN, phone…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8 h-8 text-sm"
              aria-label="Search patients"
            />
          </div>
        </div>
        <div className="flex items-center gap-0 border-b border-border">
          {[
            { id: 'all' as const, label: 'All' },
            { id: 'active' as const, label: 'Active' },
            { id: 'overdue' as const, label: 'Inactive' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setFilterTab(t.id)}
              className={cn(
                'px-3 py-1.5 text-sm font-medium transition-colors border-b-2 -mb-px',
                filterTab === t.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <ScrollArea className="flex-1">
        <TableCard className="mx-4 xl:mx-6">
          <Table
            density="compact"
            ref={tableRef}
            onKeyDown={handleTableKeyDown}
            aria-label="Patient list"
          >
            <TableHeader className="sticky top-0 bg-card z-10">
              <TableRow>
                <SortableHead col="last_name" sort={sort} onToggle={toggleSort} className="w-[40%]">
                  Patient
                </SortableHead>
                <TableHead className="w-[6.25rem]">Schedule</TableHead>
                <SortableHead
                  col="created_at"
                  sort={sort}
                  onToggle={toggleSort}
                  className="w-[5.625rem]"
                >
                  Last visit
                </SortableHead>
                <TableHead className="w-[6.875rem]">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading &&
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-7 w-7 rounded-full" />
                        <div className="space-y-1">
                          <Skeleton className="h-3.5 w-28" />
                          <Skeleton className="h-3 w-20" />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-3 w-12" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-3 w-10" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-14 rounded-full" />
                    </TableCell>
                  </TableRow>
                ))}

              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="h-32 text-center">
                    <p className="text-sm text-muted-foreground">
                      {debouncedQ ? `No patients matching "${debouncedQ}"` : 'No patients yet'}
                    </p>
                    {!debouncedQ && (
                      <Button size="sm" className="mt-3" onClick={() => navigate('/patients/new')}>
                        <UserPlus className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                        Register patient
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )}

              {filtered.map((p, i) => (
                <PatientRow
                  key={p.id}
                  patient={p}
                  onSelect={() => navigate(`/patients/${p.id}`)}
                  index={i}
                />
              ))}
            </TableBody>
          </Table>
        </TableCard>
        {/* Load-older — manual cursor advance (replaces auto-scroll). */}
        {hasMore && !isLoading && (
          <div className="px-4 py-3 flex justify-center border-t border-border">
            <Button variant="outline" size="sm" onClick={loadMore}>
              Load older patients
            </Button>
          </div>
        )}
      </ScrollArea>

      {/* Footer count */}
      {!isLoading && allPatients.length > 0 && (
        <div className="px-4 py-2 border-t border-border">
          <p className="text-xs text-muted-foreground">
            Showing {filtered.length} of{' '}
            {totalCount !== null ? totalCount.toLocaleString('en-PH') : allPatients.length}
            {totalCount !== null && allPatients.length < totalCount
              ? ' — search to find older'
              : ''}
          </p>
        </div>
      )}
    </div>
  )
}
