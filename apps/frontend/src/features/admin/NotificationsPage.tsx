import { useState } from 'react'
import { Bell, ChevronRight } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { Sheet, SheetHeader, SheetTitle } from '@/components/ui/sheet'
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
import { toast } from '@/components/ui/toast'
import {
  PageHeader,
  KpiCell,
  KpiStrip,
  ListEmpty,
  DetailSheet,
  TableCard,
  PageToolbar,
} from '@/components/layout'
import { formatDateTime } from '@/lib/format'
import {
  useNotifications,
  useDryRunNotification,
  useNotificationTemplates,
  type NotificationStatus,
  type NotificationsFilters,
  type DryRunResult,
} from './notificationsApi'
import NotificationDetail from './components/NotificationDetail'
import { notificationStatusVariant } from '@/lib/status'
import { apiErrorMessage } from '@/lib/apiErrors'

// ── Status tabs ───────────────────────────────────────────────────────────────

type StatusTab = 'All' | NotificationStatus

const STATUS_TABS: StatusTab[] = ['All', 'Queued', 'Sending', 'Sent', 'Delivered', 'Failed']

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const [tab, setTab] = useState<StatusTab>('All')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dryRunOpen, setDryRunOpen] = useState(false)

  // Dry-run form state
  const [dryTemplateCode, setDryTemplateCode] = useState('')
  const [dryPatientId, setDryPatientId] = useState('')
  const [dryChannel, setDryChannel] = useState<'SMS' | 'Email' | 'Push'>('SMS')
  const [dryBodyOverride, setDryBodyOverride] = useState('')
  const [dryResult, setDryResult] = useState<DryRunResult | null>(null)

  const filters: NotificationsFilters = tab === 'All' ? {} : { status: tab as NotificationStatus }
  const { rows, totalCount, hasMore, loadMore, isLoading, isError } = useNotifications(filters)
  const dryRun = useDryRunNotification()
  const { data: templatesData } = useNotificationTemplates({ isActive: true })

  const activeTemplates = templatesData?.data ?? []

  // KPI counts
  const queuedCount = rows.filter((n) => n.status === 'Queued').length
  const failedCount = rows.filter((n) => n.status === 'Failed').length
  const deliveredCount = rows.filter((n) => n.status === 'Delivered').length
  const sentCount = rows.filter((n) => n.status === 'Sent').length

  function resetDryRun() {
    setDryTemplateCode('')
    setDryPatientId('')
    setDryChannel('SMS')
    setDryBodyOverride('')
    setDryResult(null)
  }

  function handleDryRun() {
    dryRun.mutate(
      {
        patientId: Number(dryPatientId),
        templateCode: dryTemplateCode || null,
        channel: dryChannel,
        body: dryBodyOverride || null,
      },
      {
        onSuccess: (result) => {
          setDryResult(result)
        },
        onError: (err) => {
          toast('Dry-run failed', { description: apiErrorMessage(err) })
        },
      },
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* ── Page head ─────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="Notifications"
          description="Outbound message delivery tracking"
          actions={
            <Button size="sm" variant="outline" onClick={() => setDryRunOpen(true)}>
              Dry-Run
            </Button>
          }
        />
      </div>

      {/* ── KPI strip ─────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-b border-border bg-card">
        <KpiStrip>
          <KpiCell label="Total" value={rows.length} subtitle="in current view" />
          <KpiCell
            label="Queued / sending"
            value={queuedCount}
            subtitle={queuedCount > 0 ? 'pending delivery' : 'queue empty'}
          />
          <KpiCell
            label="Delivered / sent"
            value={deliveredCount + sentCount}
            subtitle="successfully dispatched"
          />
          <KpiCell
            label="Failed"
            value={failedCount}
            subtitle={failedCount > 0 ? 'needs attention' : 'no failures'}
          />
        </KpiStrip>
      </div>

      {/* ── Filter tabs ───────────────────────────────────────── */}
      <PageToolbar>
        <Tabs value={tab} onValueChange={(v) => setTab(v as StatusTab)}>
          <TabsList className="h-8">
            {STATUS_TABS.map((t) => (
              <TabsTrigger key={t} value={t} className="text-xs h-7 px-3">
                {t}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </PageToolbar>

      {/* ── Table ─────────────────────────────────────────────── */}
      <ScrollArea className="flex-1">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4">
          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          )}

          {isError && !isLoading && (
            <div className="py-12 text-center">
              <p className="text-sm text-destructive">Failed to load notifications.</p>
            </div>
          )}

          {!isLoading && !isError && rows.length === 0 && (
            <ListEmpty icon={Bell} message="No notifications found." />
          )}

          {!isLoading && !isError && rows.length > 0 && (
            <TableCard>
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="w-[11.25rem]">NTF ID</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead className="w-24">Channel</TableHead>
                    <TableHead className="w-28">Status</TableHead>
                    <TableHead className="w-[10rem]">Time</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((n) => {
                    const time = n.sentAt ?? n.scheduledAt ?? n.createdAt
                    const recipient = n.recipientAddress
                      ? n.recipientAddress.length > 30
                        ? n.recipientAddress.slice(0, 30) + '…'
                        : n.recipientAddress
                      : '—'
                    return (
                      <TableRow
                        interactive
                        key={n.id}
                        onClick={() => setSelectedId(n.id)}
                        className="cursor-pointer"
                      >
                        <TableCell>
                          <span className="font-mono tabular-nums text-xs truncate max-w-[10rem] block">
                            {n.id}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-muted-foreground text-sm">
                            {n.patientName ?? '—'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">
                            {n.channel}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={notificationStatusVariant(n.status)} className="text-xs">
                            {n.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-muted-foreground text-xs font-mono tabular-nums">
                            {formatDateTime(time)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-muted-foreground text-xs font-mono tabular-nums truncate max-w-[11.25rem] block">
                            {recipient}
                          </span>
                        </TableCell>
                        <TableCell>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
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
            Load older notifications
          </Button>
        </div>
      )}

      {/* ── Footer ────────────────────────────────────────────── */}
      <div className="px-6 py-2 xl:px-8 border-t border-border">
        <p className="text-xs text-muted-foreground">
          Showing {rows.length}
          {totalCount !== null ? ` of ${totalCount.toLocaleString('en-PH')}` : ''} notification
          {rows.length !== 1 ? 's' : ''}
          {tab !== 'All' ? ` · ${tab}` : ''}
        </p>
      </div>

      {/* ── Detail Sheet ──────────────────────────────────────── */}
      <Sheet open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DetailSheet>
          <SheetHeader className="px-6 py-4 border-b border-border">
            <SheetTitle>Notification Detail</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-hidden">
            {selectedId && <NotificationDetail id={selectedId} />}
          </div>
        </DetailSheet>
      </Sheet>

      {/* ── Dry-Run Dialog ────────────────────────────────────── */}
      <Dialog
        open={dryRunOpen}
        onOpenChange={(open) => {
          setDryRunOpen(open)
          if (!open) resetDryRun()
        }}
      >
        <DialogContent className="sm:max-w-lg xl:max-w-xl">
          <DialogHeader>
            <DialogTitle>Dry-run notification</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="dry-template-code">Template code</Label>
              {activeTemplates.length > 0 ? (
                <div className="space-y-2">
                  <Select value={dryTemplateCode} onValueChange={(v) => setDryTemplateCode(v)}>
                    <SelectTrigger id="dry-template-code">
                      <SelectValue placeholder="Select a template…" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeTemplates.map((tmpl) => (
                        <SelectItem key={tmpl.id} value={tmpl.code}>
                          {tmpl.code}
                          {tmpl.subject ? ` — ${tmpl.subject}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Or type a code directly:</p>
                  <Input
                    placeholder="e.g. APPT_REMINDER"
                    value={dryTemplateCode}
                    onChange={(e) => setDryTemplateCode(e.target.value)}
                  />
                </div>
              ) : (
                <Input
                  id="dry-template-code"
                  placeholder="e.g. APPT_REMINDER"
                  value={dryTemplateCode}
                  onChange={(e) => setDryTemplateCode(e.target.value)}
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dry-patient-id">
                Patient ID (numeric) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="dry-patient-id"
                placeholder="e.g. 1"
                value={dryPatientId}
                onChange={(e) => setDryPatientId(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dry-channel">
                Channel <span className="text-destructive">*</span>
              </Label>
              <Select
                value={dryChannel}
                onValueChange={(v) => setDryChannel(v as 'SMS' | 'Email' | 'Push')}
              >
                <SelectTrigger id="dry-channel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SMS">SMS</SelectItem>
                  <SelectItem value="Email">Email</SelectItem>
                  <SelectItem value="Push">Push</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dry-body">Body override (optional)</Label>
              <Input
                id="dry-body"
                placeholder="Leave blank to use template body"
                value={dryBodyOverride}
                onChange={(e) => setDryBodyOverride(e.target.value)}
              />
            </div>

            {/* Preview result */}
            {dryResult && (
              <div className="rounded-md border border-border bg-muted/40 p-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Preview
                </p>
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">Channel</p>
                  <Badge variant="secondary" className="text-xs">
                    {dryResult.channel}
                  </Badge>
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="text-sm">{dryResult.status}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Body</p>
                  <p className="text-sm whitespace-pre-wrap">{dryResult.body}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Notification ID</p>
                  <p className="text-sm font-mono">{dryResult.id}</p>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDryRunOpen(false)
                resetDryRun()
              }}
            >
              Close
            </Button>
            <Button onClick={handleDryRun} disabled={!dryPatientId || dryRun.isPending}>
              {dryRun.isPending ? 'Running…' : 'Run preview'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
