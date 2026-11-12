import { test, expect } from '@playwright/test'
import { uniqueNameSuffix } from './fixtures/unique-name'

/**
 * Walk-in registration: the full Arrivals 4-step wizard
 * (Identify → Encounter → Protocol → Done).
 *
 * Registers a fresh same-branch patient, opens an encounter, selects a
 * standing-order protocol, and commits the atomic bundle (encounter +
 * patient-standing-order + scheduled clinical_orders, in one transaction). A non-Rabies specialty avoids
 * the bite-assessment panel and the WHO Category III RIG commit gate; the chosen
 * protocol (Annual Flu Vaccination) needs no physician authorisation and its
 * Day-0 item (Vaxigrip) is in stock, so the FEFO preview resolves a lot.
 *
 * Mutating: creates a patient + encounter + PSO + scheduled orders.
 */
test.describe('arrivals', () => {
  test('register a local patient onto a standing-order protocol', async ({ page }) => {
    await page.goto('/arrivals')
    await expect(page).toHaveURL(/\/arrivals\/identify/)

    // Register a fresh patient through the arrival entry point. Tenant-wide
    // search includes read-only patients from other branches, so `.first()` is
    // neither a safe nor deterministic local write target.
    await page.getByRole('button', { name: /^new patient$/i }).click()
    const lastName = `ArrivalFlu${uniqueNameSuffix()}`
    await page.getByLabel(/last name/i).fill(lastName)
    await page.getByLabel(/first name/i).fill('Local')
    await page.getByRole('checkbox', { name: /informed consent was obtained/i }).check()
    await page.getByRole('button', { name: /^register patient$/i }).click()
    await expect(page).toHaveURL(/\/arrivals\/encounter/, { timeout: 20_000 })

    // Step 2 — Encounter: chief complaint is required (RHF + Zod). Submitting
    // empty keeps us on the step and surfaces the validation message.
    await page.getByRole('button', { name: /save & continue/i }).click()
    await expect(page).toHaveURL(/\/arrivals\/encounter/)
    await expect(page.getByText('Required', { exact: true })).toBeVisible()

    // Fill it in (non-Rabies specialty) and advance.
    await page.getByLabel('Specialty').selectOption('Flu')
    await page.getByLabel('Chief complaint').fill('Routine flu vaccination — walk-in')
    await page.getByRole('checkbox', { name: /informed consent was obtained/i }).check()
    await page.getByRole('button', { name: /save & continue/i }).click()
    await expect(page).toHaveURL(/\/arrivals\/protocol/)

    // Step 3 — Protocol: select a course and commit the atomic bundle.
    await expect(page.getByRole('heading', { name: /protocol & bundle selection/i })).toBeVisible()
    await page.locator('label').filter({ hasText: 'Annual Flu Vaccination' }).click()
    const commit = page.getByRole('button', { name: /commit bundle/i })
    await expect(commit).toBeEnabled()
    await commit.click()

    // Step 4 — Done: the atomic commit succeeded.
    await expect(page).toHaveURL(/\/arrivals\/done/)
    await expect(page.getByRole('heading', { name: /arrival complete/i })).toBeVisible()
  })
})
