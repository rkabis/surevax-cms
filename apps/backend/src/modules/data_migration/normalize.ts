/**
 * Boundary normalisation helpers.
 *
 * AppSheet's xlsx export is inconsistent: numbers stringified, dates as either
 * Date objects or strings, "N/A" sentinels for empty fields, booleans sometimes
 * as 'true'/'TRUE'/1. Every transformer routes its inputs through these helpers
 * so the rest of the pipeline can assume clean types.
 */

const NA_SENTINELS = new Set(['', 'N/A', 'n/a', 'NA', 'na', '-', '—'])

export function str(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') {
    const trimmed = v.trim()
    if (NA_SENTINELS.has(trimmed)) return null
    return trimmed || null
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v instanceof Date) return v.toISOString()
  return null
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const trimmed = v.trim()
    if (NA_SENTINELS.has(trimmed)) return null
    const n = Number(trimmed.replace(/,/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Money string for NUMERIC(12,2) columns — always 2-decimal. Empty → '0.00'. */
export function money(v: unknown): string {
  const n = num(v)
  if (n === null) return '0.00'
  return n.toFixed(2)
}

/** Money but returns null when the input is null/empty (for nullable columns). */
export function moneyOrNull(v: unknown): string | null {
  const n = num(v)
  return n === null ? null : n.toFixed(2)
}

export function bool(v: unknown): boolean | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (NA_SENTINELS.has(s)) return null
    if (['true', 't', 'yes', 'y', '1'].includes(s)) return true
    if (['false', 'f', 'no', 'n', '0'].includes(s)) return false
  }
  return null
}

/** Coerce to ISO date string (YYYY-MM-DD) for `date` columns. */
export function dateOnly(v: unknown): string | null {
  const d = asDate(v)
  if (!d) return null
  return d.toISOString().slice(0, 10)
}

/** Coerce to Date for `timestamp with time zone` columns. */
export function ts(v: unknown): Date | null {
  return asDate(v)
}

function asDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null
  if (typeof v === 'string') {
    const trimmed = v.trim()
    if (NA_SENTINELS.has(trimmed)) return null
    const d = new Date(trimmed)
    return Number.isFinite(d.getTime()) ? d : null
  }
  if (typeof v === 'number') {
    // Excel serial — convert from 1900-based days. Defensive; exceljs returns Date.
    const epoch = Date.UTC(1899, 11, 30)
    return new Date(epoch + v * 86_400_000)
  }
  return null
}

/** Truncate to a string of `max` chars (UTF-16 code units). */
export function truncate(s: string | null, max: number): string | null {
  if (s === null) return null
  return s.length <= max ? s : s.slice(0, max)
}

/** First branch slug from a comma-separated "HolySpirit, Timog" list. */
export function firstBranchSlug(v: unknown): string | null {
  const s = str(v)
  if (!s) return null
  const first = s.split(/[,;]/)[0]?.trim()
  return first || null
}

/** All distinct branch slugs from a comma-separated list. */
export function allBranchSlugs(v: unknown): string[] {
  const s = str(v)
  if (!s) return []
  const out = new Set<string>()
  for (const part of s.split(/[,;]/)) {
    const trimmed = part.trim()
    if (trimmed) out.add(trimmed)
  }
  return [...out]
}

/** Sex enum: AppSheet uses 'Male'/'Female'/'Other'. */
export function sex(v: unknown): 'Male' | 'Female' | 'Other' | 'Unknown' | null {
  const s = str(v)
  if (!s) return null
  const lower = s.toLowerCase()
  if (lower.startsWith('m')) return 'Male'
  if (lower.startsWith('f')) return 'Female'
  if (lower === 'other') return 'Other'
  return 'Unknown'
}
