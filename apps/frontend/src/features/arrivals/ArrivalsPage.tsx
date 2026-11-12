import { useEffect, useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ArrivalProvider, useArrival } from './context'
import StepRail from './StepRail'
import { DirtyFormGuard } from '@/components/layout'

const STEP_LABELS: Record<string, { title: string; step: number; total: number }> = {
  '/arrivals/identify': { title: 'Identify Patient', step: 1, total: 4 },
  '/arrivals/encounter': { title: 'Open Encounter', step: 2, total: 4 },
  '/arrivals/protocol': { title: 'Protocol & Commit', step: 3, total: 4 },
  '/arrivals/done': { title: 'Done', step: 4, total: 4 },
}

/**
 * Wizard layout — outer route. Each step renders inside the <Outlet />.
 *
 * Esc anywhere in the wizard triggers the abandon-confirm dialog. We do
 * the dialog inside ArrivalProvider so we can read `selectedPatientId` to
 * decide whether confirmation is needed (no-op if state is empty).
 */
export default function ArrivalsPage() {
  return (
    <ArrivalProvider>
      <ArrivalLayout />
    </ArrivalProvider>
  )
}

function ArrivalLayout() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const arrival = useArrival()
  const [abandonOpen, setAbandonOpen] = useState(false)

  const stepInfo = Object.entries(STEP_LABELS).find(([path]) => pathname.startsWith(path))?.[1]

  // Wizard is "dirty" when there is any in-progress state and the user hasn't
  // completed step 4 yet. DirtyFormGuard blocks SPA navigation + beforeunload.
  const isDirty =
    !pathname.startsWith('/arrivals/done') &&
    (!!arrival.selectedPatientId || !!arrival.encounterId || !!arrival.encounterDraft)

  // Esc → confirm-abandon (only if there's something to lose).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      // Don't hijack Esc inside an open <Dialog> / <Sheet> — Radix already
      // handles that. Only fire when no dialog is open.
      const hasOpenOverlay = document.querySelector('[data-state="open"][role="dialog"]')
      if (hasOpenOverlay) return

      const hasState =
        !!arrival.selectedPatientId || !!arrival.encounterId || !!arrival.standingOrderId
      if (hasState) {
        setAbandonOpen(true)
      } else {
        navigate('/today')
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [arrival, navigate])

  function confirmAbandon() {
    arrival.reset()
    setAbandonOpen(false)
    navigate('/today')
  }

  return (
    <div className="h-full flex flex-col">
      <DirtyFormGuard
        when={isDirty}
        scope="/arrivals"
        message="You have an in-progress arrival. Discard and leave?"
        onDiscard={arrival.reset}
      />
      {/* Page head — wizard title + step indicator */}
      <div className="border-b border-border bg-background px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-4 min-w-0">
          <div className="min-w-0">
            <span className="eyebrow">New Arrival · Walk-in intake</span>
            <h1 className="text-base font-semibold mt-0.5 truncate">
              {stepInfo?.title ?? 'Arrival Wizard'}
            </h1>
          </div>
          {stepInfo && (
            <div className="hidden sm:flex items-center gap-1.5 shrink-0">
              <span
                className="dot"
                data-severity={stepInfo.step === stepInfo.total ? 'ok' : 'info'}
                aria-hidden
              />
              <span className="text-xs text-muted-foreground font-mono tabular-nums">
                Step {stepInfo.step} of {stepInfo.total}
              </span>
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground shrink-0"
          onClick={() => {
            const hasState =
              !!arrival.selectedPatientId || !!arrival.encounterId || !!arrival.standingOrderId
            if (hasState) setAbandonOpen(true)
            else navigate('/today')
          }}
        >
          Discard
        </Button>
      </div>

      <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
        <StepRail />
        <section
          aria-label="Arrival wizard step"
          className="flex-1 min-w-0 overflow-hidden"
          // key on path so the inner step component fully remounts on
          // navigation — keeps autofocus + form state predictable.
          key={pathname}
        >
          <Outlet />
        </section>
      </div>

      <Dialog open={abandonOpen} onOpenChange={setAbandonOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Abandon arrival?</DialogTitle>
            <DialogDescription>
              You'll lose the in-progress wizard state. The patient record and any saved encounter
              will remain.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbandonOpen(false)}>
              Keep going
            </Button>
            <Button variant="destructive" onClick={confirmAbandon}>
              Abandon
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
