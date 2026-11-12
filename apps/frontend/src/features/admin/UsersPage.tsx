import { useState } from 'react'
import { Shield, Search, Plus, Mail } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Sheet, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  PageHeader,
  KpiCell,
  KpiStrip,
  ListEmpty,
  DetailSheet,
  TableCard,
  PageToolbar,
} from '@/components/layout'
import { useUsers, type StaffUser, type UsersRoleFilter } from './usersApi'
import { humanizeRole } from '@/lib/status'
import UserDetail from './components/UserDetail'
import UserCreateForm from './components/UserCreateForm'
import { Skeleton } from '@/components/ui/skeleton'

// ── Helpers ──────────────────────────────────────────────────────────────────

function initials(first: string, last: string) {
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase()
}

function formatLastLogin(dt: string | null) {
  if (!dt) return 'Never'
  const date = new Date(dt)
  if (Number.isNaN(date.getTime())) return 'Never'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dateOnly = new Date(date)
  dateOnly.setHours(0, 0, 0, 0)
  if (dateOnly.getTime() === today.getTime()) {
    return `Today ${date.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true })}`
  }
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}

// ── Role tab config ───────────────────────────────────────────────────────────

const ROLE_TABS: { value: UsersRoleFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'Physician', label: 'Physicians' },
  { value: 'Nurse', label: 'Nurses' },
  { value: 'Admin', label: 'Admins' },
  { value: 'Cashier', label: 'Cashiers' },
  { value: 'Branch', label: 'Branch' },
]

// ── Component ───────────────────────────────────────────────────────────────

export default function UsersPage() {
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<UsersRoleFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const { data, isLoading, isError } = useUsers({ q: query, role: roleFilter })
  const filtered: StaffUser[] = data?.data ?? []
  const activeCount = data?.activeCount ?? 0

  const totalCount = filtered.length
  const inactiveCount = filtered.filter((u) => !u.isActive).length
  const pendingCount = 0 // invites not in current API shape

  return (
    <div className="h-full flex flex-col">
      {/* ── Page head ─────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="Users"
          description="Manage staff accounts and access"
          actions={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" aria-hidden />
              Invite user
            </Button>
          }
        />
      </div>

      {/* ── KPI strip ─────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-b border-border bg-card">
        <KpiStrip>
          <KpiCell label="Total accounts" value={totalCount} subtitle="across all branches" />
          <KpiCell label="Active accounts" value={activeCount} subtitle="enabled for login" />
          <KpiCell
            label="Inactive"
            value={inactiveCount}
            subtitle={inactiveCount > 0 ? 'review required' : 'all accounts active'}
          />
          <KpiCell label="Pending invites" value={pendingCount} subtitle="awaiting acceptance" />
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
            placeholder="Search name, email, role…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Tabs value={roleFilter} onValueChange={(v) => setRoleFilter(v as UsersRoleFilter)}>
          <TabsList className="h-8">
            {ROLE_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="text-xs h-7 px-3">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </PageToolbar>

      {/* ── Table ─────────────────────────────────────────────── */}
      <ScrollArea className="flex-1">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4">
          {isLoading && (
            <div className="space-y-2" role="status" aria-label="Loading users">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          )}

          {isError && !isLoading && (
            <div className="py-12 text-center">
              <p className="text-sm text-destructive">Failed to load users.</p>
            </div>
          )}

          {!isLoading && !isError && filtered.length === 0 && (
            <ListEmpty icon={Shield} message="No users match your search" />
          )}

          {!isLoading && !isError && filtered.length > 0 && (
            <TableCard>
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead className="w-40">Role</TableHead>
                    <TableHead>Branch access</TableHead>
                    <TableHead className="w-28">Last active</TableHead>
                    <TableHead className="w-24">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((user) => (
                    <TableRow
                      interactive
                      key={user.id}
                      className="cursor-pointer"
                      onClick={() => setSelectedId(user.id)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8 shrink-0">
                            <AvatarFallback className="text-xs font-semibold">
                              {initials(user.firstName, user.lastName)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {user.firstName} {user.lastName}
                            </p>
                            <div className="flex items-center gap-1 mt-0.5">
                              <Mail
                                className="h-3 w-3 text-muted-foreground shrink-0"
                                aria-hidden
                              />
                              <span className="text-xs text-muted-foreground font-mono tabular-nums truncate">
                                {user.email}
                              </span>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {humanizeRole(user.role)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {user.branches.length > 0
                          ? user.branches.map((b) => b.name ?? b.id).join(', ')
                          : '—'}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs font-mono tabular-nums text-muted-foreground">
                          {formatLastLogin(user.lastLoginAt)}
                        </span>
                      </TableCell>
                      <TableCell>
                        {user.isActive ? (
                          <Badge variant="ok" className="text-xs">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="overdue" className="text-xs">
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

      {/* ── Footer ────────────────────────────────────────────── */}
      <div className="px-6 py-2 xl:px-8 border-t border-border">
        <p className="text-xs text-muted-foreground">
          {filtered.length} user{filtered.length !== 1 ? 's' : ''}
          {roleFilter !== 'all' ? ' (filtered)' : ''}
        </p>
      </div>

      {/* ── Detail drawer ─────────────────────────────────────── */}
      <Sheet
        open={!!selectedId}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
      >
        <DetailSheet>
          <SheetHeader className="px-6 pt-6 pb-2">
            <SheetTitle>User detail</SheetTitle>
          </SheetHeader>
          {selectedId && <UserDetail userId={selectedId} />}
        </DetailSheet>
      </Sheet>

      {/* ── Create user drawer ────────────────────────────────── */}
      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <DetailSheet>
          <SheetHeader className="px-6 pt-6 pb-2">
            <SheetTitle>Add user</SheetTitle>
          </SheetHeader>
          <UserCreateForm
            onSuccess={() => setCreateOpen(false)}
            onCancel={() => setCreateOpen(false)}
          />
        </DetailSheet>
      </Sheet>
    </div>
  )
}
