# UI/UX Audit — Deep Dive (2026-05-23)

> Two-phase audit of every frontend surface. Phase 1: foreground browser walks
>
> - 4 parallel Sonnet auditors (clinical, billing, inventory+admin,
>   cross-cutting). Phase 2: 6 narrow Sonnet auditors (dialogs, forms, toasts,
>   detail drawers, print/receipts, role gating) + Branch role-walk through the
>   kiosk on `/branch/kiosk`. ~120 distinct findings; this doc lists only the
>   active ones after applying the 2026-05-23 role-posture clarification (see
>   below). Internal `Bxx` IDs reference the working notes from the audit
>   session.

---

## Role posture (2026-05-23 — corrected mid-audit)

The audit initially flagged several "PHI exposure" and "missing role gate"
findings against the `Branch` service account. Those are **invalidated by
the actual product model**:

- **`Branch` login is intentional shared kiosk access** to a single
  physical clinic. Multiple nurses + physicians use the same Branch
  account from one device.
- **Per-role gating is deferred to a future phase.** "Nurse / Physician /
  Cashier" exist as enum values but are not the security boundary today.
- **No cashier role yet** — all cashier-vocabulary findings are still
  valid as copy nits, just not "wrong-role" issues.
- **"Physician auth" is attribution, not a gate** — every clinical action
  records _which_ physician performed/authorized it via
  `performed_by_id` / `administered_by_id` / `documented_by_id`. The
  UI just needs a physician picker, not an authorization flow.
- **Nurses clock in to different branches** — staff move between clinics;
  the kiosk attendance roster reflects who's on duty _here_.

### Implication for "Branch can reach /patients" findings

Branch should be able to do **all the workflows** (patient register,
encounter, transaction, inventory, lab orders, adverse events, etc.).
Today, Branch:

- ✅ has the full Records sidebar group (Patients, Lab Orders, Adverse
  Events, Transactions, Inventory, Services)
- ❌ is **blocked by `RequireNonBranch`** from the Today group
  (`/dashboard`, `/arrivals`, `/encounters`, `/scheduled-orders`,
  `/appointments`, `/day-summary`) — clicks the sidebar link, gets
  silently redirected to `/branch/kiosk`

That's backwards. The Today group is where actual clinical work happens
— arrivals intake, encounters, scheduled-order administration. **Drop
the `RequireNonBranch` gate.** The kiosk becomes the attendance + cash
drawer surface; everything else routes normally.

---

## Active ship-blockers

> **Wave 1 + Wave 2 rollup (2026-05-23)**: 14 of 16 ship-blockers below closed across 8 PRs (#443-#450). Each is annotated `✅ shipped` with the PR ref inline. Items 12 (BIR receipt) and 13 (BranchDayOpenPrompt external auto-close) remain open.

### 1. `/api/admin/notifications` returns 500 (regression) ✅ shipped

`PostgresError 42601 "syntax error at or near WHERE"`. PR #432 was
supposed to fix this; verified at runtime today, error still fires.
Frontend renders "Failed to load notifications" which looks like an
empty state.
File: [`apps/backend/src/modules/notifications/db.ts:184`](../../apps/backend/src/modules/notifications/db.ts)

**Verified in Wave 1**: confirmed `sql\` WHERE n.tenant_id = ${tenantId}\`` (leading-whitespace fix) was already in place after #432 — the audit note was stale by the time it was written.

### 2. Services list shows 32 hidden "Inactive" panel-constituent rows ✅ shipped [#447](https://github.com/njvil/surevax-cms-revamp/pull/447)

`listServices` has no `isActive = true` filter. The intentionally-hidden
panel constituents (category `Diagnostics — Panel Constituents (hidden)`)
render to staff with an `Inactive` badge. List is unusable as an
"orderable services" picker.
File: [`apps/backend/src/modules/service_catalog/db.ts:68`](../../apps/backend/src/modules/service_catalog/db.ts)

### 3. Day Summary "Revenue" includes uncollected money — verified intentional

`day_summary/db.ts:41-43` filters out only `Voided`/`Refunded`. `Pending`
and `Draft` count toward the headline `Revenue` KPI. End-of-day report
shows fake revenue. Pre-existing handover §4 finding; confirmed in source.

**Verified in Wave 1**: the comment at `day_summary/db.ts:31` explicitly
says "Draft is included because the cashier intends to collect" — this is
intentional product behavior, not a bug. If the semantics need to change
the relabelling to "Billed/Gross" needs an ops decision. Closing as
"not-a-bug" until that decision is made.

### 4. `/initiate-protocol` ships "Preview mode" + UUID paste + "follow-on PR" copy ✅ shipped [#443](https://github.com/njvil/surevax-cms-revamp/pull/443)

- `Preview mode` badge visible on the page
- `toast.success('Protocol initiated (preview mode)')`
- Fallback input placeholder reads `"Physician user UUID"` with help text:
  `"The physician picker will be wired up in a follow-on PR. Paste the
physician's display ID."`
- Context-missing banner: `"...The encounter detail wiring will arrive in
a follow-on PR."`

Given the role-posture correction (physician auth = attribution), the real
fix is a `<PhysicianPicker>` dropdown of users with role=Physician at the
clinic — not a UUID paste. Replace all 3 strings.
File: [`apps/frontend/src/features/standing-orders/InitiateProtocolPage.tsx:297,326,498-502`](../../apps/frontend/src/features/standing-orders/InitiateProtocolPage.tsx)

### 5. Admin → Users "Active now: N" KPI is wrong ✅ shipped [#447](https://github.com/njvil/surevax-cms-revamp/pull/447)

Counts `status='Active'`, not active sessions. Two users last seen in
April / May 22 are counted as "currently logged in".
File: [`apps/frontend/src/features/admin/UsersPage.tsx:76-77`](../../apps/frontend/src/features/admin/UsersPage.tsx)

**Resolution**: KPI relabelled to "Active accounts / enabled for login"
(matches what the data actually represents). True live-session count
remains a follow-up if/when needed.

### 6. Lab Orders "Sent out" KPI hardcoded to `value={0}` ✅ shipped [#447](https://github.com/njvil/surevax-cms-revamp/pull/447)

Now derives `sentOutCount` from `laboratoryName != null` over the row set
(rows tied to a partner lab).
File: [`apps/frontend/src/features/lab-orders/LabOrdersPage.tsx:138`](../../apps/frontend/src/features/lab-orders/LabOrdersPage.tsx)

### 7. Doubled `PHP PHP` in ApplyPrepaymentDialog ✅ shipped [#447](https://github.com/njvil/surevax-cms-revamp/pull/447)

Select option renders `PHP {formatMoney(c.netAmount)}` — `formatMoney`
already prepends `PHP`. Result: `PHP PHP 1,000.00`.
File: [`apps/frontend/src/features/transactions/components/ApplyPrepaymentDialog.tsx:107`](../../apps/frontend/src/features/transactions/components/ApplyPrepaymentDialog.tsx)

### 8. Patient health card PDF leaks `PAT_…` + hardcoded clinic name ✅ shipped [#447](https://github.com/njvil/surevax-cms-revamp/pull/447)

- Line 88: `ID: {patient.displayId}` rendered on the patient-handed
  document next to the MRN. Should be MRN-only.
- Line 64: `const tenantName = opts.tenantName ?? 'SureVax Clinic'`. The
  caller (`service.ts:152`) does **not** pass `tenantName`. Every card
  says SureVax even in multi-tenant Phase 2.

File: [`apps/backend/src/modules/health_cards/pdf.ts:64,88`](../../apps/backend/src/modules/health_cards/pdf.ts)

### 9. JSONB rendered as raw `<pre>` blocks to all users ✅ shipped [#444](https://github.com/njvil/surevax-cms-revamp/pull/444)

Clinical content shown as code dumps in detail rails:

- `EncounterDetail` — `Provider Note` + non-rabies `Assessment`
- `LabOrderDetail:238` — `resultData`
- `AdverseEventDetail` — `symptomsCoded`

Even with role gating deferred, raw JSON is bad UX. Convert to a
structured key-value display.

**Resolution**: all 3 surfaces now use structured `<Field>`/`<dl>` layouts
via U4. The unused `JsonBlock` helper in `EncounterDetail` was removed in
the same PR.

### 10. `Tenant ID` + `Row version` shown in user-facing detail rails ✅ shipped [#444](https://github.com/njvil/surevax-cms-revamp/pull/444) + [#447](https://github.com/njvil/surevax-cms-revamp/pull/447)

- `AppointmentDetail:212` — literally a field labelled `Tenant ID` with
  value `SVX`
- `Row version` (optimistic-lock counter) surfaced in AppointmentDetail,
  AdverseEventDetail, NotificationDetail, ProductRecallDetail

Internal-only state with zero user benefit. Remove from rendered output.

### 11. AEFI report submits silently ✅ shipped [#447](https://github.com/njvil/surevax-cms-revamp/pull/447)

`onSuccess` closes the dialog with no toast. Safety-critical clinical
action with no confirmation signal.
File: [`apps/frontend/src/features/adverse-events/components/ReportAdverseEventDialog.tsx:80`](../../apps/frontend/src/features/adverse-events/components/ReportAdverseEventDialog.tsx)

**Resolution**: `toast.success('Adverse event reported')` added to
`onSuccess` before `form.reset()`.

### 12. BIR receipt compliance gaps ❌ blocked — needs ops sign-off

Both HTML (`AcknowledgementReceipt.tsx`) and ESC/POS (`escpos/receipt.ts`)
templates:

- No TIN, PTU/ATP number, BIR accreditation number, or OR series range
- VAT line conditional on non-zero (BIR requires 0-value line to display)
- No SC/PWD VAT breakdown
- No cashier name/signature line
- Two "receipt numbers" on the same paper (`OR No:` + synthetic
  `SV-MMDDHHmm` from `buildReceiptNumber`)
- `[serviceType]` dev annotation rendered in brackets to customer
- Footer "for vaccination services received" hardcoded regardless of
  transaction type
- Locale drift: HTML uses `en-PH`, ESC/POS uses `en-US` (same transaction
  prints different date formats)
- HTML version uses `formatDate(...)` which returns relative
  ("Today" / "Yesterday") — should be `formatDateTime`

### 13. `BranchDayOpenPrompt` doesn't auto-close when drawer opens — open

Runtime confirmed: opened drawer from the side card; the
"Opening clinic for May 23, 2026?" `AlertDialog` stayed visible as a
layered overlay. Two open dialogs simultaneously.
File: [`apps/frontend/src/features/branch/components/BranchDayOpenPrompt.tsx`](../../apps/frontend/src/features/branch/components/BranchDayOpenPrompt.tsx)

**Wave 1 verification**: the prompt-internal flow (Cancel + "Open drawer"
button paths) was confirmed working. The remaining gap is the external
case where a user opens the drawer from somewhere else while the prompt
is still showing — needs `useEffect` to dismiss on `drawer?.openedAt`
transition.

### 14. Seeded users have no PIN → clock-in flow unusable ✅ shipped [#447](https://github.com/njvil/surevax-cms-revamp/pull/447)

Tested clock-in for Ana Reyes (nurse) and clock-out for Admin User —
both fired `"No PIN set for this user. Ask an admin to set one."` Without
PINs, no per-staff attribution is possible on the kiosk; no demo or QA of
the shift flow works from a fresh seed.

Either seed default PIN (e.g. `1234`) for all test users, OR document a
PIN-seeding step in `gotchas.md` / test-credentials section.

### 15. `BranchDayBanner` shows "open since HH:MM" when no drawer is open ✅ shipped [#447](https://github.com/njvil/surevax-cms-revamp/pull/447)

Confirmed at runtime: banner read `"Branch session · Main Branch Account
· May 23, 2026 · open since 06:16 PM"` while the cash-drawer card said
`"No drawer open. Declare opening float to start the session."`
File: [`apps/frontend/src/features/branch/components/BranchDayBanner.tsx:20`](../../apps/frontend/src/features/branch/components/BranchDayBanner.tsx)

**Resolution**: banner now shows "no drawer open" when `drawer?.openedAt`
is falsy, drawer's `formatTime(drawer.openedAt)` otherwise. No more lying
midnight time.

### 16. Drop `RequireNonBranch` gate so kiosk users can do all clinical workflows ✅ shipped pre-Wave [#439](https://github.com/njvil/surevax-cms-revamp/pull/439)

Per the 2026-05-23 role-posture correction: Branch should reach
`/dashboard`, `/arrivals`, `/encounters`, `/scheduled-orders`,
`/appointments`, `/day-summary`. Today these silently redirect to
`/branch/kiosk` — sidebar shows the links anyway, so clicks fail
silently.

Fix: remove the `RequireNonBranch` wrapper (or expand it to only block
operator routes). The kiosk page becomes the _shift + drawer_ surface;
clinical work happens on the regular pages.
Files: [`apps/frontend/src/App.tsx:127,135`](../../apps/frontend/src/App.tsx) +
`/initiate-protocol` route (App.tsx:257 — not currently behind
`RequireNonBranch` but should be reachable normally)

---

## Active copy / UX (non-blocking, do in a sweep)

### Status / role / entity humanizer drift (~25 sites)

Every site below renders a raw PascalCase/UPPER_SNAKE enum:

- Dashboard roster — `InProgress`, `Completed`
  ([DashboardPage.tsx:383,401,405](../../apps/frontend/src/features/dashboard/DashboardPage.tsx))
- Patient detail protocol-step — `InProgress`
  ([PatientDetail.tsx:147](../../apps/frontend/src/features/patients/components/PatientDetail.tsx))
- Transactions list — mixed `paid · Cash` (lowercase) with `Pending` (Capitalized)
  ([TransactionsPage.tsx:601](../../apps/frontend/src/features/transactions/TransactionsPage.tsx))
- Appointments list — `FollowUp`, `Telemedicine`
  ([AppointmentsPage.tsx:67,564](../../apps/frontend/src/features/appointments/AppointmentsPage.tsx))
- Scheduled order detail — `{order.status}` raw
  ([ScheduledOrderDetail.tsx:123](../../apps/frontend/src/features/scheduled-orders/components/ScheduledOrderDetail.tsx))
- Clinical orders — `{order.status}` raw
  ([ClinicalOrdersPage.tsx:117](../../apps/frontend/src/features/clinical-orders/ClinicalOrdersPage.tsx))
- Bite incidents — `row.followup.status` raw
  ([BiteIncidentsPage.tsx:162](../../apps/frontend/src/features/bite-incidents/BiteIncidentsPage.tsx))
- Inventory transfers — `PendingReceipt` raw
  ([InventoryTransfersPage.tsx:134](../../apps/frontend/src/features/inventory-transfers/InventoryTransfersPage.tsx))
- Inventory lot status — lowercase `out`, `expiring`, `monitor`, `in stock` next to Capitalized `Expired`
  ([InventoryPage.tsx:94-119](../../apps/frontend/src/features/inventory/InventoryPage.tsx))
- Admin → Users — `TenantAdmin`, `BranchAdmin`, `Physician`, `Cashier`, `Nurse` PascalCase
  ([UsersPage.tsx:197](../../apps/frontend/src/features/admin/UsersPage.tsx),
  [UserDetail.tsx:170,198](../../apps/frontend/src/features/admin/components/UserDetail.tsx))
- Admin → Claims — `InReview`, `PartiallyApproved`, `Appealed`
  ([ClaimsPage.tsx:382](../../apps/frontend/src/features/admin/ClaimsPage.tsx))
- Admin → Product Recalls — `Class1` / `Class2` / `Class3` (use `Class I/II/III`)
  ([ProductRecallsPage.tsx:61,249](../../apps/frontend/src/features/admin/ProductRecallsPage.tsx))
- Kiosk staff roster — `TenantAdmin · since 7:55 AM`, etc (runtime-confirmed)
- AdministerDialog — raw `recallSeverity` enum in recall banner
- RecordOutcomeDialog — `NotTested` option not humanized

**Add a `humanizeRole()` helper** (mirrors `humanizeStatus`) — there
isn't one. Codemod all 25 sites in one pass.

### Display-ID hygiene (~15 sites)

Internal `PAT_…` / `TXN_…` / `USR_…` / `ENC_…` rendered to staff:

- Patient surfaces: `PatientList:78`, `PatientDetail:279`,
  `EncounterList:366`, `Step1Identify:194`, `StepDone:83,96`,
  `ScheduledOrderDetail:114`, `ClinicalOrdersPage:112,242,251`,
  `AdverseEventsPage:186,188`, `TransactionsCreatePage:312`,
  `AppointmentDetail:161`
- MRN is **absent from the `Patient` frontend type** — the search
  placeholder `"Search name, MRN, phone…"` is a lie; MRN matches never
  fire. Add `mrn` to `features/patients/api.ts:4`.
- AppointmentDetail has 6 raw-ID fields in the Participants section
  (Patient ID, Provider ID, Branch ID, Location ID, Encounter ID,
  Cancelled by). Resolve to names.
- Audit Log (`/admin/audit`) — raw table names (`users`,
  `staff_time_logs`, `lab_orders`) rendered in the Entity column and
  literal `"Updated users USR_AAAAAAA1"` in descriptions. Backend
  pre-formats the message string at
  [`apps/backend/src/modules/admin/audit/routes.ts:80`](../../apps/backend/src/modules/admin/audit/routes.ts)
  — needs to send structured `{actor, action, entityType, entityId}`
  fields so the frontend can humanize.

Recommended: build `<PatientLabel>` and `<UserLabel>` primitives (name +
secondary ID badge, copy-button for the internal ID). Codemod the leak
sites.

### Currency-format drift

- Three coexisting formatters: `@/lib/format.formatMoney` (new, returns
  `PHP n,nnn.nn`), `@/shared/lib/format.formatPhpAmount` (legacy,
  returns bare number), local `fmtMoney` in
  `AcknowledgementReceipt.tsx:19-24`
- Several call-sites bypass all three with `₱{txn.netAmount}` (raw
  numeric string): `TransactionsPage.tsx:606`,
  `DashboardPage.tsx:463,471`
- Drawer dialogs label fields `(PHP)` while neighbouring KPIs use `₱` —
  same dialog set, two prefixes

Consolidate on `formatMoney`; codemod ~6 violation sites.

### "Recompute" / "backfill" jargon on Scheduled Orders

6 user-visible strings on `ScheduledOrdersPage` use developer
terminology. Replace with operational language ("Reschedule", "Past
doses", "Schedule needs updating", "N courses have a missed dose —
review and reschedule"). Citations in audit notes.

### "FEFO" appears 6+ times

Inventory page + arrivals Step 3 + StepDone + InitiateProtocol. Decide:
either expand once with `<AcronymHint>`, or commit to FEFO as domain
term and add a glossary.

### Dialog conventions

- **Title casing inconsistency** — half the dialogs use Title Case
  ("Open Cash Drawer"), half use sentence case ("Void transaction").
  Pick one (sentence case matches design-system primitives).
- **Cancel-label drift** — `ClockInModal: "Not now"`,
  `ArrivalsPage: "Keep going"`, `DryRunDialog: "Close"` instead of
  `"Cancel"`. Normalize.
- **11 dialogs missing `DialogDescription`** (a11y nit) — list in audit
  notes.
- **4 dialogs still use free-text raw-ID inputs** (no picker):
  - `NotificationsPage` Dry-Run — patient ID
  - `ClaimsPage` new claim — patient ID
  - `ShipTransferDialog` — lot ID
  - `ProductRecallsPage` new recall — service ID (also uses stale
    `SVC-` prefix)

  Same pattern as the pre-Wave-2 patient inputs that got
  `<PatientPicker>`. Build `<LotPicker>` and `<ServicePicker>`,
  codemod.

### Toasts

- Raw display IDs interpolated into toast descriptions:
  `VoidDialog:45`, `RefundDialog:45`, `ApplyPrepaymentDialog:73`
- Generic `'Error'` titles in `UserCreateForm:79`, `LabOrderDetail:84`
- Dev jargon: `'Protocol initiated (preview mode)'`, `'Dry-run failed'`
- Hardcoded `'Please try again.'` overrides `apiErrorMessage` in
  `PatientForm:286,300`, `EncounterForm:106` — users never see the
  real reason (e.g. 409 duplicate MRN)

### Form validation

- ~75 Zod validators emit raw English defaults
  ("String must contain at least N character(s)", "Number must be
  greater than or equal to N"). Highest-impact in `packages/shared`
  patient/encounter/clinical-order schemas.
- Backend error messages leak camelCase field names:
  `'incidentDate must be YYYY-MM-DD'`,
  `'openingFloat must be a valid decimal amount'`,
  `'contentHashSha256 must be 64 lowercase hex chars'`. Rewrite.
- Vitals errors lack clinical context: `'Too low'`/`'Too high'` with
  no range. Add `'Too low (normal ≥ 60 bpm)'` style messages.
- Schema parity drift: `packages/shared/src/schemas/patient.ts`
  requires `sex` + `dateOfBirth`; `PatientForm.tsx` marks both
  `.optional()`. Pick one.
- `packages/shared/src/schemas/auth.ts.loginSchema` has
  `password: z.string().min(8)` — that's a registration shape;
  LoginPage uses its own inline `min(1)`. Rename or split.
- Password complexity not communicated upfront — `UserCreateForm`
  placeholder `"Min 8 characters"` is the only hint.

### Hardcoded chrome

- `AppShell.tsx:488,523` — `"QC-01 · Quezon City"` and `"${user?.role}
· QC-01"` string literals
- `BranchesPage.tsx:91-92` — KPI cell hardcoded `SVX`
- `TransactionsPage.tsx:266` — `Drawer #12` hardcoded session number
- `BranchKiosk.tsx:175` — `"SureVax · Staff Kiosk"` hardcoded brand
- `TransactionReceiptPage.tsx:13-18` — `CLINIC` constant hardcodes
  name/address/phone (comment acknowledges Phase 2 will pull from API)

### "SOON" / stub inventory

Pages that are entirely stubs: `/cold-chain`, `/reports`, `/settings`.
ComingSoonButtons that block primary workflows:

- Inventory "Receive shipment" (the actual inventory-in flow)
- Encounter list "New Encounter"
- Patient detail "Print" / "Edit" / Health card
- Day Summary "Email" / "Download report"
- Standing Orders "New protocol"
- Payer Profiles "Add payer" / "Claim ledger"
- Partner Labs "Add partner lab"
- Approvals "History"

Decide per-stub: hide entirely, finish, or replace `<ComingSoonButton>`
tooltip dev-speak ("wiring deferred" → "Coming soon").

### Layout primitives

- `DashboardPage:220` hand-rolls its own KPI strip + local `KpiCell`
  instead of using `@/components/layout`. **Two components named
  `KpiCell`** in the codebase.
- DirtyFormGuard SPA-nav blocker disabled because app uses
  `BrowserRouter` not `createBrowserRouter` (acknowledged at
  [DirtyFormGuard.tsx:22-30](../../apps/frontend/src/components/DirtyFormGuard.tsx)).
  Tab-close works; in-app nav doesn't.
- `NotificationTemplateDialog:156-231` — required fields lack the
  destructive-asterisk convention.

### Navigation gaps

Routes that exist as pages but have no sidebar entry:

- `/clinical-orders` — real worklist
- `/bite-incidents` — real surface
- `/initiate-protocol` — only reachable via redirect from `/standing-orders`
- `/cold-chain`, `/reports`, `/settings` — stubs but in `ROUTE_LABELS`

Recommended: add `/clinical-orders` and `/bite-incidents` to the Records
group nav. Hide the stubs or finish them.

### Kiosk-specific

- `PinKeypadDialog` has no on-screen keypad despite the name — it's a
  numeric `<input type=password>`. Touchscreen kiosks would expect
  large tap buttons. Either implement the keypad or rename to
  `PinEntryDialog`.
- Kiosk roster shows raw role names (`TenantAdmin`, `Physician`, etc.)
  — same humanizer issue as elsewhere.
- "Branch session" header copy — Worker B suggested "Cash session" or
  "Clinic session"; given the role-posture correction it's the
  _clinic-day_ state, so "Clinic day" is probably right.
- Day Summary uses `"Snapshot the day?"` / `"Re-snapshot"` for the
  end-of-day action. Operational language: `"Close day"` / `"Re-record
day summary"`.

---

## Reframed (no longer ship-blockers under deferred-role posture)

These were flagged as security/role findings in the raw audit; the
2026-05-23 correction downgrades them. Listed for completeness so they
don't re-surface in future audits.

| Original finding                                                                                                                                                                                      | Reframed                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "5 backend routes mounted without `requireRole`" (`/api/audit`, `/api/product-recalls`, `/api/adverse-events`, `/api/bite-incidents`, `/api/payer-profiles`, `/api/partner-labs`, `/api/cash-drawer`) | Intentional under deferred-role posture. Re-add gates when role-gating phase begins.                                                                     |
| "Branch can browse /patients (PHI exposure)"                                                                                                                                                          | Intentional — Branch is shared clinic access.                                                                                                            |
| "Branch can see all transactions + New Transaction button"                                                                                                                                            | Intentional.                                                                                                                                             |
| "/initiate-protocol not behind RequireNonBranch"                                                                                                                                                      | Intentional — Branch should reach all clinical surfaces.                                                                                                 |
| "Stale `SuperAdmin` references in `usersApi.ts:9,18`, `standing-orders/api.ts:232`, backend `admin/users.ts:130,275`"                                                                                 | Cleanup, low priority while roles are deferred.                                                                                                          |
| "Silent permission denials (non-admin → /admin/users)"                                                                                                                                                | Admin routes ARE legitimately gated (separation between admin config UI and clinic floor). Keep, but add a centralized "Not authorized" page eventually. |
| "Nurse default-path `/arrivals` is dead code because `/arrivals` not in `ROUTE_REGISTRY`"                                                                                                             | Still a real bug if/when role-aware landing is enabled. Keep as a lurking issue, not urgent.                                                             |

---

## What's still NOT covered

Honest residual gaps after Phase 1, Phase 2, and the Branch role-walk:

### Workflows never run end-to-end

- **Patient registration** — form filled, submitted, record verified
- **Encounter creation from `/encounters/new`** (button is ComingSoon
  anyway)
- **Edit patient** (modal opened? — not exercised)
- **Add allergy / Add condition / Edit emergency contact** inline
  flows
- **Arrivals wizard for WHO category I and III** — only II walked
- **Arrivals wizard for non-Rabies specialty** (Flu, Vaccination,
  General) — only Rabies walked
- **Full transaction create → record payment → see receipt** —
  blocked by Day-0 ARV gate during the walk
- **Refund flow** end-to-end
- **Void flow** end-to-end
- **Payment with each method** (Cash, GCash, Bank, PhilHealth, HMO)
- **BIR senior/PWD discount applied**
- **Apply prepayment** to a draft (the dialog with the `PHP PHP` bug)
- **Cash drawer close with variance** (over/short) — never typed a
  count, didn't see the variance copy
- **Day Summary "Close day" / "Re-snapshot"** flow
- **Inventory receive shipment** — ComingSoon stub
- **Adjust / quarantine lot** — no UI path exists at all
- **Inventory transfer ship → confirm receipt** end-to-end
- **Lab order: enter result manually** (form opened?)
- **Lab order: upload result PDF** with a real file
- **Critical-value acknowledgment** flow
- **Bite incident new + 14-day outcome** end-to-end
- **Adverse event new** — submit succeeded silently, no follow-up
  verified
- **Standing-order template version bump** flow
- **External-dose append** to a series
- **Notification template create + dry-run actual send**
- **Approval request approve/reject** — seed has zero approvals
- **Cross-midnight kiosk day-rollover** (toast in
  `BranchKiosk.tsx:46` — not triggered)
- **Recall affecting an existing lot** — AdministerDialog has logic
  but no recall in seed
- **Health card download** — endpoint works; PDF visual not inspected
- **Branch session day-open / day-close** beyond the open path

### Surfaces never visually rendered

- All `/operator/*` (platform admin console)
- `/admin/branches/:id` (branch detail)
- `/admin/attendance` (sidebar entry exists, not opened)
- `/admin/partner-labs` (sidebar entry exists, not opened)
- `/admin/payer-profiles` detail
- `/admin/notification-templates` create/edit dialog rendered
- `/cold-chain` — entirely stub
- `/reports` — entirely stub
- `/settings` — entirely stub
- Receipt page actual print preview (`/transactions/:id/receipt`)
- ESC/POS thermal output (no thermal printer attached)
- Print stylesheet (`@media print` behavior at the rendered HTML
  level)

### Interaction layers never exercised

- **Keyboard navigation / focus order / focus trap** in every dialog
- **Screen-reader / aria** behavior anywhere
- **Color-contrast / axe-core a11y scan**
- **Mobile / tablet viewport** (the kiosk is presumably tablet-sized
  — never tested at that breakpoint)
- **Dark mode** (theme toggle exists?)
- **Tagalog `fil-PH` UI swap** — never tested
- **Loading skeletons** — most lists were already populated
- **ErrorBoundary fallback rendering** — never triggered an error
- **404 page copy** — only confirmed exists via `/admin` typo earlier;
  not visually inspected
- **Empty states on lists that had data** (Patients empty, Encounters
  empty, Inventory empty, Scheduled Orders empty, Lab Orders empty)
- **Date picker / combobox / multi-select interaction text** (calendar
  open, type-ahead, etc.)
- **Tooltip copy** on `<AcronymHint>` (`FEFO`, `PEP`, `PrEP`, `WHO
category I/II/III`, `VIS`, `FAT`, `PRC`, etc.) — none hovered
- **Refresh-token rotation** in a long-running session (>15min idle)
- **`row_version` conflict** — concurrent edit collision behavior
- **Search / filter / sort interactions** on every list

### Backend behaviors / boundary tests

- **Pre-survey of audit chain** (correlation_id / ip_address previously
  showed `—`; 360 review H2 shipped 2026-05-23)
- **`format:check` CI gate** — not run by this audit
- **Schema parity sweep** (DB ↔ Zod ↔ frontend type) — only sampled
- **Database constraints fire on bad input** (negative_inventory CHECK,
  paid-txn immutability trigger)
- **Refresh-token family revocation** path
- **Email template rendering** (zero templates in seed)
- **Branch-day open with prior-day loose ends** — only happy path

---

## Suggested sequencing

### Wave 1 — ship-blockers (~1 day)

Findings 1-16 above. Most are <50 LoC each. The PinKeypadDialog
(B21) and the seed-PINs item (B22 / finding 14) can be deferred only if
the kiosk shift-attendance workflow is not part of the immediate demo.

### Wave 2 — humanizer sweep (~0.5 day)

Add `humanizeRole()`, codemod 25 sites for `humanizeStatus()` /
`humanizeRole()` adoption.

### Wave 3 — ID hygiene + pickers (~1 day)

Add `mrn` to Patient type; wire MRN to list/search/cards. Build
`<PatientLabel>` / `<UserLabel>` primitives, codemod ~15 leak sites.
Build `<LotPicker>` / `<ServicePicker>` / `<PhysicianPicker>`, replace
4 free-text dialog inputs. Refactor backend `audit/routes.ts:mapMessage`
to emit structured fields so frontend can humanize.

### Wave 4 — currency consolidation (~0.5 day)

Single `formatMoney` across the app, kill `₱{x}` raw concat sites,
unify dialog labels (`(PHP)` vs `₱`).

### Wave 5 — receipts + BIR (~1 day)

Per finding 12: header fields, VAT breakdown, signature lines, single
receipt number, locale unification, dynamic footer. Probably needs
clinical/ops sign-off on the exact BIR-required strings.

### Wave 6 — dialogs polish (~0.5 day)

Pick title casing convention, pick cancel-label convention, add
missing `DialogDescription` to 11 dialogs, fix `PHP PHP` doubled
prefix (already in Wave 1).

### Wave 7 — forms validation copy (~0.5 day)

Add custom Zod messages for the ~30 most-likely-to-trigger validators;
rewrite backend Zod messages to remove camelCase field names; expand
acronyms (FAT, VIS); reconcile patient-schema parity; rename/split
`loginSchema`.

### Wave 8 — nav + chrome (~0.5 day)

Add `/clinical-orders`, `/bite-incidents` to Records nav. Replace
hardcoded `QC-01 · Quezon City`, `SVX`, `Drawer #12`, kiosk brand,
receipt clinic with auth-context / API values. Drop `RequireNonBranch`
gate (finding 16) so Branch can reach Today group.

### Wave 9 — verification of uncovered (1-2 days)

A focused QA pass covering the "not covered" list above. Probably
worth seeding the data needed first (notification templates, an
approval request, a product recall, a lab result for upload testing,
PINs for kiosk).

---

## Wave 10 — E2E verification pass (2026-05-23 addendum)

Drove every primary workflow as TenantAdmin against the running app
right after the audit. Findings below are **new** issues uncovered
during runtime — they layer on top of B1-B26 from the original audit
above. Issues with `B27+` IDs are introduced here.

> **Coverage tracker:** which workflows were actually driven E2E vs
> which remain unverified is tracked in a separate handover:
> [`2026-05-23-preview-workflow-coverage.md`](2026-05-23-preview-workflow-coverage.md).
> This section captures the _findings_; that doc captures the
> _coverage gap_ and proposes a Wave-11 plan to close it.

### NEW ship-blockers from the E2E pass

#### B27. `<PatientPicker>` does not commit selections

**Two safety-critical surfaces cannot submit.** Typing a search query

- clicking the matching candidate row leaves the form's `patientId`
  empty. Submit then fails with `"Patient ID is required"`.

Runtime-confirmed in:

- **CaptureIncidentDialog** (`/bite-incidents`)
- **ReportAdverseEventDialog** (`/adverse-events`)

Likely affects every dialog wired to `<PatientPicker>` — Worker B
identified 4 such dialogs (NotificationsPage Dry-Run, ClaimsPage new
claim, plus the two above). All four are unfileable end-to-end until
this is fixed.

Probable cause: candidate-click handler doesn't fire
`field.onChange(patient.id)`. File:
`apps/frontend/src/components/forms/PatientPicker.tsx` (and the form
integration in each consumer dialog).

#### B28. Arrivals "04 Draft transaction" step is unwired

The Step 3 commit page promises:

```
04  Draft transaction
    TXN draft will be created in next iteration
```

The dev string `"in next iteration"` is **live in the production UI**.
After commit, the cashier lands on `/transactions` with no pre-filled
draft for the new patient. The atomic-commit handoff is half built.

Either wire the draft TXN write into the atomic-commit transaction OR
remove the "04 Draft transaction" step from the wizard until it ships.

#### B29. Bite Assessment renders for ALL specialties

On `/arrivals/encounter`, the entire Bite Assessment block (WHO
category, Animal type, Animal status, Animal profile, Disposition,
Wound site, Prior PEP, etc.) shows regardless of specialty. A Flu /
Vaccination / General visit gets asked rabies-exposure questions.

Should be gated on `specialty === 'Rabies'`.

#### B30. "Day-0 ARV blocked until payment commits" banner fires for non-ARV

Confirmed live during a Flu-Annual commit: the banner reading `"Day-0
ARV blocked until payment commits. Cashier settles draft → Administer
button unlocks automatically"` appeared. Condition is checking "Day-0
service exists" instead of "Day-0 ARV service exists".

#### B31. TransactionsCreatePage "On commit · what writes" sidebar exposes the DB write sequence

Visible on every transaction the cashier creates:

```
01  Payment row        method=cash · ₱0.00 tendered
02  Receipt issued     BIR-compliant · OR-… auto-numbered on payment
03  State transition   Awaiting payment → Paid
04  Audit chain        append signed entry · cashier AU
```

That's the database write sequence as cashier-facing UI copy. Should
be removed entirely. Also note "BIR-compliant" is asserted here
despite the receipt-template audit (B19) finding multiple BIR gaps.

#### B32. Transaction line-item dropdown shows raw codes

The service `<select>` (~120 options) renders each option as
`LAB_ABO_RH:LAB_ABO_RH` — the code as both value AND label. Cashier
would need to memorize all catalog codes to pick a service. The data
is there (selecting a row populates the proper name + price); only
the dropdown labels are wrong. Should be name with code as secondary
text, ideally a searchable combobox.

#### B34. Lab result Critical interpretation error is backwards

Setting Interpretation=Critical on a lab result returns server-side
validation `"Lab order does not have a critical value"`. The user
just declared the result Critical, so the message contradicts the
action. Either the workflow requires a prerequisite "mark this
order as critical-pending" step that isn't surfaced, or the message
needs rewording.

#### B35. `Save as draft` on TransactionsCreatePage is silent no-op

Click produces no toast, no validation message, no navigation. No
backend call fires (per server logs). Either RHF validation silently
blocks without scroll-to-error OR the button is unwired. Either way
the cashier has no feedback that the save attempt produced nothing.

#### B36. Currency formatter inconsistent mid-row

On TransactionsCreatePage, after selecting `FLU_QUAD`: unit cell
renders `₱1,200.00` (with thousand separator), total cell renders
`₱1200.00` (no separator). Same row, two different formatters.

#### B37. `BankTransfer` payment method label rendered raw

AddPaymentDialog method dropdown shows
`Cash / GCash / Maya / BankTransfer / Card / HMO / Corporate` — PascalCase
`BankTransfer` should be `"Bank Transfer"`.

#### B38. Cancelled dialogs linger in DOM

After clicking `Cancel` on AddPaymentDialog, the dialog stayed mounted.
Subsequently clicking `Void` produced a layered state where my
`textarea` set landed in the stale AddPayment Notes field instead of
the new Void Reason field. Multi-dialog state mismanagement — Radix
portal cleanup issue.

#### B39. `DirtyFormGuard` `beforeunload` blocks programmatic navigation

On `/transactions/new`, `window.location.href`, `.assign`, and
`.replace` all silently failed. Only a real anchor click navigated.
This is the `beforeunload` listener (per
[DirtyFormGuard.tsx:22-30](../../apps/frontend/src/components/DirtyFormGuard.tsx))
— headless preview can't dismiss the prompt. Real users see the
"Leave site?" prompt; scripted tests / Playwright / smoke automation
hit a silent block.

Acceptable for tab-close; **not** acceptable for in-app SPA navigation
(the SPA-nav blocker was already disabled per audit B), so this is a
mix where the `beforeunload` is now over-broad. Consider whether
`beforeunload` should fire when the form has been auto-filled by the
arrivals handoff vs only when the user has typed.

#### B40. Detail rails show raw bigint user IDs (worse than predicted)

Phase-2 audit predicted `createdById` would render as a raw display*id
(`USR*…`). Runtime is worse:

- TransactionDetail `Created by: 5`
- LabOrderDetail `Created by: 2`

The bare integer is shown — the backend response doesn't even
include a display_id or name for the `createdBy` relation. All 11
drawers Worker D flagged are likely emitting bare integers.

Fix: backend response includes
`createdBy: { id, displayId, firstName, lastName }` instead of just
`createdById: number`.

### Confirmed at runtime (existing audit findings now verified live)

| Original ID                                                                     | Verified                                                                                                           |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| B5 / B12 — `/initiate-protocol` Preview mode badge + UUID + "follow-on PR" copy | Live                                                                                                               |
| Raw display_ids in toasts                                                       | Live: `Transaction voided / TXN_TCTXZ83D`, `Refund recorded / TXN_0ACPV3TH`, `Patient registered Walker, Audit`    |
| Mixed status casing                                                             | Live: `paid · Cash` lowercase vs `Pending` capitalized in /transactions list                                       |
| Raw `TenantAdmin · QC-01` in topbar                                             | Live                                                                                                               |
| MRN absent from frontend                                                        | Live: new patient detail shows `PAT_A1CWVKJW · DOB Jun 15, 1990` only                                              |
| `Drawer #12 · 0.00 · NN into shift` hardcoded                                   | Live; `NN into shift` is a live computed value (`10:49 into shift` later in session), but the phrase itself is odd |
| Service catalog hidden constituents visible (B2)                                | Live in the transaction line-item dropdown — `LAB_AMH`, `LAB_ALBUMIN` etc. appear alongside orderable services     |
| Day Summary "Snapshot the day?" verb mismatch                                   | Live: button says `Close day`, dialog title says `Snapshot the day?`                                               |
| Audit Log raw table names + raw display IDs in entries                          | Live (verified earlier in audit pass)                                                                              |
| Clinical Orders worklist raw `ORD_0000000Q` IDs + raw `Standing_Order` enum     | Live                                                                                                               |
| `"BIR-compliant"` claim despite gaps                                            | Live in TransactionsCreatePage sidebar                                                                             |
| `Lab order marked Sent.` toast (vague — no patient/order context)               | Live                                                                                                               |

### Workflows attempted in this pass

| Workflow                               | Result      | Notes                                                                                                        |
| -------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------ |
| Patient register E2E                   | ✅ shipped  | New `PAT_A1CWVKJW` created; navigated to detail page                                                         |
| Arrivals wizard (Flu, non-Rabies)      | ✅ shipped  | `ENC_BJVRA8PD` + `PSO_X3DZ3HVX` created; exposed B28/B29/B30                                                 |
| Hand-off to billing                    | ❌ broken   | No pre-filled draft — B28                                                                                    |
| Void transaction                       | ✅ shipped  | TXN_TCTXZ83D voided                                                                                          |
| Refund transaction                     | ✅ shipped  | TXN_0ACPV3TH refunded                                                                                        |
| Lab order Mark Sent                    | ✅ shipped  | LBO_JDAMS5QY marked Sent                                                                                     |
| Lab order Save Result (Critical)       | ❌ broken   | Backend rejected with backwards error — B34                                                                  |
| Bite Incident new                      | ❌ blocked  | PatientPicker doesn't commit — B27                                                                           |
| AEFI new                               | ❌ blocked  | PatientPicker doesn't commit — B27                                                                           |
| Save as draft TXN                      | ❌ silent   | No backend call, no error — B35                                                                              |
| Full transaction commit with payment   | ❌ blocked  | Currency input rejected programmatic value-set; needs a real user or keyboard-driven test                    |
| Apply prepayment dialog (PHP PHP bug)  | not reached | No prepayment-state TXN in seed; would need to create one first                                              |
| Cash drawer close **with** typed total | not run     | Same currency-input limitation; source-confirmed variance copy = signed number, red/green, no "Over"/"Short" |
| Day Summary "Close day" actually fired | not run     | Didn't want to mark live day closed; source-confirmed `Snapshot day` verb in confirm                         |

### Residual gaps after Wave 10

Workflows still not exercised end-to-end (Wave-10's "not run" entries
become the new Wave 11 / 9 list):

- Full payment flow with each method (Cash / GCash / Maya / Card / HMO / Corporate)
- BIR senior/PWD discount applied
- ApplyPrepaymentDialog `PHP PHP` doubled prefix bug (B11) — needs a prepayment in seed
- Cash drawer close with a counted total
- Day Summary "Close day" submitted
- Lab result entry with non-critical interpretation
- Critical-value acknowledge flow (gated by B34)
- Upload Result PDF
- Inventory transfer ship → confirm receipt
- External-dose append
- Notification template create + dry-run actual send
- Approval request approve / reject (seed empty)
- Cross-midnight kiosk day rollover
- A11y (keyboard nav, screen reader, axe-core, contrast)
- Mobile / tablet / dark mode / Tagalog `fil-PH`

### Updated wave plan after Wave 10

**Wave 1 (ship-blockers) expands** with the new B27-B40 items above.
Highest priority within Wave 1 is **B27 (PatientPicker)** — two
safety-critical clinical surfaces (AEFI report + Bite Incident) cannot
be filed at all today. After that comes **B31 (DB-write sidebar)**
because it's the most visible dev-language leak, and **B28+B30+B33**
because the arrivals → billing handoff is the most-walked path and
currently exposes "in next iteration" copy + a mis-fired payment-gate
banner.

The previous Wave 9 (verification of uncovered) is renumbered **Wave 11**
and the items it covers are explicit in the "Residual gaps" list
above. Seed data needed first: prepayment-state TXN (for B11), PINs
for all test users (for B22), a few approval requests, a recall row,
notification templates, a lab order with `criticalValue=true` flag.

---

## Working notes / source

The full per-worker reports (4 phase-1 + 6 phase-2 auditor outputs)
plus the foreground browser walk transcripts are in the session
history at the `affectionate-beaver-890f65` worktree (2026-05-23
session). Reference the `B##` identifiers in the audit findings if you
need to look up any individual finding.

The two foreground browser walks that produced runtime confirmation:

- **TenantAdmin walk** — dashboard, patients, encounters, arrivals
  wizard steps 1-3 (rabies, WHO category II, ERIG selected, blocked
  at commit by payment gate), transactions, day-summary, inventory,
  appointments, adverse events, services, admin users, admin
  notifications, admin audit, /clinical-orders detail, /initiate-protocol
- **Branch role walk** — kiosk landing, drawer open (PHP 5,000),
  layered AlertDialog bug, PIN keypad missing, no PINs seeded for any
  user, "Branch session · open since" misleading time, /patients
  reachable, /transactions reachable + "New Transaction" visible,
  /inventory reachable, /admin/users blocked (correct),
  /adverse-events reachable
