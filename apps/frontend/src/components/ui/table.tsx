import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Row density (PATTERNS.md Pattern 36).
 *
 * - `default` — reference / admin lists. `py-2` cells.
 * - `compact` — worklists. `py-1.5` cells + a shorter header, because a
 *   worklist's job is "how much of today can I see at once" (DESIGN.md §2).
 *
 * Set it once on `<Table density="compact">`; cells read it from context.
 * Do NOT re-add per-cell `py-*` overrides — that drift is what produced
 * four competing row heights (39–65px measured at 2560×1440) before the
 * 2026-07-25 density audit.
 */
export type TableDensity = 'default' | 'compact'

const DENSITY_CELL: Record<TableDensity, string> = {
  default: 'px-2 py-2',
  compact: 'px-2 py-1.5',
}

const DENSITY_HEAD: Record<TableDensity, string> = {
  default: 'h-10 px-2',
  compact: 'h-8 px-2',
}

const TableDensityContext = React.createContext<TableDensity>('default')

export interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  density?: TableDensity
}

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, density = 'default', ...props }, ref) => (
    // NOTE: no `overflow-*` here. A scroll container becomes the containing
    // block for `position: sticky` descendants, and this wrapper is
    // content-height so it can never scroll — which silently disabled every
    // Pattern 20 sticky header. Horizontal scrolling belongs to `<TableCard>`.
    <TableDensityContext.Provider value={density}>
      <div className="relative w-full">
        <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
      </div>
    </TableDensityContext.Provider>
  ),
)
Table.displayName = 'Table'

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn('[&_tr]:border-b', className)} {...props} />
))
TableHeader.displayName = 'TableHeader'

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
))
TableBody.displayName = 'TableBody'

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0', className)}
    {...props}
  />
))
TableFooter.displayName = 'TableFooter'

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  /**
   * Mark a row that opens something on click (the detail rail, a record
   * page). Makes the row focusable and activatable by Enter/Space, so the
   * list is reachable without a mouse — DESIGN.md §15 requires it, and 22
   * list pages were attaching `onClick` to a bare `<tr>`, which no keyboard
   * user could reach (verified: 40 Tab presses on /patients never landed on
   * a row).
   *
   * Deliberately does NOT set `role="button"` — that would strip the row out
   * of the table's semantics for screen readers. The row stays a row; it just
   * becomes focusable.
   */
  interactive?: boolean
}

const TableRow = React.forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ className, interactive, onKeyDown, onClick, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted',
        // Keeps the global :focus-visible ring (DESIGN.md §15 — never override
        // it); the background tint is additive, for rows where a ring on a
        // border-collapsed <tr> reads faintly.
        interactive && 'cursor-pointer focus-visible:bg-muted/60',
        className,
      )}
      {...(interactive ? { tabIndex: 0 } : null)}
      onClick={onClick}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (!interactive || event.defaultPrevented) return
        // Only self-activate; a keypress inside a cell control is that
        // control's business (a row action button, an inline select).
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick?.(event as unknown as React.MouseEvent<HTMLTableRowElement>)
        }
      }}
      {...props}
    />
  ),
)
TableRow.displayName = 'TableRow'

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => {
  const density = React.useContext(TableDensityContext)
  return (
    <th
      ref={ref}
      className={cn(
        DENSITY_HEAD[density],
        'text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className,
      )}
      {...props}
    />
  )
})
TableHead.displayName = 'TableHead'

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => {
  const density = React.useContext(TableDensityContext)
  return (
    <td
      ref={ref}
      className={cn(
        DENSITY_CELL[density],
        'align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className,
      )}
      {...props}
    />
  )
})
TableCell.displayName = 'TableCell'

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
))
TableCaption.displayName = 'TableCaption'

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption }
