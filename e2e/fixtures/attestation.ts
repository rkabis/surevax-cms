import { expect, type Page, type Locator } from '@playwright/test'

/**
 * The seeded kiosk PIN. Every seeded user shares it (`bcrypt.hash('1234')` in
 * `apps/backend/src/shared/db/seed.ts`).
 */
export const SEEDED_PIN = '1234'

/**
 * Fill the staff attestation on whichever money surface is currently open.
 *
 * The whole suite signs in as the shared `Branch` kiosk account, which is
 * exactly the case the backend refuses without attestation: a payment has to
 * name the real person taking it and prove it with their kiosk PIN. Without
 * this the tender 400s and the surface just never reaches its success toast,
 * which reads as an inscrutable timeout rather than a refusal.
 *
 * Handles both shapes the field can render:
 *  - one person clocked in, so it settles on them and shows only a PIN box
 *  - zero or several, so it shows the full picker first
 *
 * Safe to call on a surface with no attestation field (a real login, or a
 * zero-tender commit): it returns without doing anything.
 */
export async function attestAs(scope: Page | Locator): Promise<void> {
  const pin = scope.locator('#staff-attestation-pin')
  // Short timeout on purpose: absence is a legitimate outcome, not a failure.
  if (!(await pin.isVisible({ timeout: 5_000 }).catch(() => false))) return

  const picker = scope.locator('#staff-attestation-name')
  if (await picker.isVisible().catch(() => false)) {
    await picker.click()
    // Radix renders its options in a portal at the document root, so query the
    // page rather than the dialog scope.
    const page = 'page' in scope ? scope.page() : scope
    await page.getByRole('option').first().click()
  }

  await pin.fill(SEEDED_PIN)
  await expect(pin).toHaveValue(SEEDED_PIN)
}
