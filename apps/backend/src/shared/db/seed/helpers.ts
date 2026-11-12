/**
 * Date + display-ID helpers used across seed sections.
 */

export function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function daysAgo(n: number, hour = 8, min = 0): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(hour, min, 0, 0)
  return d
}

export function daysFromNow(n: number, hour = 8, min = 0): Date {
  const d = new Date()
  d.setDate(d.getDate() + n)
  d.setHours(hour, min, 0, 0)
  return d
}

export function today(hour = 8, min = 0): Date {
  const d = new Date()
  d.setHours(hour, min, 0, 0)
  return d
}

/**
 * Deterministic display-id suffix for sub-records that previously relied on
 * DB-side `defaultRandom()`. Suffix uses Crockford base32 chars (no I/L/O/U).
 */
export function seqSuffix(idx: number, width = 6): string {
  // 0..31 → '0'..'Z' (Crockford alphabet); idx > 31 wraps with leading 'A'.
  const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  let n = idx
  let out = ''
  while (n > 0 || out.length < width) {
    out = A[n % 32] + out
    n = Math.floor(n / 32)
    if (n === 0 && out.length >= width) break
  }
  while (out.length < width) out = 'A' + out
  return out
}
