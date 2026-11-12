import { test, expect, type Page } from '@playwright/test'

/**
 * Authenticated navigation smoke. Uses the admin storageState (project
 * default). Each page is reached by URL and asserted via the breadcrumb's
 * current-page label (`nav[aria-label="Breadcrumb"] [aria-current="page"]`),
 * which AppShell renders from a route → label map — a reliable cross-page
 * signal that the route mounted without falling into the ErrorBoundary.
 */

// The current page is the breadcrumb's trailing <span aria-current="page">.
// Intermediate crumbs are <a aria-current="page"> when their prefix is active,
// so scope to the span to avoid a strict-mode multi-match on nested routes.
const BREADCRUMB_CURRENT = 'nav[aria-label="Breadcrumb"] span[aria-current="page"]'

async function gotoAndAssertCrumb(page: Page, path: string, label: string): Promise<void> {
  await page.goto(path)
  await expect(page.locator(BREADCRUMB_CURRENT)).toHaveText(label)
}

test.describe('authenticated page smoke', () => {
  test('dashboard loads with its KPI strip', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.locator(BREADCRUMB_CURRENT)).toHaveText('Dashboard')
    // KPI labels render once the dashboard query resolves. `exact` so
    // "Cash today" doesn't also match "Non-cash today".
    await expect(page.getByText('Cash today', { exact: true })).toBeVisible()
    await expect(page.getByText('Non-cash today', { exact: true })).toBeVisible()
  })

  test('scheduled orders worklist loads', async ({ page }) => {
    await gotoAndAssertCrumb(page, '/scheduled-orders', 'Scheduled Orders')
  })

  test('patients list loads', async ({ page }) => {
    await gotoAndAssertCrumb(page, '/patients', 'Patients')
  })

  test('transactions list loads', async ({ page }) => {
    await gotoAndAssertCrumb(page, '/transactions', 'Transactions')
  })

  test('new transaction (cashier) page loads', async ({ page }) => {
    await gotoAndAssertCrumb(page, '/transactions/new', 'New Transaction')
  })

  test('inventory loads', async ({ page }) => {
    await gotoAndAssertCrumb(page, '/inventory', 'Inventory')
  })

  test('lab orders loads', async ({ page }) => {
    await gotoAndAssertCrumb(page, '/lab-orders', 'Lab Orders')
  })
})
