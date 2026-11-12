import { useState, useMemo } from 'react'
import { Workflow, AlertCircle, Lock, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageHeader, KpiStrip, KpiCell, ListEmpty, ComingSoonButton } from '@/components/layout'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from '@/components/ui/toast'
import {
  useStandingOrderTemplates,
  useCreateNewTemplateVersion,
  type StandingOrderTemplate,
} from './api'
import StandingOrderDetail from './components/StandingOrderDetail'
import StandingOrderTemplateEditSheet from './components/StandingOrderTemplateEditSheet'
import { apiErrorMessage } from '@/lib/apiErrors'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'

// ── filter tabs ───────────────────────────────────────────────────────────────

const ALL_FILTER = 'all'
const ACTIVE_FILTER = 'active'
const INACTIVE_FILTER = 'inactive'
const LOCKED_FILTER = 'locked'

type Filter =
  | typeof ALL_FILTER
  | typeof ACTIVE_FILTER
  | typeof INACTIVE_FILTER
  | typeof LOCKED_FILTER

const FILTER_LABELS: Record<Filter, string> = {
  all: 'All',
  active: 'Active',
  inactive: 'Inactive',
  locked: 'Locked',
}

export default function StandingOrdersPage() {
  const { data, isLoading, isError } = useStandingOrderTemplates()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [lockedDialogId, setLockedDialogId] = useState<string | null>(null)
  const [lockedDialogVersion, setLockedDialogVersion] = useState<number>(1)
  const [filter, setFilter] = useState<Filter>(ALL_FILTER)
  const [editTemplate, setEditTemplate] = useState<StandingOrderTemplate | null>(null)

  const createNewVersion = useCreateNewTemplateVersion()

  // ── derived KPIs ──────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    if (!data) return null
    const active = data.filter((t) => t.isActive).length
    const inactive = data.filter((t) => !t.isActive).length
    const locked = data.filter((t) => t.isLocked).length
    const requiresAuth = data.filter((t) => t.requiresPhysicianAuth).length
    return { total: data.length, active, inactive, locked, requiresAuth }
  }, [data])

  // ── filtered rows ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!data) return []
    if (filter === ACTIVE_FILTER) return data.filter((t) => t.isActive)
    if (filter === INACTIVE_FILTER) return data.filter((t) => !t.isActive)
    if (filter === LOCKED_FILTER) return data.filter((t) => t.isLocked)
    return data
  }, [data, filter])

  function openRow(id: string) {
    setSelectedId(id)
    setDrawerOpen(true)
  }

  function onDrawerOpenChange(open: boolean) {
    setDrawerOpen(open)
    if (!open) setSelectedId(null)
  }

  function handleEditClick(e: React.MouseEvent, template: StandingOrderTemplate) {
    e.stopPropagation()
    if (template.isLocked) {
      setLockedDialogId(template.id)
      setLockedDialogVersion(template.version)
    } else {
      // Opens the real edit form (name, description, MD-auth, active),
      // distinct from the row click, which opens the read-only detail view.
      setEditTemplate(template)
    }
  }

  function handleNewVersionConfirm() {
    if (!lockedDialogId) return
    createNewVersion.mutate(lockedDialogId, {
      onSuccess: (newTemplate) => {
        setLockedDialogId(null)
        toast.success(`Version ${newTemplate.version} created`, {
          description: newTemplate.name,
        })
        openRow(newTemplate.id)
      },
      onError: (err) => {
        setLockedDialogId(null)
        toast.error('Failed to create new version', {
          description: apiErrorMessage(err),
        })
      },
    })
  }

  return (
    <div className="h-full flex flex-col">
      {/* Page head */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title={
            <span className="flex items-center gap-2">
              <Workflow className="h-5 w-5" aria-hidden />
              Standing Orders
            </span>
          }
          description="Clinical protocol templates used to generate patient standing orders."
          actions={
            <ComingSoonButton size="sm" icon={<Plus className="h-3.5 w-3.5" aria-hidden />}>
              New protocol
            </ComingSoonButton>
          }
        />
      </div>

      <ScrollArea className="flex-1">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-5 space-y-5">
          {/* KPI strip */}
          {isLoading ? (
            <Card>
              <CardContent className="grid grid-cols-4 divide-x divide-border p-0">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="p-3 space-y-2">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-6 w-16" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : (
            <KpiStrip>
              <KpiCell
                label="Active templates"
                value={kpis?.active ?? 0}
                subtitle="currently in use"
              />
              <KpiCell
                label="Total templates"
                value={kpis?.total ?? 0}
                subtitle={`${kpis?.inactive ?? 0} inactive`}
              />
              <KpiCell
                label="Requires MD auth"
                value={kpis?.requiresAuth ?? 0}
                subtitle="physician authorization"
              />
              <KpiCell label="Locked" value={kpis?.locked ?? 0} subtitle="versioned read-only" />
            </KpiStrip>
          )}

          {/* Filter tabs + table */}
          <div className="border rounded-lg overflow-hidden">
            {/* Tab bar */}
            <div className="px-3 py-2 border-b border-border bg-muted/30">
              <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
                <TabsList className="h-8">
                  {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
                    <TabsTrigger key={f} value={f} className="text-sm px-3 h-7">
                      {FILTER_LABELS[f]}
                      {f !== ALL_FILTER && data && (
                        <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                          (
                          {f === ACTIVE_FILTER
                            ? kpis?.active
                            : f === INACTIVE_FILTER
                              ? kpis?.inactive
                              : kpis?.locked}
                          )
                        </span>
                      )}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>

            {/* Loading */}
            {isLoading && (
              <div className="p-4 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            )}

            {/* Error */}
            {isError && (
              <div className="p-4 flex items-center gap-2 text-destructive">
                <AlertCircle className="h-4 w-4" aria-hidden />
                <span className="text-sm">Failed to load standing orders.</span>
              </div>
            )}

            {/* Empty */}
            {!isLoading && !isError && filtered.length === 0 && (
              <ListEmpty
                icon={Workflow}
                message={
                  data && data.length > 0
                    ? 'No templates match this filter.'
                    : 'No standing order templates configured.'
                }
                className="px-0"
              />
            )}

            {/* Table */}
            {filtered.length > 0 && (
              <Table className="w-full text-sm">
                <TableHeader className="sticky top-0 bg-card z-10 text-xs text-muted-foreground">
                  <TableRow>
                    <TableHead className="text-left font-medium px-4">Code</TableHead>
                    <TableHead className="text-left font-medium px-4">Template</TableHead>
                    <TableHead className="text-left font-medium px-4 w-20">Version</TableHead>
                    <TableHead className="text-left font-medium px-4 w-40">MD auth</TableHead>
                    <TableHead className="text-left font-medium px-4 w-28">Status</TableHead>
                    <TableHead className="text-left font-medium px-4 w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((t) => (
                    <TableRow
                      interactive
                      key={t.id}
                      onClick={() => openRow(t.id)}
                      className="border-t hover:bg-accent/50 cursor-pointer transition-colors"
                    >
                      <TableCell className="px-4 font-mono text-xs text-muted-foreground">
                        {t.code}
                      </TableCell>
                      <TableCell className="px-4">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-sm flex items-center gap-1.5">
                            {t.name}
                            {t.isLocked && (
                              <Badge variant="secondary" className="gap-1 text-xs py-0">
                                <Lock className="h-3 w-3" aria-hidden />
                                Locked
                              </Badge>
                            )}
                          </span>
                          {t.description && (
                            <span className="text-xs text-muted-foreground line-clamp-1">
                              {t.description}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="px-4 font-mono tabular-nums text-sm">
                        v{t.version}
                      </TableCell>
                      <TableCell className="px-4">
                        <Badge variant={t.requiresPhysicianAuth ? 'due' : 'outline'}>
                          {t.requiresPhysicianAuth ? 'Required' : 'Not required'}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-4">
                        <Badge variant={t.isActive ? 'ok' : 'overdue'}>
                          {t.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-4">
                        <Button variant="ghost" size="sm" onClick={(e) => handleEditClick(e, t)}>
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </ScrollArea>

      {/* Detail drawer (read-only view, opened by clicking a row) */}
      <StandingOrderDetail
        templateId={selectedId}
        open={drawerOpen}
        onOpenChange={onDrawerOpenChange}
      />

      {/* Edit form (opened by the row's Edit button, unlocked templates only) */}
      {editTemplate && (
        <StandingOrderTemplateEditSheet
          open={!!editTemplate}
          onOpenChange={(open) => {
            if (!open) setEditTemplate(null)
          }}
          template={editTemplate}
        />
      )}

      {/* Locked template: new version confirmation */}
      <AlertDialog
        open={lockedDialogId !== null}
        onOpenChange={(open) => {
          if (!open) setLockedDialogId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Template is locked</AlertDialogTitle>
            <AlertDialogDescription>
              This template is locked and cannot be edited directly. Continuing will create a new
              version (v{lockedDialogVersion + 1}) and lock the current one. Do you want to
              continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleNewVersionConfirm}
              disabled={createNewVersion.isPending}
            >
              {createNewVersion.isPending ? 'Creating…' : 'Create new version'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
