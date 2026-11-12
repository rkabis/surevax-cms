import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ListEmptyProps {
  /**
   * Lucide icon for the empty state. Pick semantically (`Users` for
   * users, `Receipt` for transactions, `Stethoscope` for encounters,
   * etc.).
   */
  icon?: LucideIcon
  /**
   * Primary copy. Convention is `No {plural-entity} found.` unless the
   * page has a specifically different intent (e.g. an unselected-state
   * prompt like "Search for a patient to load encounter context").
   */
  message: React.ReactNode
  /**
   * Optional next action, rendered under the message — typically the same
   * `<Button size="sm">` the page head offers ("Register patient", "New
   * arrival").
   *
   * Added 2026-07-25: all 40 empty surfaces in the app were dead-end
   * messages, and the one primitive that had an action slot
   * (`components/ui/empty-state.tsx`) had never been imported anywhere.
   * Pass an action whenever there IS a next step; omit it for a
   * filter/search miss, where the next step is "change the filter" and a
   * button would be noise.
   */
  action?: React.ReactNode
  className?: string
}

/**
 * Canonical list empty state (PATTERNS.md Pattern 21).
 *
 * Use when a list/table renders zero rows — search miss, fresh tenant,
 * filter that excludes everything. Render **above** or **instead-of**
 * the table — never inside a `<TableRow>` with `colSpan`.
 *
 * This is the app's single empty-state primitive. The dashed-border
 * `<EmptyState>` that used to live in `components/ui/` was deleted in the
 * 2026-07-25 audit: it was never imported once, while its `action` prop was
 * the thing every caller here actually needed — so the slot moved onto this
 * component instead of maintaining two.
 */
export function ListEmpty({ icon: Icon, message, action, className }: ListEmptyProps) {
  return (
    <div className={cn('px-6 py-12 text-center', className)} role="status">
      {Icon && <Icon className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" aria-hidden />}
      <p className="text-sm text-muted-foreground">{message}</p>
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  )
}
