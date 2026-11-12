import { CheckCircle2, Clock, XCircle } from 'lucide-react'
import { DASH, formatDateTime } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'
import { ErrorBanner } from '@/components/layout'
import { apiErrorMessage } from '@/lib/apiErrors'
import { useApproval, useApproveRequest, useRejectRequest } from '../approvalsApi'

type Props = {
  approvalId: string
}

const TYPE_LABELS: Record<string, string> = {
  void_transaction: 'Void Transaction',
  inventory_adjustment: 'Inventory Adjustment',
  schedule_change: 'Schedule Change',
  discount_override: 'Discount Override',
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

const STATUS_CONFIG: Record<
  string,
  { icon: typeof Clock; variant: 'default' | 'outline' | 'due' | 'overdue' | 'ok' }
> = {
  Pending: { icon: Clock, variant: 'due' },
  Approved: { icon: CheckCircle2, variant: 'ok' },
  Rejected: { icon: XCircle, variant: 'overdue' },
}

// ── kv-row pattern ────────────────────────────────────────────────────────────

function KvRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border last:border-0">
      <span className="text-xs text-muted-foreground shrink-0 w-32">{label}</span>
      <span className="text-sm text-right break-words min-w-0 flex-1">{children}</span>
    </div>
  )
}

function KvMono({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <KvRow label={label}>
      <span className="font-mono tabular-nums">{value ?? DASH}</span>
    </KvRow>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
        {title}
      </h3>
      <div>{children}</div>
    </section>
  )
}

export default function ApprovalDetail({ approvalId }: Props) {
  const { data: approval, isLoading, isError } = useApproval(approvalId)
  const approveMut = useApproveRequest()
  const rejectMut = useRejectRequest()

  function onApprove() {
    if (!approval) return
    approveMut.mutate(
      { id: approval.id },
      {
        onSuccess: () => toast('Request approved'),
        onError: (err) => toast.error('Failed to approve', { description: apiErrorMessage(err) }),
      },
    )
  }

  function onReject() {
    if (!approval) return
    rejectMut.mutate(
      { id: approval.id },
      {
        onSuccess: () => toast('Request rejected'),
        onError: (err) => toast.error('Failed to reject', { description: apiErrorMessage(err) }),
      },
    )
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-32" />
        <Separator />
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
      </div>
    )
  }

  if (isError || !approval) {
    return <ErrorBanner message="Failed to load approval." className="p-6" />
  }

  const cfg = STATUS_CONFIG[approval.status] ?? { icon: Clock, variant: 'due' as const }
  const StatusIcon = cfg.icon

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold break-words">{approval.description}</h2>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <Badge variant={TYPE_VARIANT[approval.type] ?? 'outline'} className="text-xs">
                  {TYPE_LABELS[approval.type] ?? approval.type}
                </Badge>
                <Badge variant={cfg.variant} className="text-xs gap-1">
                  <StatusIcon className="h-3 w-3" aria-hidden />
                  {approval.status}
                </Badge>
              </div>
            </div>
          </div>
        </div>

        <Separator />

        {/* Request */}
        <Section title="Request">
          <KvRow label="Type">
            <Badge variant={TYPE_VARIANT[approval.type] ?? 'outline'} className="text-xs">
              {TYPE_LABELS[approval.type] ?? approval.type}
            </Badge>
          </KvRow>
          <KvRow label="Description">
            <span className="text-sm">{approval.description ?? DASH}</span>
          </KvRow>
          {approval.details && (
            <KvRow label="Details">
              <span className="text-sm">{approval.details}</span>
            </KvRow>
          )}
        </Section>

        <Separator />

        {/* Workflow */}
        <Section title="Workflow">
          <KvRow label="Status">
            <Badge variant={cfg.variant} className="text-xs gap-1">
              <StatusIcon className="h-3 w-3" aria-hidden />
              {approval.status}
            </Badge>
          </KvRow>
          <KvMono label="Requested by" value={approval.requestedBy} />
          <KvMono label="Requested at" value={formatDateTime(approval.requestedAt)} />
          <KvMono label="Reviewed by" value={approval.reviewedBy} />
          <KvMono label="Reviewed at" value={formatDateTime(approval.reviewedAt)} />
          {approval.reviewNotes && (
            <KvRow label="Review notes">
              <span className="text-sm">{approval.reviewNotes}</span>
            </KvRow>
          )}
        </Section>

        <Separator />

        {/* Linked entity */}
        <Section title="Linked Entity">
          <KvMono label="Entity type" value={approval.entityType} />
          <KvMono label="Entity ID" value={approval.entityId} />
        </Section>

        <Separator />

        {/* Audit */}
        <Section title="Audit">
          <KvMono label="Branch" value={approval.branch} />
          <KvMono label="Created at" value={formatDateTime(approval.createdAt)} />
          <KvMono label="Updated at" value={formatDateTime(approval.updatedAt)} />
        </Section>

        {/* Approve/Reject actions — only on Pending */}
        {approval.status === 'Pending' && (
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button
              variant="outline"
              size="sm"
              onClick={onReject}
              disabled={rejectMut.isPending || approveMut.isPending}
            >
              {rejectMut.isPending ? 'Rejecting…' : 'Reject'}
            </Button>
            <Button
              size="sm"
              onClick={onApprove}
              disabled={approveMut.isPending || rejectMut.isPending}
            >
              {approveMut.isPending ? 'Approving…' : 'Approve'}
            </Button>
          </div>
        )}
      </div>
    </ScrollArea>
  )
}
