import * as React from 'react'
import { cn } from '@/lib/utils'

export interface PageToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Layout mode:
   * - `row` (default) — single horizontal flex row. Search input + filter
   *   tabs + secondary chips. Items wrap on narrow viewports.
   * - `stacked` — vertical `space-y-2`. Use when filters compose into
   *   multiple sub-rows (Audit Log: search + session-id + tabs).
   */
  layout?: 'row' | 'stacked'
}

/**
 * Canonical page toolbar — the filter/search/tabs row that sits between
 * the page header (or KPI strip) and the table.
 *
 * Owns:
 * - Outer padding (`px-4 sm:px-6 xl:px-8 2xl:px-10 py-3`)
 * - Bottom border (`border-b border-border`)
 * - Inner layout (`flex items-center gap-3 flex-wrap` for `row` mode)
 *
 * Use directly under the page-head wrapper. Search inputs, `<Tabs>`
 * controls, and small chips go inside; the toolbar owns spacing, not
 * the children.
 *
 * Example:
 *
 * ```tsx
 * <PageToolbar>
 *   <div className="relative flex-1 max-w-sm xl:max-w-md">
 *     <Input placeholder="Search…" />
 *   </div>
 *   <Tabs>…</Tabs>
 * </PageToolbar>
 * ```
 */
export function PageToolbar({ layout = 'row', className, children, ...props }: PageToolbarProps) {
  return (
    <div
      className={cn(
        'px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-b border-border bg-card',
        layout === 'row' ? 'flex items-center gap-3 flex-wrap' : 'space-y-2',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}
