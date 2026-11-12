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
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'
import { formatMoney } from '@/lib/format'
import { useCloseDrawer, type DrawerSession } from '../api'

interface DrawerCloseDialogProps {
  session: DrawerSession
  onSuccess?: () => void
  /** Controlled open state. When provided, the dialog is externally controlled. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /**
   * Trigger element. Defaults to the kiosk "Close drawer" button. Pass `false`
   * to render no trigger (for external/controlled opening, e.g. a menu item).
   */
  trigger?: React.ReactNode | false
}

const FLOAT_REGEX = /^\d+(\.\d{1,2})?$/

export function DrawerCloseDialog({
  session,
  onSuccess,
  open: openProp,
  onOpenChange,
  trigger,
}: DrawerCloseDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : internalOpen
  const setOpen = (next: boolean) => {
    if (isControlled) onOpenChange?.(next)
    else setInternalOpen(next)
  }
  const [closingTotal, setClosingTotal] = useState('')
  const closeDrawer = useCloseDrawer()

  const isValid = FLOAT_REGEX.test(closingTotal) && parseFloat(closingTotal) >= 0

  // Expected total displayed from the server-computed value on the session,
  // or a client-side estimate of float only if server hasn't computed yet.
  const expectedDisplay = session.expectedTotal
    ? formatMoney(session.expectedTotal)
    : formatMoney(session.openingFloat)

  async function handleConfirm(e: React.MouseEvent) {
    e.preventDefault()
    if (!isValid) return

    try {
      await closeDrawer.mutateAsync({ sessionId: session.id, closingTotalDeclared: closingTotal })
      toast('Drawer closed', { description: 'Session has been recorded.' })
      setClosingTotal('')
      setOpen(false)
      onSuccess?.()
    } catch (err) {
      toast.error('Could not close drawer', { description: apiErrorMessage(err) })
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {trigger !== false && (
        <AlertDialogTrigger asChild>
          {trigger ?? (
            <Button
              size="sm"
              variant="outline"
              className="border-zinc-600 bg-transparent text-zinc-50 hover:bg-zinc-700 hover:text-zinc-50"
            >
              Close drawer
            </Button>
          )}
        </AlertDialogTrigger>
      )}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Close cash drawer</AlertDialogTitle>
          <AlertDialogDescription>
            Count the cash in the drawer and enter the total. The system will compute the variance.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-3 py-2">
          <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
            <span className="text-muted-foreground">Expected total</span>
            <span className="font-mono font-semibold">{expectedDisplay}</span>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="closing-total">Counted Total (PHP)</Label>
            <Input
              id="closing-total"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={closingTotal}
              onChange={(e) => setClosingTotal(e.target.value)}
              autoFocus
            />
            {closingTotal && !isValid && (
              <p className="text-xs text-destructive">Enter a valid amount (e.g. 1500.00)</p>
            )}
          </div>

          {isValid && session.expectedTotal && (
            <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm">
              <span className="text-muted-foreground">Variance</span>
              <span
                className={`font-mono font-semibold ${
                  parseFloat(closingTotal) - parseFloat(session.expectedTotal) < 0
                    ? 'text-destructive'
                    : 'text-green-600'
                }`}
              >
                {formatMoney(
                  (parseFloat(closingTotal) - parseFloat(session.expectedTotal)).toFixed(2),
                )}
              </span>
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setClosingTotal('')}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={!isValid || closeDrawer.isPending}>
            {closeDrawer.isPending ? 'Closing…' : 'Close drawer'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
