import * as React from 'react'
import { cn } from '@/lib/utils'

export interface KpiStripProps {
  /**
   * Minimum width a cell may shrink to before the grid wraps it onto a new
   * row. Keep ≥ the widest expected value (currency, large counts) so the
   * value never clips. Defaults to `12rem`.
   */
  minColWidth?: string
  children: React.ReactNode
  className?: string
}

/**
 * Canonical KPI strip (PATTERNS.md Pattern 10).
 *
 * Intrinsically responsive: cells lay out with
 * `repeat(auto-fit, minmax(min(100%, minColWidth), 1fr))`, so the strip shows
 * as many comparable metrics across as fit and wraps the rest onto new rows
 * — no fixed column count, no viewport breakpoints, no overlap. The ruled
 * dividers come from a 1px `bg-border` grid gap showing between opaque cells,
 * which stays clean whether the strip is one row or several (`divide-x` broke
 * the moment cells wrapped). Use for 3–6 comparable metrics at the top of a page.
 */
export function KpiStrip({ minColWidth = '12rem', children, className }: KpiStripProps) {
  return (
    <div
      className={cn('grid gap-px bg-border [&>*]:bg-card', className)}
      style={{
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${minColWidth}), 1fr))`,
      }}
    >
      {children}
    </div>
  )
}
