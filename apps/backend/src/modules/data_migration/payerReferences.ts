/**
 * Migration-facing payer aliases.
 *
 * Transformers emit stable semantic references (`PAYER_HMO`), while the
 * database correctly exposes opaque public IDs (`PYR_…`). Keep that boundary
 * explicit so an unrecognised commercial label cannot silently become a new
 * payer profile or a retail price.
 */
export const MIGRATION_PAYER_DISPLAY_IDS: Readonly<Record<string, string>> = {
  PAYER_HATI_HEALTH: 'PYR_AAAAAAA5',
  PAYER_FORTICARE: 'PYR_AAAAAAA6',
  PAYER_MEDASIA: 'PYR_AAAAAAA7',
  PAYER_PHILBRITISH: 'PYR_AAAAAAA8',
  PAYER_HMO: 'PYR_AAAAAAA9',
  PAYER_HPPI: 'PYR_AAAAAAAA',
  PAYER_MWELL: 'PYR_AAAAAAAB',
  // A4: app owner approved Ayala Malls as a first-class payer. The companion
  // profile is seeded in shared/db/seed/payers.ts; no price is invented here.
  PAYER_AYALA_MALLS: 'PYR_AAAAAAAC',
  PAYER_AVEGA: 'PYR_AAAAAAAD',
  // Already a seeded HMO profile. The current transaction transform does not
  // emit it yet; retaining the alias makes its later, source-correct mapper
  // deterministic without implying an Avega or generic-HMO equivalent.
  PAYER_INTELLICARE: 'PYR_AAAAAAA2',
}

/** Returns a target display ID only for an approved migration alias. */
export function migrationPayerDisplayId(reference: string): string | null {
  if (/^PYR_[A-Z0-9]+$/.test(reference)) return reference
  return MIGRATION_PAYER_DISPLAY_IDS[reference] ?? null
}
