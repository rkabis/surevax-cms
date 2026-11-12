import { test, expect } from '@playwright/test'
import { uniqueNameSuffix } from './fixtures/unique-name'

/**
 * New-patient registration — the front desk's other core entry point (walk-in
 * registration onto a protocol is covered by arrivals.spec; this is the
 * standalone "add a patient record" path). Runs as the `Branch` operator
 * persona (the create route is auth-only, not role-gated).
 *
 * Exercises the real create path end to end: RLS, the audit trigger, and the
 * per-tenant MRN sequence allocation all run server-side. Success is proven by
 * the redirect to the new patient's own record (/patients/PAT_…) rendering
 * their name.
 *
 * Determinism: only last + first name are required. The last name carries a
 * timestamp suffix so (a) the duplicate-detection panel never finds an exact
 * name+DOB match and blocks the submit, and (b) accumulating re-runs never
 * collide. Mutating (writes a patients row); the seed has ample headroom.
 */
test.describe('patient registration', () => {
  test('register a new patient and land on their record', async ({ page }) => {
    const lastName = `EndToEndReg${uniqueNameSuffix()}`
    const firstName = 'Journey'

    await page.goto('/patients/new')
    await expect(page.getByRole('heading', { name: 'Register patient' })).toBeVisible()

    await page.getByLabel(/last name/i).fill(lastName)
    await page.getByLabel(/first name/i).fill(firstName)
    // DOB is optional, but filling it also disambiguates the duplicate check.
    await page.getByLabel(/date of birth/i).fill('1990-05-17')
    await page.getByRole('checkbox', { name: /informed consent was obtained/i }).check()

    // With a unique name and explicit consent there is no remaining registration gate.
    const submit = page.getByRole('button', { name: /^register patient$/i })
    await expect(submit).toBeEnabled()
    await submit.click()

    // Redirects to the freshly-created patient's record; the header h2 renders
    // "Lastname, Firstname". Allow extra time: create + navigate + detail fetch,
    // and under `pnpm dev` the record page compiles on demand.
    await expect(page).toHaveURL(/\/patients\/PAT_[A-Z0-9]+/, { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: new RegExp(lastName) })).toBeVisible({
      timeout: 20_000,
    })
  })
})
