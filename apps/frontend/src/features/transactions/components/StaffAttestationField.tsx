import { useEffect, useMemo, useRef, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { useBranchStaff } from '@/features/branch/api'
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
 * Roles that may be recorded as having taken a payment. Mirrors
 * `MONEY_HANDLER_ROLES` in `apps/backend/src/shared/utils/clinicianAttestation.ts`:
 * the server is the authority, this only keeps impossible names out of the
 * picker. `Branch` is absent on purpose, it is the shared service account
 * this field exists to stop attributing money to.
 */
const MONEY_HANDLER_ROLES = ['Nurse', 'Physician', 'BranchAdmin', 'TenantAdmin', 'Cashier']

/** The one login this field actually prompts for. Every other role's own
 *  session already is the attestation. */
const SHARED_LOGIN_ROLE = 'Branch'

export interface StaffAttestationValue {
  /** `USR_…` of the staff member actually taking the money, or null before a
   *  default resolves (or when the caller self-attests). */
  attestedById: string | null
  /** That staff member's 4-digit kiosk PIN. */
  attestationPin: string | null
}

export interface StaffAttestationFieldProps {
  value: StaffAttestationValue
  onChange: (next: StaffAttestationValue) => void
  disabled?: boolean
  /**
   * What is happening, in gerund form: drives the settled line ("Taking
   * payment: Ana Reyes") and the picker prompt ("Who is taking payment?").
   * Default fits every payment-collection surface; pass a surface-specific
   * phrase (e.g. "Correcting this payment") where the act isn't collection.
   */
  actionLabel?: string
  /**
   * Flips whenever the host surface is (re)opened. Resets the "Not you?"
   * reveal back to the one-tap default.
   *
   * Required because most hosts do NOT unmount this field on close: dialogs
   * like AddPaymentDialog are rendered unconditionally with an `open` prop, so
   * without this a single stray "Not you?" click would strand the picker open
   * for the rest of the page's life, and every later payment would lose the
   * pre-selected default. Hosts should pass their own `open` flag.
   */
  resetToken?: unknown
  /** Typed action-level validation error from the host mutation. */
  validationError?: string | null
}

/**
 * "Who is taking this money": the staff member physically handling a payment
 * act, proved with their kiosk PIN, on the shared `Branch` login.
 *
 * The clinic runs one day-scoped `Branch` login shared by every nurse and
 * cashier on shift, so before this field existed every payment recorded the
 * service account as the receiver, per-staff collection figures and any money
 * audit trail were meaningless. This is the money-side counterpart to
 * `AdministeredByField` (scheduled-orders feature): see
 * `apps/backend/src/shared/utils/clinicianAttestation.ts` for why the two
 * resolvers share PIN/lockout mechanics but not role sets (a cashier takes
 * payments but never administers a dose).
 *
 * Renders NOTHING when the caller is logged in as themselves (any role except
 * `Branch`): the session already is the attestation, so neither field is
 * sent. On the shared login it defaults to a confident guess (the one person
 * currently clocked in) but always asks for a PIN regardless: being clocked
 * in identifies someone, it does not prove they are the one standing at the
 * till right now.
 */
export default function StaffAttestationField({
  value,
  onChange,
  disabled,
  actionLabel = 'Taking payment',
  resetToken,
  validationError,
}: StaffAttestationFieldProps) {
  const { user } = useAuth()
  const isSharedLogin = user?.role === SHARED_LOGIN_ROLE

  // Once "Not you?" is clicked the full picker stays open for the rest of the
  // host surface's open session: there is no path back to the settled line
  // while it stays open. It resets when `resetToken` changes, which is what
  // makes reopening a dialog return to the one-tap default. Do NOT rely on
  // unmounting for that: most hosts render this field unconditionally and
  // only toggle an `open` prop.
  const [revealed, setRevealed] = useState(false)
  const pinRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    setRevealed(false)
  }, [resetToken])

  // A retry must preserve the selected staff member and every non-secret host
  // input, while clearing and returning focus to the one secret that failed.
  useEffect(() => {
    if (!validationError) return
    if (value.attestationPin !== null) {
      onChange({ attestedById: value.attestedById, attestationPin: null })
    }
    requestAnimationFrame(() => pinRef.current?.focus())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validationError])

  // Skip the roster fetch entirely for a real login: the component renders
  // null below and sends no fields, so fetching it would be pure waste on a
  // surface that opens dozens of times a day.
  const staffQuery = useBranchStaff({ enabled: isSharedLogin })

  const candidates = useMemo(() => {
    const rows = staffQuery.data?.data ?? []
    return rows
      .filter((r) => r.isActive && MONEY_HANDLER_ROLES.includes(r.role))
      .sort((a, b) => {
        // On shift first: on any given morning that is the one-to-few people
        // this actually is, so staff shouldn't scroll a full roster to find
        // themselves.
        const shiftDelta = Number(Boolean(b.activeShift)) - Number(Boolean(a.activeShift))
        if (shiftDelta !== 0) return shiftDelta
        return `${a.lastName}${a.firstName}`.localeCompare(`${b.lastName}${b.firstName}`)
      })
  }, [staffQuery.data])

  const clockedIn = useMemo(() => candidates.filter((c) => c.activeShift), [candidates])
  const singleClockedIn = clockedIn.length === 1 ? clockedIn[0] : undefined

  // Pre-select the one person on shift, but only ever into an EMPTY
  // selection so it can never clobber an explicit pick, and never once
  // "Not you?" has been clicked for this field's lifetime.
  useEffect(() => {
    if (!isSharedLogin || revealed || !singleClockedIn || value.attestedById !== null) return
    onChange({ attestedById: singleClockedIn.id, attestationPin: value.attestationPin })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSharedLogin, revealed, singleClockedIn?.id])

  // A real person's own session already is the attestation: no UI, no fields
  // sent. Getting this backwards would put a pointless PIN prompt in front of
  // every admin and physician login.
  if (!isSharedLogin) return null

  const showPicker = revealed || !singleClockedIn
  const selected = candidates.find((c) => c.id === value.attestedById)

  return (
    <div className="space-y-3 rounded-md border bg-muted/40 px-3 py-3">
      {!showPicker && singleClockedIn ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">
            <span className="text-muted-foreground">{actionLabel}:</span>{' '}
            <span className="font-medium">
              {singleClockedIn.firstName} {singleClockedIn.lastName}
            </span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setRevealed(true)
              // The default was just disowned, clear it rather than leaving
              // the wrong name pre-filled in the picker that replaces it.
              onChange({ attestedById: null, attestationPin: null })
            }}
            disabled={disabled}
          >
            Not you?
          </Button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="staff-attestation-name">
            Staff member <span className="text-destructive">*</span>
          </Label>
          <Select
            value={value.attestedById ?? ''}
            onValueChange={(v) =>
              onChange({ attestedById: v, attestationPin: value.attestationPin })
            }
            disabled={disabled || staffQuery.isPending}
          >
            <SelectTrigger id="staff-attestation-name">
              <SelectValue
                placeholder={
                  staffQuery.isPending ? 'Loading staff…' : `Who is ${actionLabel.toLowerCase()}?`
                }
              />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="flex items-center gap-2">
                    <span>
                      {c.lastName}, {c.firstName}
                    </span>
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
              The staff list could not be loaded, so this cannot be attributed. Refresh and try
              again.
            </p>
          )}
          {!staffQuery.isPending && !staffQuery.isError && candidates.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No staff eligible to take payments are assigned to this branch. An admin has to add
              them before this can be recorded.
            </p>
          )}
        </div>
      )}

      {/* Always shown, always required: being clocked in identifies someone,
          it does not prove they are the one standing here right now. */}
      <div className="space-y-1.5">
        <Label htmlFor="staff-attestation-pin">
          {selected ? `${selected.firstName}'s PIN` : 'Staff PIN'}{' '}
          <span className="text-destructive">*</span>
        </Label>
        <div className="relative">
          <KeyRound
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            ref={pinRef}
            id="staff-attestation-pin"
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
                attestedById: value.attestedById,
                attestationPin: digits === '' ? null : digits,
              })
            }}
            disabled={disabled}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          The same 4-digit PIN used to clock in, confirming who is really here.
        </p>
      </div>
    </div>
  )
}

/**
 * Whether the field is complete enough to submit. Kept next to the component
 * so hosts cannot drift from its own notion of "filled in".
 */
export function isStaffAttestationComplete(
  value: StaffAttestationValue,
  callerRole: string | undefined,
): boolean {
  // Auth is still resolving when callerRole is undefined. Do not let that
  // transient state bypass a shared-kiosk PIN requirement.
  if (callerRole === undefined) return false

  // Self-attestation: any resolved role other than the shared login has
  // nothing to fill in; the authenticated session is already proof.
  if (callerRole !== SHARED_LOGIN_ROLE) return true
  return !!value.attestedById && /^\d{4}$/.test(value.attestationPin ?? '')
}

/**
 * Inline copy for the attestation refusal codes, shared by every surface that
 * wires this field in so the wording never drifts between them. Mirrors
 * `MONEY_HANDLER_COPY` in `apps/backend/src/shared/utils/clinicianAttestation.ts`.
 */
export const STAFF_ATTESTATION_ERROR_MESSAGES: Record<string, string> = {
  ATTESTATION_REQUIRED:
    'This is a shared login, so this needs the name and PIN of whoever is doing it.',
  ATTESTATION_PIN_REQUIRED: "Enter the staff member's 4-digit PIN to record this under their name.",
  ATTESTATION_PIN_INVALID: 'That PIN is incorrect. Try again.',
  ATTESTATION_LOCKED_OUT:
    'Too many incorrect PIN attempts for this staff member. The PIN is temporarily locked after repeated wrong entries, wait a moment before trying again.',
  ATTESTATION_NO_PIN_SET:
    'That staff member has no kiosk PIN set. An admin can set one from their staff record.',
  ATTESTATION_USER_UNKNOWN:
    'That staff member was not found, or their account is no longer active.',
  ATTESTATION_ROLE_INVALID:
    'That staff member cannot take payments, so this cannot be recorded under them.',
  ATTESTATION_WRONG_BRANCH:
    'That staff member is not assigned to this branch. Ask an admin to add them first.',
}
