import React from 'react'
import {
  AlertCircle,
  Download,
  File,
  FileImage,
  FileText,
  Loader2,
  Paperclip as PaperclipIcon,
  Trash2,
} from 'lucide-react'
import { useAttachmentList, useDeleteAttachment } from '@/hooks/useAttachments'
import { apiErrorMessage } from '@/lib/apiErrors'
import { formatDateTime } from '@/lib/format'
import { formatBytes } from '@/lib/formatBytes'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type Props = {
  ownerType: string
  ownerId: string
}

function fileIcon(contentType: string) {
  if (contentType.startsWith('image/')) return FileImage
  if (contentType === 'application/pdf') return FileText
  if (
    contentType.startsWith('application/vnd.openxmlformats-officedocument.') ||
    contentType.startsWith('application/msword') ||
    contentType.startsWith('application/vnd.ms-')
  ) {
    return FileText
  }
  return File
}

function DeleteButton({
  id,
  fileName,
  ownerType,
  ownerId,
}: {
  id: string
  fileName: string
  ownerType: string
  ownerId: string
}) {
  const del = useDeleteAttachment()
  const [open, setOpen] = React.useState(false)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      // Clear any prior failed-attempt state so a stale error message
      // doesn't reappear next time the dialog opens.
      del.reset()
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete ${fileName}`}
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete attachment?</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-mono text-xs break-all">{fileName}</span> will be permanently
            removed. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {del.isError && (
          <p className="text-sm text-destructive flex items-center gap-1" role="alert">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
            {apiErrorMessage(del.error, 'Failed to delete. Please try again.')}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={del.isPending}
            onClick={(e) => {
              // Keep the dialog open until we know the outcome: the Radix
              // AlertDialog.Action closes on click by default, which would
              // otherwise dismiss the dialog before a failure could be shown.
              e.preventDefault()
              del.mutate(
                { id, ownerType, ownerId },
                {
                  onSuccess: () => setOpen(false),
                  onError: (err) => {
                    toast.error('Failed to delete attachment', {
                      description: `Could not remove "${fileName}": ${apiErrorMessage(err)}`,
                    })
                  },
                },
              )
            }}
          >
            {del.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Deleting…
              </>
            ) : (
              'Delete'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function AttachmentRow({
  id,
  fileName,
  contentType,
  sizeBytes,
  uploadedAt,
  ownerType,
  ownerId,
}: {
  id: string
  fileName: string
  contentType: string
  sizeBytes: number
  uploadedAt: string
  ownerType: string
  ownerId: string
}) {
  const Icon = fileIcon(contentType)
  return (
    <div className="flex items-center gap-3 rounded-md border bg-muted/20 px-3 py-2">
      <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{fileName}</p>
        <p className="text-xs text-muted-foreground">
          {formatBytes(sizeBytes)} &middot; {formatDateTime(uploadedAt)}
        </p>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} aria-label="Download (coming soon)">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" disabled>
              <Download className="h-4 w-4" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Coming soon</TooltipContent>
      </Tooltip>
      <DeleteButton id={id} fileName={fileName} ownerType={ownerType} ownerId={ownerId} />
    </div>
  )
}

export function AttachmentList({ ownerType, ownerId }: Props) {
  const { data, isLoading, isError } = useAttachmentList(ownerType, ownerId)

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-md" />
        ))}
      </div>
    )
  }

  if (isError) {
    return <p className="text-sm text-destructive">Failed to load attachments.</p>
  }

  const items = data?.data ?? []

  if (items.length === 0) {
    return (
      <div className="px-6 py-12 text-center">
        <PaperclipIcon className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No attachments yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {items.map((att) => (
        <AttachmentRow
          key={att.id}
          id={att.id}
          fileName={att.fileName}
          contentType={att.contentType}
          sizeBytes={att.sizeBytes}
          uploadedAt={att.uploadedAt}
          ownerType={ownerType}
          ownerId={ownerId}
        />
      ))}
    </div>
  )
}
