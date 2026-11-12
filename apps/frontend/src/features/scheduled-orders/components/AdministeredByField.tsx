import { useEffect, useMemo, useRef, useState } from 'react'
import { BadgeCheck, KeyRound } from 'lucide-react'
import { useBranchStaff, type BranchStaffRow } from '@/features/branch/api'
import { useAuth } from '@/features/auth/context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatTime } from '@/lib/format'

/**
 * Roles that can be recorded as having administered a dose. Mirrors
 * `ADMINISTERING_ROLES` in `apps/backend/src/shared/utils/clinicianAttestation.ts`
 *: the server is the authority, this only keeps impossible names out of the
 * picker. `Branch` is absent deliberately: it is a shared service account, not
 * a person.
 */
const CLINICAL_ROLES = ['Nurse', 'Physician', 'BranchAdmin', 'TenantAdmin']

/** Shared logins cannot self-attest: the session is not one person. */
const SHARED_LOGIN_ROLES = ['Branch']

export interface AdministeredByValue {
  /** `USR_…`, or null to attribute the dose to the caller. */
  administeredById: string | null
  /** 4 digits, or null when no PIN is needed (self-attestation). */
  attestationPin: string | null
}

export interface AdministeredByFieldProps {
  value: AdministeredByValue
  onChange: (next: AdministeredByValue) => void
  disabled?: boolean
  /** Typed action-level validation error from the administer mutation. */
  validationError?: string | null
  /** Reuses the clinician/PIN pattern with action-specific copy. */
  purpose?: 'administration' | 'observation' | 'clinical-review'
}

/**
 * "Given by": the clinician who physically administers the dose.
 *
 * The clinic shares one day-scoped `Branch` login on the front-desk Mac, so the
 * session cannot say who held the syringe. This field asks, and proves it with
 * the clinician's own kiosk PIN (the same PIN and lockout counters as clock-in).
 * The dose lands on `clinical_orders.administered_by_id`; the login stays on
 * `documented_by_id`.
 *
 * A clinician logged in as themselves skips all of it by default: their session
 * already is the attestation: but can still hand off to a colleague, which
 * then requires that colleague's PIN.
 */
export default function AdministeredByField({
  value,
  onChange,
  disabled,
  validationError,
  purpose = 'administration',
}: AdministeredByFieldProps) {
  const { user } = useAuth()
  const isSharedLogin = user ? SHARED_LOGIN_ROLES.includes(user.role) : true
  const canSelfAttest = user ? CLINICAL_ROLES.includes(user.role) : false

  // A shared login has nobody to default to, so the picker is always open.
  // An individual clinician starts collapsed on "me" and opens on request.
  const [handingOff, setHandingOff] = useState(isSharedLogin)
  const pinRef = useRef<HTMLInputElement>(null)

  const staffQuery = useBranchStaff()

  const clinicians = useMemo(() => {
    const rows = staffQuery.data?.data ?? []
    return rows
      .filter((r) => r.isActive && CLINICAL_ROLES.includes(r.role))
      .sort((a, b) => {
        // On shift first: on any given morning that is the one-to-three people
        // this actually is, so the nurse should not have to scroll a 100-name
        // roster to find themselves.
        const shiftDelta = Number(Boolean(b.activeShift)) - Number(Boolean(a.activeShift))
        if (shiftDelta !== 0) return shiftDelta
        return `${a.lastName}${a.firstName}`.localeCompare(`${b.lastName}${b.firstName}`)
      })
  }, [staffQuery.data])

  // Collapsing back to "me" must clear both fields, otherwise a stale
  // colleague + PIN would ride along on submit invisibly.
  useEffect(() => {
    if (!handingOff && (value.administeredById !== null || value.attestationPin !== null)) {
      onChange({ administeredById: null, attestationPin: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handingOff])

  useEffect(() => {
    if (!validationError) return
    if (value.attestationPin !== null) {
      onChange({ administeredById: value.administeredById, attestationPin: null })
    }
    requestAnimationFrame(() => pinRef.current?.focus())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validationError])

  const selected: BranchStaffRow | undefined = clinicians.find(
    (c) => c.id === value.administeredById,
  )
  const isObservation = purpose === 'observation'
  const isClinicalReview = purpose === 'clinical-review'
  const actionLabel = isObservation
    ? 'Acknowledged by'
    : isClinicalReview
      ? 'Verified by'
      : 'Given by'

  if (!handingOff) {
    return (
      <div className="space-y-1.5">
        <Label>{actionLabel}</Label>
        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <span className="flex items-center gap-2 text-sm">
            <BadgeCheck className="h-3.5 w-3.5 text-triage-ok" aria-hidden />
            <span className="font-medium">
              {user ? `${user.firstName} ${user.lastName}`.trim() : 'You'}
            </span>
            <span className="text-xs text-muted-foreground">(you)</span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setHandingOff(true)}
            disabled={disabled}
          >
            Someone else
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/40 px-3 py-3">
      <div className="space-y-1.5">
        <Label htmlFor="administered-by">
          {actionLabel} <span className="text-destructive">*</span>
        </Label>
        <Select
          value={value.administeredById ?? ''}
          onValueChange={(v) => onChange({ administeredById: v, attestationPin: null })}
          disabled={disabled || staffQuery.isPending}
        >
          <SelectTrigger id="administered-by">
            <SelectValue
              placeholder={
                staffQuery.isPending
                  ? 'Loading staff…'
                  : isObservation
                    ? 'Who is recording this observation?'
                    : isClinicalReview
                      ? 'Who verified this external record?'
                      : 'Who is giving this dose?'
              }
            />
          </SelectTrigger>
          <SelectContent>
            {clinicians.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                <span className="flex items-center gap-2">
                  <span>
                    {c.lastName}, {c.firstName}
                  </span>
                  {c.licenseNumber && (
                    <span className="font-mono tabular-nums text-2xs text-muted-foreground">
                      {c.licenseNumber}
                    </span>
                  )}
                  {c.activeShift && (
                    <Badge variant="ok" className="text-2xs px-1.5 py-0">
                      On shift since {formatTime(c.activeShift.clockInAt)}
                    </Badge>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {staffQuery.isError && (
          <p className="text-xs text-destructive">
            The staff list could not be loaded, so this{' '}
            {isObservation ? 'observation action' : isClinicalReview ? 'verification' : 'dose'}{' '}
            cannot be attributed. Refresh and try again.
          </p>
        )}
        {!staffQuery.isPending && !staffQuery.isError && clinicians.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No eligible clinicians are assigned to this branch. An admin has to add them before this{' '}
            {isClinicalReview ? 'record can be verified' : 'action can be recorded'}.
          </p>
        )}
      </div>

      {/* PIN proves the named clinician is present and consenting to the
          attribution. Deliberately NOT shown before a name is picked: an empty
          PIN box with nobody selected reads as a login prompt. */}
      {value.administeredById && (
        <div className="space-y-1.5">
          <Label htmlFor="attestation-pin">
            {selected ? `${selected.firstName}'s PIN` : 'Clinician PIN'}{' '}
            <span className="text-destructive">*</span>
          </Label>
          <div className="relative">
            <KeyRound
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              ref={pinRef}
              id="attestation-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              placeholder="••••"
              className="pl-9 font-mono tabular-nums tracking-[0.5em]"
              value={value.attestationPin ?? ''}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '').slice(0, 4)
                onChange({
                  administeredById: value.administeredById,
                  attestationPin: digits === '' ? null : digits,
                })
              }}
              disabled={disabled}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            The same 4-digit PIN used to clock in. This records the{' '}
            {isObservation ? 'observation action' : isClinicalReview ? 'verification' : 'dose'}{' '}
            under their name and PRC licence.
          </p>
        </div>
      )}

      {canSelfAttest && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setHandingOff(false)}
          disabled={disabled}
        >
          {isObservation
            ? 'I am recording this myself'
            : isClinicalReview
              ? 'I reviewed this myself'
              : 'I gave this dose myself'}
        </Button>
      )}
    </div>
  )
}

/**
 * Whether the field is complete enough to submit. Kept next to the component so
 * hosts cannot drift from its own notion of "filled in".
 */
export function isAdministeredByComplete(
  value: AdministeredByValue,
  callerRole: string | undefined,
): boolean {
  // Self-attestation: nothing to fill, but only a real clinician may do it.
  if (value.administeredById === null) {
    return callerRole !== undefined && CLINICAL_ROLES.includes(callerRole)
  }
  return /^\d{4}$/.test(value.attestationPin ?? '')
}
