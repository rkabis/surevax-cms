import { useRef, useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { ICD10_CODES } from '@/data/icd10'

type Props = {
  value: string // ICD-10 code, e.g. "A82.9"
  onChange: (code: string, description: string) => void
  required?: boolean
  placeholder?: string
  ariaInvalid?: boolean
}

const DEFAULT_PLACEHOLDER = 'Search ICD-10 code or term…'
const MAX_DEFAULT_SHOWN = 20

/**
 * Combobox picker for ABTC-relevant ICD-10 codes.
 * Uses shadcn <Command> in a custom dropdown (no @radix-ui/react-popover needed).
 * - Trigger shows "{code} — {description}" once selected.
 * - Filters by code prefix OR description substring (case-insensitive).
 * - Empty search shows first 20 entries to avoid rendering all 100+ at once.
 */
export default function ICD10Picker({
  value,
  onChange,
  required,
  placeholder = DEFAULT_PLACEHOLDER,
  ariaInvalid,
}: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = value ? ICD10_CODES.find((e) => e.code === value) : undefined

  const filtered = search.trim()
    ? ICD10_CODES.filter(
        (e) =>
          e.code.toLowerCase().startsWith(search.toLowerCase()) ||
          e.description.toLowerCase().includes(search.toLowerCase()),
      )
    : ICD10_CODES.slice(0, MAX_DEFAULT_SHOWN)

  // Group entries by chapter for display
  const grouped = filtered.reduce<Record<string, typeof filtered>>((acc, entry) => {
    const ch = entry.chapter ?? 'Other'
    if (!acc[ch]) acc[ch] = []
    acc[ch].push(entry)
    return acc
  }, {})

  function handleSelect(code: string, description: string) {
    onChange(code, description)
    setSearch('')
    setOpen(false)
  }

  function handleBlur(e: React.FocusEvent) {
    // Close only if focus leaves the entire picker container
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className="relative" onBlur={handleBlur}>
      <Button
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={open}
        aria-invalid={ariaInvalid}
        aria-required={required}
        className={cn(
          'w-full justify-between h-8 px-3 font-normal text-sm',
          !selected && 'text-muted-foreground',
        )}
        onClick={() => setOpen((v) => !v)}
      >
        {selected ? (
          <span className="flex items-center gap-1 truncate">
            <span className="font-mono tabular-nums shrink-0">{selected.code}</span>
            <span className="text-muted-foreground shrink-0"> — </span>
            <span className="truncate">{selected.description}</span>
          </span>
        ) : (
          placeholder
        )}
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
      </Button>

      {open && (
        <div className="absolute z-50 top-full mt-1 w-full min-w-[22.5rem] rounded-md border border-border bg-popover shadow-md">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={placeholder}
              value={search}
              onValueChange={setSearch}
              autoFocus
            />
            <CommandList className="max-h-[16.25rem]">
              {filtered.length === 0 && <CommandEmpty>No ICD-10 code found.</CommandEmpty>}
              {Object.entries(grouped).map(([chapter, entries]) => (
                <CommandGroup key={chapter} heading={chapter}>
                  {entries.map((entry) => (
                    <CommandItem
                      key={entry.code}
                      value={entry.code}
                      onSelect={() => handleSelect(entry.code, entry.description)}
                      className="flex items-center gap-2"
                    >
                      <Check
                        className={cn(
                          'h-4 w-4 shrink-0',
                          value === entry.code ? 'opacity-100' : 'opacity-0',
                        )}
                        aria-hidden
                      />
                      <span className="font-mono tabular-nums text-xs shrink-0 w-16">
                        {entry.code}
                      </span>
                      <span className="truncate text-sm">{entry.description}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </div>
      )}
    </div>
  )
}
