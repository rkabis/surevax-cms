import { ApiError } from './apiFetch'

const FRIENDLY_BY_CODE: Record<string, string> = {
  SESSION_EXPIRED: 'Your session expired. Sign in again to continue.',
  CSRF_REQUIRED: 'Security check failed. Refresh the page and try again.',
  TENANT_REQUIRED: 'Clinic could not be resolved. Refresh and try again.',
  TENANT_NOT_FOUND: 'Clinic not found.',
  TENANT_INACTIVE: 'This clinic account is inactive.',
  CLINICAL_ORDER_ALREADY_BILLED:
    'This dose already has an active bill. Refresh the worklist and open that transaction before collecting payment again.',
  PAYMENT_RECEIVER_UNKNOWN:
    'This legacy payment has no accountable receiver on record. Ask a Tenant Admin to document and repair the attribution before correcting it.',
}

/**
 * Map an unknown error from a mutation/query into user-facing copy.
 *
 * Priority:
 *   1. Known `ApiError.code` → curated copy
 *   2. Status-class mapping (401/403/404/409/4xx/5xx)
 *   3. Backend-provided message (`err.message`) when present
 *   4. Caller-supplied fallback
 */
export function apiErrorMessage(err: unknown, fallback = 'Please try again.'): string {
  if (err instanceof ApiError) {
    if (err.code) {
      const friendly = FRIENDLY_BY_CODE[err.code]
      if (friendly) return friendly
    }
    if (err.statusCode === 401) return 'Sign-in required. Refresh the page and try again.'
    if (err.statusCode === 403) return "You don't have permission to do that."
    if (err.statusCode === 404) return 'Not found.'
    if (err.statusCode === 409) return err.message || 'Record changed — refresh and retry.'
    if (err.statusCode === 422 || err.statusCode === 400) {
      return err.message || 'Some fields are invalid.'
    }
    if (err.statusCode >= 500) return 'Server error. Try again in a moment.'
    return err.message || fallback
  }
  if (err instanceof Error) return err.message || fallback
  return fallback
}
