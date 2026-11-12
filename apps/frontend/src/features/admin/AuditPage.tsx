import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ScrollText,
  Search,
  LogIn,
  LogOut,
  Pencil,
  Trash2,
  Plus,
  ArrowLeftRight,
  Calendar,
  Receipt,
  AlertCircle,
  X,
} from 'lucide-react'

// Map audit entity_type → route + query for click-through. Entity types in the
// log come in plural form (Wave 9 normalization landed in PR #321). The
// destination list pages support `?selectedId=...` to open the detail rail.
function entityRoute(entityType: string | null, entityId: string | null): string | null {
  if (!entityType || !entityId) return null
  const t = entityType.toLowerCase()
  const ROUTES: Record<string, (id: string) => string> = {
    patients: (id) => `/patients?selectedId=${id}`,
    encounters: (id) => `/encounters?selectedId=${id}`,
    transactions: (id) => `/transactions?selectedId=${id}`,
    clinical_orders: (id) => `/scheduled-orders?selectedId=${id}`,
    lab_orders: (id) => `/lab-orders?selectedId=${id}`,
    users: (id) => `/admin/users?selectedId=${id}`,
    notification_templates: (id) => `/admin/notifications?selectedId=${id}`,
    inventory_lots: (id) => `/inventory?selectedId=${id}`,
    inventory_movements: () => `/inventory`,
    adverse_events: (id) => `/adverse-events?selectedId=${id}`,
    approval_requests: (id) => `/admin/approvals?selectedId=${id}`,
    payments: (id) => `/transactions?selectedId=${id.split('.')[0]}`,
    consents: (id) => `/patients?selectedId=${id.split('.')[0]}`,
    cash_drawer_sessions: () => `/branch/kiosk`,
  }
  const builder = ROUTES[t]
  return builder ? builder(entityId) : null
}
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
  SortableHead,
} from '@/components/layout'
import { useTableSort } from '@/lib/useTableSort'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Sheet, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { useAuditLog, type AuditAction } from './auditApi'
import AuditDetail from './components/AuditDetail'
import { UserLabel } from '@/components/UserLabel'

// ── Helpers ──────────────────────────────────────────────────────────────────

const ACTION_CONFIG: Record<string, { icon: typeof Plus; color: string; label: string }> = {
  CREATE: { icon: Plus, color: 'text-triage-ok', label: 'Create' },
  UPDATE: { icon: Pencil, color: 'text-blue-600', label: 'Update' },
  DELETE: { icon: Trash2, color: 'text-destructive', label: 'Delete' },
  LOGIN: { icon: LogIn, color: 'text-triage-ok', label: 'Login' },
  LOGOUT: { icon: LogOut, color: 'text-muted-foreground', label: 'Logout' },
  TRANSACTION_MODIFY: { icon: Receipt, color: 'text-triage-due', label: 'Txn Modify' },
  SCHEDULE_CHANGE: { icon: Calendar, color: 'text-blue-600', label: 'Schedule' },
  CROSS_BRANCH_ACCESS: { icon: ArrowLeftRight, color: 'text-purple-600', label: 'Cross-Branch' },
}

const ACTION_VARIANT: Record<
  string,
  'default' | 'secondary' | 'outline' | 'due' | 'overdue' | 'ok' | 'info'
> = {
  CREATE: 'ok',
  UPDATE: 'info',
  DELETE: 'overdue',
  LOGIN: 'ok',
  LOGOUT: 'outline',
  TRANSACTION_MODIFY: 'due',
  SCHEDULE_CHANGE: 'info',
  CROSS_BRANCH_ACCESS: 'due',
}

function formatTimestamp(dt: string) {
  const date = new Date(dt)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dateOnly = new Date(date)
  dateOnly.setHours(0, 0, 0, 0)
  const time = date.toLocaleTimeString('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })

  if (dateOnly.getTime() === today.getTime()) return `Today ${time}`
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) + ` ${time}`
}

function truncateId(id: string | null | undefined): string | null {
  if (!id) return null
  return id.length > 10 ? id.slice(0, 10) + '…' : id
}

type ActionFilter = 'all' | AuditAction

// ── Component ───────────────────────────────────────────────────────────────

export default function AuditPage() {
  const [query, setQuery] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all')
  const [sessionIdFilter, setSessionIdFilter] = useState('')
  const [debouncedSessionId, setDebouncedSessionId] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const sessionIdInputRef = useRef<HTMLInputElement>(null)

  const { sort, toggleSort } = useTableSort({ defaultCol: 'timestamp', defaultOrder: 'desc' })

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query), 250)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSessionId(sessionIdFilter), 250)
    return () => clearTimeout(t)
  }, [sessionIdFilter])

  const {
    rows: entries,
    totalCount,
    hasMore,
    loadMore,
    isLoading,
    isError,
  } = useAuditLog({
    q: debouncedQ,
    action: actionFilter,
    sessionId: debouncedSessionId || undefined,
    sort: sort?.col,
    order: sort?.order,
  })

  const writeCount = entries.filter((e) =>
    ['CREATE', 'UPDATE', 'DELETE', 'TRANSACTION_MODIFY'].includes(e.action),
  ).length
  const readCount = entries.filter((e) => ['LOGIN', 'LOGOUT'].includes(e.action)).length
  const errorCount = entries.filter((e) =>
    ['DELETE', 'CROSS_BRANCH_ACCESS'].includes(e.action),
  ).length

  function filterBySession(sessionId: string, e: React.MouseEvent) {
    e.stopPropagation()
    setSessionIdFilter(sessionId)
    sessionIdInputRef.current?.focus()
  }

  return (
    <div className="h-full flex flex-col">
      {/* ── Page head ─────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="Audit Log"
          description="Immutable system-wide activity trail"
          actions={undefined}
        />
      </div>

      {/* ── KPI strip ─────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-b border-border bg-card">
        <KpiStrip>
          <KpiCell label="Events" value={entries.length} subtitle="in current view" />
          <KpiCell label="Write ops" value={writeCount} subtitle="create / update / delete" />
          <KpiCell label="Auth events" value={readCount} subtitle="login / logout" />
          <KpiCell
            label="Sensitive"
            value={errorCount}
            subtitle={errorCount > 0 ? 'review recommended' : 'none flagged'}
          />
        </KpiStrip>
      </div>

      {/* ── Filter bar ────────────────────────────────────────── */}
      <PageToolbar layout="stacked">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative min-w-[11.25rem] flex-1 max-w-sm xl:max-w-md">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
              aria-hidden
            />
            <Input
              type="search"
              placeholder="Search actions or users…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
          <div className="relative min-w-[10rem] max-w-xs">
            <Input
              ref={sessionIdInputRef}
              type="text"
              placeholder="Session ID…"
              value={sessionIdFilter}
              onChange={(e) => setSessionIdFilter(e.target.value)}
              className="h-8 text-sm font-mono pr-7"
            />
            {sessionIdFilter && (
              <button
                type="button"
                aria-label="Clear session ID filter"
                onClick={() => setSessionIdFilter('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </div>
        </div>
        <Tabs value={actionFilter} onValueChange={(v) => setActionFilter(v as ActionFilter)}>
          <TabsList className="h-8">
            <TabsTrigger value="all" className="text-xs h-7 px-3">
              All
            </TabsTrigger>
            {(['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'TRANSACTION_MODIFY'] as AuditAction[]).map(
              (f) => (
                <TabsTrigger key={f} value={f} className="text-xs h-7 px-3">
                  {ACTION_CONFIG[f]?.label ?? f}
                </TabsTrigger>
              ),
            )}
          </TabsList>
        </Tabs>
      </PageToolbar>

      {/* ── Table ─────────────────────────────────────────────── */}
      <ScrollArea className="flex-1">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 min-w-[43.75rem]">
          {isLoading && (
            <div className="space-y-0">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="px-6 py-3 border-b border-border">
                  <Skeleton className="h-4 w-48 mb-1.5" />
                  <Skeleton className="h-3 w-32" />
                </div>
              ))}
            </div>
          )}

          {!isLoading && isError && (
            <div className="px-6 py-12 text-center">
              <AlertCircle className="h-8 w-8 text-destructive/60 mx-auto mb-2" aria-hidden />
              <p className="text-sm text-muted-foreground">Failed to load audit log.</p>
            </div>
          )}

          {!isLoading && !isError && entries.length === 0 && (
            <ListEmpty icon={ScrollText} message="No audit entries match your search" />
          )}

          {!isLoading && !isError && entries.length > 0 && (
            <TableCard>
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <SortableHead
                      col="timestamp"
                      sort={sort}
                      onToggle={toggleSort}
                      className="w-[8.75rem]"
                    >
                      Time
                    </SortableHead>
                    <TableHead className="w-[10rem]">Actor</TableHead>
                    <SortableHead
                      col="action"
                      sort={sort}
                      onToggle={toggleSort}
                      className="w-[8.75rem]"
                    >
                      Action
                    </SortableHead>
                    <SortableHead col="entity_type" sort={sort} onToggle={toggleSort}>
                      Entity
                    </SortableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-[6.875rem]">IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => {
                    const cfg = ACTION_CONFIG[entry.action] ?? {
                      icon: Plus,
                      color: 'text-muted-foreground',
                      label: entry.action,
                    }
                    const ActionIcon = cfg.icon
                    const shortSession = truncateId(entry.sessionId)
                    const shortCorrelation = truncateId(entry.correlationId)

                    return (
                      <TableRow
                        interactive
                        key={entry.id}
                        className="cursor-pointer"
                        onClick={() => setSelectedId(entry.id)}
                      >
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs font-mono tabular-nums">
                              {formatTimestamp(entry.timestamp)}
                            </span>
                            {(shortSession || shortCorrelation) && (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {shortSession && (
                                  <span className="inline-flex items-center gap-1">
                                    <span className="text-2xs text-muted-foreground uppercase tracking-wide">
                                      sess
                                    </span>
                                    <button
                                      type="button"
                                      title={`Filter by session: ${entry.sessionId}`}
                                      onClick={(e) => filterBySession(entry.sessionId!, e)}
                                      className="text-2xs font-mono tabular-nums text-muted-foreground hover:text-foreground hover:underline transition-colors"
                                    >
                                      {shortSession}
                                    </button>
                                  </span>
                                )}
                                {shortCorrelation && (
                                  <span className="inline-flex items-center gap-1">
                                    <span className="text-2xs text-muted-foreground uppercase tracking-wide">
                                      corr
                                    </span>
                                    <span className="text-2xs font-mono tabular-nums text-muted-foreground">
                                      {shortCorrelation}
                                    </span>
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 min-w-0">
                            <ActionIcon className={`h-3.5 w-3.5 shrink-0 ${cfg.color}`} />
                            {entry.actor ? (
                              <UserLabel user={entry.actor} variant="default" />
                            ) : (
                              <span className="text-sm font-medium truncate text-muted-foreground">
                                {entry.userName}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={ACTION_VARIANT[entry.action] ?? 'outline'}
                            className="text-xs font-mono"
                          >
                            {entry.action}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs font-mono tabular-nums text-muted-foreground">
                            {entry.entityType}
                          </span>
                          {entry.entityId &&
                            (() => {
                              const href = entityRoute(entry.entityType, entry.entityId)
                              return href ? (
                                <Link
                                  to={href}
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-xs font-mono tabular-nums text-primary hover:underline block truncate max-w-[6.25rem]"
                                >
                                  {entry.entityId}
                                </Link>
                              ) : (
                                <span className="text-xs font-mono tabular-nums text-muted-foreground block truncate max-w-[6.25rem]">
                                  {entry.entityId}
                                </span>
                              )
                            })()}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{entry.description}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs font-mono tabular-nums text-muted-foreground">
                            {entry.ipAddress ?? '—'}
                          </span>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableCard>
          )}
        </div>
      </ScrollArea>

      {/* ── Load older ────────────────────────────────────────── */}
      {hasMore && !isLoading && (
        <div className="px-6 py-3 flex justify-center border-t border-border">
          <Button variant="outline" size="sm" onClick={loadMore}>
            Load older entries
          </Button>
        </div>
      )}

      {/* ── Footer ────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-2 border-t border-border">
        <p className="text-xs text-muted-foreground">
          Showing {entries.length}
          {totalCount !== null ? ` of ${totalCount.toLocaleString('en-PH')}` : ''} entr
          {entries.length !== 1 ? 'ies' : 'y'}
          {actionFilter !== 'all' || debouncedSessionId ? ' (filtered)' : ''}
        </p>
      </div>

      {/* ── Detail drawer ─────────────────────────────────────── */}
      <Sheet open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DetailSheet>
          <SheetHeader className="px-6 py-4 border-b border-border">
            <SheetTitle>Audit entry</SheetTitle>
            <SheetDescription>Full record from audit_logs</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-hidden">
            {selectedId && <AuditDetail auditId={selectedId} />}
          </div>
        </DetailSheet>
      </Sheet>
    </div>
  )
}
