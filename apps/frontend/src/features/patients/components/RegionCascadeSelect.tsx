import { useState, useRef, useEffect } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import {
  getAllRegions,
  getProvincesByRegion,
  getCitiesByProvince,
} from '@/data/philippine-locations'
import { FormControl, FormItem, FormLabel } from '@/components/ui/form'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'

type Props = {
  region: string
  province: string
  city: string
  barangay: string
  onRegionChange: (v: string) => void
  onProvinceChange: (v: string) => void
  onCityChange: (v: string) => void
  onBarangayChange: (v: string) => void
  disabled?: boolean
}

// ── Single searchable combobox ─────────────────────────────────────────────

function LocationCombobox({
  label,
  placeholder,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string
  placeholder: string
  value: string
  options: string[]
  onChange: (v: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const filtered = search
    ? options.filter((o) => o.toLowerCase().includes(search.toLowerCase()))
    : options

  return (
    <FormItem>
      <FormLabel>{label}</FormLabel>
      <FormControl>
        <div ref={containerRef} className="relative">
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={label}
            className="w-full justify-between font-normal"
            disabled={disabled || options.length === 0}
            onClick={() => setOpen((prev) => !prev)}
          >
            <span className={value ? undefined : 'text-muted-foreground'}>
              {value || placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
          </Button>
          {open && (
            <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-md border border-border bg-popover shadow-md">
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder={`Search ${label.toLowerCase()}…`}
                  value={search}
                  onValueChange={setSearch}
                />
                <CommandList>
                  <CommandEmpty>No result found.</CommandEmpty>
                  <CommandGroup>
                    {filtered.map((opt) => (
                      <CommandItem
                        key={opt}
                        value={opt}
                        onSelect={() => {
                          onChange(opt === value ? '' : opt)
                          setOpen(false)
                          setSearch('')
                        }}
                      >
                        <Check
                          className={`mr-2 h-4 w-4 ${opt === value ? 'opacity-100' : 'opacity-0'}`}
                        />
                        {opt}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </div>
          )}
        </div>
      </FormControl>
    </FormItem>
  )
}

// ── Region cascade ─────────────────────────────────────────────────────────

export default function RegionCascadeSelect({
  region,
  province,
  city,
  barangay,
  onRegionChange,
  onProvinceChange,
  onCityChange,
  onBarangayChange,
  disabled = false,
}: Props) {
  const regions = getAllRegions()
  const provinces = region ? getProvincesByRegion(region) : []
  const cities = region && province ? getCitiesByProvince(region, province) : []

  return (
    <div className="grid grid-cols-2 gap-3">
      <LocationCombobox
        label="Region"
        placeholder="Select region"
        value={region}
        options={regions}
        disabled={disabled}
        onChange={(v) => {
          onRegionChange(v)
          onProvinceChange('')
          onCityChange('')
        }}
      />

      <LocationCombobox
        label="Province"
        placeholder="Select province"
        value={province}
        options={provinces}
        disabled={disabled || provinces.length === 0}
        onChange={(v) => {
          onProvinceChange(v)
          onCityChange('')
        }}
      />

      <LocationCombobox
        label="City / Municipality"
        placeholder="Select city"
        value={city}
        options={cities}
        disabled={disabled || cities.length === 0}
        onChange={onCityChange}
      />

      <FormItem>
        <FormLabel>Barangay</FormLabel>
        <FormControl>
          <Input
            placeholder="e.g. Tandang Sora"
            value={barangay}
            onChange={(e) => onBarangayChange(e.target.value)}
            disabled={disabled}
          />
        </FormControl>
      </FormItem>
    </div>
  )
}
