import { describe, expect, it } from 'vitest'
import {
  MIGRATION_PAYER_DISPLAY_IDS,
  migrationPayerDisplayId,
} from '../../../src/modules/data_migration/payerReferences.js'

describe('migration payer references', () => {
  it('maps every catalog-tier payer emitted by the live Vaccine transform to its seeded profile', () => {
    expect(MIGRATION_PAYER_DISPLAY_IDS).toMatchObject({
      PAYER_HATI_HEALTH: 'PYR_AAAAAAA5',
      PAYER_MEDASIA: 'PYR_AAAAAAA7',
      PAYER_HMO: 'PYR_AAAAAAA9',
      PAYER_HPPI: 'PYR_AAAAAAAA',
      PAYER_MWELL: 'PYR_AAAAAAAB',
    })
  })

  it('maps explicitly approved Ayala Malls without fabricating a price', () => {
    expect(migrationPayerDisplayId('PAYER_AYALA_MALLS')).toBe('PYR_AAAAAAAC')
  })

  it('accepts target IDs and the source-enum Avega payer but fails closed for unknown aliases', () => {
    expect(migrationPayerDisplayId('PYR_AAAAAAA9')).toBe('PYR_AAAAAAA9')
    expect(migrationPayerDisplayId('PAYER_AVEGA')).toBe('PYR_AAAAAAAD')
    expect(migrationPayerDisplayId('PAYER_UNKNOWN')).toBeNull()
  })
})
