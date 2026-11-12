import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'
import { formatLongDate, formatMoney } from '@/lib/format'
import { useBranchStaff, useCurrentDrawer } from '../api'
import type { BranchStaffRow } from '../api'
import { useClockIn, useClockOut } from '@/features/shift/api'
import { humanizeRole } from '@/lib/status'
import { apiErrorMessage } from '@/lib/apiErrors'
import { manilaCalendarDate } from '@/lib/clinicDate'
import { DrawerOpenDialog } from './DrawerOpenDialog'
import { DrawerCloseDialog } from './DrawerCloseDialog'
import { BranchDayOpenPrompt } from './BranchDayOpenPrompt'
import { PinEntryDialog } from './PinEntryDialog'
import { RecordDepositDialog } from './RecordDepositDialog'
import { VoidDepositDialog } from './VoidDepositDialog'
import { useAuth } from '@/features/auth/context'
import { CASH_DRAWER_ROLES, hasRole } from '@/lib/roles'

type PinDialogState = {
  userId: string
  userName: string
  action: 'clock-in' | 'clock-out'
}

function fullName(u: BranchStaffRow) {
  return `${u.firstName} ${u.lastName}`.trim()
}

function formatClockIn(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export default function BranchKiosk() {
  const { user } = useAuth()
  const canOperateDrawer = hasRole(user, CASH_DRAWER_ROLES)
  const { data, isLoading } = useBranchStaff()
  const {
    data: drawerSession,
    isLoading: drawerLoading,
    error: drawerError,
  } = useCurrentDrawer({ enabled: canOperateDrawer })
  const clockIn = useClockIn()
  const clockOut = useClockOut()
  const [pinDialog, setPinDialog] = useState<PinDialogState | null>(null)

  // Cross-midnight detection: poll every 60s and toast once if date has rolled
  const midnightToastFired = useRef(false)
  useEffect(() => {
    const check = () => {
      if (midnightToastFired.current) return
      const drawerDate = drawerSession?.openedAt
        ? manilaCalendarDate(new Date(drawerSession.openedAt))
        : undefined
      const currentDate = manilaCalendarDate()
      if (drawerDate && currentDate > drawerDate) {
        midnightToastFired.current = true
        toast(
          `Date is now ${formatLongDate(currentDate)} — close out ${formatLongDate(drawerDate)} when you're ready.`,
        )
      }
    }
    check()
    const id = setInterval(check, 60_000)
    return () => clearInterval(id)
  }, [drawerSession?.openedAt])

  // 404 = no open session (normal state), not a real error
  const noOpenDrawer =
    !drawerLoading &&
    (!drawerSession ||
      (drawerError &&
        typeof drawerError === 'object' &&
        'statusCode' in drawerError &&
        (drawerError as { statusCode: number }).statusCode === 404))

  const { activeStaff, availableStaff } = useMemo(() => {
    const rows = data?.data ?? []
    return {
      activeStaff: rows.filter((r) => r.activeShift),
      availableStaff: rows.filter((r) => !r.activeShift),
    }
  }, [data])

  function openPinForClockIn(u: BranchStaffRow) {
    setPinDialog({ userId: u.id, userName: fullName(u), action: 'clock-in' })
  }

  function openPinForClockOut(u: BranchStaffRow) {
    setPinDialog({ userId: u.id, userName: fullName(u), action: 'clock-out' })
  }

  async function onPinVerified() {
    if (!pinDialog) return
    const { userId, userName, action } = pinDialog
    try {
      if (action === 'clock-in') {
        await clockIn.mutateAsync({ userId })
        toast('Clocked in', { description: `${userName} started their shift.` })
      } else {
        const result = await clockOut.mutateAsync({ userId })
        const hours = result.data?.totalHours ? Number(result.data.totalHours) : null
        toast('Clocked out', {
          description:
            hours !== null && Number.isFinite(hours)
              ? `${userName} ended their shift — ${hours.toFixed(2)} hours worked.`
              : `${userName} ended their shift.`,
        })
      }
    } catch (err) {
      toast.error(`Could not ${action === 'clock-in' ? 'clock in' : 'clock out'}`, {
        description: apiErrorMessage(err),
      })
    }
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-50 p-8 gap-6">
      {/* Day-open prompt — never offers a second drawer while any branch drawer is Open. */}
      <BranchDayOpenPrompt />

      {/* Cash Drawer Card — financial actions mirror the server role gate. */}
      {canOperateDrawer && (
        <Card className="bg-zinc-900 border-zinc-800 text-zinc-50 shrink-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-widest text-zinc-400">
              Cash Drawer
            </CardTitle>
          </CardHeader>
          <CardContent>
            {drawerLoading && <Skeleton className="h-10 w-full bg-zinc-800" />}

            {!drawerLoading && noOpenDrawer && (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-base font-semibold">No drawer open</p>
                  <p className="text-xs text-zinc-400">
                    Declare opening float to start the session.
                  </p>
                </div>
                <DrawerOpenDialog />
              </div>
            )}

            {!drawerLoading && drawerSession && drawerSession.state === 'Open' && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex gap-6">
                    <div>
                      <p className="text-xs text-zinc-400">Opening float</p>
                      <p className="font-mono font-semibold text-base">
                        {formatMoney(drawerSession.openingFloat)}
                      </p>
                    </div>
                    {drawerSession.onHandCash && (
                      <div>
                        <p className="text-xs text-zinc-400">On-hand cash</p>
                        <p className="font-mono font-semibold text-base text-primary">
                          {formatMoney(drawerSession.onHandCash)}
                        </p>
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-zinc-400">Opened at</p>
                      <p className="font-mono text-sm">
                        {new Date(drawerSession.openedAt).toLocaleTimeString([], {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <RecordDepositDialog />
                    <DrawerCloseDialog session={drawerSession} />
                  </div>
                </div>

                {drawerSession.deposits.length > 0 && (
                  <div className="rounded-lg border border-zinc-800 divide-y divide-zinc-800">
                    {drawerSession.deposits.map((d) => (
                      <div
                        key={d.id}
                        className={`flex items-center justify-between px-3 py-1.5 text-xs ${
                          d.voidedAt ? 'opacity-50' : ''
                        }`}
                      >
                        <span className="font-mono">
                          {formatMoney(d.amount)}
                          {d.depositSlipNumber ? ` · Slip ${d.depositSlipNumber}` : ''}
                          {d.voidedAt ? ' · Voided' : ''}
                        </span>
                        {!d.voidedAt && <VoidDepositDialog deposit={d} />}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!drawerLoading && drawerSession && drawerSession.state === 'Closed' && (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-base font-semibold text-zinc-300">Drawer closed</p>
                  <p className="text-xs text-zinc-400">
                    Declared: {formatMoney(drawerSession.closingTotalDeclared)} · Variance:{' '}
                    {drawerSession.variance ? formatMoney(drawerSession.variance) : '—'}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-zinc-50 text-zinc-950 grid place-items-center font-bold text-sm shrink-0">
            SV
          </div>
          <div>
            <p className="font-semibold text-lg leading-tight">Staff Kiosk</p>
            <p className="text-xs text-zinc-400">Tap your name to clock in or out</p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl font-semibold tabular-nums tracking-tight">
            {activeStaff.length}
          </p>
          <p className="text-xs text-zinc-400">on shift</p>
        </div>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1 min-h-0">
        {/* Currently clocked in */}
        <div className="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 gap-4 min-h-0">
          <div className="flex items-center justify-between shrink-0">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
                On shift
              </p>
              <p className="text-2xl font-semibold font-mono tabular-nums mt-0.5">
                {activeStaff.length}
              </p>
            </div>
            <div className="h-3 w-3 rounded-full bg-green-500 animate-pulse" />
          </div>

          <div className="flex-1 overflow-auto space-y-2 min-h-0">
            {isLoading && <Skeleton className="h-16 w-full bg-zinc-800" />}
            {!isLoading && activeStaff.length === 0 && (
              <div className="flex items-center justify-center h-24 rounded-xl border border-zinc-800">
                <p className="text-sm text-zinc-500">No one is clocked in.</p>
              </div>
            )}
            {activeStaff.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between rounded-xl border border-zinc-700 bg-zinc-800/60 px-5 py-4"
              >
                <div>
                  <p className="text-base font-semibold leading-tight">{fullName(u)}</p>
                  <p className="text-xs text-zinc-400 mt-0.5 font-mono">
                    {humanizeRole(u.role)} · since{' '}
                    {u.activeShift && formatClockIn(u.activeShift.clockInAt)}
                  </p>
                </div>
                <Button
                  size="lg"
                  variant="outline"
                  className="bg-transparent border-zinc-600 text-zinc-50 hover:bg-zinc-700 hover:text-zinc-50 text-sm px-6"
                  onClick={() => openPinForClockOut(u)}
                  disabled={clockOut.isPending}
                >
                  Clock Out
                </Button>
              </div>
            ))}
          </div>
        </div>

        {/* Available staff */}
        <div className="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 gap-4 min-h-0">
          <div className="flex items-center justify-between shrink-0">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
                Available
              </p>
              <p className="text-2xl font-semibold font-mono tabular-nums mt-0.5">
                {availableStaff.length}
              </p>
            </div>
            <div className="h-3 w-3 rounded-full bg-zinc-600" />
          </div>

          <div className="flex-1 overflow-auto space-y-2 min-h-0">
            {isLoading && <Skeleton className="h-16 w-full bg-zinc-800" />}
            {!isLoading && availableStaff.length === 0 && (
              <div className="flex items-center justify-center h-24 rounded-xl border border-zinc-800">
                <p className="text-sm text-zinc-500">Everyone is already clocked in.</p>
              </div>
            )}
            {availableStaff.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-800/30 px-5 py-4"
              >
                <div>
                  <p className="text-base font-semibold leading-tight">{fullName(u)}</p>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {humanizeRole(u.role)}
                    {u.licenseNumber ? (
                      <span className="font-mono ml-1">· {u.licenseNumber}</span>
                    ) : null}
                  </p>
                </div>
                <Button
                  size="lg"
                  className="text-sm px-6"
                  onClick={() => openPinForClockIn(u)}
                  disabled={clockIn.isPending}
                >
                  Clock In
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* PIN keypad dialog — shared across all clock-in/out cards */}
      {pinDialog && (
        <PinEntryDialog
          userId={pinDialog.userId}
          userName={pinDialog.userName}
          action={pinDialog.action}
          open={pinDialog !== null}
          onOpenChange={(open) => {
            if (!open) setPinDialog(null)
          }}
          onVerified={() => {
            void onPinVerified()
            setPinDialog(null)
          }}
        />
      )}
    </div>
  )
}
