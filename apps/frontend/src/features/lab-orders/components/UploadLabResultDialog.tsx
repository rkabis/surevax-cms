import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { ErrorBanner } from '@/components/layout'
import { AttachmentDropzone } from '@/components/ui/attachment-dropzone'
import { type Attachment } from '@/hooks/useAttachments'
import { useSubmitLabResult } from '../api'

type Props = {
  orderId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UploadLabResultDialog({ orderId, open, onOpenChange }: Props) {
  const [apiError, setApiError] = useState<string | null>(null)
  const submitResult = useSubmitLabResult(orderId)

  function handleOpenChange(next: boolean) {
    if (!next) setApiError(null)
    onOpenChange(next)
  }

  async function handleUploaded(attachment: Attachment) {
    setApiError(null)
    try {
      await submitResult.mutateAsync({ resultFileAttachmentId: attachment.id })
      toast('Result uploaded.')
      handleOpenChange(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to record result file.'
      setApiError(message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload result PDF</DialogTitle>
          <DialogDescription>
            Drop a PDF or scanned image of the lab result. Max 50 MB.
          </DialogDescription>
        </DialogHeader>

        <AttachmentDropzone
          ownerType="lab_order"
          ownerId={orderId}
          category="lab_result"
          onUploaded={(attachment) => void handleUploaded(attachment)}
        />

        {apiError && <ErrorBanner message={apiError} />}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
