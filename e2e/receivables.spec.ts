import { test, expect, type Page, type Locator } from '@playwright/test'
import { attestAs } from './fixtures/attestation'

/**
 * Patient receivables: derived balance, downpayments, patient credit, and the
 * /receivables worklist. Step 2 is the regression assertion: the original bug
 * recomputed every balance from netAmount, so a downpayment moved nothing.
 * This spec asserts the Balance cell and the detail rail's Balance due row
 * both show the remainder after a partial payment, never the full total.
 *
 * Journey (one spec, sequential steps sharing fixtures):
 *   1. Create a bill for a seeded patient via the cashier flow.
 *   2. Record a partial payment. Assert the list Balance cell and the detail
 *      rail's Balance due row both read the remainder.
 *   3. Assert the patient's Account tab Outstanding moved by that same
 *      remainder.
 *   4. Pay the exact remaining balance via Pay balance. Assert the allocation
 *      preview lists the bill before commit, then assert Outstanding reaches
 *      zero and the bill shows Paid.
 *   5. Create a second bill and overpay it via Pay balance. Assert the commit
 *      button banks the excess as credit, then assert credit available rose
 *      by exactly that excess.
 *   6. Create a third bill and draw the credit down via Apply credit. Assert
 *      the credit is consumed and the balance due drops.
 *   7. Visit /receivables: the patient shows a non-zero balance, the aging
 *      tab filter changes the row set, and the "Total outstanding" KPI does
 *      not move when a bucket tab is selected (computed over the unfiltered
 *      set).
 *   8. Visit the patient's statement and assert the closing balance renders.
 *
 * Determinism: a brand-new UI-registered patient cannot be used here. Every
 * clinical write (including createTransaction) is gated by
 * assertActiveConsent, and there is no frontend or API surface to grant a
 * patient consent outside of the seed - confirmed by probing the create
 * path: it 403s with `CONSENT_REVOKED`. Seeded patients carry one active
 * consent row each, so this spec uses the seeded "Elena Cruz" patient
 * (transactions.spec.ts's own fixture patient, PAT_AAAAAAA5) instead, and
 * reads her Outstanding / Credit available position as a BASELINE before
 * mutating, asserting every subsequent figure as a delta off that baseline
 * rather than an assumed-zero absolute. That keeps the spec correct
 * regardless of run order against transactions.spec.ts or leftover state
 * from a prior run. Steps 4 and 5 each drive the balance back to a known
 * value (zero, then the fresh bill's own net) before the next bill is
 * created, so by step 6 the delta math collapses to exact figures again.
 * A lab line ("ABO and Rh") is used for every bill, so nothing depends on
 * inventory or FEFO.
 *
 * Mutating: inserts three transactions against the seeded Cruz patient, a
 * partial payment, a full payoff, an overpayment banked as credit, and a
 * credit draw.
 *
 * Product bug this spec found, now FIXED: `/transactions?selected=<id>` did not
 * open the detail rail. `TransactionsPage.tsx` had two effects that both run on
 * mount, one consuming `?selected=` to call `setSelectedId(sel)` and another
 * unconditionally calling `setSelectedId(null)` keyed on the `?patient=` filter.
 * Effects fire in declaration order, so the later null always won on first mount
 * and every deep link into the rail was silently dropped (the Today cockpit's
 * "Collect" action and the Account tab's row click both arrive that way). The
 * reset now skips first mount, and `openTransactionRail` navigates via the query
 * param, so this spec guards the fix.
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
 * Every money figure in this app renders as a label element immediately
 * followed by a sibling element holding the value (Field's two <p>s,
 * KpiCell's eyebrow <span> + value <div>, the statement's TotalCell divs,
 * and the read-only summary rows in PayBalancePanel / ApplyCreditDialog).
 * Scope `within` to a dialog/page region to avoid matching a same-named
 * label rendered elsewhere on the page at the same time.
 */
function siblingValue(within: Page | Locator, label: string): Locator {
  return within.getByText(label, { exact: true }).locator('xpath=following-sibling::*[1]')
}

/** The status badge row next to a transaction's own `<h2>` id heading. */
function txnHeader(page: Page, txnId: string): Locator {
  return page.locator('h2', { hasText: txnId }).locator('xpath=following-sibling::div[1]')
}

/**
 * Opens the detail rail for a specific transaction via the `?selected=` deep
 * link, which is the path the Today cockpit and the patient Account tab both
 * use.
 *
 * Clicking the list row instead is not reliable here: below the 2xl breakpoint
 * the rail is modal, so whenever one is already open (this journey opens several
 * in sequence) its content sits over the table and swallows the click. Trying to
 * dismiss it first just races the rail's own open animation. Navigating is both
 * deterministic and a stronger assertion, since it exercises the deep link.
 */
async function openTransactionRail(page: Page, txnId: string) {
  await page.goto(`/transactions?selected=${txnId}`)
  await expect(page.locator('h2', { hasText: txnId })).toBeVisible()
}

async function selectPatientOnNewTransaction(page: Page, patientId: string, query: string) {
  await page.getByPlaceholder('Search patient by name').fill(query)
  const option = page.getByRole('button', { name: new RegExp(patientId) })
  await expect(option).toBeVisible()
  await option.click()
}

async function addAboRhLine(page: Page) {
  await page.getByPlaceholder('Search by service name or code').fill('ABO')
  await page.getByRole('button', { name: /ABO and Rh/ }).click()
}

/**
 * Creates a Pending bill (a lab line, no tender) for the given patient via
 * the cashier "New Transaction" flow, mirroring transactions.spec.ts. Returns
 * the created transaction's display id and its net amount in cents, read off
 * the header "Tender ₱…" button rather than assumed, since VAT/discount math
 * is not this spec's concern.
 */
async function createPendingBill(
  page: Page,
  patientId: string,
  query: string,
): Promise<{ txnId: string; netCents: number }> {
  await page.goto('/transactions/new')
  await selectPatientOnNewTransaction(page, patientId, query)
  await addAboRhLine(page)

  const tender = page.getByRole('button', { name: /^Tender ₱/ })
  const netCents = parsePeso((await tender.textContent()) ?? '')
  // Shared Branch kiosk: the tender needs a named staff member + PIN first.
  await attestAs(page)
  await expect(tender).toBeEnabled()

  await tender.click()
  // `?selected=` is a ONE-SHOT param (Pattern 34): TransactionsPage reads it into
  // state and strips it back out of the URL, so asserting on the URL is a race
  // this test can only win by luck. Read the id off the rail that actually opens,
  // the same way readiness/money.spec.ts does.
  await expect(page).toHaveURL(/\/transactions/, { timeout: 20_000 })
  const railHeading = page.getByRole('heading', { name: /^TXN_/ })
  await expect(railHeading).toBeVisible({ timeout: 20_000 })
  const txnId = (await railHeading.textContent())?.trim()
  expect(txnId, 'the rail should open on the bill just created').toMatch(/^TXN_/)

  return { txnId: txnId!, netCents }
}

/**
 * Self-heals stray patient credit left behind by a prior run of THIS spec
 * that failed between step 5 (which creates real banked credit) and step 6
 * (which fully consumes it). Step 6 asserts the credit is fully drawn down
 * against a fresh bill, which only holds if that bill's net exceeds
 * whatever credit already exists - so any leftover credit is drained first,
 * against throwaway bills, before the real run's baseline is captured.
 */
async function drainStrayCredit(page: Page, patientId: string, query: string) {
  for (let i = 0; i < 8; i++) {
    await page.goto(`/patients/${patientId}?tab=billing`)
    const creditCents = parsePeso(
      (await siblingValue(page, 'Credit available').textContent()) ?? '',
    )
    if (creditCents <= 0) return
    const draining = await createPendingBill(page, patientId, query)
    await openTransactionRail(page, draining.txnId)
    await page.getByRole('button', { name: /^apply patient credit$/i }).click()
    const dlg = page.getByRole('dialog', { name: /^apply patient credit$/i })
    await expect(dlg).toBeVisible()
    await dlg.getByRole('button', { name: /^apply credit$/i }).click()
    await expect(dlg).toBeHidden()
  }
}

test.describe('receivables', () => {
  test('downpayments, patient credit, and the receivables worklist', async ({ page }) => {
    test.slow() // long, sequential money journey across several pages

    await drainStrayCredit(page, CRUZ_PATIENT_ID, 'Cruz')

    // Baseline: Cruz's position before this run touches anything, so every
    // figure below is asserted as a delta (see header comment).
    await page.goto(`/patients/${CRUZ_PATIENT_ID}?tab=billing`)
    const baselineOutstandingCents = parsePeso(
      (await siblingValue(page, 'Outstanding').textContent()) ?? '',
    )
    const baselineCreditCents = parsePeso(
      (await siblingValue(page, 'Credit available').textContent()) ?? '',
    )
    expect(baselineCreditCents, 'stray credit should be fully drained before this run').toBe(0)

    // ── 1. Create a bill (Pending, unpaid, full net owed). ──
    const bill1 = await createPendingBill(page, CRUZ_PATIENT_ID, 'Cruz')
    await openTransactionRail(page, bill1.txnId)

    // ── 2. Record a PARTIAL payment. This is the regression assertion: the
    // balance must read the remainder, never the full total. ──
    const partialCents = Math.floor(bill1.netCents / 2)
    const remainder1Cents = bill1.netCents - partialCents
    expect(partialCents, 'test needs a genuine partial payment (> 0, < net)').toBeGreaterThan(0)

    await page.getByRole('button', { name: /^add payment$/i }).click()
    const addPaymentDialog = page.getByRole('dialog', { name: /record payment/i })
    await expect(addPaymentDialog).toBeVisible()
    await addPaymentDialog.getByLabel(/^amount/i).fill((partialCents / 100).toFixed(2))
    await attestAs(addPaymentDialog)
    await addPaymentDialog.getByRole('button', { name: /^record payment$/i }).click()
    await expect(addPaymentDialog).toBeHidden()

    // List Balance cell for this exact row (column order: Time, Reference,
    // Patient · Items, Status, Total, Paid, Balance, chevron).
    const idSuffix = bill1.txnId.slice(-8)
    const listRow = page.locator('tbody tr', { hasText: idSuffix })
    await expect(listRow.locator('td').nth(6)).toHaveText(peso(remainder1Cents))
    // Detail rail Balance due.
    await expect(siblingValue(page, 'Balance due')).toHaveText(peso(remainder1Cents))

    // ── 3. Account tab Outstanding moved by exactly that remainder. ──
    await page.goto(`/patients/${CRUZ_PATIENT_ID}?tab=billing`)
    await expect(siblingValue(page, 'Outstanding')).toHaveText(
      peso(baselineOutstandingCents + remainder1Cents),
    )

    // ── 4. Pay the exact remaining balance via Pay balance ("Full balance"
    // always tenders the patient's whole outstanding, so this pays off bill1
    // AND any baseline bills in one commit, landing Outstanding at zero). ──
    await page.getByRole('button', { name: /^pay balance$/i }).click()
    const payDialog = page.getByRole('dialog', { name: /^pay balance$/i })
    await expect(payDialog).toBeVisible()
    const fullBalanceBtn = payDialog.getByRole('button', { name: /^full balance$/i })
    await expect(fullBalanceBtn).toBeEnabled()
    await fullBalanceBtn.click()
    // Allocation preview lists the bill before commit.
    await expect(payDialog.getByText(bill1.txnId)).toBeVisible()
    await attestAs(payDialog)
    await payDialog.getByRole('button', { name: /^pay ₱/i }).click()
    await expect(payDialog).toBeHidden()

    await expect(siblingValue(page, 'Outstanding')).toHaveText(peso(0))

    await page.goto('/transactions')
    await openTransactionRail(page, bill1.txnId)
    await expect(siblingValue(page, 'Balance due')).toHaveText(peso(0))
    await expect(txnHeader(page, bill1.txnId)).toContainText('Paid')

    // ── 5. Create a second bill and overpay it. Outstanding is zero at this
    // point (step 4 cleared everything), so bill2 is the only open bill and
    // its net is the whole balance. ──
    const bill2 = await createPendingBill(page, CRUZ_PATIENT_ID, 'Cruz')
    const overageCents = 5_000 // ₱50.00 excess, banked as credit
    const overpayCents = bill2.netCents + overageCents

    await page.goto(`/patients/${CRUZ_PATIENT_ID}?tab=billing`)
    await page.getByRole('button', { name: /^pay balance$/i }).click()
    const payDialog2 = page.getByRole('dialog', { name: /^pay balance$/i })
    await expect(payDialog2).toBeVisible()
    await payDialog2.getByLabel(/^amount/i).fill((overpayCents / 100).toFixed(2))
    const commit2 = payDialog2.getByRole('button', { name: /pay/i })
    await expect(commit2).toHaveText(/bank/i)
    await expect(commit2).toHaveText(/as credit/i)
    await attestAs(payDialog2)
    await commit2.click()
    await expect(payDialog2).toBeHidden()

    const creditAvailableCents = baselineCreditCents + overageCents
    await expect(siblingValue(page, 'Credit available')).toHaveText(peso(creditAvailableCents))

    // ── 6. Create a third bill and draw down that credit via Apply credit. ──
    const bill3 = await createPendingBill(page, CRUZ_PATIENT_ID, 'Cruz')
    expect(
      bill3.netCents,
      'bill3 must exceed the drawable credit so the draw fully consumes it and a balance still remains',
    ).toBeGreaterThan(creditAvailableCents)
    await openTransactionRail(page, bill3.txnId)

    await page.getByRole('button', { name: /^apply patient credit$/i }).click()
    const creditDialog = page.getByRole('dialog', { name: /^apply patient credit$/i })
    await expect(creditDialog).toBeVisible()
    await expect(siblingValue(creditDialog, 'Available credit')).toHaveText(
      peso(creditAvailableCents),
    )
    await creditDialog.getByRole('button', { name: /^apply credit$/i }).click()
    await expect(creditDialog).toBeHidden()

    const remainder3Cents = bill3.netCents - creditAvailableCents
    // Credit is consumed: the draw action is gone (canApplyCredit needs
    // available credit > 0).
    await expect(page.getByRole('button', { name: /^apply patient credit$/i })).toBeHidden()
    // Balance due dropped by exactly the credit drawn.
    await expect(siblingValue(page, 'Balance due')).toHaveText(peso(remainder3Cents))

    // ── 7. /receivables worklist. Search by first name: "Cruz" alone would
    // also match the seeded "Dela Cruz" patient (substring), which would
    // pollute the Total outstanding KPI used below. ──
    await page.goto('/receivables')
    const filteredReceivables = page.waitForResponse((response) => {
      if (response.request().method() !== 'GET' || response.status() !== 200) return false
      const url = new URL(response.url())
      return url.pathname === '/api/accounts-receivable' && url.searchParams.get('q') === 'Elena'
    })
    await page.getByPlaceholder('Search patient or MRN').fill('Elena')
    await filteredReceivables
    const receivableRow = page.locator('tbody tr', { hasText: 'Elena' })
    // Columns: Patient, Open bills, Oldest, 1-30, 31-60, 61-90, 90+, Balance,
    // Credit, Net, chevron.
    await expect(receivableRow.locator('td').nth(7)).toHaveText(peso(remainder3Cents))

    const totalOutstandingAll = await siblingValue(page, 'Total outstanding').textContent()

    // Bucket filter changes the row set: a same-day bill is not in 31-60.
    await page.getByRole('tab', { name: '31-60' }).click()
    await expect(receivableRow).toBeHidden()
    // Total outstanding is computed over the unfiltered set, so the bucket
    // tab must not move it.
    await expect(siblingValue(page, 'Total outstanding')).toHaveText(totalOutstandingAll ?? '')

    // Back in the 1-30 bucket, the row reappears (age 0 qualifies).
    await page.getByRole('tab', { name: '1-30' }).click()
    await expect(receivableRow).toBeVisible()

    // ── 8. Statement of account. ──
    await page.goto(`/patients/${CRUZ_PATIENT_ID}/statement`)
    await expect(page.getByText('STATEMENT OF ACCOUNT')).toBeVisible()
    await expect(siblingValue(page, 'Closing balance due')).toHaveText(peso(remainder3Cents))
    await expect(page.locator('.statement-of-account')).toBeVisible()
  })
})
