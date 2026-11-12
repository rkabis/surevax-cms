// Transaction totals math, Philippines BIR conventions.
//
// All currency values are kept as 2-decimal strings (matching the wire format
// of `numeric(12,2)` which postgres.js serializes to JSON strings). Internal
// arithmetic uses cent-integers so we never accumulate float drift.
//
// Convention: catalog `unitPrice` is VAT-inclusive (12%). To express VAT-net
// of a line: `lineGross / 1.12`. A qualifying senior citizen / PWD sale
// (see MONEY-6 below) is VAT-exempt AND gets 20% off the VAT-exclusive
// price, on any non-prepaid line, regardless of the line's own catalog
// VAT-exempt flag. For such a line, the REPORTED `lineGross` (and its
// contribution to the transaction-level `grossAmount`) is restated as the
// VAT-exclusive base, not the VAT-inclusive catalog sticker price: a
// VAT-exempt sale is recorded at its VAT-exclusive selling price, and the
// 20% discount is reported standing alone, separate from the VAT the sale
// never carried. `unitPrice` itself still reports the raw catalog snapshot
// for audit purposes, so it will no longer equal `lineGross / quantity` on
// a qualifying line: that divergence is intentional.

export type DiscountType = 'OSCA' | 'PWD' | 'Other' | 'NA'

export type ServicePriceLookup = Record<
  string,
  { id: string; basePrice: string; isVatExempt?: boolean }
>

export type TotalsItemInput = {
  serviceId: string
  quantity: number
  isVatExempt: boolean
  isPrepaid: boolean
  /**
   * Per-line SC/PWD discount, for multi-patient transactions where each
   * patient presents their own (or no) discount ID. When `undefined`, the
   * transaction-wide `discountType` argument applies (single-patient path).
   * `null` / `'NA'` means "no discount for this line".
   */
  discountType?: DiscountType | null
  /**
   * Brand-resolved unit price (VAT-inclusive), overriding the service's
   * brand-agnostic catalog price. Set when the line bills a dose whose brand
   * is already known: the nurse's chosen lot fixes the product, and that
   * product may carry its own `service_prices` row. Absent/null → catalog price.
   */
  unitPriceOverride?: string | null
}

export type TotalsLine = {
  serviceId: string
  unitPrice: string // catalog snapshot (VAT-incl)
  quantity: number
  lineGross: string
  vatAmount: string
  discountAmount: string
  subtotal: string // gross - discount (the line's contribution to net)
  isVatExempt: boolean
  isPrepaid: boolean
}

export type TotalsResult = {
  grossAmount: string
  discountAmount: string
  vatAmount: string
  netAmount: string
  lines: TotalsLine[]
}

const VAT_RATE_NUM = 12
const VAT_BASE_NUM = 112 // 1 + 12% expressed as integer ratio
const SCPWD_DISCOUNT_NUM = 20 // percent

/** Round a non-negative number to integer cents. */
function toCents(n: number): number {
  return Math.round(n * 100)
}

function centsToString(c: number): string {
  // Avoid `-0.00` drift; clamp to zero floor in case of rounding noise.
  const safe = c < 0 ? 0 : c
  return (safe / 100).toFixed(2)
}

function getCatalog(catalog: ServicePriceLookup, serviceId: string) {
  const svc = catalog[serviceId]
  if (!svc) {
    throw new Error(`Service not found in catalog: ${serviceId}`)
  }
  return svc
}

/** True iff this discount type triggers the 20%-off-VAT-stripped-base rule. */
function isSeniorOrPwd(discount: DiscountType | null | undefined): boolean {
  return discount === 'OSCA' || discount === 'PWD'
}

export function computeTransactionTotals(
  items: TotalsItemInput[],
  discountType: DiscountType | null,
  catalog: ServicePriceLookup,
): TotalsResult {
  if (items.length === 0) {
    throw new Error('Transaction must have at least one item')
  }

  let grossCents = 0
  let vatCents = 0
  let discountCents = 0

  const lines: TotalsLine[] = items.map((item) => {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throw new Error(`Invalid quantity for item ${item.serviceId}`)
    }
    // Per-line discount (multi-patient) falls back to the transaction-wide
    // discount when the line doesn't carry its own.
    const lineDiscountType = item.discountType !== undefined ? item.discountType : discountType
    const applyDiscount = isSeniorOrPwd(lineDiscountType)
    const svc = getCatalog(catalog, item.serviceId)
    // A brand-resolved price wins over the catalog price; the catalog entry is
    // still required (existence check + catalog-level VAT-exempt flag).
    const effectiveUnitPrice = item.unitPriceOverride ?? svc.basePrice
    const unitPriceCents = toCents(parseFloat(effectiveUnitPrice))
    if (!Number.isFinite(unitPriceCents)) {
      throw new Error(`Invalid base price for ${item.serviceId}: ${effectiveUnitPrice}`)
    }

    // Catalog-level VAT-exempt (e.g. an NIRC-exempt good/service), a
    // property of the catalog entry itself, independent of any senior
    // citizen / PWD entitlement below.
    const catalogVatExempt = item.isVatExempt || svc.isVatExempt === true

    // The catalog "sticker" price extended by quantity, VAT-inclusive unless
    // the catalog entry says otherwise. This is NOT necessarily what gets
    // reported as the line's gross below -- see the SC/PWD branch.
    const catalogGrossCents = Math.round(unitPriceCents * item.quantity)

    // ---- BIR senior citizen (RA 9994 section 4, BIR RR 7-2010) / PWD
    // (RA 10754, BIR RR 5-2017) discount -------------------------------------
    // MONEY-6: a qualified senior-citizen or PWD sale carries TWO separate,
    // mandatory entitlements on the same line, not one or the other: the
    // seller is precluded from billing ANY VAT on the sale, AND the buyer is
    // due 20% off the VAT-exclusive price. This holds whether or not the
    // line's catalog entry independently carries its own vat-exempt flag: a
    // covered VAT-exempt line is still due the 20% (it was previously
    // skipped here, under-discounting those lines). Prepaid lines are still
    // excluded from the discount (unchanged): that guards against
    // double-discounting inventory that was already billed/settled before
    // this dose was administered.
    //
    // These two entitlements are also kept as two SEPARATE reported figures,
    // not merged into one "discount". Merging them would misstate two things
    // a BIR-registered receipt and an RA 9994/RA 10754 tax filing both rely
    // on: (a) the discount claimable as a deduction from gross income under
    // the implementing regs is specifically the 20% figure, not the 20%
    // plus the VAT the sale never carried, and (b) a VAT-exempt sale is
    // recorded at its VAT-exclusive selling price, not the VAT-inclusive
    // sticker price, so the VATable-vs-VAT-exempt split on the receipt
    // foots correctly. So for a qualifying line: the REPORTED gross becomes
    // the VAT-exclusive base itself (not the VAT-inclusive catalog price),
    // vatAmount is 0.00, discountAmount is the 20% off that base standing
    // alone, and subtotal = base - discount.
    //
    // Worked example (the canonical published BIR figure): a PHP1,000.00
    // VAT-inclusive catalog price.
    //   base (VAT-exclusive) = round(1,000.00 / 1.12) = round(892.857...) = 892.86
    //   20% discount          = round(892.86 * 0.20)    = round(178.572)   = 178.57
    //   amount due            = base - discount          = 892.86 - 178.57 = 714.29
    // This matches the published BIR answer exactly, so nothing is lost on
    // realistic clinic prices. Second worked example (this repo's seeded
    // PHP280.00 lab line, which happens to divide evenly): base = 250.00,
    // discount = 50.00, amount due = 200.00.
    //
    // Rounding: the base and the discount are EACH rounded to the centavo
    // (not a single final rounding of "amount due" as an un-rounded
    // expression). This is a deliberate trade: rounding twice can land a
    // centavo away from a hypothetical un-rounded ideal on very small
    // amounts (e.g. a PHP1.10 line rounds to a PHP0.78 amount due this way,
    // versus PHP0.79 if only the final figure were rounded). We accept that
    // one-centavo difference on edge-case amounts because the alternative is
    // worse: a receipt whose printed "base minus discount" doesn't equal its
    // printed "amount due" is indefensible in front of a cashier or an
    // auditor. Reporting base and discount as the actual rounded figures
    // used to compute the amount due keeps every printed number internally
    // consistent, which matters more than matching an un-rounded ideal.
    const scPwdEligible = applyDiscount && !item.isPrepaid
    const vatExempt = catalogVatExempt || scPwdEligible

    const baseCents = catalogVatExempt
      ? catalogGrossCents
      : Math.round((catalogGrossCents * 100) / VAT_BASE_NUM)

    // The reported line gross: the VAT-exclusive base for a qualifying
    // SC/PWD line (see above), otherwise the ordinary catalog sticker price.
    const lineGrossCents = scPwdEligible ? baseCents : catalogGrossCents

    const lineVatCents = vatExempt
      ? 0
      : lineGrossCents - Math.round((lineGrossCents * 100) / VAT_BASE_NUM)

    const lineDiscountCents = scPwdEligible ? Math.round((baseCents * SCPWD_DISCOUNT_NUM) / 100) : 0

    grossCents += lineGrossCents
    vatCents += lineVatCents
    discountCents += lineDiscountCents

    const subtotalCents = lineGrossCents - lineDiscountCents

    return {
      serviceId: item.serviceId,
      unitPrice: centsToString(unitPriceCents),
      quantity: item.quantity,
      lineGross: centsToString(lineGrossCents),
      vatAmount: centsToString(lineVatCents),
      discountAmount: centsToString(lineDiscountCents),
      subtotal: centsToString(subtotalCents),
      isVatExempt: vatExempt,
      isPrepaid: item.isPrepaid,
    }
  })

  const netCents = grossCents - discountCents

  return {
    grossAmount: centsToString(grossCents),
    discountAmount: centsToString(discountCents),
    vatAmount: centsToString(vatCents),
    netAmount: centsToString(netCents),
    lines,
  }
}

// Re-export VAT constants so the frontend totals util can stay in sync if
// imported (currently it duplicates them, that's fine, just keep both updated).
export const VAT_RATE = VAT_RATE_NUM
export const SCPWD_DISCOUNT_PCT = SCPWD_DISCOUNT_NUM
