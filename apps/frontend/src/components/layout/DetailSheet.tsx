import * as React from 'react'
import { SheetContent } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

type DetailSheetWidth = 'narrow' | 'standard' | 'wide'

const WIDTH_CLASSES: Record<DetailSheetWidth, string> = {
  // Each preset takes one extra step at 2xl (≥1536px viewport — the 27"
  // front-desk display) so detail rails use the extra width instead of
  // floating in dead space. See PATTERNS.md Pattern 31.
  // Worklist detail — list stays usable beside the open sheet.
  // Used by ScheduledOrders, Appointments.
  narrow: 'w-full sm:max-w-md xl:max-w-lg 2xl:max-w-xl',
  // Default — admin detail, patient detail, most pages.
  standard: 'w-full sm:max-w-xl xl:max-w-2xl 2xl:max-w-3xl',
  // Form-heavy or commit-flow surfaces — cashier flow, protocol initiation.
  // Used by Transactions, StandingOrder detail, InitiateProtocol.
  wide: 'w-full sm:max-w-2xl xl:max-w-3xl 2xl:max-w-4xl',
}

export interface DetailSheetProps extends React.ComponentProps<typeof SheetContent> {
  /**
   * Width preset. `standard` is the default and matches the canonical
   * detail-rail width (PATTERNS.md Pattern 6).
   */
  width?: DetailSheetWidth
}

/**
 * Canonical right-side detail sheet (PATTERNS.md Pattern 6).
 *
 * Wraps `<SheetContent side="right">` with one of three width presets so
 * detail rails don't drift across the codebase. Owns `p-0` and
 * `flex flex-col` so the sheet body can compose its own padding +
 * scroll handling.
 *
 * Usage:
 *
 * ```tsx
 * <Sheet open={open} onOpenChange={setOpen}>
 *   <DetailSheet width="standard">
 *     <SheetHeader className="px-6 py-4 border-b border-border">
 *       <SheetTitle>...</SheetTitle>
 *     </SheetHeader>
 *     <div className="flex-1 overflow-y-auto px-6 py-4">…</div>
 *   </DetailSheet>
 * </Sheet>
 * ```
 *
 * Use `narrow` for worklist detail (list + detail side-by-side),
 * `standard` for most detail rails, `wide` for form-heavy / commit-flow
 * surfaces (cashier, protocol initiation).
 */
export function DetailSheet({
  width = 'standard',
  className,
  children,
  ...props
}: DetailSheetProps) {
  return (
    <SheetContent
      side="right"
      className={cn(WIDTH_CLASSES[width], 'p-0 flex flex-col', className)}
      {...props}
    >
      {children}
    </SheetContent>
  )
}
