export const DEFAULT_OBSERVATION_MINUTES = 15

export type ObservationOutcome = 'NoReaction' | 'Reaction' | 'Escalated'
export type ObservationState =
  | 'Observing'
  | 'ReadyForDischarge'
  | 'Reaction'
  | 'Escalated'
  | 'Discharged'

export type ObservationStateInput = {
  observeUntil: Date
  outcome: string | null
  dischargedAt: Date | null
}

/**
 * Derived operational lane for Today and the administration panel.
 * Time reaching `observeUntil` can make a patient ready, but can never make
 * them discharged: only a persisted discharge acknowledgement does that.
 */
export function classifyObservationState(
  observation: ObservationStateInput,
  now = new Date(),
): ObservationState {
  if (observation.dischargedAt) return 'Discharged'
  if (observation.outcome === 'Escalated') return 'Escalated'
  if (observation.outcome === 'Reaction') return 'Reaction'
  if (now >= observation.observeUntil) return 'ReadyForDischarge'
  return 'Observing'
}
