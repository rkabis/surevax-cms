import { useState } from 'react'
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
import { ErrorBanner } from '@/components/layout'
import { useMarkLabSent } from '../api'

type Props = {
  orderId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MarkLabSentDialog({ orderId, open, onOpenChange }: Props) {
  const [apiError, setApiError] = useState<string | null>(null)
  const markSent = useMarkLabSent(orderId)

  async function handleConfirm() {
    setApiError(null)
    try {
      await markSent.mutateAsync()
      toast('Lab order marked Sent.')
      onOpenChange(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to mark lab order as sent.'
      setApiError(message)
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) setApiError(null)
    onOpenChange(next)
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Mark lab order as sent?</AlertDialogTitle>
          <AlertDialogDescription>
            This lab order ({orderId}) will be marked Sent to the lab. Sent timestamp will be
            recorded.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {apiError && <ErrorBanner message={apiError} />}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={markSent.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={markSent.isPending}
            onClick={(e) => {
              e.preventDefault()
              void handleConfirm()
            }}
          >
            {markSent.isPending ? 'Marking…' : 'Mark sent'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
