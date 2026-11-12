/**
 * Arrival wizard state.
 *
 * State persists in two places so refresh, back-button, and tab-switch
 * all keep the wizard intact:
 *   - URL search params (`?patientId=…&encounterId=…&standingOrderId=…`)
 *     so a deep link to /arrivals/encounter resumes mid-wizard
 *   - sessionStorage as a fallback for params dropped accidentally
 *
 * Storage is user-scoped: the persisted JSON includes the authenticated
 * user's id. On hydration, if the stored userId does not match the current
 * user (kiosk pattern — different nurse logs in on the same tab), the draft
 * is discarded and the wizard starts fresh. This prevents PHI leaking from
 * one user's session to another's.
 *
 * This is a tiny piece of state (3 ids + 4 setters) so we hand-roll a
 * Context rather than reach for a state library.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '@/features/auth/context'

const STORAGE_KEY = 'surevax.arrival-wizard'

export type EncounterDraft = {
  specialty: 'Rabies' | 'Flu' | 'Vaccination' | 'General'
  chiefComplaint?: string
  vitals?: Record<string, unknown>
  biteAssessment?: Record<string, unknown>
  /** Arrival consent is captured in Step 2 before protocol creation. */
  consentBy?: 'Patient' | 'Guardian'
  consentObtained?: boolean
}

export type ArrivalState = {
  selectedPatientId: string | null
  encounterId: string | null
  standingOrderId: string | null
  encounterDraft: EncounterDraft | null
}

type ArrivalContextValue = ArrivalState & {
  setSelectedPatientId: (id: string | null) => void
  setEncounterId: (id: string | null) => void
  setStandingOrderId: (id: string | null) => void
  setEncounterDraft: (draft: EncounterDraft | null) => void
  reset: () => void
}

const ArrivalContext = createContext<ArrivalContextValue | null>(null)

/** Shape of the JSON stored in sessionStorage under STORAGE_KEY. */
type WizardStorage = {
  userId: string
  state: Omit<ArrivalState, 'encounterDraft'> & { encounterDraft?: EncounterDraft | null }
}

function readSessionStorage(currentUserId: string | undefined): Partial<ArrivalState> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return {}

    // Legacy shape (no userId field) — discard to be safe.
    if (!('userId' in parsed)) return {}

    const stored = parsed as WizardStorage
    // If userId mismatches (different user on same tab), discard entirely.
    if (!currentUserId || stored.userId !== currentUserId) return {}

    return stored.state
  } catch {
    return {}
  }
}

function writeSessionStorage(userId: string | undefined, state: ArrivalState) {
  if (!userId) return
  try {
    const payload: WizardStorage = { userId, state }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // ignore quota / private mode
  }
}

export function ArrivalProvider({ children }: { children: React.ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()

  const [encounterDraft, setEncounterDraft] = useState<EncounterDraft | null>(null)

  // Hydrate from URL → sessionStorage on mount only. URL wins.
  // userId check ensures cross-user PHI cannot bleed between sessions.
  useEffect(() => {
    const stored = readSessionStorage(user?.id)
    const merged: Record<string, string> = {}
    if (searchParams.get('patientId')) merged.patientId = searchParams.get('patientId')!
    else if (stored.selectedPatientId) merged.patientId = stored.selectedPatientId
    if (searchParams.get('encounterId')) merged.encounterId = searchParams.get('encounterId')!
    else if (stored.encounterId) merged.encounterId = stored.encounterId
    if (searchParams.get('standingOrderId'))
      merged.standingOrderId = searchParams.get('standingOrderId')!
    else if (stored.standingOrderId) merged.standingOrderId = stored.standingOrderId

    if (stored.encounterDraft) {
      setEncounterDraft(stored.encounterDraft)
    }

    // If we pulled anything from sessionStorage that wasn't in the URL, push to URL.
    let mutated = false
    const next = new URLSearchParams(searchParams)
    for (const [k, v] of Object.entries(merged)) {
      if (v && !next.get(k)) {
        next.set(k, v)
        mutated = true
      }
    }
    if (mutated) setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const state = useMemo<ArrivalState>(
    () => ({
      selectedPatientId: searchParams.get('patientId'),
      encounterId: searchParams.get('encounterId'),
      standingOrderId: searchParams.get('standingOrderId'),
      encounterDraft,
    }),
    [searchParams, encounterDraft],
  )

  // Mirror to sessionStorage whenever URL params or draft change.
  // Include userId so a different user can't hydrate this draft.
  useEffect(() => {
    writeSessionStorage(user?.id, state)
  }, [state, user?.id])

  const updateParam = useCallback(
    (key: string, value: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (value) next.set(key, value)
          else next.delete(key)
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const value = useMemo<ArrivalContextValue>(
    () => ({
      ...state,
      setSelectedPatientId: (id) => updateParam('patientId', id),
      setEncounterId: (id) => updateParam('encounterId', id),
      setStandingOrderId: (id) => updateParam('standingOrderId', id),
      setEncounterDraft,
      reset: () => {
        setSearchParams(new URLSearchParams(), { replace: true })
        setEncounterDraft(null)
        try {
          sessionStorage.removeItem(STORAGE_KEY)
        } catch {
          // ignore
        }
      },
    }),
    [state, updateParam, setSearchParams],
  )

  return <ArrivalContext.Provider value={value}>{children}</ArrivalContext.Provider>
}

export function useArrival(): ArrivalContextValue {
  const ctx = useContext(ArrivalContext)
  if (!ctx) throw new Error('useArrival must be used inside <ArrivalProvider>')
  return ctx
}

/**
 * useWizardGuard — redirect to the earliest unlocked step if the user
 * deep-links to a step they haven't reached yet.
 *
 * Returns the <Navigate> element (or null when the current step is allowed).
 * Render the return value at the TOP of each step component so the guard
 * fires before any other JSX is evaluated.
 *
 * Step allowance rules:
 *   Step 1 (identify)  — always accessible
 *   Step 2 (encounter) — requires selectedPatientId
 *   Step 3 (protocol)  — requires selectedPatientId + encounterDraft
 *   Step 4 (done)      — requires all three IDs
 */
export function useWizardGuardTarget(requestedStep: 1 | 2 | 3 | 4): string | null {
  const { selectedPatientId, encounterDraft, encounterId, standingOrderId } = useArrival()

  if (requestedStep >= 2 && !selectedPatientId) return '/arrivals/identify'
  if (
    requestedStep >= 3 &&
    !encounterId &&
    (!encounterDraft || !encounterDraft.consentObtained || !encounterDraft.consentBy)
  ) {
    return '/arrivals/encounter'
  }
  if (requestedStep >= 4 && (!encounterId || !standingOrderId)) return '/arrivals/protocol'
  return null
}
