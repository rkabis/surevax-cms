import { useState } from 'react'
import { AlertTriangle, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  PageHeader,
  KpiCell,
  KpiStrip,
  ListEmpty,
  TableCard,
  PageToolbar,
  DetailSheet,
} from '@/components/layout'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sheet, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { formatDateTime } from '@/lib/format'
import {
  useProductRecalls,
  useCreateRecall,
  type RecallSeverity,
  type RecallsFilters,
  type CreateRecallBody,
} from './recallsApi'
import { recallSeverityVariant, CLASS_DISPLAY } from '@/lib/status'
import ProductRecallDetail from './components/ProductRecallDetail'
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'

// ── Filter tabs ───────────────────────────────────────────────────────────────

type SeverityTab = 'All' | RecallSeverity

const SEVERITY_TABS: SeverityTab[] = ['All', 'Class1', 'Class2', 'Class3']
const SEVERITY_OPTIONS: RecallSeverity[] = ['Class1', 'Class2', 'Class3']

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProductRecallsPage() {
  const [severityTab, setSeverityTab] = useState<SeverityTab>('All')
  const [activeOnly, setActiveOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const filters: RecallsFilters = {
    ...(severityTab !== 'All' ? { severity: severityTab } : {}),
    ...(activeOnly ? { active: true } : {}),
  }

  const { data, isLoading, isError } = useProductRecalls(filters)
  const createRecall = useCreateRecall()

  const rows = data ?? []

  const activeCount = rows.filter((r) => !r.resolvedAt).length
  const resolvedCount = rows.filter((r) => !!r.resolvedAt).length
  const class1Count = rows.filter((r) => r.recallSeverity === 'Class1').length
  const notifRequired = rows.filter((r) => r.patientNotificationRequired && !r.resolvedAt).length

  // Create form state
  const [recallReason, setRecallReason] = useState('')
  const [recallSeverity, setRecallSeverity] = useState<RecallSeverity | ''>('')
  const [issuedAt, setIssuedAt] = useState('')
  const [productId, setProductId] = useState('')
  const [manufacturer, setManufacturer] = useState('')
  const [affectedLotsPattern, setAffectedLotsPattern] = useState('')
  const [patientNotificationRequired, setPatientNotificationRequired] = useState(false)
  const [creating, setCreating] = useState(false)

  function resetCreateForm() {
    setRecallReason('')
    setRecallSeverity('')
    setIssuedAt('')
    setProductId('')
    setManufacturer('')
    setAffectedLotsPattern('')
    setPatientNotificationRequired(false)
  }

  function handleCreate() {
    if (!recallReason || !recallSeverity || !issuedAt) return
    setCreating(true)
    const body: CreateRecallBody = {
      recallReason,
      recallSeverity,
      issuedAt: new Date(issuedAt).toISOString(),
      productId: productId || undefined,
      manufacturer: manufacturer || undefined,
      affectedLotsPattern: affectedLotsPattern || undefined,
      patientNotificationRequired,
    }
    createRecall.mutate(body, {
      onSuccess: () => {
        setCreateOpen(false)
        resetCreateForm()
        setCreating(false)
      },
      onError: (err) => {
        setCreating(false)
        toast.error('Failed to create recall', { description: apiErrorMessage(err) })
      },
    })
  }

  return (
    <div className="h-full flex flex-col">
      {/* Page head */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="Product Recalls"
          description={
            isLoading ? 'Loading…' : `${rows.length} recall${rows.length !== 1 ? 's' : ''}`
          }
          actions={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" aria-hidden />
              New Recall
            </Button>
          }
        />
      </div>

      {/* KPI strip */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-b border-border bg-card">
        <KpiStrip>
          <KpiCell
            label="Active recalls"
            value={isLoading ? '—' : activeCount}
            subtitle="unresolved"
          />
          <KpiCell
            label="Resolved"
            value={isLoading ? '—' : resolvedCount}
            subtitle="closed recalls"
          />
          <KpiCell
            label="Class I"
            value={isLoading ? '—' : class1Count}
            subtitle="highest severity"
          />
          <KpiCell
            label="Notification req."
            value={isLoading ? '—' : notifRequired}
            subtitle="patient alert active"
          />
        </KpiStrip>
      </div>

      {/* Severity tabs + active filter */}
      <PageToolbar>
        <Tabs value={severityTab} onValueChange={(v) => setSeverityTab(v as SeverityTab)}>
          <TabsList className="h-8">
            {SEVERITY_TABS.map((tab) => (
              <TabsTrigger key={tab} value={tab} className="text-xs px-3 h-7">
                {CLASS_DISPLAY[tab] ?? tab}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="ml-auto flex items-center gap-2">
          <Checkbox
            id="active-only"
            checked={activeOnly}
            onCheckedChange={(v) => setActiveOnly(!!v)}
          />
          <Label htmlFor="active-only" className="text-xs cursor-pointer">
            Active only
          </Label>
        </div>
      </PageToolbar>

      {/* List */}
      <ScrollArea className="flex-1">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4">
          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          )}

          {isError && (
            <div className="py-12 text-center">
              <p className="text-sm text-destructive">Failed to load product recalls.</p>
            </div>
          )}

          {!isLoading && !isError && rows.length === 0 && (
            <ListEmpty icon={AlertTriangle} message="No recalls found." />
          )}

          {!isLoading && !isError && rows.length > 0 && (
            <TableCard>
              <Table className="w-full text-sm">
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="text-left px-6 font-medium">Recall ID</TableHead>
                    <TableHead className="text-left px-4 font-medium">Service</TableHead>
                    <TableHead className="text-left px-4 font-medium">Severity</TableHead>
                    <TableHead className="text-left px-4 font-medium">Manufacturer</TableHead>
                    <TableHead className="text-left px-4 font-medium">Issued</TableHead>
                    <TableHead className="text-left px-4 font-medium">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow
                      interactive
                      key={r.id}
                      onClick={() => setSelectedId(r.id)}
                      className="border-b border-border hover:bg-accent/50 transition-colors cursor-pointer"
                    >
                      <TableCell className="px-6">
                        <p className="font-mono tabular-nums text-xs">{r.id}</p>
                      </TableCell>
                      <TableCell className="px-4 text-muted-foreground">
                        {r.productName ?? '—'}
                      </TableCell>
                      <TableCell className="px-4">
                        <Badge
                          variant={recallSeverityVariant(r.recallSeverity)}
                          className="text-xs"
                        >
                          {CLASS_DISPLAY[r.recallSeverity] ?? r.recallSeverity}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-4 text-muted-foreground">
                        {r.manufacturer ?? '—'}
                      </TableCell>
                      <TableCell className="px-4 text-muted-foreground text-xs font-mono tabular-nums">
                        {formatDateTime(r.issuedAt)}
                      </TableCell>
                      <TableCell className="px-4">
                        <Badge variant={r.resolvedAt ? 'ok' : 'destructive'} className="text-xs">
                          {r.resolvedAt ? 'Resolved' : 'Active'}
                        </Badge>
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
          {rows.length} recall{rows.length !== 1 ? 's' : ''}
          {severityTab !== 'All' ? ` · ${severityTab}` : ''}
          {activeOnly ? ' · Active only' : ''}
        </p>
      </div>

      {/* Detail Sheet */}
      <Sheet open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DetailSheet>
          <SheetHeader className="px-6 py-4 border-b border-border">
            <SheetTitle>Recall Detail</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-hidden">
            {selectedId && <ProductRecallDetail id={selectedId} />}
          </div>
        </DetailSheet>
      </Sheet>

      {/* Create Dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) resetCreateForm()
        }}
      >
        <DialogContent className="max-w-lg xl:max-w-xl">
          <DialogHeader>
            <DialogTitle>New Recall</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="recall-reason">
                Recall reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="recall-reason"
                rows={3}
                placeholder="Describe the recall reason…"
                value={recallReason}
                onChange={(e) => setRecallReason(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="recall-severity">
                  Severity <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={recallSeverity}
                  onValueChange={(v) => setRecallSeverity(v as RecallSeverity)}
                >
                  <SelectTrigger id="recall-severity">
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITY_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {CLASS_DISPLAY[s] ?? s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="issued-at">
                  Issued at <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="issued-at"
                  type="datetime-local"
                  value={issuedAt}
                  onChange={(e) => setIssuedAt(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="service-id">Service ID (optional)</Label>
              <Input
                id="service-id"
                placeholder="SVC-…"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manufacturer">Manufacturer (optional)</Label>
              <Input
                id="manufacturer"
                placeholder="e.g. Sanofi"
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lots-pattern">Affected lots pattern (optional)</Label>
              <Input
                id="lots-pattern"
                placeholder="e.g. LOT_*"
                value={affectedLotsPattern}
                onChange={(e) => setAffectedLotsPattern(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-3">
              <Checkbox
                id="patient-notification"
                checked={patientNotificationRequired}
                onCheckedChange={(v) => setPatientNotificationRequired(!!v)}
              />
              <Label htmlFor="patient-notification">Patient notification required</Label>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateOpen(false)
                resetCreateForm()
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!recallReason || !recallSeverity || !issuedAt || creating}
            >
              {creating ? 'Creating…' : 'Create Recall'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
