import * as React from 'react'
import { Sheet } from '@/components/ui/sheet'
import { useIs2xl } from '@/lib/useMediaQuery'

export interface DetailRailProps extends React.ComponentProps<typeof Sheet> {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Short record label announced when the non-modal desktop rail opens. */
  announcement?: string
}

/**
 * Sheet root for worklist detail rails (PATTERNS.md Pattern 6).
 *
 * On the 27" front-desk display (`2xl`) the rail is **non-modal**: no
 * scrim, no focus trap, no scroll lock — the list stays fully interactive
 * beside the open rail, and clicking another row switches the selection
 * directly. Below `2xl` it behaves as a normal modal sheet (small screens
 * can't afford side-by-side).
 *
 * Use for read/act detail rails on list pages. Edit-form sheets
 * (`InitiateProtocolSheet`, payer edit, etc.) should stay on plain
 * `<Sheet>` — modal focus is a feature when a form is mid-edit.
 */
export function DetailRail({
  children,
  open,
  onOpenChange,
  announcement,
  ...props
}: DetailRailProps) {
  const is2xl = useIs2xl()
  const returnFocusRef = React.useRef<HTMLElement | null>(null)

  React.useEffect(() => {
    if (open) {
      const active = document.activeElement
      if (active instanceof HTMLElement && !active.closest('[role="dialog"]')) {
        returnFocusRef.current = active
      }
      return
    }

    // Radix restores focus automatically when a SheetTrigger exists. Worklist
    // rails are opened by row selection instead, so retain the invoking row or
    // button explicitly. Waiting one frame keeps this from racing the closing
    // animation and Radix's own close autofocus.
    const target = returnFocusRef.current
    if (target?.isConnected) {
      requestAnimationFrame(() => target.focus({ preventScroll: true }))
    }
  }, [open])

  return (
    <Sheet modal={!is2xl} open={open} onOpenChange={onOpenChange} {...props}>
      {children}
      {is2xl && open && (
        <span className="sr-only" role="status" aria-live="polite">
          {announcement ?? 'Details panel opened.'} Press Escape to close. The worklist remains
          available.
        </span>
      )}
    </Sheet>
  )
}
