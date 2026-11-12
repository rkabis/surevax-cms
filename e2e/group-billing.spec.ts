import { test, expect } from '@playwright/test'

/**
 * Corporate group bill happy path. Uses active-consent seed patients plus the
 * seeded Globe corporate payer and a lab service so the test does not depend
 * on FEFO inventory. Mutating: creates one Pending group bill.
 */
test.describe('corporate group billing', () => {
  test('reviews two patient-service assignments before creating one pending bill', async ({
    page,
  }) => {
    const reference = `E2E-GROUP-${Date.now()}`
    await page.goto('/group-bills/new')
    await expect(page.getByRole('heading', { name: 'New corporate group bill' })).toBeVisible()

    await page.getByRole('combobox', { name: /payer/i }).click()
    await page.getByRole('option', { name: 'Globe Telecom, Inc.' }).click()
    await page.getByLabel('Reference').fill(reference)

    const patientSearches = page.getByRole('textbox', { name: 'Search patient' })
    await expect(patientSearches).toHaveCount(2)
    await patientSearches.first().fill('Cruz')
    await page.getByRole('button', { name: /Cruz, Elena.*PAT_AAAAAAA5/i }).click()
    await patientSearches.first().fill('Herrera')
    await page.getByRole('button', { name: /Herrera, Patrick.*PAT_AAAAAAB4/i }).click()

    const serviceSearches = page.getByRole('textbox', { name: 'Search service' })
    await expect(serviceSearches).toHaveCount(2)
    await serviceSearches.first().fill('ABO')
    await page
      .getByRole('button', { name: /ABO and Rh/ })
      .first()
      .click()
    await serviceSearches.first().fill('ABO')
    await page
      .getByRole('button', { name: /ABO and Rh/ })
      .first()
      .click()

    await page.getByRole('button', { name: 'Review group bill' }).first().click()
    await expect(page.getByRole('heading', { name: 'Review group bill' })).toBeVisible()
    await expect(page.getByText('Globe Telecom, Inc.')).toBeVisible()
    await expect(page.getByText(/Cruz, Elena/i)).toBeVisible()
    await expect(page.getByText(/Herrera, Patrick/i)).toBeVisible()
    await expect(page.getByText(/server-authoritative total may differ/i)).toBeVisible()

    await page.getByRole('button', { name: 'Create pending group bill' }).first().click()
    await expect(page).toHaveURL(/\/group-bills/, { timeout: 20_000 })
    const createdBill = page.getByRole('dialog', { name: 'Corporate group bill' })
    await expect(createdBill.getByText(reference)).toBeVisible({ timeout: 20_000 })
    await expect(
      createdBill.getByRole('button', { name: /Open transaction — payment or void/i }),
    ).toBeVisible()
  })
})
