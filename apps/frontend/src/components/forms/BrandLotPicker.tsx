import { useEffect, useMemo } from 'react'
import { PackageSearch } from 'lucide-react'
import { useEligibleLots, type EligibleLot } from '@/features/scheduled-orders/api'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ListEmpty } from '@/components/layout'
import { formatLongDate, formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'

type Props = {
  /** clinical_order display_id (ORD_…) whose eligible brands to list. */
  orderId: string
  /** Selected lot display_id (LOT_…), or null before the list resolves. */
  value: string | null
  onChange: (lotId: string | null, lot: EligibleLot | null) => void
  disabled?: boolean
}

/**
 * Lot picker for administering a dose.
 *
 * One abstract service (`ARVPEP_IM`) can be satisfied by several products
 * (Abhayrab, Speeda, …). The nurse explicitly chooses the physical lot here,
 * after comparing its batch and expiry against the vial in hand. The submitted
 * LOT_ id is the lot recorded on the clinical order and inventory movement.
 *
 * Lots arrive house-brand-first, then earliest-expiring within a brand. Every
 * eligible lot remains visible: collapsing a brand to a representative lot
 * made the final bedside record depend on a hidden FEFO choice.
 *
 * Deliberately NOT the generic `<LotPicker>`: that one searches all in-stock
 * lots tenant-wide for inventory transfers. This one is scoped to what may
 * clinically be given for THIS order at THIS branch, and shows the price
 * consequence of the brand choice.
 */
export default function BrandLotPicker({ orderId, value, onChange, disabled }: Props) {
  const { data, isLoading, isError } = useEligibleLots(orderId)
  const lots = useMemo(() => data?.data ?? [], [data])
  const billed = data?.billedUnitPrice ?? null

  // A concurrent administration can exhaust the representative lot after the
  // nurse makes a brand choice. Clear the stale choice; never replace it with
  // an automatic default.
  useEffect(() => {
    if (value !== null && !lots.some((lot) => lot.id === value)) {
      onChange(null, null)
    }
  }, [lots, onChange, value])

  if (isLoading) {
    return (
      <div className="space-y-1.5">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    )
  }

  if (isError) {
    return (
      <p className="text-xs text-destructive">
        Could not load available brands. Refresh and try again.
      </p>
    )
  }

  if (lots.length === 0) {
    return (
      <div className="rounded-md border border-border">
        <ListEmpty
          icon={PackageSearch}
          message="No brand for this service is in stock at this branch."
        />
      </div>
    )
  }

  return (
    <div
      role="radiogroup"
      aria-label="Vaccine lot"
      className="rounded-md border border-border divide-y divide-border overflow-hidden"
    >
      {lots.map((lot) => {
        const isSelected = lot.id === value
        const surcharge = billed !== null ? Number(lot.unitPrice) - Number(billed) : 0
        const available = !lot.isRecalled && Number(lot.quantityOnHand) > 0
        return (
          <button
            key={lot.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={`${lot.product.name}, lot ${lot.batchNumber}, expires ${formatLongDate(lot.expiryDate)}`}
            disabled={disabled || !available}
            onClick={() => onChange(lot.id, lot)}
            className={cn(
              'w-full text-left px-3 py-2 flex items-start gap-3 transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
              isSelected ? 'bg-primary/5' : 'hover:bg-muted/50',
              (disabled || !available) && 'opacity-60 cursor-not-allowed',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'mt-1 h-3.5 w-3.5 shrink-0 rounded-full border',
                isSelected ? 'border-primary border-[0.25rem]' : 'border-input',
              )}
            />
            <span className="flex-1 min-w-0">
              <span className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-medium">{lot.product.name}</span>
                {lot.isHouseBrand && (
                  <Badge variant="ok" className="text-2xs">
                    House brand
                  </Badge>
                )}
                {lot.isRecalled && (
                  <Badge variant="overdue" className="text-xs px-2 py-0.5">
                    Unavailable: recall
                  </Badge>
                )}
                {surcharge > 0 && (
                  <Badge variant="due" className="text-2xs">
                    {formatMoney(String(surcharge))} over billed
                  </Badge>
                )}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {lot.product.manufacturer ? `${lot.product.manufacturer} · ` : ''}
                Lot <span className="font-mono tabular-nums">{lot.batchNumber}</span>
                {' · expires '}
                <span className="font-mono tabular-nums">{formatLongDate(lot.expiryDate)}</span>
                {' · '}
                <span className="font-mono tabular-nums">{lot.quantityOnHand}</span> in stock
              </span>
            </span>
            <span className="text-sm font-mono tabular-nums shrink-0">
              {formatMoney(lot.unitPrice)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
