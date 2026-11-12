import * as React from 'react'
import { CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export interface FormSectionHeaderProps {
  /** Section label text (rendered as an uppercase eyebrow). */
  children: React.ReactNode
  className?: string
}

/**
 * Canonical multi-section form header (PATTERNS.md Pattern 26).
 *
 * Wraps `<CardHeader>` + `<CardTitle>` with the eyebrow treatment used
 * across multi-section forms — `text-sm font-semibold uppercase
 * tracking-wide text-muted-foreground` — so sections within a form
 * read as muted dividers rather than competing page titles.
 */
export function FormSectionHeader({ children, className }: FormSectionHeaderProps) {
  return (
    <CardHeader className={cn('pb-3 pt-4 px-4', className)}>
      <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        {children}
      </CardTitle>
    </CardHeader>
  )
}
