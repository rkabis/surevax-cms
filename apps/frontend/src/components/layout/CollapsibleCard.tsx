import { useId, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export interface CollapsibleCardProps {
  /** Section title. Rendered in the same eyebrow style as `<FormSectionHeader>`. */
  title: string
  /** Small normal-case hint after the title, e.g. "(if minor)". */
  hint?: string
  /**
   * Right-aligned summary of what is inside, shown while collapsed so a nurse
   * can tell a filled-in section from an empty one without opening it.
   * A number renders as a badge ("3 filled"); anything else renders as-is.
   */
  filledCount?: number
  /** Open on first render. Default false: optional detail starts out of the way. */
  defaultOpen?: boolean
  /**
   * Force the section open regardless of the toggle. Pass `true` when a field
   * inside has a validation error: an error the nurse cannot see is worse than a
   * cluttered form, and a form that refuses to submit with no visible reason is
   * the single most frustrating failure a collapsed section can cause.
   */
  forceOpen?: boolean
  children: ReactNode
}

/**
 * A `<Card>` form section that starts collapsed.
 *
 * Built for the patient intake form, where a nurse registering a bite walk-in
 * needs four fields (name, birth date, sex, mobile) and the other thirty are
 * either optional or filled in later. Everything past the essentials lives in one
 * of these, so the fast path is short and the long tail is one click away rather
 * than gone.
 *
 * Deliberately not Radix: this is a disclosure toggle, and the repo's dependency
 * gate is not worth spending on `@radix-ui/react-collapsible` for a
 * `useState(false)` and an `aria-expanded`. Children stay MOUNTED and are hidden
 * with the `hidden` attribute, so react-hook-form keeps their state and
 * validation still runs on a collapsed field.
 */
export function CollapsibleCard({
  title,
  hint,
  filledCount,
  defaultOpen = false,
  forceOpen = false,
  children,
}: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen)
  const contentId = useId()
  const isOpen = open || forceOpen

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-controls={contentId}
        className={cn(
          'flex w-full items-center gap-2 px-4 py-3 text-left',
          'rounded-t-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          !isOpen && 'rounded-b-lg',
        )}
      >
        <ChevronRight
          aria-hidden
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
            isOpen && 'rotate-90',
          )}
        />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
        {!isOpen && filledCount !== undefined && filledCount > 0 && (
          <Badge variant="info" className="ml-auto text-2xs px-1.5 py-0">
            {filledCount} filled
          </Badge>
        )}
      </button>
      {/* `hidden`, not unmounted: RHF state and validation survive collapsing. */}
      <div id={contentId} hidden={!isOpen}>
        <CardContent className="px-4 pb-4 space-y-3">{children}</CardContent>
      </div>
    </Card>
  )
}
