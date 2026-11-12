import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CheckCircle2, XCircle } from 'lucide-react'
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'
import { useSafeForm } from '@/lib/useSafeForm'
import { useCompleteEncounter, useCancelEncounter } from '../api'

// Mirrors the transactions void/refund reason gate (VoidDialog.tsx): min 5 /
// max 500 chars, required only for cancellation. Kept local: there is no
// shared reason schema for encounters yet.
const cancelSchema = z.object({
  reason: z
    .string()
    .min(5, 'Reason must be at least 5 characters')
    .max(500, 'Maximum 500 characters'),
})
type CancelFormValues = z.infer<typeof cancelSchema>

type Props = {
  encounterId: string
  /** Called after a successful complete or cancel, so the caller can e.g. close a rail. */
  onClosed?: () => void
}

export default function EncounterStatusActions({ encounterId, onClosed }: Props) {
  const [confirmCompleteOpen, setConfirmCompleteOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)

  const completeEncounter = useCompleteEncounter(encounterId)
  const cancelEncounter = useCancelEncounter(encounterId)

  const form = useSafeForm<CancelFormValues>({
    resolver: zodResolver(cancelSchema),
    defaultValues: { reason: '' },
  })

  useEffect(() => {
    if (cancelOpen) form.reset({ reason: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelOpen])

  async function handleComplete() {
    try {
      await completeEncounter.mutateAsync()
      toast('Encounter completed', { description: encounterId })
      setConfirmCompleteOpen(false)
      onClosed?.()
    } catch (err) {
      toast.error('Failed to complete encounter', { description: apiErrorMessage(err) })
    }
  }

  async function onCancelSubmit(values: CancelFormValues) {
    try {
      await cancelEncounter.mutateAsync({ reason: values.reason })
      toast('Encounter cancelled', { description: encounterId })
      setCancelOpen(false)
      onClosed?.()
    } catch (err) {
      toast.error('Failed to cancel encounter', { description: apiErrorMessage(err) })
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setConfirmCompleteOpen(true)}>
        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        Complete visit
      </Button>
      <Button size="sm" variant="outline" onClick={() => setCancelOpen(true)}>
        <XCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        Cancel visit
      </Button>

      {/* Complete: routine, no reason needed, lightweight confirm. */}
      <AlertDialog open={confirmCompleteOpen} onOpenChange={setConfirmCompleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Complete this visit?</AlertDialogTitle>
            <AlertDialogDescription>
              Marks <span className="font-mono">{encounterId}</span> as Completed. A completed
              encounter cannot be reopened.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={completeEncounter.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={completeEncounter.isPending}
              onClick={(e) => {
                e.preventDefault()
                void handleComplete()
              }}
            >
              {completeEncounter.isPending ? 'Completing…' : 'Complete visit'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel: irreversible, out-of-the-ordinary; typed-reason gate. */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="sm:max-w-md xl:max-w-lg">
          <DialogHeader>
            <DialogTitle>Cancel this visit</DialogTitle>
            <DialogDescription>
              This marks <span className="font-mono">{encounterId}</span> as Cancelled. Cancelled
              encounters cannot be reopened, and this is blocked if a dose has already been
              administered against this visit.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onCancelSubmit)} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="encounter-cancel-reason">
                Reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="encounter-cancel-reason"
                rows={3}
                placeholder="Why is this visit being cancelled?"
                {...form.register('reason')}
              />
              {form.formState.errors.reason && (
                <p className="text-xs text-destructive">{form.formState.errors.reason.message}</p>
              )}
            </div>
            <DialogFooter className="gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCancelOpen(false)}
                disabled={cancelEncounter.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={cancelEncounter.isPending}>
                {cancelEncounter.isPending ? 'Cancelling…' : 'Cancel visit'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
