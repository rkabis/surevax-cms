import { useState, useRef, useCallback } from 'react'
import { apiFetch } from '@/lib/apiFetch'
import { Input } from '@/components/ui/input'

type PlacePrediction = {
  placeId: string
  description: string
  mainText: string
  secondaryText: string
}

type AddressComponents = {
  streetAddress: string
  barangay: string
  city: string
  province: string
  region: string
}

type Props = {
  value: string
  onChange: (value: string) => void
  onPlaceSelected: (components: AddressComponents) => void
  placeholder?: string
  disabled?: boolean
}

export default function AddressAutocomplete({
  value,
  onChange,
  onPlaceSelected,
  placeholder = 'Start typing an address...',
  disabled = false,
}: Props) {
  const [predictions, setPredictions] = useState<PlacePrediction[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const containerRef = useRef<HTMLDivElement>(null)

  const fetchPredictions = useCallback(async (input: string) => {
    if (input.trim().length < 3) {
      setPredictions([])
      setIsOpen(false)
      return
    }

    setIsLoading(true)
    setLookupError(null)
    try {
      const params = new URLSearchParams({ input })
      const data = await apiFetch<{ predictions: PlacePrediction[] }>(
        `/api/places/autocomplete?${params}`,
      )
      setPredictions(data.predictions ?? [])
      setIsOpen((data.predictions?.length ?? 0) > 0)
    } catch (err: unknown) {
      setPredictions([])
      setIsOpen(false)
      const code =
        err && typeof err === 'object' && 'code' in err ? (err as { code?: string }).code : null
      if (code === 'SERVICE_UNAVAILABLE') {
        setLookupError('SERVICE_UNAVAILABLE')
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setLookupError(null)
    onChange(v)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchPredictions(v), 300)
  }

  const handleSelect = async (prediction: PlacePrediction) => {
    onChange(prediction.description)
    setPredictions([])
    setIsOpen(false)

    try {
      const params = new URLSearchParams({ place_id: prediction.placeId })
      const data = await apiFetch<{
        components: AddressComponents
        formattedAddress: string
      }>(`/api/places/details?${params}`)
      onPlaceSelected(data.components)
    } catch {
      // Silently fall back — street address is still set from description
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <Input
        value={value}
        onChange={handleInputChange}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={isOpen}
        aria-autocomplete="list"
      />
      {lookupError === 'SERVICE_UNAVAILABLE' && (
        <p className="text-xs text-muted-foreground mt-1">
          Address lookup unavailable — fill the fields below manually.
        </p>
      )}
      {isLoading && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
        </div>
      )}
      {isOpen && predictions.length > 0 && (
        <ul
          className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-md max-h-60 overflow-y-auto"
          role="listbox"
        >
          {predictions.map((p) => (
            <li
              key={p.placeId}
              role="option"
              aria-selected={false}
              className="cursor-pointer px-3 py-2 text-sm hover:bg-accent"
              onMouseDown={(e) => {
                e.preventDefault()
                handleSelect(p)
              }}
            >
              <span className="font-medium text-foreground">{p.mainText}</span>
              {p.secondaryText && (
                <span className="text-muted-foreground ml-1 text-xs">{p.secondaryText}</span>
              )}
            </li>
          ))}
          <li className="px-3 py-1.5 text-xs text-muted-foreground border-t">Powered by Google</li>
        </ul>
      )}
    </div>
  )
}
