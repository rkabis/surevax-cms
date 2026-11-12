import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Determinate progress bar — pure CSS implementation (no Radix dep).
 * Matches shadcn/ui Progress API: `value` 0–100, `className` passthrough.
 */
const Progress = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { value?: number | null }
>(({ className, value, ...props }, ref) => (
  <div
    ref={ref}
    role="progressbar"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={value ?? 0}
    className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)}
    {...props}
  >
    <div
      className="h-full bg-primary transition-all duration-300 ease-in-out"
      style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }}
    />
  </div>
))
Progress.displayName = 'Progress'

export { Progress }
