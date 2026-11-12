import { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { useRescheduleScheduledOrder, ApiError } from '../api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'

export interface RescheduleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  orderId: string
  orderSummary: {
    patientName: string
    serviceName: string
    doseNumber: number | null
  }
}

export default function RescheduleDialog({
  open,
  onOpenChange,
  orderId,
  orderSummary,
}: RescheduleDialogProps) {
  const [newDate, setNewDate] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const reschedule = useRescheduleScheduledOrder()

  function handleOpenChange(open: boolean) {
    if (!open) {
      setNewDate('')
      setReason('')
      setError(null)
      reschedule.reset()
    }
    onOpenChange(open)
  }

  function handleSubmit() {
    setError(null)
    reschedule.mutate(
      { id: orderId, body: { newDate, reason } },
      {
        onSuccess: () => {
          handleOpenChange(false)
        },
        onError: (err) => {
          if (err instanceof ApiError) {
            setError(err.message)
          } else {
            setError('An unexpected error occurred. Please try again.')
          }
        },
      },
    )
  }

  const canSubmit = newDate.length > 0 && reason.length >= 5 && !reschedule.isPending

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md xl:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reschedule order</DialogTitle>
          <DialogDescription>
            {orderSummary.patientName} · {orderSummary.serviceName}
            {orderSummary.doseNumber !== null && (
              <>
                {' '}
                · Dose <span className="font-mono tabular-nums">#{orderSummary.doseNumber}</span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="new-date">New date</Label>
            <Input
              id="new-date"
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="font-mono tabular-nums"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Textarea
              id="reason"
              placeholder="Reason for rescheduling…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="resize-none"
            />
            {reason.length > 0 && reason.length < 5 && (
              <p className="text-xs text-destructive">Reason must be at least 5 characters.</p>
            )}
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={reschedule.isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {reschedule.isPending ? 'Saving…' : 'Save new date'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
