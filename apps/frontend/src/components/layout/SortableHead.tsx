import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'
import { TableHead } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { SortState } from '@/lib/useTableSort'

type Props = {
  /** Column key — matches `?sort=` param value. */
  col: string
  /** Current sort state from `useTableSort()`. */
  sort: SortState
  /** Click handler from `useTableSort().toggleSort`. */
  onToggle: (col: string) => void
  children: React.ReactNode
  className?: string
}

export function SortableHead({ col, sort, onToggle, children, className }: Props) {
  const active = sort?.col === col
  const order = active ? sort.order : null
  const ariaSort: 'ascending' | 'descending' | 'none' =
    order === 'asc' ? 'ascending' : order === 'desc' ? 'descending' : 'none'

  return (
    <TableHead aria-sort={ariaSort} className={cn('group cursor-pointer select-none', className)}>
      <button
        type="button"
        onClick={() => onToggle(col)}
        className="inline-flex items-center gap-1 text-left w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        <span>{children}</span>
        {!active && (
          <ChevronsUpDown className="h-3 w-3 opacity-40 group-hover:opacity-70" aria-hidden />
        )}
        {order === 'asc' && <ChevronUp className="h-3 w-3" aria-hidden />}
        {order === 'desc' && <ChevronDown className="h-3 w-3" aria-hidden />}
      </button>
    </TableHead>
  )
}
