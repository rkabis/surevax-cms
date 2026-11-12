import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Sparkline } from '@/components/layout/Sparkline'
import { cn } from '@/lib/utils'

type KpiTone = 'default' | 'overdue' | 'due' | 'ok' | 'info'
type KpiBadgeTone = 'overdue' | 'due' | 'ok' | 'info'

const TONE_CLASSES: Record<KpiTone, string> = {
  default: '',
  overdue: 'text-triage-overdue',
  due: 'text-triage-due',
  ok: 'text-triage-ok',
  info: 'text-triage-info',
}

export interface KpiCellProps {
  label: React.ReactNode
  value: React.ReactNode
  subtitle?: React.ReactNode
  /**
   * Severity-tone color for the value. Use only when the number itself
   * carries clinical/triage meaning — never to make a "bad" number red.
   */
  tone?: KpiTone
  /**
   * Optional severity pill rendered next to the value (e.g. "Overdue",
   * "Due", "Ok"). Use for at-a-glance triage on hub/dashboard strips. The
   * value/badge row wraps, so the badge drops below the value rather than
   * overlapping it in a narrow cell.
   */
  badgeLabel?: React.ReactNode
  /** Badge variant — applies when `badgeLabel` is set. Defaults to `info`. */
  badgeTone?: KpiBadgeTone
  /**
   * Optional trend series (oldest → newest, ≥ 2 points) rendered as an
   * inline `<Sparkline>` right of the value. Use for "how has this moved"
   * context (7-day arrivals, daily revenue). Backend must supply the
   * series — don't synthesize one client-side from a single snapshot.
   */
  trend?: number[]
  /** Sparkline tone — same severity semantics as `tone`. */
  trendTone?: KpiTone
  /**
   * Optional period-over-period delta line rendered under the value,
   * e.g. "+3 vs last week". Pass pre-formatted text; pair with
   * `deltaTone` when the direction carries clinical meaning.
   */
  delta?: React.ReactNode
  /** Severity tone for the delta line. Defaults to muted. */
  deltaTone?: KpiTone
  className?: string
}

/**
 * Canonical KPI cell (PATTERNS.md Pattern 18).
 *
 * Three layers: eyebrow label (10 px uppercase mono via `.eyebrow`),
 * value (`text-2xl font-semibold font-mono tabular-nums`) with an optional
 * severity badge + optional `<Sparkline>` trend, subtitle / delta line
 * (`text-xs`). Use inside `<KpiStrip>` for the canonical ruled-divider
 * layout.
 */
export function KpiCell({
  label,
  value,
  subtitle,
  tone = 'default',
  badgeLabel,
  badgeTone = 'info',
  trend,
  trendTone = 'default',
  delta,
  deltaTone,
  className,
}: KpiCellProps) {
  return (
    // Padding takes NO `2xl:` step (2026-07-25 density audit): the KPI band
    // measured 137–155px, ~10% of the 1440px clinic display, and `2xl:p-4`
    // spent the wide-canvas win on air. `KpiStrip`'s `auto-fit` already turns
    // extra width into more COLUMNS, which is where it should go.
    //
    // The VALUE keeps its `2xl:text-3xl` step (restored 2026-07-26). These are
    // the headline numbers on a worklist — read from across a front desk, not
    // at reading distance — so weight here is legibility, not decoration. It
    // costs ~6px of band height. Padding vs type is the distinction: air is
    // what got cut, not the numerals.
    <div className={cn('p-3', className)}>
      <span className="eyebrow">{label}</span>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mt-0.5">
        <span
          className={cn(
            'text-2xl 2xl:text-3xl font-semibold font-mono tabular-nums leading-none',
            TONE_CLASSES[tone],
          )}
        >
          {value}
        </span>
        {badgeLabel != null && (
          <Badge variant={badgeTone} className="shrink-0 text-xs">
            {badgeLabel}
          </Badge>
        )}
        {trend && trend.length >= 2 && (
          <Sparkline data={trend} tone={trendTone} className="self-center" />
        )}
      </div>
      {delta != null && (
        <p
          className={cn(
            'text-xs mt-0.5 truncate font-mono tabular-nums',
            deltaTone ? TONE_CLASSES[deltaTone] : 'text-muted-foreground',
          )}
        >
          {delta}
        </p>
      )}
      {subtitle != null && (
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>
      )}
    </div>
  )
}
