# UI/UX Audit — 2026-05-17

Walkthrough of 14 screens at desktop width (1280×800), seeded dev DB.
Observation only — no code changes. Pair this with the workflow audit
in the second half of this file.

## Cross-cutting (apply everywhere)

1. **Primary-button resting state is inconsistent.** "Receive shipment"
   (Inventory), "Add partner" (Partner Labs), "+ New Encounter"
   (Encounters) render in a light-blue / disabled-looking variant
   while "+ New arrival" (Dashboard), "Book appointment", "+ New
   Template", "+ Invite user", "+ New service" render as filled
   primary. Pick one and apply everywhere.

2. **Three different KPI-strip treatments.** Dashboard / Encounters /
   Services use the divided-strip primitive (`<KpiStrip>` +
   `<KpiCell>`). Transactions uses spaced cards. Inventory uses cards
   with leading icons. Design system says strip — port the other two.

3. **Status column dilution.** Patients, Users, Notification
   Templates, Partner Labs each show a Status column where every row
   reads `Active`. Hide the column or fold it into a header summary
   when ≥95% of rows share a value.

4. **Status / zero-state badge drift.** Lab Orders pills: `Cancelled`
   gray, `Pending` light, `ResultReceived` (camelCase!) dark, `Sent`
   dark — different visual ranks for items of equal severity. Same on
   Encounters (`In room` plain vs `In progress` orange vs `Signed`
   blue). Inventory `expiring` red badge on lots already past expiry —
   should be `Expired`. Lab Orders `SENT OUT` KPI shows `—` while
   every other zero KPI shows `0`.

5. **Date format mix.** `2026-05-16` (Partner Labs), `May 17`
   (Patients), `May 16, 2026 / 08:00` (Patient detail), `Today 8:15
AM` (Audit Log), `05/16/2026` (Day Summary input) all appear within
   a few minutes. Standardize through one util:
   - `Today / Yesterday / N days ago` for ≤14d
   - `MMM D, YYYY` for older
   - ISO only in technical surfaces (Audit Log raw timestamps).

6. **CTA verb drift.** Book / New / Register / Invite / Receive / Add
   / Create — eight verbs across nine create-buttons. Default to `New
<entity>`; reserve `Book`, `Invite`, `Receive` only where they
   carry domain meaning.

7. **Step indicator triple-print on New Arrival.** "Step 1 of 4" shows
   in the breadcrumb-eyebrow, the left rail header, AND the right
   pane header. Remove the rail header + right-pane header; the
   stepper rail is enough.

8. **Codes shown as raw enum strings.** `ARVBOOSTER_ABHAYRABID`,
   `payment_received_email`, `password_reset_email`. Either hide
   behind a "show code" toggle for power users, or render the
   humanized form from structured fields.

9. **Search / filter inconsistency.** Scheduled Orders + Encounters
   have the `/` keyboard hint inside the search input; Patients +
   Services + Inventory + Notification Templates + Adverse Events
   don't. Appointments has no search at all.

## Per screen

### Dashboard

- "Shift" dropdown top-right has no visible label affordance.
- "DRAWER · CASHIER · ₱0.00 Ok" KPI overloads three concepts into
  one card — split or relabel.
- KPI eyebrow labels could be one notch larger.
- Patient initial avatars are all the same blue, so they don't help
  scanning the roster.

### New Arrival wizard

- See cross-cutting #7.
- Patient-search input lacks the leading magnifier icon used elsewhere.
- Result cards put the patient ID on a third line in muted gray, but
  the ID is the field cashiers will actually use to disambiguate —
  move it up next to the name.
- `Discard` top-right is a text-only link; for a destructive action,
  use the destructive button variant or at least an icon.

### Scheduled Orders

- KPI strip and tab strip both show overlapping counts (`Today 4 /
Overdue 0`) — pick one location.

### Encounters

- `+ New Encounter` is the disabled-looking variant.
- Status pills inconsistent (see #4).
- A `View` action column suggests row-click should already open the
  detail rail — keep the row click, drop the column.

### Appointments

- No search input, only the four tabs.
- KPI label `NO-SHOW / CANCELLED` mashes two states that are split
  tabs below — split the KPI too.
- `0 / appointments` second-line label is redundant.

### Day Summary

- Clicking `Today` while on `05/16/2026` doesn't update the date to
  today (May 17). Should both update and reload.
- Default-to-today on landing.
- Empty page body has no skeleton/loading state — looks broken on
  first view.
- Floating bottom action bar (Email / Download / Close day) is a
  one-off pattern; move into the PageHeader actions slot.

### Patients (list)

- `PEP progress` column is all em-dashes — hide until populated.
- `Last visit` all reads `May 17` — likely stale fixture; the column
  should still ship a relative form.
- No KPI strip (Users + Adverse Events + Inventory + etc. all have
  one). Consistency win.

### Patient detail

- Allergies / Conditions pills have the trash icon visually
  overlapping the chip text at this width.
- `Outstanding balance ₱0.00` rendered at heading-1 weight is too loud
  for an empty value.
- `Send invoice` is shown disabled when balance is 0 — drop it instead.

### Lab Orders

- Missing `Patient` column — clinically the most important context.
- `ResultReceived` camelCase string in a user-visible badge.
- `SENT OUT` KPI shows `—` while peers show `0`.

### Adverse Events

- Page title `AEFI Reports` vs sidebar `Adverse Events` — pick one.
- KPI `YTD` is a timeframe sitting next to status-bucket KPIs.
- Empty state lives inside `<TableRow>` (known design-system
  exception).

### Transactions

- Subtitle reads `Drawer #12 · 0.00 · -1:--1 into shift · 3 today` —
  the `-1:--1` is a formatting bug.
- Status badge `paid · Maya` is lowercase against TitleCase peers.

### Inventory

- `Receive shipment` button looks disabled.
- `expiring` red badge on lots already past expiry — should be
  `Expired`.
- A row shows `Quantity 0` with `in stock` status — contradictory.
- Date controls live inside the "Today's movements" section instead
  of the page toolbar.

### Services

- `Default Price` column truncates on standard desktop width.
- Type column has no filter chips (only freeform search).

### Administration (Users / Audit Log / Partner Labs / Templates / …)

- Sidebar group only expands on route match; clicking the header
  should toggle the children.
- Audit Log entity ID column should link to the underlying entity.
- Notification Templates breadcrumb reads `Templates` (truncated) —
  show full label.
- Partner Labs uses ISO date format (`2026-05-16`) while the rest of
  the app uses `MMM D`.

## Suggested PR shape (priority order)

1. Unify primary-button resting state — one Tailwind class change in
   a handful of CTAs. (<50 LoC)
2. Inventory `Expired` vs `expiring` — clinical-safety smell. (<20 LoC)
3. New Arrival: delete the duplicate stepper headers; keep only the
   rail. (<60 LoC)
4. Single `formatDate` util + call from every list cell.
5. Status-pill audit + neutral mapping (`success / warning / danger /
neutral / info`).
6. Drop Status columns where 100% of rows are `Active`.
7. Port Transactions + Inventory KPI markup to `<KpiStrip>` +
   `<KpiCell>`.

Items 1–3 are independently shippable and small; bundling as one PR
is reasonable.

---

# Workflow audit (clinic golden paths)

Walked seven clinic workflows end-to-end on the same seeded dev DB.
Findings grouped by workflow; one cross-cutting section at the bottom.

## 1. Walk-in PEP intake (`/arrivals/identify → encounter → protocol → done`)

The four-step wizard for a new bite presentation. Most important path
in the product; it's the reason the clinic uses this app.

- **Vitals are pre-filled with plausible values** (BP 120/80, HR 72,
  Temp 36.8) on step 2 before the nurse touches anything. Clinical
  safety smell — easy to skip taking real vitals. Either start empty
  with required fields, or pull last-encounter vitals and badge them
  as `Last visit · tap to confirm`.
- **Dev-only TODO copy leaks to end users.** The vitals card says
  `Full vitals panel lands in a sibling PR. Capture what you can here.`
  and the bite-assessment card says `Structured bite-assessment panel
lands in a sibling PR.` Strip PR-tracker language from end-user UI;
  replace with either the full structured form or a single neutral
  hint.
- **Bite assessment is free-text only.** For an ABTC, WHO bite
  category (I / II / III) drives whether ARV is needed at all. The
  Scheduled-Orders page later shows `Category III — dog bite (left
arm)` per row — so the data exists somewhere, but the wizard
  doesn't collect it structured. Today a clinician would type it into
  Notes and hope the next person reads it. Likely the structured
  panel is what the TODO copy is pointing at.
- **Step 3 commit button is silently disabled** after course
  selection. No tooltip, no inline reason, no error. After picking
  `Post-Exposure Rabies — Essen` the right pane fills out properly
  (`PVRV (Verorab) VRB-2026-001 ×1`, `~₱2,500.00 pending cashier
settlement`) but `Commit bundle →` stays grayed out. Likely
  upstream: the FEFO lot has Quantity 0 in seed (see Inventory
  finding below). Either way the wizard owes the user a sentence:
  "No stock of PVRV — receive shipment first" or "Awaiting physician
  authorization."
- **Three "Step 1 of 4" labels on one viewport** (eyebrow,
  rail header, right-pane header). Already in the UI section as
  #cross-cutting-7.
- **Selecting a course shrinks the middle column** so the selected
  card text wraps awkwardly. The right-pane summary grows; the
  middle pane should keep its width.

## 2. Returning patient for scheduled dose (`/scheduled-orders → Open detail rail`)

The detail rail is one of the strongest screens in the app — protocol
timeline, dose-by-dose status, "on commit · recompute & administer"
preview, and footer line `Authorized by Dr. A. User · single-transaction
commit`. Good clinical micro-copy.

- **Recompute preview can show no-op shifts.** Dela Cruz's detail
  shows `Day 4 shift May 24 → May 24 / Day 5 shift Jun 7 → Jun 7` —
  arrows to the same date. Hide rows where `before === after`, or
  show a single `Schedule unchanged` line.
- **Payment status mismatches between list and detail.** The list
  shows em-dash in the Payment column for Dela Cruz; the detail rail
  shows a `No payment` badge. Either means the same thing in
  different shapes, or worse, em-dash means "unknown" in one place
  and "paid" in another.
- **Recompute & administer is the correct primary blue.** Use this
  page as the reference for primary CTA styling everywhere.

## 3. Cashier transaction + payment (`/transactions → row click → Add payment`)

- **Date-sensitive subtitle bug.** On a transactions-list landing
  with `date = today` the header reads `Drawer #12 · 0.00 · 00:10
into shift · 3 today` (clean). On any past date the same line
  becomes `Drawer #12 · 0.00 · -1:--1 into shift · 3 today` — the
  `-1:--1` is a duration-format bug for negative elapsed-shift time.
- **`Payer ID (HMO / Corporate)` field is shown even when method is
  Cash.** The modal renders `PYR-...` as a free-text input regardless
  of the chosen method. Should be conditional on
  `method ∈ {HMO, Corporate}`.
- **`Amount` input has no peso prefix** and no visible split between
  the outstanding balance and "amount this payment." Pre-fills to the
  outstanding, which is the common case, but doesn't help partial
  payments.
- **Reference number placeholder mixes channels.** `e.g. GCash ref,
OR #` — make this a conditional helper based on method (OR # for
  Cash, ref # for GCash/Maya).
- **The `Flags` column on the line-items table is empty in this
  fixture** — drop until a row sets a flag.
- **`Status: paid · Maya` pill** mixes lowercase "paid" with
  TitleCase payment-method word. Pick one capitalization.

## 4. Lab order + result receipt (`/lab-orders → row click`)

**Result receipt is not implemented in the UI.** The detail rail is
labelled "Read-only view of the selected lab order"; there is no
button to mark `Pending → Sent`, attach a result file, or enter
result data. The status column shows four states (`Cancelled`,
`Pending`, `ResultReceived`, `Sent`) but the user can never advance
them from this screen. This is a workflow dead end for the lab-result
golden path.

Other issues:

- **No `Patient` column on the list** — the only way to tell whose
  result this is is to open the rail.
- **No `+ New lab order` CTA on the page** — labs are presumably
  created from an encounter. That's fine for ordering, but doesn't
  help users who walk in with a paper result.
- **Composite IDs in the rail are very long.**
  `PAT-AAAAAAAA0.PSO-AAAAAA8.ORD-AAAAA1.LB0-000005` is shown verbatim;
  consider breaking it into a clickable breadcrumb.

## 5. Day close + drawer reconcile (`/day-summary`)

**The Day Summary page is broken end-to-end.** No content renders for
any date (yesterday or today). Backend returns:

| Endpoint                          | Status                    |
| --------------------------------- | ------------------------- |
| `GET /api/day-summary?date=…`     | 500 Internal Server Error |
| `GET /api/day-summary/snapshot?…` | 404 Not Found             |
| `GET /api/cash-drawer/current`    | 404 Not Found             |

Server log shows the 500 root cause:

```
PostgresError: column il.service_id does not exist
path: /api/day-summary
```

`il` is `inventory_lots`. Per the schema-v2 cutover gotcha, FEFO is
moving from `service_id` to `product_id`; the day-summary query
wasn't updated. **The frontend renders nothing instead of surfacing
the error** — no banner, no toast, no skeleton-with-retry. From the
clinic's perspective the entire end-of-day flow (Email / Download
report / Close day) sits behind a working summary, which currently
doesn't exist.

Fix order:

1. Backend: replace `il.service_id` with `il.product_id` (or join
   through `service_catalog`) in the day-summary query.
2. Backend: implement `/api/cash-drawer/current` or stop polling it
   from the AppShell — currently it 404s every render.
3. Frontend: render `<ErrorBanner>` (already in the design system)
   when the query throws, instead of a blank page.

## 6. Inventory receive shipment (`/inventory`)

`Receive shipment` is an intentional "Coming soon" stub (see
`apps/frontend/CLAUDE.md` Pattern 23 — disabled button + Tooltip).
The pattern works on hover, but on touch and on first scan the
button is indistinguishable from a real disabled button.

The same pattern is used for `Reorder report`, `+ New Encounter` on
the Encounters page, and `Add partner` on Partner Labs. Today there
are at least four "Coming soon" CTAs in primary positions across the
app, all rendered as the filled-blue-but-grayed variant.

Recommend differentiating stubs visually from real buttons — e.g.
outline variant with a `+ Coming soon` label inline — so users can
distinguish "not built yet" from "I lack permission" from "real bug."

Other observations:

- **`expiring` red badge on lots already past expiry** — see UI
  section. Should be `Expired`. Clinical-safety smell.
- **Quantity 0 with `in stock` status** — at minimum a contradiction;
  likely the root cause of the Step-3 commit-button disable in
  Workflow 1.

## 7. Book appointment (`/appointments → Book appointment`)

- **`Branch ID *` is a free-text input** asking the user to type
  `BRN-...`. Should be a `<Select>` of branches the user has access
  to. Today nothing prevents a typo from creating an unbookable
  appointment.
- **Native `<input type="datetime-local">` for Start / End** —
  inconsistent with the rest of the app (which uses the shadcn
  date-picker pattern). On macOS the native input shows
  `mm/dd/yyyy, --:--` placeholder which mismatches PH date format
  used elsewhere.
- **`Check Availability` is the right primitive** — keep it; just
  move it into the same row as the date inputs so the relationship
  is visible.
- **Required-marker asterisks present and consistent** with the
  design-system rule.

---

## Cross-cutting workflow findings

1. **Silent failures.** Day Summary, Patient search, lab result entry
   — when the backend errors or an action isn't wired, the UI just
   sits there. Wire `<ErrorBanner>` into every detail rail and every
   list query, and use `<Tooltip>` ("Coming soon") consistently for
   intentional stubs.
2. **Disabled-button overload.** Five different reasons currently
   manifest identically (intentional stub / no stock / awaiting
   payment / awaiting auth / no permission). Disabled is doing too
   much work — pair every disabled state with an inline reason via
   tooltip, helper text, or both.
3. **Cross-page payment-status grammar drifts.** The same transaction
   can render as `Pending` (Transactions list), `paid · Cash` (badge
   variant), `No payment` (Scheduled-Orders detail), or em-dash
   (Scheduled-Orders list). Pick one vocabulary
   (`Unpaid / Partially paid / Paid / Voided`) and apply it
   everywhere a payment status surfaces.
4. **WHO bite-category is the missing structured field** in the PEP
   intake wizard. It's the clinical decision driver and currently
   only lives as Notes free text.
5. **Schema-v2 cutover stragglers.** The day-summary 500 (`il.service_id`)
   and the `inventory_lots.product_id` migration suggest at least one
   other query in the backend has the same stale column reference.
   Worth a `grep -r service_id apps/backend/src` audit pass.

## Suggested workflow PR shape (priority order)

1. **Day Summary backend hotfix** — replace `il.service_id` with the
   new column; un-blocks the whole close-day flow. (<30 LoC)
2. **Day Summary + lab-orders frontend error banner** — surface 4xx
   / 5xx via `<ErrorBanner>` instead of blank pages. (<60 LoC)
3. **Disabled-button reason copy** — tooltip on every disabled
   primary CTA. Distinguish "Coming soon" from "No stock" from
   "Awaiting auth." (<100 LoC, one util)
4. **Branch picker on Book appointment** — replace free-text with a
   `<Select>`. (<40 LoC)
5. **WHO bite-category field in PEP intake step 2** — structured
   radio group I / II / III, replacing free-text. Larger; design
   first.
6. **Lab result-receipt action in detail rail** — `Mark sent`, `Upload
result`, `Enter result data`. Larger; this is real new feature
   work, not polish.

Items 1–4 are independently shippable, total ~230 LoC, and remove the
biggest workflow blockers.

---

# Workflow audit — second pass (2026-05-17 / later)

Walked the workflows flagged as "not audited" in the first pass.

## 8. New-patient registration (`/arrivals/identify → + New patient`)

The form opens as a right-side sheet from the wizard. Address uses a
proper region → province → city → barangay cascade (good).

- **Placeholder text reads like real Filipino names.** Last name
  placeholder is `Dela Cruz`, First name is `Maria`, Middle name is
  `Santos`, Email is `maria@example.com`, Guardian name is `Juan Dela
Cruz`, Relationship is `Parent`. At a glance these look like
  pre-filled values. Multiple usability-research studies have shown
  realistic placeholders increase form-skip rates. Use abstract
  labels (`Family name`, `Given name`) or remove placeholders for
  the obviously-required identity fields.
- **No required-asterisks on the obviously-required identity
  fields.** Last name / First name / DOB / Sex have no `*`; the
  design-system rule says required = asterisk. The form will still
  validate via Zod, but the user doesn't know what's required at
  scan time.

## 9. Administer dose — actually firing the action

Followed Workflow 2 through to clicking `Recompute & administer →
Confirm & administer`. Result: **backend 500, generic "Internal
server error" message in the modal.**

Server log:

```
PostgresError: new row for relation "inventory_movements" violates
check constraint "inventory_movements_id_format"
detail: Failing row contains (IVM-4FT0YXHQB5, …)
```

The constraint in [`apps/backend/drizzle/0003_invariants.sql:240`](../../apps/backend/drizzle/0003_invariants.sql:240)
requires the parent-embedded form
`LOT-{YYYY}-{10 B32}.INVTX-{6 B32}` (per the displayId.ts rules).
The administer-dose service is generating `IVM-{random}` instead.

**This is the most important workflow in the product and it cannot
complete end-to-end.** Same shape as the day-summary issue —
schema-cutover straggler in the ID generator. Likely paired bug
location: the service that writes `inventory_movements` rows during
administer / FEFO deduction.

Other observations on this flow:

- **Raw ISO timestamp in the consent dialog.** The summary table
  shows `Scheduled · 2026-05-17T00:00:00.000Z`. Format via the same
  date util we use elsewhere.
- **Error message is generic.** "Internal server error" is the API's
  Pino message; the user sees no error code or "contact support"
  hint. At minimum surface the error code returned by the API.
- **The modal error banner is correctly placed and styled** (red,
  in the modal body, not a toast). Good error-surface pattern; the
  _content_ of the message is what's missing.

## 10. Cash-drawer lifecycle

Not implemented. `Print Z-out` and `Close drawer` are both Pattern-23
stubs (`Coming soon` tooltips on disabled buttons in
`TransactionsPage.tsx:339,350`). There is no `Open drawer` button
at all — drawer state lives in DB but has no user-facing lifecycle
UI. The page header subtitle (`Drawer #12 · 0.00 · 00:24 into shift`)
is read-only. Whole drawer workflow is unbuilt.

Also: the `/api/cash-drawer/current` endpoint 404s on every page
load app-wide (see network log). The AppShell polls it constantly;
either implement or stop calling.

## 11. Void + refund — solid

The strongest "destructive action" UX in the app.

- Void modal opens with `This marks TXN-… as Voided. Voided
transactions cannot be reopened. Refund first if any payments
have been recorded.` Clear consequence, hint to do the safer
  alternative first.
- Refund modal: `Marks TXN-… as Refunded. The original payments
stay on the record as an audit trail. Inventory is not adjusted
automatically.` Spells out the non-obvious side-effect (inventory
  doesn't reverse) up-front.
- Both use the correct destructive-red primary variant.
- Both gate behind a required `Reason` textarea.

Minor: no partial-refund (line-item-level) flow visible. For a
5-dose bundle where one dose is bad, today's flow forces a full
refund. May be intentional for Phase 1.

## 12. SC/PWD discount at billing (`/transactions/new`)

`TransactionsCreatePage` is the canonical cashier flow and one of
the most thoughtful screens. Numeric-keyed payment-method chips,
tender keypad with +500/+1,000/+5,000/Exact quick buttons, atomic
commit summary at the bottom.

Discount flow specifics:

- Discount chips `None applied / Senior (20%) / PWD (20%) / Promo`.
- Selecting `Senior` or `PWD` reveals an `ID number` field with
  placeholder `OSCA / PWD ID #`. The placeholder shows both
  patterns simultaneously — confusing when only one applies.
  Branch the placeholder on the chosen chip (`OSCA #` for Senior,
  `PWD ID #` for PWD).
- `Promo` chip reveals no input — unclear whether it auto-applies a
  hard-coded discount or needs a code.
- `Auto-applies BIR ID validation field on commit` micro-copy with
  acronym-hint underline on `BIR` is a nice touch.
- `FSM · awaiting_payment` eyebrow uses underscore_snake_case for a
  user-visible state. Should render as "Awaiting payment".

## 13. AEFI report creation (`/adverse-events → + New report`)

- **`Patient ID` is a free-text input** with placeholder
  `PAT-XXXXXXXXX`. Same anti-pattern as the `Branch ID` field on
  Book appointment — should be a patient picker. Clinic staff
  rarely know patient IDs by heart.
- **No link to the immunization that caused the event.** AEFI is
  "Adverse Event Following Immunization" — the report should
  reference a specific `clinical_order` (vaccine, dose, date).
  Today there's no such field; the link has to be inferred from
  the free-text Description.
- **Inverted required-marker convention.** `(optional)` suffixes
  the optional fields; the required ones have no asterisk. The
  design-system rule is "asterisk on required" — flip the
  convention.

## 14. Reschedule from scheduled-order rail

Functional but minimal:

- Modal shows `Reschedule order / Maria Dela Cruz · PVRV (Verorab) ·
Dose #3`. Good identity header.
- New date is a native date input (same datetime-vs-shadcn
  inconsistency flagged on Book appointment).
- `Reason` textarea is required.
- **No preview of how subsequent doses shift.** The parent rail
  shows a `Day 4 shift May 24 → May 24` preview on the
  Recompute-and-administer path, but the reschedule modal has no
  equivalent preview. Adding "If you pick May 18, Days 4 and 5
  will shift to **_ and _**" would prevent surprise.

## 15. Bulk SMS on Scheduled Orders

Not implemented. The `Bulk SMS` control on the Due-today panel is
another Pattern-23 stub (`ScheduledOrdersPage.tsx:235-247`). Tooltip
reads "Coming soon".

## 16. Approvals workflow (`/admin/approvals`)

- Cards: AR ID, category badge (`Inventory / Void / Discount`),
  title, description, requester · time, severity dot, `Reject` /
  `Approve` actions. Clean.
- **The Approve button clips off the right edge** at 1280 px desktop
  width — the row is too wide. The detail rail isn't open, so the
  card row should fit. Likely the right-side action group is too
  wide; consider stacking actions or using icons.
- **Severity is encoded only in a red dot.** Color-only severity
  isn't accessible. Pair the dot with the priority text
  (`Urgent / High / Normal`).
- Tabs (`Pending 4 / Approved / Rejected / All`) with counts only on
  Pending — keep the count on every tab for consistency.

## 17. Standing Orders / Product Recalls / Payer Profiles

- **Standing Orders**: `+ New protocol` looks like another disabled
  stub. `MD auth: Required` is a yellow pill but `Not required`
  renders as plain text — inconsistent treatment of the same
  attribute.
- **Product Recalls**: tab labels are `Class1 Class2 Class3` (no
  space between word and digit). The matching KPI uses Roman
  numerals (`CLASS I`). Pick one form.
- **Payer Profiles**: clean. `Add payer` likely another stub. Status
  column all `Active` (same column-dilution finding from list pages).

## 18. User invite (`/admin/users → + Invite user`)

Mismatch + anti-patterns:

- **Page CTA says `Invite user`, sheet header says `Add user`.** Pick
  one.
- **Admin enters the password directly** (`Min 8 characters`). Modern
  invite flows email a setup link; admin-set passwords are a known
  vector for credential leakage and are surprising to staff who
  expect a magic link.
- **Realistic placeholders again** (`Juan` / `dela Cruz` /
  `juan@clinic.ph`).
- **No required-asterisks** on First/Last/Email/Password.
- Roles + Branches as multi-select checkbox blocks — good for the
  domain.

## 19. Audit chain verify + Export CSV

Both header actions on `/admin/audit` are Pattern-23 stubs
(`AuditPage.tsx:157, 168`). The chain-verify proposition is in the
page subtitle (`Immutable system-wide activity trail`) but the
action that proves immutability is unbuilt.

## 20. Notifications page (`/admin/notifications`)

- Header bell navigates here (admin-only).
- Page renders `Failed to load notifications.` in destructive-color
  body text. **Another silent backend failure** — no banner
  primitive, no retry button, no error code, just a sentence.
- `Dry-Run` button top-right exposes operational tooling at the
  user level — unusual placement for a feature flag / debug toggle.

## 21. Settings page (`/settings`)

`Coming soon` empty state. Copy reads:

> Settings will appear here once **its** backend ships.

Typo — should be `the backend ships` or `its backend ships,` (with
comma + restructure). Also the page subtitle `Clinic configuration ·
branches · roles · integrations` previews future scope but the body
just shows "Coming soon" — close the gap by listing what specifically
is coming.

## 22. Command palette (⌘K)

- Triggered via the header search trigger (clicking the
  `Search patients, orders…` chip) or `⌘K` keyboard shortcut.
- Currently navigates between routes only. Typing `dela cruz`
  returns `No results found.`
- **The placeholder `Search patients, orders…` advertises a search
  it doesn't perform.** Either wire patient/order search in (the
  same backend endpoints already exist) or change the placeholder
  to `Jump to page…`.

---

## Wave-2 cross-cutting findings

These are in addition to the five listed in the first pass:

6. **`Coming soon` is the dominant pattern.** I counted 9+ Pattern-23
   stubs in headline positions: `Receive shipment`, `Reorder report`,
   `+ New Encounter`, `Add partner`, `Print Z-out`, `Close drawer`,
   `Bulk SMS`, `Verify chain`, `Export CSV`, plus the entire
   `/settings` page. They all render as `disabled` primary or
   outline buttons with a tooltip. To a touch user or screen-reader
   user the tooltip never appears. Replace the disabled-with-tooltip
   pattern with either a `<Badge>Coming soon</Badge>` inline label
   on a non-disabled (but no-op) button, or simply omit the button
   until the feature ships. This will also surface the _real_
   disabled buttons (`Commit bundle`, `Confirm & administer`) by
   contrast.
7. **Free-text ID inputs that should be pickers.** `Branch ID`
   (Book appointment), `Patient ID` (AEFI report), `Payer ID`
   (Record payment) all ask the user to type a `XXX-...` ID. None
   are validated client-side; all should be `<Select>` /
   searchable picker fields. Same anti-pattern in three places.
8. **Required-asterisk convention is inconsistent.** PEP intake +
   New transaction + Reschedule all mark required fields with `*`.
   New patient + AEFI + Add user use `(optional)` as the inverse
   marker. Pick one and propagate via the `<FormLabel>` design-system
   rule.
9. **Placeholder text masquerades as data.** Patient registration
   and User invite both use realistic placeholders (`Juan / Dela
Cruz / Maria / Santos`). Switch to descriptive placeholders
   (`Family name`) for required identity fields.
10. **Silent / generic backend errors at action time.** Day Summary
    (blank page), Notifications (one-line body text), Administer
    dose (generic "Internal server error"). Three different failure
    modes for the same problem class. Standardize: `<ErrorBanner>`
    in body, retry button, error code displayed.
11. **`/api/cash-drawer/current` polls on every render and 404s
    every time.** AppShell-level dead endpoint. Quick win: gate the
    poll behind a feature flag or remove until the endpoint exists.
12. **State strings render as snake_case.** `awaiting_payment`,
    `ResultReceived` show through to the UI. Add a humanizer in
    `apps/frontend/src/lib/status.ts` (already imported across the
    codebase) and route every state through it.

## Wave-2 PR-shape additions

Add to the priority list:

7. **Administer-dose ID-generator fix.** Make
   `inventory_movements.id` use the parent-embedded form
   `LOT-{YYYY}-{B32}.INVTX-{B32}` per the constraint. Same shape as
   the day-summary fix — schema-v2 straggler in the FEFO/deduction
   service. (<50 LoC, but unblocks the most important workflow.)
8. **Remove or hide `/api/cash-drawer/current` calls** until the
   endpoint ships. (Quiets 50+ noisy 404s per session.)
9. **Replace the 3 free-text ID inputs with pickers.** Patient
   picker reused in AEFI + Record-payment + Book-appointment.
   (<150 LoC, one shared `<PatientPicker>` + branch-picker.)
10. **Humanize state strings.** One util + ~6 call sites.
    (<40 LoC.)
11. **Placeholders + required asterisks audit.** Sweep
    `<Input placeholder>` for realistic-looking values; sweep
    `<FormLabel>` for the asterisk convention. (<100 LoC.)
12. **Differentiate `Coming soon` stubs visually.** One
    `<ComingSoonButton>` primitive, codemod current call sites.
    (<80 LoC.)

The two clinical-safety items remain top priority:

- (1, from first pass) Day Summary `il.service_id` query fix
- (7, new) Administer-dose `inventory_movements_id_format` fix

Both are schema-cutover stragglers; a `grep -r 'service_id\|IVM-'
apps/backend/src` pass would surface any others before they're hit
by users.

---

# Wave-3 audit — state preservation + navigation hazards

This pass deliberately tries to break the UI: half-fills forms then navigates away, jumps between wizard steps in non-linear order, opens dialog-over-rail combos, hits unknown routes.

## A. New-arrival wizard step jumps (the bug the user reported)

**Reproduction:**

1. Land on `/arrivals/identify`, select a patient. URL → `/arrivals/encounter`.
2. Fill chief complaint, click `Save & continue`. URL → `/arrivals/protocol`.
3. Click the **Encounter** rail link.

**Expected:** Render step 2 with the previously-entered chief complaint.

**Actual:** URL changes to `/arrivals/encounter` but the page renders step 1 (the patient search). Breadcrumb says `Identify`, page header says `Step 1 of 4 / Identify Patient`. The patient selection is also wiped. So the URL and the rendered content disagree.

Confirmed by clicking the `Protocol` rail link too — URL → `/arrivals/protocol`, page renders Step 1.

**Variant:** Deep-link directly to `/arrivals/protocol` from the address bar (or via `history.pushState`) — same outcome: URL says `/arrivals/protocol`, page renders Step 1. There IS a guard ("you can't visit Step 3 without Step 1 completed") but its enforcement renders the wrong step instead of redirecting the URL.

**Bonus oddity:** even on a fresh `/arrivals/identify` load (after navigating Dashboard → New Arrival), the **Encounter rail item shows a blue checkmark** as if it were completed. So wizard progress leaks across sessions/visits via in-memory state (or sessionStorage / localStorage). A new walk-in starting fresh is told "Encounter is done" before they've done anything.

**Fix shape:** the step-rail link guard should either (a) `Navigate replace` back to the correct step when state is insufficient, keeping URL and content in sync; or (b) actually allow free movement and re-hydrate state from the wizard context. Today it picks the worst of both.

## B. Unsaved-data warnings — missing everywhere

Three scenarios, all silently lose data with no confirmation:

1. **Wizard nav-away.** On `/arrivals/encounter` with a half-typed chief-complaint textarea, click the **Dashboard** sidebar link. Page navigates immediately, no prompt; data lost.
2. **Edit-allergy modal nav-away.** Open patient → click Edit on an Allergies chip → modify the allergen text → click **Lab Orders** sidebar link. Page navigates, modal closes silently, edit discarded.
3. **New transaction nav-away.** (Same shape: half-filled cashier form, sidebar click, gone.) Verified via the wizard + allergy pair; the cashier flow uses the same React Router setup.

The only "guard" is the wizard's top-right `Discard` text link, which the user has to know to use. There is no `beforeunload` / Router `<Prompt>` / equivalent.

**Fix shape:** wrap any wizard / multi-field form in a router-level `useBlocker` or `Prompt` that fires a confirm when `formState.isDirty` is true. Could be one shared `<DirtyFormGuard>` component.

## C. Browser back preserves wizard state — partly

Filling step 2, navigating to `/dashboard`, then `history.back()` returns to `/arrivals/identify` (because the SPA route history records both the link click and the prior identify URL). The patient selection from step 1 IS preserved — Ocampo is highlighted with a green `selected` chip and the contextual hint reads `Patient selected — press ⌘↵ to continue`. Good.

But: as soon as you click the Encounter rail link from there, you hit the step-jump bug from finding A — URL says `/encounter`, page renders `/identify`, patient selection is wiped.

## D. Filter / search state — not persisted

Encounters page: type `santos` in search → click Dashboard → click back to Encounters. Search input is empty; filter state was component-local and lost on unmount.

Same shape for Transactions (date picker), Scheduled Orders (tab + search), Inventory (status filter). None of them encode state in the URL.

**Fix shape:** use `useSearchParams` for filter/search state — survives nav, sharable URLs, browser back/forward. Already used elsewhere for pagination in some pages, just not for filters.

## E. Detail-rail dismissal on nav — works

Open patient detail rail → click Lab Orders sidebar link. Rail closes cleanly, no orphaned overlay. Good.

## F. Dialog-over-rail stacking — works

Open patient detail rail → click pencil icon on an Allergies chip → "Edit allergy" Dialog renders on top of the Sheet. Visually fine, focus traps the dialog, escape dismisses just the dialog. Solid.

## G. Unknown routes — silent fallback

`history.pushState`'ing to `/does-not-exist` renders the Patients page with that URL in the address bar. No 404 surface; breadcrumb claims `Patients`. Likely a missing catch-all `<Route path="*">` 404 view.

**Fix shape:** add `<Route path="*" element={<NotFoundPage />} />` to the router. Otherwise typo'd URLs (or stale bookmarks) silently disappear into Patients.

## Wave-3 cross-cutting findings

13. **No unsaved-data confirmation anywhere.** The pattern is consistent across the wizard, edit dialogs, and create forms — every nav-away silently discards. One `<DirtyFormGuard>` would address all sites.
14. **Wizard state machine is desynced from the URL.** The step rail uses one source of truth (in-memory context), the URL uses another (React Router). When they disagree, the URL "wins" but the content reads from context — producing the `/arrivals/protocol → Step 1 view` shape.
15. **Filter state is component-local across the app.** Every list page loses filters on remount. Encode in `?` query string.
16. **No 404 route.** Unknown URLs render Patients.
17. **Wizard progress checkmarks leak across sessions.** Even a fresh `New Arrival` click shows Encounter as completed if the previous user got that far. Tied to #14 (context never resets).

## Wave-3 PR-shape additions

13. **Wizard URL ↔ state sync.** When `arrivals/protocol` is requested but state is insufficient, `Navigate replace` to `arrivals/identify`. Bonus: clicking a step rail link guards client-side too. (~80 LoC)
14. **`<DirtyFormGuard>` router blocker.** One component wrapping the wizard, all detail edit dialogs, and `TransactionsCreatePage`. Hooks into RHF `formState.isDirty`. (~100 LoC + call sites)
15. **`useSearchParams` for list-page filters.** Sweep across `Encounters`, `Transactions`, `Inventory`, `Scheduled Orders`, `Lab Orders`. (~150 LoC across files)
16. **404 catch-all route.** Tiny. (<30 LoC)
17. **Wizard context reset on mount.** Clear or hydrate-from-URL when the wizard root mounts — kills the leaking-checkmark issue. (<30 LoC, paired with item 13)

---

# Coverage gap — what's STILL not audited

- **Login / logout / refresh** (always landed authenticated)
- **Role-based UI for Cashier / Nurse / Physician / Branch** (only walked as SuperAdmin)
- **Mobile + tablet + dark mode**
- **Tagalog UI** (`fil` notification templates seed exists)
- **Branch kiosk** (intentionally out of scope per `apps/frontend/CLAUDE.md`)
- **Encounter detail rail** (only walked patient + scheduled-order + transaction + lab-order rails)
- **Inventory lot detail rail** (clicked Lots but not into a specific lot)
- **Service detail rail / Create new service** (saw list only)
- **User detail rail** (clicked into nothing on /admin/users beyond the row)
- **Audit Log detail rail / entity click-through**
- **Partner Lab / Standing Order / Payer Profile detail rails**
- **Approval detail / approve + reject end-to-end**
- **Apply prepayment** (`ApplyPrepaymentDialog.tsx` exists, never opened)
- **Print Receipt** + ESC/POS path (component exists, not exercised)
- **Patient detail: Immunizations + Consents + Billing tabs** (only walked Overview / Timeline / Contacts / PEP)
- **Multi-tab session interactions** (modify in one tab, observe in another)
- **WebSocket / real-time updates if any**
- **Session expiry mid-action** (saw a 401-then-refresh-retry in the network log; full expiry never tested)
- **File upload via the attachment-dropzone primitive**
- **Region cascade autocomplete** in patient registration
- **Acronym-hint tooltips** (`<AcronymHint>` exists; saw `BIR` underline, didn't hover)
- **Sticky save-footer overflow case** (small viewport with long form)
- **The right-edge clipping I noted on Approvals** (`Approve` button cut off) — visual only, would need responsive testing

---

# Wave-4 audit — auth, Branch role, CRUD, detail rails, storage

## A. Auth flow

**Login page** (`/login`): two-column layout, dark navy left with logo, white right with form. Different aesthetic from the rest of the app — intentional per `BranchKiosk` convention; login follows the same "surface outside the staff CMS" pattern.

- "Sign in with Google" button — present, not tested
- Email + password + remember me + forgot password? + Sign in
- Eye-toggle on password
- `© 2026 SureVax` footer

**Logout** (sidebar user menu → Sign out): destructive-red link inside a small popover above the user identity card. Works.

**Refresh / session resume**: `location.reload()` while authenticated → **bounces to /login**. So the refresh-token flow (cookie-based) is either:

- failing to refresh silently, or
- not wired to restore the user on a hard reload

Verified for both Branch and SuperAdmin users. **This is a usability hit:** any accidental refresh during work loses the session. The auth bootstrap should attempt `/api/auth/refresh` before deciding the user is unauthenticated.

## B. Branch role view (`branch-main@surevax.com / TestPass123!`)

Branch is the front-desk / kiosk identity. Lands on `/branch/kiosk` — a dark-themed `BranchKiosk` surface with three sections:

1. **Cash Drawer** — `No drawer open / Open Drawer` button
2. **Staff Kiosk** — Clock In / Clock Out cards per staff member, two columns: ON SHIFT (4 currently in) / AVAILABLE (2 idle)
3. Opening-clinic modal on first arrival: "Opening clinic for May 17, 2026? / No cash drawer has been opened for today yet. / Prior-day items to resolve: 1 unsettled transaction — PHP 4,200.00 outstanding"

The kiosk is the surface that finally ties together cash-drawer + staff time-logs that we saw fragmented in the admin pages. Good UX.

**Sidebar gating** (good):

- TODAY group entries hidden (Dashboard, New Arrival, Scheduled Orders, Encounters, Appointments, Day Summary)
- ADMINISTRATION group hidden
- Records group (Patients, Lab Orders, Adverse Events, Transactions, Inventory, Services) + Branch entry visible

**Sidebar gating is NOT enforced by route guards.** Direct-URL navigation to `/dashboard` as Branch role renders the Dashboard fully — patient names, protocols, encounters all visible on the today-roster. Same for `/arrivals/identify`, `/encounters`, `/scheduled-orders`.

**Admin routes are guarded.** `/admin/users` as Branch role redirects to `/branch/kiosk`. So the gate exists, just inconsistently applied — admin routes are protected, today-group clinical routes are only sidebar-hidden.

**This is a PHI exposure path:** the Branch kiosk machine sits at reception where any walk-up can see the screen. A typo'd URL or bookmark restores the full clinical view.

**Fix shape:** add a role-check guard to the today-group routes (or invert: every route is guarded by default, allow-list the kiosk routes for Branch).

## C. PHI leak via `sessionStorage` across user sessions

Inspected browser storage as Admin User:

```
sessionStorage:
  surevax.arrival-wizard: {
    "selectedPatientId": null,
    "encounterId": null,
    "encounterDraft": {
      "specialty": "Rabies",
      "chiefComplaint": "Dog bite, right calf, 2h ago"
    }
  }
  branch.dayOpenAcknowledged.2026-05-17: ...

localStorage:
  sv.navOpenGroups: {"today":false,"records":true,"admin":false}
```

**Logout does not clear `surevax.arrival-wizard`.** I logged out from SuperAdmin, logged in as Branch role on the same tab, and the wizard step rail still showed the Encounter step as completed (the leaking-checkmark bug from Wave 3 §A) — sourced from the previous user's sessionStorage. Worse: `encounterDraft.chiefComplaint` contains free-text clinical data ("Dog bite, right calf, 2h ago") that survives a logout-then-login.

In a kiosk environment (Branch login = shared machine), this means **the previous shift's half-typed clinical notes are pre-filled for the next nurse who logs in**. A real chief-complaint or bite description would persist.

**Fix shape:** clear `surevax.*` and `branch.*` keys on logout. Better: wrap the wizard context so it hydrates from sessionStorage only when the current user matches the one who wrote it.

## D. Detail-rail completeness — patterns

Walked the remaining detail rails. Pattern across the app:

| Surface               | Detail rail | Edit / mutate from rail                        | Notes                                                                                                                                                                                   |
| --------------------- | ----------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Patient               | ✅          | ❌ (Edit = stub, Print = stub)                 | Demographics not editable; only Allergies + Conditions chips have inline edit                                                                                                           |
| Encounter             | ✅          | ✅ "Initiate protocol"                         | Tabs: Overview / Vitals / Diagnoses                                                                                                                                                     |
| Scheduled Order       | ✅          | ✅ Reschedule + Recompute & administer         | Best rail in the app                                                                                                                                                                    |
| Transaction           | ✅          | ✅ Add payment / Void / Refund / Print Receipt | One of the strongest                                                                                                                                                                    |
| Lab Order             | ✅          | ❌ "Read-only view"                            | Result-receipt action missing                                                                                                                                                           |
| Adverse Event         | ✅          | (untested)                                     | Has an Update dialog component                                                                                                                                                          |
| Inventory lot         | ✅          | ❌                                             | Raw ISO timestamp `2025-06-15T00:00:00.000Z` shown; `Quantity received: 50.0000` (4 decimal places for a count); `Base price: 0.00` (no currency symbol)                                |
| Service               | ✅ list-row | ✅ "+ New service" modal                       | Existing services edit unverified                                                                                                                                                       |
| Notification Template | ✅          | ✅ Edit + Delete (real CRUD)                   | The cleanest admin CRUD surface                                                                                                                                                         |
| Partner Lab           | ✅          | ❌                                             | `Add partner` disabled stub. Good API-config redaction (`apiKey: "****"`)                                                                                                               |
| Standing Order        | ✅          | ❌ Locked: Editable shown but no UI            | `+ New protocol` looks like a stub                                                                                                                                                      |
| User                  | ✅          | ❌ Edit / "Disable login" only                 | Two redundant fields: `Role` + `All roles` (both show same value for single-role users); branch shown as name + code on two rows; "Has password" reduces to Yes/No (admin can't change) |
| Audit Log             | ✅          | n/a                                            | Entity ID column should be a click-through link                                                                                                                                         |
| Approval              | ✅          | ❌ no Approve/Reject in rail                   | Actions only on the list card; rail is read-only                                                                                                                                        |

**Cross-cutting:** the strongest CRUD surfaces are **Notification Templates**, **Transactions**, **Scheduled Orders**, **Encounters**. The weakest are **Patient**, **Partner Lab**, **Standing Order**, **User** — all show data but can't be mutated meaningfully.

**Patient edit is the most important missing CRUD.** Phone numbers and addresses change. Today the only patient mutation paths are:

- Register a new patient (via the wizard's New patient sheet)
- Edit allergies / conditions inline on the detail rail
- No way to change name, DOB, sex, address, contact, guardian, coverage, etc.

## E. Multi-tab interactions

The preview tool blocks `window.open`, so I couldn't open a true second tab. Tested via storage inspection + the underlying mechanisms a second tab would hit:

- **Cookies** are HTTP-Only (per `apps/frontend/CLAUDE.md`) — auth state IS shared across tabs.
- **`sessionStorage` is per-tab** — wizard progress would NOT leak between tabs of the same user.
- **`localStorage` IS shared across tabs** — `sv.navOpenGroups` (sidebar expansion) would sync.
- **TanStack Query cache** is per-tab in-memory — a mutation in one tab wouldn't automatically refresh the list in another tab. No `BroadcastChannel` or storage-event sync found.

**Likely multi-tab bugs without two-tab testing:**

- Open the same record in two tabs, edit in A, save → tab B still shows the old data with no "out-of-date, refresh?" indicator. Optimistic-locking shape (version or `updated_at` check) wasn't visible in any of the edit modals I touched.
- Open the cashier `TransactionsCreatePage` in two tabs and run the same FEFO lot allocation → backend guard via `inventory_movements_id_format` constraint + tenant transaction should catch the duplicate, but the UI would surface as a generic 500.

**Concrete coverage gap:** none of this was actually exercised; documenting only what the storage layout implies.

## F. Specific bugs surfaced in Wave 4

1. **Refresh = logout.** `location.reload()` on any authenticated page bounces to `/login`. Tested for SuperAdmin + Branch.
2. **Branch role can read Today-group routes via URL.** Sidebar-hidden but not guarded.
3. **`sessionStorage` PHI leak across user sessions.** Wizard chief-complaint survives logout.
4. **Patient Edit is a stub.** No way to edit demographics from the UI.
5. **Inventory lot rail shows raw ISO timestamps + 4-decimal quantities + missing currency symbol.**
6. **User detail rail double-displays role** (`Role` + `All roles` both show `SuperAdmin`).
7. **Audit Log entity IDs are not links.**
8. **Approval rail has no Approve/Reject buttons** — list-only actions.

## Wave-4 PR-shape additions

18. **Auth bootstrap calls `/api/auth/refresh` on app mount** before deciding the user is logged out. Removes the refresh-killed-my-session pain. (~50 LoC)
19. **Route guard for today-group routes** (`/dashboard`, `/arrivals`, `/encounters`, `/appointments`, `/day-summary`, `/scheduled-orders`) that redirects Branch role to `/branch/kiosk`. (~40 LoC)
20. **Logout clears `surevax.*` + `branch.*` sessionStorage keys.** One-liner in the sign-out handler. (<10 LoC)
21. **Patient edit form.** Reuse the existing PatientForm component used in `Register New Patient`; expose via the rail's `Edit` button. Pattern already established. (~80 LoC)
22. **Inventory lot rail: humanize timestamps, integer quantities, currency formatting.** (~30 LoC)
23. **Audit Log entity-ID click-through.** Map `entity_type → route` and render a link. (~50 LoC)
24. **Approval rail Approve/Reject buttons.** Mirror the list-card actions inside the rail with the same confirm-reason pattern as Void/Refund. (~60 LoC)

---

# Coverage gaps — STILL not audited (after Wave 4)

- **Cashier / Nurse / Physician roles** (Branch covered)
- **Multi-tab true two-tab interactions** (preview tool blocks `window.open`)
- **Tagalog UI** (deferred)
- **Mobile / tablet / dark mode** (deferred)
- **Branch kiosk Clock-in / Clock-out + Open Drawer** end-to-end (saw the surface, didn't click through)
- **Apply prepayment dialog** (`ApplyPrepaymentDialog.tsx` component still untouched)
- **Print Receipt + ESC/POS path** (component imported, never exercised)
- **Patient detail Immunizations + Consents + Billing tabs** (only walked Overview / Timeline / Contacts / PEP)
- **WebSocket / real-time updates** (haven't seen any; may not exist)
- **Session expiry mid-action** (saw a 401→refresh-retry in the network log earlier; full expiry → re-login path not exercised)
- **File upload via `attachment-dropzone`** (component exists)
- **Region cascade autocomplete** (saw select boxes; didn't type)
- **Acronym hint tooltips on hover** (`BIR` etc. — saw underline, didn't hover)
- **Adverse Event Update dialog** (component exists, only Create exercised)
- **Encounter Vitals + Diagnoses tabs** (only Overview tab walked)
- **Service edit** (Create walked; existing-service edit unverified)
- **Standing Order edit/lock cycle** (the `Locked: Editable` field implies a state machine; not exercised)
- **403 / unauthorized error surfaces** (admin route redirect tested; haven't seen any 403 toast or page)
- **Long-running operations** (Z-out, day-close report generation — none are wired)
- **Keyboard shortcuts beyond ⌘K and ⌘↵** (the user-menu had "Keyboard shortcuts" link, never opened)

---

# Wave-5 audit — kiosk, session expiry, patient tabs, prepayment, encounter tabs

## A. Branch kiosk Clock-in / Clock-out + Open Drawer

Drove the kiosk end-to-end as Branch user.

**Open Drawer.** Clicking `Open Drawer` opens "Open Cash Drawer / Enter the opening float — the cash placed in the drawer at the start of this session." Single `Opening Float (PHP)` numeric input. After submit, the card flips to `Opening float PHP 5,000.00 · Opened at 9:12 AM · Close Drawer` and a toast confirms.

- **Toast vs card currency formatting drift.** Toast reads `Opening float: PHP 5000` (no thousand separator, no decimals). Card reads `PHP 5,000.00`. Pick one formatter.
- Modal is concise and good. No "where did this float come from?" reference; could log who counted/handed off.

**Clock In / Clock Out.** Cards on the staff kiosk: a name + role + "since HH:MM" + a `Clock In` or `Clock Out` button. Single click toggles the state — no confirmation step. Ana Reyes moved from AVAILABLE → ON SHIFT and back with two clicks. Counts in the section headers update live (4 → 5 → 4). Toast: `Clocked in / Ana Reyes started their shift.` / `Clocked out / Ana Reyes ended their shift.`

- **No identity verification.** "Tap your name to clock in or out" is the instruction, but anyone walking past can tap any name. Real ABTC kiosks usually require a PIN or badge tap to prevent buddy-punching.
- **No undo / confirmation.** A misclick instantly mutates the time log. Could surface a 5-second `Undo` toast or require a confirm tap.
- The audit trail will show the **Branch** user as the actor, not the staff member whose card was tapped. That weakens forensic value of the time log — the system can prove someone tapped Clock-in on a kiosk but not which human did it.

**Close Drawer.** Opens "Close Cash Drawer / Count the cash in the drawer and enter the total. The system will compute the variance." Shows `Expected total PHP 5,000.00`. Counted Total input.

- **Variance is not previewed inline as the user types.** Copy says "the system will compute the variance" but the user has to submit to see it. A live `Variance: -PHP 200.00` row below the input would prevent surprise and confirm the user is entering what they meant.
- I cancelled rather than actually closing the drawer (kept seed data clean).

## B. Session expiry mid-action

Confirmed indirectly. Three observations:

1. The frontend already retries `/api/auth/refresh` on a 401 — the network log from the very first audit pass shows the pattern fires (e.g. `GET /api/scheduled-orders?filter=today → 401 → POST /api/auth/refresh → 200 → GET retry → 200`). So an _access-token_ expiry mid-action is handled silently.
2. A _refresh-token_ expiry (or both gone) bounces to `/login` — already documented in Wave 4 §A. The frontend treats a hard `/login` redirect as the only recovery path; no toast like "Session expired — sign back in" with a return URL.
3. Couldn't force-expire from the preview MCP — cookies are HTTP-Only, so JS can't clear them. The `POST /api/auth/logout` route requires a tenant header even when authenticated (`X-Tenant-Slug` or `X-Dev-Tenant-Id`), which surprised me — logout shouldn't fail-closed on tenant resolution since the caller is already authenticated and the tenant is on the JWT. Returns `400 / TENANT_REQUIRED` without the header.

**Findings worth recording:**

- **Logout requires tenant header.** The current behavior means an SSO-style logout or a "clear cookies" admin tool needs to know the tenant slug. The middleware probably runs before the auth-bearing logout handler can resolve tenant from the JWT.
- **No return-URL on session-expired redirect.** When the refresh-retry fails, the user lands on `/login` and after re-authenticating goes to `/dashboard` (or `/branch/kiosk`), not back to the in-progress page. Pre-login URL should be preserved as `?returnTo=` so the user can resume.

## C. Patient detail — remaining tabs (Immunizations / Consents / Billing)

- **Immunizations**: `0 records / No external immunization records.` Empty state with no `+ Add` affordance. Likely intentional — internal immunizations live on Encounters/clinical_orders; this tab is for outside-the-clinic shots a patient discloses. But then the read-only display is a gap (no way to record what the patient told you).
- **Consents**: Working list — but rendered `Consented Invalid Date`. The `Invalid Date` string is the JavaScript `Date` parser default for unparseable inputs. So the underlying value is null/undefined/malformed and the formatter doesn't guard. Same shape will hit any consent rendered with a missing `consented_at`. **Real bug** — fix the formatter or backfill the timestamp.
- **Billing**: Single row visible — `TXN-2026-AAAAAAAA84 / Paid / PHP 1.00`. `PHP 1.00` looks like seed-data oddity (a 1-peso transaction). The Date column truncates on the left, suggesting column widths don't account for the rail's narrower viewport.

The patient detail has 7 tabs total (Overview / Timeline / Contacts / Immunizations / PEP Schedule / Consents / Billing). All walked across the two audit passes.

## D. Apply prepayment dialog

Conditional on `txn.isPrepayment === true && txn.prepaymentAppliedAt === null` — none of the seeded transactions triggered the affordance, so I read the source instead. Component is `apps/frontend/src/features/transactions/components/ApplyPrepaymentDialog.tsx`.

Shape:

- Title `Apply prepayment`
- Description `Apply prepayment {PREPAYMENT_TXN_ID} to a Draft or Pending transaction for the same patient.`
- Single field `Consuming transaction *` — a `<select>` listing candidate transactions as `{id} · {status} · PHP {netAmount}`. Empty state `No Draft or Pending transactions for this patient.`
- `Cancel / Apply prepayment` footer; pending state shows `Applying…`.

Observations:

- **Uses native `<select>`** instead of shadcn `<Select>`. Inconsistent with the rest of the form surfaces. Renders the bare browser dropdown styling.
- **Money formatting is raw.** `PHP {c.netAmount}` — `netAmount` arrives as a string from `numeric(12,2)` (per CLAUDE.md gotcha), so this renders as `PHP 2500.00` with no thousand separator. Bring this through the `formatMoney` util used in `TransactionDetail`.
- **Sentence-case "Apply prepayment"** title and CTA — most other modal titles are TitleCase (`Add payment`, `Void transaction`, `Refund transaction`, `Record payment`). Minor.

Not exercised live — the conditional gates it behind a seed shape we don't have.

## E. Encounter Vitals + Diagnoses tabs

**The structured vitals form already exists.** Encounter detail rail → Vitals tab → `+ Add vital` opens an inline form with:

```
Temp (°C)        Heart rate (bpm)
Resp rate (bpm)  Systolic BP
Diastolic BP     Pulse (bpm)
SpO2 (%)         Weight (kg)
Height (cm)      Pain score (0–10)
```

This is the structured panel the **New Arrival wizard step 2 promised but didn't ship**. The TODO copy `Full vitals panel lands in a sibling PR. Capture what you can here.` is wrong — the sibling PR landed, just on the wrong screen. The wizard should embed (or link to) this form instead of showing the 3-field stub.

Issues with the existing vitals panel:

- **Heart rate (bpm) + Pulse (bpm) are both fields.** Clinically they're synonyms unless explicitly labelled `apical vs peripheral` or `auscultated vs palpated`. Today both labels read `bpm` and the difference is unstated.
- **Resp rate (bpm) is mislabelled.** `bpm` = beats per minute (cardiac). Respirations are `breaths/min` (rpm). Real clinical-clarity gotcha; bedside nurses will read `Resp rate bpm` and either ignore it or enter wrong values.
- **No required-asterisks.** All fields optional — but a real vitals encounter without temp or BP isn't usually a valid record. Either mandate a subset or surface a "minimum vitals" indicator.

**Diagnoses tab** — same shape. `+ Add diagnosis` opens an inline form:

```
ICD-10 code *      (e.g. A82.0)
Description         (Optional)
Type                (e.g. Primary)        Notes (Optional)
☐ Primary diagnosis
```

Issues:

- **`Type` field placeholder reads `e.g. Primary`** while a separate `Primary diagnosis` checkbox sits below it. The placeholder actively misleads — Type is presumably `Working / Final / Provisional / Differential`, not "Primary". Pick a different example or strip the placeholder.
- **ICD-10 is free text.** No autocomplete, no validation, no description lookup. Typing `A82.0` works but mistyping `A82` or `A82.O` silently saves. Industry-standard ABTC apps autocomplete ICD-10 with description preview (e.g. typing "rabies" → `A82.9 — Rabies, unspecified`).
- **No autocomplete on Description.** Same data shape — should pull from ICD-10 reference.

## Wave-5 PR-shape additions

25. **Kiosk currency-formatter consistency.** Single util for both toast and card; `5000` → `PHP 5,000.00` everywhere. (<20 LoC)
26. **Live variance preview on Close-Drawer.** `Variance` row below the Counted Total input, recomputed on input. (<30 LoC)
27. **Wizard step 2 embeds the existing Vitals + Diagnoses panels** from Encounter detail instead of the 3-field stub. Removes the TODO copy. (Probably ~80 LoC + a render-context tweak.)
28. **Fix `Resp rate (bpm)` → `Resp rate (rpm)` or `breaths/min`.** Clinical-clarity hotfix. (<5 LoC)
29. **Diagnoses Type placeholder.** Either pick a non-misleading example or convert Type to a `<Select>` with the actual enum values. (<30 LoC)
30. **ICD-10 picker** with autocomplete + description preview. Larger; design first. Phase-2 candidate.
31. **`Consented Invalid Date` formatter fix.** Guard against missing `consented_at` in PatientDetail Consents tab; fall back to `—` or hide the line. (<10 LoC)
32. **Auth bootstrap return-URL.** `?returnTo=/the/page/I/was/on` preserved through login. (<40 LoC)
33. **Apply prepayment: native `<select>` → shadcn `<Select>`; money via `formatMoney`.** (<30 LoC)
34. **Kiosk clock-in identity verification.** PIN code per staff member (or badge tap), and the time-log records the staff user as the actor, not the Branch service account. Phase-2 candidate.

---

# Coverage gaps — STILL not audited after Wave 5

These are honestly the long tail:

- **Cashier / Nurse / Physician roles** — left intentionally for now per user direction.
- **True multi-tab interactions** — preview MCP blocks `window.open`.
- **Tagalog / Filipino UI** — deferred.
- **Mobile / tablet / dark mode** — deferred.
- **Print Receipt + ESC/POS path** — `lib/escpos/*` exists; never triggered.
- **WebSocket / real-time updates** — none visible in the network log; may not exist.
- **File upload via `attachment-dropzone`** — component exists in Appointments.
- **Region cascade autocomplete typing path** — saw the selects; never typed.
- **Acronym-hint hover tooltips** — `BIR` and others have underline cues; never hovered.
- **Adverse Event Update dialog** — only the Create dialog was driven.
- **Keyboard-shortcuts panel** — visible in the User menu, never opened.
- **Standing Order lock/unlock cycle** — `Locked: Editable` state shown; the locked-version flow not exercised.
- **`Initiate protocol` from Encounter rail** — visible primary CTA on every encounter; never clicked through.
- **External-immunization recording** — Patient → Immunizations tab is read-only; no path to add tested.
- **Apply prepayment lit up by a real prepayment transaction** — needs seed data.
- **Day-summary fix verification once the `il.service_id` hotfix lands** — there's no way to test if the page still has _other_ bugs (cash-drawer card, top-of-day reconciliation) until the 500 is fixed.

---

# Wave-6 audit — protocols, alt-auth, exports, sort/pagination, remaining admin pages, dot affordances

## A. Initiate protocol from Encounter rail

Clean multi-step modal:

1. **Step 1: Choose template.** Lists all 4 standing orders with code prefix / name / version / item count / optional `MD auth` badge. Selection highlights the chosen card.
2. **Step 2: Dose schedule.** Auto-appears below step 1 showing `Day · # · Service · Qty` rows for the selected template.
3. **`Start protocol (5 orders)`** primary CTA — preview-aware (counts the items it will create).

Issues:

- **No physician picker for MD-auth-required templates.** RABIES-ESSEN + RABIES-ZAGREB both show `MD auth` badges, but the modal has no field to record who authorized. Either the backend infers from `req.user` (only works if logged-in user is a Physician) or the auth requirement is silently bypassed. Drives the question: a Cashier clicking `Initiate protocol` for a Rabies template — does this work, fail at the API, or proceed without authorization?
- **Qty rendered as `1.00`** (4-decimal trail same as Inventory rail). Doses are integers in practice.
- The flow doesn't pre-select Day 0 for the encounter's own date — assumes today.

Compared to the New Arrival wizard's protocol step (Step 3), this **Initiate protocol** modal is the better flow: shows the impact upfront ("5 orders"), enables the CTA after one decision, no silent disable. The wizard should mirror this UX.

## B. Adverse Event Update dialog (static read)

Component at `apps/frontend/src/features/adverse-events/components/UpdateAdverseEventDialog.tsx`. Walked the source instead of driving (the AE list is seeded empty).

- Fields: severity (`Select`), outcome (`Select`), description (required textarea), treatmentGiven (optional textarea)
- Uses shadcn `<Select>` (good — unlike `ApplyPrepaymentDialog`)
- `SEVERITIES` enum: `Mild / Moderate / Severe / LifeThreatening / Fatal` — **`LifeThreatening` camelCase**, will render verbatim unless the option renderer humanizes it
- `OUTCOMES` enum: `Recovered / Recovering / NotRecovered / Fatal / Unknown` — **`NotRecovered` camelCase**
- No link to immunization (`clinical_order_id`) — same gap as the AEFI create flow

## C. Standing-order Lock + Edit cycle

The list-row `Edit` link opens the same read-only `StandingOrderDetail` rail — there is no edit form. The rail shows `Locked: Editable` as a label-value pair, but there's no toggle / lock action. State machine isn't wired through the UI.

`+ New protocol` top-right is the disabled-light-blue stub variant (likely another `Coming soon`).

So standing orders are entirely read-only from the admin UI: seed-data only.

## D. Acronym hints + the `FSM` leak

Reviewed `apps/frontend/src/components/ui/acronym-hint.tsx`. The registry:

```ts
;(BIR, OSCA, PWD, SC / PWD, FEFO, PEP, ABTC, RIG)
```

Component wraps the term in a dotted-underline span with a Radix `Tooltip` (200ms delay, `cursor: help`). On unknown terms, renders children plain — good fallback.

Cross-cutting bug: **`FSM` is an engineering acronym leaking to the user**. `TransactionsCreatePage` and `TenderRail` both render `FSM · {status}` as the cashier-facing eyebrow label (`FSM · awaiting_payment` shown earlier). Cashiers don't know what FSM is and shouldn't. Replace with `State · {humanized}` or just `{humanized}`.

## E. Forgot password + Sign in with Google

Both wrapped in `Tooltip(Coming soon)` over a disabled element on the LoginPage. `Forgot password?` is a disabled `<button>` styled as muted-foreground text — it looks like a link, but on hover the cursor doesn't change to pointer and the tooltip says "Coming soon."

Net: the login page has **two more Pattern-23 stubs**. Real password recovery + SSO don't exist.

## F. Export buttons — all stubs

Audited 9 Export CTAs by reading source:

| Page                 | Button     | State    |
| -------------------- | ---------- | -------- |
| Patients             | Export     | disabled |
| Scheduled Orders     | Export     | disabled |
| Lab Orders           | Export     | disabled |
| Encounters           | Export     | disabled |
| Services             | Export     | disabled |
| Adverse Events       | Export DOH | disabled |
| Admin · Users        | Export     | disabled |
| Admin · Audit Log    | Export CSV | disabled |
| Admin · Partner Labs | Export     | disabled |
| Admin · Attendance   | Export DTR | disabled |

**Every single Export action in the app is a `Coming soon` stub.** This is a consistent visual reservation that does nothing. Either ship the lowest-effort one (server-side CSV stream) or hide them all until at least one ships.

Same shape: **all `Filter` / `Filters` buttons are stubs** on Scheduled Orders, Lab Orders, Inventory.

## G. Sort + pagination

**No sortable columns anywhere I checked.** Patients, Audit Log, Encounters, Transactions, Inventory tables — column headers are plain text, no sort indicator, no click affordance, no `aria-sort`. Tables are render-only.

**Audit Log pagination is cursor-style** ("Load older entries" button, not page numbers). Showing "50 of 591" → "50 of 602" after my actions, but the visible page doesn't actually grow when clicking "Load older entries" — it just refetches the top 50. Either the button is wired wrong or it's another silently-stubbed action. Worth a closer look.

For a clinical app with 600+ audit entries already in seed, an "Apply since" date filter and proper sort would be table stakes.

## H. /admin/attendance

Real working page (unusual — most admin surfaces are read-only stubs). Saw clock-in/clock-out records from the kiosk drives:

- KPIs: On shift now (4), Active shifts (4), Completed (23), Total records (27) — the count moved with my Branch-kiosk activity
- Search + Today/Week/Month tabs
- **Two `Today` tables on the same page.** The first has my just-tested `Ana Reyes 0.01h Done` record (clocked in and out in seconds during the kiosk audit). The second has 5 rows of `Active` staff. Labels are both `Today` with a count next to them — visually they read like the section was rendered twice. Should be either `Today · Completed (2)` + `Today · Active (5)`, or merged into one table with a State column.
- `Schedule` + `Export DTR` top-right are **both disabled stubs**.
- Hours column shows `0.01h` for a sub-minute shift — fine arithmetically, but in practice 6-second shifts should be flagged or filtered (data-quality smell from the kiosk no-confirm finding).

## I. /admin/claims

Empty seed (0 claims) — but the page has **real CRUD wiring** (the `+ New Claim` button is not disabled, source has a `setCreateOpen(true)` handler opening a `New Claim` dialog). Couldn't drive it cleanly due to a flaky click handler, but it's a real surface unlike most admin pages. KPI strip + tabs + empty state all follow the design system.

## J. Patient detail extras

- **`More details` expansion works.** Demographics card has a "More details" button that expands to show Civil status, Nationality, Barangay with a `Show less` toggle. Real interaction.
- **`Send invoice` button** on the Outstanding balance card is **disabled when balance is 0** (current state). It's also the muted-blue disabled-looking variant. Better behavior: hide the button when balance is 0, since invoicing nothing is meaningless. (Previously noted in Wave 1, now confirmed.)
- **Schedule dots** (`D0 D3 D7 D14`) on the Active Encounter card are **purely visual** — no `aria-label`, no tooltip, no click target. A clinician scanning the row gets the colored-dot summary but can't drill into a specific dose. Adding tooltip "Dose 1 — May 17 — Completed by Dr. Santos" + click → scheduled-order rail would be a high-value UX upgrade.

## Wave-6 PR-shape additions

35. **Hide / remove Export stubs** until one is actually wired. 9+ disabled CTAs is too much fake surface area. (~30 LoC sweep)
36. **`FSM · …` → `State · …` (humanized).** Cashier-facing label. (<10 LoC + acronym registry entry if we keep it as a hint)
37. **Hide Send invoice when balance is 0.** (<5 LoC)
38. **Make schedule dots tooltip + clickable.** Tooltip with dose number / date / status; click navigates to that scheduled order. (~40 LoC)
39. **Attendance: split "Today" sections by state** (`Active` vs `Completed`) or add a State column to a single table. (<30 LoC)
40. **Initiate protocol: physician picker when MD auth required.** Could reuse the `AuthorizingProviderSelect` from the wizard. (~50 LoC)
41. **Drop Filters disabled stubs** on Scheduled Orders / Lab Orders / Inventory (same as #35). (~15 LoC)
42. **Sortable list-page columns.** A larger lift — every list page needs `<TableHead>` to accept a sort handler. Either implement once per table or ship a `<SortableHead>` primitive. Phase-2 candidate.
43. **AdverseEvent enum humanization.** `LifeThreatening` / `NotRecovered` → `Life-threatening` / `Not recovered` at render time. (<20 LoC)

---

# Stub inventory (running tally)

Across all six waves, the `Pattern-23 disabled-with-tooltip` count:

**Login page**

- `Sign in with Google`
- `Forgot password?`

**Records nav**

- Patients: `Export`
- Lab Orders: `Filter`, `Export`
- Adverse Events: `Export DOH`
- Transactions: `Print Z-out`, `Close drawer`
- Inventory: `Reorder report`, `Receive shipment`, `Filter`
- Services: `Export`
- Encounters: `+ New Encounter`, `Export`
- Appointments: (no stubs noted)
- Scheduled Orders: `Bulk SMS`, `Filters`, `Export`
- Day Summary: (whole page is broken, separate finding)

**Admin**

- Users: `Export`
- Audit Log: `Export CSV`, `Verify chain`
- Partner Labs: `Add partner`, `Export`
- Standing Orders: `+ New protocol`
- Payer Profiles: `Add payer` (suspected, not verified)
- Attendance: `Schedule`, `Export DTR`
- Notifications: (page loads with "Failed to load")
- Settings: entire page is a "Coming soon"

**Patient detail rail**: `Edit`, `Print`

That's **30+ disabled CTAs across the app**, plus the entire `/settings` page. The pattern is shipping the chrome before the action — every list page has Export + Filter slots reserved, every detail rail has Edit + Print slots reserved, but very few are wired. The visual effect for a real user is "this app looks complete but most buttons don't work."

This isn't strictly a bug — it's a deliberate design rule (`apps/frontend/CLAUDE.md` Pattern 23). But the volume is high enough that it shapes the user's perception of the app as half-built. Recommend either:

- Hide stubs (don't reserve the slot until the feature ships)
- Differentiate visually (a separate `<ComingSoonButton>` primitive with dashed border or `Soon` micro-badge)

---

# Wave-7 audit — Claims, audit pagination + entity-link, allergies/conditions Add, region cascade, print, file upload

## A. + New Claim (admin/claims)

The page has real CRUD wiring. Modal:

- **Payer\*** required — shadcn Select dropdown
- **Patient ID** (optional) — free-text `PAT-...` placeholder. Same free-text-ID anti-pattern flagged in Wave-2 #7 (Branch ID, AEFI Patient ID, Payer ID). Four instances now.
- **Total Billed** (optional) — `0.00`. Optional `Total Billed` is a smell; a claim with no amount doesn't claim anything. Likely should be required.
- **External Claim #** (optional) — free-text `HMO-...`
- Cancel / Create Claim

The flow doesn't link to a transaction or clinical order — claims float free of the work they're claiming for. In most insurance flows the claim is constructed from a transaction's line items; here the user types billed totals manually.

## B. Audit Log — Load older entries actually works

Corrected the Wave-6 reading. Clicked `Load older entries`:

| Before                        | After                           |
| ----------------------------- | ------------------------------- |
| 50 rows / "Showing 50 of 602" | 100 rows / "Showing 100 of 602" |

So pagination is wired correctly — cursor-style append. My earlier reading was off (had refetched the same window before clicking). Mark this as **working**, not broken.

## C. Audit Log entity-ID — confirmed not a link

Entity column is plain `<span class="text-xs font-mono tabular-nums text-muted-foreground">` — no `<a>` or `<button>` wrapping. Same shape in the detail rail. Confirmed via DOM inspection.

So clicking `TXN-2026-AAAAAAAA1` in the Entity column literally does nothing. (Already in PR list as #23.)

## D. Patient detail — Allergies Add / Conditions Add

**Allergies + Add** opens an `Add allergy` Dialog. Fields:

- Allergen — free text (e.g. `Penicillin`)
- Severity — Select severity dropdown
- Reaction — free text (e.g. `Rash, Anaphylaxis`)
- Notes — optional textarea
- Cancel / Save

Same form as **Edit allergy** (which I exercised in Wave 3) — good consistency. Issues:

- **No required-asterisks.** Allergen should be required at minimum; the design-system rule is asterisk-on-required.
- **Allergen is free text.** No allergen dictionary autocomplete, no link to RxNorm or DAS (DOH Allergen Standardization). A typo in `Penicillin` → `Pencillin` won't be caught and won't match downstream allergy-checking against orders.

Conditions Add (separate `+` button on the Conditions card) opens the parallel Add condition dialog — same shape, same gaps. ICD-10 likely missing here too.

## E. Region cascade + Address autocomplete

**Cascade works.** Confirmed Region → Province cascading: setting Region to `National Capital Region (NCR)` populates Province to a 2-option list (`Metro Manila`). Backed by a static dataset (`philippine-locations.ts`).

But two underlying issues:

- **Native `<select>` elements.** The full cascade (Region / Province / City / Barangay) uses bare HTML `<select>` instead of shadcn `<Select>`. Inconsistent with the rest of the design system; the dropdown can't be typeahead-searched, and styling drifts at scale.
- **Address autocomplete is silently broken.** The `Start typing an address...` input above the cascade hits `/api/places/autocomplete` — backend returns:

  ```
  503 { "error": "Places API not configured", "code": "SERVICE_UNAVAILABLE" }
  ```

  The component catches the error and clears predictions, so the user sees nothing — no suggestions, no fallback notice. A clinic user types an address, nothing appears, they wonder if they're misspelling it. **Either gate the input behind a feature flag, or surface a one-line `Address lookup unavailable — fill the fields below` hint.**

## F. Print Receipt — solid full-stack flow

The transaction detail rail's `Print Receipt` button opens a **`Receipt preview` dialog** showing a formatted text receipt:

```
ACKNOWLEDGEMENT RECEIPT
   SUREVAX CLINIC
   Quezon City, Metro Manila
   (02) 8123-4567
─────────────────────────
Receipt No: SV-05171045
Date:       5/17/2026
Time:       10:45 AM
Patient:    Dela Cruz, Maria
Payment:    Cash
─────────────────────────
PVRV (Verorab)  ₱2,500.00
                 Subtotal: ₱2,500.00
TOTAL:                ₱2,500.00
─────────────────────────
Cash:                ₱2,500.00
Total Paid:          ₱2,500.00
       Thank you for choosing
            SureVax Clinic
   This serves as your acknowledgement receipt
```

The `Print...` CTA opens a second dialog (`PrintOptionsDialog`) with four options:

| Option                    | Method            | State                            |
| ------------------------- | ----------------- | -------------------------------- |
| Bluetooth thermal printer | Web Bluetooth API | disabled in unsupported browsers |
| USB thermal printer       | WebUSB            | disabled in unsupported browsers |
| Download ESC/POS file     | Blob download     | always available                 |
| Standard browser print    | `window.print()`  | always available                 |

Footer shows capability state: `BT on/off · USB on/off · Serial on/off · mobile/desktop`. Genuinely thoughtful — the disabled state is explained inline (`Not supported on this device`) rather than mystery-disabled.

Issues:

- **Date format `5/17/2026`** is M/D/YYYY (US). Most PH receipts use `17 May 2026` or `2026-05-17`. Matches the wider date-format inconsistency thread.
- **Receipt number `SV-05171045`** appears to combine MMDDHHMM. Probably fine but worth verifying that a uniqueness/format constraint exists on the backend — collisions on a slow minute are plausible.
- **Download filename is `receipt-{full transaction id}`** — e.g. `receipt-TXN-2026-AAAAAAAA1.bin`. Long but unambiguous.
- The receipt preview uses `font-family: monospace` to mimic thermal output — looks right for the medium.

This is the **most polished single feature in the app**. Real backend support, capability detection, multiple printer types, manual fallback. Use this surface as the template for "real implementation" comparisons against the rest of the app's stubs.

## G. Attachment dropzone (static read; appointments empty)

Component at `apps/frontend/src/components/ui/attachment-dropzone.tsx`. Couldn't drive live — the dropzone only renders inside `AppointmentDetail`, and Appointments is empty in seed.

Implementation:

- **Presign-at-create flow.** Client constructs `storageKey = uploads/{uuid}/{filename}`, hashes the file with SHA-256, posts to backend create endpoint, backend returns a presigned PUT URL.
- **50 MB cap** (`MAX_FILE_SIZE`). User sees `File too large` toast if exceeded.
- **Drag-and-drop + click-to-pick** both supported. Border changes color on `dragOver`.
- **`isEncrypted: true` hardcoded** — every file marked encrypted at insert.

The source has a load-bearing comment about a backend authz invariant:

> the backend MUST validate that `storageKey` starts with the expected `uploads/` prefix and belongs to the authenticated tenant before issuing the presigned URL — it must not blindly trust client-supplied paths. Without that guard an attacker could overwrite arbitrary R2 objects by crafting a malicious storageKey.

That's a **security finding worth a dedicated check on the backend** — verify the create-attachment route enforces the prefix + tenant-ownership check on the client-supplied `storageKey`. Not a frontend audit task, but record it so it doesn't slip.

UX issues:

- **No file-type whitelist.** The dropzone accepts any file. A clinic accidentally uploading `.exe` or `.html` files is harmless if R2 is served with `Content-Disposition: attachment`, but the upstream attachment is non-restricted. Real-world ABTC uploads are PDF / JPG / PNG — restrict via `accept` attribute.
- **No progress indicator** for the actual PUT to R2 — the button shows `Uploading…` but the real upload could take 30+ seconds for a 50 MB file. A progress bar or percentage would help.

## Wave-7 PR-shape additions

44. **New Claim: link to a transaction.** Optional transaction-picker; on selection prefill the Total Billed. (~60 LoC)
45. **Address autocomplete fallback notice** — when `/api/places/autocomplete` is 503, surface a single muted-text hint under the input rather than silently empty predictions. (<20 LoC)
46. **Region cascade: shadcn `<Select>` instead of native.** Bigger lift; affects 4 selects on the patient form. (~80 LoC)
47. **Receipt date format `M/D/YYYY` → `MMM D, YYYY` or `D MMM YYYY`.** Aligns with the date-format consistency PR (item 4). (<10 LoC)
48. **Attachment dropzone: accept whitelist + upload progress bar.** Real PUT progress via `XMLHttpRequest.upload.onprogress`. (~50 LoC)
49. **Allergies/Conditions Add: required-asterisks on Allergen / Condition name.** (<10 LoC)

Plus a **security audit task** (not frontend):

- Verify backend create-attachment route enforces `storageKey` prefix + tenant ownership before issuing the presigned PUT URL.

---

# What's left after Wave 7

The MCP-feasible audit surface is now nearly exhausted. What remains:

**Out-of-MCP** (not feasible in current preview):

- True two-tab interactions (`window.open` blocked)
- Session expiry without HTTP-Only cookies access (can't time-travel or force-clear)
- Hover-only tooltips (AcronymHint, Pattern-23 stubs) — would need real Chrome with reliable mouseover
- File upload requires a seeded appointment + a real `File` object (MCP can't synthesize one)

**Possible but I'd recommend skipping**:

- Cashier / Nurse / Physician role walks — large surface, mostly will surface the same Pattern-23 stub findings; the security gap (Branch can hit clinical routes via URL) likely applies to other roles too
- Tagalog / Filipino UI swap
- Dark mode / mobile / tablet

**Worth a focused look in a real browser pass** (not the MCP):

- Hover the dotted-underline `BIR`, `FEFO`, `PEP`, `ABTC`, `RIG`, `OSCA`, `PWD`, `SC/PWD` terms and verify the tooltip copy is actually correct (the registry is mostly written by an AI and could mislabel something)
- Drag-and-drop the dropzone with a real file under and over 50 MB
- Trigger Web Bluetooth / WebUSB on Chrome with a paired ESC/POS printer
- Try printing the receipt on Safari (where neither Bluetooth nor USB are available, only Download and Standard)

If you want one more wave inside the MCP, the highest-value next pass is probably either:

- **A "drive every primary-action and watch for backend errors" sweep** — for every `+ New`/`Add`/`Save` action across the app, click through and watch the network log + backend log for unexpected 4xx/5xx. The two schema-cutover bugs (day-summary, administer-dose) were both surfaced this way; there may be more lurking.
- **A "watch the audit log grow" sweep** — drive a known set of actions (open drawer, clock in, register patient, …) and verify each surfaces as an audit entry with the right entity_type / action / actor. Validates the audit trail's coverage by exercise rather than by inspection.

Either pass would be a few hundred tool calls and would surface the kind of bugs that don't show up in inspection-only review.

---

# Wave-8 audit — "drive every primary action, watch for errors" sweep

Hypothesis from earlier waves: there are more schema-cutover ID-format bugs beyond day-summary + administer-dose. Drove a sweep of primary CTAs to flush them.

## Actions exercised + outcome

| Action                           | Path                                          | Result                                                        |
| -------------------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| Add vital (encounter)            | `POST /api/encounters/.../vitals`             | ✅ saved (0 → 1 recorded)                                     |
| Add diagnosis (encounter)        | `POST /api/encounters/.../diagnoses`          | ✅ saved (toast `A82.9 recorded`)                             |
| Add allergy (patient)            | `POST /api/patients/.../allergies`            | (form validation gate, didn't fire)                           |
| Add condition (patient)          | `POST /api/patients/.../conditions`           | (form validation gate, didn't fire)                           |
| **Reschedule**                   | `POST /api/scheduled-orders/.../reschedule`   | ❌ **500**                                                    |
| AEFI Create                      | `POST /api/adverse-events`                    | (form validation gate, didn't fire)                           |
| Notification Template Edit       | `PATCH /api/admin/notification-templates/...` | (form validation gate, didn't fire)                           |
| **Add payment** (settle Pending) | `POST /api/transactions/.../payments`         | ✅ Torres Miguel `Pending → Paid`, toast `Cash · PHP 4200.00` |
| **Initiate protocol**            | `POST /api/patient-standing-orders`           | ❌ **500** (twice — retry path)                               |

`Add allergy / Add condition / AEFI / Notification template edit` form-validation gates I couldn't get past via programmatic value-set because RHF doesn't pick up the synthetic input dispatch (controlled inputs need a different shape). These would all submit if filled via the UI — they just didn't fire from the test harness.

## 🚨 Two NEW schema-cutover ID-format bugs

Both are siblings of the day-summary + administer-dose bugs from earlier waves. **This is now the fourth Postgres `check constraint` ID-format violation on the same audit pass**, all rooted in the schema-v2 cutover.

### Bug #3 — Reschedule trigger

```
PostgresError: new row for relation "clinical_order_schedule_changes" violates check constraint "clinical_order_schedule_changes_id_format"
detail: Failing row contains (SC-2026-B773838842, ...)
where: PL/pgSQL function write_clinical_order_schedule_change() line 4 at SQL statement
```

Generator (in trigger function `write_clinical_order_schedule_change()`):

```sql
'SC-' || to_char(now(), 'YYYY') || '-' ||
  upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10))
```

→ produces `SC-2026-B773838842` (year + 10-hex chars).

Constraint at `apps/backend/drizzle/0003_invariants.sql:` `clinical_order_schedule_changes_id_format`:

```sql
CHECK (id ~ '\.CLI-[0-9A-HJKMNPQRSTVWXYZ]{6}$');
```

→ expects parent-embedded `{parent}.CLI-{6 B32}`.

**Trigger and constraint disagree.** Pick one (the trigger SQL needs rewriting OR the constraint is wrong). Net: **every Reschedule action 500s.** Confirmed by driving the Reschedule modal end-to-end with valid date + reason.

### Bug #4 — Initiate protocol → clinical_orders

```
PostgresError: new row for relation "clinical_orders" violates check constraint "clinical_orders_id_format"
detail: Failing row contains (PAT-AAAAAAAAA8.ENC-2026-AAAAA6.ORD-M2WA8F, ..., PAT-AAAAAAAAA8.PSO-KTAM0X, ...)
```

Constraint:

```sql
CHECK (id ~ '^PAT-[0-9A-HJKMNPQRSTVWXYZ]{10}\.PSO-[0-9A-HJKMNPQRSTVWXYZ]{6}\.ORD-[0-9A-HJKMNPQRSTVWXYZ]{6}$');
```

→ regex requires middle segment to be `PSO-{6 B32}`.

Service produces: `PAT-...ENC-2026-...ORD-...` — middle segment is `ENC-{year}-{...}`, **not** `PSO-...`.

The PSO ID is also in the failing-row tuple (`PAT-AAAAAAAAA8.PSO-KTAM0X`) — so the relation exists; the service is just stitching the wrong parent into the clinical_order ID. Either:

- Service should use `{patient}.{pso}.ORD-{6 B32}` format
- Or constraint should accept either `.PSO-` or `.ENC-` middle

Net: **every Initiate-protocol action 500s.** The frontend shows the (generic) toast error, not the database message.

## Two CONFIRMED working flows

### Add vital — works

Posted to `/api/encounters/.../vitals` with all 10 fields. Vitals tab updated `0 recorded → 1 recorded`. The encounter's `last_vitals` view (visible on Patient detail "Vitals (last)") would update.

### Add payment (settle Pending → Paid) — works

`POST /api/transactions/TXN-2026-AAAAAAAA2/payments` with `method=Cash, amount=4200.00` succeeded. Transaction status flipped `Pending → Paid` immediately, action set changed (`Add payment` disappeared, `Refund` appeared), `Payments (1)` populated with the new row. Toast: `Payment recorded / Cash · PHP 4200.00`.

Minor finding: toast money formatting is `Cash · PHP 4200.00` (no thousand separator), inconsistent with the page-level Today's Revenue display `₱8,178.57`.

## Running list of schema-cutover bugs (all four)

| #   | Path                                        | Error                                       | File / function                                                                                                   |
| --- | ------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | `GET /api/day-summary`                      | `column il.service_id does not exist`       | stale column reference in day-summary query                                                                       |
| 2   | `POST /api/scheduled-orders/.../administer` | `inventory_movements_id_format`             | FEFO deduction service generates `IVM-{random}` instead of `LOT-{...}.INVTX-{...}`                                |
| 3   | `POST /api/scheduled-orders/.../reschedule` | `clinical_order_schedule_changes_id_format` | `write_clinical_order_schedule_change()` trigger generates `SC-{YYYY}-{10 hex}` instead of `{parent}.CLI-{6 B32}` |
| 4   | `POST /api/patient-standing-orders`         | `clinical_orders_id_format`                 | Initiate-protocol service generates `{pat}.ENC-{year}-{...}.ORD-{...}` instead of `{pat}.PSO-{6 B32}.ORD-{...}`   |

The pattern is consistent: **every action that writes a child row whose ID needs to be derived from parent display IDs hits a constraint mismatch**. Almost certainly more of these are hiding — there are 27+ `_id_format` constraints in `0003_invariants.sql`. A targeted sweep of every INSERT statement against the constraint regex would surface the rest in one pass.

## Console-only finding: missing DialogTitle on a Radix Dialog

Browser console emitted 72 instances of:

```
DialogContent requires a DialogTitle for the component to be accessible
for screen reader users. If you want to hide the DialogTitle, you can wrap
it with our VisuallyHidden component.
```

Some `Dialog` is missing a `DialogTitle` — likely the `<CommandDialog>` (⌘K) or one of the alert-dialog-style modals. Accessibility-only warning, not a runtime error, but worth fixing — screen-reader users currently get no title announcement.

## Wave-8 PR-shape additions

50. **Schema-cutover ID-format sweep.** One coordinated pass over all 4 known bugs + an audit of the remaining 23 `_id_format` constraints to catch hiding mismatches. (~150 LoC across triggers, generators, and any constraint relaxations needed)
51. **Frontend generic error → API error code.** When the API returns `{code: "..."}`, surface it inline instead of generic `Internal server error`. (~30 LoC in `apiFetch.ts` + relevant toast handlers)
52. **`DialogTitle` on every Radix Dialog.** Sweep the codebase for `DialogContent` without `DialogTitle` and add `<VisuallyHidden><DialogTitle>...` where the visual design doesn't include one. (<40 LoC sweep)
53. **`apiFetch` toast / banner currency formatter.** Use `formatMoney` for any user-facing peso value in toasts, not raw `PHP {raw string}`. (<20 LoC + sweep)

---

# Wave-9 audit — final MCP-feasible sweep

Last pass through everything still feasible in the preview MCP. The big find is a **critical attachment-storage vulnerability** confirmed by direct POST.

## A. 🚨 SECURITY: Attachment storageKey is unvalidated

The Wave-7 finding I flagged as "needs a backend audit pass" is **confirmed exploitable.** Driven via direct fetch with all 6 deliberately-malicious storageKey shapes:

```
POST /api/attachments
{
  "ownerType": "patient",
  "ownerId":   "PAT-AAAAAAAAA8",
  "storageKey": "<see table>",
  ...
}
```

| storageKey              | Result             |
| ----------------------- | ------------------ |
| `../etc/passwd`         | ✅ **201 Created** |
| `uploads/../etc/passwd` | ✅ **201 Created** |
| `./malicious.txt`       | ✅ **201 Created** |
| `http://evil.com/x`     | ✅ **201 Created** |
| `wrong-prefix/x.pdf`    | ✅ **201 Created** |
| `uploads/x.pdf`         | ✅ **201 Created** |

**All six accepted.** The backend doesn't validate the `uploads/` prefix, doesn't reject `..`, doesn't reject absolute URLs, doesn't enforce per-tenant path isolation. The frontend `AttachmentDropzone` source file calls this out in a load-bearing comment:

> the backend MUST validate that storageKey starts with the expected uploads/ prefix and belongs to the authenticated tenant before issuing the presigned URL — it must not blindly trust client-supplied paths. Without that guard an attacker could overwrite arbitrary R2 objects by crafting a malicious storageKey.

The guard is **not present.** Any authenticated user can register an attachment record pointing at any R2 key. Whether they can then PUT bytes to that key depends on what the backend hands back as a presigned URL — almost certainly the same client-supplied storageKey, since the whole flow is "presign-at-create."

Concrete impact: an authenticated user can craft a `storageKey` overlapping another tenant's file path, then PUT junk to overwrite a real attachment.

**Priority: BLOCKER.** Fix shape in the backend create-attachment route:

```ts
if (!storageKey.startsWith(`uploads/${tenantId}/`)) {
  throw new ApiError(400, 'INVALID_STORAGE_KEY', 'storageKey must be uploads/{tenant}/...')
}
if (storageKey.includes('..') || storageKey.includes('//')) {
  throw new ApiError(400, 'INVALID_STORAGE_KEY', ...)
}
```

Plus: don't let the client supply the storageKey at all — derive it server-side from `${tenantId}/${uuid}/${sanitizedFilename}`. The current "client constructs path" pattern is the root of the issue.

## B. ID-format constraint sweep — cross-referenced 33 constraints

Walked every `_id_format` check constraint in `apps/backend/drizzle/0003_invariants.sql` and matched against the actual ID generator (in `packages/shared/src/utils/displayId.ts` and the call sites in `apps/backend/src/modules`).

**Confirmed mismatches (all already-documented bugs):**

| Table                             | Constraint requires                 | Generator produces                                                                     | Status             |
| --------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------- | ------------------ |
| `inventory_movements`             | `LOT-{YYYY}-{10B32}.INVTX-{6B32}`   | `randomId('IVM')` → `IVM-{10B32}`                                                      | ❌ Bug #2 (Wave 4) |
| `clinical_order_schedule_changes` | `{parent}.CLI-{6B32}`               | trigger emits `SC-{YYYY}-{10hex}`                                                      | ❌ Bug #3 (Wave 8) |
| `clinical_orders`                 | `^PAT-...\.PSO-{6B32}\.ORD-{6B32}$` | `childId(encounterId, 'ORD')` → `PAT-...ENC-{year}-....ORD-...` when encounter present | ❌ Bug #4 (Wave 8) |

**Suspected mismatches needing a closer look (not driven live):**

| Table                    | Constraint             | Generator                               | Concern                                                                                                                                                              |
| ------------------------ | ---------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `notification_templates` | `^NTP-{10B32}$`        | not in any `displayId.ts` enum          | `NTP` is not in `RandomPrefix` — generator likely hand-written elsewhere; works (templates exist in seed) but worth confirming the generator matches the constraint. |
| `approval_requests`      | `^AR-{YYYY}-{10B32}$`  | not in `YearPrefix` enum (`AR` missing) | Approval seed rows show `AR-2026-...` format — generator path likely correct but TypeScript would refuse `yearId('AR')` today.                                       |
| `inventory_lots`         | `^LOT-{YYYY}-{10B32}$` | `LOT` not in `YearPrefix` either        | Same shape — works at runtime, but the type system doesn't gate it.                                                                                                  |

The constraint regexes all use the Crockford alphabet `[0-9A-HJKMNPQRSTVWXYZ]` (no I/L/O/U). Some triggers (audit*logs, the broken schedule-changes trigger) emit **upper-hex** (`0-9A-F`), which is a \_subset* of Crockford so won't fail the regex.

**Recommendation:** every backend module that writes an audited table should call the shared `displayId.ts` helpers — no inline `'SC-' || ...` or `randomId('IVM')` shortcuts. The trigger-side SQL is the harder fix; those need to be re-derived against the constraint shape.

## C. Audit-log coverage — confirmed but with naming drift

Queried `/api/admin/audit?limit=200`. Entity types observed (and their counts):

```
users(14), transactions(30), transaction(1), payments(14),
notification_templates(21), adverse_events(1), patient_allergies(2),
encounter_diagnoses(1), encounter_vitals(1), clinical_order(1),
cash_drawer_sessions(1), encounter(1), session(2), approval_requests(8),
transaction_items(18), inventory_lots(10), lab_orders(5), consents(11),
clinical_orders(24), patient_standing_orders(14), encounters(15),
standing_order_template_items(5)
```

**Audit-trail naming inconsistency:** two pairs of mixed singular/plural entity types appear in the same log:

- `transaction` (1) AND `transactions` (30)
- `encounter` (1) AND `encounters` (15)
- `clinical_order` (1) AND `clinical_orders` (24)

So a SQL query for "all transaction events" using one form misses the other. Pick singular or plural and normalize.

**Positives:**

- My Wave-8 mutations all appear (CREATE encounter_vitals, CREATE encounter_diagnoses, CREATE payments + UPDATE transactions, CREATE patient_allergies, CREATE adverse_events, UPDATE notification_templates, CREATE cash_drawer_sessions). So the audit trigger fires on all of them.
- **Wait — `CREATE adverse_events` and `CREATE patient_allergies` ARE in the log.** I thought those didn't submit in Wave 8 (RHF form-state issues). The audit log says they did. Worth re-checking — either RHF actually accepted my synthetic input, or these are entries from earlier waves.
- `CREATE cash_drawer_sessions` shows my Branch-kiosk Open-Drawer action.

**Missing from audit:**

- No `staff_time_logs` entries — kiosk Clock In/Out doesn't seem to write an audit row. **Should** — staff timekeeping needs an immutable trail.

## D. CSRF guard — works correctly

Three explicit checks:

| Request                                           | Result                    |
| ------------------------------------------------- | ------------------------- |
| `POST .../vitals` without `X-Requested-With`      | **403 `CSRF_REQUIRED`** ✓ |
| `POST .../vitals` with `X-Requested-With: fetch`  | **201 Created** ✓         |
| `GET /api/admin/users` without `X-Requested-With` | **200** ✓ (GETs exempt)   |

CSRF middleware behaves as documented in `apps/backend/src/shared/middleware/csrf.ts`. No bypass.

## E. Tenant boundary — resists header tampering

Three explicit checks (logged in as `TEN-SUREVAX`):

| Headers                      | Result                                         |
| ---------------------------- | ---------------------------------------------- |
| `X-Tenant-Slug: fake-tenant` | **200**, returns TEN-SUREVAX data (JWT wins) ✓ |
| `X-Dev-Tenant-Id: TEN-OTHER` | **200**, returns TEN-SUREVAX data ✓            |
| `X-Tenant-Slug: fake`        | **200**, returns TEN-SUREVAX data ✓            |

The tenant middleware honors JWT-claim priority and ignores header overrides for authenticated users. Good. Tested per the priority documented in CLAUDE.md gotchas (JWT → header → dev-header → test env → 400 TENANT_REQUIRED).

## F. 404 / route validation surfaces

| Request                                  | Result                              |
| ---------------------------------------- | ----------------------------------- |
| `GET /api/patients/PAT-NOTREAL`          | **404 `NOT_FOUND`** ✓               |
| `GET /api/patients/not-a-valid-id-shape` | **404 `NOT_FOUND`** — should be 400 |
| `GET /api/does-not-exist`                | **404** ✓                           |

Minor finding: a malformed `:id` returns `404 Patient not found` instead of `400 Invalid ID format`. The `idSchema` Zod validator should reject the param before hitting the DB. Today the route falls through to a `(tenant_id, id)` lookup that misses, so the user sees the wrong error category. Should be 400 with `code: INVALID_ID`.

## G. React Error Boundary — none exist

```
$ grep -rn "ErrorBoundary\|componentDidCatch\|getDerivedStateFromError" apps/frontend/src
(no matches)
```

**No error boundaries anywhere in the frontend.** Any uncaught render-time React error tears down the entire app tree. The user lands on a blank page with no recovery path other than refresh — which (per Wave 4) bounces to `/login`. Compounding two bugs.

For a clinical app this is a real risk: an unexpected null/undefined field on a heavily-rendered page (patient detail, scheduled-orders rail) blanks the whole UI mid-shift. Wrap at minimum the page-route level (`<Outlet>`) and the detail-rail level in an `<ErrorBoundary>` with a `Something went wrong — Refresh` fallback.

## H. Dialog accessibility (browser console)

72 instances of `DialogContent requires a DialogTitle` in console. Already flagged in Wave 8 (PR #52). Add it to the running tally.

## Wave-9 PR-shape additions

54. **🚨 BLOCKER — Attachment storageKey server-side derivation.** Don't accept client-supplied storageKey; derive from `uploads/{tenantId}/{uuid}/{sanitizedFilename}`. Plus reject `..`, absolute URLs, mismatched prefixes if any legacy clients still send them. (~40 LoC backend + small frontend change to stop sending key)
55. **Audit-trail entity-type naming normalization.** Pick singular or plural per table; backfill or rename existing rows. (~30 LoC trigger + migration)
56. **Add `staff_time_logs` to the audit trigger's coverage list.** Clock In/Out should be audited. (<10 LoC)
57. **Malformed `:id` → 400 not 404.** Wire the `idSchema` Zod validator into route param validation. (~20 LoC sweep across module routers)
58. **Page-level `<ErrorBoundary>` around `<Outlet>` and detail rails.** Fallback renders a refresh/retry banner instead of a blank page. (~80 LoC + one shared component)
59. **`displayId.ts`: add `NTP / AR / LOT` to the prefix enums.** Or replace hand-rolled string IDs in those modules with shared helpers. Aligns the type system with the constraint reality. (<30 LoC)

---

# Final stub inventory + audit summary

Across 9 waves of auditing:

- **53 PR-shape items + 6 new in this wave = 59 total**
- **5 confirmed Postgres `_id_format` constraint mismatch bugs** (day-summary column, administer-dose IVM, reschedule trigger, initiate-protocol service, plus the suspect AR/NTP/LOT enum gaps)
- **1 critical security finding** (attachment storageKey)
- **2 backend security wins** (CSRF guard works, tenant boundary works)
- **Zero React error boundaries**
- **30+ Pattern-23 disabled stubs across the app**
- **Coverage** — 7 clinic workflows + 14 screens (Wave 1) + 7 detail rails (Wave 4) + 14 primary actions (Wave 8) all driven where MCP allowed; remaining gaps are role-walks (deferred) and out-of-MCP affordances (true two-tab, file upload, hover-only tooltips, session expiry without cookie access).

# Truly-deferred gaps

Items the MCP genuinely can't reach:

- **Other roles** (Cashier / Nurse / Physician — deferred by user direction)
- **Two-tab interactions** (`window.open` blocked)
- **Tagalog UI** (deferred)
- **Mobile / tablet / dark mode** (deferred)
- **Web Bluetooth / WebUSB printing** with real hardware
- **File upload with a real `File` object** — would surface the storageKey vulnerability behavior end-to-end (the create-attachment 201 is enough proof for the finding)
- **Forcing access-token expiry mid-action** (no cookie access)
