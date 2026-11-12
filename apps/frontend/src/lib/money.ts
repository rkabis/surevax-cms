/** Parse a numeric(12,2) JSON string into integer cents. NaN → 0. */
export function toCents(s: string | null | undefined): number {
  if (!s) return 0
  const n = parseFloat(s)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

/** Format integer cents back to a numeric(12,2)-style string. */
export function fromCents(cents: number): string {
  return (cents / 100).toFixed(2)
}

/** Sum money strings exactly via cents accumulation. */
export function sumMoney(amounts: ReadonlyArray<string | null | undefined>): string {
  return fromCents(amounts.reduce((acc, a) => acc + toCents(a), 0))
}

/** Subtract money strings exactly via cents. */
export function subtractMoney(a: string | null | undefined, b: string | null | undefined): string {
  return fromCents(toCents(a) - toCents(b))
}

/** Multiply a money string by a quantity. Quantity may be string or number. */
export function multiplyMoney(
  amount: string | null | undefined,
  qty: string | number | null | undefined,
): string {
  const q = typeof qty === 'string' ? parseFloat(qty) : (qty ?? 0)
  if (!Number.isFinite(q)) return '0.00'
  return fromCents(Math.round(toCents(amount) * q))
}
