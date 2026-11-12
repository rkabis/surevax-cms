import * as React from 'react'
import { cn } from '@/lib/utils'

export interface PageHeaderProps {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}

/**
 * Canonical page-head row (PATTERNS.md Pattern 11).
 *
 * Title + optional subtitle on the left, right-aligned action group.
 * Owns title typography (`text-xl 2xl:text-2xl font-semibold`), subtitle treatment
 * (`text-sm text-muted-foreground mt-0.5`), and the right-side action
 * container (`flex items-center gap-2 shrink-0`).
 *
 * Outer page padding (`px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card`)
 * stays at the call site so pages can compose KPI strips, filter rows,
 * etc. underneath the header inside the same wrapping div.
 *
 * Button order rule (non-negotiable, per Pattern 11): secondary actions
 * left (`variant="outline"` — Export / Filter / Print / History), primary
 * CTA rightmost (default variant). All `size="sm"` with `h-3.5 w-3.5
 * mr-1.5` leading icons.
 */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-3', className)}>
      <div className="min-w-0">
        {/* Confident type ramp (2026-06-12 creative pass): xl base, one
            step up at 2xl (27" display) — Pattern 31 */}
        <h1 className="text-xl 2xl:text-2xl font-semibold tracking-tight">{title}</h1>
        {description != null && (
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0 flex-wrap">{actions}</div>}
    </div>
  )
}
