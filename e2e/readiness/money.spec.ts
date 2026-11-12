import { test, expect, type Page, type Locator } from '@playwright/test'
import { attestAs } from '../fixtures/attestation'

/**
 * Nurse testing readiness: money-handling paths a nurse acting as her own
 * cashier must get right before a pilot (one Branch login per clinic, no
 * dedicated cashier role). Every test here runs as the seeded `Branch`
 * persona via the project storageState.
 *
 * R4, multi-method (split) payment: `TransactionsCreatePage` has a real
 * split-tender editor (`SplitTenderEditor`, apps/frontend/src/features/
 * transactions/components/SplitTenderEditor.tsx), wired in via the "Split"
 * method button. The dose-worklist collect step (`CollectPaymentPanel`,
 * apps/frontend/src/features/scheduled-orders/components/
 * CollectPaymentDialog.tsx) now reuses the same `SplitTenderEditor` behind a
 * "Split across multiple payment methods" opt-in checkbox, off by default so
 * a single-tender collection never has to touch the multi-leg editor. Test 1
 * proves split tender on the cashier surface (two tenders summing to the
 * net, transaction reaches Paid, both legs visible on the receipt); test 2
 * proves the same shape from the dose-worklist collect step.
 *
 * R7, prepay a dose or hold the balance: `CollectPaymentPanel` lets the
 * nurse (a) pick ANY unbilled dose in the chain, not only the one due
 * today, so a future dose can be billed and paid ahead of administration,
 * and (b) uncheck "Pay in full" and enter a downpayment, leaving the bill
 * Pending with the remainder outstanding. This spec stays focused on that
 * dose-collect path; the free-standing deposit/credit mechanic and the
 * /receivables worklist (aging buckets, statement) are already covered end
 * to end in e2e/receivables.spec.ts and are not duplicated here.
 *
 * R8, senior citizen (OSCA) / PWD discount: the owner's stated requirement
 * is 20% off AND VAT-exempt (MONEY-6). `computeTransactionTotals`
 * (apps/backend/src/modules/transactions/service.ts) now zeroes VAT for a
 * qualifying line regardless of the line's own catalog VAT-exempt flag, and
 * computes the 20% off the VAT-exclusive base, so the seller bills no VAT at
 * all on the sale and the patient additionally gets 20% off. The worked
 * arithmetic is in the comment above the describe block below.
 *
 * Money assertions compare exact peso strings, never "contains a number",
 * using the same parse/format/sibling-value helpers as
 * e2e/receivables.spec.ts (every money figure in this app renders as a
 * label element immediately followed by a sibling element holding the
 * value).
 *
 * Currency-input bug (docs/STATUS.md, "Known UI bugs" /
 * "Currency-input programmatic value-set"): every money input actually
 * driven in this spec (SplitTenderEditor's leg amount inputs, the
 * CollectPaymentPanel downpayment input) is plain React `useState` wired
 * through a normal `onChange` handler, not a `form.setValue(...)`
 * programmatic set, confirmed by reading the component source (see the
 * inline notes at each interaction below). `fill()` reliably drives all of
 * them. No input in this spec resisted `fill()`; nothing here was hacked
 * around with `evaluate()` or DOM mutation.
 *
 * Determinism / mutating: R4's and R8's real tests create fresh
 * transactions against the seeded Cruz patient (PAT_AAAAAAA5, the only
 * patient guaranteed active consent outside the seed, per
 * e2e/receivables.spec.ts's own header comment). R7 additionally registers
 * a brand-new 5-dose rabies PEP course for Cruz via the Arrivals wizard
 * (mirrors e2e/daily-loop.spec.ts's registration flow, targeting Cruz by
 * name instead of ".first()" so this spec can read her billing tab
 * afterwards). Nothing here mutates a row another spec depends on.
 */

const CRUZ_PATIENT_ID = 'PAT_AAAAAAA5' // seed constant PAT_CRUZ_DISPLAY_ID (Elena Cruz)

function peso(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function parsePeso(text: string): number {
  const match = text.match(/₱([\d,]+\.\d{2})/)
  if (!match) throw new Error(`Could not find a peso amount in "${text}"`)
  return Math.round(parseFloat(match[1].replace(/,/g, '')) * 100)
}

/**
 * Label element immediately followed by its value sibling: Field's two
 * <p>s, KpiCell's eyebrow + value, and the read-only summary rows in
 * PayBalancePanel / CollectPaymentPanel / SplitTenderEditor / TenderRail.
 * Same convention as e2e/receivables.spec.ts's own helper of this name.
 */
function siblingValue(within: Page | Locator, label: string): Locator {
  return within.getByText(label, { exact: true }).locator('xpath=following-sibling::*[1]')
}

/** The status badge row next to a transaction's own <h2> id heading. */
function txnHeader(page: Page, txnId: string): Locator {
  return page.locator('h2', { hasText: txnId }).locator('xpath=following-sibling::div[1]')
}

/** A payments-table row for an exact payment method ("Cash", "GCash", ...). */
function paymentRow(section: Locator, method: string): Locator {
  return section.getByRole('cell', { name: method, exact: true }).locator('xpath=ancestor::tr[1]')
}

/**
 * Registers a fresh 5-dose rabies PEP course (WHO Category II, intramuscular
 * Essen regimen, days 0/3/7/14/28) for the seeded Cruz patient via the
 * Arrivals wizard. Mirrors e2e/daily-loop.spec.ts's own flow, but picks
 * Cruz by name via the identify search instead of ".first()", so callers
 * can read her billing tab deterministically afterwards. Returns the Day-0
 * clinical order's display id, carried on the Arrivals done URL.
 */
async function registerFreshPepOrder(page: Page, chiefComplaint: string): Promise<string> {
  await page.goto('/arrivals')
  await expect(page).toHaveURL(/\/arrivals\/identify/)

  await page.getByLabel('Search patients').fill('Cruz')
  const cruzOption = page.getByRole('option', { name: /Cruz, Elena/i })
  await expect(cruzOption).toBeVisible()
  await cruzOption.click()
  await expect(page).toHaveURL(/\/arrivals\/encounter/)

  await page.getByLabel('Specialty').selectOption('Rabies')
  await page
    .getByRole('radiogroup', { name: /WHO exposure category/i })
    .getByRole('radio', { name: /^Category II\b/ })
    .click()
  await page.getByLabel('Chief complaint').fill(chiefComplaint)
  await page.getByRole('checkbox', { name: /informed consent was obtained/i }).check()
  await page.getByRole('button', { name: /save & continue/i }).click()
  await expect(page).toHaveURL(/\/arrivals\/protocol/)

  await page
    .locator('label')
    .filter({ hasText: /Rabies PEP.*Intramuscular \(5-dose\)/ })
    .click()

  const physician = page.locator('#physician-id')
  await expect(physician).toBeVisible()
  await expect(physician.locator('option')).not.toHaveCount(1)
  await physician.selectOption({ index: 1 })

  const commit = page.getByRole('button', { name: /commit bundle/i })
  await expect(commit).toBeEnabled()
  await commit.click()
  await expect(page).toHaveURL(/\/arrivals\/done/)

  const day0OrderId = new URL(page.url()).searchParams.get('day0OrderId')
  expect(day0OrderId, 'arrivals done URL should carry day0OrderId').toBeTruthy()
  return day0OrderId!
}

/** Selects Cruz and adds a lab line via the cashier "New Transaction" flow. */
async function startCruzAboRhBill(page: Page): Promise<void> {
  await page.goto('/transactions/new')
  await page.getByPlaceholder('Search patient by name').fill('Cruz')
  const patientResult = page.getByRole('button', { name: /Cruz, Elena/i }).first()
  await expect(patientResult).toBeVisible()
  await patientResult.click()

  // A lab line ("ABO and Rh", PHP280.00 in the seed catalog) so nothing here
  // depends on inventory/FEFO, same convention as transactions.spec.ts and
  // e2e/receivables.spec.ts.
  await page.getByPlaceholder('Search by service name or code').fill('ABO')
  await page.getByRole('button', { name: /ABO and Rh/ }).click()
}

test.describe('R4: multi-method (split) payment', () => {
  test('settles a bill with two tenders that sum to the net, via the cashier New Transaction split editor', async ({
    page,
  }) => {
    await startCruzAboRhBill(page)

    // No discount, not VAT-exempt: net = gross = PHP280.00 exactly.
    const form = page.locator('#txn-form')
    await form.getByRole('button', { name: 'Split', exact: true }).click()

    // SplitTenderEditor seeds one Cash leg at the full net when Split is
    // first selected. Its Amount input is plain useState wired through a
    // normal onChange (SplitTenderEditor.tsx's `update()`), not RHF
    // setValue, so fill() drives it directly.
    const legAmounts = form.locator('input[inputmode="decimal"]')
    await expect(legAmounts).toHaveCount(1)
    await legAmounts.nth(0).fill('140.00')

    // "Add method" seeds the new leg with whatever remains (PHP140.00), so
    // no second fill is needed for the amount.
    await form.getByRole('button', { name: 'Add method' }).click()
    await expect(legAmounts).toHaveCount(2)
    await expect(legAmounts.nth(1)).toHaveValue('140.00')

    // Switch leg 2 off Cash so this is genuinely two different tenders. Each
    // leg's method control is named by its position ("Payment 2 method"): the
    // visible "Method" label renders only above the first leg and carries no
    // htmlFor, so the per-leg aria-label is the only accessible name there is.
    await expect(form.getByRole('combobox', { name: /payment \d+ method/i })).toHaveCount(2)
    await form.getByRole('combobox', { name: 'Payment 2 method', exact: true }).click()
    await page.getByRole('option', { name: 'GCash', exact: true }).click()

    await expect(form.getByText('Remaining ₱0.00')).toBeVisible()
    await attestAs(form)

    const tender = page.getByRole('button', { name: /^Tender ₱/ })
    await expect(tender).toBeEnabled()
    await tender.click()

    // Committing navigates to /transactions?selected=<id>, but `?selected=` is
    // a ONE-SHOT param (Pattern 34): TransactionsPage reads it into state and
    // strips it back out of the URL, so asserting on the URL is a race the test
    // loses. Assert the detail rail the nurse actually ends up looking at, and
    // take the id from its heading.
    await expect(page).toHaveURL(/\/transactions/, { timeout: 20_000 })
    const railHeading = page.getByRole('heading', { name: /^TXN_/ })
    await expect(railHeading).toBeVisible({ timeout: 20_000 })
    const txnId = (await railHeading.textContent())?.trim()
    expect(txnId, 'the rail should open on the bill just created').toMatch(/^TXN_/)

    // Paid, with both legs on the receipt.
    await expect(txnHeader(page, txnId!)).toContainText('Paid')
    await expect(page.getByRole('heading', { name: 'Payments (2)' })).toBeVisible()
    const paymentsSection = page.locator('section[aria-labelledby="txn-payments-heading"]')
    await expect(paymentRow(paymentsSection, 'Cash')).toContainText(peso(14000))
    await expect(paymentRow(paymentsSection, 'GCash')).toContainText(peso(14000))
    await expect(siblingValue(page, 'Balance due')).toHaveText(peso(0))
  })

  test('splits tender across two methods directly from the dose-worklist collect step', async ({
    page,
  }) => {
    // CollectPaymentDialog.tsx's CollectPaymentPanel now reuses
    // SplitTenderEditor behind a "Split across multiple payment methods"
    // checkbox (off by default), rather than reimplementing split logic or
    // adding a "Split" entry to the single Method select. A nurse collecting
    // payment from the dose worklist, the actual daily path, can now split a
    // bill across two tenders the same way the cashier flow already could.
    const day0OrderId = await registerFreshPepOrder(
      page,
      'Dog bite, right calf, split-tender readiness check',
    )
    await page.goto(`/scheduled-orders?selected=${encodeURIComponent(day0OrderId)}`)
    const collectTrigger = page.getByRole('button', { name: /^collect payment$/i })
    await expect(collectTrigger).toBeEnabled()
    await collectTrigger.click()
    await expect(page.getByRole('heading', { name: 'Collect payment' })).toBeVisible()

    // Day-0 is due today and preselects on its own; read what it actually
    // costs instead of hard-coding a catalog price.
    // Wait for the dose selection to price before reading the total: the panel
    // renders "Estimated total" as PHP0.00 for a beat while the preselected
    // dose and its price resolve, and parsing that zero makes every downstream
    // leg amount zero too.
    const estimatedTotal = siblingValue(page, 'Estimated total')
    await expect(estimatedTotal).not.toHaveText('₱0.00')
    const netCents = parsePeso((await estimatedTotal.textContent()) ?? '')

    await page.getByRole('checkbox', { name: /split across multiple payment methods/i }).click()

    // SplitTenderEditor seeds one Cash leg at the full net when splitting is
    // first turned on. Its Amount input is plain useState wired through a
    // normal onChange (SplitTenderEditor.tsx's `update()`), not RHF
    // setValue, so fill() drives it directly, same as the cashier-flow test.
    const legAmounts = page.locator('input[inputmode="decimal"]')
    await expect(legAmounts).toHaveCount(1)
    await expect(legAmounts.nth(0)).toHaveValue((netCents / 100).toFixed(2))

    const firstLegCents = Math.floor(netCents / 2)
    const secondLegCents = netCents - firstLegCents
    await legAmounts.nth(0).fill((firstLegCents / 100).toFixed(2))

    // "Add method" seeds the new leg with whatever remains, so no second
    // fill is needed for the amount.
    await page.getByRole('button', { name: 'Add method' }).click()
    await expect(legAmounts).toHaveCount(2)
    await expect(legAmounts.nth(1)).toHaveValue((secondLegCents / 100).toFixed(2))

    // Switch leg 2 off Cash so this is genuinely two different tenders.
    await page.getByRole('combobox', { name: 'Payment 2 method', exact: true }).click()
    await page.getByRole('option', { name: 'GCash', exact: true }).click()

    await expect(page.getByText('Remaining ₱0.00')).toBeVisible()
    await attestAs(page)

    const submit = page.getByRole('button', { name: /^collect payment$/i })
    await expect(submit).toBeEnabled()

    // Capture the created transaction's id from the create response: unlike
    // the cashier flow, the collect panel closes back into the worklist
    // rather than navigating to /transactions, so there is no URL or
    // deep-linked heading to read the id from afterward.
    const [createResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith('/api/transactions') && r.request().method() === 'POST',
      ),
      submit.click(),
    ])
    const created = (await createResp.json()) as { id: string }
    expect(created.id, 'create response should carry the new transaction id').toMatch(/^TXN_/)

    await expect(page.getByText('Payment collected')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('heading', { name: 'Collect payment' })).toBeHidden()

    // Paid, with both legs on the receipt, same assertions as the passing
    // cashier-flow test above.
    await page.goto(`/transactions?selected=${encodeURIComponent(created.id)}`)
    await expect(txnHeader(page, created.id)).toContainText('Paid')
    await expect(page.getByRole('heading', { name: 'Payments (2)' })).toBeVisible()
    const paymentsSection = page.locator('section[aria-labelledby="txn-payments-heading"]')
    await expect(paymentRow(paymentsSection, 'Cash')).toContainText(peso(firstLegCents))
    await expect(paymentRow(paymentsSection, 'GCash')).toContainText(peso(secondLegCents))
    await expect(siblingValue(page, 'Balance due')).toHaveText(peso(0))
  })
})

test.describe('R7: prepay a future dose, or hold the balance', () => {
  test('prepays a future dose in full, and a downpayment leaves the bill Pending with the correct outstanding', async ({
    page,
  }) => {
    test.slow() // long, sequential journey: register, then two collect-payment round trips

    // Baseline before touching anything (e2e/receivables.spec.ts's own
    // convention: every figure below is a delta off this baseline, so the
    // spec is correct regardless of run order or leftover state).
    await page.goto(`/patients/${CRUZ_PATIENT_ID}?tab=billing`)
    const baselineOutstandingCents = parsePeso(
      (await siblingValue(page, 'Outstanding').textContent()) ?? '',
    )

    const day0OrderId = await registerFreshPepOrder(
      page,
      'Dog bite, right calf, prepay/hold-balance readiness check',
    )

    // ── Scenario A: prepay a FUTURE dose (not due today) in full, ahead of
    // administration. ──
    await page.goto(`/scheduled-orders?selected=${encodeURIComponent(day0OrderId)}`)
    let collectTrigger = page.getByRole('button', { name: /^collect payment$/i })
    await expect(collectTrigger).toBeEnabled()
    await collectTrigger.click()
    await expect(page.getByRole('heading', { name: 'Collect payment' })).toBeVisible()

    // Essen IM regimen: days 0, 3, 7, 14, 28 (apps/backend/src/shared/db/
    // seed/standing-orders.ts, SOT_RABIES_PEP_IM description).
    const doseRows = page.locator('label').filter({ hasText: /^Dose \d/ })
    await expect(doseRows).toHaveCount(5)
    const day0Row = doseRows.nth(0)
    const futureRow = doseRows.nth(1) // next dose in the chain, state "upcoming"

    // Day-0 preselects (it is due today); switch the target to the future
    // dose so this genuinely prepays ahead of administration.
    await expect(day0Row.getByRole('checkbox')).toBeChecked()
    const futurePriceCents = parsePeso(await futureRow.innerText())
    await day0Row.getByRole('checkbox').click()
    await futureRow.getByRole('checkbox').click()
    await expect(day0Row.getByRole('checkbox')).not.toBeChecked()
    await expect(futureRow.getByRole('checkbox')).toBeChecked()

    await expect(siblingValue(page, 'Estimated total')).toHaveText(peso(futurePriceCents))
    await expect(page.getByRole('checkbox', { name: /pay in full/i })).toBeChecked()
    await attestAs(page)

    let submit = page.getByRole('button', { name: /^collect payment$/i })
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(page.getByText('Payment collected')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('heading', { name: 'Collect payment' })).toBeHidden()

    // ── Scenario B: hold the balance. Reopen Collect for the same order:
    // Day-0 is still unbilled (only the future dose was paid above) and
    // preselects again. Pay half now, downpayment input is plain useState
    // wired through onChange (CollectPaymentDialog.tsx, not RHF setValue),
    // so fill() drives it directly, leaving the rest Pending. ──
    collectTrigger = page.getByRole('button', { name: /^collect payment$/i })
    await expect(collectTrigger).toBeEnabled()
    await collectTrigger.click()
    await expect(page.getByRole('heading', { name: 'Collect payment' })).toBeVisible()
    await expect(day0Row.getByRole('checkbox')).toBeChecked()

    const day0PriceCents = parsePeso(await day0Row.innerText())
    const downpaymentCents = Math.floor(day0PriceCents / 2)
    const remainderCents = day0PriceCents - downpaymentCents

    await page.getByRole('checkbox', { name: /pay in full/i }).click() // uncheck
    await page.getByLabel(/amount now/i).fill((downpaymentCents / 100).toFixed(2))
    await attestAs(page)

    submit = page.getByRole('button', { name: /^record downpayment$/i })
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(page.getByText('Downpayment recorded')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('heading', { name: 'Collect payment' })).toBeHidden()

    // The order's own payment badge reads Pending. The receivables
    // worklist itself (aging buckets, credit, statement) is already
    // covered end to end in e2e/receivables.spec.ts and is not repeated
    // here; only the patient billing tab delta is asserted below.
    await expect(page.getByRole('dialog').getByText('Pending', { exact: true })).toBeVisible()

    await page.goto(`/patients/${CRUZ_PATIENT_ID}?tab=billing`)
    await expect(siblingValue(page, 'Outstanding')).toHaveText(
      peso(baselineOutstandingCents + remainderCents),
    )
  })
})

/**
 * R8 worked arithmetic, from the seeded LAB_ABO_RH "ABO and Rh" price
 * (apps/backend/src/shared/db/seed/catalog.ts, PHP280.00, VAT-inclusive,
 * not itself flagged VAT-exempt), quantity 1. MONEY-6 (RA 9994 section 4 /
 * BIR RR 7-2010 for senior citizens, RA 10754 / BIR RR 5-2017 for PWD): the
 * seller bills NO VAT at all on a qualifying sale, AND the buyer gets 20%
 * off the VAT-exclusive base, reported as two SEPARATE figures (not merged):
 *
 *   catalogGrossCents = 28000                                (PHP280.00)
 *   baseCents = round(28000 * 100 / 112) = 25000              (PHP250.00, exact here)
 *   discountCents = round(baseCents * 0.20) = 5000            (PHP50.00, the statutory 20% alone)
 *   dueCents = baseCents - discountCents = 20000              (PHP200.00)
 *   vatCents = 0                                              (no VAT billed)
 *
 * `computeTransactionTotals` (apps/backend/src/modules/transactions/
 * service.ts) reports this line's gross as `baseCents` (PHP250.00, the
 * VAT-exclusive selling price), not the PHP280.00 catalog sticker price: a
 * VAT-exempt sale is recorded at its VAT-exclusive price. `Due` reads
 * PHP200.00 and `VAT` reads PHP0.00 for this line either way.
 */
test.describe('R8: senior citizen / PWD discount (VAT exemption + 20%)', () => {
  test('OSCA discount zeroes VAT and nets base-less-20% on a PHP280.00 line', async ({ page }) => {
    await startCruzAboRhBill(page)
    await page.getByRole('button', { name: /senior.*20%/i }).click()

    await expect(siblingValue(page, 'VAT')).toHaveText(peso(0))
    await expect(siblingValue(page, 'Due')).toHaveText(peso(20000))
  })

  test('PWD discount zeroes VAT and nets base-less-20% on a PHP280.00 line', async ({ page }) => {
    await startCruzAboRhBill(page)
    await page.getByRole('button', { name: /^pwd/i }).click()

    await expect(siblingValue(page, 'VAT')).toHaveText(peso(0))
    await expect(siblingValue(page, 'Due')).toHaveText(peso(20000))
  })
})
