import { DetailSheet, ErrorBanner } from '@/components/layout'
import { SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'
import { formatDateTime } from '@/lib/format'
import { useInventoryTransfer, useReceiveTransfer, useCancelTransfer } from '../api'
import { useAuth } from '@/features/auth/context'

type Props = {
  id: string | null
}

export function transferActionsForBranch(
  status: string,
  branchCode: string | null | undefined,
  sourceBranchCode: string,
  destinationBranchCode: string,
): { canReceive: boolean; canCancel: boolean } {
  if (status !== 'PendingReceipt' || !branchCode) return { canReceive: false, canCancel: false }
  return {
    canReceive: branchCode === destinationBranchCode,
    canCancel: branchCode === sourceBranchCode,
  }
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'Received') return 'default'
  if (status === 'Cancelled') return 'destructive'
  return 'secondary'
}

export default function TransferDetail({ id }: Props) {
  const { data: transfer, isLoading, isError } = useInventoryTransfer(id)
  const receiveMutation = useReceiveTransfer()
  const cancelMutation = useCancelTransfer()
  const { user } = useAuth()

  if (!id) return null

  if (isLoading) {
    return (
      <DetailSheet>
        <div className="p-6 space-y-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </DetailSheet>
    )
  }

  if (isError || !transfer) {
    return (
      <DetailSheet>
        <ErrorBanner message="Failed to load transfer details." />
      </DetailSheet>
    )
  }

  const actions = transferActionsForBranch(
    transfer.status,
    user?.branchCode,
    transfer.sourceBranchCode,
    transfer.destinationBranchCode,
  )

  function handleReceive() {
    if (!id) return
    receiveMutation.mutate(
      { id, body: {} },
      {
        onSuccess: () => {
          toast('Transfer received — inventory updated at destination.')
        },
        onError: (err) => {
          toast.error('Failed to receive transfer', { description: apiErrorMessage(err) })
        },
      },
    )
  }

  function handleCancel() {
    if (!id) return
    cancelMutation.mutate(
      { id, body: {} },
      {
        onSuccess: () => {
          toast('Transfer cancelled — source inventory restored.')
        },
        onError: (err) => {
          toast.error('Failed to cancel transfer', { description: apiErrorMessage(err) })
        },
      },
    )
  }

  return (
    <DetailSheet>
      <SheetHeader className="px-6 pt-6 pb-4 border-b border-border">
        <SheetTitle className="flex items-center gap-2">
          Transfer Details
          <Badge variant={statusVariant(transfer.status)}>{transfer.status}</Badge>
        </SheetTitle>
      </SheetHeader>

      <div className="p-6 space-y-6 overflow-auto">
        {/* Transfer info */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Transfer
          </h3>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">ID</dt>
            <dd className="font-mono text-xs">{transfer.id}</dd>
            <dt className="text-muted-foreground">Source Branch</dt>
            <dd>{transfer.sourceBranchName ?? transfer.sourceBranchDisplayId}</dd>
            <dt className="text-muted-foreground">Destination Branch</dt>
            <dd>{transfer.destinationBranchName ?? transfer.destinationBranchDisplayId}</dd>
            <dt className="text-muted-foreground">Lot</dt>
            <dd className="font-mono text-xs">
              {transfer.productName ? `${transfer.productName} · ` : ''}
              {transfer.lotBatchNumber ?? transfer.lotDisplayId}
            </dd>
            <dt className="text-muted-foreground">Quantity</dt>
            <dd>{transfer.quantity}</dd>
            {transfer.notes && (
              <>
                <dt className="text-muted-foreground">Notes</dt>
                <dd>{transfer.notes}</dd>
              </>
            )}
          </dl>
        </section>

        {/* Timeline */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Timeline
          </h3>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Shipped</dt>
            <dd>{formatDateTime(transfer.shippedAt)}</dd>
            {transfer.receivedAt && (
              <>
                <dt className="text-muted-foreground">Received</dt>
                <dd>{formatDateTime(transfer.receivedAt)}</dd>
              </>
            )}
            {transfer.cancelledAt && (
              <>
                <dt className="text-muted-foreground">Cancelled</dt>
                <dd>{formatDateTime(transfer.cancelledAt)}</dd>
              </>
            )}
            {transfer.destinationLotDisplayId && (
              <>
                <dt className="text-muted-foreground">Dest. Lot</dt>
                <dd className="font-mono text-xs">{transfer.destinationLotDisplayId}</dd>
              </>
            )}
          </dl>
        </section>

        {/* Actions — only for PendingReceipt */}
        {(actions.canReceive || actions.canCancel) && (
          <div className="flex gap-2 pt-2">
            {actions.canReceive && (
              <Button
                size="sm"
                onClick={handleReceive}
                disabled={receiveMutation.isPending || cancelMutation.isPending}
              >
                {receiveMutation.isPending ? 'Receiving…' : 'Confirm Receipt'}
              </Button>
            )}
            {actions.canCancel && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleCancel}
                disabled={receiveMutation.isPending || cancelMutation.isPending}
              >
                {cancelMutation.isPending ? 'Cancelling…' : 'Cancel Transfer'}
              </Button>
            )}
          </div>
        )}
      </div>
    </DetailSheet>
  )
}
