import { describe, expect, it } from 'vitest'
import { computePreviewTotals, fmtMoney, type PreviewItem } from '../totals'

/**
 * Money math for the cashier create-form live preview. This mirrors the
 * backend `computeTransactionTotals` (server is the source of truth for
 * persisted values); the two must agree, so the BIR SC/PWD discount rule and
 * the cents rounding are pinned here. Currency columns are `numeric(12,2)`
 * strings end to end, every value in/out is a string.
 *
 * MONEY-6: a qualifying senior citizen (RA 9994 section 4, BIR RR 7-2010) /
 * PWD (RA 10754, BIR RR 5-2017) line is VAT-exempt AND gets 20% off the
 * VAT-exclusive base, regardless of whether the line was already VAT-exempt
 * for another (catalog) reason. The two entitlements are reported as two
 * SEPARATE figures: the reported line gross becomes the VAT-exclusive base
 * itself (not the VAT-inclusive catalog price), and discountAmount is the
 * 20% off that base standing alone (not merged with the VAT the sale never
 * carried). The base and the discount are EACH rounded to the centavo, a
 * deliberate choice so every printed figure (base, discount, due) always
 * reconciles by hand, even though it can differ from a hypothetical
 * un-rounded ideal by a centavo on very small amounts.
 */

const item = (over: Partial<PreviewItem> = {}): PreviewItem => ({
  serviceId: 'SVC_X',
  basePrice: '1120.00', // VAT-inclusive catalog snapshot
  quantity: 1,
  isVatExempt: false,
  isPrepaid: false,
  ...over,
})

describe('computePreviewTotals', () => {
  it('passes a plain VAT-inclusive line through, splitting out the 12% VAT', () => {
    const t = computePreviewTotals([item()], 'NA')
    expect(t.grossAmount).toBe('1120.00')
    expect(t.vatAmount).toBe('120.00') // 1120 - 1120/1.12
    expect(t.discountAmount).toBe('0.00')
    expect(t.netAmount).toBe('1120.00')
    expect(t.lines[0]!.subtotal).toBe('1120.00')
  })

  it('is VAT-exempt AND applies the 20% discount to the VAT-EXCLUSIVE base (MONEY-6)', () => {
    // 1120 incl VAT -> 1000 base (VAT-exclusive, exact). The seller bills NO
    // VAT at all on this sale (vatAmount = 0.00). The reported gross is the
    // base itself (1000, not the 1120 catalog price), and discountAmount is
    // the statutory 20% of that base standing alone (200), not merged with
    // the 120 of VAT the sale never carried. Due = 1000 - 200 = 800.
    const t = computePreviewTotals([item()], 'OSCA')
    expect(t.grossAmount).toBe('1000.00')
    expect(t.vatAmount).toBe('0.00')
    expect(t.discountAmount).toBe('200.00')
    expect(t.netAmount).toBe('800.00')
    expect(t.lines[0]!.lineGross).toBe('1000.00')
    expect(t.lines[0]!.subtotal).toBe('800.00')
    expect(t.lines[0]!.vatAmount).toBe('0.00')
  })

  it('treats PWD identically to OSCA (both are 20% senior/PWD)', () => {
    expect(computePreviewTotals([item()], 'PWD').netAmount).toBe(
      computePreviewTotals([item()], 'OSCA').netAmount,
    )
  })

  it('does not discount an Other / NA discount type', () => {
    expect(computePreviewTotals([item()], 'Other').discountAmount).toBe('0.00')
    expect(computePreviewTotals([item()], 'NA').discountAmount).toBe('0.00')
    expect(computePreviewTotals([item()], null).discountAmount).toBe('0.00')
  })

  it('still applies the 20% discount to a line that is ALREADY VAT-exempt by catalog (MONEY-6)', () => {
    // No VAT to strip (base === gross), so the 20% is off the gross itself:
    // 1000 * 0.20 = 200 discount -> 800 due.
    const t = computePreviewTotals([item({ isVatExempt: true, basePrice: '1000.00' })], 'OSCA')
    expect(t.vatAmount).toBe('0.00')
    expect(t.discountAmount).toBe('200.00')
    expect(t.netAmount).toBe('800.00')
  })

  it('never applies the SC/PWD discount to a prepaid line', () => {
    const t = computePreviewTotals([item({ isPrepaid: true })], 'OSCA')
    expect(t.discountAmount).toBe('0.00')
    expect(t.netAmount).toBe('1120.00')
  })

  it('multiplies by quantity and coerces bad quantities to 0', () => {
    expect(
      computePreviewTotals([item({ basePrice: '112.00', quantity: 3 })], 'NA').grossAmount,
    ).toBe('336.00')
    expect(computePreviewTotals([item({ quantity: 0 })], 'NA').grossAmount).toBe('0.00')
    expect(computePreviewTotals([item({ quantity: NaN })], 'NA').grossAmount).toBe('0.00')
    expect(computePreviewTotals([item({ quantity: -2 })], 'NA').grossAmount).toBe('0.00')
  })

  it('lets a per-line discount override the transaction-wide one (multi-patient billing)', () => {
    // Transaction-wide is OSCA, but each patient carries their own eligibility.
    const t = computePreviewTotals(
      [
        item({ serviceId: 'A', discountType: undefined }), // inherit OSCA → discounted
        item({ serviceId: 'B', discountType: null }), // explicit "none" → NOT discounted
        item({ serviceId: 'C', discountType: 'PWD' }), // own PWD → discounted
      ],
      'OSCA',
    )
    const byId = Object.fromEntries(t.lines.map((l) => [l.serviceId, l.discountAmount]))
    expect(byId['A']).toBe('200.00')
    expect(byId['B']).toBe('0.00')
    expect(byId['C']).toBe('200.00')
    expect(t.discountAmount).toBe('400.00') // A + C only
  })

  it('rounds the base and the discount EACH to the centavo (odd price pins the choice)', () => {
    // 100.50 / 1.12 = 89.7321... (not a whole cent). We round the base to
    // 89.73 first, then take 20% of THAT rounded base (17.946 -> 17.95),
    // then subtract (89.73 - 17.95 = 71.78). A single final rounding of an
    // un-rounded "amount due" expression would instead give 71.79 (a
    // centavo higher). We choose 71.78 so base minus discount always equals
    // the printed due amount exactly.
    const t = computePreviewTotals([item({ basePrice: '100.50' })], 'OSCA')
    expect(t.vatAmount).toBe('0.00')
    expect(t.lines[0]!.lineGross).toBe('89.73')
    expect(t.discountAmount).toBe('17.95')
    expect(t.netAmount).toBe('71.78')
  })

  it('returns all-zero totals for an empty basket', () => {
    const t = computePreviewTotals([], 'OSCA')
    expect(t).toMatchObject({
      grossAmount: '0.00',
      discountAmount: '0.00',
      vatAmount: '0.00',
      netAmount: '0.00',
      lines: [],
    })
  })
})

describe('fmtMoney', () => {
  it('formats a numeric string with thousands separators + 2 decimals', () => {
    expect(fmtMoney('4820')).toBe('4,820.00')
    expect(fmtMoney('1234.5')).toBe('1,234.50')
  })

  it('returns an em dash for non-numeric input', () => {
    expect(fmtMoney('')).toBe('—')
    expect(fmtMoney('abc')).toBe('—')
  })
})
