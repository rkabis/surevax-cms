import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatMoney } from '@/lib/format'
import { toCents, fromCents } from '@/lib/money'
import type { PaymentMethod } from '../api'

/**
 * Methods offered for a split leg. Restricted to the payer-less tenders — HMO /
 * Corporate need a payer-profile selection, which is out of scope for the
 * inline split editor (use the post-create "Record payment" dialog for those).
 */
export type SplitMethod = Extract<
  PaymentMethod,
  'Cash' | 'GCash' | 'Maya' | 'Card' | 'BankTransfer'
>

export type SplitLeg = {
  id: string
  method: SplitMethod
  /** Decimal string (PHP). The amount APPLIED to the bill, not cash tendered. */
  amount: string
  reference: string
}

const SPLIT_METHODS: Array<{ value: SplitMethod; label: string }> = [
  { value: 'Cash', label: 'Cash' },
  { value: 'GCash', label: 'GCash' },
  { value: 'Maya', label: 'Maya' },
  { value: 'Card', label: 'Card' },
  { value: 'BankTransfer', label: 'Bank Transfer' },
]

export function newSplitLeg(amount = ''): SplitLeg {
  return { id: crypto.randomUUID(), method: 'Cash', amount, reference: '' }
}

type Props = {
  legs: SplitLeg[]
  onChange: (legs: SplitLeg[]) => void
  /** Net amount (decimal string) the legs sum toward. Under → Pending, exact → Paid. */
  netAmount: string
  /** Pay-on-account may deliberately bank excess as patient credit. */
  allowOverage?: boolean
}

/**
 * Multi-leg payment editor for split tender. Each leg carries its own method +
 * applied amount (+ optional reference). The footer tracks allocated vs.
 * remaining against the net so the cashier can see when the bill is fully
 * settled. Over-allocation is surfaced in red; the parent gates Commit on it.
 */
export function SplitTenderEditor({ legs, onChange, netAmount, allowOverage = false }: Props) {
  const netCents = toCents(netAmount)
  const allocatedCents = legs.reduce((sum, l) => sum + Math.max(0, toCents(l.amount || '0')), 0)
  const remainingCents = netCents - allocatedCents
  const overpays = remainingCents < 0

  function update(id: string, patch: Partial<SplitLeg>) {
    onChange(legs.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  function remove(id: string) {
    onChange(legs.filter((l) => l.id !== id))
  }

  function add() {
    // Seed the new leg with whatever balance is still outstanding.
    onChange([...legs, newSplitLeg(remainingCents > 0 ? fromCents(remainingCents) : '')])
  }

  /** Fill this leg with the balance left after every OTHER leg. */
  function fillRemaining(id: string) {
    const leg = legs.find((l) => l.id === id)
    if (!leg) return
    const others = allocatedCents - Math.max(0, toCents(leg.amount || '0'))
    update(id, { amount: fromCents(Math.max(0, netCents - others)) })
  }

  return (
    <div className="space-y-2">
      {legs.map((leg, i) => (
        <div key={leg.id} className="flex items-end gap-2">
          <div className="w-28 space-y-1 shrink-0">
            {i === 0 && <label className="text-xs text-muted-foreground">Method</label>}
            <Select
              value={leg.method}
              onValueChange={(v) => update(leg.id, { method: v as SplitMethod })}
            >
              {/* The visible "Method" label renders only above the first leg
                  (it reads as a column header), and it carries no htmlFor, so
                  without this every leg's control was an unnamed combobox to a
                  screen reader. Name each one by its leg position. */}
              <SelectTrigger className="h-9" aria-label={`Payment ${i + 1} method`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPLIT_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 space-y-1 min-w-0">
            {i === 0 && <label className="text-xs text-muted-foreground">Amount</label>}
            <Input
              inputMode="decimal"
              className="h-9 font-mono"
              placeholder="0.00"
              aria-label={`Payment ${i + 1} amount`}
              value={leg.amount}
              onChange={(e) => update(leg.id, { amount: e.target.value.replace(/[^0-9.]/g, '') })}
              onDoubleClick={() => fillRemaining(leg.id)}
              title="Double-click to fill the remaining balance"
            />
          </div>
          <div className="flex-1 space-y-1 min-w-0">
            {i === 0 && <label className="text-xs text-muted-foreground">Reference</label>}
            <Input
              className="h-9"
              placeholder={leg.method === 'Cash' ? '—' : 'Ref #'}
              aria-label={`Payment ${i + 1} reference`}
              value={leg.reference}
              disabled={leg.method === 'Cash'}
              onChange={(e) => update(leg.id, { reference: e.target.value })}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => remove(leg.id)}
            disabled={legs.length <= 1}
            aria-label="Remove payment method"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      ))}

      <div className="flex items-center justify-between pt-1">
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="h-3.5 w-3.5 mr-1" aria-hidden /> Add method
        </Button>
        <div className="text-sm tabular-nums">
          <span className="text-muted-foreground">Allocated </span>
          <span className="font-mono font-medium">{formatMoney(fromCents(allocatedCents))}</span>
          <span className="text-muted-foreground"> · </span>
          <span
            className={
              overpays && !allowOverage
                ? 'text-destructive font-medium'
                : remainingCents === 0
                  ? 'text-triage-ok font-medium'
                  : 'text-muted-foreground'
            }
          >
            {overpays
              ? `${allowOverage ? 'Excess' : 'Over by'} ${formatMoney(fromCents(-remainingCents))}`
              : `Remaining ${formatMoney(fromCents(remainingCents))}`}
          </span>
        </div>
      </div>
    </div>
  )
}
