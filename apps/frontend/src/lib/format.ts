/**
 * Canonical date / time / money formatters.
 *
 * Naming follows the Intl.DateTimeFormat `dateStyle` convention:
 *   - `formatDate`        — list/cell display (relative-then-long)
 *   - `formatLongDate`    — always long (`May 17, 2026`) — receipts, BIR records
 *   - `formatDateTime`    — ISO `2026-05-24 15:45` — technical surfaces
 *   - `formatLongDateTime`— long readable `May 24, 2026, 03:45 PM` — narrative
 *   - `formatTime`        — time-of-day only `03:45 PM`
 *   - `formatMoney`       — peso `₱4,820.00`
 *   - `formatNumber`      — bare `4,820.00`
 *
 * Locale is hard-coded `en-PH`. When a non-PH tenant onboards (Phase 2 trial),
 * thread the tenant's `timezone` + `country_code` from `tenants` through here.
 *
 * Every helper returns `DASH` (em-dash) for null / undefined / NaN. Don't
 * write `value ?? '—'` at call sites — the helper already does it.
 */

export const DASH = '—'

const LOCALE = 'en-PH'

function asDate(input: string | Date | null | undefined): Date | null {
  if (!input) return null
  const d = typeof input === 'string' ? new Date(input) : input
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * List/cell display:
 *   ≤14 days ago  → relative ("Today", "Yesterday", "3 days ago")
 *   future ≤14d   → "Tomorrow" / "in N days"
 *   older / far   → long-form `May 17, 2026`
 *   null/invalid  → `—`
 *
 * Most call sites (table cells, detail rails) want this.
 */
export function formatDate(input: string | Date | null | undefined): string {
  const d = asDate(input)
  if (!d) return DASH

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfThat = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffMs = startOfToday.getTime() - startOfThat.getTime()
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays > 1 && diffDays <= 14) return `${diffDays} days ago`
  if (diffDays === -1) return 'Tomorrow'
  if (diffDays < -1 && diffDays >= -14) return `in ${-diffDays} days`

  return formatLongDate(d)
}

/**
 * Long-form calendar date `May 17, 2026`. Use where relative reads wrong:
 * receipts, BIR-record fields, narrative copy, signed audit timestamps,
 * appointment slots, "Date of birth".
 */
export function formatLongDate(input: string | Date | null | undefined): string {
  const d = asDate(input)
  if (!d) return DASH
  return d.toLocaleDateString(LOCALE, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Technical timestamp `2026-05-24 15:45` (24h, no seconds). Use for audit
 * log rows, detail-rail "Created at" / "Updated at" metadata, debugging.
 */
export function formatDateTime(input: string | Date | null | undefined): string {
  const d = asDate(input)
  if (!d) return DASH
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Long-form readable timestamp `May 24, 2026, 03:45 PM` (12h with month
 * name). Use for narrative copy, toast bodies, dialog descriptions — any
 * surface where ISO reads cold.
 */
export function formatLongDateTime(input: string | Date | null | undefined): string {
  const d = asDate(input)
  if (!d) return DASH
  return d.toLocaleString(LOCALE, {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Time-of-day only `03:45 PM`. Use for appointment slot times, clock-in
 * times, branch banner "open since" lines.
 */
export function formatTime(input: string | Date | null | undefined): string {
  const d = asDate(input)
  if (!d) return DASH
  return d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })
}

/**
 * Peso amount with thousand separators + 2 decimals: `₱4,820.00`.
 *
 * Accepts a Postgres `numeric(12,2)` string OR a JS number. Empty string,
 * null, undefined, and NaN all render `—`.
 */
export function formatMoney(input: string | number | null | undefined): string {
  if (input == null || input === '') return DASH
  const n = typeof input === 'string' ? Number(input) : input
  if (Number.isNaN(n)) return DASH
  return `₱${n.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Bare formatted number `4,820.00` — same digits as `formatMoney` but no
 * currency prefix. Use when the surface labels the currency separately
 * (input pre-fills next to a `(PHP)` label, CSV exports).
 *
 * If you find yourself reaching for this in a display context, you
 * probably want `formatMoney` instead.
 */
export function formatNumber(input: string | number | null | undefined): string {
  if (input == null || input === '') return DASH
  const n = typeof input === 'string' ? Number(input) : input
  if (Number.isNaN(n)) return DASH
  return n.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Return `v` or `fallback` (default `DASH`) for null / undefined / empty
 * string. Niche — most call sites should use a typed formatter (formatDate
 * etc.) which already null-coalesces.
 */
export function nullable<T>(v: T | null | undefined, fallback: string = DASH): T | string {
  if (v === null || v === undefined) return fallback
  if (typeof v === 'string' && v === '') return fallback
  return v
}

/**
 * Render any scalar/object for generic detail-rail field display:
 *   - null / undefined → `—`
 *   - ISO date string  → `formatDateTime` (technical)
 *   - object           → pretty-printed JSON
 *   - everything else  → `String(v)`
 *
 * Niche — used by the audit detail rail and JSONB column dumps. Prefer a
 * typed formatter at call sites where the type is known.
 */
export function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return DASH
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return formatDateTime(v)
  if (typeof v === 'object') return JSON.stringify(v, null, 2)
  return String(v)
}
