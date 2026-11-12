import { Workflow, AlertCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ListEmpty } from '@/components/layout'
import { useStandingOrderTemplatesWithItems, type StandingOrderTemplateWithItems } from '../api'

type Props = {
  selectedId: string | null
  onSelect: (template: StandingOrderTemplateWithItems) => void
}

export default function TemplatePicker({ selectedId, onSelect }: Props) {
  const { data, isLoading, isError } = useStandingOrderTemplatesWithItems()

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 text-destructive text-sm">
        <AlertCircle className="h-4 w-4" aria-hidden />
        Failed to load templates.
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <ListEmpty
        icon={Workflow}
        message="No active standing-order templates available."
        className="px-0"
      />
    )
  }

  return (
    <div className="space-y-2">
      {data.map((t) => {
        const selected = t.id === selectedId
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t)}
            className={[
              'w-full text-left border rounded-md px-3 py-2 transition-colors',
              selected
                ? 'border-primary bg-primary/5 ring-1 ring-primary'
                : 'border-border hover:bg-accent/50',
            ].join(' ')}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-xs text-muted-foreground shrink-0">{t.code}</span>
                <span className="font-medium text-sm truncate">{t.name}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge variant="outline">v{t.version}</Badge>
                <Badge variant="outline">
                  {t.items.length} {t.items.length === 1 ? 'item' : 'items'}
                </Badge>
                {t.requiresPhysicianAuth && <Badge variant="due">MD auth</Badge>}
              </div>
            </div>
            {t.description && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.description}</p>
            )}
          </button>
        )
      })}
    </div>
  )
}
