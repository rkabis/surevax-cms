import * as React from 'react'
import { cn } from '@/lib/utils'

export interface TableCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Children — typically a `<Table>` from `@/components/ui/table`. Can also
   * host a custom grid-based "fake table" (Services list, Patients list).
   */
  children: React.ReactNode
}

/**
 * Canonical container around a list `<Table>`.
 *
 * Wraps the table in a rounded card with a border + `bg-card` background
 * so the table never sits flush against the page edges. Callers provide
 * the outer padding (`px-4 sm:px-6 xl:px-8 2xl:px-10 py-4` is the canonical wrap)
 * and the scroll container — typically `<ScrollArea>` outside, sticky
 * header inside.
 *
 * Pattern (full list page):
 *
 * ```tsx
 * <ScrollArea className="flex-1">
 *   <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4">
 *     <TableCard>
 *       <Table>
 *         <TableHeader className="sticky top-0 bg-card z-10">…</TableHeader>
 *         <TableBody>…</TableBody>
 *       </Table>
 *     </TableCard>
 *   </div>
 * </ScrollArea>
 * ```
 *
 * **No `overflow-*` here, deliberately (2026-07-25 density audit).** CSS makes
 * an element a scrollport for BOTH axes as soon as either axis is non-`visible`
 * — `overflow-x-auto` silently implies a vertical scrollport too. That made
 * TableCard the containing block for every `position: sticky` descendant, and
 * because the card is content-height it can never scroll vertically, so every
 * Pattern 20 sticky `<TableHeader>` was inert: measured at 2560x1440, scrolling
 * `/transactions` by 134px moved the header up by exactly 134px. Sticky now
 * resolves against the page's real scroller (the outer `<ScrollArea>`, or the
 * `flex-1 min-h-0 overflow-y-auto` some pages use) and pins as documented.
 *
 * Corner clipping is done with border-radius on the outermost cells of the
 * first/last row instead of `overflow-hidden`, which would reintroduce the
 * scrollport. If a table is genuinely wider than the shell, give the page's
 * scroller a horizontal scrollbar — do not put `overflow` back on the card.
 *
 * **First/last cell inset.** TableCard adds `pl-4` to the first cell and
 * `pr-4` to the last cell of every row (header + body) via descendant
 * selectors. This gives rows visible breathing room from the card border
 * — without it, the shadcn default `p-2` cells touch the card edge and
 * the table looks like a printed receipt. Works for shadcn `<Table>` and
 * raw `<table>` markup alike.
 */
export function TableCard({ className, children, ...props }: TableCardProps) {
  return (
    <div
      className={cn(
        // No `overflow-*` — see the docblock above. It would make this the
        // sticky containing block and re-break Pattern 20 headers.
        'rounded-lg border border-border bg-card shadow-sm',
        // Corner clipping without a scrollport: round the outermost cells of
        // the last row so a hover/selected background can't square off the
        // card's bottom corners.
        '[&_tbody_tr:last-child_td:first-child]:rounded-bl-lg',
        '[&_tbody_tr:last-child_td:last-child]:rounded-br-lg',
        // First/last cell inset — pulls rows away from the card border so
        // the table doesn't read edge-to-edge. Overrides cell defaults
        // (shadcn `p-2`, raw `<table>` `px-3`/`px-4`/`px-6`) on the
        // outermost columns only.
        '[&_thead_th:first-child]:pl-4 [&_thead_th:last-child]:pr-4',
        '[&_tbody_td:first-child]:pl-4 [&_tbody_td:last-child]:pr-4',
        'sm:[&_thead_th:first-child]:pl-6 sm:[&_thead_th:last-child]:pr-6',
        'sm:[&_tbody_td:first-child]:pl-6 sm:[&_tbody_td:last-child]:pr-6',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}
