import { test, expect } from '@playwright/test'
import { attestAs } from './fixtures/attestation'
import { uniqueNameSuffix } from './fixtures/unique-name'

/**
 * The clinic's core daily loop, end to end, on its HIGHEST-LEVERAGE workflow:
 * anti-rabies post-exposure prophylaxis (PEP). This is an Animal Bite Treatment
 * Center, so a walk-in bite patient starting a rabies PEP course is THE primary
 * driver, not a generic flu shot. The loop:
 *   1. Register a bite walk-in via the Arrivals wizard (Rabies specialty, WHO
 *      Category II exposure, the intramuscular 5-dose rabies PEP protocol).
 *   2. Administer the Day-0 anti-rabies vaccine dose.
 *   3. Collect payment to Paid.
 *
 * This runs entirely as the `Branch` operator persona (project storageState),
 * the real single-clinic account. Physician authorisation is only recorded as a
 * note on the order, not a separate login; per-role auth is out of scope.
 *
 * Ordering: administer first, take payment after (frontend CLAUDE.md, and the
 * backend administer path gates only on consent + the picked lot's stock, no payment
 * precondition). WHO Category II is deliberate: it needs the ARV vaccine only,
 * so it avoids the Category III RIG commit gate and the weight-based RIG dose
 * calculator. The anti-rabies vaccine (Abhayrab, ARVPEP_IM) is a fixed dose, so
 * the Administer step is an explicit brand pick plus a consent gate.
 *
 * Determinism: rather than depend on which seeded PEP order is due on the run
 * date, the test registers its OWN fresh Day-0 order and drives exactly that one.
 * The Arrivals done URL hands the created order id back as `?day0OrderId=ORD_…`,
 * and the worklist opens any order by id via `?selected=`. So the flow targets
 * *this run's* fresh, unbilled order (never a name search or a `.first()` row
 * pick) and stays stable across dates and re-runs; accumulating sibling PEP
 * orders in the shared seed can't be mis-selected.
 *
 * Mutating: creates an encounter (with bite assessment) + patient-standing-order
 * + the 5-dose schedule, administers Day-0 (brand pick, stock deduction + audit), and creates
 * a transaction + payment. Exercises the real write path end to end: RLS, the
 * audit trigger, FEFO, and money rules are all live. Each run consumes one
 * anti-rabies vaccine unit from the shared seed; a reseed replenishes it.
 */
test.describe('daily loop: anti-rabies PEP (register → administer → collect)', () => {
  test('register a bite walk-in, administer the Day-0 anti-rabies dose, collect payment to Paid', async ({
    page,
  }) => {
    // Runs as the default `Branch` persona via the project storageState. The
    // 15-minute access token comfortably outlives a single suite pass, so no
    // mid-test refresh is needed.

    // ── 1. Register the bite walk-in onto a rabies PEP course. ──
    await page.goto('/arrivals')
    await expect(page).toHaveURL(/\/arrivals\/identify/)

    // Register a fresh same-branch patient. Tenant-wide identity search also
    // returns read-only cross-branch rows, which must never be used as a write
    // target merely because they sort first.
    await page.getByRole('button', { name: /^new patient$/i }).click()
    await page.getByLabel(/last name/i).fill(`DailyRabies${uniqueNameSuffix()}`)
    await page.getByLabel(/first name/i).fill('Local')
    await page.getByRole('checkbox', { name: /informed consent was obtained/i }).check()
    await page.getByRole('button', { name: /^register patient$/i }).click()
    await expect(page).toHaveURL(/\/arrivals\/encounter/, { timeout: 20_000 })

    // Encounter: Rabies specialty reveals the bite-assessment panel. WHO
    // Category II = ARV vaccine only (no RIG), which keeps the commit off the
    // Category III RIG gate. Chief complaint is required (RHF + Zod).
    await page.getByLabel('Specialty').selectOption('Rabies')
    await page
      .getByRole('radiogroup', { name: /WHO exposure category/i })
      .getByRole('radio', { name: /^Category II\b/ })
      .click()
    await page.getByLabel('Chief complaint').fill('Dog bite, left forearm, walk-in for PEP')
    await page.getByRole('checkbox', { name: /informed consent was obtained/i }).check()
    await page.getByRole('button', { name: /save & continue/i }).click()
    await expect(page).toHaveURL(/\/arrivals\/protocol/)

    // Protocol: select the intramuscular 5-dose PEP course. The picker renders a
    // <label> wrapping an sr-only checkbox, so click the label (clicking the
    // hidden input is intercepted by the visible card). The regex avoids matching
    // the intradermal PEP, the boosters, the PrEP, or the Cat III bundles.
    await page
      .locator('label')
      .filter({ hasText: /Rabies PEP.*Intramuscular \(5-dose\)/ })
      .click()

    // Rabies PEP requires physician authorisation. That is recorded as metadata
    // (the "Physician on duty" dropdown), NOT a separate login. The Branch
    // operator notes which physician authorised. The commit stays disabled until
    // one is chosen. Wait for the physician list to populate, then pick the first.
    const physician = page.locator('#physician-id')
    await expect(physician).toBeVisible()
    await expect(physician.locator('option')).not.toHaveCount(1)
    await physician.selectOption({ index: 1 })

    const commit = page.getByRole('button', { name: /commit bundle/i })
    await expect(commit).toBeEnabled()
    await commit.click()
    await expect(page).toHaveURL(/\/arrivals\/done/)
    await expect(page.getByRole('heading', { name: /arrival complete/i })).toBeVisible()

    // The done URL carries the just-created Day-0 clinical order id.
    const day0OrderId = new URL(page.url()).searchParams.get('day0OrderId')
    expect(day0OrderId, 'arrivals done URL should carry day0OrderId').toBeTruthy()

    // ── 2. Open that exact order in the worklist via the ?selected= deep link. ──
    await page.goto(`/scheduled-orders?selected=${encodeURIComponent(day0OrderId!)}`)

    // ── 3. Administer the Day-0 anti-rabies vaccine (brand pick → consent gate). ──
    const administerTrigger = page.getByRole('button', { name: /review administration/i })
    await expect(administerTrigger).toBeEnabled()
    await administerTrigger.click()

    await expect(page.getByRole('heading', { name: 'Administer dose' })).toBeVisible()

    // The brand is the nurse's explicit choice. Nothing may be preselected:
    // the nurse must deliberately choose an available brand before Confirm can
    // enable.
    const brandPicker = page.getByRole('radiogroup', { name: /vaccine lot/i })
    await expect(brandPicker).toBeVisible()
    await expect(brandPicker.getByRole('radio', { checked: true })).toHaveCount(0)
    const availableBrand = brandPicker.locator('[role="radio"]:not(:disabled)').first()
    await expect(availableBrand).toBeEnabled()
    await availableBrand.click()
    await expect(availableBrand).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('checkbox', { name: /I checked the vial label/i }).check()

    // Who gave the dose. This persona is the SHARED `Branch` kiosk login, which
    // cannot attest for itself, so the clinician has to be named and proved with
    // their own 4-digit kiosk PIN (seeded as 1234 for every staff row).
    await page.getByLabel(/^given by/i).click()
    await page.getByRole('option').first().click()
    await page.getByLabel(/pin/i).fill('1234')

    // The ARV vaccine is a fixed dose (not weight-based) → no dose calculator;
    // consent is the remaining gate.
    await page.getByRole('checkbox', { name: /consent.*obtained/i }).check()
    const confirm = page.getByRole('button', { name: /confirm & administer/i })
    await expect(confirm).toBeEnabled()
    await confirm.click()

    // Success: the panel flips to the completed state and offers payment.
    await expect(page.getByRole('heading', { name: 'Dose administered' })).toBeVisible()

    // ── 4. Collect payment for the just-administered dose. ──
    // Re-open the order fresh and enter Collect from Review (the cashier collects
    // after the nurse administers, a realistic seam). A clean page load gives the
    // prepayable-doses query a single, quiet fetch: driving Collect inline right
    // after administering can fire it amid the administer round-trips (plus the
    // dev-mode StrictMode double-invoke and the 401-refresh retry path) and
    // momentarily resolve to no doses, which staleTime then caches. Cash and
    // pay-in-full are the defaults.
    await page.goto(`/scheduled-orders?selected=${encodeURIComponent(day0OrderId!)}`)
    await page.getByRole('button', { name: /^collect payment$/i }).click()
    await expect(page.getByRole('heading', { name: 'Collect payment' })).toBeVisible()
    // Select the just-administered (unbilled) Day-0 dose. The panel auto-preselects
    // the source dose; drive the checkbox explicitly so a preselect race can't
    // leave nothing selected (check() is idempotent, a no-op if already checked).
    await page
      .getByRole('checkbox', { name: /dose \d/i })
      .first()
      .check()
    // The suite runs as the shared Branch kiosk, so the tender needs a named
    // staff member and their PIN before the button unlocks.
    await attestAs(page)
    const collect = page.getByRole('button', { name: /^collect payment$/i })
    await expect(collect).toBeEnabled()
    await collect.click()

    // ── 5. Assert the dose was paid in full. ──
    // The panel emits "Payment collected" only when the tender settles the full
    // net (paid = amount >= net); a partial tender would toast "Downpayment
    // recorded". So this exact text IS the "paid" signal. Collecting is a
    // three-request chain (create txn, read net, add payment), so allow more than
    // the default expect timeout: under `pnpm dev` (Vite on-demand compilation)
    // the round-trips are slower than a single-action assertion.
    await expect(page.getByText('Payment collected')).toBeVisible({ timeout: 30_000 })
    // Success closes the Collect panel and returns the rail to Review (onClose →
    // setStep('review')); a failed tender would leave the panel open. Asserting
    // the panel closed is the persistent counterpart to the ephemeral toast.
    await expect(page.getByRole('heading', { name: 'Collect payment' })).toBeHidden()
  })
})
