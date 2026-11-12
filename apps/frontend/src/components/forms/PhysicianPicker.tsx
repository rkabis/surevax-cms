import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { usePhysicians, type PhysicianOption } from '@/features/standing-orders/api'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

type Props = {
  value: string | null
  onChange: (id: string | null) => void
  placeholder?: string
  required?: boolean
  disabled?: boolean
  error?: string
}

/**
 * Searchable, debounced physician picker.
 * Shows "Dr. Last, First" rows filtered by name.
 * Internally uses usePhysicians which queries GET /api/branch/physicians.
 * Emits the physician's display_id (USR_…) string on selection.
 */
export default function PhysicianPicker({
  value,
  onChange,
  placeholder = 'Search by physician name…',
  required,
  disabled,
  error,
}: Props) {
  const [query, setQuery] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [selectedLabel, setSelectedLabel] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const { data, isLoading } = usePhysicians()
  const all: PhysicianOption[] = (data ?? []).filter((p) => p.isActive)

  const results =
    query.length >= 2
      ? all.filter((p) => {
          const full = `${p.firstName} ${p.lastName} ${p.lastName} ${p.firstName}`.toLowerCase()
          return full.includes(query.toLowerCase())
        })
      : all

  useEffect(() => {
    // When value is cleared externally, reset label
    if (!value) setSelectedLabel('')
  }, [value])

  function selectPhysician(p: PhysicianOption) {
    onChange(p.id)
    setSelectedLabel(`Dr. ${p.lastName}, ${p.firstName}`)
    setQuery('')
    setShowDropdown(false)
  }

  function clearPhysician() {
    onChange(null)
    setSelectedLabel('')
    setQuery('')
    inputRef.current?.focus()
  }

  if (value && selectedLabel) {
    return (
      <div
        className={[
          'flex items-center gap-2 h-10 px-3 rounded-md border bg-muted/50',
          error ? 'border-destructive' : 'border-input',
        ].join(' ')}
      >
        <span className="text-sm flex-1 truncate">{selectedLabel}</span>
        <span className="text-xs text-muted-foreground font-mono tabular-nums">{value}</span>
        {!disabled && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={clearPhysician}
            aria-label="Clear physician selection"
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
        placeholder={isLoading ? 'Loading physicians…' : placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setShowDropdown(true)
        }}
        onFocus={() => setShowDropdown(true)}
        onBlur={() => {
          setTimeout(() => setShowDropdown(false), 200)
        }}
        className={['pl-9', error ? 'border-destructive' : ''].join(' ')}
        required={required}
        disabled={disabled || isLoading}
        aria-label="Search physician"
      />
      {showDropdown && (
        <div className="absolute z-50 top-full mt-1 w-full rounded-md border bg-popover shadow-md">
          {isLoading ? (
            <div className="p-2 space-y-1">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full rounded-sm" />
              ))}
            </div>
          ) : results.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground text-center">
              {query.length >= 2 ? 'No physicians match.' : 'No active physicians at this branch.'}
            </p>
          ) : (
            <div className="max-h-52 overflow-y-auto">
              {results.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center gap-2"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    selectPhysician(p)
                  }}
                >
                  <span className="flex-1 truncate">
                    Dr. {p.lastName}, {p.firstName}
                  </span>
                  <span className="text-xs text-muted-foreground font-mono tabular-nums shrink-0">
                    {p.id}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
