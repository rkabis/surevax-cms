import { test, expect } from '@playwright/test'
import { attestAs } from '../fixtures/attestation'
import { manilaCalendarDate } from '../fixtures/manila-date'

/**
 * Nurse testing readiness: the dose queue.
 *
 * Three workflows a nurse must be able to rely on before a pilot, each its
 * own test so a red run names exactly which promise broke:
 *
 *   R5 - Doses come from standing orders, not appointments. Registering a
 *        patient onto a multi-dose protocol (the intramuscular 5-dose rabies
 *        PEP course) must create the WHOLE dose schedule up front, not just
 *        Day 0. `startStandingOrderTx` (standing_orders/db.ts) inserts one
 *        clinical_orders row per template item at PSO-creation time, each
 *        carrying its own `current_scheduled_date` from the item's
 *        `dayOffset`. This test proves that from the nurse's side: after
 *        registering, the course already shows more than one scheduled dose,
 *        a future dose already exists, and that exact future display ID is
 *        reachable from the worklist plus the Patients list DoseStrip, not
 *        just from a raw API response. The Upcoming tab itself is a two-day
 *        operational window and correctly excludes Essen Day-3 Dose 2.
 *
 *   R9 - Inventory must not block the clinical flow. The owner's instruction
 *        is that inventory/FEFO are not a pilot priority and must not block
 *        anything, but the code makes `lotId` mandatory on administer
 *        (scheduled_orders/contract.ts) and `deductLot` (inventory/fefo.ts)
 *        re-validates tenant/branch/quarantine/expiry/quantity/eligibility -
 *        so an empty or expired lot is a hard stop on the clinic's single
 *        most important action. The pilot mitigation is generously seeded,
 *        far-future-expiry stock, not a code bypass, so this test asserts
 *        the precondition directly (a lot is offered, Confirm enables) with
 *        a failure message a non-engineer can act on. It runs BEFORE R6 so
 *        it still finds the Day-0 dose Pending; it cancels out rather than
 *        committing, leaving the dose for R6 to actually administer.
 *
 *   R6 - One nurse view: today's queue, one-click administer, then collect,
 *        without leaving the worklist. Drives the exact order R5 created via
 *        `?selected=`, reusing the proven interaction sequence from
 *        daily-loop.spec.ts, but collects payment from the SAME flow panel
 *        (Pattern 35) instead of daily-loop's deliberately decoupled
 *        re-navigate. Also asserts the /today cockpit surfaces the same
 *        due-today work with a deep link into this worklist.
 *
 * All three run as the `Branch` operator persona (project storageState) and
 * share one fixture: R5 registers the patient and captures the created
 * order's id and the patient's display name; R9 and R6 reuse them via
 * `test.describe.serial` so a failure in an earlier step skips the rest
 * instead of operating on a half-built fixture. Never `.first()` from the
 * shared seeded worklist - every lookup is keyed on data this run created.
 *
 * Mutating: creates a patient-standing-order + 5-dose schedule, administers
 * Day-0 (brand pick, stock deduction + audit), and creates a transaction +
 * payment. Each run consumes one anti-rabies vaccine unit from the shared
 * seed (same accounting as daily-loop.spec.ts); a reseed replenishes it.
 */
test.describe.serial('nurse testing readiness: dose queue', () => {
  let day0OrderId = ''
  /** Worklist row / lane card format: "Lastname, Firstname". */
  let patientListName = ''
  /** ScheduledOrderDetail rail heading format: "Firstname Lastname". */
  let patientRailName = ''
  /**
   * The exact future dose this run created. Name-plus-dose is NOT unique: the
   * Arrivals identify step picks the first listed patient, so every run adds
   * another course to the same person and a name filter matches N rows after N
   * runs (a strict-mode violation, which is how this surfaced). The order id is
   * unique by construction.
   */
  let futureOrderId = ''

  test('R5: registering onto the 5-dose rabies PEP course schedules the whole future course up front (SHOULD PASS)', async ({
    page,
  }) => {
    // ── Register the bite walk-in onto the intramuscular 5-dose rabies PEP
    // course. Identical Arrivals path to daily-loop.spec.ts: Rabies
    // specialty, WHO Category II (ARV only, no RIG gate), IM 5-dose. ──
    await page.goto('/arrivals')
    await expect(page).toHaveURL(/\/arrivals\/identify/)

    const firstPatient = page.getByRole('option').first()
    await expect(firstPatient).toBeVisible()
    await firstPatient.click()
    await expect(page).toHaveURL(/\/arrivals\/encounter/)

    await page.getByLabel('Specialty').selectOption('Rabies')
    await page
      .getByRole('radiogroup', { name: /WHO exposure category/i })
      .getByRole('radio', { name: /^Category II\b/ })
      .click()
    await page.getByLabel('Chief complaint').fill('Dog bite, right forearm, walk-in for PEP')
    await page.getByRole('checkbox', { name: /informed consent was obtained/i }).check()
    await page.getByRole('button', { name: /save & continue/i }).click()
    await expect(page).toHaveURL(/\/arrivals\/protocol/)

    await page
      .locator('label')
      .filter({ hasText: /Rabies PEP.*Intramuscular \(5-dose\)/ })
      .click()

    const physician = page.locator('#physician-id')
    await expect(physician).toBeVisible()
    await expect(physician.locator('option')).not.toHaveCount(1)
    await physician.selectOption({ index: 1 })

    const commit = page.getByRole('button', { name: /commit bundle/i })
    await expect(commit).toBeEnabled()
    await commit.click()
    await expect(page).toHaveURL(/\/arrivals\/done/)
    await expect(page.getByRole('heading', { name: /arrival complete/i })).toBeVisible()

    day0OrderId = new URL(page.url()).searchParams.get('day0OrderId') ?? ''
    expect(day0OrderId, 'arrivals done URL should carry day0OrderId').toBeTruthy()

    // ── Assert the WHOLE course was scheduled up front, not just Day 0.
    // Capture both the detail response (patient identity, for deterministic
    // lookups later) and the timeline response (the real dose schedule)
    // from the SAME navigation that opens the order in the worklist. ──
    const [detailResp, timelineResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().endsWith(`/api/scheduled-orders/${day0OrderId}`) &&
          r.request().method() === 'GET',
      ),
      page.waitForResponse(
        (r) =>
          r.url().endsWith(`/api/scheduled-orders/${day0OrderId}/timeline`) &&
          r.request().method() === 'GET',
      ),
      page.goto(`/scheduled-orders?selected=${encodeURIComponent(day0OrderId)}`),
    ])

    const detail = (await detailResp.json()) as {
      patient: { firstName: string; lastName: string } | null
    }
    expect(
      detail.patient,
      'order detail should carry the patient it was registered against',
    ).not.toBeNull()
    const { firstName, lastName } = detail.patient!
    patientListName = `${lastName}, ${firstName}`
    patientRailName = `${firstName} ${lastName}`

    const timelineEntries = (await timelineResp.json()) as Array<{
      id: string
      day: number
      scheduledAt: string
    }>
    expect(
      timelineEntries.length,
      'a 5-dose IM PEP course should insert one clinical_orders row per template item, not just Day 0',
    ).toBeGreaterThan(1)

    const todayStr = manilaCalendarDate()
    const futureEntries = timelineEntries.filter((e) => e.scheduledAt > todayStr)
    expect(
      futureEntries.length,
      'at least one future dose should already be scheduled (current_scheduled_date > today) right after registration, before anything is administered',
    ).toBeGreaterThan(0)
    futureOrderId = futureEntries[0]!.id

    // Visible proof: the Protocol timeline lists one row per dose, and at
    // least one is badged "upcoming".
    await expect(page.getByText(/Protocol timeline/)).toBeVisible()
    const timelineRows = page.getByRole('listitem').filter({ hasText: /^Dose \d/ })
    await expect(timelineRows).toHaveCount(timelineEntries.length)
    await expect(timelineRows.filter({ hasText: 'upcoming' }).first()).toBeVisible()

    // The Upcoming tab is intentionally only a two-day operational window;
    // Essen Dose 2 is scheduled on Day 3, so absence from that tab is not a
    // scheduling failure. Pin the exact future display ID captured from the
    // timeline and prove the created order is directly reachable instead.
    await page.goto(`/scheduled-orders?selected=${encodeURIComponent(futureOrderId)}`)
    await expect(page.getByText(patientRailName)).toBeVisible()

    // ── The dose-progress strip (DoseStrip, @/components/clinical) renders
    // the SAME schedule on the Patients list row (real per-patient
    // doseStates from the backend - unlike the hardcoded placeholder
    // DoseStrip on PatientDetail's Overview tab, which always shows
    // D0/D3/D7/D14 regardless of the actual patient, so that surface is not
    // used for this assertion). DoseStrip's accessible name is a single
    // role="img" summary built as "{label}: {stateLabel}" per dose
    // (components/clinical/DoseStrip.tsx) - assert it reports the same dose
    // count and marks a future dose Upcoming. ──
    await page.goto('/patients')
    await page.getByPlaceholder(/search name, mrn, phone/i).fill(lastName)
    const patientRow = page.getByRole('row').filter({ hasText: patientListName })
    await expect(patientRow).toBeVisible()
    const doseStrip = patientRow.getByRole('img')
    await expect(doseStrip).toBeVisible()
    const stripLabel = await doseStrip.getAttribute('aria-label')
    expect(stripLabel, 'DoseStrip should render an aria-label summary').not.toBeNull()
    expect(stripLabel, 'DoseStrip aria-label should summarise every dose in the course').toContain(
      `Dose ${timelineEntries.length}`,
    )
    expect(stripLabel, 'DoseStrip aria-label should mark a future dose Upcoming').toContain(
      'Upcoming',
    )
  })

  test('R9: the administer dialog for a due dose requires an explicit brand before commit (SHOULD PASS, seeded-stock precondition)', async ({
    page,
  }) => {
    // Runs BEFORE R6 actually administers day0OrderId, so it still finds the
    // dose Pending/due. Inventory/FEFO are explicitly not a pilot priority
    // (owner instruction) and must not block the clinical flow, but
    // `administerBody.lotId` is mandatory (scheduled_orders/contract.ts) and
    // `deductLot` (inventory/fefo.ts) re-validates tenant/branch/quarantine/
    // expiry/quantity/eligibility - so a stock-out or an expired lot is a
    // hard stop on the most important clinical action. The pilot mitigation
    // is generously seeded, far-future-expiry stock, not a code bypass, so
    // this asserts the precondition directly instead of skipping when it is
    // missing - a red run here must be diagnosable by a non-engineer.
    const NO_STOCK_MSG =
      'No selectable lot for a due ARVPEP_IM dose. Each E2E run consumes one unit from the shared seed; a failure here almost always means the seeded far-future-expiry vaccine stock ran out or expired. Reseed the dev database (pnpm run setup --force, or the seed script) and re-run.'

    await page.goto(`/scheduled-orders?selected=${encodeURIComponent(day0OrderId)}`)
    const administerTrigger = page.getByRole('button', { name: /review administration/i })
    await expect(administerTrigger).toBeEnabled()
    await administerTrigger.click()
    await expect(page.getByRole('heading', { name: 'Administer dose' })).toBeVisible()

    const brandPicker = page.getByRole('radiogroup', { name: /vaccine brand/i })
    await expect(brandPicker, NO_STOCK_MSG).toBeVisible()
    const brandCount = await brandPicker.getByRole('radio').count()
    expect(brandCount, NO_STOCK_MSG).toBeGreaterThan(0)
    await expect(brandPicker.getByRole('radio', { checked: true }), NO_STOCK_MSG).toHaveCount(0)
    const availableBrand = brandPicker.locator('[role="radio"]:not(:disabled)').first()
    await expect(availableBrand, NO_STOCK_MSG).toBeEnabled()
    await availableBrand.click()
    await expect(availableBrand).toHaveAttribute('aria-checked', 'true')

    // Confirm only enables once consent is ALSO given AND the administering
    // clinician is attested, so satisfy both here to isolate the enabled state
    // below to the lot pick, not a missing gate.
    await page.getByLabel(/^given by/i).click()
    await page.getByRole('option').first().click()
    await page.getByLabel(/pin/i).fill('1234')
    await page.getByRole('checkbox', { name: /consent.*obtained/i }).check()
    await expect(
      page.getByRole('button', { name: /confirm & administer/i }),
      NO_STOCK_MSG,
    ).toBeEnabled()

    // Do not commit here - R6 performs the real administer against this same
    // order, so this run must leave it untouched.
    await page.getByRole('button', { name: /^cancel$/i }).click()
    await expect(page.getByRole('heading', { name: 'Administer dose' })).toBeHidden()
  })

  test('R6: the worklist administers a due dose and collects payment without leaving the panel; /today deep-links into the same work (SHOULD PASS)', async ({
    page,
  }) => {
    // ── /today surfaces the same due-today work, with a deep link into the
    // worklist - located by the patient name and Day-0 dose number this run
    // created. `.first()` only after filtering to this patient's Day-0 dose:
    // re-runs accumulate courses for the same person, so the filtered set can
    // hold more than one card, but any of them is this run's own work. ──
    await page.goto('/today')
    const dueNowRegion = page.getByRole('region', { name: 'Due now' })
    await expect(dueNowRegion).toBeVisible()
    const ourCard = dueNowRegion
      .locator('[data-severity]')
      .filter({ hasText: patientListName })
      .filter({ hasText: 'Dose 1' })
      .first()
    await expect(ourCard).toBeVisible()
    await ourCard.getByRole('button', { name: /^administer$/i }).click()
    await expect(page.getByText(patientRailName)).toBeVisible()

    // ── Default Today tab on /scheduled-orders: KPI strip reports a
    // due-today count and the list renders, our own due dose among the
    // rows. ──
    await expect(page.getByText('Ready today')).toBeVisible()
    // `.first()` for the same reason as the Upcoming lookup above: re-runs
    // accumulate courses for this patient, so name-plus-dose is not unique.
    // The rail is already open on THIS run's exact order via the deep link.
    const dueRow = page
      .getByRole('row')
      .filter({ hasText: patientListName })
      .filter({ hasText: 'Dose 1' })
    await expect(dueRow.first()).toBeVisible()

    // ── Administer, from the SAME row's rail (already open via
    // ?selected=), reusing daily-loop.spec.ts's proven interaction
    // sequence. ──
    const administerTrigger = page.getByRole('button', { name: /review administration/i })
    await expect(administerTrigger).toBeEnabled()
    await administerTrigger.click()
    await expect(page.getByRole('heading', { name: 'Administer dose' })).toBeVisible()

    const brandPicker = page.getByRole('radiogroup', { name: /vaccine brand/i })
    await expect(brandPicker.getByRole('radio', { checked: true })).toHaveCount(0)
    const availableBrand = brandPicker.locator('[role="radio"]:not(:disabled)').first()
    await expect(availableBrand).toBeEnabled()
    await availableBrand.click()
    await expect(availableBrand).toHaveAttribute('aria-checked', 'true')
    // Shared `Branch` kiosk → name the clinician and prove it with their PIN.
    await page.getByLabel(/^given by/i).click()
    await page.getByRole('option').first().click()
    await page.getByLabel(/pin/i).fill('1234')
    await page.getByRole('checkbox', { name: /consent.*obtained/i }).check()
    const confirm = page.getByRole('button', { name: /confirm & administer/i })
    await expect(confirm).toBeEnabled()
    await confirm.click()
    await expect(page.getByRole('heading', { name: 'Dose administered' })).toBeVisible()

    // The dose is attributed to a NAMED clinician, not the shared login: this is
    // the whole point of the attestation step (legacy parity with
    // `Immunization.i_NurseRef`). Scope the check to the summary block that row
    // lives in: "Main Branch Account" is also the sidebar's logged-in user
    // label, so a page-wide text search for it always matches and would fail
    // here for the wrong reason.
    const givenByRow = page
      .locator('div')
      .filter({ hasText: /^Given by/ })
      .last()
    await expect(givenByRow).toBeVisible()
    await expect(givenByRow).not.toContainText('Main Branch Account')
    // A real person, not an empty dash: the attributed name renders.
    await expect(givenByRow).not.toContainText(', ')

    // ── Collect payment from the SAME flow panel (Pattern 35): no page
    // reload, no stacked dialog, unlike daily-loop.spec.ts's deliberately
    // decoupled re-navigate. This is the real administer (R9 already proved
    // the picker live before commit), so it consumes one anti-rabies
    // vaccine unit from the shared seed. ──
    await page.getByRole('button', { name: /collect payment/i }).click()
    await expect(page.getByRole('heading', { name: 'Collect payment' })).toBeVisible()
    await page
      .getByRole('checkbox', { name: /dose \d/i })
      .first()
      .check()
    await attestAs(page)
    const collect = page.getByRole('button', { name: /^collect payment$/i })
    await expect(collect).toBeEnabled()
    await collect.click()
    await expect(page.getByText('Payment collected')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('heading', { name: 'Collect payment' })).toBeHidden()
  })
})

/**
 * Branch-scoping fix (2026-07-26): listScheduledOrders and getScheduledOrdersStats
 * (scheduled_orders/db.ts) used to run branchId: null (a tenant-wide read), so a
 * nurse at one branch saw every other branch's due doses in the worklist and its
 * KPI counts. Both now filter on patients.homeBranchId, scoped to the caller's
 * session branch (never a query param); a null homeBranchId still means "no
 * fixed home branch", visible from every branch, matching the patients module's
 * own cross-branch masking convention.
 */
test.describe('nurse testing readiness: cross-branch worklist scoping', () => {
  test.fixme('the worklist does not surface a dose belonging to a patient homed at another branch (SHOULD PASS once a real cross-branch dose fixture exists)', async ({
    page,
  }) => {
    // Teresa Rivera (seed key 'rivera', apps/backend/src/shared/db/seed/patients.ts,
    // homeBranch: 'secondary') is the one seeded patient homed at the second
    // branch (TMG) rather than the Branch persona's own branch (HST). She is
    // the existing fixture for the cross-branch PHI masking checks (R3, the
    // patients module).
    //
    // She is not a meaningful fixture for THIS assertion, though: grepping the
    // seed for her display id (PAT_RIVERA_DISPLAY_ID) finds only her own
    // patient row and her emergency contact, never a patient_standing_orders
    // or clinical_orders row. With no standing order she never appears in
    // this worklist at all, so an assertion driven off her today would pass
    // whether or not the branch predicate exists, i.e. for the wrong reason.
    //
    // Building a real fixture (registering her onto a standing order via
    // Arrivals, the R5 technique above, while running as the Branch/HST
    // persona; her home branch stays TMG regardless of which branch's
    // session creates the order) is mechanically possible, but this worktree
    // has no reachable database (no apps/backend/.env), so the resulting
    // spec cannot be run and verified here, the same reason
    // reminders.spec.ts's two blocked-state fixmes give for not building a
    // fixture live. Closing this needs either a dedicated seed fixture (a
    // second seeded patient with a standing order homed elsewhere, out of
    // this module's file ownership) or this exact registration technique run
    // against a reachable database.
    await page.goto('/scheduled-orders')
    await expect(
      page.getByRole('row').filter({ hasText: 'Rivera' }),
      'a patient homed at another branch (TMG) should never appear in this branch worklist',
    ).toHaveCount(0)
  })
})
