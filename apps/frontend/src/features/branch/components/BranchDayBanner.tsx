import { CalendarCheck } from 'lucide-react'
import { useAuth } from '@/features/auth/context'
import { useCurrentDrawer } from '../api'
import { formatLongDate, formatTime } from '@/lib/format'
import { manilaCalendarDate } from '@/lib/clinicDate'

/**
 * Shown at the top of every page when the logged-in user is a Branch session.
 * Informational only — no interactive actions.
 */
export function BranchDayBanner() {
  const { user } = useAuth()
  // Gate the drawer fetch on role — non-Branch users would 404-spam
  // `/api/cash-drawer/current` (regression PR #329 fixed once already).
  const isBranch = user?.role === 'Branch'
  const { data: drawer } = useCurrentDrawer({ enabled: isBranch })

  if (!isBranch) return null

  const today = manilaCalendarDate()
  const openSince = drawer?.openedAt ? formatTime(drawer.openedAt) : null

  return (
    <div className="bg-primary/5 border-b border-primary/20 px-6 py-1.5 text-xs flex items-center gap-2 shrink-0 print:hidden">
      <CalendarCheck className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden />
      <span className="text-foreground/80">
        <span className="font-medium">Clinic day</span>
        {user.firstName ? ` · ${user.firstName} ${user.lastName}`.trim() : ''}
        {' · '}
        {formatLongDate(today)}
        {openSince ? ` · open since ${openSince}` : ' · no drawer open'}
      </span>
    </div>
  )
}
