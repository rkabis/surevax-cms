# Nurse-testing readiness: the ten workflows

> [!IMPORTANT]
> **Point-in-time assessment; superseded for pilot decisions.** This document
> records the 2026-07-26 code/test-based readiness pass. A later seeded,
> browser-driven Branch-account walkthrough performed 2026-08-23 found a P0
> cross-branch write bypass plus P1 clinical and financial failures that the
> checklist did not detect. The current decision is **NO-GO**; use
> [`docs/STATUS.md`](STATUS.md#branch-account-audit-2026-08-23)
> for the live backlog and the
> [Branch-account live usability audit](audits/2026-08-22-branch-account-live-usability.md)
> for reproduction evidence and acceptance tests. Statements such as “all ten
> workflows work today” below are preserved as historical findings, not current
> publication status.

> **Purpose.** Before real nurses touch this app, verify the workflows they
> actually perform all day, on the login they will actually use. This document
> is the assessment; [`e2e/readiness/`](../e2e/readiness) is the executable
> checklist that proves it.
>
> **Assessed:** 2026-07-26, against the code at the head of this branch.
> Updated the same day after five fixes landed on top of the initial pass:
> cross-branch masking plus break-glass (R3), allergies and conditions
> masking (R3), the SMS-reminder QR feature (R2), the dose-worklist branch
> scoping (R6), and the SC/PWD VAT correction (R8). Updated again the same
> day after a second batch cleared the "week one polish" list: split tender
> at the dose-worklist collect step (R4), specific copy for all ten
> administer failure codes (R6), a prepay entry point on the patient chart
> (R7), the Cancel pending button hidden for non-admins with a real error
> path (R3), and in-app stock receiving (R9).
> **Persona:** the seeded `Branch` service account (`branch-main@surevax.com`).
> There is no role-based login: one account per physical clinic, and the nurse
> on duty does everything, from registering a walk-in to administering the
> vaccine to collecting the payment. Sometimes there are two nurses, sometimes a
> doctor; there is no dedicated cashier or concierge.
>
> **Run the checklist:**
>
> ```bash
> pnpm test:readiness
> ```
>
> It is deliberately **not** part of `pnpm test:e2e` and does not gate CI. These
> specs answer "can a nurse do their job yet?", not "did this commit regress?".
> A red checklist is a status report, not a broken build.

---

## Verdict in one paragraph

All ten workflows now work today on the Branch login. The cross-branch
privacy model (R3) that was designed and built but sat inert for the Branch
login is enforced end to end: a non-home-branch caller sees a masked chart
and a cross-branch banner, allergies and conditions mask the same way, and
every write to either is blocked server-side; the same fix also restores the
product-recall and critical-lab safety banners a silently-failing request had
been hiding from nurses on every patient. Nurses can now text a patient about
an upcoming dose (R2): a scannable QR encoding an `sms:` URI, since the
clinic's laptop cannot send SMS itself. The senior citizen and PWD discount
(R8) now bills no VAT and reports the statutory 20% alone, correcting what had
been a real overcharge on every qualifying sale. A second batch cleared what
was left on the "week one" list: split tender now reaches the dose-worklist
collect step (R4), all ten administer failure codes carry copy written for
the person holding the syringe (R6), a prepay entry point now lives on the
patient chart (R7), the Cancel pending button is hidden for non-admins with a
real error path underneath it (R3), and stock can now be received in-app
(R9). Inventory's hard `lotId` requirement remains the toughest gate in the
app, by design, and correctly so.

**A pass on 2026-07-30 closed the one gap none of the ten workflows was asking
about: who gave the dose.** Every dose recorded `administered_by_id` as the JWT
principal, which on the shared day-scoped `Branch` login is the branch service
account, so the whole clinic's immunization record named a service account rather
than a nurse. The legacy AppSheet database it replaces records the nurse per dose
(`Immunization.i_NurseRef`), so this was a parity regression as well as a clinical
one. Administering now names a clinician and proves it with their kiosk PIN. The
same pass made the payer selectable at settlement (the collect step had always
billed the cash rate, so an HMO patient's ARV PEP IM dose read ₱1,500 against a
contracted ₱2,200), seeded the clinic's real branches, nursing roster, and payer
tiers from the export, and rebuilt the intake form around what a nurse actually
types. See "What shipped 2026-07-30" below.

| #   | Workflow                                     | Verdict | Blocking work                                                                                     |
| --- | -------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| R1  | Register a patient                           | Works   | none                                                                                              |
| R2  | Text the patient before their dose day       | Works   | none (the automated day-before reminder stays out of scope)                                       |
| R3  | See all patients, details gated, break glass | Works   | none (Cancel pending is now hidden for non-admins, with a real error path if the backend rejects) |
| R4  | Multi-method (split) payment                 | Works   | none (`AddPaymentDialog` and `PayBalancePanel`, lower-traffic surfaces, still take one method)    |
| R5  | Upcoming doses from standing orders          | Works   | none                                                                                              |
| R6  | One queue: due today, administer, collect    | Works   | none (all ten administer failure codes now have specific copy; see the queue notes)               |
| R7  | Prepay a dose, or hold a balance             | Works   | none (chart entry point now exists; see the new `indication` bug found alongside it)              |
| R8  | Senior citizen / PWD: 20% off, no 12% VAT    | Works   | none (a bookkeeper should confirm the receipt layout)                                             |
| R9  | Inventory must not block anything            | Works   | the hard `lotId` requirement stands by design; in-app receiving now closes the restock gap        |
| R10 | Close and reconcile the day                  | Works   | none                                                                                              |

---

## R1. Register a patient

Works. `/api/patients` carries no `requireRole` gate, and `requireRole` treats
an ungated router as "any authenticated user"
([`requireRole.ts`](../apps/backend/src/shared/middleware/requireRole.ts)), so
the Branch account can register, edit, tag, and record allergies, conditions and
consents. Duplicate detection (`PatientDuplicatePanel`) gates the submit on a
name plus date-of-birth collision.

The registration form now captures `patients.sms_opt_in`
([`PatientForm.tsx`](../apps/frontend/src/features/patients/components/PatientForm.tsx)),
the messaging-consent flag separate from the clinical `consents` table, so a
newly registered patient is reachable for R2's texting action from day one
rather than permanently opted out.

## R2. Text the patient before their scheduled dose day

Built, and deliberately manual only. The clinic works on a laptop, which
cannot send SMS, so the nurse worklist's **Text patient** action renders a QR
code encoding the full `sms:` URI (recipient plus a prefilled reminder body).
The nurse scans it with their own phone, Messages opens prefilled, they press
send. No provider account, no PHI transiting the clinic's infrastructure, no
spend. A real provider (Semaphore or Twilio) stays a later phase behind the
existing `NotificationSender` interface.

`GET /api/scheduled-orders/:id/text-draft` composes the body (first name,
service, dose N of total, due date, branch) and returns the encoded `sms:`
URI, a QR data URL, and a masked recipient. It deliberately omits the
indication (WHO exposure category), any diagnosis and the clinician, since
SMS is an insecure channel and a family member may read it. Branch name comes
from `patients.home_branch_id`, not `encounters.branch_id`, because
`clinical_orders` has no `branch_id` and its encounter is usually null for a
dose that has not been administered yet, which is exactly the population this
serves.

Two hard blocks, each with a machine-readable reason and a focus-visible
tooltip rather than a broken QR: no contact number on file, and
`sms_opt_in = false`. R1's registration form now captures `sms_opt_in`, so a
newly registered patient is reachable immediately. The message composition
lives in a pure module (`scheduled_orders/textDraft.ts`, no DB or HTTP)
specifically so a future automated day-before reminder, still out of scope
per the owner, can reuse it without a rewrite.

The checklist's test hooks are all live now: a `Text patient` button per row;
the QR exposes an accessible name containing the masked mobile plus a
`data-sms-uri` attribute, since a QR bitmap cannot be decoded by Playwright;
and a blocked row renders `aria-disabled` with the reason as visible tooltip
text, not only a hover-only affordance.

Four of the checklist specs are now real, passing tests. Two stay skipped for
want of a patient who has a contact number but no opt-in, since the shared
seed does not have that combination now that every patient with a number
carries `sms_opt_in = true`; the notifications-queue check stays skipped too,
since automated sending remains deliberately deferred.

## R3. See every patient, but not their details, unless you break the glass

Works for the Branch login now, in full. All three tiers are real, enforced
server-side, and covered by passing tests rather than `test.fixme`
placeholders.

- **Tier 1, seeing that a patient exists:** unchanged, still tenant-wide.
  `listPatients` runs `withTenantTx({ branchId: null })`.
- **Tier 2, hiding details:** `getPatient` and the list projection null
  `dateOfBirth`, `sex`, `contactNumber`, `email`, `address`, `region`,
  `province` and `city` (plus guardian, insurance and onboarding fields) when
  the patient's `home_branch_id` differs from the caller's session branch
  ([`patients/db.ts`](../apps/backend/src/modules/patients/db.ts)). Fields are
  nulled, not omitted, so the response shape stays identical for every
  caller; a null home branch is not cross-branch, and platform or system
  reads with no branch context are unaffected. `PatientDetail` renders a
  cross-branch banner in their place instead of the raw chart.
- **Tier 3, break the glass:** `POST /api/patients/:id/break-glass` and
  `GET /api/patients/:id/demographic` now widen their `requireRole`
  allow-list to every clinical role including `Branch`
  ([`patients/routes.ts`](../apps/backend/src/modules/patients/routes.ts)),
  matching `/api/lab-orders` and `/api/dose-calc`. A typed reason (a category
  plus a 10-character detail floor) is mandatory before the chart reveals,
  and the grant is written to `cross_branch_access_grants` plus an audit row,
  so the access is logged rather than merely permitted. The reveal is
  read-only by design: the `branch_isolation` RLS `WITH CHECK` never honours
  `cross_branch_read`, so a break-glass session still cannot write
  cross-branch at the DB layer.

**The safety consequence was worse than the privacy one, and is fixed too.**
The same Tier-1 projection carries `activeRecalls` and
`recentCriticalLabResults`. Because the demographic call used to 403 for
`Branch`, a nurse saw no product-recall banner and no critical-lab flag on
any patient, ever, and the failure was silent. `usePatientDemographic` now
carries a real error state, surfaced as a "safety check unavailable, retry
before administering" banner, so a failed fetch can never again masquerade
as a clean chart.

**Allergies and conditions are masked too**, an owner decision made after the
first pass deliberately left them visible as a safety signal. The masking
keeps the row and nulls its detail fields rather than returning an empty
collection: an empty collection would make a cross-branch patient with a
penicillin allergy look identical to one with none, exactly the failure this
exists to prevent. So the count stays truthful, "1 allergy on record at
another branch, hidden here" rather than a false "none recorded," and a
nurse knows to break the glass before administering. Found while building
this: `patient_allergies` and `patient_conditions` carry no `branch_id`, so
the `branch_isolation` RLS `WITH CHECK` that makes break-glass read-only
elsewhere never applied to these two tables; all six write routes now return
403 `CROSS_BRANCH_WRITE_FORBIDDEN` explicitly, and that holds even after a
reveal.

**Seed fixture that unblocked all of this:** Teresa Rivera is now seeded
homed at the second branch (TMG), with one allergy (Penicillin) and one
condition (Hypertension), so the masked-versus-unmasked assertions are
meaningful; every other seeded patient stays at HST.

**The residual 403 from the original pass is now fixed.** The **Cancel
pending** route stays `TenantAdmin`-only on purpose: it destroys a patient's
remaining schedule in one action, so the gate was never the bug. `PatientDetail`
now hides the button for any role outside the app's own admin set instead of
widening the route, and the mutation carries a real `onError` (a toast plus an
inline destructive message in the still-open modal), so an admin whose request
is rejected server-side sees it happen rather than a silent no-op.

The other residual gap the original pass found is now fixed: `POST
/api/inventory-transfers` plus its `receive` and `cancel` siblings admitted
`Nurse` but not `Branch`, the one login a clinic actually uses, so a branch
physically receiving a shipment had no way to confirm it. All three routes
now admit `Branch`, and the nav item moved out of Administration to sit
beside Inventory, where the person doing the receiving will look for it.

## R4. Multi-method payment (half cash, half something else)

Works, at the surface nurses actually use. **The backend has no limitation:**
`createTransaction` accepts `payments[]` up to ten legs and walks each through
`addPaymentTx` in one transaction, and `POST /transactions/:id/payments`
accepts repeat calls, so the sum crosses `Pending` to `Paid` on the leg that
completes it. `SplitTenderEditor` drives exactly this on the cashier create
page, and the checklist asserts a real two-tender settlement there (Cash plus
GCash, both legs on the receipt, balance zero).

Getting that assertion to pass surfaced a real accessibility bug, now fixed:
the "Method," "Amount" and "Reference" labels rendered only above the first
leg, where they read as column headers, and carried no `htmlFor`, so no
leg's control had an accessible name, including the first. A screen reader
announced the cashier's split-payment row as three unnamed fields. Found by
writing a test that could not address the second leg's method; each control
now carries a name by leg position (for example "Payment 2 amount").

**The gap where nurses stand is now closed.** `CollectPaymentDialog`, the
collect step reached from the dose worklist and from the arrivals hand-off,
now offers the same split behind a "Split across multiple payment methods"
checkbox, off by default so a single-tender collection (the common case) never
touches the multi-leg editor. It reuses `SplitTenderEditor` unmodified and
loops one `addPayment` per leg, the same pattern `TransactionsCreatePage`
already used for its post-credit remainder. Legs sum against what is
outstanding **after** any patient-credit draw, not the gross, so a
credit-funded bill can't be left with a phantom balance, and an overpaying
split is blocked client-side with a visible reason instead of relying on
MONEY-5's 422. `e2e/readiness/money.spec.ts` drives this exact flow as a real,
passing test, and getting there fixed a race in the test itself: it used to
read "Estimated total" before the preselected dose had priced, parse the
`₱0.00` placeholder, and derive every leg amount from zero.

`AddPaymentDialog` (the returning-patient path) and `PayBalancePanel` remain
single-method; both are lower-traffic than the dose-worklist collect step, and
the same reuse pattern applies whenever they are next touched.

**Good news on a known blocker, confirmed again here.** `docs/STATUS.md`
records a "currency-input programmatic-set" bug as a real defect, but it does
not block a browser test: every money input in these surfaces is a plain
controlled `<input>` with `useState` and a keystroke regex filter, and the one
RHF-registered field is uncontrolled. Playwright's `fill()` and
`pressSequentially()` both dispatch real input events, so they drive these
fields exactly as a keyboard does. The bug is an artefact of assigning
`.value` or calling `setValue` outside a real input event, not of anything a
nurse's keystrokes would trigger.

## R5. Upcoming doses come from standing orders, not appointments

Works, and matches the AppSheet behaviour it replaces. `startStandingOrderTx`
creates the **entire** course up front in one insert: one `clinical_orders` row
per template item, `current_scheduled_date = startDate + dayOffset`, and
`doseNumber` derived from position in the `(dayOffset, sequence)`-sorted list.
That last detail is a fix worth knowing about: `sequence` is a within-visit
injection-site index (always 1 for IM, 1 or 2 for left and right deltoid on ID),
so using it as the dose number made every IM PEP dose report `doseNumber = 1`
and poisoned the overdue and progress logic.

The late-dose cascade also works and is **automatic**: administering runs
`applyRecomputeTx` in the same transaction, shifting downstream siblings'
`current_scheduled_date`, pairing each sibling by dose number rather than array
index so a soft-deleted dose does not shift everything by one. There is a manual
recompute endpoint and a `useRecomputeScheduledOrder` hook, but **no component
calls the hook**, so the cascade only ever fires as a side effect of
administering.

Two queue defects found here, neither blocking:

- **`Upcoming` has no horizon.** The tab is labelled `Upcoming · 48 h` but the
  predicate is only `current_scheduled_date >= tomorrow`, with no ceiling. It
  lists every future dose forever. Either cap the query or fix the label; for
  R2 the uncapped behaviour is arguably what you want.
- **`Missed` is a dead lane.** No job, cron, trigger or code path ever sets
  `status = 'Missed'`. Overdue doses stay `Scheduled` or `Pending` indefinitely.
  The tab always reads zero.

## R6. One view: who is due today, administer, collect

Works, in a single continuous rail rather than stacked dialogs: about five
interactions to administer (open row, "Recompute and administer", pick brand and
lot, tick consent, confirm) and three more to collect, all in the same panel.

**Recommendation: make the Scheduled Orders worklist the nurse's home, not
`/today`.** The worklist has the full tab set, search, and every real action.
The `/today` cockpit is read-only, fires four separate queries, never polls
(refresh happens on window focus or a manual button), and its dose action just
deep-links back into the worklist. Note that a fresh Branch login currently
lands on **`/branch/kiosk`**, the shared clock-in kiosk
([`LoginPage.tsx:75`](../apps/frontend/src/features/auth/components/LoginPage.tsx)),
which is a clock-in surface with no patient, dose or payment workflow on it.

Gates that can stop a nurse mid-flow, all now with copy written for the
person holding the syringe rather than a raw server string or a generic alert:

| Gate                                                   | Code                                                                     | Nurse sees                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Order not found                                        | `NOT_FOUND`                                                              | specific: dose may have been removed, refresh the worklist and retry  |
| Already administered                                   | `ALREADY_COMPLETED`                                                      | specific: already given, this attempt added nothing, no action needed |
| No branch on session                                   | `BRANCH_REQUIRED`                                                        | specific: account has no branch, ask an admin to attach one           |
| Consent revoked or absent                              | `CONSENT_REVOKED`                                                        | specific: take consent again before giving this dose                  |
| No visit for consent                                   | `CONSENT_BLOCKED`                                                        | specific: register the arrival, or open a visit, first                |
| Wrong-branch, quarantined, expired, or vanished lot    | `LOT_WRONG_BRANCH` / `LOT_QUARANTINED` / `LOT_EXPIRED` / `LOT_NOT_FOUND` | specific: pick a different brand or lot                               |
| Stock raced to zero mid-submit                         | `NEGATIVE_INVENTORY`                                                     | specific: pick the brand again and retry                              |
| Stock, eligibility, out of stock (earlier pass's copy) | `OUT_OF_STOCK` / `LOT_OUT_OF_STOCK` / `LOT_NOT_ELIGIBLE`                 | specific, useful copy                                                 |

**The fallback is the important part.** An unrecognised code, or a bare
network failure, used to say "please try again," which asserts the dose was
**not** given. We do not actually know that. It now says we could not confirm
whether the dose was recorded and to check the order's status before giving
another, because a nurse who wrongly believes a dose failed may give it
twice. Verified on the wire, not from source: a repeated administer returned
400 `ALREADY_COMPLETED`, a nonexistent lot returned 404 `LOT_NOT_FOUND`, and a
malformed body returned a codeless 400 that correctly lands on the fallback.

Three checks are client-side only and not enforced by the server: the
weight-based **dose calculator** gates the submit button but `administerBody`
carries no dose-calc fields, so the server never verifies it was completed; a
**recalled lot** shows a warning banner but can still be administered; and
`requiresPhysicianAuth` is checked only when the standing order is initiated,
never again at administer time.

**The worklist is now scoped to the caller's own branch.** `listScheduledOrders`
and its stats both filter on the patient's home branch (not
`encounters.branch_id`, which is usually null for a dose that has not been
administered yet), applied identically to the list and to every KPI count so
the strip never disagrees with the visible rows. A null home branch stays
visible from every branch, matching how the patients module treats an unhomed
patient, and a caller with no branch context (platform admin, tenant-wide
operational read) still sees everything. One residual gap: single-order
lookups by `ORD_` display id (detail, timeline, prepayable doses, recompute
preview) are not branch-scoped yet, since they take no branch context today.

## R7. Prepay a dose, or hold the balance

Works, and better than expected. Two distinct mechanics:

- **Per-dose prepay.** `getPrepayableDoses` returns the **whole** standing-order
  chain, and the collect panel lets a nurse select **any unbilled, non-cancelled
  dose regardless of date**, so future doses are prepayable. It bills the dose
  directly against its `clinical_order`, not through the deposit mechanism.
  Five to seven clicks from the nav, no admin role, no URL typing.
- **Free-standing patient credit.** An item-less `is_prepayment = true` deposit,
  consumed later as an internal `Credit` payment. Remaining balance is derived
  on every read, never stored, because the immutability trigger forbids writing
  it back onto the paid deposit row.

**Holding a balance** works through the same panel: untick "pay in full", enter
a downpayment, and the bill stays `Pending` with `amount_outstanding` (a
generated column) surfacing on the patient's billing tab and `/receivables`.

**The missing entry point from the patient's own chart is now built.**
`StandingOrderTab` opens the existing collect panel directly, with copy that
cannot be mistaken for administering, so a nurse looking at a patient's
schedule no longer has to go find some row of that chain in the worklist
first. Suppressed, not disabled, when there is nothing left unbilled and when
the chart is being viewed cross-branch, since cross-branch writes are refused
server-side and offering a control that will fail is worse than not offering
it at all.

**Found on the way, not fixed here, because it needs a clinical decision:**
`clinical_orders.indication` is never written by any in-app insert path, only
by the migration transform. `getPepProgress` filters on it, so it returns
"not-started" for every patient registered through the app, and this tab's
own schedule card has therefore **always** rendered "No standing orders
found" even for a patient mid-course, verified live against the seeded Maria
Dela Cruz (`PAT_AAAAAAA1`), who has a real 5-dose PEP chain with one dose
already completed. The prepay affordance above deliberately derives its own
state from the scheduled-orders list rather than from that broken signal, so
it works today regardless; the empty schedule card is a real, separate bug.
Tracked as a newly-open item in [`docs/STATUS.md`](STATUS.md) rather than
here, since fixing it needs an owner decision on how PEP versus PrEP is
derived at standing-order start (the templates carry `specialty`, not
`indication`).

Also noted: `applyPrepayment` and its `useApplyPrepayment` hook are **dead
code**, reachable only by direct API call. Every UI path uses
`applyCreditOnAccount` instead, which picks deposits oldest-first rather than
requiring a named source.

## R8. Senior citizen and PWD discount

Fixed: the math now matches the requirement. Under RA 9994 with BIR RR
7-2010 (senior citizens) and RA 10754 with BIR RR 5-2017 (PWD), the
computation is one rule on a VAT-inclusive shelf price: strip the VAT, take
20% off that base, and bill no VAT at all. `computeTransactionTotals` used to
strip VAT to find the discount base, then subtract the discount from the
still-VAT-inclusive gross, so the 12% VAT stayed in what the patient paid, an
overcharge of exactly the VAT on every senior and PWD sale; it also skipped
the 20% entirely on a line already flagged VAT-exempt, under-discounting
those, when the exemption and the discount are separate entitlements a
qualified buyer is due both.

Worked on the canonical statutory example, a PHP 1,000.00 VAT-inclusive line:

| Figure               | Value  |
| -------------------- | ------ |
| Base (VAT-exclusive) | 892.86 |
| 20% discount         | 178.57 |
| VAT                  | 0.00   |
| Amount due           | 714.29 |

The 178.57 is the figure the clinic deducts from gross income. A merged
285.71 (discount plus the VAT foregone) would overstate that deduction, since
a discounted line's reported gross is its VAT-exclusive selling price, how a
VAT-exempt sale is recorded either way. Rounding: the base and the discount
are each rounded to the centavo, so a printed receipt reconciles by hand;
that can differ by one centavo from a single un-rounded calculation at
sub-peso prices, judged worth it for hand reconciliation. Both statutory
examples land exactly.

**This is now shipped code, and the checklist's two OSCA and PWD specs are
real, passing tests.** What still needs a bookkeeper or the clinic's BIR
consultant is the receipt LAYOUT: confirming it satisfies the
separate-disclosure requirement, not just that the numbers compute
correctly. Two related gaps were left as-is on purpose: a line item shows no
per-line base column, so a single line's own figures don't visibly reconcile
without the totals panel, and a mixed bill does not break the discount down
per line.

## R9. Inventory must not block anything

Your instruction was that inventory and FEFO are not a priority and must
never block clinical work. Inventory remains the hardest blocker in the app
by design: a dose cannot be administered without a nurse-picked lot. The
seed that had already failed is fixed.

The mechanism, unchanged: `administerBody.lotId` is **mandatory**, and
`deductLot` re-validates tenant, branch, quarantine, expiry, quantity and
product eligibility. No lot means no dose. That design is deliberate and
clinically right (a recall needs to know which vial went into which arm), so
the mitigation is generous stock, not a code bypass.

What the audit found in the seed, fixed in the same pass that produced this
document:

- **Expiry dates were hardcoded absolute strings**, so lots silently expire as
  the calendar moves. The Abhayrab lot meant to demonstrate low-but-in-date
  stock had **already expired** 26 days before this assessment. All valid
  expiries are now computed with `dateStr(daysFromNow(N))` at a 545 to 700 day
  horizon, and the two intentionally-expired quarantine fixtures now use
  `daysAgo(N)` so they stay deliberately past no matter when the seed runs.
- **The entire anti-rabies pool was 56 units** (38 Abhayrab plus 18 Speeda),
  shared across all six rabies service variants, at one unit per
  administration. 56 doses exhausts the rabies path for the whole clinic. Now
  400 and 300.
- **17 of 27 stock-requiring services had zero eligible stock.** Most
  importantly **ATS (Antitet) and HTIG (Sero-Tet) had no lot at all**, both
  adjuncts in the WHO Category III bite pathway, so `/eligible-lots` returned an
  empty list and a nurse could not administer them even in principle. Both now
  seeded at 250. Immunoglobulins raised too: ERIG 17 to 270, HRIG 13 to 305.
  Token stock added for 14 remaining non-rabies vaccines so a nurse clicking a
  routine immunization does not hit a dead end.

**In-app stock receiving is now built, closing the second caveat.**
`POST /api/inventory/receive` records a delivery as a lot plus its paired
`In` movement, in the order the `maintain_lot_balances` trigger requires, open
to `Branch` the same as the transfer routes, with the receiving branch coming
from the session rather than the body. A repeat delivery of a batch already
on hand tops up that lot (the composite unique index means it could never be
a second row); the same batch arriving with a different expiry is refused as
a data-entry error rather than averaged; a quarantined lot is refused since
adding fresh stock to it would silently un-quarantine it, and an
already-expired lot is refused at intake since `deductLot` would reject it
later anyway, so accepting it quietly would just create phantom stock. A
concurrent first-time receipt of the same batch racing the unique index is
translated from the underlying 23505 into a clear 409. Mid-pilot
replenishment no longer needs an engineer running SQL by hand.

**One caveat remains, unaffected by this batch.** `pnpm db:seed` is
idempotent via `onConflictDoNothing()`, which is good (a pilot's accumulated
test data survives) but means **re-running it does not top up an existing
lot**. A database seeded before the seed-quantity fix above needs a fresh
seed (`pnpm run setup --force`, or a plain reseed) to benefit; a non-engineer
running `db:seed` mid-pilot will see success messages and get no new stock.
The new receive endpoint is the mid-pilot answer to that, not a reseed.

**Fixed 2026-07-30.** All 12 original lots still live at HST, but every one of
the clinic's other 13 branches now has its own patient, its own dose due
today, and its own stock to administer it: `seed/branch-workflows.ts` gives
each a Tetanus Booster course (single dose, no physician auth) started today,
one `AbhayTox` lot at that branch, and one paid consultation transaction so
R4/R10 have per-branch data too. Verified live: logging in as the Alabang
kiosk account (`surevax.alb@surevax.com`) shows Gregorio Ramirez's tetanus
dose in the due-today worklist with a real eligible lot behind it. This closes
the R6/R9 interaction this section used to flag — a branch nurse's queue was
correctly scoped, but no other branch had a patient or stock to exercise it —
though `dose-queue.spec.ts`'s cross-branch `test.fixme` still points at
Rivera specifically (TMG, the R3 fixture) and hasn't been repointed at the new
per-branch fixtures.

## R10. Close and reconcile the day

Works and is already covered by `e2e/day-summary.spec.ts`: the report renders
all five blocks and snapshots on "Close day". The untested half is the cash
drawer money path, specifically closing with a variance and the mandatory
discrepancy reason. `/api/cash-drawer`, `/api/shifts`, `/api/day-summary` and
`/api/staff-time-logs` are all ungated, so the Branch account reaches everything
it needs.

---

## What shipped 2026-07-30

Five changes, each traceable to the export rather than to a guess.

**Who gave the dose (new, not one of the ten).** `administered_by_id` is now the
attested clinician and `documented_by_id` the session that typed it in. On the
shared `Branch` login the nurse is named and proved with the same 4-digit kiosk PIN
and lockout counters clock-in uses; a clinician logged in as themselves sees no
extra step. Attestation resolves BEFORE the clinical transaction opens, since PIN
verification writes its own counters and must not roll back with the dose. The
panel echoes the attributed name after commit, so a mis-picked roster row surfaces
while the record is fresh rather than at an audit. Refusal codes are listed in
[`.claude/rules/gotchas.md`](../.claude/rules/gotchas.md).

**Payer at settlement (R4, R7).** The collect step now picks a payer profile, and
`GET /api/scheduled-orders/:id/doses?payerId=` returns each dose's price resolved
through the same `resolveServicePrice` the transaction uses, brand-aware for a dose
already given. `HMO` and `Corporate` tenders appear only once a payer is named. The
order the nurse works in is now the order the UI asks in: standing order, then
brand at the bedside, then payer, then payments.

**The clinic's real branches, roster, and payer tiers.** Sta Mesa, Alabang, and the
Virtual branch were missing; Timog was seeded as `TIM` where the clinic's own
`b_TransactionInitials` says `TMG`. Each branch now has its own kiosk login using
its own mailbox from the sheet, and 103 real nurses are attached to the branches the
`Nurse` sheet assigns them to, so the attestation picker and the clock-in kiosk list
the people who actually work there. `HMO`, `mWell`, and `HPPI`: the three
highest-volume payer tokens in the `Vaccine` sheet: existed in neither the seed nor
the AppSheet migration's payer mapping, so 80 of 159 non-diagnostic rows were
falling through as unrecognised routes. All three are now payer profiles with the
sheet's 65 (service, payer) prices behind them, collapsed from 271 legacy rows on
the evidence that no two brands anywhere in the export disagree on a payer price.

**Intake form rebuilt around the fast path.** Guardian, Medical baseline, Coverage,
and Onboarding collapse, so registering a bite walk-in is four fields on one screen.
A collapsed section force-opens if a field inside fails validation, and carries a
filled-count badge so an existing patient's data is never hidden behind a closed
lid.

**Validation calibrated to the export.** Mobile numbers normalise the four
spellings that all mean the same number (87.0% are already clean `09XXXXXXXXX`,
4.6% lost a leading zero to spreadsheet coercion); two-numbers-in-one-field gets its
own message; a landline is told it cannot receive SMS rather than called invalid.
Email placeholders are rejected outright: 62.3% of the legacy column is the literal
string "n/a" because AppSheet made the field required, and v2 should not inherit
9,000 fake addresses. Birth dates reject the future and ages over 120; names reject
digits (3 of 45,429 real name cells contain one, all junk sample rows).

---

## What to do next, in order

The "week one" list that used to live here is cleared: split tender at the
dose-worklist collect step, specific copy on every administer error, the
`StandingOrderTab` prepay entry point, hiding Cancel pending for non-admins,
and in-app stock receiving are all shipped (R3, R4, R6, R7, R9 above), along
with `Branch` on the inventory-transfer routes and accessible names on the
split-tender controls from the pass before that. What genuinely remains:

**Before nurses touch it:**

1. **Get a bookkeeper or the clinic's BIR consultant to confirm the SC/PWD
   receipt layout (R8).** The math is now correct; what is unverified is
   whether the printed receipt separately discloses the figures the
   regulations require, not just that they compute correctly.

**Needs an owner or clinical decision:**

2. **Decide whether to backfill `clinical_orders.indication` on courses that
   already exist (R7).** The going-forward write landed 2026-07-28, so
   `getPepProgress` works for any course started since. Every course registered
   before that still reads not-started on the patient chart. Rewriting clinical
   classification on existing rows is an owner call, not a migration to slip
   into a sweep. See [`docs/STATUS.md`](STATUS.md) for the tracked item.

**Cheap cleanups still open:**

3. Fix the `Upcoming · 48 h` label or cap the query (R5).
4. Decide whether `Missed` should ever be set, or remove the dead tab (R5).
5. Remove the dead `applyPrepayment` code and its `useApplyPrepayment` hook;
   every real UI path uses `applyCreditOnAccount` instead (R7).
6. Thread branch scoping through the single-order lookups by `ORD_` display
   id (detail, timeline, prepayable doses, recompute preview), a residual
   known-id gap noted when the worklist itself was scoped (R6).
7. Correct `USERS.branch.landing` in `e2e/fixtures/test-data.ts`, or better,
   decide whether a Branch login should land on the clock-in kiosk at all
   rather than the work queue (R6).

---

## Found alongside, not part of the ten

Three things surfaced while this pass was underway that are not nurse-workflow
gaps, so they do not belong in the ten-workflow verdict table above. They get
their own note here instead.

**`fanOutRecallNotifications` is dead code.** It lives in
[`product_recalls/db.ts`](../apps/backend/src/modules/product_recalls/db.ts)
around line 463, and is fully implemented: idempotent, consent-gated,
templated. It is called from nowhere: not from `createRecall` or
`updateRecall` in the same file, not from any route in
[`product_recalls/routes.ts`](../apps/backend/src/modules/product_recalls/routes.ts)
(which exposes only CRUD plus a lot-match lookup, no notify endpoint), not
from the frontend, not from any worker or cron, and not from any test.
`docs/STATUS.md` previously recorded this as "confirmed already fixed" in an
archive sweep; that claim was wrong and has been corrected there. Consequence:
when a real product recall happens today, no patient is notified, and the
failure is silent, a compliance exposure rather than a UI complaint.

**The data-migration production loader is a stub.** `drizzleAdapter()` in
[`data_migration/adapter.ts`](../apps/backend/src/modules/data_migration/adapter.ts)
(around lines 12 to 23) throws "not implemented" for both
`resolvePlatformUserId` and `insertBatch`. Only the in-memory test adapter is
real, so no entity can currently be migrated into a real Postgres database,
however complete the transform logic is. Alongside it, per
[`docs/migration/appsheet/DESIGN.md`](../docs/migration/appsheet/DESIGN.md):
no synthetic `consents` row is inserted per migrated patient, so
`assertActiveConsent` would freeze every migrated patient's first clinical
write after cutover (tracked as R10); and `EXPORT_DATE` is hardcoded to a
stale `2025-05-21`, misclassifying roughly 9,146 orders. Also worth stating:
`InventoryLog` is deliberately not migrated, so day one starts from a manual
stock count rather than an import.

**Cash-deposit-to-bank ledger, an AppSheet gap closed rather than one of the
ten.** AppSheet gave the clinic a running on-hand-cash figure (cash collected
minus cash banked); the CMS had no deposit-out concept at all, so the front
desk could not answer "how much cash should be in this drawer right now" once
any cash had been taken to the bank. A new `cash_deposits` table (migration
`0010_cash_deposits.sql`) records one row per physical banking event, tied to
the drawer session the cash came out of and the bank's own slip number. This
is a BRANCH cash-out, distinct from the patient-facing prepayment deposit that
shares the word "deposit" elsewhere in the app. On-hand cash is derived on
every read (opening float plus cash collected minus deposits), never stored,
the same convention as patient credit, and excludes the internal `Credit`
payment method for the same reason `shifts` and the dashboard cash-split
already do. It deliberately does **not** exclude `is_prepayment` transactions:
a cash prepayment is real cash physically in the drawer, a different question
from the revenue-recognition rule that excludes prepayments from revenue
aggregates. Corrections are an offsetting void with a reason, never a
mutation, inline and logged rather than an approval queue, and refused once
the owning drawer session has closed. Alongside it, `closeDrawerSession`'s
`expectedTotal` is fixed: it never accounted for cash leaving the drawer, so
a banked-cash day showed a phantom shortage at close.

## The checklist suite

[`e2e/readiness/`](../e2e/readiness), four files, one per workflow cluster. All
run as the `Branch` persona.

| File                                                                | Covers     | Real specs | Skipped (`test.fixme`)                                                                                                                                                                                                              |
| ------------------------------------------------------------------- | ---------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`patient-access.spec.ts`](../e2e/readiness/patient-access.spec.ts) | R1, R3     | 5          | 1: an admin-session assertion for the Cancel pending error path (this suite's storageState is Branch-only)                                                                                                                          |
| [`dose-queue.spec.ts`](../e2e/readiness/dose-queue.spec.ts)         | R5, R6, R9 | 3          | 1: a cross-branch dose fixture (the TMG-homed seeded patient has no standing order, so the assertion would pass for the wrong reason)                                                                                               |
| [`money.spec.ts`](../e2e/readiness/money.spec.ts)                   | R4, R7, R8 | 5          | 0                                                                                                                                                                                                                                   |
| [`reminders.spec.ts`](../e2e/readiness/reminders.spec.ts)           | R2         | 4          | 3: a patient with a contact number but no SMS opt-in (no such seeded combination); a patient with no mobile at all who also appears in the worklist (same reason); the notifications-queue check (automation deliberately deferred) |

A skipped spec is not a placeholder comment: each carries its **full intended
body**, so it becomes a live check the moment the capability lands. That is the
point of writing them now.

**Executed, not just compile-verified.** The suite had only ever been
compile-verified (`playwright test --list`), since the authoring worktree had
no `.env` and no database. Run for real against a live seeded stack it passes
**19, skips 5, fails 0** (the 17 real specs above, plus the shared `setup`
project's admin-plus-branch auth bootstrap, which the `readiness` project
depends on and which always passes). The wider picture the same day: the
CI-gating suite (`pnpm test:e2e`) at 19 passed, the backend integration suite
at 324 passed across 38 files, 99 frontend component tests, and 161 backend
unit tests.

The first real run found four defects, all in the tests, none in the product:

1. **Viewport 1440 to 2560x1440.** `DetailRail` is non-modal only at `2xl`, so
   below that Radix marks the rest of the page `aria-hidden` while a rail is
   open, and every role-based query against the list returned nothing. That
   made "administer and collect without leaving the worklist" look broken
   when it works. 2560x1440 is also the clinic's real front-desk display, so
   the suite now tests the configuration that ships.
2. **Name-plus-dose locators were not unique.** The Arrivals identify step
   picks the first listed patient, so each run adds another course to the
   same person, and the locator matched more rows after every run, failing
   strict mode. Dose lookups now key on the order id this run created.
3. **`?selected=` is one-shot** (Pattern 34): the page reads it into state
   and strips it from the URL, so asserting the URL was a race the test
   lost. It now asserts the rail the nurse ends up looking at instead.
4. **The break-glass phrase appears twice**, in the persistent banner and in
   a toast, so the assertion is anchored on the banner, which outlives the
   toast.

`dose-queue.spec.ts` and `money.spec.ts` still mutate shared seeded state and
consume vaccine stock on every run.
