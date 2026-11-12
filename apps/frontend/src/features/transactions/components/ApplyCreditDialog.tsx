import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'
import { formatMoney } from '@/lib/format'
import { toCents, fromCents } from '@/lib/money'
import { useApplyCredit, usePatientCredit } from '../api'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The bill this credit draw settles (or partially settles). */
  transactionId: string
  /** The patient whose credit is being drawn (never a name match). */
  patientId: string
  /** This bill's current balance due (numeric(12,2) string). */
  outstanding: string
}

export default function ApplyCreditDialog({
  open,
  onOpenChange,
  transactionId,
  patientId,
  outstanding,
}: Props) {
  const apply = useApplyCredit()
  const credit = usePatientCredit(open ? patientId : null)

  const availableCents = toCents(credit.data?.available)
  const outstandingCents = toCents(outstanding)
  const maxCents = Math.max(0, Math.min(availableCents, outstandingCents))
  const maxAmount = fromCents(maxCents)

  const [amount, setAmount] = useState(maxAmount)

  // Reset to the full drawable amount whenever the dialog opens or the
  // available-credit / outstanding figures resolve from the server.
  useEffect(() => {
    if (open) setAmount(maxAmount)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, availableCents, outstandingCents])

  const isLoading = credit.isLoading
  const amountCents = toCents(amount || '0')
  const amountInvalid = amountCents <= 0 || amountCents > maxCents

  // Oldest-first deposits with remaining balance: mirrors the server's FIFO
  // draw order so the cashier can see which deposits fund this application.
  const orderedDeposits = useMemo(() => {
    const deposits = credit.data?.deposits ?? []
    return [...deposits]
      .filter((d) => toCents(d.remaining) > 0)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }, [credit.data])

  const allocationPreview = useMemo(() => {
    let left = amountCents
    const rows: { id: string; draw: number }[] = []
    for (const d of orderedDeposits) {
      if (left <= 0) break
      const draw = Math.min(toCents(d.remaining), left)
      if (draw > 0) rows.push({ id: d.id, draw })
      left -= draw
    }
    return rows
  }, [orderedDeposits, amountCents])

  async function handleApply() {
    if (amountInvalid) return
    try {
      const res = await apply.mutateAsync({
        patientId,
        transactionId,
        amount: fromCents(amountCents),
      })
      toast('Patient credit applied', {
        description: `Drew ${formatMoney(res.appliedAmount)} · ${formatMoney(
          res.availableCreditAfter,
        )} credit left`,
      })
      onOpenChange(false)
    } catch (err) {
      toast.error('Failed to apply patient credit', { description: apiErrorMessage(err) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md xl:max-w-lg">
        <DialogHeader>
          <DialogTitle>Apply patient credit</DialogTitle>
          <DialogDescription>
            Draw this patient&apos;s prepaid credit against bill{' '}
            <span className="font-mono">{transactionId}</span>. The bill is settled in full, or
            partially if the applied amount is smaller.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm">
            <span className="text-muted-foreground">Available credit</span>
            {isLoading ? (
              <Skeleton className="h-4 w-16" />
            ) : (
              <span className="font-mono tabular-nums font-medium">
                {formatMoney(credit.data?.available)}
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="apply-credit-amount">
                Amount to apply <span className="text-destructive">*</span>
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setAmount(maxAmount)}
                disabled={isLoading || maxCents <= 0}
              >
                Use full amount ({formatMoney(maxAmount)})
              </Button>
            </div>
            <Input
              id="apply-credit-amount"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              disabled={isLoading}
            />
            {amountInvalid && (
              <p className="text-xs text-destructive">
                Enter an amount between ₱0.01 and {formatMoney(maxAmount)}.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Deposits drawn (oldest first)</Label>
            {isLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : allocationPreview.length === 0 ? (
              <p className="text-xs text-muted-foreground">No credit available to draw.</p>
            ) : (
              <div className="rounded-md border border-border divide-y divide-border">
                {allocationPreview.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between px-3 py-1.5 text-xs"
                  >
                    <span className="font-mono">{row.id}</span>
                    <span className="font-mono tabular-nums">
                      {formatMoney(fromCents(row.draw))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter className="gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={apply.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleApply}
            disabled={amountInvalid || apply.isPending || isLoading}
          >
            {apply.isPending ? 'Applying…' : 'Apply credit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
