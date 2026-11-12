import { expect, test, type Page } from '@playwright/test'

import { STORAGE } from './fixtures/test-data'
import { uniqueNameSuffix } from './fixtures/unique-name'

async function selectFreshArrivalPatient(page: Page, fixtureLabel: string): Promise<void> {
  const lastName = `RoleUat${fixtureLabel}${uniqueNameSuffix()}`
  await page.goto('/arrivals')
  await expect(page).toHaveURL(/\/arrivals\/identify/)
  await page.getByRole('button', { name: /^new patient$/i }).click()
  await page.getByLabel(/last name/i).fill(lastName)
  await page.getByLabel(/first name/i).fill('Clinical')
  await page.getByRole('checkbox', { name: /informed consent was obtained/i }).check()
  await page.getByRole('button', { name: /^register patient$/i }).click()
  await expect(page).toHaveURL(/\/arrivals\/encounter/, { timeout: 20_000 })
}

async function openDrawerIfNeeded(page: Page): Promise<void> {
  const closeDrawer = page.getByRole('button', { name: 'Close drawer', exact: true })
  if (
    await closeDrawer
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false)
  )
    return

  const openingPrompt = page.getByRole('alertdialog')
  if (await openingPrompt.isVisible().catch(() => false)) {
    await openingPrompt.getByRole('button', { name: /open clinic for/i }).click()
  } else {
    await page.getByRole('button', { name: 'Open drawer', exact: true }).click()
  }

  const drawerDialog = page.getByRole('alertdialog')
  await drawerDialog.getByLabel(/opening float/i).fill('1000.00')
  await drawerDialog.getByRole('button', { name: 'Open drawer', exact: true }).click()
  await expect(closeDrawer).toBeVisible()
}

function parsePeso(value: string): number {
  return Number(value.replace(/[^\d.-]/g, ''))
}

test.describe('Phase-1 role UAT: clinical and handoff safety', () => {
  test('shared Branch intake UI requires RIG and an authorizing-provider selection for WHO Category III', async ({
    page,
  }) => {
    await selectFreshArrivalPatient(page, 'Rig')

    await page.getByLabel('Specialty').selectOption('Rabies')
    await page
      .getByRole('radiogroup', { name: /WHO exposure category/i })
      .getByRole('radio', { name: /^Category III\b/ })
      .click()
    await page.getByLabel('Chief complaint').fill('Dog bite with broken skin — Category III UAT')
    await page.getByRole('checkbox', { name: /informed consent was obtained/i }).check()
    await page.getByRole('button', { name: /save & continue/i }).click()

    await expect(page.getByText('Category III — RIG required')).toBeVisible()
    await page
      .locator('label')
      .filter({ hasText: /Rabies PEP.*Intramuscular \(5-dose\)/ })
      .click()

    const commit = page.getByRole('button', { name: /commit bundle/i })
    await expect(page.getByText('RIG not included in selection')).toBeVisible()
    await expect(commit).toBeDisabled()

    await page
      .locator('label')
      .filter({ hasText: /Equine Rabies Immunoglobulin \(ERIG\)/ })
      .click()
    await expect(page.getByText('RIG not included in selection')).toBeHidden()

    // The adjunct fixes the Cat III safety gate, but the shared-kiosk UI also
    // requires an authorizing-provider selection before enabling commit. The
    // backend does not yet verify that the supplied user has a Physician role,
    // so this assertion is deliberately limited to the UI handoff.
    const physician = page.locator('#physician-id')
    await expect(physician).toBeVisible()
    await expect(commit).toBeDisabled()
    await expect(physician.locator('option')).not.toHaveCount(1)
    await physician.selectOption({ index: 1 })
    await expect(commit).toBeEnabled()
  })

  test('shared Branch nurse sees recalled flu stock as unavailable and can recover with a clean brand', async ({
    page,
  }) => {
    await selectFreshArrivalPatient(page, 'Flu')
    await page.getByLabel('Specialty').selectOption('Flu')
    await page.getByLabel('Chief complaint').fill('Annual flu vaccination — recall UAT')
    await page.getByRole('checkbox', { name: /informed consent was obtained/i }).check()
    await page.getByRole('button', { name: /save & continue/i }).click()

    await page.locator('label').filter({ hasText: 'Annual Flu Vaccination' }).click()
    await page.getByRole('button', { name: /commit bundle/i }).click()
    await expect(page).toHaveURL(/\/arrivals\/done/)

    const orderId = new URL(page.url()).searchParams.get('day0OrderId')
    expect(orderId).toMatch(/^ORD_/)
    await page.goto(`/scheduled-orders?selected=${encodeURIComponent(orderId!)}`)
    await page.getByRole('button', { name: /review administration/i }).click()

    const lots = page.getByRole('radiogroup', { name: /vaccine lot/i })
    const recalled = lots.getByRole('radio', {
      name: /Vaxigrip Tetra, lot FLU-2026-012/i,
    })
    await expect(recalled).toBeDisabled()
    await expect(recalled).toHaveAttribute('aria-checked', 'false')
    await expect(recalled.getByText(/unavailable: recall/i)).toBeVisible()

    const clean = lots.getByRole('radio', { name: /Fluarix Tetra, lot FLX-2026-004/i })
    await expect(clean).toBeEnabled()
    await clean.click()
    await expect(clean).toHaveAttribute('aria-checked', 'true')
  })
})

test.describe('Phase-1 role UAT: administrator review', () => {
  test.use({ storageState: STORAGE.admin })

  test('TenantAdmin can review the active recall, audit log, and cross-branch access ledger', async ({
    page,
  }) => {
    await page.goto('/admin/product-recalls')
    await expect(page.getByRole('heading', { name: 'Product Recalls' })).toBeVisible()
    const recallRow = page
      .getByRole('row')
      .filter({ hasText: 'Class II' })
      .filter({ hasText: 'Active' })
    await expect(recallRow).toBeVisible()
    const recallResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        /\/api\/product-recalls\/RCL_[A-Z0-9]+$/.test(new URL(response.url()).pathname) &&
        response.status() === 200,
    )
    await recallRow.click()
    const recallPayload = (await (await recallResponse).json()) as {
      data: {
        productId: string | null
        createdBy?: Record<string, unknown> | null
        affectedLots: Array<{ branchId: string }>
        createdById?: unknown
      }
    }
    expect(
      recallPayload.data.productId === null || /^PRD_[A-Z0-9]+$/.test(recallPayload.data.productId),
    ).toBe(true)
    expect(recallPayload.data).not.toHaveProperty('createdById')
    expect(recallPayload.data.createdBy ?? {}).not.toHaveProperty('id')
    expect(recallPayload.data.affectedLots.length).toBeGreaterThan(0)
    for (const lot of recallPayload.data.affectedLots) {
      expect(lot.branchId).toMatch(/^SVX\.[A-Z0-9]+$/)
    }
    const detail = page.getByLabel('Recall Detail')
    await expect(detail.getByRole('heading', { name: 'Recall Detail' })).toBeVisible()
    await expect(detail.getByText(/Manufacturer-issued Class II recall/)).toBeVisible()
    await expect(detail.getByText('Sanofi Pasteur', { exact: true })).toBeVisible()
    await expect(detail.getByText('FLU-2026-', { exact: true })).toBeVisible()
    await expect(detail.getByText('Required', { exact: true })).toBeVisible()

    await page.goto('/admin/audit')
    await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible()
    await expect(page.getByText('Failed to load audit log.')).toBeHidden()

    await page.goto('/admin/cross-branch-access')
    await expect(page.getByRole('heading', { name: 'Cross-branch access' })).toBeVisible()
  })
})

test.describe('Phase-1 role UAT: session and cashier close', () => {
  test('DirtyFormGuard preserves an edited record until staff explicitly leave', async ({
    page,
  }) => {
    await page.goto('/patients/new')
    const lastName = page.getByLabel(/last name/i)
    await lastName.fill('UnsavedUat')

    const beforeUnloadPrevented = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    })
    expect(beforeUnloadPrevented).toBe(true)

    await page.getByRole('link', { name: 'Dashboard', exact: true }).click()
    const guard = page.getByRole('alertdialog')
    await expect(guard.getByRole('heading', { name: 'Unsaved changes?' })).toBeVisible()
    await guard.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page).toHaveURL(/\/patients\/new/)
    await expect(lastName).toHaveValue('UnsavedUat')

    await page.getByRole('link', { name: 'Dashboard', exact: true }).click()
    await guard.getByRole('button', { name: 'Leave', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard/)
  })

  test('shared Branch cashier sees the computed variance before closing the drawer', async ({
    page,
  }) => {
    await page.goto('/branch/kiosk')
    await openDrawerIfNeeded(page)
    await page.getByRole('button', { name: 'Close drawer', exact: true }).click()

    const dialog = page.getByRole('alertdialog')
    const expectedText = await dialog
      .getByText('Expected total', { exact: true })
      .locator('..')
      .locator('span')
      .nth(1)
      .innerText()
    const declared = (parsePeso(expectedText) + 1).toFixed(2)
    await dialog.getByLabel(/counted total/i).fill(declared)
    await expect(dialog.getByText('Variance', { exact: true }).locator('..')).toContainText('₱1.00')

    const closeResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().endsWith('/api/cash-drawer/close'),
    )
    await dialog.getByRole('button', { name: 'Close drawer', exact: true }).click()
    const response = await closeResponse
    expect(response.status()).toBe(200)
    const closed = (await response.json()) as { state: string; variance: string }
    expect(closed).toMatchObject({ state: 'Closed', variance: '1.00' })
    await expect(page.getByText('Drawer closed', { exact: true })).toBeVisible()
  })
})
