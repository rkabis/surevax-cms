import * as React from 'react'
import { cn } from '@/lib/utils'

export interface FormSectionProps extends React.HTMLAttributes<HTMLElement> {
  title: string
  description?: React.ReactNode
  /**
   * Tailwind grid column count for the field grid. Defaults to a responsive
   * 1 column on mobile, 2 columns on `sm` and up.
   */
  columns?: 1 | 2 | 3
}

const COLUMN_CLASSES: Record<NonNullable<FormSectionProps['columns']>, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
}

/**
 * Pure layout primitive for sectioned forms. Renders a heading, optional
 * description, and a responsive grid of field children. No data fetching,
 * no validation — just layout.
 *
 * @example
 *   <FormSection title="Demographics" description="Required fields" columns={2}>
 *     <FormField ... />
 *     <FormField ... />
 *   </FormSection>
 */
const FormSection = React.forwardRef<HTMLElement, FormSectionProps>(
  ({ className, title, description, columns = 2, children, ...props }, ref) => (
    <section ref={ref} className={cn('flex flex-col gap-4 py-4', className)} {...props}>
      <header className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </header>
      <div className={cn('grid gap-4', COLUMN_CLASSES[columns])}>{children}</div>
    </section>
  ),
)
FormSection.displayName = 'FormSection'

export { FormSection }
