import { test as setup } from '@playwright/test'
import { STORAGE, USERS } from './fixtures/test-data'
import { uiLogin } from './fixtures/auth'

/**
 * Setup project — logs in once per role through the real UI and persists
 * the resulting cookie jar to a storageState file. The `chromium` project
 * loads `admin.json` by default; specs that need the Branch persona call
 * `test.use({ storageState: STORAGE.branch })`.
 *
 * Doing this through the UI (rather than an API call) means the auth flow
 * itself is smoke-tested on every run as a side effect.
 */

setup('authenticate as admin', async ({ page }) => {
  await uiLogin(page, USERS.admin.email, USERS.admin.password, USERS.admin.landing)
  await page.context().storageState({ path: STORAGE.admin })
})

setup('authenticate as branch', async ({ page }) => {
  await uiLogin(page, USERS.branch.email, USERS.branch.password, USERS.branch.landing)
  await page.context().storageState({ path: STORAGE.branch })
})
