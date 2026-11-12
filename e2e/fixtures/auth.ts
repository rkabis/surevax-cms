import { expect, type Page } from '@playwright/test'

/**
 * Drive the real login form. The app sends `X-Tenant-Slug: SVX` and
 * `X-Requested-With: fetch` on every request automatically
 * (`apps/frontend/src/shared/lib/api-base.ts`), so no header plumbing is
 * needed here — this is exactly what a clinic user does.
 *
 * `expectLanding` is the path the LoginPage navigates to on success
 * (`/patients` for staff roles, `/branch/kiosk` for the Branch account).
 */
export async function uiLogin(
  page: Page,
  email: string,
  password: string,
  expectLanding: string,
): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  // shadcn's FormItem wrapper makes the password input awkward to target by
  // label; the name attribute is stable (see LoginPage.test.tsx).
  await page.locator('input[name="password"]').fill(password)
  await page.getByRole('button', { name: /^sign in$/i }).click()
  await page.waitForURL(`**${expectLanding}`)
  await expect(page.getByRole('alert')).toHaveCount(0)
}
