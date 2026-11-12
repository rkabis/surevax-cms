import { useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { useBreakGlass, type BreakGlassChart, type BreakGlassInput } from '../api'

// ── Types ─────────────────────────────────────────────────────────────────────

type ReasonCategory = BreakGlassInput['reasonCategory']

const REASON_OPTIONS: Array<{ value: ReasonCategory; label: string }> = [
  { value: 'Continuity_of_care', label: 'Continuity of care' },
  { value: 'Emergency', label: 'Emergency' },
  { value: 'Patient_request', label: 'Patient request' },
  { value: 'Quality_review', label: 'Quality review' },
  { value: 'Other', label: 'Other' },
]

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** PAT_XXXXXXXX display id of the patient whose cross-branch chart is being revealed */
  patientDisplayId: string
  /** Branch display id (BRN_… or SVX.HST) at which the cross-branch chart lives */
  targetBranchDisplayId: string
  /** Branch name for display purposes */
  targetBranchName?: string
  /** Called on success with the returned chart data */
  onReveal: (chart: BreakGlassChart) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * BreakGlassReveal
 *
 * Implements the RFC §8c "irreversible-action typed-reason gate" for
 * cross-branch PHI reveal. Requires a mandatory reason category + free-text
 * reason (min 10 chars) before calling POST /api/patients/:id/break-glass.
 *
 * On success:
 * - Calls onReveal(chart) so the parent can render the Tier-2 chart
 * - Shows a sticky non-auto-hide toast with the CBA_ grant ID for audit trail
 * - Closes the dialog
 *
 * The grant is PERSISTENT (D1 model): re-opening this dialog for the same
 * patient at the same branch does not re-prompt — the parent should track
 * whether a grant exists and skip showing this dialog.
 */
export default function BreakGlassReveal({
  open,
  onOpenChange,
  patientDisplayId,
  targetBranchDisplayId,
  targetBranchName,
  onReveal,
}: Props) {
  const [reason, setReason] = useState<ReasonCategory | ''>('')
  const [reasonDetail, setReasonDetail] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)

  const breakGlass = useBreakGlass(patientDisplayId)

  const canSubmit = reason !== '' && reasonDetail.trim().length >= 10 && !breakGlass.isPending

  function handleClose() {
    if (breakGlass.isPending) return
    onOpenChange(false)
    setReason('')
    setReasonDetail('')
    setSubmitError(null)
    breakGlass.reset()
  }

  async function handleReveal() {
    if (!canSubmit) return
    setSubmitError(null)

    try {
      const chart = await breakGlass.mutateAsync({
        targetBranchId: targetBranchDisplayId,
        reasonCategory: reason as ReasonCategory,
        reasonDetail: reasonDetail.trim(),
      })

      // Sticky non-auto-hide toast — the CBA_ grant id is the audit anchor.
      // duration: 0 means the user must manually dismiss it.
      toast('Cross-branch record revealed', {
        description: `Access logged (${chart.grantId}). This access is permanently audited.`,
        duration: Infinity,
      })

      onReveal(chart)
      onOpenChange(false)
      setReason('')
      setReasonDetail('')
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Break-glass request failed. Please try again.',
      )
    }
  }

  const branchLabel = targetBranchName ?? targetBranchDisplayId

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <ShieldAlert className="h-5 w-5 text-triage-overdue shrink-0" aria-hidden />
            <DialogTitle>Reveal cross-branch record</DialogTitle>
          </div>
          <DialogDescription>
            This patient&apos;s clinical chart at <strong>{branchLabel}</strong> is outside your
            current branch. Accessing it is logged permanently under DPA §19/§20. Select a reason
            and provide details to proceed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Reason category */}
          <div className="space-y-1.5">
            <Label htmlFor="break-glass-reason">
              Access reason <span className="text-destructive">*</span>
            </Label>
            <Select value={reason} onValueChange={(v) => setReason(v as ReasonCategory)}>
              <SelectTrigger id="break-glass-reason">
                <SelectValue placeholder="Select a reason…" />
              </SelectTrigger>
              <SelectContent>
                {REASON_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Free-text detail */}
          <div className="space-y-1.5">
            <Label htmlFor="break-glass-detail">
              Reason details <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="break-glass-detail"
              placeholder="Describe the clinical need (minimum 10 characters)…"
              value={reasonDetail}
              onChange={(e) => setReasonDetail(e.target.value)}
              rows={3}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              {reasonDetail.trim().length < 10
                ? `${Math.max(0, 10 - reasonDetail.trim().length)} more characters required`
                : 'Sufficient detail provided'}
            </p>
          </div>

          {submitError && (
            <p className="text-sm text-destructive rounded bg-destructive/10 px-3 py-2">
              {submitError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={breakGlass.isPending}
          >
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={handleReveal} disabled={!canSubmit}>
            {breakGlass.isPending ? 'Revealing…' : 'Reveal record'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
