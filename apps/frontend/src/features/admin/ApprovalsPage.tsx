import { useState } from 'react'
import { CheckCircle2, XCircle, AlertCircle, History } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  PageHeader,
  KpiCell,
  KpiStrip,
  ListEmpty,
  DetailSheet,
  PageToolbar,
  ComingSoonButton,
} from '@/components/layout'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/components/ui/toast'
import { useApprovals, useApproveRequest, useRejectRequest, type Approval } from './approvalsApi'
import ApprovalDetail from './components/ApprovalDetail'
import { apiErrorMessage } from '@/lib/apiErrors'

// ── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  void_transaction: 'Void',
  inventory_adjustment: 'Inventory',
  schedule_change: 'Schedule',
  discount_override: 'Discount',
}

const TYPE_VARIANT: Record<
  string,
  'default' | 'secondary' | 'outline' | 'due' | 'overdue' | 'ok' | 'info'
> = {
  void_transaction: 'overdue',
  inventory_adjustment: 'due',
  schedule_change: 'info',
  discount_override: 'due',
}

function formatRelativeTime(dt: string) {
  const date = new Date(dt)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// ── Tab value type ────────────────────────────────────────────────────────────

type StatusTab = 'Pending' | 'Approved' | 'Rejected' | 'All'

// ── Component ───────────────────────────────────────────────────────────────

export default function ApprovalsPage() {
  const { rows: approvals, totalCount, hasMore, loadMore, isLoading, isError } = useApprovals()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<StatusTab>('Pending')
  const approveMut = useApproveRequest()
  const rejectMut = useRejectRequest()
  const pending = approvals.filter((a) => a.status === 'Pending')
  const approved = approvals.filter((a) => a.status === 'Approved')
  const rejected = approvals.filter((a) => a.status === 'Rejected')

  const displayed =
    tab === 'All'
      ? approvals
      : tab === 'Pending'
        ? pending
        : tab === 'Approved'
          ? approved
          : rejected

  function handleApprove(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    approveMut.mutate(
      { id },
      {
        onSuccess: () => toast('Request approved'),
        onError: (err) => toast.error('Failed to approve', { description: apiErrorMessage(err) }),
      },
    )
  }

  function handleReject(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    rejectMut.mutate(
      { id },
      {
        onSuccess: () => toast('Request rejected'),
        onError: (err) => toast.error('Failed to reject', { description: apiErrorMessage(err) }),
      },
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* ── Page head ─────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="Approvals"
          description="Review and approve pending requests"
          actions={
            <ComingSoonButton size="sm" icon={<History className="h-3.5 w-3.5" aria-hidden />}>
              History
            </ComingSoonButton>
          }
        />
      </div>

      {/* ── KPI strip ─────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-b border-border bg-card">
        <KpiStrip>
          <KpiCell
            label="Pending"
            value={pending.length}
            subtitle={pending.length > 0 ? 'needs action' : 'queue clear'}
          />
          <KpiCell label="Approved today" value={approved.length} subtitle="resolved" />
          <KpiCell label="Rejected today" value={rejected.length} subtitle="declined" />
          <KpiCell label="Total requests" value={approvals.length} subtitle="all time visible" />
        </KpiStrip>
      </div>

      {/* ── Filter tabs ───────────────────────────────────────── */}
      <PageToolbar>
        <Tabs value={tab} onValueChange={(v) => setTab(v as StatusTab)}>
          <TabsList className="h-8">
            <TabsTrigger value="Pending" className="text-xs h-7 px-3">
              Pending
              {pending.length > 0 && (
                <span className="ml-1.5 font-mono tabular-nums text-xs bg-destructive/20 text-destructive rounded px-1">
                  {pending.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="Approved" className="text-xs h-7 px-3">
              Approved
            </TabsTrigger>
            <TabsTrigger value="Rejected" className="text-xs h-7 px-3">
              Rejected
            </TabsTrigger>
            <TabsTrigger value="All" className="text-xs h-7 px-3">
              All
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </PageToolbar>

      {/* ── List ──────────────────────────────────────────────── */}
      <ScrollArea className="flex-1">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 space-y-2">
          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          )}

          {isError && !isLoading && (
            <div className="flex items-center gap-2 text-destructive py-12 justify-center">
              <AlertCircle className="h-4 w-4" aria-hidden />
              <span className="text-sm">Failed to load approvals.</span>
            </div>
          )}

          {!isLoading && !isError && displayed.length === 0 && (
            <ListEmpty
              icon={CheckCircle2}
              message={
                tab === 'Pending' ? 'No pending approvals' : `No ${tab.toLowerCase()} approvals`
              }
            />
          )}

          {!isLoading &&
            !isError &&
            displayed.map((req) => (
              <ApprovalRow
                key={req.id}
                request={req}
                onSelect={() => setSelectedId(req.id)}
                onApprove={(e) => handleApprove(req.id, e)}
                onReject={(e) => handleReject(req.id, e)}
                disabled={approveMut.isPending || rejectMut.isPending}
              />
            ))}
        </div>
      </ScrollArea>

      {/* ── Load older ────────────────────────────────────────── */}
      {hasMore && !isLoading && (
        <div className="px-6 py-3 flex justify-center border-t border-border">
          <Button variant="outline" size="sm" onClick={loadMore}>
            Load older approvals
          </Button>
        </div>
      )}

      {/* ── Footer ────────────────────────────────────────────── */}
      <div className="px-6 py-2 xl:px-8 border-t border-border">
        <p className="text-xs text-muted-foreground">
          Showing {displayed.length}
          {totalCount !== null ? ` of ${totalCount.toLocaleString('en-PH')} loaded` : ''} request
          {displayed.length !== 1 ? 's' : ''}
          {tab !== 'All' ? ` · ${tab}` : ''}
        </p>
      </div>

      {/* ── Detail drawer ─────────────────────────────────────── */}
      <Sheet
        open={selectedId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
      >
        <DetailSheet className="overflow-hidden">
          <SheetHeader className="sr-only">
            <SheetTitle>Approval request</SheetTitle>
            <SheetDescription>Detailed view of an approval request</SheetDescription>
          </SheetHeader>
          {selectedId && <ApprovalDetail approvalId={selectedId} />}
        </DetailSheet>
      </Sheet>
    </div>
  )
}

// ── Approval row ─────────────────────────────────────────────────────────────

function ApprovalRow({
  request,
  onSelect,
  onApprove,
  onReject,
  disabled,
}: {
  request: Approval
  onSelect: () => void
  onApprove: (e: React.MouseEvent) => void
  onReject: (e: React.MouseEvent) => void
  disabled?: boolean
}) {
  const isPending = request.status === 'Pending'

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className="cursor-pointer hover:bg-muted/40 transition-colors"
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* urgency dot */}
          <div
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
              isPending ? 'bg-destructive' : 'bg-muted-foreground/40'
            }`}
          />

          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono tabular-nums text-muted-foreground">
                {request.id}
              </span>
              <Badge variant={TYPE_VARIANT[request.type] ?? 'outline'} className="text-xs">
                {TYPE_LABELS[request.type] ?? request.type}
              </Badge>
            </div>
            <p className="text-sm font-medium truncate">{request.description}</p>
            {request.details && (
              <p className="text-xs text-muted-foreground truncate">{request.details}</p>
            )}
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
              <span>By {request.requestedBy}</span>
              <span>·</span>
              <span className="font-mono tabular-nums">
                {formatRelativeTime(request.requestedAt)}
              </span>
              {request.reviewedBy && (
                <>
                  <span>·</span>
                  <span>
                    {request.status === 'Approved' ? 'Approved' : 'Rejected'} by{' '}
                    {request.reviewedBy}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isPending ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
                  disabled={disabled}
                  onClick={onReject}
                >
                  <XCircle className="h-3 w-3" aria-hidden />
                  Reject
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1"
                  disabled={disabled}
                  onClick={onApprove}
                >
                  <CheckCircle2 className="h-3 w-3" aria-hidden />
                  Approve
                </Button>
              </>
            ) : (
              <Badge
                variant={request.status === 'Approved' ? 'ok' : 'overdue'}
                className="text-xs gap-1"
              >
                {request.status === 'Approved' ? (
                  <CheckCircle2 className="h-3 w-3" aria-hidden />
                ) : (
                  <XCircle className="h-3 w-3" aria-hidden />
                )}
                {request.status}
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
