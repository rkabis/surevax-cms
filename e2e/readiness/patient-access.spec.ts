import { test, expect } from '@playwright/test'
import { uniqueNameSuffix } from '../fixtures/unique-name'

/**
 * Nurse testing readiness: R1 (register a walk-in) and R3 (cross-branch
 * patient visibility, detail gating, and break-glass).
 *
 * Every SureVax clinic is run by ONE login: the `Branch` service account
 * (branch-main@surevax.com, seeded name "Main Branch Account", home branch
 * HST). This whole suite runs as that persona via the project storageState
 * (see playwright.config.ts). There is no separate nurse login to test
 * against, so "can the Branch account do X" IS "can the nurse do X".
 *
 * R1 is a real, passing readiness check: `patient-registration.spec.ts`
 * already covers the happy path generically, so this version stays lean and
 * only asserts what's specific to readiness: that the session actually IS
 * the Branch persona (not an admin) and that the created record is reachable.
 *
 * R3 is a three-tier model. All three tiers are now real, passing tests:
 *
 *   (a) Every branch can SEE that a patient exists tenant-wide (search/list
 *       is not siloed by branch). `listPatients`
 *       (apps/backend/src/modules/patients/db.ts) opens `withTenantTx({
 *       branchId: null })`, which bypasses the `branch_isolation` RLS policy
 *       for the read.
 *
 *   (b) A branch that is NOT a patient's home branch sees identity plus
 *       safety fields only: DOB, contact number, and address are masked
 *       server-side (`getPatient` in patients/db.ts nulls them when the
 *       patient's `home_branch_id` differs from the caller's
 *       `req.tenant.branchId`), with a cross-branch banner in their place.
 *       The masking is app-layer, not RLS: `patients` carries no `branch_id`
 *       column (only the informational `home_branch_id`), so Tier-1 identity
 *       search stays tenant-wide by design and the comparison happens after
 *       the read.
 *
 *   (c) A non-home branch can break the glass with a typed reason to reveal
 *       the chart, and that access is written to the audit log. Both
 *       `POST /api/patients/:id/break-glass` and
 *       `GET /api/patients/:id/demographic` now widen their `requireRole`
 *       allow-list to every clinical role including `Branch` (matching
 *       `/api/lab-orders` and `/api/dose-calc` in app.ts): `Branch` is the
 *       only login a real clinic uses, so gating these to TenantAdmin /
 *       BranchAdmin left break-glass permanently unreachable and, worse, left
 *       the Tier-1 safety signals (activeRecalls, recentCriticalLabResults)
 *       invisible on every patient (see PatientDetail.tsx's safety-check
 *       banner and the readiness doc for that half of the story).
 *
 * Fixture: `apps/backend/src/shared/db/seed/patients.ts` seeds one patient,
 * Teresa Rivera (`PAT_RIVERA_DISPLAY_ID`), homed at the SECOND branch (TMG);
 * every other seeded patient is homed at HST, same as the Branch session
 * this suite runs as. `RIVERA_LAST_NAME` below is a real, resolvable row.
 * Rivera is seeded with exactly one allergy (Penicillin) and one condition
 * (Hypertension), which is what makes the masked-count assertions below
 * meaningful: a masked patient with zero allergies would render identically
 * whether masking worked or not.
 *
 * What could NOT be asserted through the UI (see the (b) test body for
 * detail): the app never renders a "Date of birth" or "Contact number"
 * labeled field anywhere on the patient record. The header shows an
 * abbreviated "DOB" plus a dash fallback, and the Demographics card's phone
 * row is titled "Phone", not "Contact number", so a literal
 * `getByText(/date of birth/i)` / `getByText(/contact number/i)` assertion
 * (the original fixme wording) would pass whether or not masking works,
 * because that text is never rendered at all. The assertions below check the
 * actual masked-vs-unmasked UI instead: the header's age/sex prefix
 * disappears (it depends on the now-nulled DOB) and the Phone/Address rows
 * disappear (both are conditionally rendered only when their value is
 * truthy).
 *
 * Allergies/conditions masking (owner decision, nurse-testing-readiness
 * follow-up, 2026-07-26): these were deliberately left unmasked by the first
 * pass as a Tier-1 safety signal, then masked in this follow-up. The masked
 * row survives (server-side `maskAllergyRow`/`maskConditionRow` in
 * patients/db.ts null every field but keep the row) so the count is honest;
 * the card renders "N on record ... hidden here" instead of the allergen
 * name / condition name. The assertions below check the rendered UI (the
 * masked-summary text is present, the real allergen/condition name is not),
 * matching this suite's existing style rather than intercepting the raw
 * `GET /api/patients/:id/allergies` response body.
 */

const RIVERA_LAST_NAME = 'Rivera'

test.describe('readiness: R1 register a walk-in as the Branch account', () => {
  test('the Branch persona (not admin) registers a new patient and lands on their record', async ({
    page,
  }) => {
    // Prove the session really is the Branch service account before relying
    // on it: the sidebar session-card trigger's accessible name is built
    // from the logged-in user's own first/last name, so this fails loudly if
    // the storageState ever points at a different persona.
    await page.goto('/patients/new')
    // AppShell.tsx builds this aria-label from `firstName` and `lastName`
    // joined by an em dash character (that glyph is app UI copy, not
    // authored test code, so it is out of scope here). Bridge the two halves
    // with a permissive `.*` instead of embedding the literal glyph in our
    // own regex.
    await expect(
      page.getByRole('button', { name: /user menu.*main branch account/i }),
    ).toBeVisible()

    const lastName = `EndToEndReadiness${uniqueNameSuffix()}`
    const firstName = 'Access'

    await expect(page.getByRole('heading', { name: 'Register patient' })).toBeVisible()
    await page.getByLabel(/last name/i).fill(lastName)
    await page.getByLabel(/first name/i).fill(firstName)
    // A unique, timestamped last name has no exact duplicate, so the
    // duplicate-detection panel never gates the submit.
    const submit = page.getByRole('button', { name: /^register patient$/i })
    await expect(submit).toBeEnabled()
    await submit.click()

    // Success is the redirect to the new patient's own record, rendering
    // their name: proof the record the Branch account just created is
    // actually reachable, not just accepted and dropped.
    await expect(page).toHaveURL(/\/patients\/PAT_[A-Z0-9]+/, { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: new RegExp(lastName) })).toBeVisible({
      timeout: 20_000,
    })
  })
})

test.describe('readiness: R3 cross-branch patient visibility, detail gating, and break-glass', () => {
  test('the tenant-wide patient list surfaces a patient regardless of who registered them', async ({
    page,
  }) => {
    // Real, passing check for tier (a). "Maria Dela Cruz" is one of the
    // original seeded patients (apps/backend/src/shared/db/seed/patients.ts),
    // not something this test run creates itself. Searching for a
    // pre-existing tenant patient (rather than one just registered in the
    // same session) is the honest proxy available today for "the list isn't
    // silently scoped down to only what this session touched." Full
    // cross-branch differentiation (a patient NOT at the caller's own
    // branch) can't be demonstrated with the current seed. See the
    // file-level docblock.
    await page.goto('/patients')
    await page.getByLabel('Search patients').fill('Dela Cruz')
    await expect(page.getByRole('row', { name: /Dela Cruz, Maria/i })).toBeVisible()
  })

  // Tier (b): server-side masking. `getPatient` (patients/db.ts) nulls DOB,
  // contact number, email, and address (plus guardian/insurance/onboarding
  // fields, "anything else of that character") when the patient's
  // `home_branch_id` differs from the caller's `req.tenant.branchId`. See the
  // file docblock for what could NOT be asserted through the UI and why
  // (the app never renders literal "Date of birth" / "Contact number" text
  // anywhere; those are the ORIGINAL fixme wording, kept nowhere in the
  // real UI, masked or not).
  test('a patient homed at a different branch renders masked with a cross-branch banner', async ({
    page,
  }) => {
    await page.goto('/patients')
    await page.getByLabel('Search patients').fill(RIVERA_LAST_NAME)
    await page.getByRole('row', { name: new RegExp(RIVERA_LAST_NAME, 'i') }).click()
    await expect(page.getByRole('heading', { name: new RegExp(RIVERA_LAST_NAME) })).toBeVisible()

    // Masked: the header's "<age><sex> · " prefix is derived from the
    // (now-nulled) date of birth, so it disappears and the record header says
    // "DOB not recorded" without revealing an age or date.
    await expect(page.getByText(/^\d+[MF] · DOB/)).not.toBeVisible()
    await expect(page.getByText(/DOB not recorded/)).toBeVisible()

    // Masked: the Demographics card's Phone/Address rows are conditionally
    // rendered only when contactNumber/address is truthy; both are nulled
    // for a cross-branch caller, so the rows don't exist at all.
    await expect(page.getByText('Phone', { exact: true })).not.toBeVisible()
    await expect(page.getByText('Address', { exact: true })).not.toBeVisible()

    // "More details" reveals Email/Civil status/Nationality/Barangay when
    // present. Email is masked too (nulled server-side), so expanding must
    // not surface it either.
    await page.getByRole('button', { name: /more details/i }).click()
    await expect(page.getByText('Email', { exact: true })).not.toBeVisible()

    // Masked (extended nurse-testing-readiness follow-up): Rivera's seeded
    // allergy (Penicillin) and condition (Hypertension) must not leak, but
    // the masked row survives server-side (maskAllergyRow/maskConditionRow
    // in patients/db.ts null the fields, not the array), so the count-based
    // summary is truthful rather than a false "none recorded."
    await expect(page.getByText('Penicillin', { exact: true })).not.toBeVisible()
    await expect(page.getByText('Hypertension', { exact: true })).not.toBeVisible()
    await expect(
      page.getByText(/1 allergy on record at another branch, hidden here/i),
    ).toBeVisible()
    await expect(
      page.getByText(/1 condition on record at another branch, hidden here/i),
    ).toBeVisible()

    // Add/edit affordances are not offered for a cross-branch patient:
    // cross-branch writes to patient_allergies/patient_conditions are
    // rejected server-side (403 CROSS_BRANCH_WRITE_FORBIDDEN, patients/
    // routes.ts) since those tables carry no branch_id for RLS to enforce
    // it, so the UI must not offer a control that would only fail later.
    await expect(page.getByRole('button', { name: 'Add', exact: true })).not.toBeVisible()

    // The cross-branch banner (PatientDetail.tsx) that appears in their
    // place, offering the reveal path instead of the raw chart. This is a
    // plain paragraph, not a heading element, so `getByText`, not
    // `getByRole('heading', ...)` (the original fixme wording; it would
    // never have matched).
    await expect(page.getByText('Cross-branch record', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /reveal record/i })).toBeVisible()
  })

  // Tier (c): break-glass is now reachable for the Branch persona. Both
  // `/break-glass` and `/demographic` widen their `requireRole` allow-list to
  // every clinical role including `Branch` (patients/routes.ts), matching
  // `/api/lab-orders` / `/api/dose-calc`.
  test('a typed reason is mandatory to break the glass and reveal the chart', async ({ page }) => {
    await page.goto('/patients')
    await page.getByLabel('Search patients').fill(RIVERA_LAST_NAME)
    await page.getByRole('row', { name: new RegExp(RIVERA_LAST_NAME, 'i') }).click()
    await page.getByRole('button', { name: /reveal record/i }).click()

    await expect(page.getByRole('heading', { name: 'Reveal cross-branch record' })).toBeVisible()
    const submit = page.getByRole('button', { name: /^reveal record$/i })

    // Mandatory typed reason: submit stays disabled until BOTH the reason
    // category is picked AND the free-text detail clears the 10-character
    // floor (BreakGlassReveal.tsx `canSubmit`).
    await expect(submit).toBeDisabled()
    await page.getByLabel(/access reason/i).click()
    await page.getByRole('option', { name: 'Continuity of care' }).click()
    await expect(submit).toBeDisabled()
    await page.getByLabel(/reason details/i).fill('Patient mid-course, continuity of care')
    await expect(submit).toBeEnabled()

    await submit.click()

    // Success: the chart reveals and the grant id (the audit anchor) is
    // surfaced so the nurse can see this access was logged. The phrase appears
    // twice on purpose, in the persistent banner and in the toast, so anchor on
    // the banner: it is the one that survives the toast timing out.
    await expect(page.getByText(/cross-branch record revealed .*\(CBA_/i)).toBeVisible()

    // Allergies/conditions unmask too (extended nurse-testing-readiness
    // follow-up): breakGlassPatientChart now returns the full, unmasked
    // allergy/condition rows alongside encounters/transactions, and
    // AllergiesCard/ConditionsCard render them once `revealedAllergies` /
    // `revealedConditions` are set from the break-glass response. The masked
    // summary text disappears and Rivera's real allergen/condition show.
    await expect(page.getByText(/on record at another branch, hidden here/i)).not.toBeVisible()
    await expect(page.getByText('Penicillin', { exact: true })).toBeVisible()
    await expect(page.getByText('Hypertension', { exact: true })).toBeVisible()

    // The reveal is read-only by design (the branch_isolation WITH CHECK
    // never honors cross_branch_read): add/edit affordances stay hidden even
    // after a successful reveal.
    await expect(page.getByRole('button', { name: 'Add', exact: true })).not.toBeVisible()
  })
})

/**
 * `docs/nurse-testing-readiness.md` R3 flagged one residual 403 left over
 * from the masking pass above: the "Cancel pending" button rendered
 * unconditionally on the patient record while posting to
 * `POST /api/admin/patients/:id/cancel-pending-orders`, mounted
 * `requireRole('TenantAdmin')` only (`apps/backend/src/app.ts`), and the
 * mutation wired only `onSuccess`. A Branch nurse who typed a reason and
 * clicked Confirm got nothing at all: no toast, no error, the modal just sat
 * there with the text still in it.
 *
 * `PatientDetail.tsx` now hides the button behind the same admin notion
 * `AppShell.tsx` uses for nav visibility (its `ADMIN_ROLES` set, not a second
 * definition of "admin") and gives the mutation a real `onError` (a toast
 * plus an inline destructive message in the still-open modal), so hiding the
 * button for Branch is not standing in for a real error path.
 */
test.describe('readiness: R3 residual, Cancel pending gated to admin roles', () => {
  test('the Branch persona does not see the Cancel pending affordance on a patient record', async ({
    page,
  }) => {
    await page.goto('/patients')
    await page.getByLabel('Search patients').fill('Dela Cruz')
    await page.getByRole('row', { name: /Dela Cruz, Maria/i }).click()
    await expect(page.getByRole('heading', { name: /Dela Cruz/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /cancel pending/i })).not.toBeVisible()
  })

  // Proving the error path needs a session that clears PatientDetail's UI
  // gate (any role in ADMIN_ROLES) but is rejected by the backend's narrower
  // requireRole('TenantAdmin') (a BranchAdmin would be; a TenantAdmin would
  // not, since the request would simply succeed). This suite's storageState
  // is the Branch account only, no admin project is registered for
  // `readiness/` (see playwright.config.ts), so this stays a fixme
  // describing the intended assertion.
  test.fixme('an admin whose bulk cancel is rejected server-side sees a visible error, not a silent no-op', async ({
    page,
  }) => {
    await page.goto('/patients')
    await page.getByLabel('Search patients').fill('Dela Cruz')
    await page.getByRole('row', { name: /Dela Cruz, Maria/i }).click()

    const cancelButton = page.getByRole('button', { name: /cancel pending/i })
    await expect(cancelButton).toBeVisible()
    await cancelButton.click()

    const dialog = page.getByRole('dialog', { name: /cancel pending orders/i })
    await dialog.getByLabel(/reason/i).fill('Readiness fixme probe, expect a 403')
    await dialog.getByRole('button', { name: /^confirm cancel$/i }).click()

    // The modal stays open (unlike the pre-fix silent failure) and shows
    // apiErrorMessage's mapped 403 copy or the toast title, either of
    // which proves the error reached the UI instead of vanishing.
    await expect(dialog).toBeVisible()
    await expect(
      page.getByText(/don't have permission|failed to cancel pending orders/i),
    ).toBeVisible()
  })
})
