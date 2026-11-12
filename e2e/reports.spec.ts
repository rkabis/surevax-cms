import { expect, test } from '@playwright/test'
import { STORAGE } from './fixtures/test-data'

test.describe('Phase-1 revenue integrity reports', () => {
  test.use({ storageState: STORAGE.admin })

  test('admin can move through bounded payer, worklist, exception, and daily truth views', async ({
    page,
  }) => {
    await page.goto('/reports')
    await expect(page.getByRole('heading', { name: 'Revenue integrity reports' })).toBeVisible()

    await expect(page.getByRole('tab', { name: 'AR aging' })).toBeVisible()
    await expect(page.getByText('Outstanding', { exact: true }).first()).toBeVisible()
    await expect(page.getByLabel('Responsible payer filter')).toBeVisible()
    await expect(page.getByLabel('Aging bucket')).toBeVisible()

    await page.getByRole('tab', { name: 'Unbilled work' }).click()
    await expect(page.getByText('Unbilled administrations', { exact: true })).toBeVisible()
    await expect(page.getByPlaceholder('Search patient, MRN, or service…')).toBeVisible()

    const exceptionsTab = page.getByRole('tab', { name: 'Payment exceptions' })
    await exceptionsTab.click()
    await expect(exceptionsTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByLabel('Reconciliation status')).toBeVisible()

    await page.getByRole('tab', { name: 'Daily summary' }).click()
    await expect(page.getByText('Transaction net total', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Daily summary date')).toBeVisible()
    const exportButton = page.getByRole('button', { name: 'Export daily CSV' })
    await expect(exportButton).toBeVisible()
    const exportResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/reports/daily-revenue/export') &&
        response.request().method() === 'POST',
    )
    const download = page.waitForEvent('download')
    await exportButton.click()
    await expect((await exportResponse).status()).toBe(201)
    await expect((await download).suggestedFilename()).toMatch(/^surevax-daily-revenue-.*\.csv$/)
  })
})
