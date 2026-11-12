import { useState } from 'react'
import { Clock, Search, Calendar, LogIn, LogOut, Timer, AlertCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  PageHeader,
  KpiCell,
  KpiStrip,
  ListEmpty,
  DetailSheet,
  TableCard,
  PageToolbar,
} from '@/components/layout'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Sheet, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { useAttendance, type AttendanceLog } from './attendanceApi'
import AttendanceDetail from './components/AttendanceDetail'
import { Skeleton } from '@/components/ui/skeleton'

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(dt: string) {
  return new Date(dt).toLocaleTimeString('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function formatDate(dt: string) {
  const date = new Date(dt)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dateOnly = new Date(date)
  dateOnly.setHours(0, 0, 0, 0)
  if (dateOnly.getTime() === today.getTime()) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (dateOnly.getTime() === yesterday.getTime()) return 'Yesterday'
  return date.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })
}

function groupByDate(logs: AttendanceLog[]): [string, AttendanceLog[]][] {
  const groups = new Map<string, AttendanceLog[]>()
  for (const log of logs) {
    const dateKey = log.clockInAt.slice(0, 10)
    const existing = groups.get(dateKey)
    if (existing) {
      existing.push(log)
    } else {
      groups.set(dateKey, [log])
    }
  }
  return Array.from(groups.entries()).sort(([a], [b]) => b.localeCompare(a))
}

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

type PeriodTab = 'today' | 'week' | 'month'

// ── Component ───────────────────────────────────────────────────────────────

export default function AttendancePage() {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [period, setPeriod] = useState<PeriodTab>('today')

  const { rows: logs, totalCount, hasMore, loadMore, isLoading, isError } = useAttendance(query)

  const grouped = groupByDate(logs)
  const activeShifts = logs.filter((l) => !l.clockOutAt)
  const completedShifts = logs.filter((l) => !!l.clockOutAt)
  // `activeNow` previously came from the list envelope; with cursor pagination
  // it can't be a global aggregate cheaply. We derive it from the loaded rows
  // (same as activeShifts.length) — the two KPI tiles intentionally diverge:
  // "On shift now" = loaded-and-still-open; "Active shifts" = same in current
  // load. When the page paginates older rows, both remain consistent.
  const activeNow = activeShifts.length

  return (
    <div className="h-full flex flex-col">
      {/* ── Page head ─────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="Attendance"
          description="Staff clock-in / clock-out records"
          actions={undefined}
        />
      </div>

      {/* ── KPI strip ─────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-b border-border bg-card">
        <KpiStrip>
          <KpiCell
            label="On shift now"
            value={activeNow}
            subtitle={activeNow > 0 ? 'currently clocked in' : 'none active'}
          />
          <KpiCell label="Active shifts" value={activeShifts.length} subtitle="in progress" />
          <KpiCell label="Completed" value={completedShifts.length} subtitle="clocked out" />
          <KpiCell label="Total records" value={logs.length} subtitle="this period" />
        </KpiStrip>
      </div>

      {/* ── Filter bar ────────────────────────────────────────── */}
      <PageToolbar>
        <div className="relative flex-1 max-w-sm xl:max-w-md">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Search staff…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Tabs value={period} onValueChange={(v) => setPeriod(v as PeriodTab)}>
          <TabsList className="h-8">
            <TabsTrigger value="today" className="text-xs h-7 px-3">
              Today
            </TabsTrigger>
            <TabsTrigger value="week" className="text-xs h-7 px-3">
              Week
            </TabsTrigger>
            <TabsTrigger value="month" className="text-xs h-7 px-3">
              Month
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </PageToolbar>

      {/* ── Table ─────────────────────────────────────────────── */}
      <ScrollArea className="flex-1">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4">
          {isLoading && (
            <div className="space-y-2" role="status" aria-label="Loading attendance">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          )}

          {isError && !isLoading && (
            <div className="py-12 text-center flex flex-col items-center gap-2 text-destructive">
              <AlertCircle className="h-8 w-8" aria-hidden />
              <p className="text-sm">Failed to load attendance records</p>
            </div>
          )}

          {!isLoading && !isError && grouped.length === 0 && (
            <ListEmpty icon={Clock} message="No attendance records found" />
          )}

          {!isLoading && !isError && grouped.length > 0 && (
            <div className="space-y-4">
              {grouped.map(([dateKey, dayLogs]) => (
                <div key={dateKey}>
                  {/* Date group header */}
                  <div className="flex items-center gap-2 py-2">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                    <span className="text-sm font-semibold">
                      {formatDate(dayLogs[0]!.clockInAt)}
                    </span>
                    <Badge variant="outline" className="text-xs font-mono tabular-nums">
                      {dayLogs.length}
                    </Badge>
                  </div>

                  <TableCard>
                    <Table>
                      <TableHeader className="sticky top-0 bg-card z-10">
                        <TableRow>
                          <TableHead>Staff</TableHead>
                          <TableHead className="w-28">Role</TableHead>
                          <TableHead className="w-28">Clock in</TableHead>
                          <TableHead className="w-28">Clock out</TableHead>
                          <TableHead className="w-20">Hours</TableHead>
                          <TableHead className="w-24">State</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dayLogs.map((log) => {
                          const isActive = !log.clockOutAt
                          return (
                            <TableRow
                              interactive
                              key={log.id}
                              className="cursor-pointer"
                              onClick={() => setSelectedId(log.id)}
                            >
                              <TableCell>
                                <div className="flex items-center gap-3">
                                  <Avatar className="h-8 w-8 shrink-0">
                                    <AvatarFallback className="text-xs">
                                      {initials(log.staffName)}
                                    </AvatarFallback>
                                  </Avatar>
                                  <span className="text-sm font-medium">{log.staffName}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <span className="text-xs text-muted-foreground">{log.role}</span>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1.5 text-xs">
                                  <LogIn className="h-3 w-3 text-triage-ok shrink-0" aria-hidden />
                                  <span className="font-mono tabular-nums">
                                    {formatTime(log.clockInAt)}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell>
                                {log.clockOutAt ? (
                                  <div className="flex items-center gap-1.5 text-xs">
                                    <LogOut
                                      className="h-3 w-3 text-muted-foreground shrink-0"
                                      aria-hidden
                                    />
                                    <span className="font-mono tabular-nums text-muted-foreground">
                                      {formatTime(log.clockOutAt)}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-xs text-muted-foreground font-mono">—</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1.5 text-xs">
                                  <Timer
                                    className="h-3 w-3 text-muted-foreground shrink-0"
                                    aria-hidden
                                  />
                                  <span
                                    className={`font-mono tabular-nums ${isActive ? 'text-muted-foreground' : 'font-medium'}`}
                                  >
                                    {log.totalHours ? `${log.totalHours}h` : '—'}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell>
                                {isActive ? (
                                  <Badge variant="ok" className="text-xs gap-1">
                                    <div className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                                    Active
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-xs">
                                    Done
                                  </Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </TableCard>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* ── Load older ────────────────────────────────────────── */}
      {hasMore && !isLoading && (
        <div className="px-6 py-3 flex justify-center border-t border-border">
          <Button variant="outline" size="sm" onClick={loadMore}>
            Load older records
          </Button>
        </div>
      )}

      {/* ── Footer ────────────────────────────────────────────── */}
      <div className="px-6 py-2 xl:px-8 border-t border-border">
        <p className="text-xs text-muted-foreground">
          Showing {logs.length}
          {totalCount !== null ? ` of ${totalCount.toLocaleString('en-PH')}` : ''} record
          {logs.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* ── Detail drawer ─────────────────────────────────────── */}
      <Sheet open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DetailSheet>
          <SheetHeader className="px-6 pt-6 pb-0">
            <SheetTitle>Time log</SheetTitle>
            <SheetDescription>Shift record detail</SheetDescription>
          </SheetHeader>
          {selectedId && <AttendanceDetail logId={selectedId} />}
        </DetailSheet>
      </Sheet>
    </div>
  )
}
