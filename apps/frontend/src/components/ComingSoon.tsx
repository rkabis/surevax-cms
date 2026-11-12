import { Sparkles, type LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

interface Props {
  title: string
  description?: string
  icon?: LucideIcon
  /** Which phase ships this feature, e.g. "Phase 2" or "Phase 3". When
   *  provided, the card headline reads "Coming in Phase X" instead of the
   *  generic "Coming soon". */
  phase?: string
}

export default function ComingSoon({ title, description, icon, phase }: Props) {
  const Icon = icon ?? Sparkles
  const headline = phase ? `Coming in ${phase}` : 'Coming soon'
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 py-4 border-b border-border">
        {/* Placeholder shell, intentionally simpler than PageHeader. */}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="flex-1 flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center">
            <Icon className="h-10 w-10 text-muted-foreground/30 mx-auto mb-4" aria-hidden />
            <p className="text-base font-medium">{headline}</p>
            <p className="text-sm text-muted-foreground mt-2">
              {title} will appear here once its backend ships.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
