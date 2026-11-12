// Mirror of `apps/backend/src/modules/transactions/service.ts` for live preview
// in the create form. Keep the two in sync: server-side is the source of
// truth for persisted values, this is preview-only.

export type DiscountType = 'OSCA' | 'PWD' | 'Other' | 'NA'

export type PreviewItem = {
  serviceId: string
  basePrice: string // catalog snapshot, VAT-incl
  quantity: number
  isVatExempt: boolean
  isPrepaid: boolean
  /**
   * Per-line SC/PWD discount for multi-patient transactions (each patient's own
   * discount). `undefined` ⇒ fall back to the transaction-wide `discountType`.
   */
  discountType?: DiscountType | null
}

export type PreviewLine = {
  serviceId: string
  unitPrice: string
  quantity: number
  lineGross: string
  vatAmount: string
  discountAmount: string
  subtotal: string
}

export type PreviewTotals = {
  grossAmount: string
  discountAmount: string
  vatAmount: string
  netAmount: string
  lines: PreviewLine[]
}

const VAT_BASE_NUM = 112

const toCents = (n: number): number => Math.round(n * 100)
const centsToString = (c: number): string => ((c < 0 ? 0 : c) / 100).toFixed(2)

const isSeniorOrPwd = (d: DiscountType | null | undefined): boolean => d === 'OSCA' || d === 'PWD'

/**
 * Mirrors `computeTransactionTotals` in
 * `apps/backend/src/modules/transactions/service.ts` (the server is the
 * source of truth for persisted values; this is preview-only). Keep the two
 * in lockstep -- see that function's own comment for the full MONEY-6
 * rationale (RA 9994 section 4 / BIR RR 7-2010 for senior citizens, RA 10754
 * / BIR RR 5-2017 for PWD): a qualifying OSCA/PWD line is VAT-exempt AND
 * gets 20% off the VAT-exclusive base, whether or not the line was already
 * VAT-exempt for another (catalog) reason, on any non-prepaid line.
 *
 * The two entitlements are reported as two SEPARATE figures, not merged: the
 * reported line gross becomes the VAT-exclusive base itself (a VAT-exempt
 * sale is recorded at its VAT-exclusive selling price, not the VAT-inclusive
 * catalog price), and discountAmount is the 20% off that base standing
 * alone (the statutory RA 9994/RA 10754 deduction figure, not merged with
 * the VAT the sale never carried).
 *
 * Worked example (canonical published BIR figure): PHP1,000.00 VAT-inclusive
 * -> base = round(1000/1.12) = round(892.857...) = 892.86, discount =
 * round(892.86*0.20) = 178.57, due = 892.86-178.57 = 714.29. The base and the
 * discount are EACH rounded to the centavo (not a single final rounding of
 * an un-rounded "amount due"), a deliberate trade: on very small amounts the
 * two orders can differ by a centavo, and we choose the one where every
 * printed figure (base, discount, due) reconciles exactly by hand.
 */
export function computePreviewTotals(
  items: PreviewItem[],
  discountType: DiscountType | null,
): PreviewTotals {
  let grossCents = 0
  let vatCents = 0
  let discountCents = 0

  const lines: PreviewLine[] = items.map((item) => {
    // Per-line discount (multi-patient) falls back to the transaction-wide one.
    const lineDiscountType = item.discountType !== undefined ? item.discountType : discountType
    const applyDiscount = isSeniorOrPwd(lineDiscountType)
    const unitPriceCents = toCents(parseFloat(item.basePrice || '0'))
    const qty = Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 0
    // The catalog "sticker" price extended by quantity. NOT necessarily what
    // gets reported as the line's gross below, see the SC/PWD branch.
    const catalogGrossCents = Math.round(unitPriceCents * qty)

    const catalogVatExempt = item.isVatExempt
    // A qualifying senior-citizen / PWD line is VAT-exempt on this sale
    // regardless of the catalog flag (prepaid lines stay excluded).
    const scPwdEligible = applyDiscount && !item.isPrepaid
    const vatExempt = catalogVatExempt || scPwdEligible

    const baseCents = catalogVatExempt
      ? catalogGrossCents
      : Math.round((catalogGrossCents * 100) / VAT_BASE_NUM)

    // Reported line gross: the VAT-exclusive base for a qualifying SC/PWD
    // line, otherwise the ordinary catalog sticker price.
    const lineGrossCents = scPwdEligible ? baseCents : catalogGrossCents

    const lineVatCents = vatExempt
      ? 0
      : lineGrossCents - Math.round((lineGrossCents * 100) / VAT_BASE_NUM)

    const lineDiscountCents = scPwdEligible ? Math.round((baseCents * 20) / 100) : 0

    grossCents += lineGrossCents
    vatCents += lineVatCents
    discountCents += lineDiscountCents

    return {
      serviceId: item.serviceId,
      unitPrice: centsToString(unitPriceCents),
      quantity: qty,
      lineGross: centsToString(lineGrossCents),
      vatAmount: centsToString(lineVatCents),
      discountAmount: centsToString(lineDiscountCents),
      subtotal: centsToString(lineGrossCents - lineDiscountCents),
    }
  })

  return {
    grossAmount: centsToString(grossCents),
    discountAmount: centsToString(discountCents),
    vatAmount: centsToString(vatCents),
    netAmount: centsToString(grossCents - discountCents),
    lines,
  }
}

export function fmtMoney(s: string): string {
  const n = parseFloat(s)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
