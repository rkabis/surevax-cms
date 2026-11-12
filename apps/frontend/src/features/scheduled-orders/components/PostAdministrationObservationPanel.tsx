import { useEffect, useState } from 'react'
import { AlertCircle, Clock3 } from 'lucide-react'
import {
  ApiError,
  useRecordObservationAction,
  type Observation,
  type ObservationActionBody,
} from '../api'
import AdministeredByField, {
  isAdministeredByComplete,
  type AdministeredByValue,
} from './AdministeredByField'
import { useAuth } from '@/features/auth/context'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatLongDateTime } from '@/lib/format'

type Outcome = 'NoReaction' | 'Reaction' | 'Escalated'

export function observationDisplayState(observation: Observation, now = new Date()) {
  if (observation.dischargedAt) return 'Discharged' as const
  if (observation.outcome === 'Escalated') return 'Escalated' as const
  if (observation.outcome === 'Reaction') return 'Reaction' as const
  if (now >= new Date(observation.observeUntil)) return 'ReadyForDischarge' as const
  return 'Observing' as const
}

const STATE_LABEL = {
  Observing: 'Observing',
  ReadyForDischarge: 'Ready for discharge',
  Reaction: 'Reaction recorded',
  Escalated: 'Escalated',
  Discharged: 'Discharge acknowledged',
} as const

export function ObservationSummaryCard({ observation }: { observation: Observation }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  const state = observationDisplayState(observation, now)
  return (
    <div className="space-y-2 rounded-md border bg-muted/40 px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-medium">
          <Clock3 className="h-4 w-4" aria-hidden />
          Post-dose observation
        </span>
        <Badge variant={state === 'Discharged' ? 'ok' : state === 'Observing' ? 'info' : 'due'}>
          {STATE_LABEL[state]}
        </Badge>
      </div>
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">Observe until</span>
        <span className="font-mono tabular-nums">
          {formatLongDateTime(observation.observeUntil)}
        </span>
      </div>
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">Duration</span>
        <span className="font-mono tabular-nums">{observation.durationMinutes} minutes</span>
      </div>
      {observation.outcome && (
        <div className="flex justify-between gap-3">
          <span className="text-muted-foreground">Outcome</span>
          <span>
            {
              STATE_LABEL[
                observation.outcome === 'NoReaction' ? 'ReadyForDischarge' : observation.outcome
              ]
            }
          </span>
        </div>
      )}
      {observation.outcomeNotes && (
        <p className="text-muted-foreground">{observation.outcomeNotes}</p>
      )}
      {observation.dischargedAt && (
        <div className="flex justify-between gap-3">
          <span className="text-muted-foreground">Acknowledged</span>
          <span className="font-mono tabular-nums">
            {formatLongDateTime(observation.dischargedAt)}
          </span>
        </div>
      )}
    </div>
  )
}

export default function PostAdministrationObservationPanel({
  orderId,
  initialObservation,
  onObservationChange,
}: {
  orderId: string
  initialObservation: Observation
  onObservationChange?: (observation: Observation) => void
}) {
  const { user } = useAuth()
  const [observation, setObservation] = useState(initialObservation)
  const [outcome, setOutcome] = useState<Outcome>('NoReaction')
  const [notes, setNotes] = useState('')
  const [attestation, setAttestation] = useState<AdministeredByValue>({
    administeredById: null,
    attestationPin: null,
  })
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000)
    return () => window.clearInterval(timer)
  }, [])
  const action = useRecordObservationAction()
  const displayState = observationDisplayState(observation, now)
  const notesRequired = outcome === 'Reaction' || outcome === 'Escalated'
  const attestationComplete = isAdministeredByComplete(attestation, user?.role)
  function submit(body: ObservationActionBody) {
    setError(null)
    setErrorCode(null)
    action.mutate(
      { id: orderId, body },
      {
        onSuccess: (next) => {
          setObservation(next)
          onObservationChange?.(next)
          setAttestation({ administeredById: null, attestationPin: null })
        },
        onError: (err) => {
          setError(err.message)
          setErrorCode(err instanceof ApiError ? (err.code ?? null) : null)
        },
      },
    )
  }

  const attestationBody = attestation.administeredById
    ? {
        attestedById: attestation.administeredById,
        attestationPin: attestation.attestationPin ?? '',
      }
    : {}

  return (
    <div className="space-y-3">
      <ObservationSummaryCard observation={observation} />

      {displayState !== 'Discharged' && !observation.outcome && (
        <div className="space-y-3 rounded-md border px-4 py-3">
          <div className="space-y-1.5">
            <Label htmlFor="observation-outcome">Observation outcome</Label>
            <Select value={outcome} onValueChange={(value) => setOutcome(value as Outcome)}>
              <SelectTrigger id="observation-outcome">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NoReaction">No reaction</SelectItem>
                <SelectItem value="Reaction">Reaction</SelectItem>
                <SelectItem value="Escalated">Escalated</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {notesRequired && (
            <div className="space-y-1.5">
              <Label htmlFor="observation-notes">Clinical note</Label>
              <Textarea
                id="observation-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Record what was observed and the action taken"
              />
            </div>
          )}
          <AdministeredByField
            purpose="observation"
            value={attestation}
            onChange={setAttestation}
            disabled={action.isPending}
            validationError={errorCode?.startsWith('ATTESTATION_') ? error : null}
          />
          <Button
            onClick={() =>
              submit({
                action: 'record_outcome',
                outcome,
                ...(notes.trim() ? { notes: notes.trim() } : {}),
                ...attestationBody,
              })
            }
            disabled={
              action.isPending ||
              !attestationComplete ||
              (notesRequired && notes.trim().length < 5) ||
              (outcome === 'NoReaction' && displayState === 'Observing')
            }
          >
            {action.isPending ? 'Recording…' : 'Record outcome'}
          </Button>
          {outcome === 'NoReaction' && displayState === 'Observing' && (
            <p className="text-xs text-muted-foreground">
              No reaction can be recorded when the observation period ends. The patient is not
              discharged automatically.
            </p>
          )}
        </div>
      )}

      {displayState !== 'Discharged' && observation.outcome && (
        <div className="space-y-3 rounded-md border px-4 py-3">
          <p className="text-sm">
            Discharge remains pending until a clinician explicitly acknowledges it.
          </p>
          <AdministeredByField
            purpose="observation"
            value={attestation}
            onChange={setAttestation}
            disabled={action.isPending}
            validationError={errorCode?.startsWith('ATTESTATION_') ? error : null}
          />
          <Button
            onClick={() => submit({ action: 'acknowledge_discharge', ...attestationBody })}
            disabled={action.isPending || !attestationComplete}
          >
            {action.isPending ? 'Recording…' : 'Acknowledge discharge'}
          </Button>
        </div>
      )}

      {error && !errorCode?.startsWith('ATTESTATION_') && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" aria-hidden />
          <AlertTitle>Observation action was not recorded</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
