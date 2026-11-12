import * as React from 'react'
import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ErrorBannerProps {
  /** Error message text or node. */
  message: React.ReactNode
  /**
   * Extra classes for the outer container. Use `p-6` inside a detail
   * panel, `py-12 justify-center` for a centered surface, or leave
   * empty for an inline banner inside card content.
   */
  className?: string
}

/**
 * Canonical inline error banner (PATTERNS.md Pattern 27).
 *
 * Replaces the hand-rolled `AlertCircle + 'Failed to load X.' span`
 * combo used across detail panels and card content. Same icon, same
 * destructive color, same typography — one primitive owns it.
 */
export function ErrorBanner({ message, className }: ErrorBannerProps) {
  return (
    <div className={cn('flex items-center gap-2 text-sm text-destructive', className)}>
      <AlertCircle className="h-4 w-4" aria-hidden />
      <span>{message}</span>
    </div>
  )
}
