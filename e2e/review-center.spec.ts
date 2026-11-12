import { expect, test } from '@playwright/test'

test.describe('runtime Review Center', () => {
  test('the Branch worklist loads both Phase-1 queues from the real branch-scoped API', async ({
    page,
  }) => {
    const responsePromise = page.waitForResponse(
      (response) => response.url().includes('/api/review-center?') && response.status() === 200,
    )
    await page.goto('/review-center')
    const response = await responsePromise
    const payload = (await response.json()) as {
      counts: { missingGuardians: number; yesterdayLooseEnds: number }
      branchId: string
    }

    await expect(page.getByRole('heading', { name: 'Review Center' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Review Center' })).toBeVisible()
    expect(payload.branchId).toBe('SVX.HST')
    expect(payload.counts.missingGuardians).toBeGreaterThanOrEqual(0)
    expect(payload.counts.yesterdayLooseEnds).toBeGreaterThanOrEqual(0)

    await expect(page.getByRole('tab', { name: /Loose ends \(\d+\)/ })).toBeVisible()
    const guardians = page.getByRole('tab', { name: /Missing guardians \(\d+\)/ })
    await expect(guardians).toBeVisible()
    await guardians.click()
    await expect(page.getByPlaceholder('Search patient, MRN, or ID')).toBeVisible()
    await expect(page.getByText('Couldn’t load Review Center')).toHaveCount(0)
  })
})
