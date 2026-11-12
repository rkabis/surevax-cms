import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { usePatient, usePatientSearch, type Patient } from '@/features/patients/api'
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
 * Searchable, debounced patient picker.
 * Shows Last name, First name · PAT_XXXXXXXX rows.
 * Internally uses usePatientSearch which queries GET /api/patients?q=...
 */
export default function PatientPicker({
  value,
  onChange,
  placeholder = 'Search by patient name…',
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

  const { data, isLoading } = usePatientSearch(debouncedQ, debouncedQ.length >= 2)
  const results: Patient[] = data?.data ?? []

  // When the value arrives from outside (e.g. /initiate-protocol?patientId=…)
  // there is no internally-set label — resolve it so the chip renders instead
  // of an apparently-empty search box.
  const { data: prefilled } = usePatient(value && !selectedLabel ? value : null)
  useEffect(() => {
    if (value && !selectedLabel && prefilled) {
      setSelectedLabel(`${prefilled.lastName}, ${prefilled.firstName}`)
    }
  }, [value, selectedLabel, prefilled])

  function selectPatient(p: Patient) {
    onChange(p.id)
    setSelectedLabel(`${p.lastName}, ${p.firstName}`)
    setQuery('')
    setDebouncedQ('')
    setShowDropdown(false)
  }

  function clearPatient() {
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
        <span className="text-xs text-muted-foreground font-mono tabular-nums">{value}</span>
        {!disabled && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={clearPatient}
            aria-label="Clear patient selection"
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
          if (results.length > 0) setShowDropdown(true)
        }}
        onBlur={() => {
          setTimeout(() => setShowDropdown(false), 200)
        }}
        className="pl-9"
        required={required}
        disabled={disabled}
        aria-label="Search patient"
      />
      {showDropdown && query.length >= 2 && (
        <div className="absolute z-50 top-full mt-1 w-full rounded-md border bg-popover shadow-md">
          {isLoading ? (
            <div className="p-2 space-y-1">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full rounded-sm" />
              ))}
            </div>
          ) : results.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground text-center">No patients found</p>
          ) : (
            <div className="max-h-52 overflow-y-auto">
              {results.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center gap-2"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    selectPatient(p)
                  }}
                >
                  <span className="flex-1 truncate">
                    {p.lastName}, {p.firstName}
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
