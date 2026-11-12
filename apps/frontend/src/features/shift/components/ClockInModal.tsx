import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useShift } from '../context'
import { useClockIn } from '../api'
import { useAuth } from '@/features/auth/context'
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'

export default function ClockInModal() {
  const { user } = useAuth()
  const { activeShift, isLoading, isStaff, modalDismissed, setModalDismissed } = useShift()
  const clockIn = useClockIn()

  // Show only for staff roles when: query settled, no active shift, user hasn't dismissed
  const open = isStaff && !isLoading && activeShift === null && !modalDismissed

  async function handleStart() {
    if (!user?.branchId) {
      toast.error('Cannot clock in', { description: 'No branch assigned to your account.' })
      return
    }
    try {
      await clockIn.mutateAsync({ branchId: user.branchId })
      // Modal closes automatically — activeShift becomes non-null after query invalidation
    } catch (err) {
      toast.error('Could not start shift', { description: apiErrorMessage(err) })
    }
  }

  return (
    <Dialog
      open={open}
      // Prevent accidental dismiss via outside click or keyboard
      onOpenChange={() => {}}
    >
      <DialogContent
        // Hide the built-in X close button
        className="[&>button:last-child]:hidden sm:max-w-sm"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Start your shift?</DialogTitle>
          <DialogDescription>
            You haven't clocked in yet today. Record your attendance by starting your shift.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => setModalDismissed(true)}
            disabled={clockIn.isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleStart} disabled={clockIn.isPending}>
            {clockIn.isPending ? 'Starting…' : 'Start shift'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
