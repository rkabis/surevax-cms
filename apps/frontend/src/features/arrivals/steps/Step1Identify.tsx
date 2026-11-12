import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, UserPlus, ChevronRight, Users } from 'lucide-react'
import { differenceInYears, format } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { PageToolbar } from '@/components/layout'
import { cn } from '@/lib/utils'
import {
  usePatients,
  usePatientEncounters,
  type Patient,
  type PatientEncounter,
} from '@/features/patients/api'
import { useArrival } from '../context'
import { useAdvanceShortcut } from '../use-advance-shortcut'
import { toast } from '@/components/ui/toast'

export function getOpenEncounterForArrival(encounters: PatientEncounter[]) {
  return encounters.find(
    (encounter) => encounter.status === 'Open' || encounter.status === 'InProgress',
  )
}

export default function Step1Identify() {
  const navigate = useNavigate()
  const { selectedPatientId, setSelectedPatientId } = useArrival()
  const [query, setQuery] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [candidatePatientId, setCandidatePatientId] = useState<string | null>(null)
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query), 250)
    return () => clearTimeout(t)
  }, [query])

  // Autofocus on mount
  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } =
    usePatients(debouncedQ)

  const allPatients = data?.pages.flatMap((p) => p.data) ?? []
  const candidateEncounters = usePatientEncounters(candidatePatientId, 20)

  function selectAndAdvance(patient: Patient) {
    if (patient.isCrossBranch) {
      setSelectionError(
        'This patient belongs to another branch. Switch to their home branch to start an arrival.',
      )
      return
    }
    setSelectionError(null)
    setSelectedPatientId(patient.id)
    setCandidatePatientId(patient.id)
  }

  useEffect(() => {
    if (!candidatePatientId) return
    if (candidateEncounters.isError) {
      setSelectionError('Could not verify whether this patient has an open encounter. Try again.')
      setCandidatePatientId(null)
      return
    }
    if (!candidateEncounters.isSuccess) return

    const active = getOpenEncounterForArrival(candidateEncounters.data.data)
    setCandidatePatientId(null)
    if (active) {
      toast('Open encounter found', {
        description: 'Resuming the existing visit instead of creating another arrival.',
      })
      navigate(`/encounters?selected=${active.id}`)
      return
    }
    navigate(`/arrivals/encounter?patientId=${candidatePatientId}`)
  }, [
    candidateEncounters.data,
    candidateEncounters.isError,
    candidateEncounters.isSuccess,
    candidatePatientId,
    navigate,
  ])

  // Cmd+Enter advances when a patient is already selected
  useAdvanceShortcut(() => {
    if (selectedPatientId && !candidateEncounters.isFetching) {
      const selectedPatient = allPatients.find((patient) => patient.id === selectedPatientId)
      if (selectedPatient) selectAndAdvance(selectedPatient)
    }
  })

  return (
    <div className="h-full flex flex-col">
      <header className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <h2 className="text-lg font-semibold">Identify Patient</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Search for an existing record. Register a new patient if this is their first visit.
        </p>
      </header>

      <PageToolbar>
        <div className="relative flex-1 max-w-xl">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
            aria-hidden
          />
          <Input
            ref={searchRef}
            type="search"
            placeholder="Search by name or contact number…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            aria-label="Search patients"
          />
        </div>
        <Button
          onClick={() => navigate('/patients/new?returnTo=arrivals')}
          className="gap-1.5 shrink-0"
        >
          <UserPlus className="h-4 w-4" aria-hidden />
          New patient
        </Button>
      </PageToolbar>

      <ScrollArea className="flex-1">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4">
          {selectedPatientId && (
            <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="dot" data-severity="ok" aria-hidden />
              Patient selected — press{' '}
              <kbd className="px-1 py-0.5 rounded border border-border bg-muted font-mono text-2xs">
                ⌘↵
              </kbd>{' '}
              to continue
            </div>
          )}

          {selectionError && <p className="mb-3 text-sm text-destructive">{selectionError}</p>}

          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          )}

          {!isLoading && allPatients.length === 0 && (
            <div className="py-12 text-center">
              <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" aria-hidden />
              <p className="text-sm text-muted-foreground mb-3">
                {debouncedQ
                  ? `No patients matching "${debouncedQ}".`
                  : 'Start typing to search, or register a new patient.'}
              </p>
              <Button
                onClick={() => navigate('/patients/new?returnTo=arrivals')}
                variant="outline"
                className="gap-1.5"
              >
                <UserPlus className="h-4 w-4" aria-hidden />
                Register new patient
              </Button>
            </div>
          )}

          {allPatients.length > 0 && (
            <ul className="border rounded-md overflow-hidden divide-y" role="listbox">
              {allPatients.map((p) => (
                <PatientRow
                  key={p.id}
                  patient={p}
                  isSelected={p.id === selectedPatientId}
                  isChecking={p.id === candidatePatientId && candidateEncounters.isFetching}
                  onSelect={() => selectAndAdvance(p)}
                />
              ))}
            </ul>
          )}

          {hasNextPage && (
            <div className="py-3 text-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

export function PatientRow({
  patient,
  isSelected,
  isChecking,
  onSelect,
}: {
  patient: Patient
  isSelected: boolean
  isChecking: boolean
  onSelect: () => void
}) {
  const age = patient.dateOfBirth
    ? differenceInYears(new Date(), new Date(patient.dateOfBirth))
    : null

  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={isSelected}
        onClick={onSelect}
        disabled={isChecking || patient.isCrossBranch}
        aria-description={
          patient.isCrossBranch
            ? 'Read only. Switch to the patient home branch to start an arrival.'
            : undefined
        }
        className={cn(
          'w-full text-left px-4 py-3 flex items-center gap-3 transition-colors hover:bg-accent group focus-visible:outline-none focus-visible:bg-accent',
          isSelected && 'bg-accent',
          patient.isCrossBranch && 'cursor-not-allowed opacity-70 hover:bg-transparent',
        )}
      >
        {/* severity dot — selected = ok, unselected = muted */}
        <span className="dot shrink-0" data-severity={isSelected ? 'ok' : 'muted'} aria-hidden />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">
            {patient.lastName}, {patient.firstName}
            {patient.middleName ? ` ${patient.middleName[0]}.` : ''}
          </p>
          {/* KV row — demographic sub-line */}
          <p className="text-xs text-muted-foreground truncate font-mono tabular-nums mt-0.5">
            {[
              `MRN ${patient.mrn}`,
              patient.dateOfBirth
                ? `DOB ${format(new Date(patient.dateOfBirth), 'MMM d, yyyy')}`
                : null,
              age !== null ? `${age} yrs` : null,
              patient.contactNumber,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {patient.isCrossBranch ? (
          <Badge variant="outline" className="shrink-0 text-2xs">
            Other branch · read only
          </Badge>
        ) : isChecking ? (
          <Badge variant="info" className="shrink-0 text-2xs">
            checking
          </Badge>
        ) : isSelected ? (
          <Badge variant="ok" className="shrink-0 text-2xs">
            selected
          </Badge>
        ) : (
          <ChevronRight
            className="h-4 w-4 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100"
            aria-hidden
          />
        )}
      </button>
    </li>
  )
}
