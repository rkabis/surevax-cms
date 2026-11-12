import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useInventoryProducts, type InventoryProduct } from '@/features/inventory/api'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

type Props = {
  value: string | null
  onChange: (id: string | null) => void
  placeholder?: string
  required?: boolean
  disabled?: boolean
}

/**
 * Searchable product picker for the receive-stock flow. Products are the
 * physical SKU a lot is of (post-0011 inventory model), distinct from the
 * abstract `service_catalog` entity `<ServicePicker>` searches. Rows show:
 * {name}  {manufacturer}
 */
export default function ProductPicker({
  value,
  onChange,
  placeholder = 'Search by product name or manufacturer…',
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

  const { data, isLoading } = useInventoryProducts(debouncedQ)
  const products: InventoryProduct[] = data ?? []

  function selectProduct(p: InventoryProduct) {
    onChange(p.id)
    setSelectedLabel(p.name)
    setQuery('')
    setDebouncedQ('')
    setShowDropdown(false)
  }

  function clearProduct() {
    onChange(null)
    setSelectedLabel('')
    setQuery('')
    setDebouncedQ('')
    inputRef.current?.focus()
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
            onClick={clearProduct}
            aria-label="Clear product selection"
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
        onFocus={() => setShowDropdown(true)}
        onBlur={() => {
          setTimeout(() => setShowDropdown(false), 200)
        }}
        className="pl-9"
        required={required}
        disabled={disabled}
        aria-label="Search product"
      />
      {showDropdown && (
        <div className="absolute z-50 top-full mt-1 w-full min-w-[20rem] rounded-md border bg-popover shadow-md">
          {isLoading ? (
            <div className="p-2 space-y-1">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-sm" />
              ))}
            </div>
          ) : products.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground text-center">No products found</p>
          ) : (
            <div className="max-h-60 overflow-y-auto">
              {products.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    selectProduct(p)
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate font-medium">{p.name}</span>
                    <span className="text-xs text-muted-foreground font-mono tabular-nums shrink-0">
                      {p.id}
                    </span>
                  </div>
                  {p.manufacturer && (
                    <div className="text-xs text-muted-foreground mt-0.5">{p.manufacturer}</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
