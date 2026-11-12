import { describe, it, expect } from 'vitest'
import {
  computeTransactionTotals,
  type ServicePriceLookup,
} from '../../src/modules/transactions/service.js'

/**
 * Pure arithmetic for BIR SC/PWD (senior citizen / PWD) transaction totals.
 * No DB, no fixtures. MONEY-6: RA 9994 section 4 (BIR RR 7-2010, senior
 * citizens) and RA 10754 (BIR RR 5-2017, PWD) both require a qualifying line
 * to be VAT-exempt AND get 20% off the VAT-exclusive base, whichever else is
 * true about the line's catalog entry, on any non-prepaid line. The two
 * entitlements are reported as two SEPARATE figures: the reported line gross
 * becomes the VAT-exclusive base itself (not the VAT-inclusive catalog
 * price), and discountAmount is the 20% off that base standing alone (not
 * merged with the VAT the sale never carried). See `computeTransactionTotals`'s
 * own comment in `../../src/modules/transactions/service.ts` for the full
 * worked rationale and the rounding rule (the base and the discount are
 * EACH rounded to the centavo, a deliberate trade for internal consistency
 * of the printed figures over matching an un-rounded ideal).
 */

const catalog: ServicePriceLookup = {
  SVC_1000: { id: 'SVC_1000', basePrice: '1000.00' },
  LAB_ABO_RH: { id: 'LAB_ABO_RH', basePrice: '280.00' }, // this repo's seeded lab line
  SVC_CATALOG_EXEMPT: { id: 'SVC_CATALOG_EXEMPT', basePrice: '280.00', isVatExempt: true },
  SVC_ODD: { id: 'SVC_ODD', basePrice: '100.50' },
  SVC_TINY: { id: 'SVC_TINY', basePrice: '1.10' },
}

describe('computeTransactionTotals: BIR SC/PWD discount (MONEY-6)', () => {
  it('the canonical published BIR figure: PHP1,000.00 -> base 892.86, discount 178.57, due 714.29', () => {
    const t = computeTransactionTotals(
      [
        {
          serviceId: 'SVC_1000',
          quantity: 1,
          isVatExempt: false,
          isPrepaid: false,
          discountType: 'OSCA',
        },
      ],
      null,
      catalog,
    )
    expect(t.lines[0]!.isVatExempt).toBe(true)
    expect(t.lines[0]!.vatAmount).toBe('0.00')
    // Reported gross is the VAT-exclusive base, not the 1000.00 catalog price.
    expect(t.lines[0]!.lineGross).toBe('892.86')
    expect(t.lines[0]!.discountAmount).toBe('178.57')
    expect(t.lines[0]!.subtotal).toBe('714.29')
    expect(t.grossAmount).toBe('892.86')
    expect(t.vatAmount).toBe('0.00')
    expect(t.discountAmount).toBe('178.57')
    expect(t.netAmount).toBe('714.29')
  })

  it('the seeded PHP280.00 lab line -> base 250.00, discount 50.00, due 200.00 (PWD)', () => {
    const t = computeTransactionTotals(
      [
        {
          serviceId: 'LAB_ABO_RH',
          quantity: 1,
          isVatExempt: false,
          isPrepaid: false,
          discountType: 'PWD',
        },
      ],
      null,
      catalog,
    )
    expect(t.lines[0]!.isVatExempt).toBe(true)
    expect(t.lines[0]!.lineGross).toBe('250.00')
    expect(t.lines[0]!.discountAmount).toBe('50.00')
    expect(t.vatAmount).toBe('0.00')
    expect(t.netAmount).toBe('200.00')
  })

  it('a catalog VAT-exempt line now correctly ALSO receives the 20% (previously skipped)', () => {
    // Catalog already marks this exempt: base = gross (nothing to strip),
    // so 20% off 280.00 = 56.00, due = 224.00. Gross is unchanged from the
    // catalog price here because there was never any VAT in it to strip out.
    const t = computeTransactionTotals(
      [
        {
          serviceId: 'SVC_CATALOG_EXEMPT',
          quantity: 1,
          isVatExempt: false,
          isPrepaid: false,
          discountType: 'OSCA',
        },
      ],
      null,
      catalog,
    )
    expect(t.lines[0]!.vatAmount).toBe('0.00')
    expect(t.lines[0]!.lineGross).toBe('280.00')
    expect(t.lines[0]!.discountAmount).toBe('56.00')
    expect(t.netAmount).toBe('224.00')
  })

  it('a mixed transaction (one OSCA line + one ordinary VATable line) computes each independently', () => {
    const t = computeTransactionTotals(
      [
        {
          serviceId: 'SVC_1000',
          quantity: 1,
          isVatExempt: false,
          isPrepaid: false,
          discountType: 'OSCA',
        },
        {
          serviceId: 'LAB_ABO_RH',
          quantity: 1,
          isVatExempt: false,
          isPrepaid: false,
          discountType: null,
        },
      ],
      null,
      catalog,
    )
    const oscaLine = t.lines.find((l) => l.serviceId === 'SVC_1000')!
    const ordinaryLine = t.lines.find((l) => l.serviceId === 'LAB_ABO_RH')!

    expect(oscaLine.isVatExempt).toBe(true)
    expect(oscaLine.vatAmount).toBe('0.00')
    expect(oscaLine.lineGross).toBe('892.86') // VAT-exclusive base, not 1000.00
    expect(oscaLine.discountAmount).toBe('178.57')
    expect(oscaLine.subtotal).toBe('714.29')

    expect(ordinaryLine.isVatExempt).toBe(false)
    expect(ordinaryLine.vatAmount).toBe('30.00')
    expect(ordinaryLine.lineGross).toBe('280.00') // ordinary line: unaffected
    expect(ordinaryLine.discountAmount).toBe('0.00')
    expect(ordinaryLine.subtotal).toBe('280.00')

    // Aggregate gross is 892.86 + 280.00, NOT 1000.00 + 280.00: the OSCA
    // line's contribution to grossAmount is its VAT-exclusive base, since a
    // VAT-exempt sale is recorded at its VAT-exclusive selling price.
    expect(t.grossAmount).toBe('1172.86')
    // Aggregate discount is the statutory 20% alone (178.57), not merged
    // with the VAT the OSCA line never carried.
    expect(t.discountAmount).toBe('178.57')
    // Aggregate VAT excludes the exempted line; net is the sum of line subtotals.
    expect(t.vatAmount).toBe('30.00')
    expect(t.netAmount).toBe('994.29')
    const subtotalSum = t.lines.reduce((s, l) => s + parseFloat(l.subtotal), 0)
    expect(subtotalSum).toBeCloseTo(parseFloat(t.netAmount), 2)
  })

  it('a per-line discount overrides the transaction-wide one (multi-patient family bill)', () => {
    const t = computeTransactionTotals(
      [
        {
          serviceId: 'LAB_ABO_RH',
          quantity: 1,
          isVatExempt: false,
          isPrepaid: false,
          discountType: undefined,
        }, // inherits OSCA
        {
          serviceId: 'LAB_ABO_RH',
          quantity: 1,
          isVatExempt: false,
          isPrepaid: false,
          discountType: null,
        }, // explicit none
      ],
      'OSCA',
      catalog,
    )
    expect(t.lines[0]!.isVatExempt).toBe(true)
    expect(t.lines[0]!.lineGross).toBe('250.00')
    expect(t.lines[0]!.discountAmount).toBe('50.00')
    expect(t.lines[0]!.subtotal).toBe('200.00')
    expect(t.lines[1]!.isVatExempt).toBe(false)
    expect(t.lines[1]!.lineGross).toBe('280.00')
    expect(t.lines[1]!.discountAmount).toBe('0.00')
    expect(t.lines[1]!.subtotal).toBe('280.00')
  })

  it('still excludes a prepaid line from the SC/PWD discount (no double-discount on settled inventory)', () => {
    const t = computeTransactionTotals(
      [
        {
          serviceId: 'SVC_1000',
          quantity: 1,
          isVatExempt: false,
          isPrepaid: true,
          discountType: 'OSCA',
        },
      ],
      null,
      catalog,
    )
    expect(t.lines[0]!.isVatExempt).toBe(false)
    expect(t.lines[0]!.lineGross).toBe('1000.00') // unaffected: prepaid lines keep the catalog price
    expect(t.lines[0]!.discountAmount).toBe('0.00')
    expect(t.netAmount).toBe('1000.00')
  })

  it('rounds the base and the discount EACH to the centavo (PHP100.50 pins the choice)', () => {
    // 100.50 / 1.12 = 89.7321..., not a whole cent. We round the base to
    // 89.73 first, THEN take 20% of that rounded base (17.946 -> 17.95),
    // THEN subtract (89.73 - 17.95 = 71.78). A hypothetical single final
    // rounding of an un-rounded "amount due" expression would instead give
    // 71.79 (a centavo higher). We deliberately choose the double-rounding
    // answer (71.78) because every printed figure then reconciles exactly:
    // base minus discount equals due, which a cashier or auditor can verify
    // by hand from the receipt alone.
    const t = computeTransactionTotals(
      [
        {
          serviceId: 'SVC_ODD',
          quantity: 1,
          isVatExempt: false,
          isPrepaid: false,
          discountType: 'OSCA',
        },
      ],
      null,
      catalog,
    )
    expect(t.vatAmount).toBe('0.00')
    expect(t.lines[0]!.lineGross).toBe('89.73')
    expect(t.lines[0]!.discountAmount).toBe('17.95')
    expect(t.netAmount).toBe('71.78')
  })

  it('can differ from an un-rounded ideal by one centavo on a very small amount (PHP1.10)', () => {
    // 1.10 / 1.12 = 0.98214..., rounds to 0.98. 20% of 0.98 = 0.196, rounds
    // to 0.20. Due = 0.98 - 0.20 = 0.78. An un-rounded single-final-rounding
    // calculation would give 0.79 instead. This is the one-centavo trade the
    // repo accepts in exchange for base/discount/due always reconciling.
    const t = computeTransactionTotals(
      [
        {
          serviceId: 'SVC_TINY',
          quantity: 1,
          isVatExempt: false,
          isPrepaid: false,
          discountType: 'OSCA',
        },
      ],
      null,
      catalog,
    )
    expect(t.lines[0]!.lineGross).toBe('0.98')
    expect(t.lines[0]!.discountAmount).toBe('0.20')
    expect(t.netAmount).toBe('0.78')
  })
})
