# Phase-1 Role UAT and Browser Coverage

> - **Assessment date:** 2026-08-22
> - **Clinic timezone:** Asia/Manila
> - **Product boundary:** Phase-1 shared-Branch clinic operation. Nurse, Cashier,
>   and Physician seed records identify/authorize work through the shared kiosk;
>   their direct logins are intentionally disabled. TenantAdmin has a direct login.

## Executive Summary

The main browser suite already covered the shared-Branch Cat II daily loop,
registration, receivables, a basic transaction, and close-day snapshot. This
change adds the highest-risk missing staff decision boundaries without creating
Phase-2 behavior: Cat III RIG plus authorizing-provider UI gating,
recalled-brand recovery, TenantAdmin recall/audit/cross-branch review,
DirtyFormGuard/beforeunload, drawer variance close, and the day-snapshot
public-ID contract.

The suite and adversarial review reproduced three application defects before
their respective fixes:

1. Day-snapshot reads returned internal branch bigint `"1"` rather than
   `SVX.HST` because the display-ID lookup ran outside the RLS transaction.
2. The recall detail hook treated its `{ data: recall }` API envelope as the
   recall record, so the detail sheet rendered blank operational fields. Once
   unwrapped, the response also exposed internal product, creator, and branch
   bigints; those projections now use display IDs only.
3. Before 08:00 Manila time, the server-local cash-drawer day window hid the
   genuinely open branch drawer. A second open attempt then conflicted while
   the kiosk remained stuck in the open dialog. Drawer lookup/open guards,
   deposit writes, and kiosk day comparisons now use the Manila clinic day.

The first live readiness baseline was **12 passed, 5 failed, 5 intentionally
skipped, 2 not run**. The five failures were stale suite assumptions, not five
product failures: three omitted mandatory shared-kiosk staff/PIN attestation,
one expected Day-3 Dose 2 in a two-day Upcoming window, and one matched an old
DOB fallback shape. Those tests now follow the current staff workflow.

## Persona-to-workflow coverage matrix

| Persona                   | Journey                       | Before this change                                                         | New or repaired coverage                                                                     | Current boundary                                                                                                                  |
| ------------------------- | ----------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Nurse via shared Branch   | Arrival/intake                | Flu arrival and Cat II PEP daily loop                                      | Cat III UI gate proves RIG and an authorizing-provider selection are independently mandatory | The API does not verify that the submitted authorizer has a Physician role; Cat I has no explicit no-PEP/discharge disposition    |
| Nurse via shared Branch   | Dose administration           | Cat II brand choice, clinician PIN, consent, stock deduction               | Live recalled Vaxigrip brand is disabled and clean Fluarix recovery is selectable            | Full administration remains covered by the existing Cat II loop                                                                   |
| Nurse via shared Branch   | Off-schedule cascade          | Backend Manila date math and recompute coverage                            | Readiness future-course test now uses Manila date and the exact future `ORD_` deep link      | No browser late-administration cascade assertion yet                                                                              |
| Nurse via shared Branch   | Refusal / deferral            | None                                                                       | Documented as unsupported                                                                    | Only the Day-28 animal-observation cancellation stores a deferral reason; there is no general clinician action                    |
| Nurse via shared Branch   | Clinical correction           | Encounter amendment/cancellation rules below administration                | Boundary documented                                                                          | Administered doses are immutable and encounter cancellation is blocked after administration; there is no undo-dose UI             |
| Cashier via shared Branch | Split / partial tender        | Split, receivables, downpayment, credit and payoff tests                   | Readiness split/prepay tests now name the money handler and enter the seeded kiosk PIN       | Direct Cashier login is disabled by design                                                                                        |
| Cashier via shared Branch | Pay-on-account / prepayment   | Main receivables plus readiness future-dose prepay                         | Repaired shared-kiosk attestation in the dose-collect panels                                 | Free-standing deposit is covered by backend integration, not browser UAT                                                          |
| Cashier via shared Branch | SC/PWD                        | Readiness OSCA/PWD exact arithmetic                                        | Existing coverage retained                                                                   | Receipt print disclosure/layout remains unverified                                                                                |
| Cashier via shared Branch | Payment-method correction     | Strong backend integration only                                            | Matrix records existing non-browser coverage                                                 | No additive browser mutation in this bounded pass                                                                                 |
| Cashier via shared Branch | Approval-threshold refusal    | Backend gate/refuse/approve/retry coverage                                 | Matrix records existing non-browser coverage                                                 | No deterministic browser creator for an isolated approval request                                                                 |
| Cashier via shared Branch | Drawer variance and close     | Day Summary rendered the drawer block only                                 | New UAT persists a ₱1.00 variance and covers the pre-08:00 Manila drawer window              | Test reopens the drawer when rerun, then closes it last                                                                           |
| Physician                 | Authorization / review        | Physician selected as Cat II intake metadata                               | Cat III browser test proves the UI requires an authorizing-provider selection                | The server verifies only a tenant user, not a Physician role; direct login and a separate review/exception inbox do not exist     |
| TenantAdmin               | Approvals                     | Seeded page only                                                           | Existing route retained                                                                      | Approve/reject mutations remain backend-covered; no isolated rerun-safe browser creator was found                                 |
| TenantAdmin               | Product recall                | Page existed; no browser detail or administration hard-stop                | Admin detail review plus Branch recalled-brand recovery; blank detail defect fixed           | Recall creation fan-out is not repeated to avoid duplicating backend safety tests                                                 |
| TenantAdmin / operations  | Inventory transfer            | Seeded UI and backend lifecycle exist                                      | Inventory-transfer surface inventoried                                                       | Create/ship/receive browser lifecycle remains uncovered                                                                           |
| TenantAdmin / operations  | Notification dry-run          | UI exists                                                                  | Documented, not promoted to a passing UAT                                                    | Dry-run currently requires a numeric patient bigint and the sender is a logging stub; both violate an honest staff-ready workflow |
| TenantAdmin / operations  | Audit / cross-branch review   | Backend/RLS tests and readiness break-glass                                | New TenantAdmin browser review of Audit Log and cross-branch access ledger                   | Break-glass mutation remains in readiness coverage                                                                                |
| Branch operations         | Day close                     | Snapshot button and badge                                                  | Manila default date and GET-after-POST public branch display ID are asserted                 | Branch, not TenantAdmin, owns the current close-day UI                                                                            |
| Session / concurrency     | DirtyFormGuard / beforeunload | Component existed without browser coverage                                 | New browser UAT proves unload prevention, Cancel preservation, and explicit Leave            | —                                                                                                                                 |
| Session / concurrency     | Refresh rotation              | Auth unit/integration coverage                                             | Existing coverage inventoried                                                                | No browser token-expiry clock manipulation added                                                                                  |
| Session / concurrency     | `row_version` conflict        | Fields are exposed but mutations do not accept expected versions           | Documented as unsupported                                                                    | No honest stale-write browser test can be built until the API contract supports optimistic concurrency                            |
| Session / branch scope    | Branch isolation              | Readiness cross-branch masking/break-glass plus backend direct-order tests | Masking selector repaired for current “DOB not recorded” header                              | Cross-branch scheduled-order fixture remains intentionally skipped                                                                |

## Staff-effort observations

| Workflow                             |      Approximate decisions/clicks exercised | Operational finding                                                                                                       |
| ------------------------------------ | ------------------------------------------: | ------------------------------------------------------------------------------------------------------------------------- |
| Cat III intake to commit-ready state | 10 decisions/clicks after patient selection | RIG absence and provider-selection absence are separate visible UI gates; server-side Physician-role validation is absent |
| Recalled flu brand recovery          | 8 decisions/clicks to administration review | The unsafe house brand remains visible with the reason, while a clean alternative is one deliberate choice away           |
| Dirty patient form exit              |                  3 actions after first edit | Cancel retains both page and value; Leave is explicit and final                                                           |
| Drawer variance close                |               3 actions when drawer is open | Expected cash and variance are visible before the irreversible close action                                               |

These are workflow observations, not timed usability benchmarks. No real clinic
staff participated in this automated pass.

## Verification results

| Gate                           | Before this change                        | Final result                       | Notes                                                                                                         |
| ------------------------------ | ----------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Main Chromium browser suite    | 19 passed                                 | **24 passed** in 1.0 min           | Five new role UAT journeys; no skips or failures                                                              |
| Opt-in readiness suite         | 12 passed, 5 failed, 5 skipped, 2 not run | **19 passed, 5 skipped** in 50.4 s | All runnable tests passed; skip rationale is below                                                            |
| Focused backend regressions    | Not present                               | **11 passed** in 4.13 s            | Manila date/window math plus day-summary and recall public-ID integrations                                    |
| Cash-drawer Manila regression  | Not present                               | **16 passed** in 3.99 s            | Fixed-clock 00:30 PHT coverage for open/current/deposit/close session consistency                             |
| Frontend Manila-date unit test | Not present                               | **2 passed** in 1.76 s             | Pins the 00:30 PHT / previous-UTC-day boundary                                                                |
| `pnpm agent:check`             | Not run for this change                   | **Passed**                         | Agent docs, tokens, design system, contract drift, formatting, lint, recursive typecheck, and recursive build |

The frontend production build emitted its existing advisory that one generated
chunk exceeds 500 kB; the build completed successfully. The first sandboxed
`agent:check` attempt could not create the temporary `tsx` IPC socket
(`listen EPERM`); the same command passed when rerun with permission for that
temporary socket.

## Intentional skips and unsupported paths

| Path                                 | Rationale                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Cross-branch scheduled-dose worklist | Seeded Rivera patient has no standing order; a test would pass even if the scope predicate were absent |
| Admin bulk-cancel visible-error path | Readiness runs as Branch; it needs a role admitted by the UI but rejected by the narrower endpoint     |
| Reminder with no mobile              | No deterministic scheduled-order fixture lacks a mobile number                                         |
| Reminder without SMS opt-in          | No deterministic fixture combines mobile with `sms_opt_in=false`                                       |
| Notification queue evidence          | Automatic delivery provider remains deferred and Branch cannot review the admin queue                  |
| Cat I no-PEP disposition             | Product has no explicit discharge/no-prophylaxis action to test                                        |
| General refusal/deferral             | No Phase-1 route or UI action exists                                                                   |
| Physician exception inbox            | No separate Phase-1 physician review workflow exists                                                   |
| Physician authorizer role validation | Arrival APIs resolve any tenant user and do not enforce a Physician role                               |
| Optimistic `row_version` conflict    | Mutations expose versions but do not accept an expected version                                        |
| Visual snapshots in CI               | Darwin baselines are opt-in and no Linux baselines are committed                                       |

## Reproduction commands

```bash
pnpm test:e2e
pnpm test:readiness
pnpm --filter @surevax/backend test -- tests/unit/dateMath.test.ts \
  tests/integration/day-summary-snapshot.test.ts \
  tests/integration/product-recall-public-ids.test.ts
pnpm --filter @surevax/backend test -- tests/integration/cash-deposits.test.ts \
  tests/unit/dateMath.test.ts
pnpm --filter @surevax/frontend test -- src/lib/__tests__/clinicDate.test.ts
pnpm agent:check
```

## Next Steps / Considerations

1. Define the intended Cat I disposition and whether selecting a prophylaxis
   protocol must be blocked or require an override.
2. Define whether refusal/deferral belongs on the scheduled order, encounter,
   or standing-order chain and who may reopen it.
3. Define the physician exception queue, decision states, turnaround owner,
   and emergency bypass.
4. Replace numeric notification patient IDs with patient display IDs before
   treating dry-run as staff-ready.
5. Add expected-version fields and a 409 recovery contract before browser
   testing optimistic concurrency.
6. Add deterministic fixtures for approval creation, cross-branch scheduled
   orders, no-mobile/no-opt-in reminders, and transfer lifecycle UAT.
