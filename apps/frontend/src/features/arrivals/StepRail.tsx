import { NavLink, useLocation } from 'react-router-dom'
import { Check, UserSearch, Stethoscope, Workflow, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useArrival } from './context'

type Step = {
  to: string
  label: string
  meta: string
  icon: typeof UserSearch
  /** Whether the step has been completed based on wizard state. */
  isComplete: (s: ReturnType<typeof useArrival>) => boolean
}

const STEPS: Step[] = [
  {
    to: '/arrivals/identify',
    label: 'Identify',
    meta: 'Find or register patient',
    icon: UserSearch,
    isComplete: (s) => !!s.selectedPatientId,
  },
  {
    to: '/arrivals/encounter',
    label: 'Encounter',
    meta: 'Chief complaint + vitals',
    icon: Stethoscope,
    isComplete: (s) => !!s.encounterId || !!s.encounterDraft,
  },
  {
    to: '/arrivals/protocol',
    label: 'Protocol',
    meta: 'Course + authorization',
    icon: Workflow,
    isComplete: (s) => !!s.standingOrderId,
  },
  {
    to: '/arrivals/done',
    label: 'Done',
    meta: 'Ready for billing',
    icon: CheckCircle2,
    isComplete: () => false,
  },
]

/** Derive step index from current path */
function useCurrentStepIdx() {
  const { pathname } = useLocation()
  const idx = STEPS.findIndex((s) => pathname.startsWith(s.to))
  return idx === -1 ? 0 : idx
}

export default function StepRail() {
  const arrival = useArrival()
  const currentIdx = useCurrentStepIdx()

  return (
    <>
      {/* Sidebar rail (desktop) */}
      <aside
        aria-label="Arrival steps"
        className="hidden md:flex md:w-64 xl:w-80 shrink-0 flex-col border-r border-border bg-muted/20"
      >
        <div className="px-4 py-4 border-b border-border">
          <span className="eyebrow">New Arrival</span>
          <h2 className="text-base font-semibold mt-0.5">Walk-in intake</h2>
        </div>
        <ol className="flex-1 px-2 py-3 space-y-0.5">
          {STEPS.map((step, idx) => {
            const done = step.isComplete(arrival)
            const isActive = idx === currentIdx
            const isLocked = !done && idx > currentIdx

            return (
              <li key={step.to}>
                <NavLink
                  to={step.to}
                  className={({ isActive: navActive }) =>
                    cn(
                      'flex items-start gap-3 px-3 py-2.5 rounded-md text-sm transition-colors',
                      navActive && 'bg-accent text-accent-foreground',
                      !navActive && !isLocked && 'hover:bg-accent hover:text-accent-foreground',
                      isLocked && 'opacity-50 cursor-not-allowed pointer-events-none',
                    )
                  }
                  tabIndex={isLocked ? -1 : undefined}
                >
                  {/* Step indicator */}
                  <span
                    className={cn(
                      'mt-0.5 flex items-center justify-center h-6 w-6 rounded-full border text-xs shrink-0 font-mono tabular-nums transition-colors',
                      done
                        ? 'bg-primary border-primary text-primary-foreground'
                        : isActive
                          ? 'border-primary text-primary font-semibold'
                          : 'border-border text-muted-foreground',
                    )}
                    aria-hidden
                  >
                    {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{step.label}</span>
                      {/* Severity dot */}
                      {done && (
                        <span className="dot shrink-0" data-severity="ok" aria-label="complete" />
                      )}
                      {isActive && (
                        <span className="dot shrink-0" data-severity="info" aria-label="active" />
                      )}
                    </div>
                    <p className="text-2xs text-muted-foreground truncate mt-0.5">{step.meta}</p>
                  </div>
                </NavLink>
              </li>
            )
          })}
        </ol>
      </aside>

      {/* Top stepper (mobile) */}
      <nav
        aria-label="Arrival steps"
        className="md:hidden border-b border-border bg-muted/20 px-2 py-2 overflow-x-auto"
      >
        <ol className="flex gap-1 min-w-max">
          {STEPS.map((step, idx) => {
            const done = step.isComplete(arrival)
            const isLocked = !done && idx > currentIdx
            return (
              <li key={step.to}>
                <NavLink
                  to={step.to}
                  tabIndex={isLocked ? -1 : undefined}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs whitespace-nowrap transition-colors',
                      isActive
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'text-muted-foreground',
                      isLocked && 'opacity-50 pointer-events-none',
                    )
                  }
                >
                  <span
                    className={cn(
                      'flex items-center justify-center h-5 w-5 rounded-full border text-2xs font-mono shrink-0',
                      done ? 'bg-primary border-primary text-primary-foreground' : 'border-border',
                    )}
                    aria-hidden
                  >
                    {done ? <Check className="h-3 w-3" aria-hidden /> : idx + 1}
                  </span>
                  {step.label}
                  {done && <span className="dot" data-severity="ok" aria-hidden />}
                </NavLink>
              </li>
            )
          })}
        </ol>
      </nav>
    </>
  )
}
