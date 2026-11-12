import { useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useServices, type Service } from '@/features/services/api'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatMoney } from '@/lib/format'

type Props = {
  value: string | null
  onChange: (id: string | null) => void
  /** Payer display_id — reserved for future per-payer price display. Not used in filtering. */
  payerId?: string | null
  placeholder?: string
  required?: boolean
  disabled?: boolean
}

function matchesQuery(s: Service, q: string): boolean {
  const lower = q.toLowerCase()
  return (
    s.name.toLowerCase().includes(lower) ||
    s.code.toLowerCase().includes(lower) ||
    (s.sku != null && s.sku.toLowerCase().includes(lower))
  )
}

/**
 * Searchable service picker — combobox over the active service catalog.
 *
 * Performs client-side filtering over the cached `useServices('')` result so
 * the catalog is fetched once (shared with TransactionsCreatePage) and not
 * duplicated. The 32 panel-constituent rows (`isActive = false`) are excluded.
 *
 * Row anatomy:
 *   {name}                       {code badge}
 *   {serviceType} · PHP {price}
 */
export default function ServicePicker({
  value,
  onChange,
  placeholder = 'Search by service name or code…',
  required,
  disabled,
}: Props) {
  const [query, setQuery] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [selectedLabel, setSelectedLabel] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: allServices, isLoading } = useServices('')

  const activeServices = useMemo(() => (allServices ?? []).filter((s) => s.isActive), [allServices])

  const results = useMemo(() => {
    if (!query || query.length < 1) return activeServices.slice(0, 50)
    return activeServices.filter((s) => matchesQuery(s, query)).slice(0, 80)
  }, [activeServices, query])

  function selectService(s: Service) {
    onChange(s.id)
    setSelectedLabel(s.name)
    setQuery('')
    setShowDropdown(false)
  }

  function clearService() {
    onChange(null)
    setSelectedLabel('')
    setQuery('')
    inputRef.current?.focus()
  }

  if (value && selectedLabel) {
    // Find the selected service for the sub-line display
    const selected = activeServices.find((s) => s.id === value)
    return (
      <div className="flex items-center gap-2 h-10 px-3 rounded-md border border-input bg-muted/50">
        <span className="text-sm flex-1 truncate">{selectedLabel}</span>
        <span className="text-xs text-muted-foreground font-mono tabular-nums shrink-0">
          {selected?.code ?? value}
        </span>
        {!disabled && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={clearService}
            aria-label="Clear service selection"
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
        aria-label="Search service"
      />
      {showDropdown && (
        <div className="absolute z-50 top-full mt-1 w-full min-w-[20rem] rounded-md border bg-popover shadow-md">
          {isLoading ? (
            <div className="p-2 space-y-1">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-sm" />
              ))}
            </div>
          ) : results.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground text-center">No services found</p>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {results.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    selectService(s)
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate font-medium">{s.name}</span>
                    <span className="text-xs text-muted-foreground font-mono tabular-nums shrink-0">
                      {s.code}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {s.serviceType}
                    {s.basePrice ? (
                      <>
                        {' · '}
                        <span className="font-mono tabular-nums">{formatMoney(s.basePrice)}</span>
                      </>
                    ) : null}
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
