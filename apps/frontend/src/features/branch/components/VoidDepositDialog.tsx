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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'
import { formatMoney } from '@/lib/format'
import { useVoidDeposit, type CashDeposit } from '../api'

/**
 * Voids a recorded deposit. Corrections are inline + warned + logged, not an
 * approval queue: the reason is required (typed, min 3 chars) and the row is
 * never deleted, only marked voided (see cash_drawer/db.ts voidDeposit).
 */
export function VoidDepositDialog({ deposit }: { deposit: CashDeposit }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const voidDeposit = useVoidDeposit()

  const isValid = reason.trim().length >= 3

  async function handleConfirm(e: React.MouseEvent) {
    e.preventDefault()
    if (!isValid) return

    try {
      await voidDeposit.mutateAsync({ depositId: deposit.id, reason: reason.trim() })
      toast('Deposit voided', {
        description: `${formatMoney(deposit.amount)} restored to on-hand cash.`,
      })
      setReason('')
      setOpen(false)
    } catch (err) {
      toast.error('Could not void deposit', { description: apiErrorMessage(err) })
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-auto px-1.5 py-0.5 text-xs text-zinc-400 hover:text-zinc-50"
        >
          Void
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Void deposit</AlertDialogTitle>
          <AlertDialogDescription>
            {formatMoney(deposit.amount)} recorded{' '}
            {deposit.depositSlipNumber ? `(slip ${deposit.depositSlipNumber}) ` : ''}will be
            reversed and the amount added back to on-hand cash. This is logged and cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-2 py-2">
          <Label htmlFor="void-reason">
            Reason <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="void-reason"
            placeholder="Why is this deposit being voided?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            autoFocus
          />
          {reason && !isValid && (
            <p className="text-xs text-destructive">Enter at least 3 characters</p>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setReason('')}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={!isValid || voidDeposit.isPending}>
            {voidDeposit.isPending ? 'Voiding…' : 'Void deposit'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
