# End-to-end tests (Playwright)

Browser E2E for the SureVax CMS frontend. These drive a real Chromium browser
against the **full running stack** — the Vite frontend proxies `/api` to the
Express backend, which talks to the seeded Postgres. Unlike the jsdom + MSW
component suite (`apps/frontend/src/**/*.test.tsx`), nothing is mocked: real
auth/cookies, tenant resolution, RLS GUCs, the audit trigger, and stock deduction all run.

Use this layer for **cross-page user journeys**. Use the component suite for
per-component logic.

## Run it

```bash
# From the repo root. Reuses a running `pnpm dev`; otherwise boots the stack.
pnpm test:e2e

# Headed / interactive UI mode while writing tests:
pnpm test:e2e:ui

# One spec:
pnpm exec playwright test e2e/daily-loop.spec.ts

# Open the HTML report after a run:
pnpm test:e2e:report
```

Prereqs (once per machine): `pnpm exec playwright install chromium`. The
worktree must be bootstrapped (`pnpm run setup`) so the seeded DB + per-worktree
ports exist. `playwright.config.ts` derives the base URL from
`PLAYWRIGHT_BASE_URL` (default `http://localhost:5205`); set it if your
worktree's frontend port differs (`pnpm dev` prints it).

## Layout

| File                           | Role                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `playwright.config.ts`         | (repo root) Chromium project, `webServer` (reuses `pnpm dev`), serialized `workers: 1`.        |
| `auth.setup.ts`                | Setup project — logs in once per role via the real UI, saves cookie `storageState`.            |
| `fixtures/test-data.ts`        | Seeded credentials, storageState paths, tenant slug.                                           |
| `fixtures/auth.ts`             | `uiLogin()` helper.                                                                            |
| `auth.spec.ts`                 | Login behaviour: Branch→kiosk, admin→patients, invalid creds, protected-route redirect.        |
| `smoke.spec.ts`                | Authenticated pages load (breadcrumb assertion).                                               |
| `daily-loop.spec.ts`           | Anti-rabies PEP daily loop: register a bite walk-in → administer Day-0 dose → collect to Paid. |
| `day-summary.spec.ts`          | End-of-day reconciliation: `/day-summary` report renders all blocks → "Close day" snapshot.    |
| `patient-registration.spec.ts` | New-patient registration: fill the record form → land on the created patient's record.         |
| `arrivals.spec.ts`             | Walk-in registration wizard (identify → encounter → protocol).                                 |
| `transactions.spec.ts`         | Cashier creates a transaction.                                                                 |
| `z-role-uat.spec.ts`           | Phase-1 role UAT: Cat III, recall recovery, admin review, dirty forms, drawer variance.        |

## Conventions

- **Persona.** The default project loads the `Branch` storageState — the shared
  per-branch service account that is the real single clinic operator (nurse acts
  as cashier, records which physician authorised). Specs that need a fresh login
  or the admin persona override with `test.use({ storageState: ... })`.
- **Role boundary.** Seeded Nurse, Cashier, and Physician staff identify their
  work through kiosk PIN / authorization fields and cannot log in directly.
  Role UAT must exercise that shared-account handoff rather than enable artificial
  credentials. See [`docs/uat/phase-1-role-browser-coverage.md`](../docs/uat/phase-1-role-browser-coverage.md).
- **Clinic calendar.** Browser contexts run in `Asia/Manila`. Node-side date
  comparisons use `fixtures/manila-date.ts` rather than UTC truncation.
- **Serialized.** `workers: 1` — the mutating journeys (administer, register,
  take payment) run against one shared seeded DB, so tests must not race for the
  same row. Each run consumes the first available fixture (the seed has plenty of
  headroom: 9 due-today + 5 overdue ARV-PEP courses, 22 Vaxigrip units, etc.).
- **Selectors.** The app has almost no `data-testid`s; prefer role/label/text
  (`getByRole`, `getByLabel`, `getByPlaceholder`). Add a `data-testid` only when a
  flow element is genuinely ambiguous.
- **Mutating tests leave data behind** (a completed order, a new transaction).
  That is intended because they exercise the real write path. Re-running is safe within
  the seed's headroom; `pnpm run setup --force` (or a reseed) resets it.

## Scope notes

- **`arrivals.spec.ts` commits the full bundle.** This required fixing two
  backend bugs the E2E surfaced: (1) `/api/arrivals/atomic` resolved patient +
  provider with bare `db` reads outside `withTenantTx`, which return zero rows
  under FORCE RLS → 404 on every commit; and (2) the preview-bundle lot lookup
  ignored the `service_eligible_products` junction, so abstract services
  (FLU_QUAD, etc., whose `service_catalog.product_id` is NULL) showed "No lots
  in stock". Both are fixed in `apps/backend/src/modules/arrivals/`.

- **`daily-loop.spec.ts` drives the full loop end to end on the clinic's
  highest-leverage workflow, anti-rabies PEP**: register a bite walk-in via the
  Arrivals wizard (Rabies specialty, WHO Category II, intramuscular 5-dose PEP
  course, physician-on-duty noted), administer the Day-0 anti-rabies vaccine dose
  (brand/lot pick + consent gate + inventory deduction + audit), then collect
  payment to Paid. This is an Animal Bite Treatment Center, so a PEP course is
  THE daily driver; the earlier flu-shot version dodged the bite-assessment and
  physician-auth paths and was replaced. WHO Category II keeps it off the
  Category III RIG commit gate and the weight-based RIG dose calculator; the ARV
  vaccine is a fixed dose. Physician authorisation is metadata only (a dropdown),
  not a separate login. It stays deterministic on any date by registering its own
  fresh Day-0 order and opening exactly that order via the `?selected=` deep link
  (the Arrivals done URL hands back the order id as `?day0OrderId=`), so it never
  depends on which seeded order is due today. The payment leg re-opens the order
  and collects from the Review step (a clean page load, so the prepayable-doses
  query gets a single quiet fetch instead of racing the administer round-trips).
  Because the loop administers a real dose, it consumes one anti-rabies vaccine
  unit per run from the shared seed; a `pnpm run setup --force` or reseed replenishes
  it.

- **`day-summary.spec.ts` closes the daily loop** (register → administer → pay →
  **reconcile**). It opens the end-of-day report at `/day-summary` (which IS the
  generated EOD report — A4 print stylesheet), asserts all five reconciliation
  blocks render (Transactions / Administrations / Encounters / Inventory
  movements / Cash drawer), then exercises "Close day" → snapshot and asserts the
  persisted "Snapshotted" badge. It runs after `daily-loop.spec.ts`
  (alphabetically), so today already has that loop's administration + payment, but
  it asserts only on always-present structure + the snapshot write, never on
  counts from sibling tests. Mutating (writes a `day_summary_snapshots` row) and
  re-run-safe: re-snapshotting overwrites, and the spec matches either the
  first-snapshot or re-snapshot labels.

  Hardening this suite also surfaced and fixed a real flakiness class: the auth
  bootstrap (`AuthProvider`'s `/api/auth/me` probe) treated **any** non-OK
  response as "logged out", so a transient `429` from the global rate limiter — or
  a merely-expired 15-minute access token — bounced a valid operator to `/login`.
  Because the whole serial suite shares one IP, request bursts tripped the old
  `100/min` global limiter and bounced later specs. Fixes: the bootstrap is now
  refresh-aware (401 → single-flight refresh → retry) and tolerant of transient
  `429`/`5xx` (backoff + retry, never a spurious logout), and the global limiter
  is now `600/min` (env-tunable `RATE_LIMIT_MAX`) — sized for a multi-staff clinic
  behind one NAT IP. The per-route credential limiter (login/refresh/verify-pin,
  `10/min`) is unchanged.

## CI

The `e2e` job in `.github/workflows/ci.yml` spins up Postgres, applies
migrations, seeds, boots the stack, and runs this suite on every PR. The
Playwright HTML report is uploaded as a build artifact on failure.

## Visual regression (opt-in)

`visual.spec.ts` snapshots the Today cockpit + scheduled-orders /
patients / transactions at the clinic resolution (2560×1440), masking
time-derived regions (`tabular-nums`, `time`). It only runs when
`VISUAL=1` is set — baselines are platform-specific (darwin committed
under `visual.spec.ts-snapshots/`), so CI skips it until linux
baselines are generated in CI.

```bash
VISUAL=1 pnpm test:e2e --project=visual                     # check
VISUAL=1 pnpm test:e2e --project=visual --update-snapshots  # rebaseline
```

Rebaseline ONLY after an intentional visual change, and eyeball the new
PNGs in the diff before committing.

## Nurse-testing readiness (opt-in, `e2e/readiness/`)

`e2e/readiness/` is a separate checklist from the rest of this suite: it asks
"can a nurse do their job today," not "did this commit regress." Full
assessment: [`docs/nurse-testing-readiness.md`](../docs/nurse-testing-readiness.md).

- **Persona.** Runs as the same `Branch` storageState as the default project
  (see "Conventions" above), because that is the only login a real clinic uses.
- **Run it.**

  ```bash
  pnpm test:readiness
  ```

- **Opt-in only.** Registered as its own `readiness` Playwright project, gated
  behind the `READINESS=1` env var (see `playwright.config.ts`), so it is never
  picked up by a plain `pnpm test:e2e` and never gates CI. Several specs are
  `test.fixme` placeholders for capabilities that do not exist yet, so a red
  checklist here is a status report for the owner, not a broken build.
- **`test.fixme` convention.** A gap-blocked check is written as a full
  `test.fixme(...)` carrying its complete intended body, assertions included,
  not a stub comment. The moment the capability lands, dropping `.fixme` turns
  it into a live, already-written check.
- **Honest limitation.** Every spec is compile-verified (`playwright test
--list`), but as of this writing none has been executed against a running
  stack. Treat the first real run as part of the work, not as a regression
  signal.
- **Mutating specs.** `dose-queue.spec.ts` and `money.spec.ts` mutate shared
  seeded state and consume vaccine stock on every run, the same as
  `daily-loop.spec.ts` in the main suite.
