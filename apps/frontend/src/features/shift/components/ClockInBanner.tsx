import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useShift } from '../context'
import { useClockIn } from '../api'
import { useAuth } from '@/features/auth/context'
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'

export default function ClockInBanner() {
  const { user } = useAuth()
  const { activeShift, isLoading, isStaff, modalDismissed } = useShift()
  const clockIn = useClockIn()

  // Shown only for staff roles after the modal was dismissed and shift still hasn't started
  const show = isStaff && !isLoading && activeShift === null && modalDismissed

  if (!show) return null

  async function handleClockIn() {
    if (!user?.branchId) {
      toast.error('Cannot clock in', { description: 'No branch assigned to your account.' })
      return
    }
    try {
      await clockIn.mutateAsync({ branchId: user.branchId })
    } catch (err) {
      toast.error('Could not clock in', { description: apiErrorMessage(err) })
    }
  }

  return (
    <div
      role="alert"
      className="flex items-center gap-3 px-4 py-2 bg-yellow-50 border-b border-yellow-200 text-yellow-800 text-sm shrink-0 print:hidden"
    >
      <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
      <span className="flex-1">You haven't clocked in yet today.</span>
      <Button
        size="sm"
        variant="outline"
        className="border-yellow-400 text-yellow-800 hover:bg-yellow-100 h-7 text-xs"
        onClick={handleClockIn}
        disabled={clockIn.isPending}
      >
        {clockIn.isPending ? 'Clocking in…' : 'Clock In'}
      </Button>
    </div>
  )
}
