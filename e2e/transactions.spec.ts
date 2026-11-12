import { test, expect } from '@playwright/test'

/**
 * Cashier flow: create a transaction from the New Transaction page. Searches
 * and selects a patient, adds a billable line item via the service picker, and
 * commits. With no amount tendered the transaction is created as Pending
 * (no payment leg) — enough to exercise the create path end-to-end: form
 * validation, the patient + service pickers, the createTransaction mutation,
 * and the post-commit redirect to the list with the new row selected.
 *
 * Mutating: inserts one transaction + line item. A lab line ("ABO and Rh") is
 * used so the commit doesn't depend on inventory/FEFO.
 */
test.describe('transactions', () => {
  test('cashier creates a transaction for a patient', async ({ page }) => {
    await page.goto('/transactions/new')
    await expect(page.locator('nav[aria-label="Breadcrumb"] span[aria-current="page"]')).toHaveText(
      'New Transaction',
    )

    // Select a patient from the search dropdown (needs >= 2 chars).
    await page.getByPlaceholder('Search patient by name').fill('Cruz')
    const patientResult = page.getByRole('button', { name: /Cruz,/ }).first()
    await expect(patientResult).toBeVisible()
    await patientResult.click()

    // Add a billable line item via the service picker.
    await page.getByPlaceholder('Search by service name or code').fill('ABO')
    await page.getByRole('button', { name: /ABO and Rh/ }).click()

    // Commit via the header "Tender ₱…" button — it gates on form validity and
    // is unambiguous (the footer "Commit ₱…" label is shared with the tender rail).
    const tender = page.getByRole('button', { name: /^Tender ₱/ })
    await expect(tender).toBeEnabled()
    await tender.click()

    // Lands on the transactions list with the new transaction selected.
    // One-shot `?selected=` (Pattern 34): assert the rail, not the URL.
    await expect(page).toHaveURL(/\/transactions/)
    await expect(page.getByRole('heading', { name: /^TXN_/ })).toBeVisible({ timeout: 20_000 })
  })
})
