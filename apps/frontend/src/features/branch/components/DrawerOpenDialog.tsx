import { useState } from 'react'
import { formatMoney } from '@/lib/format'
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
import { useOpenDrawer } from '../api'

interface DrawerOpenDialogProps {
  onSuccess?: () => void
}

interface DrawerOpenDialogControlledProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSuccess?: () => void
}

const FLOAT_REGEX = /^\d+(\.\d{1,2})?$/

export function DrawerOpenDialog({ onSuccess }: DrawerOpenDialogProps) {
  const [open, setOpen] = useState(false)
  const [openingFloat, setOpeningFloat] = useState('')
  const openDrawer = useOpenDrawer()

  const isValid = FLOAT_REGEX.test(openingFloat) && parseFloat(openingFloat) >= 0

  async function handleConfirm(e: React.MouseEvent) {
    e.preventDefault()
    if (!isValid) return

    try {
      await openDrawer.mutateAsync({ openingFloat })
      toast('Drawer opened', { description: `Opening float: ${formatMoney(openingFloat)}` })
      setOpeningFloat('')
      setOpen(false)
      onSuccess?.()
    } catch (err) {
      toast.error('Could not open drawer', { description: apiErrorMessage(err) })
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button size="sm">Open drawer</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Open cash drawer</AlertDialogTitle>
          <AlertDialogDescription>
            Enter the opening float — the cash placed in the drawer at the start of this session.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-2 py-2">
          <Label htmlFor="opening-float">Opening Float (PHP)</Label>
          <Input
            id="opening-float"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={openingFloat}
            onChange={(e) => setOpeningFloat(e.target.value)}
            autoFocus
          />
          {openingFloat && !isValid && (
            <p className="text-xs text-destructive">Enter a valid amount (e.g. 1000.00)</p>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setOpeningFloat('')}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={!isValid || openDrawer.isPending}>
            {openDrawer.isPending ? 'Opening…' : 'Open drawer'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * Controlled variant — open state driven by the parent.
 * Used by BranchDayOpenPrompt to open the dialog programmatically after the day-open confirmation.
 */
export function DrawerOpenDialogControlled({
  open,
  onOpenChange,
  onSuccess,
}: DrawerOpenDialogControlledProps) {
  const [openingFloat, setOpeningFloat] = useState('')
  const openDrawer = useOpenDrawer()

  const isValid = FLOAT_REGEX.test(openingFloat) && parseFloat(openingFloat) >= 0

  async function handleConfirm(e: React.MouseEvent) {
    e.preventDefault()
    if (!isValid) return

    try {
      await openDrawer.mutateAsync({ openingFloat })
      toast('Drawer opened', { description: `Opening float: ${formatMoney(openingFloat)}` })
      setOpeningFloat('')
      onOpenChange(false)
      onSuccess?.()
    } catch (err) {
      toast.error('Could not open drawer', { description: apiErrorMessage(err) })
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Open cash drawer</AlertDialogTitle>
          <AlertDialogDescription>
            Enter the opening float — the cash placed in the drawer at the start of this session.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-2 py-2">
          <Label htmlFor="opening-float-controlled">Opening Float (PHP)</Label>
          <Input
            id="opening-float-controlled"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={openingFloat}
            onChange={(e) => setOpeningFloat(e.target.value)}
            autoFocus
          />
          {openingFloat && !isValid && (
            <p className="text-xs text-destructive">Enter a valid amount (e.g. 1000.00)</p>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={() => {
              setOpeningFloat('')
              onOpenChange(false)
            }}
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={!isValid || openDrawer.isPending}>
            {openDrawer.isPending ? 'Opening…' : 'Open drawer'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
