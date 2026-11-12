import { z } from 'zod'

// Crockford base32 alphabet (no I/L/O/U) — readable across phone/printer.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

// =============================================================================
// NEW API (target shape, two-tier IDs)
// Mirror of `apps/backend/src/shared/utils/displayId.ts` — keep in sync.
// See `docs/handovers/2026-05-18-id-redesign.md`.
// =============================================================================

const SUFFIX_LEN = 8

export type DisplayPrefix =
  | 'USR'
  | 'PLU'
  | 'PAT'
  | 'ENC'
  | 'PSO'
  | 'ORD'
  | 'CNS'
  | 'ATT'
  | 'CAT'
  | 'SBI'
  | 'SEP'
  | 'SVP'
  | 'PRD'
  | 'PYR'
  | 'PCT'
  | 'LAB'
  | 'NTP'
  | 'TGD'
  | 'STI'
  | 'LOT'
  | 'MVT'
  | 'TRF'
  | 'RCL'
  | 'LBO'
  | 'TXN'
  | 'TXI'
  | 'PMT'
  | 'GBL'
  | 'CLM'
  | 'CLI'
  | 'APT'
  | 'TLG'
  | 'CSH'
  | 'DEP'
  | 'DSS'
  | 'AVE'
  | 'BIT'
  | 'AOF'
  | 'APR'
  | 'APD'
  | 'CBA'
  | 'DER'
  | 'EAG'

const NEW_SUFFIX_RX = `[0-9A-HJKMNPQRSTVWXYZ]{${SUFFIX_LEN}}`

export const DISPLAY_ID_REGEX = new RegExp(`^[A-Z]{3}_${NEW_SUFFIX_RX}$`)
// Tenant slug: 2–16 chars, starts with a letter, then letters / digits /
// hyphens. Permissive to accommodate both the seeded short uppercase id
// (`SVX`) and future human-readable subdomain-friendly slugs (`acme-corp`,
// `clinicx`). Tenants.id mirrors tenants.slug, so this regex governs both.
export const TENANT_SLUG_REGEX = /^[A-Za-z][A-Za-z0-9-]{1,15}$/
export const BRANCH_CODE_REGEX = /^[A-Z]{3}$/
export const BRANCH_DISPLAY_ID_REGEX = /^[A-Za-z][A-Za-z0-9-]{1,15}\.[A-Z]{3}$/
export const CATALOG_CODE_REGEX = /^[A-Z][A-Z0-9_]{1,30}[A-Z0-9]$/
export const MRN_REGEX = /^MRN-\d{6,}$/

function newRandomSuffix(): string {
  const bytes = new Uint8Array(Math.ceil((SUFFIX_LEN * 5) / 8))
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => void } }
  if (typeof g.crypto?.getRandomValues !== 'function') {
    throw new Error('displayId: no crypto.getRandomValues available')
  }
  g.crypto.getRandomValues(bytes)
  let out = ''
  let bits = 0
  let value = 0
  let i = 0
  while (out.length < SUFFIX_LEN && i < bytes.length) {
    value = (value << 8) | (bytes[i] ?? 0)
    bits += 8
    i++
    while (bits >= 5 && out.length < SUFFIX_LEN) {
      bits -= 5
      const idx = (value >>> bits) & 0b11111
      out += ALPHABET[idx]
    }
  }
  while (out.length < SUFFIX_LEN) out += '0'
  return out
}

export function displayId(prefix: DisplayPrefix): string {
  return `${prefix}_${newRandomSuffix()}`
}

export function tenantSlug(slug: string): string {
  if (!TENANT_SLUG_REGEX.test(slug)) {
    throw new Error(
      `tenant slug must be 2–16 chars, starting with a letter then letters/digits/hyphens (got "${slug}")`,
    )
  }
  return slug
}

export function branchCode(code: string): string {
  if (!BRANCH_CODE_REGEX.test(code)) {
    throw new Error(`branch code must be exactly 3 uppercase letters (got "${code}")`)
  }
  return code
}

export function branchDisplayId(slug: string, code: string): string {
  return `${tenantSlug(slug)}.${branchCode(code)}`
}

export function catalogCode(code: string): string {
  if (!CATALOG_CODE_REGEX.test(code)) {
    throw new Error(`catalog code must be uppercase alphanumeric/_ (got "${code}")`)
  }
  return code
}

export function formatMrn(seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) {
    throw new Error(`MRN sequence must be a positive integer (got ${seq})`)
  }
  return `MRN-${seq.toString().padStart(6, '0')}`
}

export const displayIdSchema = z.string().regex(DISPLAY_ID_REGEX, 'invalid display id')

export function prefixedDisplayIdSchema(prefix: DisplayPrefix) {
  const rx = new RegExp(`^${prefix}_${NEW_SUFFIX_RX}$`)
  return z.string().regex(rx, `expected ${prefix}_ display id`)
}

export const tenantSlugSchema = z.string().regex(TENANT_SLUG_REGEX, 'invalid tenant slug')
export const branchCodeSchema = z.string().regex(BRANCH_CODE_REGEX, 'invalid branch code')
export const branchDisplayIdSchema = z
  .string()
  .regex(BRANCH_DISPLAY_ID_REGEX, 'invalid branch display id')
export const catalogCodeSchema = z.string().regex(CATALOG_CODE_REGEX, 'invalid catalog code')
export const mrnSchema = z.string().regex(MRN_REGEX, 'invalid MRN')

// =============================================================================
// LEGACY API (deprecated — migrate over the orchestrate waves)
// =============================================================================

/** @deprecated use `DisplayPrefix`. */
export type CodePrefix = 'TEN' | 'BRN' | 'SVC' | 'SOT'
/** @deprecated use `DisplayPrefix`. */
export type RandomPrefix =
  | 'USR'
  | 'PAT'
  | 'PYR'
  | 'LAB'
  | 'LOT'
  | 'IVT'
  | 'SVP'
  | 'IVM'
  | 'APD'
  | 'PAL'
  | 'PCN'
  | 'TAGD'
  | 'ATT'
  | 'NTP'
/** @deprecated use `DisplayPrefix`. */
export type YearPrefix = 'TXN' | 'AUD' | 'OR' | 'CLM' | 'CDS' | 'AVE' | 'PRC' | 'APT' | 'DSS'
/** @deprecated use `DisplayPrefix`. */
export type ChildPrefix =
  | 'ENC'
  | 'PSO'
  | 'ORD'
  | 'TLG'
  | 'RTK'
  | 'I'
  | 'P'
  | 'NTF'
  | 'TAG'
  | 'CNS'
  | 'INVTX'
  | 'LBO'
  | 'FF'
  | 'AR'
  | 'SOTI'
  | 'CLI'
  | 'CSH'
  | 'PCT'
  | 'VIT'
  | 'DGN'
  | 'PEC'
  | 'PXI'

const CHILD_HAS_YEAR: Record<ChildPrefix, boolean> = {
  ENC: true,
  TLG: true,
  PSO: false,
  ORD: false,
  RTK: false,
  I: false,
  P: false,
  NTF: false,
  TAG: false,
  CNS: false,
  INVTX: false,
  LBO: false,
  FF: false,
  AR: false,
  SOTI: false,
  CLI: false,
  CSH: false,
  PCT: false,
  VIT: false,
  DGN: false,
  PEC: false,
  PXI: false,
}

function thisYear(): number {
  return new Date().getUTCFullYear()
}

function legacyRandomChars(count: number): string {
  const bytes = new Uint8Array(Math.ceil((count * 5) / 8))
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => void } }
  if (typeof g.crypto?.getRandomValues === 'function') {
    g.crypto.getRandomValues(bytes)
  } else {
    throw new Error('displayId: no crypto.getRandomValues available')
  }
  let out = ''
  let bits = 0
  let value = 0
  let i = 0
  while (out.length < count && i < bytes.length) {
    value = (value << 8) | (bytes[i] ?? 0)
    bits += 8
    i++
    while (bits >= 5 && out.length < count) {
      bits -= 5
      const idx = (value >>> bits) & 0b11111
      out += ALPHABET[idx]
    }
  }
  while (out.length < count) out += '0'
  return out
}

const LEGACY_CODE_RX = /^[A-Z0-9][A-Z0-9-]{0,30}[A-Z0-9]$/
function legacyValidateCode(code: string): void {
  if (!LEGACY_CODE_RX.test(code)) {
    throw new Error(
      `displayId: code must be uppercase alphanumeric with optional "-" (got "${code}")`,
    )
  }
}

/** @deprecated migrating to two-tier IDs. */
export function codeId(prefix: CodePrefix, code: string): string {
  legacyValidateCode(code)
  return `${prefix}-${code}`
}

/** @deprecated migrating to two-tier IDs. */
export function tenantScopedCodeId(tenantId: string, prefix: 'BRN', code: string): string {
  legacyValidateCode(code)
  return `${tenantId}.${prefix}-${code}`
}

/** @deprecated migrating to two-tier IDs. */
export function randomId(prefix: RandomPrefix, opts?: { year?: number }): string {
  if (opts?.year !== undefined) {
    return `${prefix}-${opts.year}-${legacyRandomChars(10)}`
  }
  return `${prefix}-${legacyRandomChars(10)}`
}

/** @deprecated migrating to two-tier IDs. */
export function yearId(prefix: YearPrefix, opts?: { branchCode?: string }): string {
  const year = thisYear()
  const random = legacyRandomChars(10)
  if (opts?.branchCode !== undefined) {
    if (!/^[A-Z]{3}$/.test(opts.branchCode)) {
      throw new Error(`branchCode must be 3 uppercase letters; got: "${opts.branchCode}"`)
    }
    return `${prefix}-${opts.branchCode}-${year}-${random}`
  }
  return `${prefix}-${year}-${random}`
}

/** @deprecated migrating to two-tier IDs. */
export function childId(parentId: string, prefix: ChildPrefix, opts?: { year?: number }): string {
  const wantYear = opts?.year !== undefined ? true : CHILD_HAS_YEAR[prefix]
  const year = opts?.year ?? thisYear()
  const isLetterPrefix = prefix.length === 1
  const suffix = isLetterPrefix
    ? `${prefix}${legacyRandomChars(6)}`
    : wantYear
      ? `${prefix}-${year}-${legacyRandomChars(6)}`
      : `${prefix}-${legacyRandomChars(6)}`
  return `${parentId}.${suffix}`
}

const LEGACY_SEGMENT_RX = `[A-Z]{1,5}(?:-\\d{4})?(?:-[A-Z0-9-]+)?[A-Z0-9]+`
/** @deprecated use `DISPLAY_ID_REGEX`. */
export const ID_REGEX = new RegExp(`^${LEGACY_SEGMENT_RX}(?:\\.${LEGACY_SEGMENT_RX})*$`)

/** @deprecated use `displayIdSchema`. */
export const idSchema = z.string().min(3).max(120).regex(ID_REGEX, 'invalid display id')

/** @deprecated use `prefixedDisplayIdSchema`. */
export function prefixedIdSchema(prefix: string) {
  const rx = new RegExp(`^${prefix}-`)
  return z.string().regex(rx, `expected id starting with ${prefix}-`).pipe(idSchema)
}
