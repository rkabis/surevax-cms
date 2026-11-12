/**
 * PIN attestation: naming the human behind a shared-login act, not just the
 * session that typed it. Two resolvers share one core: who gave a dose
 * (`resolveAdministeringClinician`) and, since 2026-08-02, who took a payment
 * (`resolveMoneyHandler`).
 *
 * The clinic runs one day-scoped `Branch` session on the front-desk Mac, shared
 * by every nurse on shift (see `.claude/rules/gotchas.md` and the branch-day
 * session model). Before the dose resolver existed, `clinical_orders.administered_by_id`
 * was simply the JWT principal, so every dose in the clinic was attributed to
 * the branch service account. The legacy AppSheet database it replaces records
 * the administering nurse per dose (`Immunization.i_NurseRef`), so that was a
 * parity regression as well as a clinical-record one: an immunization record has
 * to name the person who pushed the syringe, and those people hold PRC licence
 * numbers this system already stores.
 *
 * The same bug exists for money: `payments.received_by_id` was the shared
 * `Branch` account for every payment taken at the front desk, so per-cashier
 * collection figures and any money audit trail were meaningless. Cashiers take
 * payments but never administer doses, hence the two resolvers use different
 * role sets even though they share the exact same PIN/lockout/branch-membership
 * mechanics.
 *
 * The rule (identical for both resolvers):
 *
 * - A caller who is a real person logged in as themselves attests implicitly.
 *   The named-user field may be omitted and no PIN is required: nothing to
 *   prove, the session already belongs to one person.
 * - A caller on a SHARED login (the `Branch` service account) must name the
 *   person and prove it with that person's 4-digit kiosk PIN: the same PIN,
 *   lockout counters, and `pin_attempts` table the clock-in kiosk uses.
 *
 * For doses, `documented_by_id` stays the session principal either way: it
 * records which terminal/login typed the entry, which is a different fact
 * from who injected. For money, `payments.created_by_id` plays the same role
 * against `payments.received_by_id`.
 */

import { and, eq } from 'drizzle-orm'

import {
  clearPinAttempt,
  isPinLocked,
  recordPinFailure,
  verifyUserPin,
} from '../../modules/auth/db.js'
import { LifecycleError } from '../../modules/transactions/db.js'
import { users, userBranches, userRoles } from '../db/schema.js'
import { withTenantTx } from '../db/withTenantTx.js'

/**
 * Roles permitted to be recorded as having administered a dose. `Branch` is
 * absent on purpose: it is a shared service account, not a person, and
 * attributing a clinical act to it is the bug this module exists to fix.
 * `Cashier` is absent because a cashier does not administer.
 */
const ADMINISTERING_ROLES = ['Nurse', 'Physician', 'BranchAdmin', 'TenantAdmin'] as const

/**
 * Roles permitted to be recorded as having RECEIVED a payment. `Cashier` is
 * the critical addition over `ADMINISTERING_ROLES`: a cashier takes payments
 * but never administers a dose. `Branch` stays excluded for the same reason
 * as the dose path: it is the shared service account this resolver exists to
 * stop attributing money to.
 */
const MONEY_HANDLER_ROLES = ['Nurse', 'Physician', 'BranchAdmin', 'TenantAdmin', 'Cashier'] as const
const CLINICAL_REVIEW_ROLES = ['Nurse', 'Physician', 'BranchAdmin', 'TenantAdmin'] as const

/** Caller identity common to both resolvers. */
export interface AttestationCaller {
  id: number
  role: string
  displayId: string
}

/** Copy shown to the caller for each refusal code, parameterised per resolver. */
interface AttestationCopy {
  required: string
  pinRequired: string
  userUnknown: string
  roleInvalid: string
  wrongBranch: string
  lockedOut: string
  noPinSet: string
  pinInvalid: string
}

const ADMINISTERING_COPY: AttestationCopy = {
  required:
    'This is a shared login, so the dose needs the name and PIN of the clinician giving it.',
  pinRequired:
    "Enter the administering clinician's 4-digit PIN to record this dose under their name.",
  userUnknown: 'That clinician was not found, or their account is no longer active.',
  roleInvalid:
    'That staff member is not a nurse or physician, so a dose cannot be recorded under them.',
  wrongBranch:
    'That clinician is not assigned to this branch. Ask an admin to add them before recording a dose under their name.',
  lockedOut: 'Too many incorrect PIN attempts for this clinician. Wait before trying again.',
  noPinSet: 'That clinician has no kiosk PIN set. An admin can set one from their staff record.',
  pinInvalid: 'Incorrect PIN.',
}

const MONEY_HANDLER_COPY: AttestationCopy = {
  required:
    'This is a shared login, so the payment needs the name and PIN of whoever is taking it.',
  pinRequired:
    "Enter the receiving staff member's 4-digit PIN to record this payment under their name.",
  userUnknown: 'That staff member was not found, or their account is no longer active.',
  roleInvalid:
    'That staff member cannot take payments, so this payment cannot be recorded under them.',
  wrongBranch:
    'That staff member is not assigned to this branch. Ask an admin to add them before recording a payment under their name.',
  lockedOut: 'Too many incorrect PIN attempts for this staff member. Wait before trying again.',
  noPinSet: 'That staff member has no kiosk PIN set. An admin can set one from their staff record.',
  pinInvalid: 'Incorrect PIN.',
}

const CLINICAL_REVIEW_COPY: AttestationCopy = {
  required:
    'This is a shared login, so the review needs the name and PIN of the clinician verifying it.',
  pinRequired: "Enter the reviewing clinician's 4-digit PIN to verify this record.",
  userUnknown: 'That clinician was not found, or their account is no longer active.',
  roleInvalid: 'That staff member cannot verify a clinical immunization record.',
  wrongBranch:
    'That clinician is not assigned to this branch. Ask an admin to add them before verifying this record.',
  lockedOut: 'Too many incorrect PIN attempts for this clinician. Wait before trying again.',
  noPinSet: 'That clinician has no kiosk PIN set. An admin can set one from their staff record.',
  pinInvalid: 'Incorrect PIN.',
}

const CLINICAL_OWNER_COPY: AttestationCopy = {
  required:
    'This is a shared login, so claiming a patient requires the name and PIN of the clinician taking ownership.',
  pinRequired: "Enter the clinician's 4-digit PIN to claim or hand off this patient.",
  userUnknown: 'That clinician was not found, or their account is no longer active.',
  roleInvalid: 'That staff member is not a nurse or physician and cannot own clinical care.',
  wrongBranch:
    'That clinician is not assigned to this branch. Ask an admin to update their branch assignment.',
  lockedOut: 'Too many incorrect PIN attempts for this clinician. Wait before trying again.',
  noPinSet: 'That clinician has no kiosk PIN set. An admin can set one from their staff record.',
  pinInvalid: 'Incorrect PIN.',
}

/** Shared shape both resolvers reduce their public input to. */
interface CoreAttestationInput {
  tenantId: string
  /** Branch the caller is operating at. Null on a tenant-wide admin session. */
  branchId: number | null
  caller: AttestationCaller
  /** `USR_…` of the person who actually did the thing (gave the dose / took the payment). */
  namedUserId?: string | undefined
  /** That person's 4-digit kiosk PIN. */
  attestationPin?: string | undefined
}

/**
 * Resolve the bigint user id behind a shared-login act, PIN-attested when the
 * caller isn't already a self-identifying person.
 *
 * Throws `LifecycleError` with a code the caller's dialog has copy for:
 * `ATTESTATION_REQUIRED`, `ATTESTATION_PIN_REQUIRED`, `ATTESTATION_USER_UNKNOWN`,
 * `ATTESTATION_ROLE_INVALID`, `ATTESTATION_WRONG_BRANCH`, `ATTESTATION_NO_PIN_SET`,
 * `ATTESTATION_PIN_INVALID`, `ATTESTATION_LOCKED_OUT`.
 *
 * `allowedRoles` doubles as both "who may self-attest" and "who may be named":
 * a role permitted to perform the act on their own session is also the set of
 * roles eligible to be named by someone else's shared-login session.
 */
async function resolveAttestedUser(
  input: CoreAttestationInput,
  allowedRoles: readonly string[],
  copy: AttestationCopy,
): Promise<number> {
  const { tenantId, branchId, caller, namedUserId, attestationPin } = input

  // ── Self-attestation: a real person logged in as themselves ───────────────
  if (!namedUserId) {
    if (!allowedRoles.includes(caller.role)) {
      throw new LifecycleError(copy.required, 'ATTESTATION_REQUIRED', 400)
    }
    return caller.id
  }

  // Naming yourself is self-attestation, not a shared-login attestation: the
  // session is already proof, so don't demand a PIN the caller would have to
  // type to confirm they are themselves.
  if (namedUserId === caller.displayId && allowedRoles.includes(caller.role)) {
    return caller.id
  }

  if (!attestationPin) {
    throw new LifecycleError(copy.pinRequired, 'ATTESTATION_PIN_REQUIRED', 400)
  }

  // ── Resolve the named person: active, in this tenant, eligible role ──────
  const target = await withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const [row] = await tx
      .select({ id: users.id, isActive: users.isActive })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.displayId, namedUserId)))
      .limit(1)
    if (!row) return null

    const roleRows = await tx
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(and(eq(userRoles.tenantId, tenantId), eq(userRoles.userId, row.id)))

    const branchRows =
      branchId === null
        ? []
        : await tx
            .select({ branchId: userBranches.branchId })
            .from(userBranches)
            .where(
              and(
                eq(userBranches.tenantId, tenantId),
                eq(userBranches.userId, row.id),
                eq(userBranches.branchId, branchId),
              ),
            )
            .limit(1)

    return {
      id: row.id,
      isActive: row.isActive,
      roles: roleRows.map((r) => String(r.role)),
      atBranch: branchId === null ? true : branchRows.length > 0,
    }
  })

  if (!target || !target.isActive) {
    throw new LifecycleError(copy.userUnknown, 'ATTESTATION_USER_UNKNOWN', 404)
  }

  if (!target.roles.some((r) => allowedRoles.includes(r))) {
    throw new LifecycleError(copy.roleInvalid, 'ATTESTATION_ROLE_INVALID', 422)
  }

  if (!target.atBranch) {
    throw new LifecycleError(copy.wrongBranch, 'ATTESTATION_WRONG_BRANCH', 422)
  }

  // ── Verify the PIN, reusing the kiosk's lockout counters ──────────────────
  const lock = await isPinLocked(tenantId, target.id)
  if (lock.locked) {
    throw new LifecycleError(copy.lockedOut, 'ATTESTATION_LOCKED_OUT', 429, {
      retryAfter: lock.retryAfterSecs,
    })
  }

  const result = await verifyUserPin(namedUserId, attestationPin, tenantId)

  if (result.ok) {
    await clearPinAttempt(tenantId, target.id)
    return target.id
  }

  if (result.code === 'NO_PIN_SET') {
    throw new LifecycleError(copy.noPinSet, 'ATTESTATION_NO_PIN_SET', 409)
  }

  const { lockedUntil } = await recordPinFailure(tenantId, target.id)
  if (lockedUntil && lockedUntil > new Date()) {
    throw new LifecycleError(copy.lockedOut, 'ATTESTATION_LOCKED_OUT', 429, {
      retryAfter: Math.ceil((lockedUntil.getTime() - Date.now()) / 1000),
    })
  }

  // This is action-level validation inside an already-authenticated clinic
  // session, not a failure of the web session itself. Returning 401 makes the
  // frontend's canonical fetch wrapper refresh/logout and destroys the open
  // administration/payment context after an ordinary PIN typo.
  throw new LifecycleError(copy.pinInvalid, 'ATTESTATION_PIN_INVALID', 422)
}

export interface AttestationInput {
  tenantId: string
  /** Branch the caller is operating at. Null on a tenant-wide admin session. */
  branchId: number | null
  caller: AttestationCaller
  /** `USR_…` of the clinician who physically gave the dose. */
  administeredById?: string | undefined
  /** That clinician's 4-digit kiosk PIN. */
  attestationPin?: string | undefined
}

/**
 * Resolve the bigint user id to record in `clinical_orders.administered_by_id`.
 * See {@link resolveAttestedUser} for the shared mechanics and error codes.
 */
export async function resolveAdministeringClinician(input: AttestationInput): Promise<number> {
  return resolveAttestedUser(
    {
      tenantId: input.tenantId,
      branchId: input.branchId,
      caller: input.caller,
      namedUserId: input.administeredById,
      attestationPin: input.attestationPin,
    },
    ADMINISTERING_ROLES,
    ADMINISTERING_COPY,
  )
}

export interface MoneyAttestationInput {
  tenantId: string
  /** Branch the caller is operating at. Null on a tenant-wide admin session. */
  branchId: number | null
  caller: AttestationCaller
  /** `USR_…` of the staff member who physically took the payment. */
  attestedById?: string | undefined
  /** That staff member's 4-digit kiosk PIN. */
  attestationPin?: string | undefined
}

/**
 * Resolve the bigint user id to record in `payments.received_by_id`: who
 * actually took the money, as distinct from `payments.created_by_id` (the
 * session that typed it). See {@link resolveAttestedUser} for the shared
 * mechanics and error codes.
 *
 * Must be called BEFORE the money-moving db transaction opens (same rule as
 * `resolveAdministeringClinician`): verifying a PIN performs its own writes
 * (the `pin_attempts` lockout counters), which must not ride on, or be rolled
 * back with, the financial transaction.
 */
export async function resolveMoneyHandler(input: MoneyAttestationInput): Promise<number> {
  return resolveAttestedUser(
    {
      tenantId: input.tenantId,
      branchId: input.branchId,
      caller: input.caller,
      namedUserId: input.attestedById,
      attestationPin: input.attestationPin,
    },
    MONEY_HANDLER_ROLES,
    MONEY_HANDLER_COPY,
  )
}

export interface ClinicalReviewAttestationInput {
  tenantId: string
  branchId: number | null
  caller: AttestationCaller
  reviewedById?: string | undefined
  attestationPin?: string | undefined
}

/** Resolve the named clinician accountable for verifying external clinical evidence. */
export async function resolveClinicalReviewer(
  input: ClinicalReviewAttestationInput,
): Promise<number> {
  return resolveAttestedUser(
    {
      tenantId: input.tenantId,
      branchId: input.branchId,
      caller: input.caller,
      namedUserId: input.reviewedById,
      attestationPin: input.attestationPin,
    },
    CLINICAL_REVIEW_ROLES,
    CLINICAL_REVIEW_COPY,
  )
}

export interface ClinicalOwnerAttestationInput {
  tenantId: string
  branchId: number
  caller: AttestationCaller
  /** `USR_…` of the clinician claiming the patient; required on a shared login. */
  assigneeId?: string | undefined
  attestationPin?: string | undefined
}

/**
 * Resolve the named human taking responsibility for an active encounter.
 * Uses the same branch membership, eligible-role, PIN, and lockout mechanics
 * as dose attribution, with ownership-specific refusal copy.
 */
export async function resolveClinicalOwner(input: ClinicalOwnerAttestationInput): Promise<number> {
  return resolveAttestedUser(
    {
      tenantId: input.tenantId,
      branchId: input.branchId,
      caller: input.caller,
      namedUserId: input.assigneeId,
      attestationPin: input.attestationPin,
    },
    ADMINISTERING_ROLES,
    CLINICAL_OWNER_COPY,
  )
}
