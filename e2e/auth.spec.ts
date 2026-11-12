import { test, expect } from '@playwright/test'
import { USERS } from './fixtures/test-data'
import { uiLogin } from './fixtures/auth'

// Every test in this file starts logged OUT — override the project's default
// admin storageState with an empty jar.
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('authentication', () => {
  test('rejects invalid credentials with an inline error', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(USERS.admin.email)
    await page.locator('input[name="password"]').fill('definitely-wrong-password')
    await page.getByRole('button', { name: /^sign in$/i }).click()

    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible()
    await expect(alert).toContainText(/invalid email or password/i)
    await expect(page).toHaveURL(/\/login/)
  })

  test('admin signs in and lands on the patients list', async ({ page }) => {
    await uiLogin(page, USERS.admin.email, USERS.admin.password, USERS.admin.landing)
    await expect(page).toHaveURL(/\/patients/)
    await expect(page.getByRole('navigation', { name: /main navigation/i })).toBeVisible()
  })

  test('branch account signs in and lands on the staff kiosk', async ({ page }) => {
    await uiLogin(page, USERS.branch.email, USERS.branch.password, USERS.branch.landing)
    await expect(page).toHaveURL(/\/branch\/kiosk/)
  })

  test('unauthenticated access to a protected route redirects to login', async ({ page }) => {
    await page.goto('/scheduled-orders')
    await expect(page).toHaveURL(/\/login/)
  })
})
