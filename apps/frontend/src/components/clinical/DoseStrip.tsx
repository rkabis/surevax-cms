import * as React from 'react'
import { Check } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export type DoseState = 'done' | 'due' | 'overdue' | ''

export interface DoseStripDose {
  /** Short node label — "D0", "D3", "Dose 2". */
  label: string
  /** Empty string / undefined = upcoming (hollow node). */
  state?: DoseState
  /** Optional tooltip detail line — date, lot, clinician. */
  detail?: string
}

export interface DoseStripProps {
  doses: DoseStripDose[]
  /**
   * `md` (default) — nodes + connecting rail + labels underneath. For
   * detail rails and protocol cards.
   * `sm` — compact nodes + rail, no labels (tooltip carries the info).
   * For table cells and roster rows.
   */
  size?: 'sm' | 'md'
  className?: string
}

const STATE_LABEL: Record<Exclude<DoseState, ''>, string> = {
  done: 'Completed',
  due: 'Due now',
  overdue: 'Overdue',
}

function stateLabel(s: DoseState | undefined): string {
  return s ? STATE_LABEL[s] : 'Upcoming'
}

function nodeClasses(s: DoseState | undefined, size: 'sm' | 'md'): string {
  const base = cn(
    'rounded-full flex items-center justify-center shrink-0 transition-colors',
    size === 'md' ? 'h-4 w-4' : 'h-2.5 w-2.5',
  )
  switch (s) {
    case 'done':
      return cn(base, 'bg-triage-ok text-white')
    case 'due':
      return cn(base, 'bg-triage-due-soft ring-2 ring-inset ring-triage-due')
    case 'overdue':
      return cn(base, 'bg-triage-overdue-soft ring-2 ring-inset ring-triage-overdue')
    default:
      return cn(base, 'bg-card border-2 border-muted-foreground/30')
  }
}

function innerDot(s: DoseState | undefined, size: 'sm' | 'md'): React.ReactNode {
  if (s === 'done')
    return size === 'md' ? <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden /> : null
  if (s === 'due')
    return (
      <span
        className={cn('rounded-full bg-triage-due', size === 'md' ? 'h-1.5 w-1.5' : 'h-1 w-1')}
      />
    )
  if (s === 'overdue')
    return (
      <span
        className={cn('rounded-full bg-triage-overdue', size === 'md' ? 'h-1.5 w-1.5' : 'h-1 w-1')}
      />
    )
  return null
}

/**
 * Signature dose-progress strip (PATTERNS.md Pattern 13).
 *
 * Renders a standing-order / PEP course as connected dose nodes:
 * done = filled green check, due = amber ring, overdue = red ring,
 * upcoming = hollow. The rail segment LEADING INTO a node is colored
 * green when the previous dose is done, so completed progress reads as
 * a continuous line at a glance.
 *
 * States are severity-semantic (triage tokens) — never restyle with
 * brand colors. Use `sm` in table cells, `md` in detail rails.
 */
export function DoseStrip({ doses, size = 'md', className }: DoseStripProps) {
  const summary = doses.map((d) => `${d.label}: ${stateLabel(d.state)}`).join(' · ')

  return (
    <div
      className={cn('flex items-start', size === 'md' ? 'gap-0' : 'gap-0', className)}
      role="img"
      aria-label={summary}
    >
      {doses.map((d, i) => {
        const node = (
          <Tooltip key={i}>
            <TooltipTrigger asChild>
              <div
                className={cn('flex flex-col items-center cursor-help', size === 'md' && 'gap-1')}
              >
                <span className={nodeClasses(d.state, size)}>{innerDot(d.state, size)}</span>
                {size === 'md' && (
                  // `text-xs`, not `text-2xs`: this is the dose number in the
                  // course ("Dose 3"), which the nurse confirms before giving
                  // an injection. Sub-body micro-type is for kbd hints, not
                  // for the sequence position in a rabies PEP schedule.
                  <span
                    className={cn(
                      'text-xs font-mono tabular-nums',
                      d.state ? 'text-foreground font-medium' : 'text-muted-foreground',
                    )}
                  >
                    {d.label}
                  </span>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-medium">
                {d.label} · {stateLabel(d.state)}
              </p>
              {d.detail && <p className="text-xs text-muted-foreground">{d.detail}</p>}
            </TooltipContent>
          </Tooltip>
        )

        if (i === 0) return node

        // Rail segment between previous node and this one — green when the
        // previous dose is done so progress reads as a continuous line.
        const prevDone = doses[i - 1]?.state === 'done'
        return (
          <React.Fragment key={i}>
            <span
              aria-hidden
              className={cn(
                'h-px flex-none self-start',
                size === 'md' ? 'w-5 mt-2' : 'w-3 mt-[0.2812rem]',
                prevDone ? 'bg-triage-ok' : 'bg-border',
              )}
            />
            {node}
          </React.Fragment>
        )
      })}
    </div>
  )
}
