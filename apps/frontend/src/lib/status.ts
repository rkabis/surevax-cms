import type { BadgeProps } from '@/components/ui/badge'

type Variant = NonNullable<BadgeProps['variant']>

/**
 * Humanize a backend state string for user display.
 * Handles: snake_case (awaiting_payment), camelCase enum (ResultReceived,
 * LifeThreatening, NotRecovered), and already-humanized strings (returned
 * verbatim).
 *
 * Examples:
 *   humanizeStatus('awaiting_payment') -> 'Awaiting payment'
 *   humanizeStatus('ResultReceived')   -> 'Result received'
 *   humanizeStatus('LifeThreatening')  -> 'Life-threatening'
 *   humanizeStatus('NotRecovered')     -> 'Not recovered'
 *   humanizeStatus('Paid')             -> 'Paid'
 */
export function humanizeStatus(raw: string): string {
  if (!raw) return ''
  // Specific hyphenated overrides (clinical convention)
  const HYPHENATED: Record<string, string> = {
    LifeThreatening: 'Life-threatening',
  }
  if (raw in HYPHENATED) return HYPHENATED[raw]!
  // Insert space before uppercase letters in camelCase, then split on _, then
  // sentence-case the result.
  const withSpaces = raw
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim()
  if (!withSpaces) return ''
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1).toLowerCase()
}

/**
 * Status → Badge variant maps, consolidated from per-feature redefinitions.
 * Audit (Oct 2026): every list page redefined its own map; same status
 * (e.g. "Completed") was rendered with different variants across features.
 *
 * Add new domains here, not in feature files. If a feature has a one-off
 * variant rule (e.g. "Cancelled is destructive only when within 24h of
 * appointment"), inline that override at the call site — but the default
 * map lives here.
 */

export const TRANSACTION_STATUS_VARIANT: Record<string, Variant> = {
  Draft: 'outline',
  Pending: 'due',
  Paid: 'default',
  Voided: 'overdue',
  Refunded: 'overdue',
}

export const ENCOUNTER_STATUS_VARIANT: Record<string, Variant> = {
  Open: 'outline',
  InProgress: 'due',
  Completed: 'default',
  Cancelled: 'overdue',
}

export const APPOINTMENT_STATUS_VARIANT: Record<string, Variant> = {
  Scheduled: 'info',
  Completed: 'ok',
  Cancelled: 'destructive',
  NoShow: 'overdue',
}

/**
 * Look up a status's variant; falls back to `outline` if the status isn't
 * in the map. Use this rather than `MAP[status] ?? 'outline'` so the
 * fallback rule is enforced once.
 */
export function statusVariant(map: Record<string, Variant>, status: string): Variant {
  return map[status] ?? 'outline'
}

// Clinical orders — status → variant
export function clinicalOrderStatusVariant(status: string): Variant {
  switch (status) {
    case 'Missed':
    case 'Refused':
      return 'overdue'
    case 'Scheduled':
    case 'Pending':
      return 'due'
    case 'Completed':
      return 'ok'
    case 'Cancelled':
      return 'outline'
    default:
      return 'info'
  }
}

// Claims — status → variant
export function claimStatusVariant(status: string): Variant {
  switch (status) {
    case 'Draft':
      return 'secondary'
    case 'Submitted':
    case 'Acknowledged':
    case 'InReview':
      return 'info'
    case 'Approved':
    case 'PartiallyApproved':
    case 'Paid':
      return 'ok'
    case 'Denied':
      return 'destructive'
    case 'Appealed':
      return 'overdue'
    default:
      return 'outline'
  }
}

// Notifications — status → variant
export function notificationStatusVariant(status: string): Variant {
  switch (status) {
    case 'Queued':
    case 'Sending':
      return 'info'
    case 'Sent':
    case 'Delivered':
    case 'Read':
      return 'ok'
    case 'Failed':
      return 'destructive'
    default:
      return 'outline'
  }
}

/**
 * Humanize a role enum string for user display.
 * Handles PascalCase role names:
 *   'TenantAdmin'  → 'Tenant Admin'
 *   'BranchAdmin'  → 'Branch Admin'
 *   'SuperAdmin'   → 'Super Admin'  (back-compat)
 *   'Physician'    → 'Physician'
 *   'Nurse'        → 'Nurse'
 *   'Cashier'      → 'Cashier'
 *   'Branch'       → 'Branch'
 */
export function humanizeRole(raw: string | null | undefined): string {
  if (!raw) return '—'
  return raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
}

/**
 * FDA recall severity class → Roman numeral display label.
 * Class1 = most severe (immediate threat), Class2 = serious, Class3 = minor.
 * Use this instead of humanizeStatus for recall severity — humanizeStatus
 * would produce "Class 1" (numeric) not "Class I" (Roman numeral convention).
 */
export const CLASS_DISPLAY: Record<string, string> = {
  Class1: 'Class I',
  Class2: 'Class II',
  Class3: 'Class III',
}

// Product recalls — FDA severity class → variant
// Class1 = most severe (immediate threat), Class2 = serious, Class3 = minor.
export function recallSeverityVariant(severity: string): Variant {
  switch (severity) {
    case 'Class1':
      return 'destructive'
    case 'Class2':
      return 'overdue'
    case 'Class3':
      return 'due'
    default:
      return 'outline'
  }
}
