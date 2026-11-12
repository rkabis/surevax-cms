import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command'
import { PatientLabel } from '@/components/PatientLabel'
import { usePatientSearch, type Patient } from '../api'

/**
 * Persistent patient search switcher hosted in the patient-record header.
 * Lets the operator jump patient-to-patient without returning to the list.
 *
 * No `<Popover>` primitive exists in this repo, so the dropdown is a
 * self-contained anchored container around a standalone `<Command>` (cmdk).
 * Pressing `/` focuses the input (mirrors PatientList's `/`-to-search).
 */
export function PatientSwitcher() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query), 250)
    return () => clearTimeout(t)
  }, [query])

  // `/` focuses the switcher input (mirror of PatientList's keydown).
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [])

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const { data, isFetching } = usePatientSearch(debouncedQ, debouncedQ.trim().length >= 2)
  const results: Patient[] = data?.data ?? []

  function go(id: string) {
    setOpen(false)
    setQuery('')
    setDebouncedQ('')
    navigate(`/patients/${id}`)
  }

  return (
    <div ref={containerRef} className="relative w-72">
      <Command
        shouldFilter={false}
        className="overflow-visible rounded-md border border-border bg-card"
      >
        <CommandInput
          ref={inputRef}
          value={query}
          onValueChange={(v) => {
            setQuery(v)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder="Switch patient… (/)"
          aria-label="Search patients"
        />
        {open && (
          <CommandList className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-border bg-popover shadow-md">
            {debouncedQ.trim().length < 2 ? (
              <CommandEmpty>Type at least 2 characters to search.</CommandEmpty>
            ) : isFetching && results.length === 0 ? (
              <CommandEmpty>Searching…</CommandEmpty>
            ) : results.length === 0 ? (
              <CommandEmpty>No patients found.</CommandEmpty>
            ) : (
              <CommandGroup>
                {results.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={p.id}
                    onSelect={() => go(p.id)}
                    className="cursor-pointer"
                  >
                    <PatientLabel
                      patient={{
                        displayId: p.id,
                        firstName: p.firstName,
                        lastName: p.lastName,
                        mrn: p.mrn ?? null,
                      }}
                      showMrn
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        )}
      </Command>
    </div>
  )
}

export default PatientSwitcher
