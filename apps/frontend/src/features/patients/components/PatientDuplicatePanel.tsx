import { useEffect, useState, useMemo } from 'react'
import { AlertTriangle, UserCheck, Loader2 } from 'lucide-react'
import { usePatientSearch, type Patient } from '../api'
import { Button } from '@/components/ui/button'
import { format, differenceInYears } from 'date-fns'

type Props = {
  firstName: string
  lastName: string
  dateOfBirth: string
  onSelectExisting?: (id: string) => void
  onExactMatchChange?: (hasExactMatch: boolean) => void
}

function normalize(s: string) {
  return s.trim().toLowerCase()
}

function CandidateRow({
  patient,
  isExact,
  onUse,
}: {
  patient: Patient
  isExact: boolean
  onUse: () => void
}) {
  const age = patient.dateOfBirth
    ? differenceInYears(new Date(), new Date(patient.dateOfBirth))
    : null
  const dobLabel = patient.dateOfBirth ? format(new Date(patient.dateOfBirth), 'MMM d, yyyy') : '—'

  return (
    <div
      className={
        'flex items-center gap-3 px-3 py-2 border rounded-md text-sm ' +
        (isExact
          ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/30'
          : 'border-border bg-muted/30')
      }
    >
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">
          {patient.lastName}, {patient.firstName}
          {patient.middleName ? ` ${patient.middleName[0]}.` : ''}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {[dobLabel, age !== null ? `${age} yrs` : null, patient.sex, patient.contactNumber]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant={isExact ? 'default' : 'outline'}
        onClick={onUse}
        className="h-7 text-xs gap-1 shrink-0"
      >
        <UserCheck className="h-3.5 w-3.5" aria-hidden />
        Use
      </Button>
    </div>
  )
}

export default function PatientDuplicatePanel({
  firstName,
  lastName,
  dateOfBirth,
  onSelectExisting,
  onExactMatchChange,
}: Props) {
  const [debounced, setDebounced] = useState({ first: '', last: '' })

  // Debounce ~250ms on name fields. DOB is checked locally and doesn't need debouncing.
  useEffect(() => {
    const t = setTimeout(
      () =>
        setDebounced({
          first: firstName.trim(),
          last: lastName.trim(),
        }),
      250,
    )
    return () => clearTimeout(t)
  }, [firstName, lastName])

  const q = [debounced.first, debounced.last].filter(Boolean).join(' ').trim()
  const enabled = q.length >= 2

  const { data, isFetching } = usePatientSearch(q, enabled)

  const candidates = useMemo(() => data?.data ?? [], [data?.data])

  const exactMatch = useMemo(() => {
    if (!firstName.trim() || !lastName.trim() || !dateOfBirth) return null
    const f = normalize(firstName)
    const l = normalize(lastName)
    return (
      candidates.find(
        (p) =>
          normalize(p.firstName) === f &&
          normalize(p.lastName) === l &&
          p.dateOfBirth &&
          p.dateOfBirth.slice(0, 10) === dateOfBirth.slice(0, 10),
      ) ?? null
    )
  }, [candidates, firstName, lastName, dateOfBirth])

  useEffect(() => {
    onExactMatchChange?.(!!exactMatch)
  }, [exactMatch, onExactMatchChange])

  if (!enabled) {
    return null
  }

  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2" aria-live="polite">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Possible matches
        </p>
        {isFetching && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />
        )}
      </div>

      {exactMatch && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" aria-hidden />
          <p className="text-amber-900 dark:text-amber-200">
            A patient with the same name and date of birth already exists. Select them below or
            check &ldquo;Create anyway&rdquo; to override.
          </p>
        </div>
      )}

      {!isFetching && candidates.length === 0 && (
        <p className="text-xs text-muted-foreground">No similar patients found.</p>
      )}

      {candidates.length > 0 && (
        <div className="space-y-1.5">
          {candidates.slice(0, 5).map((p) => (
            <CandidateRow
              key={p.id}
              patient={p}
              isExact={exactMatch?.id === p.id}
              onUse={() => onSelectExisting?.(p.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
