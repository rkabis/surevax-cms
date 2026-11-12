import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { UserLabel } from '@/components/UserLabel'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { formatDateTime } from '@/lib/format'
import {
  useProductRecall,
  useUpdateRecall,
  type RecallSeverity,
  type UpdateRecallBody,
} from '../recallsApi'
import { recallSeverityVariant } from '@/lib/status'
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'
import { ErrorBanner } from '@/components/layout'

type Props = {
  id: string
}

function KvRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.75rem_1fr] gap-3 py-2 border-b border-border/50 last:border-0">
      <dt className="text-xs font-medium text-muted-foreground pt-0.5">{label}</dt>
      <dd className="text-sm break-words">{children ?? '—'}</dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
        {title}
      </h3>
      <dl>{children}</dl>
    </section>
  )
}

const SEVERITY_OPTIONS: RecallSeverity[] = ['Class1', 'Class2', 'Class3']

export default function ProductRecallDetail({ id }: Props) {
  const { data: recall, isLoading, isError } = useProductRecall(id)
  const updateRecall = useUpdateRecall()

  const [editOpen, setEditOpen] = useState(false)
  const [editReason, setEditReason] = useState('')
  const [editSeverity, setEditSeverity] = useState<RecallSeverity | ''>('')
  const [editIssuedAt, setEditIssuedAt] = useState('')
  const [editManufacturer, setEditManufacturer] = useState('')
  const [editLotsPattern, setEditLotsPattern] = useState('')
  const [editNotification, setEditNotification] = useState(false)
  const [editing, setEditing] = useState(false)
  const [resolving, setResolving] = useState(false)

  function openEdit() {
    if (!recall) return
    setEditReason(recall.recallReason)
    setEditSeverity(recall.recallSeverity)
    setEditIssuedAt(recall.issuedAt.slice(0, 16))
    setEditManufacturer(recall.manufacturer ?? '')
    setEditLotsPattern(recall.affectedLotsPattern ?? '')
    setEditNotification(recall.patientNotificationRequired)
    setEditOpen(true)
  }

  function handleEdit() {
    if (!editReason || !editSeverity || !editIssuedAt) return
    setEditing(true)
    const body: UpdateRecallBody = {
      recallReason: editReason,
      recallSeverity: editSeverity,
      issuedAt: new Date(editIssuedAt).toISOString(),
      manufacturer: editManufacturer || undefined,
      affectedLotsPattern: editLotsPattern || undefined,
      patientNotificationRequired: editNotification,
    }
    updateRecall.mutate(
      { id, body },
      {
        onSuccess: () => {
          setEditOpen(false)
          setEditing(false)
        },
        onError: (err) => {
          setEditing(false)
          toast.error('Failed to update recall', { description: apiErrorMessage(err) })
        },
      },
    )
  }

  function handleResolve() {
    setResolving(true)
    updateRecall.mutate(
      { id, body: { resolvedAt: new Date().toISOString() } },
      {
        onSuccess: () => setResolving(false),
        onError: (err) => {
          setResolving(false)
          toast.error('Failed to resolve recall', { description: apiErrorMessage(err) })
        },
      },
    )
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-32" />
        <div className="space-y-2 mt-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
      </div>
    )
  }

  if (isError || !recall) {
    return <ErrorBanner message="Failed to load recall." className="p-6" />
  }

  const isResolved = !!recall.resolvedAt

  return (
    <>
      <ScrollArea className="h-full">
        <div className="px-6 py-6 space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono tabular-nums text-xs text-muted-foreground">{recall.id}</p>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <Badge variant={recallSeverityVariant(recall.recallSeverity)}>
                  {recall.recallSeverity}
                </Badge>
                <Badge variant={isResolved ? 'ok' : 'destructive'}>
                  {isResolved ? 'Resolved' : 'Active'}
                </Badge>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              {!isResolved && (
                <Button size="sm" variant="outline" onClick={handleResolve} disabled={resolving}>
                  {resolving ? 'Resolving…' : 'Resolve'}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={openEdit}>
                Edit
              </Button>
            </div>
          </div>

          <Section title="Recall reason">
            <KvRow label="Reason">{recall.recallReason}</KvRow>
          </Section>

          <Section title="Product">
            <KvRow label="Product ID">
              {recall.productId ? (
                <span className="font-mono tabular-nums text-xs">{recall.productId}</span>
              ) : null}
            </KvRow>
            <KvRow label="Product name">{recall.productName}</KvRow>
            <KvRow label="Manufacturer">{recall.manufacturer}</KvRow>
            <KvRow label="Affected lots">{recall.affectedLotsPattern}</KvRow>
          </Section>

          <Section title="Timeline">
            <KvRow label="Issued at">
              <span className="font-mono tabular-nums text-xs">
                {formatDateTime(recall.issuedAt)}
              </span>
            </KvRow>
            <KvRow label="Resolved at">
              {recall.resolvedAt ? (
                <span className="font-mono tabular-nums text-xs">
                  {formatDateTime(recall.resolvedAt)}
                </span>
              ) : null}
            </KvRow>
            <KvRow label="Patient notification">
              {recall.patientNotificationRequired ? 'Required' : 'Not required'}
            </KvRow>
          </Section>

          <Section title="Audit">
            <KvRow label="Created by">
              <UserLabel user={recall.createdBy} />
            </KvRow>
            <KvRow label="Created at">
              <span className="font-mono tabular-nums text-xs">
                {formatDateTime(recall.createdAt)}
              </span>
            </KvRow>
            <KvRow label="Updated at">
              <span className="font-mono tabular-nums text-xs">
                {formatDateTime(recall.updatedAt)}
              </span>
            </KvRow>
          </Section>
        </div>
      </ScrollArea>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg xl:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit Recall</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-reason">
                Recall reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="edit-reason"
                rows={3}
                placeholder="Describe the recall reason…"
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-severity">
                  Severity <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={editSeverity}
                  onValueChange={(v) => setEditSeverity(v as RecallSeverity)}
                >
                  <SelectTrigger id="edit-severity">
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITY_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-issued-at">
                  Issued at <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="edit-issued-at"
                  type="datetime-local"
                  value={editIssuedAt}
                  onChange={(e) => setEditIssuedAt(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-manufacturer">Manufacturer (optional)</Label>
              <Input
                id="edit-manufacturer"
                placeholder="e.g. Sanofi"
                value={editManufacturer}
                onChange={(e) => setEditManufacturer(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-lots">Affected lots pattern (optional)</Label>
              <Input
                id="edit-lots"
                placeholder="e.g. LOT_*"
                value={editLotsPattern}
                onChange={(e) => setEditLotsPattern(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-3">
              <Checkbox
                id="edit-notification"
                checked={editNotification}
                onCheckedChange={(v) => setEditNotification(!!v)}
              />
              <Label htmlFor="edit-notification">Patient notification required</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleEdit}
              disabled={!editReason || !editSeverity || !editIssuedAt || editing}
            >
              {editing ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
