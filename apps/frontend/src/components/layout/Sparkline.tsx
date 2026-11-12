import * as React from 'react'
import { cn } from '@/lib/utils'

type SparklineTone = 'default' | 'overdue' | 'due' | 'ok' | 'info'

const TONE_STROKE: Record<SparklineTone, string> = {
  default: 'text-muted-foreground/60',
  overdue: 'text-triage-overdue',
  due: 'text-triage-due',
  ok: 'text-triage-ok',
  info: 'text-triage-info',
}

export interface SparklineProps {
  /**
   * Series values, oldest → newest. Needs ≥ 2 points to draw; fewer
   * renders nothing (no placeholder — absence should look like absence).
   */
  data: number[]
  /**
   * Severity tone for the stroke. Same rule as KpiCell values: tone
   * carries clinical/triage meaning, not "good/bad number" decoration.
   */
  tone?: SparklineTone
  /** Pixel size of the drawing box. Defaults sized for a KPI cell. */
  width?: number
  height?: number
  /** Accessible description, e.g. "7-day arrivals trend". */
  label?: string
  className?: string
}

/**
 * Tiny inline trend line (PATTERNS.md Pattern 32). Pure SVG — no
 * charting dependency. Designed for KPI cells and dense table cells:
 * a single polyline, flat-normalized, with a dot on the latest point.
 *
 * Not an analytical chart: no axes, no tooltips, no interaction. If a
 * surface needs real charting, that's a different (future) primitive.
 */
export function Sparkline({
  data,
  tone = 'default',
  width = 64,
  height = 20,
  label,
  className,
}: SparklineProps) {
  if (data.length < 2) return null

  const pad = 2
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const stepX = (width - pad * 2) / (data.length - 1)
  const points = data.map((v, i) => {
    const x = pad + i * stepX
    const y = pad + (height - pad * 2) * (1 - (v - min) / span)
    return [x, y] as const
  })
  const last = points[points.length - 1]!

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label ?? 'trend'}
      className={cn('shrink-0', TONE_STROKE[tone], className)}
    >
      <polyline
        points={points.map(([x, y]) => `${x},${y}`).join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last[0]} cy={last[1]} r="2" fill="currentColor" />
    </svg>
  )
}
