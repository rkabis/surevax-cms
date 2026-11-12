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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'
import { formatMoney } from '@/lib/format'
import { useRecordDeposit } from '../api'

const FLOAT_REGEX = /^\d+(\.\d{1,2})?$/

/**
 * Records a physical cash-out-to-the-bank deposit against the branch's
 * currently-open drawer session. The counterpart to DrawerOpenDialog /
 * DrawerCloseDialog in this same folder, styled the same way for consistency.
 */
export function RecordDepositDialog() {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [depositSlipNumber, setDepositSlipNumber] = useState('')
  const [notes, setNotes] = useState('')
  const recordDeposit = useRecordDeposit()

  const isValid = FLOAT_REGEX.test(amount) && parseFloat(amount) > 0

  function reset() {
    setAmount('')
    setDepositSlipNumber('')
    setNotes('')
  }

  async function handleConfirm(e: React.MouseEvent) {
    e.preventDefault()
    if (!isValid) return

    try {
      await recordDeposit.mutateAsync({
        amount,
        depositSlipNumber: depositSlipNumber.trim() || undefined,
        notes: notes.trim() || undefined,
      })
      toast('Deposit recorded', { description: `${formatMoney(amount)} taken to the bank.` })
      reset()
      setOpen(false)
    } catch (err) {
      toast.error('Could not record deposit', { description: apiErrorMessage(err) })
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="border-zinc-600 bg-transparent text-zinc-50 hover:bg-zinc-700 hover:text-zinc-50"
        >
          Record deposit
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Record bank deposit</AlertDialogTitle>
          <AlertDialogDescription>
            Cash physically taken from this drawer to the bank. On-hand cash drops by this amount
            right away.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-3 py-2">
          <div className="grid gap-2">
            <Label htmlFor="deposit-amount">
              Amount (PHP) <span className="text-destructive">*</span>
            </Label>
            <Input
              id="deposit-amount"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
            {amount && !isValid && (
              <p className="text-xs text-destructive">Enter a valid amount (e.g. 5000.00)</p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="deposit-slip">Deposit slip number</Label>
            <Input
              id="deposit-slip"
              type="text"
              placeholder="Bank reference (optional)"
              value={depositSlipNumber}
              onChange={(e) => setDepositSlipNumber(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="deposit-notes">Notes</Label>
            <Textarea
              id="deposit-notes"
              placeholder="Optional"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={reset}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={!isValid || recordDeposit.isPending}>
            {recordDeposit.isPending ? 'Recording…' : 'Record deposit'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
