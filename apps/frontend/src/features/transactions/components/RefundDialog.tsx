import { useEffect, useState } from 'react'

import { Link } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { zodResolver } from '@hookform/resolvers/zod'
import { transactionReasonSchema, type TransactionReasonInput } from '@surevax/shared'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'
import { useRefundTransaction, ApiError } from '../api'
import { useSafeForm } from '@/lib/useSafeForm'
import { useAuth } from '@/features/auth/context'

// Schema sourced from @surevax/shared, single source of truth.
const schema = transactionReasonSchema
type FormValues = TransactionReasonInput

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  transactionId: string
}

export default function RefundDialog({ open, onOpenChange, transactionId }: Props) {
  const refund = useRefundTransaction()
  const { user } = useAuth()
  const canOpenApprovals = user?.role === 'BranchAdmin' || user?.role === 'TenantAdmin'
  const [gateMessage, setGateMessage] = useState<string | null>(null)
  const form = useSafeForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { reason: '' },
  })

  useEffect(() => {
    if (open) {
      form.reset({ reason: '' })
      setGateMessage(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function onSubmit(values: FormValues) {
    setGateMessage(null)
    try {
      await refund.mutateAsync({ transactionId, reason: values.reason })
      toast('Refund recorded', { description: transactionId })
      onOpenChange(false)
    } catch (err) {
      // Money-control gate (docs/ai-context/06-PRODUCT-WORKFLOWS.md:262): a
      // refund over PHP 1,000 needs manager approval, over PHP 5,000 needs
      // admin approval. The APPROVAL_REQUIRED message names the filed request
      // and who must clear it, shown inline so this reads as "waiting on
      // someone", not "broken".
      if (err instanceof ApiError && err.code === 'APPROVAL_REQUIRED') {
        setGateMessage(err.message)
        return
      }
      toast.error('Failed to refund', { description: apiErrorMessage(err) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md xl:max-w-lg">
        <DialogHeader>
          <DialogTitle>Refund transaction</DialogTitle>
          <DialogDescription>
            Marks <span className="font-mono">{transactionId}</span> as Refunded. The original
            payments stay on the record as an audit trail. Inventory is not adjusted automatically.
            A refund of more than PHP 1,000 requires manager approval; more than PHP 5,000 requires
            admin approval.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          {gateMessage && (
            <Alert>
              <ShieldAlert className="h-4 w-4" aria-hidden />
              <AlertTitle>Waiting on approval</AlertTitle>
              <AlertDescription>
                {gateMessage}{' '}
                {canOpenApprovals ? (
                  <Link to="/admin/approvals" className="underline">
                    Open Approvals
                  </Link>
                ) : (
                  'Ask a Branch Admin or Tenant Admin to open Approvals'
                )}
                . Retry this once it is approved.
              </AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="reason">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="reason"
              rows={3}
              placeholder="Why is this being refunded?"
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
              onClick={() => onOpenChange(false)}
              disabled={refund.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={refund.isPending}>
              {refund.isPending ? 'Refunding…' : 'Refund'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
