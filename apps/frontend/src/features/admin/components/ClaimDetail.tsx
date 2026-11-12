import { useState } from 'react'
import { Pencil, Trash2, Plus, ChevronRight } from 'lucide-react'
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
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatDateTime, formatMoney } from '@/lib/format'
import { useClaim, useUpdateClaimStatus, type ClaimStatus } from '../claimsApi'
import { claimStatusVariant } from '@/lib/status'
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'
import { ErrorBanner, TableCard } from '@/components/layout'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'

// ── Status workflow ───────────────────────────────────────────────────────────

// Linear progression terminates at Paid; Denied/Appealed are parallel terminal/re-entry states.
const LINEAR_STATUSES: ClaimStatus[] = [
  'Draft',
  'Submitted',
  'Acknowledged',
  'InReview',
  'Approved',
  'PartiallyApproved',
  'Paid',
]
const TERMINAL_STATUSES: ClaimStatus[] = ['Denied', 'Appealed']

const VALID_TRANSITIONS: Partial<Record<ClaimStatus, ClaimStatus[]>> = {
  Draft: ['Submitted'],
  Submitted: ['Acknowledged', 'InReview'],
  Acknowledged: ['InReview'],
  InReview: ['Approved', 'PartiallyApproved', 'Denied'],
  Approved: ['Paid'],
  PartiallyApproved: ['Paid'],
  Denied: ['Appealed'],
  Appealed: ['InReview', 'Denied'],
}

function StatusFlow({
  current,
  onAdvance,
}: {
  current: ClaimStatus
  onAdvance?: (to: ClaimStatus) => void
}) {
  const validNext = VALID_TRANSITIONS[current] ?? []

  function renderBadge(s: ClaimStatus, inLinear: boolean) {
    const isCurrent = s === current
    const isPast =
      inLinear && LINEAR_STATUSES.indexOf(s) < LINEAR_STATUSES.indexOf(current as ClaimStatus)
    const isAdvanceable = validNext.includes(s)

    if (isAdvanceable && onAdvance) {
      return (
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-2xs gap-1"
          onClick={() => onAdvance(s)}
        >
          {s}
        </Button>
      )
    }

    return (
      <Badge
        variant={isCurrent ? claimStatusVariant(s) : isPast ? 'outline' : 'secondary'}
        className={`text-xs ${isPast ? 'opacity-40' : ''} ${!isCurrent && !isPast && !isAdvanceable ? 'opacity-30' : ''}`}
      >
        {isCurrent ? (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-current inline-block" />
            {s}
          </span>
        ) : (
          s
        )}
      </Badge>
    )
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {/* Linear progression: Draft → … → Paid */}
      {LINEAR_STATUSES.map((s, i) => (
        <div key={s} className="flex items-center gap-1">
          {i > 0 && (
            <ChevronRight
              className={`h-3 w-3 shrink-0 ${
                LINEAR_STATUSES.indexOf(current as ClaimStatus) > i
                  ? 'text-muted-foreground/30'
                  : s === current
                    ? 'text-muted-foreground'
                    : 'text-muted-foreground/20'
              }`}
            />
          )}
          {renderBadge(s, true)}
        </div>
      ))}

      {/* Divider separating linear flow from parallel terminal/re-entry states */}
      <span className="text-muted-foreground/40 px-0.5 select-none" aria-hidden>
        │
      </span>

      {/* Terminal / re-entry states: Denied, Appealed */}
      {TERMINAL_STATUSES.map((s, i) => (
        <div key={s} className="flex items-center gap-1">
          {i > 0 && (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/20" aria-hidden />
          )}
          {renderBadge(s, false)}
        </div>
      ))}
    </div>
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Props = {
  id: string
}

type NewItemForm = {
  serviceCode: string
  description: string
  quantity: string
  chargedAmount: string
}

const EMPTY_ITEM: NewItemForm = {
  serviceCode: '',
  description: '',
  quantity: '1',
  chargedAmount: '',
}

// ── KvRow / Section ───────────────────────────────────────────────────────────

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

// ── Component ─────────────────────────────────────────────────────────────────

export default function ClaimDetail({ id }: Props) {
  const { data: claim, isLoading, isError } = useClaim(id)
  const updateStatus = useUpdateClaimStatus()
  const [statusDialogOpen, setStatusDialogOpen] = useState(false)
  const [newStatus, setNewStatus] = useState<ClaimStatus | ''>('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Item form state
  const [showAddItem, setShowAddItem] = useState(false)
  const [itemForm, setItemForm] = useState<NewItemForm>(EMPTY_ITEM)

  function handleUpdateStatus() {
    if (!newStatus) return
    setSubmitting(true)
    updateStatus.mutate(
      { id, body: { status: newStatus, note: note || undefined } },
      {
        onSuccess: () => {
          setStatusDialogOpen(false)
          setNewStatus('')
          setNote('')
          setSubmitting(false)
        },
        onError: (err) => {
          setSubmitting(false)
          toast.error('Failed to update claim status', { description: apiErrorMessage(err) })
        },
      },
    )
  }

  function resetItemForm() {
    setItemForm(EMPTY_ITEM)
    setShowAddItem(false)
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

  if (isError || !claim) {
    return <ErrorBanner message="Failed to load claim." className="p-6" />
  }

  return (
    <>
      <ScrollArea className="h-full">
        <div className="px-6 py-6 space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono tabular-nums text-xs text-muted-foreground">{claim.id}</p>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <Badge variant={claimStatusVariant(claim.status)}>{claim.status}</Badge>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => setStatusDialogOpen(true)}>
              Update Status
            </Button>
          </div>

          {/* Status flow */}
          <Section title="Status">
            <div className="mt-2">
              <StatusFlow current={claim.status} />
            </div>
          </Section>

          <Section title="Claim">
            <KvRow label="Payer ID">
              <span className="font-mono tabular-nums text-xs">{claim.payerId}</span>
            </KvRow>
            <KvRow label="Payer name">{claim.payer?.name}</KvRow>
            <KvRow label="Patient ID">
              {claim.patientId ? (
                <span className="font-mono tabular-nums text-xs">{claim.patientId}</span>
              ) : null}
            </KvRow>
            <KvRow label="Encounter ID">
              {claim.encounterId ? (
                <span className="font-mono tabular-nums text-xs">{claim.encounterId}</span>
              ) : null}
            </KvRow>
            <KvRow label="Transaction ID">
              {claim.transactionId ? (
                <span className="font-mono tabular-nums text-xs">{claim.transactionId}</span>
              ) : null}
            </KvRow>
            <KvRow label="External claim #">
              {claim.externalClaimNumber ? (
                <span className="font-mono tabular-nums text-xs">{claim.externalClaimNumber}</span>
              ) : null}
            </KvRow>
            <KvRow label="LOA number">
              {claim.loaNumber ? (
                <span className="font-mono tabular-nums text-xs">{claim.loaNumber}</span>
              ) : null}
            </KvRow>
          </Section>

          <Section title="Financials">
            <KvRow label="Total billed">
              {claim.totalBilled ? (
                <span className="font-mono tabular-nums">{formatMoney(claim.totalBilled)}</span>
              ) : null}
            </KvRow>
            <KvRow label="Total approved">
              {claim.totalApproved ? (
                <span className="font-mono tabular-nums">{formatMoney(claim.totalApproved)}</span>
              ) : null}
            </KvRow>
          </Section>

          {/* Items */}
          <Section title={`Items (${claim.items.length})`}>
            <TableCard className="mt-2">
              <Table className="w-full text-sm">
                <TableHeader className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <TableRow>
                    <TableHead className="text-left px-3 font-medium">Description</TableHead>
                    <TableHead className="text-left px-3 font-medium">Code</TableHead>
                    <TableHead className="text-right px-3 font-medium">Qty</TableHead>
                    <TableHead className="text-right px-3 font-medium">Charged</TableHead>
                    <TableHead className="text-right px-3 font-medium">Approved</TableHead>
                    <TableHead className="text-right px-3 font-medium w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {claim.items.map((item) => (
                    <TableRow key={item.id} className="border-t border-border">
                      <TableCell className="px-3">{item.description ?? '—'}</TableCell>
                      <TableCell className="px-3 font-mono tabular-nums text-xs">
                        {item.serviceCode ?? '—'}
                      </TableCell>
                      <TableCell className="px-3 text-right font-mono tabular-nums">
                        {item.quantity ?? '1'}
                      </TableCell>
                      <TableCell className="px-3 text-right font-mono tabular-nums">
                        {formatMoney(item.chargedAmount)}
                      </TableCell>
                      <TableCell className="px-3 text-right font-mono tabular-nums">
                        {item.approvedAmount ? formatMoney(item.approvedAmount) : '—'}
                      </TableCell>
                      <TableCell className="px-3">
                        <div className="flex items-center justify-end gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span tabIndex={0}>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  disabled
                                  aria-label="Edit item"
                                >
                                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="left">
                              Item editing not yet available
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span tabIndex={0}>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  disabled
                                  aria-label="Delete item"
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="left">
                              Item editing not yet available
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {claim.items.length === 0 && !showAddItem && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="px-3 py-4 text-center text-sm text-muted-foreground"
                      >
                        No items.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableCard>

            {/* Add Item form */}
            {showAddItem && (
              <div className="rounded-md border border-border p-3 space-y-3 mt-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Service Code</Label>
                    <Input
                      placeholder="e.g. 99213"
                      className="h-8 text-sm"
                      value={itemForm.serviceCode}
                      onChange={(e) =>
                        setItemForm((prev) => ({ ...prev, serviceCode: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Quantity</Label>
                    <Input
                      type="number"
                      min="1"
                      placeholder="1"
                      className="h-8 text-sm"
                      value={itemForm.quantity}
                      onChange={(e) =>
                        setItemForm((prev) => ({ ...prev, quantity: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Description</Label>
                    <Input
                      placeholder="Service description"
                      className="h-8 text-sm"
                      value={itemForm.description}
                      onChange={(e) =>
                        setItemForm((prev) => ({ ...prev, description: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Charged Amount (PHP)</Label>
                    <Input
                      placeholder="0.00"
                      className="h-8 text-sm"
                      value={itemForm.chargedAmount}
                      onChange={(e) =>
                        setItemForm((prev) => ({ ...prev, chargedAmount: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={resetItemForm}>
                    Cancel
                  </Button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0}>
                        <Button size="sm" disabled>
                          Add Item
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Item editing not yet available</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            )}

            {!showAddItem && (
              <div className="mt-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0}>
                      <Button variant="outline" size="sm" className="gap-1.5" disabled>
                        <Plus className="h-3.5 w-3.5" aria-hidden />
                        Add Item
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Item editing not yet available</TooltipContent>
                </Tooltip>
              </div>
            )}
          </Section>

          {/* Status history */}
          {claim.statusHistory.length > 0 && (
            <Section title="Status History">
              <div className="space-y-2 mt-2">
                {claim.statusHistory.map((h) => (
                  <div key={h.id} className="flex items-start gap-3 text-sm">
                    <div className="shrink-0 mt-0.5">
                      <Badge variant={claimStatusVariant(h.toStatus)} className="text-xs">
                        {h.toStatus}
                      </Badge>
                    </div>
                    <div className="flex-1 min-w-0">
                      {h.note && (
                        <p className="text-muted-foreground text-xs break-words">{h.note}</p>
                      )}
                      <p className="text-xs text-muted-foreground/60 font-mono tabular-nums">
                        {formatDateTime(h.changedAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          <Section title="Audit">
            <KvRow label="Created at">
              <span className="font-mono tabular-nums text-xs">
                {formatDateTime(claim.createdAt)}
              </span>
            </KvRow>
            <KvRow label="Updated at">
              <span className="font-mono tabular-nums text-xs">
                {formatDateTime(claim.updatedAt)}
              </span>
            </KvRow>
          </Section>
        </div>
      </ScrollArea>

      {/* Update status dialog — with visual status flow */}
      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Claim Status</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Current: {claim.status}</Label>
              <div className="mt-2">
                <StatusFlow current={claim.status} onAdvance={(to) => setNewStatus(to)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status-note">Note (optional)</Label>
              <Textarea
                id="status-note"
                rows={3}
                placeholder="Add a note…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateStatus} disabled={!newStatus || submitting}>
              {submitting ? 'Saving…' : newStatus ? `Advance to ${newStatus}` : 'Select a status'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
