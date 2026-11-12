import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Observation } from '../../api'
import {
  ObservationSummaryCard,
  observationDisplayState,
} from '../PostAdministrationObservationPanel'

afterEach(() => cleanup())

const observation: Observation = {
  id: 'OBS_AAAAAAA1',
  durationMinutes: 15,
  observeUntil: '2026-08-23T02:15:00.000Z',
  outcome: null,
  outcomeNotes: null,
  outcomeRecordedAt: null,
  outcomeRecordedBy: null,
  dischargedAt: null,
  dischargedBy: null,
  state: 'Observing',
}

describe('post-administration observation presentation', () => {
  it('does not derive discharge merely because observe-until has passed', () => {
    expect(observationDisplayState(observation, new Date('2026-08-23T02:16:00.000Z'))).toBe(
      'ReadyForDischarge',
    )
  })

  it('renders the configured duration and explicit pending observation state', () => {
    render(<ObservationSummaryCard observation={observation} />)
    expect(screen.getByText('Post-dose observation')).toBeDefined()
    expect(screen.getByText('15 minutes')).toBeDefined()
    expect(screen.queryByText('Discharge acknowledged')).toBeNull()
  })
})
