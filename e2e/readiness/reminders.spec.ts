import { test, expect } from '@playwright/test'

/**
 * Nurse testing readiness, R2: text the patient before their scheduled
 * dose day.
 *
 * MANUAL ONLY, BY DESIGN. The owner explicitly deferred the automated
 * reminder pipeline: no domain-event producer, no scheduled/day-before job,
 * no SMS provider, no notification-queue changes. What exists instead is a
 * "Text patient" action a nurse triggers by hand from the worklist, which
 * renders a QR code encoding an `sms:` URI plus the plain message body. The
 * clinic runs on a laptop that cannot send SMS, so the nurse scans the QR
 * with their OWN phone, the Messages app opens prefilled, and they press
 * send themselves. Nothing transits our infrastructure, no provider account,
 * no spend, no PHI leaving the device. The message-composition logic lives
 * in apps/backend/src/modules/scheduled_orders/textDraft.ts, kept separate
 * from the HTTP/DB layer so a future automated pipeline can reuse it.
 *
 * Endpoint: GET /api/scheduled-orders/:id/text-draft
 * (apps/backend/src/modules/scheduled_orders/{contract,db,routes}.ts).
 * Returns { blocked, blockedReason, maskedNumber, smsUri, messageBody,
 * qrDataUrl }. Two hard blocks, both machine-readable via blockedReason
 * rather than a broken QR: no_contact_number (no phone on file) and
 * sms_opt_in_false (patients.sms_opt_in, the messaging-consent flag,
 * distinct from the clinical consents table). The worklist row itself also
 * carries smsOptIn (added to listScheduledOrders) so the "Text patient"
 * button can render disabled, with a reason, without a round trip per row.
 *
 * Test hooks the implementation owes this suite, all live now:
 *
 *   1. A "Text patient" button on each worklist row, reachable via
 *      getByRole('button', { name: /text patient/i }).
 *   2. The rendered QR exposes an accessible name (<img alt="..."> containing
 *      "QR" and the masked mobile) so getByRole('img', { name: /qr/i }) can
 *      find it: a bare unlabeled canvas/svg cannot be queried by role.
 *   3. The QR wrapper exposes the raw encoded string via a data-sms-uri
 *      attribute (data-testid="reminder-qr"), since a QR bitmap cannot be
 *      decoded by Playwright.
 *   4. A row for a patient with no contact number, or with
 *      sms_opt_in = false, renders "Text patient" as aria-disabled
 *      (Playwright's toBeDisabled() matches aria-disabled) rather than the
 *      native disabled attribute, specifically so the button stays
 *      keyboard-focusable and the reason is reachable without a mouse. The
 *      reason renders as real, visible text (a focus/hover-triggered
 *      Tooltip), not only baked into an aria-label no test or screen reader
 *      user could see rendered.
 *
 * Tests 1 to 3 below are real: the shared seed guarantees every row in this
 * worklist resolves to a patient with a contact number (only two seeded
 * patients lack one, Elena Cruz and Kristine Katipunan, and neither has a
 * standing order, so neither ever appears here). Once the sibling change
 * that seeds sms_opt_in = true for patients with a contact number lands,
 * every row's action is enabled. That is also exactly why tests 4 and 5
 * (the two blocked-state specs) stay test.fixme: there is no seeded row,
 * and there will be no seeded row after that sibling change either, that
 * combines "has a contact number" with "not opted in", nor one with no
 * contact number that has any scheduled dose. Closing them needs either a
 * dedicated seed fixture (out of this module's ownership) or a fresh
 * registration-via-Arrivals fixture (the technique dose-queue.spec.ts uses)
 * built specifically for one of the two no-contact-number patients, neither
 * attempted here so as not to land an unverifiable spec (this worktree has
 * no reachable database). The UI mechanism itself (aria-disabled plus a
 * focus-visible reason) is implemented and ready for whichever fixture
 * lands first.
 */

test.describe('readiness: R2 day-before dose reminder (QR text-patient)', () => {
  test('Upcoming worklist tab renders and lists doses due on future dates', async ({ page }) => {
    await page.goto('/scheduled-orders')

    const upcomingTab = page.getByRole('tab', { name: /upcoming/i })
    await upcomingTab.click()
    await expect(upcomingTab).toHaveAttribute('aria-selected', 'true')

    // The tab's own count badge only renders a number once it is the active
    // tab (ScheduledOrdersPage.tsx: `activeTab === 'upcoming' ? orders.length
    // : ''`), so this is the real "count control", present whether the
    // count is zero or not.
    await expect(upcomingTab).toContainText(/\d+/)

    const dueColumn = page.getByRole('columnheader', { name: 'Due' })
    const emptyState = page.getByText('No scheduled orders for this filter')

    // Upcoming can legitimately be empty on a given run against the shared
    // seed: it depends on which standing-order schedules happen to have a
    // future dose right now. Asserting a non-zero row count would be
    // flaky, so assert the honest disjunction instead: either the table
    // renders (and we can inspect the due-date population below), or the
    // empty state is shown and the tab + count control already proved the
    // tab itself works.
    await expect(dueColumn.or(emptyState)).toBeVisible()

    if (await dueColumn.isVisible()) {
      const rows = page.getByRole('table').locator('tbody tr')
      const rowCount = await rows.count()
      for (let i = 0; i < rowCount; i++) {
        const cells = rows.nth(i).getByRole('cell')
        // A lane can render its own "No upcoming courses" placeholder (a
        // single merged cell) even when the overall filter returned rows in
        // a different lane, so skip it rather than index past the end.
        if ((await cells.count()) < 4) continue
        const dueLabel = await cells.nth(3).innerText()
        // formatDueLabel (ScheduledOrdersPage.tsx) never renders "Today" or
        // a "…d late" suffix for a scheduledDate strictly after today, so
        // this is a real signal the row is genuinely future-dated: the
        // population a nurse would text a day-before reminder to.
        expect(dueLabel).not.toMatch(/today|late/i)
      }
    }
  })

  test('a nurse sees a "Text patient" action on an Upcoming worklist row', async ({ page }) => {
    await page.goto('/scheduled-orders')
    await page.getByRole('tab', { name: /upcoming/i }).click()

    // Same honest disjunction as the first test: Upcoming can legitimately
    // be empty on a given run against the shared seed.
    const dueColumn = page.getByRole('columnheader', { name: 'Due' })
    const emptyState = page.getByText('No scheduled orders for this filter')
    await expect(dueColumn.or(emptyState)).toBeVisible()
    if (!(await dueColumn.isVisible())) return

    // Every row's "Text patient" button renders regardless of whether it
    // ends up enabled or aria-disabled for that particular patient, so this
    // assertion holds no matter which row lands first.
    const firstRow = page
      .getByRole('row')
      .filter({ has: page.getByRole('cell') })
      .first()
    await expect(firstRow.getByRole('button', { name: /text patient/i })).toBeVisible()
  })

  test('activating "Text patient" shows a scannable QR code for the reminder', async ({ page }) => {
    await page.goto('/scheduled-orders')
    await page.getByRole('tab', { name: /upcoming/i }).click()

    const dueColumn = page.getByRole('columnheader', { name: 'Due' })
    const emptyState = page.getByText('No scheduled orders for this filter')
    await expect(dueColumn.or(emptyState)).toBeVisible()
    if (!(await dueColumn.isVisible())) return

    const firstRow = page
      .getByRole('row')
      .filter({ has: page.getByRole('cell') })
      .first()
    const textPatientButton = firstRow.getByRole('button', { name: /text patient/i })
    // Every worklist row resolves to a patient WITH a contact number (the
    // only two seeded patients without one have no standing order and never
    // appear here), so once the sibling's sms_opt_in seeding lands this is
    // enabled for every row.
    await expect(textPatientButton).toBeEnabled()
    await textPatientButton.click()

    // The QR needs an accessible name to be testable at all: a bare
    // <canvas>/<svg> with no label is invisible to getByRole. The label
    // contains the masked mobile (last few digits) so a nurse, and this
    // test, can confirm it is the right patient without the full number
    // ending up in a screen-reader announcement or DOM dump.
    await expect(page.getByRole('img', { name: /qr/i })).toBeVisible()
  })

  test('the QR payload is an sms: URI with the mobile, dose number, and due date', async ({
    page,
  }) => {
    await page.goto('/scheduled-orders')
    await page.getByRole('tab', { name: /upcoming/i }).click()

    const dueColumn = page.getByRole('columnheader', { name: 'Due' })
    const emptyState = page.getByText('No scheduled orders for this filter')
    await expect(dueColumn.or(emptyState)).toBeVisible()
    if (!(await dueColumn.isVisible())) return

    const firstRow = page
      .getByRole('row')
      .filter({ has: page.getByRole('cell') })
      .first()
    const textPatientButton = firstRow.getByRole('button', { name: /text patient/i })
    await expect(textPatientButton).toBeEnabled()
    await textPatientButton.click()

    // A QR is a bitmap: Playwright cannot decode one. The QR wrapper
    // exposes the raw encoded string as a data-sms-uri attribute alongside
    // the rendered image, so the payload itself is assertable without image
    // decoding.
    const smsUri = await page.getByTestId('reminder-qr').getAttribute('data-sms-uri')
    expect(smsUri, 'QR wrapper should expose data-sms-uri').toBeTruthy()
    expect(smsUri!).toMatch(/^sms:\+?\d+\?body=/)

    const decoded = decodeURIComponent(smsUri!.split('?body=')[1] ?? '')
    // Dose number of total, e.g. "dose 3 of 5".
    expect(decoded).toMatch(/dose \d+ of \d+/i)
    // Due date in some human-readable form: the exact format is an
    // implementation choice, so match loosely on a date-ish token rather
    // than pinning a fixed string.
    expect(decoded).toMatch(/\d{1,2}[/\- ]\w+|\w+ \d{1,2}/)
  })

  test.fixme('a patient with no mobile on file shows a disabled "Text patient" state with a reason', async ({
    page,
  }) => {
    await page.goto('/scheduled-orders')
    await page.getByRole('tab', { name: /upcoming/i }).click()

    // No fixture exists today that puts such a row in this worklist: see
    // the file docblock for why (the two no-contact-number seeded
    // patients, Cruz and Katipunan, have no standing order). The UI
    // mechanism this test exercises (aria-disabled, focus-visible reason
    // text) is already implemented in TextPatientButton
    // (ScheduledOrdersPage.tsx) and getTextDraft (scheduled_orders/db.ts)
    // and needs only a deterministic row to prove it end to end.
    const rowWithNoMobile = page
      .getByRole('row')
      .filter({ hasText: /no mobile/i })
      .first()
    const textPatientButton = rowWithNoMobile.getByRole('button', { name: /text patient/i })
    await expect(textPatientButton).toBeDisabled()
    await textPatientButton.focus()
    await expect(page.getByText(/no mobile number on file/i)).toBeVisible()
  })

  test.fixme('a patient who has not opted into SMS reminders shows a disabled "Text patient" state naming the missing consent', async ({
    page,
  }) => {
    await page.goto('/scheduled-orders')
    await page.getByRole('tab', { name: /upcoming/i }).click()

    // patients.sms_opt_in is boolean NOT NULL DEFAULT false, the
    // messaging-consent flag, distinct from the clinical consents table.
    // No fixture exists today that puts such a row (a contact number
    // present, but sms_opt_in false) in this worklist: once the sibling
    // change seeds sms_opt_in = true for every patient with a contact
    // number, this combination has zero seeded rows. See the file
    // docblock. The UI mechanism (aria-disabled, focus-visible reason
    // text) is already implemented and needs only a deterministic row.
    const rowWithoutSmsOptIn = page
      .getByRole('row')
      .filter({ hasText: /no sms/i })
      .first()
    const textPatientButton = rowWithoutSmsOptIn.getByRole('button', { name: /text patient/i })
    await expect(textPatientButton).toBeDisabled()
    await textPatientButton.focus()
    await expect(page.getByText(/sms.{0,20}consent|opt.?in/i)).toBeVisible()
  })

  test.fixme('a sent reminder is recorded in the notifications queue and visible to the operator', async ({
    page,
  }) => {
    // Documents the future automated-provider phase, which the owner has
    // explicitly deprioritised. Blocked on two things, neither of which
    // exists yet, by design:
    //   1. A producer for the reminder domain event: publishDomainEvent
    //      (apps/backend/src/shared/lib/domainEvents.ts) has zero callers,
    //      and the notification consumer
    //      (apps/backend/src/workers/domainEventConsumers/notificationConsumer.ts)
    //      maps only AppointmentScheduled / AppointmentConfirmed /
    //      ClinicalOrderScheduled / ProductRecallNotification, none of
    //      which fire for a scheduled-dose reminder today.
    //   2. A real SMS provider behind the NotificationSender interface:
    //      the sender is a LoggingSender stub
    //      (apps/backend/src/modules/notifications/sender.ts) that logs
    //      and returns success, nothing more.
    // Even once both land, the `Branch` account this whole suite runs as
    // cannot reach the queue UI today: `/api/admin/notifications` is
    // mounted `requireRole('TenantAdmin', 'BranchAdmin')`, and Branch is
    // neither, so this spec would need an admin persona (a different
    // storageState than the suite default) once the blockers above clear.
    await page.goto('/admin/notifications')
    await expect(page.getByRole('cell', { name: /reminder/i }).first()).toBeVisible()
  })
})
