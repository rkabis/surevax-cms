import { useEffect, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useAuth } from '@/features/auth/context'
import { useCurrentDrawer } from '../api'
import { formatLongDate, formatMoney } from '@/lib/format'
import { DrawerOpenDialogControlled } from './DrawerOpenDialog'
import { useLooseEnds, type LooseEnds } from '@/features/day-summary/api'
import { manilaCalendarDate } from '@/lib/clinicDate'

/** Renders a compact list of prior-day loose ends inside the opening AlertDialog. */
function LooseEndsBanner({ looseEnds }: { looseEnds: LooseEnds | undefined }) {
  if (!looseEnds) return null

  const { unsettledTransactions, openPriorDrawers, undocumentedAdministrations } = looseEnds
  const hasAny =
    unsettledTransactions.count > 0 ||
    openPriorDrawers.count > 0 ||
    undocumentedAdministrations.count > 0

  if (!hasAny) return null

  return (
    <div className="bg-muted rounded-md px-3 py-2 text-xs space-y-1">
      <p className="font-medium text-foreground">Prior-day items to resolve:</p>
      {unsettledTransactions.count > 0 && (
        <p className="text-muted-foreground">
          {unsettledTransactions.count} unsettled transaction
          {unsettledTransactions.count !== 1 ? 's' : ''} —{' '}
          {formatMoney(unsettledTransactions.totalOutstanding)} outstanding
        </p>
      )}
      {openPriorDrawers.count > 0 && (
        <p className="text-muted-foreground">
          {openPriorDrawers.count} drawer
          {openPriorDrawers.count !== 1 ? 's' : ''} still open from prior day
          {openPriorDrawers.count !== 1 ? 's' : ''}
        </p>
      )}
      {undocumentedAdministrations.count > 0 && (
        <p className="text-muted-foreground">
          {undocumentedAdministrations.count} administration
          {undocumentedAdministrations.count !== 1 ? 's' : ''} undocumented
        </p>
      )}
    </div>
  )
}

/** sessionStorage key — set on dismiss so the prompt only shows once per calendar day per session */
function sessionKey() {
  const d = manilaCalendarDate()
  return `branch.dayOpenAcknowledged.${d}`
}

/**
 * Auto-opening AlertDialog shown once per Manila day when a Branch session has no open drawer.
 * "Open clinic" leads the user to the existing DrawerOpenDialog.
 * Only visible to Branch role sessions.
 */
export function BranchDayOpenPrompt() {
  const { user } = useAuth()
  // Gate on role — non-Branch users would 404-spam `/api/cash-drawer/current`
  // (regression PR #329 fixed once already).
  const isBranch = user?.role === 'Branch'
  const { data: drawer, isLoading: drawerLoading } = useCurrentDrawer({ enabled: isBranch })
  const [open, setOpen] = useState(false)
  const [drawerDialogOpen, setDrawerDialogOpen] = useState(false)

  const today = formatLongDate(new Date())
  const todayIso = manilaCalendarDate()
  const { data: looseEnds } = useLooseEnds(todayIso, user?.role === 'Branch')

  // Any Open branch drawer blocks a new one. A prior-day session is a
  // reconciliation item, not permission to open a second physical drawer.
  const drawerIsOpen = drawer?.state === 'Open'

  useEffect(() => {
    if (user?.role !== 'Branch') return
    if (drawerLoading) return
    // Already have an open drawer — the kiosk card owns reconciliation.
    if (drawerIsOpen) return
    // Already acknowledged this session+day
    if (sessionStorage.getItem(sessionKey())) return

    setOpen(true)
  }, [user?.role, drawerLoading, drawerIsOpen])

  // Auto-dismiss when a drawer opens externally (e.g. from the side-card
  // "Declare opening float" path, not via this prompt's "Open clinic" CTA).
  // Without this, the AlertDialog stays as a layered overlay over the
  // newly-open drawer state (UI audit ship-blocker §13).
  useEffect(() => {
    if (drawerIsOpen && open) dismiss()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerIsOpen])

  function dismiss() {
    try {
      sessionStorage.setItem(sessionKey(), '1')
    } catch {
      // sessionStorage unavailable; ignore
    }
    setOpen(false)
  }

  function handleOpenClinic() {
    dismiss()
    setDrawerDialogOpen(true)
  }

  if (user?.role !== 'Branch') return null

  return (
    <>
      <AlertDialog open={open} onOpenChange={(v) => !v && dismiss()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Opening clinic for {today}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2">
                <p>No cash drawer has been opened for today yet.</p>
                <LooseEndsBanner looseEnds={looseEnds} />
                <p className="text-muted-foreground text-xs">
                  Open the drawer to begin accepting payments for the day.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={dismiss}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleOpenClinic}>
              Open clinic for {today}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Controlled variant of DrawerOpenDialog — opens programmatically after prompt confirms */}
      <DrawerOpenDialogControlled open={drawerDialogOpen} onOpenChange={setDrawerDialogOpen} />
    </>
  )
}
