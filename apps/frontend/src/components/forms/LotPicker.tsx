import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useInventoryLots, type InventoryLot } from '@/features/inventory/api'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

type Props = {
  value: string | null
  onChange: (id: string | null) => void
  branchId?: string
  placeholder?: string
  required?: boolean
  disabled?: boolean
}

/**
 * Searchable, debounced inventory lot picker.
 * Rows show: {batchNumber} · {manufacturer}  LOT_xxxxxxxx  expiry · QOH
 * Internally uses useInventoryLots({ q }) from inventory/api.ts.
 * Filters to in-stock lots (quantityOnHand > 0).
 */
export default function LotPicker({
  value,
  onChange,
  placeholder = 'Search by batch number or manufacturer…',
  required,
  disabled,
}: Props) {
  const [query, setQuery] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [selectedLabel, setSelectedLabel] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query), 250)
    return () => clearTimeout(t)
  }, [query])

  const { data, isLoading } = useInventoryLots({
    q: debouncedQ || undefined,
  })

  // /api/inventory returns { data, summary } envelope
  const lots: InventoryLot[] = (data?.data ?? []).filter((l) => Number(l.quantityOnHand) > 0)

  function selectLot(lot: InventoryLot) {
    onChange(lot.id)
    setSelectedLabel(`${lot.batchNumber} · ${lot.serviceName}`)
    setQuery('')
    setDebouncedQ('')
    setShowDropdown(false)
  }

  function clearLot() {
    onChange(null)
    setSelectedLabel('')
    setQuery('')
    setDebouncedQ('')
    inputRef.current?.focus()
  }

  function formatExpiry(date: string): string {
    try {
      return new Date(date).toLocaleDateString('en-PH', {
        month: 'short',
        year: 'numeric',
      })
    } catch {
      return date
    }
  }

  if (value && selectedLabel) {
    return (
      <div className="flex items-center gap-2 h-10 px-3 rounded-md border border-input bg-muted/50">
        <span className="text-sm flex-1 truncate">{selectedLabel}</span>
        <span className="text-xs text-muted-foreground font-mono tabular-nums shrink-0">
          {value}
        </span>
        {!disabled && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={clearLot}
            aria-label="Clear lot selection"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="relative">
      <Search
        className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
        aria-hidden
      />
      <Input
        ref={inputRef}
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setShowDropdown(true)
        }}
        onFocus={() => {
          if (lots.length > 0) setShowDropdown(true)
        }}
        onBlur={() => {
          setTimeout(() => setShowDropdown(false), 200)
        }}
        className="pl-9"
        required={required}
        disabled={disabled}
        aria-label="Search inventory lot"
      />
      {showDropdown && query.length >= 2 && (
        <div className="absolute z-50 top-full mt-1 w-full rounded-md border bg-popover shadow-md">
          {isLoading ? (
            <div className="p-2 space-y-1">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-sm" />
              ))}
            </div>
          ) : lots.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground text-center">No in-stock lots found</p>
          ) : (
            <div className="max-h-60 overflow-y-auto">
              {lots.map((lot) => (
                <button
                  key={lot.id}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    selectLot(lot)
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate font-medium">{lot.batchNumber}</span>
                    <span className="text-xs text-muted-foreground font-mono tabular-nums shrink-0">
                      {lot.id}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground truncate flex-1">
                      {lot.serviceName}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                      exp {formatExpiry(lot.expiryDate)}
                    </span>
                    <span className="text-xs font-mono tabular-nums text-muted-foreground shrink-0">
                      {lot.quantityOnHand} in stock
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
