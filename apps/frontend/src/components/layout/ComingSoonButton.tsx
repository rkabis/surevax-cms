import * as React from 'react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface ComingSoonButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-disabled'
> {
  /** Tooltip text. Defaults to "Coming soon". */
  tooltipText?: string
  /** Optional leading icon (lucide). */
  icon?: React.ReactNode
  /** ButtonProps `size` ("sm" | "default" | "lg" | "icon"). */
  size?: ButtonProps['size']
  /** Children = label text. */
  children: React.ReactNode
}

/**
 * Coming-soon stub button — visually distinguished from a "real disabled"
 * button so users can tell intentional stubs from broken UI.
 *
 * - outline variant, `text-muted-foreground` label
 * - inline <Badge>Soon</Badge> appended to the label
 * - aria-disabled="true" (preferable to `disabled` for SR Tab inclusion)
 * - hover/click no-ops; tooltip explains
 *
 * PATTERN 30 in apps/frontend/docs/PATTERNS.md.
 */
export function ComingSoonButton({
  tooltipText = 'Coming soon',
  icon,
  size = 'default',
  children,
  className,
  ...rest
}: ComingSoonButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size={size}
          aria-disabled="true"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          className={cn('text-muted-foreground gap-1.5', className)}
          {...rest}
        >
          {icon}
          <span>{children}</span>
          <Badge variant="secondary" className="ml-1 text-2xs uppercase tracking-wide font-medium">
            Soon
          </Badge>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltipText}</TooltipContent>
    </Tooltip>
  )
}
