# SureVax CMS: Status & Backlog

> **The living source of truth** for current state, open work, and the deferred
> backlog. Undated on purpose: edit this file in place as work lands. Do not
> fork a dated copy. Dated session notes live under
> [`handovers/`](handovers/) and point _here_ for the backlog rather than
> restating it.
>
> **Last reconciled:** 2026-08-23: the repository-side remediation for the live
> Branch-account audit is implemented in the current candidate, including the
> P0/P1 boundary fixes, P2/P3 usability corrections, post-administration
> observation, named work ownership, direct-registration consent, external-dose
> review, and atomic split tender. The pilot decision remains **NO-GO** until
> the candidate is deployed to a disposable seeded environment and the live
> nurse/cashier acceptance and hardware checks below pass. See
> [Latest live-use gate](#branch-account-audit-2026-08-23)
> and the
> [evidence-backed audit](audits/2026-08-22-branch-account-live-usability.md).
>
> The integration candidate also adds repository-side Phase-1 compliance and
> incident-response controls, corporate/group billing, Runtime Review Center
> Phase 1, branch-wide durable cash-drawer ownership, and revenue-integrity
> reporting. Those additions do not override the live-use gate. External
> production evidence, payer-facing disclosure/tax-document policy, and the
> audit's P0/P1 acceptance tests remain unresolved. See
> [`runbooks/pilot-go-live.md`](runbooks/pilot-go-live.md),
> [`specs/review-center-phase-1.md`](specs/review-center-phase-1.md), and the
> [current implementation records](README.md#current-implementation-records).
>
> The AppSheet migration source/evidence model indexes the live Drive database,
> 13 local tracker exports, 14 live clinic trackers, copied-sheet quarantines,
> and a 26,407-row read-only pre-cutover profile. Trials V/W prove a restart-safe
> disposable local import, but not production cutover readiness. See
> [`migration/appsheet/WHAT-REMAINS-BEFORE-CUTOVER.md`](migration/appsheet/WHAT-REMAINS-BEFORE-CUTOVER.md).
>
> **Previous reconciliation:** 2026-07-30: a pass driven by cross-checking the live
> AppSheet export sheet-by-sheet against the code, which closed the
> administering-clinician attribution gap, made the payer selectable at
> settlement, seeded the clinic's real branches / nursing roster / payer tiers,
> and rebuilt the patient intake form. See the first "Shipped recently" block
> below. Prior reconciliation was 2026-07-28 (against commits through #581: the UX audit
> #577, type scale #578, Tier-1 fixes #580, and the patient-accounts /
> receivables batch that landed after them; this pass also folds in the
> nurse-testing readiness assessment, [`nurse-testing-readiness.md`](nurse-testing-readiness.md),
> and its seed-inventory fix). This reconciliation additionally folds in five
> fixes that landed the same day on top of that assessment: cross-branch
> patient masking plus break-glass, allergies and conditions masking, the
> SMS-reminder QR feature, the dose-worklist branch scoping, and the SC/PWD
> VAT correction. A later pass the same day folds in the readiness suite's
> first real execution against a live seeded stack (17 passed, 5 skipped, 0
> failed), the two fixes that pass surfaced (`Branch` on inventory-transfer
> ship/receive/cancel, and accessible names on the split-tender controls),
> a correction to a wrong "already fixed" claim about product-recall patient
> notification, and two new go-live data blockers found alongside it (the
> data-migration production loader, and the R9/R10 migration blockers). A
> further pass the same day folds in the batch that cleared the readiness
> doc's whole "week one" list: split tender at the dose-worklist collect
> step, specific copy on all ten administer failure codes, a prepay entry
> point on the patient chart, hiding Cancel pending for non-admins with a
> real error path, in-app inventory receiving, and the cash-deposit-to-bank
> ledger (an AppSheet gap, not one of the ten workflows); plus two bugs that
> batch exposed and fixed (a statusCode/httpStatus mismatch that turned every
> structured inventory-transfer error into a 500, and worklist branch scoping
> that missed a visiting patient's own encounter), and one newly-open bug it
> found and did not fix (`clinical_orders.indication` is never written by any
> in-app path, so the patient chart's standing-order card always reads empty).
> A pass on 2026-07-27 folds in a five-way "modeled but not wired" sweep across
> seven commits: it wired the dead product-recall notification fan-out
> (closing P0 #21), enforced physician authorization server-side, opened the
> audit-write mount to clinical roles, deleted an analytics consumer that
> could never execute a row and fixed five live SQL errors in the batch worker
> it left standing, corrected three frontend surfaces that silently reassured
> when the truth was unknown, repaired claim-status-advance and made
> standing-order-template editing real, and cleaned up a batch of stale doc
> references. The same sweep surfaced roughly twenty more "modeled but not
> wired" findings now tracked below, none fixed yet: `encounters.status`
> frozen at Open forever, void/refund manager-approval thresholds unenforced,
> several dead enum states, and more. A pass on 2026-07-28 folds in six
> commits that cleared most of that list: encounters now have a real, audited
> complete/cancel lifecycle; void and refund approval thresholds are enforced
> with a same-transaction gate; branch settings finally have a write path so
> the BIR-official-receipt flip is reachable, not just designed; two silent
> claims bugs are fixed and payer-contract listing/create are wired;
> `clinical_orders.indication` is now written going forward, so the patient
> chart's standing-order card and dose strip render real data for any patient
> registered from now on; and print/export actions are now audited across
> five surfaces. Left open on purpose and moved to the right buckets below:
> the `indication` backfill for pre-existing courses (an owner decision),
> payer-contract editing, a pre-existing `patients/contract.ts` response-type drift the
> dose-strip change widened, and the day-summary CSV export stub. Prior
> consolidation history is archived under
> [`handovers/archive/`](handovers/archive/) (e.g. the 2026-05-24
> state-of-the-art snapshot and the 2026-05-23 browser-verification tracker).

---

## Where things stand (the one-paragraph truth)

SureVax CMS has broad Phase 1 workflow coverage and substantial backend safety
infrastructure, but it is **not ready for a supervised clinic pilot**. The
repository now contains the Branch-account audit remediation, but implementation
and component/unit evidence are not a substitute for rerunning the rendered,
database-backed workflows that originally found the failures. Every environment
still runs `NODE_ENV=development` with synthetic data. The next milestone is not
feature expansion: deploy this candidate to a disposable seeded environment,
close the acceptance register below, and reconcile one complete clinic day
before revisiting pilot approval.

## Included in the integration candidate: corporate/group billing

PR [#615](https://github.com/njvil/surevax-cms-revamp/pull/615) implements the
smallest safe corporate/group-billing slice. It is additive: the existing
transaction remains the authoritative money engine, while a one-to-one
`group_bills` sidecar makes the corporate payer—not the compatibility-header
patient—the AR owner. `transaction_patients` and `transaction_items` retain exact
patient/service attribution.

Delivered and reviewed:

- one branch + one active Corporate payer + two or more real patients per group
  bill, with exact totals and no placeholder patient;
- shared Zod create/payment contracts, generated frontend types, group bill
  create/list/detail/payment/void API paths, and focused create/review UI;
- payer-owned AR with linked group transactions excluded from patient balances,
  patient pay-on-account, credit, and prepayment consumption;
- database-first tenant/branch isolation, audit/PHI provenance, idempotent create,
  exact payer/payment matching, whole-group lifecycle boundaries, and a
  concurrency-safe one-live-bill-per-clinical-order guard;
- atomic reuse of the existing transaction fan-out, so inventory and clinical
  completion behavior are not reimplemented or split across commits;
- adversarial remediations for four bypasses: patient credit settling corporate
  AR, generic lifecycle routes bypassing group admin rules, retry duplication,
  and wrong-patient/wrong-service clinical-order linkage.

Publication and verification state:

- implementation commit `bb3c51a` on `codex/corporate-group-billing`;
- initial GitHub CI: build/typecheck and Playwright passed; backend CI exposed a
  fixture collision because the new patient-credit test reused a seeded patient
  modified by another integration file;
- the test now owns disposable patients and consent rows; the full local backend
  suite passes (47 files, 396 tests), alongside 2 focused frontend tests, 3
  Chromium Playwright tests, and a clean `pnpm agent:check`;
- merge remains pending review and a green rerun of the updated branch.

Before broadening this slice, keep these gates explicit:

1. Merge/release review must preserve exact allocation, the group lifecycle admin
   boundary, payer identity checks, and database RLS/trigger enforcement.
2. No payer-facing portal/export/API or additional patient disclosure ships until
   the Privacy Owner records purpose, lawful basis/notice position, DSA, minimum
   field set, retention, and access/audit rules.
3. No acknowledgement/reference is relabelled as a tax invoice. Finance/tax owners
   must approve form, numbering, branch configuration, and operating procedure.
4. AppSheet migration remains P0 #4. The ADR defines a compatibility contract but
   does not authorize importer changes, invented allocations, or direct writes.
5. Payer aging/statements, partial credit/rebill, claims/EDI, mixed patient share,
   multi-payer/multi-branch bills, tenant billing, and campaign CRM remain deferred
   Phase 2 work—not PR #615 follow-ups to slip into review.

### Runtime Review Center Phase 1

PR [#616](https://github.com/njvil/surevax-cms-revamp/pull/616) is included in
the integration candidate and is **not on `main` until the integration PR is
merged**.

- One authorized branch worklist at `/review-center` now answers “what needs
  attention now?” from current runtime state, without querying AppSheet
  migration-review artifacts.
- The two complete queues are missing guardian information for minors and
  prior Manila-day loose ends: stale encounters, unsettled non-prepayment
  transactions, prior Open drawers, and administrations without a documenting
  actor.
- Guardian correction previews commit effects and uses one optimistic, audited,
  same-branch database transaction. The center never auto-merges patients,
  infers identity, marks a dose administered, completes a clinical record,
  settles money, or closes a drawer.
- Existing Approvals and Cross-Branch Access reviews stay separately owned and
  are linked rather than duplicated.
- Cash-drawer ownership is now branch-wide and durable across day rollover.
  PostgreSQL enforces one Open drawer per tenant+branch, and the forward
  migration fails rather than silently rewriting conflicting financial
  history.
- Three adversarial review passes closed all reported P0–P2 issues. Local
  backend, frontend, E2E, migration-idempotency, and `pnpm agent:check` checks
  passed; all GitHub CI jobs passed. Exact evidence and decisions are in the
  [dated implementation handover](handovers/2026-08-23-review-center-phase-1.md).

### Revenue-integrity reporting

PR [#618](https://github.com/njvil/surevax-cms-revamp/pull/618) replaces the
Reports ComingSoon shell with a bounded Phase-1 revenue-integrity surface: AR
aging, administered-but-unbilled work, reconciliation exceptions, and one-day
branch transaction/tender/drawer/deposit truth. The stable daily CSV is
server-generated and cannot be delivered unless its SHA-256-bound `EXPORT`
audit row commits. Role and scope are explicit: tenant scope is admin-only;
Cashier/Branch remain branch-scoped; Nurse/Physician see only the unbilled
clinical worklist. The implementation does not invent balances, historical AR,
accounting-recognition events, or a generic analytics layer. Full investigation,
contract, decision, review, verification, and limitation record:
[`handovers/2026-08-23-phase-1-revenue-integrity-reporting.md`](handovers/2026-08-23-phase-1-revenue-integrity-reporting.md).

## Shipped recently (2026-08-03, correcting money without rewriting the record)

Started as "can a nurse fix a mis-keyed payment method", ended up closing the
accountability hole underneath it. Commit messages are the source of truth.

- **A posted payment's method can be corrected**, by voiding the payment row and
  inserting a replacement, never an in-place UPDATE. The bill, its items, its
  branch sequence and its receipt number are untouched: only the money leg
  moves. Voiding the whole transaction was never the right tool, and
  `voidTransaction` refuses a Paid one that has payments anyway.
- **Voided payments leave every money aggregate** (14 sites: credit derivation,
  AR worklist, cash/non-cash split, day-summary byMethod, cashier collected,
  drawer reconciliation and close-out, analytics) but stay VISIBLE and marked on
  the ledger and the transaction detail, so a correction is auditable instead of
  looking like a double charge.
- **Who took the payment is PIN-attested**, not the login. Every payment on the
  shared `Branch` kiosk used to record the service account as receiver across
  108 nurses, which made per-cashier figures and the audit trail meaningless.
  Same mechanic the dose path already used, with `Cashier` added to the role set.
  The UI leads with the one person clocked in ("Taking payment: Juan Dela Cruz"
  plus a quiet "Not you?") and always asks for the PIN: being on the roster
  identifies someone, it does not prove they are the one at the till.
- **The approval gate came off corrections** (kept for void and refund), per the
  2026-07-06 standing decision that record corrections are inline, warned and
  logged rather than queued. It also routed to a `BranchAdmin` role no real user
  holds, so on the shared login it was an unresolvable dead end.
- **Voiding now unwinds the work it created.** Fan-out opens clinical and lab
  orders and deducts stock at BILL time, and had no duplicate guard, so
  "void the wrong bill and re-enter it" silently double-created clinical work.
  Void now cancels the fan-out and returns the stock, or refuses with
  `CLINICAL_WORK_COMPLETED` when the act already happened.

## Shipped recently (2026-07-30, the clinic's own data lands in the seed and the forms)

Driven by a fresh cross-check of the live AppSheet export
(`surevax_gsheet_db.xlsx`) against the code, sheet by sheet. Full commit messages
are the source of truth; details in
[`nurse-testing-readiness.md`](nurse-testing-readiness.md) "What shipped
2026-07-30".

- **Who gave the dose is now recorded, and it is not the login.**
  `clinical_orders.administered_by_id` was the JWT principal, which on the shared
  day-scoped `Branch` session is the branch service account: so every dose in
  the clinic was attributed to a service account, and the legacy database records
  the nurse per dose (`Immunization.i_NurseRef`), making it a parity regression
  too. The administer body now carries the clinician plus their 4-digit kiosk PIN
  (same PIN and `pin_attempts` lockout as clock-in), resolved before the clinical
  transaction opens; `documented_by_id` stays the session. A clinician logged in
  as themselves attests implicitly and sees no extra step. New
  `shared/utils/clinicianAttestation.ts`; refusal codes in `gotchas.md`.
- **The payer is selectable at settlement, and prices the dose.** The collect step
  never offered one, so every dose billed the cash rate: an HMO patient's ARV PEP
  IM dose read ₱1,500 against a contracted ₱2,200. `GET
/api/scheduled-orders/:id/doses` takes `payerId` and returns each dose's price
  resolved through the same `resolveServicePrice` the transaction uses (brand-aware
  for a dose already given), so the picker's total matches the bill. `HMO` /
  `Corporate` tenders appear only once a payer is named.
- **Real branches, roster, and payer tiers seeded.** Sta Mesa, Alabang, and the
  Virtual branch were missing, and Timog was seeded `TIM` where the clinic's own
  `b_TransactionInitials` says `TMG` (renamed repo-wide). Every branch now has its
  own `Branch` kiosk login on its own mailbox from the sheet, and 103 real nurses
  are attached to their assigned branches, so the attestation picker and clock-in
  kiosk list the people who actually work there. `HMO`, `mWell`, and `HPPI`: the
  three highest-volume payer tokens in the `Vaccine` sheet: were in neither the
  seed nor the migration's payer mapping, so 80 of 159 non-diagnostic rows fell
  through as unrecognised routes; all three are now payer profiles with the
  sheet's 65 (service, payer) prices. Four missing brands added (Priorix, Hepliv,
  Tetraxim, Imovax).
- **Intake form: collapsible optional blocks + data-calibrated validation.**
  Registering a bite walk-in is four fields on one screen; Guardian, Medical
  baseline, Coverage, and Onboarding collapse (new `<CollapsibleCard>`,
  PATTERNS.md 37: force-opens on a validation error, shows a filled-count badge).
  Mobile numbers normalise the four spellings that mean the same number, email
  placeholders are rejected (62.3% of the legacy column is literally "n/a"), birth
  dates reject the future and ages over 120, names reject digits.
- **Two latent E2E flakes fixed, and `pnpm test:e2e` unbroken in worktrees.**
  `receivables` and `transactions` asserted on `?selected=`, which
  TransactionsPage strips by design (Pattern 34): a race they were winning by
  luck. The Playwright config hardcoded port 5205, so `pnpm test:e2e` timed out in
  any worktree with a different computed port; it now reads `VITE_DEV_PORT`.

Suites after this pass: backend 332 (39 files, 0 skipped), frontend 99, CI E2E 19,
readiness E2E 19, `pnpm agent:check` clean.

## Shipped recently (2026-07-28, six-commit sweep closes most of the prior list)

Full commit messages are the source of truth; this is the backlog-facing
summary, not a restatement.

- **Encounters have a real lifecycle** (closes the `encounters.status`
  dead-state finding below). Two guarded, audited transitions, complete and
  cancel with a typed reason, replace the freeze-at-Open-forever behaviour;
  illegal transitions refuse with a structured code instead of a 500.
  Administering a dose now closes its own visit via
  `clinical_orders.encounter_id`, never the standing order's initiating
  encounter (shared across every dose in a course, so that would have closed
  the Day-0 visit when Day 28 is given). `InProgress` stays deliberately
  vestigial. Yesterday's forgotten Open encounters are deliberately NOT
  auto-closed; see the new open item on surfacing them in day-summary loose
  ends, below.
- **Void and refund approval thresholds are enforced** (closes P1 #23,
  below). A void over PHP 1,000 or a refund over PHP 5,000 now files one
  Pending `approval_requests` row and refuses `APPROVAL_REQUIRED`; a refund
  over PHP 5,000 needs the admin tier rather than the manager tier.
  Single-use and idempotent. Two bugs found proving it: the gate had to run
  in its own transaction (nested in the caller's, a refusal rolled back the
  approval row it had just filed, so every retry minted a new one), and
  `admin/approvals.ts` used bare `db.select`/`db.transaction` with no tenant
  GUC, so under FORCE RLS every read returned nothing and approve/reject
  404'd on any real request, the approval surface had never worked. Eight new
  integration tests cover the gate (`money-approval-gate.test.ts`); six
  existing tests that encoded pre-gate behaviour are fixed at the source.
- **Branches are configurable, so BIR-official receipts are reachable**
  (closes the `branches.settings` write-path gap below). A TenantAdmin can
  now set TIN, registered name and permit number
  (`BranchReceiptConfigDialog.tsx`, `admin/branches.ts`), mirroring exactly
  what the reader (`extractBranchReceiptConfig`) types as mandatory versus
  nullable.
- **Claims list + payer population fixed, payer-contract admin UI wired**
  (closes P1 #24, below). The list route now honours the `patientId` and
  `limit` params it was already being sent; both routes populate a payer so
  `claim.payer?.name` resolves instead of falling back to a raw id.
  Payer-contract listing and create are wired
  (`PayerContractCreateDialog.tsx`); editing an existing contract stays
  deferred, the PUT (`PUT /api/payer-profiles/:id/contracts/:contractId`)
  exists server-side with no frontend caller.
- **The patient chart tells the truth about a standing-order course** (closes
  P1 #26, dose strip; narrows P1 #22, indication, see below).
  `clinical_orders.indication` is now derived from the standing-order
  template's own id at course start (the catalog code IS the exposure
  classification), so `getPepProgress` works for any course registered from
  now on; booster and Cat III bundles are deliberately left null since their
  templates mix regimen shapes the fixed PEP label arrays would mislabel. The
  detail read now projects the same `doseStates` the list already computed,
  so `PatientDetail`'s dose strip is real per-patient data instead of the
  removed D0/D3/D7/D14 placeholder, masked stricter than the list (nulled
  cross-branch, not just coarsened). Pre-existing courses still read
  not-started; see the new backfill item under "Decisions only the owner can
  make," below.
- **Print and export are audited** across the patient statement, transaction
  receipt, print-options dialog (two call sites), day-summary print, and the
  health-card PDF download, through one shared hook (`useAuditEvent`),
  non-blocking with an operator-facing warning on failure. The day-summary
  old Day Summary "Download report" button remained an unwired stub in that
  batch; the bounded `/reports` export now supersedes it with server-generated
  CSV whose audit row is durably written first and binds the file SHA-256.
  Attachment delete no longer fails silently
  (`components/ui/attachment-list.tsx` now has a real `onError`/`isError`
  path). Five dead exports removed in this batch, closing the "more dead
  code" item below: `publishDomainEvent` (and the whole unused
  `domain_events` publisher module, seventeen of its eighteen declared event
  types were never produced), `recordFollowupOutcome`'s non-tx wrapper,
  `writeScheduleChangeAuditStandalone`, `useUploadAttachment`, and
  `useRecomputeScheduledOrder`.

Verified: backend integration 332 passed across 39 files (was 324/38),
frontend component 99, readiness checklist 19 passed / 5 skipped, CI-gating
e2e 19 passed, `pnpm agent:check` clean.

## Shipped recently (2026-07-27, five-way "modeled but not wired" sweep)

A sweep hunting the exact failure class that had already bitten three times
(SMS reminders, the recall fan-out, `clinical_orders.indication`): something
that reads as fully wired but has no caller or no producer. Seven commits;
full messages are the source of truth, this is the backlog-facing summary.

- **Product-recall patient notification now fires on recall creation**
  (closes P0 #21, below). `fanOutRecallNotifications`
  (`apps/backend/src/modules/product_recalls/db.ts`) was fully built
  (idempotent, consent-gated, templated) and called from nowhere.
  `product_recalls.patient_notification_required` (NOT NULL DEFAULT true) was
  already the switch, so wiring it in was the whole fix. Verified over the
  wire: `notificationsQueued: 1` and a Queued SMS row carrying its
  `metadata->>'recallId'`. Delivery still awaits a real provider (the sender
  is a logging stub).
- **`scripts/check-modeled-not-wired.sh` rebuilt around reachability.** It
  previously grepped for a flag identifier and found it inside the dead
  function it should have flagged, so it passed clean on the very bug above.
  It now requires listed enforcement functions to have a non-test reference
  outside their own definition, matching bare identifiers so route, registry
  and barrel wiring do not false-positive. It failed on this tree until the
  recall fix landed, then passed. That is the gate working.
- **`requires_physician_auth` is now enforced server-side**
  (`PHYSICIAN_AUTH_REQUIRED`). It was browser-only: `startStandingOrderTx`
  never checked the flag, so a direct API call could start a
  physician-authorized protocol with nobody recorded as authorizing it.
  Reproduced as a 201 with zero physician recorded before the fix; a 400 with
  the structured code after.
- **`sendLifecycleError` consolidated into `shared/lib/lifecycleError.ts`.**
  Five routers (`scheduled_orders`, `patient_accounts`, `inventory`,
  `patients`, `encounters`) each had a local reimplementation that dropped
  `err.details`, the payload a client needs to recover (the computed excess
  on `OVERPAYMENT_NOT_ALLOWED`, the payable ceiling on
  `D2_CROSS_BRANCH_DEPOSIT`). Latent, not live, since none of those modules
  populate `details` today; it would have gone missing the moment one did.
- **`/api/audit` mount opened to clinical roles** so `POST /print-event` and
  `POST /export-event` can record the actor: the DPA print/export trail was
  empty because the mount was `TenantAdmin`/`BranchAdmin`-only and 403'd the
  `Branch` login, the only one a clinic uses. `GET /recent` keeps its own
  admin-only gate. Verified 201 on both writes as `Branch`.
- **Analytics: the event-driven consumer's fact-table upserts were removed,
  not repaired.** They targeted columns that do not exist and would have
  burned twenty retries per dose over roughly ten hours before poison-piling
  (invisible today only because `WORKERS_ENABLED` is unset); the batch worker
  already derives the same tables correctly and has data the event payload
  doesn't carry. Proving the batch worker then surfaced five hard SQL errors
  in it (two nonexistent enum values, a join to a nonexistent table,
  text-versus-bigint dedup comparisons, a wrong column, `SUM() FILTER` nulls
  into NOT NULL columns), all fixed and executed against the live schema in
  a rolled-back transaction. Day bucketing corrected from UTC to Asia/Manila
  (a UTC+8 clinic was misdating everything before 08:00 local). Advisory
  locking plus `ON CONFLICT DO NOTHING` added for multi-replica safety.
- **Frontend: three surfaces stopped rendering reassurance when the truth was
  unknown.** A failed recall lookup on the administer screen no longer reads
  as "not recalled" (three states now: confirmed recalled hard-blocks,
  unresolved requires explicit acknowledgement); the dashboard audit card no
  longer renders "No audit events" to the `Branch` role that cannot read it
  (hidden instead); `PatientDetail`'s hardcoded D0/D3/D7/D14 dose strip,
  fiction for every patient regardless of their real schedule, was removed
  rather than faked better (see the new open item below on what rendering it
  properly needs).
- **Claim status advance fixed** (was 404ing on every call: client called
  `/:id`, route is `/:id/status`), and the claims list's `from`/`to` params
  now match the backend's `dateFrom`/`dateTo` (the date filter had been a
  no-op). **Standing-order template "Edit" now actually edits**: it opened a
  read-only viewer while a complete `useUpdateTemplate` mutation sat with zero
  call sites; a four-field form (name, description, requires-physician-auth,
  is-active) is now wired, sized to what the strict backend body accepts.
- **Doc corrections**: stale migration filenames, a `feature_flags` column
  name, dropped `users` columns, a nonexistent runbook link, and roughly
  eleven `requireRole('SuperAdmin', ...)` mentions matching no real call site
  (corrected to `TenantAdmin`). Plus four real env vars documented for the
  first time (`PAYMONGO_WEBHOOK_SECRET` and three `VITE_` Sentry/tenant vars).

## Shipped recently (2026-07-26, week-one polish batch cleared)

Six commits cleared everything left on the nurse-testing readiness "week one"
list. Full per-workflow narrative lives in
[`nurse-testing-readiness.md`](nurse-testing-readiness.md); this is the
backlog-facing summary, not a restatement.

- **Split tender at the dose-worklist collect step** (closes P1 #16, below).
  `CollectPaymentDialog` now offers the same split `TransactionsCreatePage`
  already had, behind an opt-in "Split across multiple payment methods"
  checkbox off by default, reusing `SplitTenderEditor` unmodified and looping
  one `addPayment` per leg. No backend change. Legs sum against what is
  outstanding after any patient-credit draw, not the gross. See R4.
- **Specific copy for all ten administer failure codes** (was three). The
  audit found the gap wider than recorded: `LOT_WRONG_BRANCH`,
  `LOT_QUARANTINED`, `LOT_EXPIRED`, `LOT_NOT_FOUND` and `NEGATIVE_INVENTORY`
  were also falling through to the raw server string. The fallback no longer
  says "please try again," which asserted the dose was not given; it now says
  we cannot confirm whether it was recorded, because a nurse who wrongly
  believes a dose failed may give it twice. See R6.
- **Prepay an upcoming dose from `StandingOrderTab`** (closes P1 #20, below).
  Opens the existing collect panel directly with copy that cannot be mistaken
  for administering; suppressed when nothing is unbilled and when the chart
  is being viewed cross-branch. See R7.
- **"Cancel pending" hidden from non-admins, with a real error path
  regardless** (closes P1 #18, below). The `TenantAdmin`-only gate is
  deliberate (it destroys a patient's remaining schedule in one action), so
  this was not widened; `PatientDetail` now hides the button for non-admin
  roles and the mutation carries a real `onError`. See R3.
- **`POST /api/inventory/receive`: receive stock in-app** (closes P1 #19,
  below). Records a delivery as a lot plus its paired `In` movement, open to
  `Branch`. Tops up a repeat batch, refuses a mismatched expiry, refuses a
  quarantined lot, refuses an already-expired lot, translates a 23505 race
  into a 409. No migration needed. See R9.
- **Cash-deposit-to-bank ledger with a derived on-hand-cash figure**, closing
  the AppSheet on-hand-cash gap (previously only mentioned in passing under
  "AppSheet live-data capability gaps" below, now shipped). New
  `cash_deposits` table (migration `0010_cash_deposits.sql`), one row per
  physical banking event; on-hand cash (opening float plus cash collected
  minus deposits) is derived on every read, never stored, the same convention
  as patient credit. Also fixes `closeDrawerSession`'s `expectedTotal`, which
  never accounted for cash leaving the drawer and so showed a phantom
  shortage at close on any day cash had been banked. See "Found alongside"
  in the readiness doc.

Two bugs the batch exposed, both fixed in the same pass:

- **Every `LifecycleError` in `inventory_transfers/routes.ts` surfaced as a 500.** The catch blocks read `e.statusCode`, but `LifecycleError` only ever
  sets `httpStatus`, so the guard was always false and every structured 404/409
  fell through to a bare 500. Newly urgent the moment `Branch` was granted
  those routes. Fixed to use the canonical `sendLifecycleError`, as four other
  modules already did. **Lesson for any router with a catch block: check
  against `httpStatus`, not `statusCode`.** `LifecycleError` never set the
  latter, so this class of bug can recur wherever a new catch block is
  hand-written instead of reusing `sendLifecycleError`.
- **Worklist branch scoping hid a visiting patient's dose from the branch
  treating them.** Scoping by home branch alone (the R6 fix in the previous
  batch) meant a patient homed elsewhere who walks in, registers, and gets a
  dose scheduled here never appeared on this branch's queue. A dose is now
  this branch's work when the patient is homed here **or** the dose's
  encounter happened here (a left join on `encounters`, not a correlated
  subquery, see `patterns.md`'s correlated-subquery trap). One shared
  definition feeds the list, every KPI count, and the text-draft lookup.

## Shipped recently (2026-07-26, nurse-testing readiness fixes)

Five fixes landed against workflows the nurse-testing readiness assessment
flagged red the same day it was written. Full per-workflow narrative lives in
[`nurse-testing-readiness.md`](nurse-testing-readiness.md); this is the
backlog-facing summary, not a restatement.

- **Cross-branch patient masking plus break-glass, now enforced for the
  `Branch` login** (closes P0 #14, below). `getPatient`/`listPatients` null a
  non-home-branch caller's demographic fields server-side instead of serving
  the full chart with no gate; `POST /:id/break-glass` and
  `GET /:id/demographic` widen `requireRole` to the clinical roles including
  `Branch`; `usePatientDemographic` now carries a real error state so a failed
  safety-signal fetch (product recalls, critical labs) can no longer
  masquerade as a clean chart. See R3.
- **Allergies and conditions mask the same way, and cross-branch writes to
  either are blocked** (new finding, not in the original assessment):
  `patient_allergies`/`patient_conditions` carry no `branch_id`, so the
  `branch_isolation` RLS `WITH CHECK` that makes break-glass read-only
  elsewhere never covered them; all six write routes now return 403
  `CROSS_BRANCH_WRITE_FORBIDDEN`. See R3.
- **The dose worklist is now scoped to the caller's own branch** instead of
  tenant-wide, closing the "decide before a second busy branch" item that used
  to sit in "Decisions only the owner can make" below. See R6.
- **SMS reminder capability shipped**: a per-row "Text patient" action renders
  a QR code encoding an `sms:` URI, scanned by the nurse's own phone. The
  registration form now captures `sms_opt_in`. See R2.
- **SC/PWD discount now bills no VAT and reports the 20% alone** (closes P0
  #15). The VAT used to stay in what the patient paid, a real overcharge on
  every qualifying sale. A bookkeeper should still confirm the receipt layout
  satisfies the separate-disclosure requirement. See R8.

## Shipped recently (2026-07-26, nurse-testing readiness suite proven plus two fixes it surfaced)

The readiness checklist ([`e2e/readiness/`](../e2e/readiness), `pnpm
test:readiness`) had only ever been compile-verified. Run for real against a
live seeded stack it passes **17, skips 5, fails 0** (15 real specs across the
four files plus the shared `setup` project's admin-plus-branch auth
bootstrap, which the `readiness` project depends on). The wider testing
picture the same day: the CI-gating E2E suite (`pnpm test:e2e`) at 19 passed,
the backend integration suite at 318 passed across 37 files, 99 frontend
component tests, and 161 backend unit tests. The first real run found four
defects, all in the tests, none in the product (viewport 1440 needed to
become 2560x1440, since `DetailRail` is only non-modal at `2xl`; name-plus-dose
locators were not unique across repeated runs; `?selected=` is one-shot per
Pattern 34, so asserting the URL raced; the break-glass phrase renders in
both a banner and a toast, so the assertion is anchored on the banner). Full
narrative: [`nurse-testing-readiness.md`](nurse-testing-readiness.md).

Two fixes landed alongside getting there:

- **`Branch` can now ship, receive and cancel inventory transfers** (closes
  P1 #17). The three routes admitted `Nurse` but not `Branch`, the one login
  a clinic actually uses, so the branch physically receiving a shipment had
  no way to confirm it. Nav item moved from Administration to sit beside
  Inventory.
- **Split-tender controls now have accessible names.** The "Method,"
  "Amount" and "Reference" labels rendered only above the first leg (read as
  column headers) and carried no `htmlFor`, so no leg's control had an
  accessible name, including the first. Found by writing a test that could
  not address the second leg's method; each control now names itself by leg
  position (for example "Payment 2 amount").

## Shipped recently (2026-07-26 — whole-UI scale + nurse-lens size fixes)

- **Root font size steps to 112.5% (18px) above 1536px** (`index.css`). The
  earlier type-scale bump raised text and stopped there, because `fontSize`
  tokens only reach `text-*`; button/input height, padding, gaps and icons come
  from Tailwind's **spacing** scale, so buttons stayed 32px and the UI still
  read small. Stepping the root is the only single lever that moves all of it
  (spacing is rem-based; `--radius` already `0.5rem`). One number, one place.
- Measured at 2560×1440 — root / cell text / row action button / rows on
  `/patients`: **16px** 15px / 32px / 22 · **17px** 15.9px / 34px / 20 ·
  **18px (shipped)** 16.9px / 36px / 19 · **19px** 17.8px / 38px / 17.
- **88 hardcoded px inside Tailwind arbitrary values converted to rem** so they
  scale with the root instead of freezing. Hairlines (≤2px) deliberately stay
  px. New arbitrary values must be rem — see `apps/frontend/CLAUDE.md`.
- **Four relative-size errors fixed, judged from the nurse's side of the
  counter.** A global scale-up cannot fix these — scaling everything preserves
  whichever element is wrongly smallest:
  - `RECALLED` was `text-2xs px-1.5 py-0` — the highest-stakes label in the
    app, on the vial in someone's hand, smaller than surrounding body text with
    no vertical padding. Recall reason/severity list went `text-xs` → `text-sm`.
  - Lot number + expiry were `text-xs` muted while the brand name was `text-sm`
    — the data a nurse **verifies** was smaller and fainter than the data that
    merely **identifies**. Both now `text-sm`, full contrast.
  - The Administer button carried an `h-7` override (28px), a step below the
    app's own `sm`, making the most-clicked clinical action the smallest button
    on the page.
  - `DoseStrip` dose numbers were `text-2xs` — that's the position in a PEP
    course, confirmed before an injection.
- Side effect to watch: the nav rail is rem-based too, so it grows with the
  step (~288px → ~324px). Acceptable for now; pin it in px if the width is
  wanted back for content.

## Shipped recently (2026-07-26 — Tier 1: four silently-broken behaviours)

Found while triaging "what else can we improve" after the UX audit. All four
were verified in code before fixing, and none were cosmetic.

- **Branch and Nurse operators could not initiate a protocol at all.**
  `InitiateProtocolSheet`'s `physicianValid` gated submit on a **UUID regex**
  while physician ids are display ids (`USR_…`), and the gate covered the
  populated dropdown as well as the manual fallback it was written for. Since
  `requiresAuthorizer` is true for `Nurse` **and** `Branch` — the clinic's real
  single-operator login — `canSubmit` was unreachable for the primary persona:
  pick the right physician, button stays disabled, "Must be a valid UUID." is
  the only feedback. The full-page sibling (`InitiateProtocolPage`) validated
  correctly via `<PhysicianPicker>`; only the in-flow sheet was broken. Now has
  a component test proven to fail against the old regex.
- **Physician dropdowns could come up silently empty.** Three hooks queried
  `/api/branch/physicians` under the same `['branch','physicians']` key while
  caching **two different shapes** (envelope vs unwrapped array), so whichever
  mounted first poisoned the others. One canonical hook now; `BranchPhysician`
  is the canonical type (`PhysicianOption` had omitted `licenseNumber`).
- **The dashboard drawer KPI never refreshed after clock-in/out** —
  `/api/shifts/current` was cached under `['shift','current']` and
  `['shifts','current']`, so the mutations' invalidation never reached the
  dashboard. Consolidated; the canonical `CurrentShift` now matches the backend
  projection field-for-field (both copies had under-declared it).
- **Four admin surfaces never refreshed after a write** (Approvals, Attendance,
  Notifications, Audit). `useRecentList` had no React Query entry at all, so
  every `invalidateQueries` against it was a no-op. The first page is now a
  real `useQuery`; "load older" still appends locally. Public API unchanged.

Remaining from that triage, in priority order — details in the backlog sections
below rather than restated here, so they can't drift apart:

1. **Role walkthrough** — the Cashier / Nurse / Physician journeys have still
   never been click-tested, and the protocol bug above is exactly the class of
   thing that hides in an unwalked role. See "Per-role walkthroughs".
2. **Cashier page** (`TransactionsCreatePage`) — see the entry under the UX
   audit's deferred items, which now carries a fix order.
3. **Remaining worklists** — the Phase 1 Review Center is implemented in open
   PR #616 (not yet on `main`) with the
   missing-guardian queue and yesterday's loose ends, using Asia/Manila day
   boundaries and resolvable links to the existing owner workflows (including
   the branch kiosk for prior open drawers). Drawer recovery now keeps the
   financial role boundary, resolves deposits/payments to the same prior-day
   session, and enforces one Open physical drawer per branch at PostgreSQL.
   Patient merge and external
   immunization reconciliation remain deliberately separate next slices because
   their safe correction contracts are not yet defined. The receivables surface
   is partly shipped; read the AR entry for its remaining scope.

## Shipped recently (2026-07-26 — type scale retuned for the clinic display)

- **`text-2xs` / `text-xs` / `text-sm` are now 11 / 13 / 15px** (was 10/12/14),
  line-heights moved with them. A 2560-wide logical desktop on a 27" panel is
  ~109 CSS px per inch against the 96 the CSS pixel is defined at, so
  everything rendered ~12% smaller than standard — and `text-xs` was the app's
  dominant body size (796 uses vs 537 for `text-sm`), i.e. most text sat at the
  12px floor while that floor rendered at ~10.6px equivalent. Small text here is
  lot numbers, dose volumes and expiry dates.
- Redefined as **tokens** in `tailwind.config.ts`, so all 1,333 call sites moved
  at once without touching padding. **`text-sm` no longer means 14px** — that is
  deliberate; don't revert it to stock. `.eyebrow`'s hardcoded `10px` became
  `0.6875rem` so it participates in the scale.
- **`KpiCell`'s `2xl:text-3xl` restored** (the 2026-07-25 audit removed both its
  type and padding steps; only padding should have gone — padding is air, the
  KPI numerals are read from across a front desk).
- **Fluid/`vw` type was considered and rejected**: viewport width is a bad proxy
  for apparent size — a 13" 1440p laptop (~124 PPI) and the clinic's 27" 1440p
  monitor (~109 PPI) have identical viewport width. CSS can't read PPI or
  viewing distance. With one target device the answer is a correct base scale,
  not dynamic scaling. Mixed hardware later → persisted `data-density` on
  `<html>`, not viewport math.
- Cost, measured at 2560×1440 (rows visible, pre-audit → post-audit → now):
  `/inventory` 26 → 29 → 27, `/patients` 22 → 24 → 22, `/scheduled-orders`
  21 → 22 → 21, `/transactions` 14 → 15 → 13, `/admin/users` 18 → 18 → 17.
  **Net roughly break-even vs. where the app started, with every size a step
  larger** — the density work paid for the legibility.

## Shipped recently (2026-07-25 — UX/UI/density audit)

Full findings + measurements: [`docs/audits/2026-07-25-ux-ui-density-audit.md`](audits/2026-07-25-ux-ui-density-audit.md).
Everything below was measured in a real browser at 2560×1440, not inferred.

- **One row-density standard, owned by the `Table` primitive.** 225 cell
  className strings carried their own `py-*`, so the app shipped rows from 39px
  to 65px. Row height is now `<Table density="compact" | "default">` (Pattern
  36); worklists compact, reference/admin lists default. Chrome above the first
  row dropped 20–28px per page; `/inventory` 26 → 29 rows visible,
  `/patients` 22 → 24, `/services` rows 47 → 39px.
- **Pattern 20 sticky headers actually work now.** All 38 conformant sticky
  headers were inert: `TableCard`'s `overflow-x-auto` and `Table`'s
  `overflow-auto` wrapper each made themselves the sticky containing block, and
  both are content-height so neither can scroll. Measured before: scrolling
  `/transactions` 134px moved the header up 134px. After: `/services` scrolls
  2458px and the header pins at the scrollport top. `/patients` also gained the
  sticky header it never had.
- **List rows are keyboard-reachable.** 22 pages put `onClick` on a bare
  `<TableRow>`; 40 Tab presses on `/patients` never reached a row, which also
  meant `PatientList`'s arrow-key handler could never fire. Now
  `<TableRow interactive>` (26 sites) — focusable + Enter/Space, without
  overriding row semantics or the global focus ring.
- **Receipt page no longer clips.** `min-h-screen` inside AppShell's
  `overflow-hidden` left 77px of `/transactions/:id/receipt` unreachable at any
  scroll position.
- **Silent failures surfaced** (7 paths, incl. two literal `catch { // swallow }`
  in AppShell where a failed clock-out left staff believing they had clocked out).
- **`useSafeForm` finally wired** — it was written for M7 and had zero
  importers, so all 24 RHF forms validated on submit only. Closes M7.
- **Blank-white-screen on hard refresh fixed** — 4 route guards returned `null`
  during the `/api/auth/me` bootstrap.
- **Dead ends closed** — 3 stub buttons that held the _primary_ CTA slot
  demoted behind real actions; `/admin/patient-standing-orders` (a working page
  with zero entry points) added to nav; breadcrumbs no longer print raw display
  IDs; `/today` gained "as of HH:MM" + Refresh (nothing in the app polls).
- **`ListEmpty` gained an `action` slot**; the never-imported
  `components/ui/empty-state.tsx` deleted. One empty-state primitive.
- **Two gates that had stopped gating, fixed** — the `page-header-h1` regex
  only matched `text-lg` after the primitive moved to `text-xl`, and ESLint's
  design rules were scoped to a `src/shared/**` path deleted in `1cdf833`, so
  `src/components/**` was never covered.

## Shipped recently (2026-06-20)

- **Multi-patient transactions (family billing)** (PR #570): one
  transaction/receipt can now bill several patients (family/group), settled by
  one combined payment, with per-patient BIR SC/PWD discounts.
  `transactions.patient_id` stays the primary/bill-to; a new nullable
  `transaction_items.patient_id` (NULL = inherit primary) plus a
  `transaction_patients` sub-header carry the per-patient discount + optional
  encounter. Also **closed a pre-existing gap**: non-bundle transaction creates
  previously ran no consent check; `createTransaction` now asserts active
  consent once per unique patient and mirrors the D2 branch-invariant for
  secondary patients (409 `D2_CROSS_BRANCH_SECONDARY`). Conventions:
  `gotchas.md` "Multi-patient transactions".
- **Acknowledgement receipts + BIR data-only pivot** (PR #569): both renderers
  (`AcknowledgementReceipt.tsx` HTML + `escpos/receipt.ts` thermal) now print an
  explicit "THIS IS NOT AN OFFICIAL RECEIPT" disclaimer plus a footer noting a
  manual OR is issued on request, and drop the misleading "OR No." line. Header
  values (name/address/contact) now come from the **transaction's branch** (new
  `branch` object on the txn-detail payload; new
  `features/transactions/receiptClinic.ts` builder; the hardcoded `CLINIC`
  constant is gone). The BIR Official-Receipt pivot is now **data-only**:
  populate `branches.settings.receipt.bir` (TIN / registered name / permit / OR
  series) to flip a branch to official mode (TIN/permit header, OR number, no
  disclaimer) with **no code change**. This substantially de-risks P0 #2 (see
  below).
- **Go-live requirements questionnaire** (docs, 2026-06-20): cross-department
  question set (clinical, business-dev, operations, compliance/DPA, IT) at
  [`docs/go-live-requirements-questionnaire.pdf`](go-live-requirements-questionnaire.pdf),
  generated by `scripts/gen-golive-questionnaire.py`. This is the instrument for
  gathering the owner decisions that gate P0 (BIR values, AppSheet cutover,
  external account knobs, and the open clinical questions).
- **Contract-codegen drift follow-ups closed** (2026-06-14): the three
  follow-ups the #559 pass queued all landed: internal bigint PK/FK wire leaks
  stripped on patient/dose/bite responses (resolved to `USR_…` display ids;
  out-of-scope leaks keep NOTE markers for a later pass); `icdCode` unified to
  `icd10Code` on patient conditions; the phantom `pulseBpm` vital + dead
  diagnosis-status alias removed. Plus a **dose-calc fix**: `/api/dose-calc` now
  resolves the rule from either the catalog id (`SVC_ERIG_INF`) or the bare code
  (`ERIG_INF`), re-enabling "Confirm & administer" for ERIG/HRIG/HTIG/ATS (was
  permanently 400-blocked — the bug risks.md #3 had flagged as unfixed).

## Shipped earlier this cycle (2026-06-12/13)

- **API contract codegen** (PRs #558 spine + #559 conversion) — the
  schema↔Zod↔frontend parity rule is now machine-enforced for 15 modules:
  per-module `contract.ts` + `satisfies`/`wire()` assertions + `pnpm
gen:contracts` emitting checked-in frontend types + a CI drift gate
  (`scripts/check-contract-drift.sh` in `agent:check`). The conversion
  surfaced and fixed ~10 live drift bugs (appointment cancel sent DELETE to a
  POST-only route; a dead `/new-version` path; `branchSeq` dropped from the
  transaction-detail mapping; bite-incident list missing the followup it
  renders; `isLocked` never projected; `consentedAt` vs `obtainedAt`). Design:
  [`docs/specs/api-contract-codegen.md`](specs/api-contract-codegen.md);
  conventions: `gotchas.md` "Schema ↔ Zod ↔ frontend field parity". Remaining
  unconverted modules (admin sub-routers, fhir, attachments, branch, shifts,
  cash_drawer, service_catalog, places, product_recalls, staff_time_logs,
  operator, health_cards, dose_calc) convert on next touch. (The follow-ups this
  pass queued — bigint-id wire leaks, `icdCode`/`icd10Code` unification, phantom
  `pulseBpm` vitals field — all landed 2026-06-14; see "Shipped recently" above.)
- **Handover-cleanup wave** (PR #557, orchestrate-pilot) — 7-day KPI trend
  series on dashboard / transactions / scheduled-orders stats (KpiCell
  sparklines); per-dose `doseStates` on the patients list + `pepTotal: null`
  projection fix; seed fixtures for the verification long tail (recall
  pattern now matches a live lot; TenantAdmin second-branch membership).
- **Three UI passes in one day** (PRs #550–#557, archived handovers
  [`archive/2026-06-12-ui-architecture-pass.md`](handovers/archive/2026-06-12-ui-architecture-pass.md) +
  [`archive/2026-06-12-ui-creative-pass-backend-needs.md`](handovers/archive/2026-06-12-ui-creative-pass-backend-needs.md)):
  27" theme identity + wide-screen ladder, clinical primitives
  (`DoseStrip`/`Sparkline`), Today cockpit (`/today`) as home, URL-as-state,
  non-modal detail rails at 2xl, continuous administer→collect flow panels,
  local visual-regression snapshots, KPI trend series + patients `doseStates`
  backend projections. Both 2026-06-12 UI handovers are fully resolved and
  archived.
- **Money-correctness cluster** (PR #554) + RLS bare-read sweep (PR #553).

## Shipped earlier (2026-06-03/04)

- **Cross-branch PHI access** (PR #531) — break-glass reveal with a typed-reason
  gate + persistent per-branch grant; the breaking `branch_isolation` flip to
  default-closed (`AS RESTRICTIVE`); `/admin/cross-branch-access` review page;
  4-scenario integration suite. Full design record:
  [`archive/2026-05-23-cross-branch-phi-rfc.md`](handovers/archive/2026-05-23-cross-branch-phi-rfc.md).
- **UI P4/P5** (PR #531) — dose-schedule viz generalised to any standing order
  (`StandingOrderTab`); manual encounter form moved to a full-page route.
- **MONEY-5** — payment overpayment cap-and-reject.
- **Handover archival** (PRs #532 + this doc) — resolved handovers consolidated here.
- Prior waves (6–10, ~22 PRs): format-helper consolidation, Helmet hardening,
  strict-tenant audit trigger, data-router migration, Sentry init, and the AUTH-2
  RLS capstone (two-role split — RLS is now actually enforced).

---

<a id="branch-account-audit-2026-08-23"></a>

## Latest live-use gate — Branch account audit (2026-08-23)

**Decision: NO-GO, including for a supervised pilot.** This is the current
publication status and supersedes the earlier code/test-based statement in
[`nurse-testing-readiness.md`](nurse-testing-readiness.md) that all ten workflows
worked. The live audit used the seeded HST `Branch` persona through the rendered
browser UI; no real patient data or external services were involved.

The complete reproduction steps, screenshots, impacts, corrections and
acceptance tests are in
[`audits/2026-08-22-branch-account-live-usability.md`](audits/2026-08-22-branch-account-live-usability.md).
This table records the repository implementation state. Keep detailed historical
evidence in the audit rather than rewriting it; use the closeout register below
for the remaining decisions and acceptance evidence.

| Audit ID | Severity | Repository state                           | Pilot exit evidence still required                                                                                          |
| -------- | -------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| BR-01    | P0       | Implemented                                | Rendered controls, crafted cross-branch writes, scoped reveal and audit event                                               |
| BR-02    | P1       | Implemented                                | 00:xx Asia/Manila reconciliation across Today, transactions, stock, drawer and summary                                      |
| BR-03    | P1       | Implemented                                | Invalid-PIN retry retains the session/context, posts nothing, and valid retry posts once                                    |
| BR-04    | P1       | Implemented                                | UI and direct-request fixtures reject completed/cancelled/missing targets                                                   |
| BR-05    | P1       | Implemented                                | Scanner/manual-lot hardware run plus recalled/expired/quarantined/depleted/mismatch failures                                |
| BR-06    | P1       | Implemented                                | One seeded roster reconciles exact rows and counts across all three worklists during refresh                                |
| BR-07    | P1       | Implemented                                | Database fixtures reconcile charge, payment, credit, overpayment, refund and void                                           |
| BR-08    | P1       | Implemented                                | Duplicate-name/repeated-course laptop walkthrough verifies MRN plus DOB/age before action                                   |
| BR-09    | P1       | Implemented with strict resume-only policy | Open patient resumes the existing encounter; UI and direct requests reject a second active encounter without orphaning work |
| BR-10    | P1       | Implemented                                | Clinically approved late and no-op schedule fixtures pass end to end                                                        |
| BR-11    | P2       | Implemented                                | Source/destination roles exercise correct transfer actions and typed rejection                                              |
| BR-12    | P2       | Implemented as truthful snapshot UX        | Owner decides and separately specifies any final clinic-day close workflow                                                  |
| BR-13    | P2       | Implemented                                | Quarantine/recall/expiry/quantity filters verified against representative stock                                             |
| BR-14    | P2       | Implemented                                | First-last, last-first, comma-form, MRN and normalized-phone search walkthrough                                             |
| BR-15    | P3       | Implemented                                | 1280x720 keyboard and verification-context timing with clinic staff                                                         |

### Branch-account remediation closeout register

This is the single live TODO index for the remediation candidate. Do not mark a
row complete from code review alone when its exit evidence requires a deployed
database, hardware, external authority, or clinic-owner decision.

| ID    | Status | Accountable owner                      | Pending item                                                                                                                                                                                                                                                                                                                                                                                                                                         | Completion evidence / boundary                                                                                                                                                           |
| ----- | ------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UX-1  | [ ]    | Engineering                            | Rehearse `0015_post_administration_observations.sql` on both a fresh database and an upgraded pre-0015 snapshot; prove idempotent deploy, runtime-role RLS/audit/grant behavior, observation/external-dose persistence, registration/consent atomicity, payment rollback and real two-connection races. Cross-link the retained evidence to FC-2/FC-3 and the pre-#595 `cash_deposits` upgrade gap rather than treating this migration in isolation. | Migration/deploy/seed/upgrade logs plus green integration output; do not use a shared or real-patient database.                                                                          |
| UX-2  | [ ]    | QA + branch nurse + cashier            | Rerun BR-01–BR-15 and the nurse daily loop at 1280x720, including duplicate names, refresh races, offline recovery, observation, handoff and one fully reconciled day.                                                                                                                                                                                                                                                                               | Dated scenario record with screenshots, outcomes and zero unresolved P0/P1 failures.                                                                                                     |
| UX-3  | [ ]    | Clinic clinical owner                  | Approve observation durations, exception cohorts, outcome-recorder/discharge roles, whether Reaction/Escalated may be discharged in this workflow, and the required emergency/AEFI handoff. Repository default is 15 minutes and never auto-discharges.                                                                                                                                                                                              | Signed duration/role/state matrix and escalation/discharge handoff policy; the broad route allow-list and code default are not clinical-policy approval.                                 |
| UX-4  | [ ]    | Clinic owner + privacy/DPO             | Confirm the operating owners and audit-review procedure for the locked D1 persistent, patient-and-branch-scoped break-glass model. Do not add expiry or silently weaken the strict resume-only encounter rule in this closeout.                                                                                                                                                                                                                      | Named authorized roles, approved reason taxonomy and quarterly grant review; any future time-limited grant or concurrent-encounter exception requires a new superseding decision record. |
| UX-5  | [ ]    | Clinic clinical owner + inventory lead | Choose barcode, manual lot confirmation or both, and define override roles/reasons.                                                                                                                                                                                                                                                                                                                                                                  | Hardware acceptance covers scan/manual mismatch, recalled, expired, quarantined and depleted lots.                                                                                       |
| UX-6  | [ ]    | Clinic operations + finance owner      | Decide whether to build a final clinic-day close; define closer role/PIN, loose-end hard blocks, signed exceptions, cash variance threshold and deposit-reference policy.                                                                                                                                                                                                                                                                            | Approved close contract. Until then, Day Summary remains explicitly an archival snapshot, not a final close.                                                                             |
| UX-7  | [ ]    | Clinical/legal owner                   | Approve patient/guardian consent wording, version, relationship/age rules and supported languages for both Arrivals and `/patients/new`.                                                                                                                                                                                                                                                                                                             | Versioned approved text and effective date; atomic attestation remains required.                                                                                                         |
| UX-8  | [ ]    | Clinical safety owner                  | Define AEFI external-reporting owner, authority/channel, required fields and acceptable submission reference.                                                                                                                                                                                                                                                                                                                                        | Tested operating procedure; local resolution never counts as external submission.                                                                                                        |
| UX-9  | [ ]    | Clinical owner                         | Define acceptable external-immunization evidence and whether ambiguous records require physician review.                                                                                                                                                                                                                                                                                                                                             | Evidence matrix and reviewer-role decision; verification must not imply administration or change scheduling.                                                                             |
| UX-10 | [ ]    | Finance owner                          | Decide whether HMO/corporate payer arrangements may participate in split tender.                                                                                                                                                                                                                                                                                                                                                                     | Approved tender matrix; direct tenders remain Cash, GCash, Maya, Card and bank transfer.                                                                                                 |
| UX-11 | [ ]    | Clinic IT + QA + finance               | Test physical barcode scanner, receipt printer, failed-print recovery, manual SMS QR handoff, cash count/variance, approved payment rails, network interruption and simultaneous work on the actual clinic workstations.                                                                                                                                                                                                                             | Dated hardware/UAT record with device models, payer/rail test references, two-workstation concurrency and recovery results.                                                              |
| UX-12 | [ ]    | Pilot acceptance owner                 | Reassess the NO-GO decision only after UX-1 through UX-11, UX-13, UX-14, [`runbooks/pilot-go-live.md`](runbooks/pilot-go-live.md) and [`ENVIRONMENTS.md`](ENVIRONMENTS.md#production-admission-order) are complete.                                                                                                                                                                                                                                  | Recorded go/no-go decision and linked production-admission evidence; merging this repository change alone does not authorize PHI or pilot traffic.                                       |
| UX-13 | [ ]    | Product + clinical + QA owners         | Resolve or explicitly defer every maintained unsupported/skipped path in [`uat/phase-1-role-browser-coverage.md`](uat/phase-1-role-browser-coverage.md#intentional-skips-and-unsupported-paths), including Cat I disposition, refusal/deferral, Physician authorizer validation, stale-write concurrency, deterministic reminder/cross-branch fixtures, notification delivery and visual baselines.                                                  | Each path has a named owner and one of: implemented passing scenario, accepted Phase-1 exclusion with rationale, or dated later-phase ticket. No silent `fixme` is treated as coverage.  |
| UX-14 | [ ]    | Clinical operations owner              | Confirm whether Today claim/handoff intentionally reassigns `encounters.provider_id` as the current accountable owner or requires a separate operational-assignment field; define shift-end reassignment, abandoned claims and claimant-PIN rules.                                                                                                                                                                                                   | Approved provenance model plus two-clinician handoff/shift-change UAT. Do not overwrite the historical clinical provider if that field is intended to be immutable authorship.           |

---

## Open work — prioritized for a real-clinic go-live

Organizing question: **what stands between today and one real clinic safely using
this with real patients?**

### P0 — Go-live blockers (safety / legal / data)

| #   | Item                                                                                      | Why it blocks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Where                                                                                                                                                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Production hardening** — flip `NODE_ENV=development` → production                       | Real PHI in dev mode is unsafe; `env.ts` fail-closes until dev secrets + CORS origin are replaced                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `apps/backend/src/shared/config/env.ts`; plan in `docs/ENVIRONMENTS.md`                                                                                                                                                                                            |
| 2   | **BIR Official-Receipt values** (largely de-risked by #569)                               | Code is done. An "acknowledgement" mode (explicit not-an-OR disclaimer + manual OR issued alongside) is legally shippable now, and the official-OR pivot is a **data-only** branch-settings flip. Only the real registration values (TIN, PTU/ATP, OR series, VAT breakdown) are still outstanding; collect them via the go-live questionnaire                                                                                                                                                                                                                                                                                                          | Populate `branches.settings.receipt.bir`; values from clinic ops                                                                                                                                                                                                   |
| 3   | **Automated DB backups + Railway spend cap**                                              | Before real data exists: confirm backups + a billing cap. Data-loss / surprise-bill insurance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Railway dashboard                                                                                                                                                                                                                                                  |
| 4   | **AppSheet → SureVax data migration**                                                     | Trials V/W now prove a restart-safe full disposable local import with zero-additional-row reruns, rebuilt clinical courses/schedules, exact transaction-constrained invoice detail and reconciled payments. Production is still blocked by the final frozen current-source pack and unified recomputation; isolated Railway staging/production plus restore/RLS/audit proof; staff, catalog and opening-state approval; old-database and bounded exception dispositions; persisted review decisions; and the catch-up/freeze/acceptance sequence.                                                                                                       | Start at [`migration/appsheet/WHAT-REMAINS-BEFORE-CUTOVER.md`](migration/appsheet/WHAT-REMAINS-BEFORE-CUTOVER.md), then [`migration/appsheet/README.md`](migration/appsheet/README.md); implementation in `apps/backend/src/modules/data_migration/`; risks.md #4. |
| 5   | **DPA (Data Privacy Act) essentials**                                                     | Repository controls implemented: two-approver, expiring, one-time primary-store de-identification; durable impact/completion/rollback evidence; explicit retained-record and backup incompleteness. Production policy, external-object deletion evidence, backup expiry, and DPO authorization remain go-live gates.                                                                                                                                                                                                                                                                                                                                    | `0013_compliance_incident_response.sql`, `admin/dpa.ts`, and `docs/compliance/dpa-controls.md`; complete the owner-controlled pilot checklist before PHI.                                                                                                          |
| 26  | **`cash_deposits` never reaches a pre-#595 database** (2026-08-03, blast radius now zero) | #595 folded the deleted `0010_cash_deposits.sql` into the baseline but shipped no forward migration. Any database whose drizzle journal recorded `0000_initial` before that PR never creates the table, and `0001` then crashes attaching a trigger to it, so `db:deploy` fails outright. Reproduced locally on a June-era worktree DB. **No known database is still affected**: the Railway `development` DB was probed (the table was present, so it was never at risk) and has since been dropped and rebuilt from the current baseline, 2026-08-03. The CODE gap remains, so the next database restored from a pre-#595 snapshot would still hit it | needs a `CREATE TABLE IF NOT EXISTS` supplemental registered BEFORE `0001` in `SUPPLEMENTAL_SQL_FILES`; audit the rest of #595's fold-in (`git show 6ce8cb1 --stat`) the same way                                                                                  |
| 29  | **Accept the Branch-account remediation candidate**                                       | Repository fixes now cover BR-01–BR-15 plus observation, ownership, registration-consent, external-dose review and payment consistency. Pilot remains NO-GO until the database-backed, rendered, policy and hardware evidence in UX-1–UX-14 is complete.                                                                                                                                                                                                                                                                                                                                                                                                | [Latest live-use gate and closeout register](#branch-account-audit-2026-08-23) and [`audits/2026-08-22-branch-account-live-usability.md`](audits/2026-08-22-branch-account-live-usability.md)                                                                      |

### P1 — Needed shortly after go-live (trust / don't-break-things)

| #   | Item                                                                                             | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Where                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 6   | **Frontend + E2E test coverage**                                                                 | Backend well-tested; the screens staff click still thin (~1%). E2E now covers register→administer→pay (`daily-loop`) **and end-of-day reconciliation** (`day-summary`, added 2026-07-06); remaining gap is per-component (jsdom) depth + more journeys. A third, opt-in layer now exists too: [`e2e/readiness/`](../e2e/readiness) (`pnpm test:readiness`), **executed for real against a live seeded stack 2026-07-26: 19 passed, 5 skipped, 0 failed**, alongside the CI-gating suite (19 passed), the backend integration suite (324 passed / 38 files), 99 frontend component tests, and 161 backend unit tests. Those automated results remain useful but did not detect BR-01–BR-10; add the live-audit scenarios before using readiness as a pilot gate. See the E2E coverage backlog section below | jsdom scaffold + Playwright E2E both exist (risks.md #3); depth is the gap — prioritized workflow backlog under "E2E coverage backlog" below |
| 7   | **Finish the verification long tail**                                                            | ~13% of workflows never driven end-to-end; blocked on missing seed data                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | see "Verification status" below                                                                                                              |
| 8   | **Turn on error alerting**                                                                       | Sentry is wired but needs a DSN provisioned, else silent failures in front of staff                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Sentry account + env var                                                                                                                     |
| 9   | **Known UI bugs**                                                                                | currency-input programmatic-set; `BranchDayOpenPrompt` auto-close; B34 lab-critical; B38 dialog cleanup                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | see deferred backlog                                                                                                                         |
| 25  | **Audit tamper paging requires production evidence** (updated 2026-08-23)                        | Repository alert delivery is implemented and fail-closed. Pilot remains `NO-GO` until the owner provisions the production DSN/on-call route and captures a delivered test alert plus manual fallback evidence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `apps/backend/src/workers/verifyAuditChain.ts`; `docs/runbooks/incident-response.md`; `docs/runbooks/pilot-go-live.md`                       |
| 27  | ~~**Money attestation fails open on a new route**~~ **Implemented in the integration candidate** | Every money service now requires typed caller context. HTTP routes supply authenticated role/display ID; internal callers explicitly select the typed internal path. Runtime omission fails closed, current routes have attribution regression coverage, and corrected payments retain the original receiver. Legacy payments with no receiver remain fail-closed pending evidence-backed TenantAdmin repair.                                                                                                                                                                                                                                                                                                                                                                                              | `apps/backend/src/modules/transactions/db.ts`; `money-attestation.test.ts`; route tests; `phase-1-financial-controls-decisions.md`           |
| 28  | **Void/refund approver operating model needs owner sign-off** (compatibility fixed 2026-08-22)   | The PHP 1,000 `BranchAdmin` and PHP 5,000 refund `TenantAdmin` gates remain unchanged. The seed still has zero BranchAdmins, but `TenantAdmin` can approve the manager tier. Non-admin users are no longer sent to the inaccessible Approvals page; they are told to contact a Branch Admin or Tenant Admin.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Choose per-branch BranchAdmins or formally retain centralized TenantAdmin approval; see `phase-1-financial-controls-decisions.md`            |

### Phase-1 financial controls closeout (PR #617)

Implementation, adversarial findings, route attribution, and verification are
indexed in
[`handovers/2026-08-23-phase-1-financial-controls.md`](handovers/2026-08-23-phase-1-financial-controls.md).
This is the single live checklist; do not duplicate it in `TODO.md` or the
handover.

| ID   | Next step                                                                                                                                                                                     | Accountable owner                     | Completion evidence / non-negotiable boundary                                                                                                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FC-1 | [ ] Merge the consolidated integration PR after required CI and review are green.                                                                                                             | Repository owner                      | GitHub records one integration merge. Until then, the controls are included in the integration candidate, not shipped on `main`.                                                                                                      |
| FC-2 | [ ] Deploy migration `0012_active_clinical_order_billing.sql` to each enabled environment during a quiet billing window. Retry the whole migration if the five-second DDL lock timeout fires. | Deployment owner                      | Migrator logs `Verified Phase-1 clinical-order billing guards.` No environment may be called protected without both enabled triggers and the validated tenant FK. Current environments remain development-only per `ENVIRONMENTS.md`. |
| FC-3 | [ ] Re-run the focused financial-control suites against the deployed database and retain the CI/deployment log.                                                                               | Engineering                           | Sequential double bill, two-connection race, terminal reactivation, missing discount ID, caller omission, shared-kiosk PIN, authorization, route attribution, and correction-receiver preservation all pass.                          |
| FC-4 | [ ] Choose the void/refund approval operating model: staffed per-branch `BranchAdmin` users or formally centralized `TenantAdmin` approval. Name primary and backup approvers.                | Clinic owner                          | Written choice, effective date, branch scope, and named approvers recorded in `phase-1-financial-controls-decisions.md`. Do not widen roles or lower thresholds by assumption.                                                        |
| FC-5 | [ ] Define the patient-credit deposit document treatment, invoice/sale timing, supplementary acknowledgement, and real registered series/configuration.                                       | Clinic owner + bookkeeper/BIR adviser | Written sign-off recorded in the decision file before changing receipt names, allocation, or sequences. Do not invent TIN/permit/series values.                                                                                       |
| FC-6 | [ ] Name the TenantAdmin owner and evidence procedure for legacy payments whose `received_by_id` is null.                                                                                     | Clinic owner + data-migration owner   | Audited repair procedure identifies the source receipt/cashier evidence. Staff never guess attribution; correction remains fail-closed until repaired.                                                                                |
| FC-7 | [ ] After FC-4 through FC-6 are signed, update this checklist and the decision record in one change.                                                                                          | Repository documentation owner        | No open choice remains only in chat, a PR description, or a dated handover.                                                                                                                                                           |

### Revenue-integrity reporting next-step register

This is the only TODO register for the reporting work recorded in the
[2026-08-23 handover](handovers/2026-08-23-phase-1-revenue-integrity-reporting.md).
Items below are deliberately outside PR #618 unless marked as validation.

| ID        | Priority / trigger                                        | Next action                                                                                                                                                                                                    | Decision boundary                                                                                                                    |
| --------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| RPT-1     | **P1, before finance relies on the headline**             | Clinic owner/bookkeeper signs off whether `transactionNetTotal` is the desired operational day figure and defines the formal recognition event and required discount-total presentation for full FR-15 closure | Do not relabel the current aggregate as recognized revenue and do not synthesize a ledger entry                                      |
| RPT-2     | **P1, before clinic pilot**                               | Walk the Reports page as Cashier, Branch, Nurse, Physician, and TenantAdmin against representative rows, including explicit 403/branch-isolation checks and the audit-blocking export failure path             | Keep Nurse/Physician on the unbilled worklist only; tenant-wide finance remains admin-only                                           |
| RPT-3     | **P1, owner process needed first**                        | Define who owns reconciliation exceptions, allowed transitions, evidence/notes, escalation, and resolution audit requirements before adding write actions                                                      | The Phase-1 exception surface remains read-only until the operating process exists                                                   |
| RPT-4     | **Deferred until period-end reconstruction is requested** | Design immutable daily or period-end AR snapshots with correction/backfill rules                                                                                                                               | Current `asOf` ages today's outstanding balances; it must not be presented as a historical balance snapshot                          |
| RPT-5     | **Deferred until each contract is stable**                | Approve columns, retention, access, and audit semantics before exporting AR, unbilled work, or exceptions                                                                                                      | Daily branch/day CSV is the only approved export contract                                                                            |
| RPT-6     | **P2 / tenant #2**                                        | Thread `tenants.timezone` through clinic-date helpers and SQL boundaries, then add multi-timezone tests                                                                                                        | Phase 1 is intentionally fixed to `Asia/Manila` for the first clinic                                                                 |
| RPT-7     | **Implemented model; migration/UAT pending**              | Validate the delivered group/corporate sidecar against representative multi-patient payer settlements and migrate the 69 legacy groups under the migration decision register                                   | Keep the authoritative group transaction and patient/service attribution intact; do not synthesize proportional patient-paid amounts |
| DEV-RPT-1 | **Developer bootstrap reliability**                       | Repair the graphify `set -e`/command-substitution failure and verify the application role receives intended `citext_eq` execute privileges on a clean disposable database                                      | These were reproduced while setting up report E2E but are pre-existing bootstrap defects, not reporting semantics                    |

### P2 — Phase 2 (sellable multi-clinic product)

| #   | Item                               | Why                                                                                                                                                                                                                 |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10  | **Multi-tenant operations**        | Onboarding playbook never rehearsed (no tenant #2); `pnpm db:seed --tenant <slug>` CLI not built (~50 LoC); hardcoded `SVX` in `BranchesPage.tsx:91`; subdomain routing; `tenants.timezone` not threaded everywhere |
| 11  | **Tenant billing**                 | Entirely net-new                                                                                                                                                                                                    |
| 12  | **Cloudflare custom domains + R2** | `app.surevax.com` / `api.surevax.com`, attachment storage bucket                                                                                                                                                    |
| 13  | **Redis-backed rate-limit**        | Only when running multiple server replicas                                                                                                                                                                          |

---

## AppSheet live-data capability gaps (2026-06-19 data pass)

Surfaced by profiling the live AppSheet export (`surevax_gsheet_db.xlsx`) against
v2 — full evidence + counts in
[`handovers/2026-06-19-appsheet-data-crosscheck.md`](handovers/2026-06-19-appsheet-data-crosscheck.md).
These are feature gaps the **data** proves are real (not importer tasks). None
block a _cash-only_ single-clinic go-live, but the top two govern ₱4.5M+ of the
clinic's real partner revenue.

- **[Included in the integration candidate; migration still open] Group / corporate billing** — the live-data need is real: 69 multi-patient transactions, including one 80-patient / ₱90,650 drive. The additive `group_bills` sidecar represents one Corporate payer, exact real-patient services, one authoritative receivable, and one settlement without a fake patient or proportional paid amounts. It does **not** migrate those 69 legacy groups.
- **[P1, operational MVP included in the integration candidate] Revenue-integrity reporting surface**: `/reports` provides bounded AR aging by authoritative transaction-header payer and branch, completed clinical work without an active billing link, reconciliation exceptions (including imported `Mismatch` states), and branch/day transaction-net, tender, drawer, and actual-deposit facts. It is not accounting-recognized revenue, generalized payer statements/collections, or complete discount reporting. Asia/Manila boundaries and role scope are explicit; the stable CSV is delivered only after its SHA-256-bound audit row commits. See the [decision record](handovers/2026-08-23-phase-1-revenue-integrity-reporting.md) and [next-step register](#revenue-integrity-reporting-next-step-register).
- **[Shipped 2026-07-26] SMS reminders as the primary channel**: promoted out of the owner-deferred list below and built the same day it was designed (see "Shipped recently" above and [`nurse-testing-readiness.md`](nurse-testing-readiness.md) R2). Only about 11% of patients have a usable email versus 88% with a valid PH mobile, which is why this outranked the prior deferral for a PEP clinic. A per-row "Text patient" action renders a QR code encoding an `sms:` URI, scanned by the nurse's own phone, since a clinic laptop cannot send SMS itself: no provider account, no PHI leaving the clinic's infrastructure, no spend. The registration form now captures `sms_opt_in`. Automated day-before sending remains a deliberate owner-deferred item; nothing sends without the nurse's manual scan.
- **[Medium, next Review Center slice] Patient-merge workflow** — 77 duplicate (name, DOB) groups, 15 cross-format. `merged_into_id` + `POTENTIAL_DUPLICATE` tag exist in schema, but there is no audited foreign-key ownership plan or explicit correction strategy yet. Phase 1 therefore does not expose an unsafe merge action.
- ~~**[Medium] Double-billing guard**~~ — **Implemented in the integration candidate**: an online-safe database trigger serializes contenders and rejects a second active bill; tenant-qualified linkage and terminal activation guards preserve corrected rebilling, with group-bill concurrency coverage.
- **[Phase 1 Review Center included in the integration candidate] Missing-guardian worklist for minors** — branch-scoped current records surface in a role-gated queue with an optimistic, audited guardian correction. AppSheet exception files and migration-review queues are not queried; the legacy profile measured 1,972 affected minors, including 84 under-2.
- **[Medium, next Review Center slice] External-immunization reconciliation** — capture and chart display exist, but the runtime model has no durable “needs review” signal. The 342 legacy “prior dose / other clinic” remarks remain migration-only evidence and are intentionally excluded from Phase 1.
- ~~**[Medium] Enforce `discount_id_number` capture**~~ — **Implemented in the integration candidate**: shared and server contracts plus the cashier form reject missing or whitespace-only SC/PWD IDs; `NA` and `Other` remain unchanged.
- **[Low] Course-prepayment incentive rule** — the legacy ₱200 "Fully Paid" (pay all doses up-front → auto discount); today a manual discount.

Also reinforced (tracked elsewhere): Phase-1 revenue-integrity reporting is
operational on PR #618's branch at `/reports`, while V14 brand analytics remains
outside this bounded MVP; and the behavior-parity decisions in
`docs/migration/appsheet/OPEN-QUESTIONS.md` Q17–Q21 (calendar-month dose
intervals, late-patient cascade, discount base = non-service items, overpayment
policy). The cash-deposit-to-bank ledger this line used to point at as still-open
is shipped now; see "Shipped recently (2026-07-26, week-one polish batch
cleared)" above.

Also fixed while building pay-on-account (2026-07-25): two latent money-aggregate bugs and one MONEY-5 concurrency gap. `getDashboardStats`'s `cashSplit.nonCash` counted internal `Credit` draws as non-cash collections (it filtered `method <> 'Cash'` instead of excluding `Credit` too); `shifts.getCurrentShift`'s `collected` summed every payment method with no `Voided`/`Refunded`/`deleted_at` filter, inflating a cashier's own figure. Both fixed in `apps/backend/src/modules/dashboard/db.ts` and `shifts/db.ts`. Separately, `addPaymentTx` (`transactions/db.ts`) now takes `FOR UPDATE` on the transaction header before its overpayment check, closing a read-then-write race where two concurrent payments could both pass the MONEY-5 cap.

---

## Deferred backlog (explicitly parked — don't build yet)

Carried forward so nothing is lost. Re-open when the trigger fires.

### Investigation-first (need a focused session)

**Density + UX items deliberately NOT fixed in the 2026-07-25 audit** (each is a
design/product decision or a large-surface change, not drift — full context in
[`docs/audits/2026-07-25-ux-ui-density-audit.md`](audits/2026-07-25-ux-ui-density-audit.md)):

- **The KPI band costs 117–135px on every list page** (~9% of the 1440px clinic
  display) for four numbers. Collapsing it to a single ruled line would return
  ~3 rows per page, but Patterns 10 + 18 lock the anatomy — owner's call.
- **Chrome band paddings still `py-4`/`py-3`.** Trimming each by 8px is ~100+
  call sites for about a third of a row; skipped as poor value. Worth doing only
  if the band padding moves into the primitives (so pages can't drift again).
- **`/scheduled-orders` still spends 527px (36.6%) above the first row** — the
  worst of any page, because it stacks a lane-header layer the other worklists
  don't. Page surgery, not a primitive fix.
- **`TransactionsCreatePage` — the cashier's main screen — explains itself
  poorly and wastes ~480px of the display.** Measured state: 1 `<FormField>`, 0
  `<FormLabel>` / `<FormMessage>` / required markers, 6 raw `<Input>` + 3
  `<Controller>`, 5 hand-rolled lowercase `<label>`s. Two fields (`patientId`
  :568, `items` :760) DO render errors ad-hoc, so it is 2 of ~12 fields with
  feedback, **not zero** — an earlier revision of this entry said "0
  `FormMessage`", which was literally true of the component but overstated the
  user-facing state. `canCommit` gates all three commit entry points, so an
  invalid form yields a dead primary button and no reason. Layout: form column
  capped `max-w-2xl` (672px) with a fixed `w-[360px]` `TenderRail` beside it, so
  at 2560 (~1512px of shell) roughly **480px sits dead between them**.

  **Key fact for whoever picks this up: validation already works.** The page is
  on `useSafeForm` + `zodResolver(transactionCreateSchema)`, so
  `formState.errors` is fully populated — the errors are computed and simply not
  rendered for most fields. This is display work, not "add validation", and it
  is much cheaper than the defect list looks. Do **not** rewrite the page: 1093
  lines carrying multi-patient billing, split tender, BIR discounts and
  prepayment, all load-bearing for money.

  Fix order (each step lands independently). A prior revision of this entry
  listed a step 0, "unblock verification first," on the theory that the
  currency-input `setValue` bug (below) meant the tendered field's local
  `useState` shape couldn't be driven in a test. The nurse-testing readiness
  assessment ([`nurse-testing-readiness.md`](nurse-testing-readiness.md),
  2026-07-26) found that wrong: `e2e/readiness/money.spec.ts` already drives
  `SplitTenderEditor` on this exact page with Playwright's `fill()`. Start at
  step 1.
  1. **Stop disabling the commit button.** Biggest win, smallest diff. Keep it
     enabled, let `handleSubmit` run validation and focus the first invalid
     field, and add a short "what's missing" line beside it for the two
     non-field conditions (`selectedPatient`, `tenderValid`) that RHF can't
     focus.
  2. **Adopt the Form primitives** for the 6 inputs + 3 Controllers. This gives
     the already-computed errors somewhere to render, plus required asterisks
     and `aria-invalid` / `aria-describedby` for free.
  3. **Drop `max-w-2xl` — but spend the room on LENGTH, not width.** A 1100px
     text input is worse than a 672px one; put fields side by side so the form
     gets shorter. What a cashier feels is scrolls per transaction.
  4. **Line items last** — optimize the keyboard path (service → qty → Enter
     adds a row) rather than the appearance.

  Steps 1–2 fix the actual complaint and are roughly a day.

- **9 distinct `SheetHeader` padding variants** across detail rails. Real drift;
  converging them risks regressions in rails the audit didn't exercise.
- **~37 empty states still have no CTA.** The `ListEmpty action` slot now
  exists and is wired on Patients / Services / Bite incidents; the rest is
  mechanical. Rule: CTA only when the list is genuinely empty, never on a
  search miss.
- **Zero optimistic updates** — all 92 mutations are invalidate-then-refetch
  (130 `invalidateQueries`, all in `onSuccess`), so every write costs two round
  trips, masked only by "Saving…" labels.
- **No list virtualization** on transactions / scheduled-orders.
- **`DetailRail` is non-modal at `2xl`** (intentional — the list stays
  clickable) but that means no focus trap on the primary device: keyboard users
  can Tab out of an open rail with no signal. Needs a focus-management decision.
- **AppShell still uses a native `confirm()`** for the active-shift logout
  prompt — the only one in the app; everything else uses `AlertDialog`.
- **Row height is content-driven, not padding-driven, on stacked cells**
  (`/admin/users` stayed 55px through the density change because it renders name
  over email). Check content before anyone proposes a third density tier.

**Direct “New patient” consent dead end — implemented in this remediation
candidate.** `/patients/new` remains a supported route and now requires explicit
Patient/Guardian attestation. `POST /api/patients` creates the patient and active
patient-scoped consent atomically in one tenant transaction, matching the safety
boundary of Arrivals. UX-1 retains the disposable-database rollback/consistency
proof, and UX-7 retains owner approval of the actual wording, version,
guardian/age rules and supported languages. Do not describe that legal-content
decision as already approved merely because the fail-closed transaction exists.

**E2E-surfaced system improvements (2026-07-05, from the anti-rabies daily-loop spec).**
These are real product defects the E2E exposed; the test currently works around
them, but the fix belongs in the system, not the test (principle: improve the
system, don't cater the test to it):

- **Collect-payment picker flashes "No doses found" for a just-administered dose.**
  `usePrepayableDoses` refetches during the busy administer to collect transition
  (React dev StrictMode double-invoke plus the `apiFetch` 401-refresh retry path),
  resolves empty, and `staleTime: 30_000` caches that empty for 30s. The daily-loop
  spec dodges it by re-opening the order on a clean page load. Fix candidates: do
  not cache an empty prepayable-doses result, guarantee the source dose is present
  or preselected, or refetch on mount when the order was just completed.
- ~~**Single-flight the token refresh / stop bouncing valid sessions to
  `/login`.**~~ **Resolved 2026-07-06.** Two fixes landed after the end-of-day
  E2E made the flake reproducible: (1) `AuthProvider`'s `/api/auth/me` bootstrap
  is now refresh-aware and transient-tolerant — a `401` triggers the shared
  single-flight refresh (already in `apiFetch`, now exported) then retries `/me`,
  and a `429`/`5xx` backs off + retries instead of nuking the session; previously
  any non-OK `/me` logged the operator straight out (an expired 15-minute access
  token, or a rate-limit blip, bounced them to `/login`). (2) The global per-IP
  rate limit was `100/min` — ~1.6 req/s for an entire clinic behind one NAT IP,
  which the serial single-IP E2E suite (and any real multi-staff clinic) blew,
  cascading 429s. It is now `600/min`, env-tunable via `RATE_LIMIT_MAX`
  (`apps/backend/src/app.ts` + `env.ts`); the tighter `10/min` credential limiter
  (login/refresh/verify-pin) is unchanged. The full E2E suite is green + stable.
- ~~**Pre-dose FEFO preview endpoint.**~~ **Closed 2026-07-25** by manual brand
  selection: `GET /api/scheduled-orders/:id/eligible-lots` lists every eligible
  brand/lot for a dose (house-brand-first, then earliest expiry) with its
  brand-resolved price, its recall status, and the amount already billed. The nurse
  picks the lot, so `AdministerDialog` shows lot + recall + price BEFORE commit
  rather than after. Automatic earliest-expiry selection is retained only for
  point-of-sale bundle fan-out. Remaining follow-ups: no admin UI for
  `service_eligible_products` or brand `service_prices` rows (seed/SQL-managed),
  and brand price variances are recorded as `audit_logs`
  (`metadata->>'reason' = 'brand_price_variance'`) but not yet surfaced in a report.

- **`GET /api/today` projection** — the Today cockpit fires 4 queries
  (dashboard, scheduled today, scheduled overdue, pending txns). Fine at clinic
  scale; a single projection would cut latency and let lanes carry richer state.
- **Visual-regression linux baselines in CI** — `e2e/visual.spec.ts` is
  local-only (darwin baselines, `VISUAL=1`); CI skips until a baseline-update
  job generates linux snapshots.
- **URL-as-state sweep, remaining list pages** — Pattern 34 (`?selected=` /
  filter params) covers ScheduledOrders, Transactions, Encounters; Lab Orders,
  Clinical Orders, Appointments, Inventory, Bite Incidents, Adverse Events, and
  the admin pages still hold selection in `useState`. Mechanical.
- **Pattern 35 flow treatment beyond scheduled-orders** — the cashier
  (`TransactionsCreatePage`) and Arrivals→payment hand-off still run as
  dialogs; convert to inline flow panels when next touched.
- **Dashboard page retirement** — `/dashboard` survives only for the shift
  menu / roster / stats widgets; fold those into the Today cockpit +
  `/day-summary`, then delete the route.

- **B34 Lab Critical interpretation flow** — server contradicts user action; needs the lab-orders state machine read. (Phase 1 has no critical labs.)
- **B38 Radix dialog DOM cleanup on Cancel** — cosmetic; re-open only if long kiosk sessions show memory growth.
- **AppointmentDetail Participants** — 6 raw-ID fields at `AppointmentDetail.tsx:161-212` need name resolution (likely a `<ParticipantLabel>` primitive).
- **Currency-input programmatic value-set** — RHF `setValue` doesn't fire change handlers on numeric inputs; a programmatic `.value`/`setValue` assignment outside a real input event silently fails to update these fields. Real bug, but **does not block Playwright verification** (corrected 2026-07-26 by the nurse-testing readiness assessment, [`nurse-testing-readiness.md`](nurse-testing-readiness.md)): every money input on these surfaces is a plain controlled `<input>` with `useState` plus a keystroke regex filter, and the one RHF-registered field is uncontrolled, so `fill()`/`pressSequentially()` drive them exactly like a keyboard would. `e2e/readiness/money.spec.ts` already exercises `SplitTenderEditor` on `TransactionsCreatePage` this way, so the step-0 "unblock verification first" gate on the `TransactionsCreatePage` work above no longer applies.
- **Cross-midnight kiosk day-rollover** — needs a clock-advance or seeded yesterday's drawer.
- **Mobile clips (375 / 768px)** — deferred; kiosk hardware is 1024px+.
- **`GET /api/today` consolidated projection** — the cockpit fires 4 queries
  (fine at clinic scale); a single endpoint would cut latency and let lanes
  carry richer state. Carried from the archived architecture-pass handover.
- **Visual-regression linux baselines** — `e2e/visual.spec.ts` runs locally
  (darwin baselines); CI skips until a baseline-update job generates linux
  snapshots.
- **⌘K patient search upgrades** — relevance ranking (prefix > contains),
  phone-fragment matching (possibly already covered by `q` — unverified).
- **`feature_flags` table and `tenants.settings` jsonb have zero readers
  anywhere in application code (2026-07-27 sweep).** Confirm whether either is
  still planned before assuming dead: deleting either is a schema decision,
  not a code cleanup, so it needs an owner call, not an assumption.

### Patient-balance follow-ups deliberately deferred (2026-07-25)

Each was a scoped-out decision while building pay-on-account, not an oversight.
Recorded here because until now they lived only in code comments.

- **Multi-leg idempotent replay.** Replaying a pay-on-account `Idempotency-Key`
  guarantees the effect is never re-applied (the partial unique index on
  `payments(tenant_id, idempotency_key)` is the real guard), but the replayed
  BODY reproduces only the first leg plus live-recomputed totals, not the full
  allocation across N bills. A faithful replay needs a `payment_batches` table
  keyed by the request. Noted in `patient_accounts/contract.ts`.
- **Credit-first inside pay-on-account.** A tender does not auto-draw available
  credit before allocating cash; spending credit stays an explicit action
  (`POST /api/patients/:id/apply-credit`). Deferred because it complicates the
  D2 branch pre-flight and the receipt ordering, and `netOutstanding` already
  tells the cashier what to ask for.
- **Split tender on the pay-balance panel.** `PayBalancePanel` takes one method.
  `SplitTenderEditor` anchors its footer to a single `netAmount` and paints
  over-allocation as an error, which is exactly the case pay-on-account
  legalizes; it needs an `allowOverAllocation` prop first.
- **`depositsCollected` day-stats field.** Deposit cash is correctly excluded
  from `getTransactionDayStats.totalRevenue` (deferred revenue) yet correctly
  included in `closeDrawerSession`'s expected cash (it is physically in the
  drawer). Both are right, but it means day-stats under-reports physical cash
  once deposits are routine. The real fix is a separate `depositsCollected`
  figure, not relaxing either filter, which would double-count when the credit
  is later drawn.

### Small cleanup / housekeeping (surfaced in the 2026-06-20 archive sweep — mechanical, low-risk)

- **[Implemented in PR #616; pending merge] Yesterday's loose ends** —
  `GET /api/review-center?date=` now owns the comprehensive, row-level staff
  worklist. The existing `GET /api/day-summary/loose-ends?date=` remains the
  narrower Branch opening-banner summary; it is not a second Review Center.
  The Review Center includes stale Open/InProgress encounters, unsettled
  non-prepayment transactions, prior Open drawers, and Completed clinical
  orders without a documenting actor using Manila-day predicates.
  `BranchDayOpenPrompt` no longer offers a second drawer while any prior Open
  branch drawer exists. The worklist links to accountable owner workflows and
  never auto-closes clinical or financial records.
- **Admin list pages off the shared list machinery** — Audit / Notifications /
  Approvals / Attendance still hold selection in `useState` instead of
  `useRecentList`; ~80 LoC each. Overlaps the URL-as-state sweep above.
- **Form validation timing** — most RHF forms default to `mode: 'onSubmit'`;
  standardize to `onTouched` for consistent inline errors (M7, archive
  `2026-05-23-360-codebase-review.md`).
- **Duplicated `AuthUser` typedef** — `requireRole` keeps a local copy that can
  drift from the exported `auth.ts` type (M4, same review).
- **Dead acronym registry + unlinked tooltips** — 5 of 8 `AcronymHint` entries
  unused (OSCA/PWD/SC-PWD/ABTC/RIG); acronym tooltips also not yet wired into
  form labels. Either wire (e.g. on the BIR receipt UI) or trim.
- **A few raw `<button>`s → shadcn `Button`** — ClinicalOrders / InitiateProtocol
  tab strips are the genuine targets (~30 LoC).
- **`Missed` scheduled-order status is a dead lane**, no job, cron, trigger, or
  code path ever sets `status = 'Missed'`; the tab always reads zero. Decide
  whether to wire it or remove the tab. See
  [`nurse-testing-readiness.md`](nurse-testing-readiness.md) R5.
- **`Upcoming · 48 h` label does not match its query**: the predicate is
  `current_scheduled_date >= tomorrow` with no ceiling, so it lists every
  future dose forever, not just the next 48 hours. Fix the label or cap the
  query. See [`nurse-testing-readiness.md`](nurse-testing-readiness.md) R5.
- **`applyPrepayment` + `useApplyPrepayment` are dead code**, every real UI
  path uses `applyCreditOnAccount` instead; reachable only by a direct API
  call. See [`nurse-testing-readiness.md`](nurse-testing-readiness.md) R7.
- **Stale locked agent worktrees** — `.claude/worktrees/agent-*/` accumulate;
  `git worktree remove --force` between sessions.
- **Several status/enum columns can only ever reach a subset of their declared
  values, found in the 2026-07-27 "modeled but not wired" sweep** (grouped
  here rather than as separate rows, each is a real dead state, none block a
  workflow today). `encounters.status` is resolved as of 2026-07-28: it now
  has a real complete/cancel lifecycle, see "Shipped recently" above.
  Remaining: `patient_standing_orders.status`
  can only move Active to Suspended, so `Completed` and `Discontinued` are
  unreachable and their UI badge logic can never render; `clinical_orders.refusal_reason`
  has zero readers and zero writers, so the `Deferred` and `Refused` statuses
  are unreachable from app code; `cash_drawer_sessions.state` only ever moves
  Open to Closed, so `Discrepancy` and `Reconciled` are unreachable and
  `reconciledAt`/`reconciledById` are dead even though variance is already
  computed (this is why the cash-drawer-variance E2E in T0 #3 below may have
  nothing real to assert yet, verify before writing it); `transaction_status = 'PartiallyPaid'`
  is never set by app code or the sync trigger; `movement_type = 'Expire'` is
  never written, so expired lots are blocked at issue but never written off
  the books; `users.status` is never read (login gates on `can_login` and the
  lockout columns instead); `clinical_orders.administering_encounter_id` is
  written only by the seed and read nowhere.
- **`phi_access_log.is_break_glass` is always false (2026-07-27 sweep).** Real
  break-glass access is correctly recorded elsewhere (`audit_logs` and
  `cross_branch_access_grants`), but this flag never flips, so a compliance
  query keyed on it specifically under-reports.
- **Modeled but unpopulatable/unenforced fields (2026-07-27 sweep)**:
  `consents.witness_id` and `consents.signature_attachment_id` are in the API
  contract but neither insert site sets them; `service_catalog.requiresConsent`
  and `requiresVis` are CRUD-complete but enforced nowhere beyond the existing
  blanket patient-level consent gate (Phase 1 semantics already documented in
  `patterns.md`).
- ~~**More dead code found in the 2026-07-27 sweep, safe to delete**~~:
  **Resolved 2026-07-28.** All five are now removed: `publishDomainEvent`
  (and the whole unused `domain_events` publisher module with it, zero
  callers, and seventeen of the eighteen declared domain event types were
  never produced), `recordFollowupOutcome`'s non-tx wrapper,
  `writeScheduleChangeAuditStandalone`, `useUploadAttachment`, and
  `useRecomputeScheduledOrder` (the manual recompute hook nurse-testing
  readiness R5 already noted had no caller, the cascade only ever fires as a
  side effect of administering). Also fixed: attachment delete's missing
  error path (`components/ui/attachment-list.tsx` now has a real
  `onError`/`isError` check).
- **Payer-contract editing has no UI (2026-07-28).** Listing and create are
  now wired (`PayerContractCreateDialog.tsx`); `PUT
/api/payer-profiles/:id/contracts/:contractId` exists server-side with no
  frontend caller, deliberately deferred rather than half-built.
- **`patients/contract.ts` has a pre-existing response-type drift, widened by
  the dose-strip work (2026-07-28).** The `create` endpoint's manifest entry
  maps to `patientDetailSchema` (`apps/backend/src/modules/patients/contract.ts:569`)
  while the route actually satisfies the narrower `patientRowSchema`, so the
  generated `PatientsCreateResponse` type (`pnpm gen:contracts`) now
  advertises `doseStates`/`pepCompleted`/`pepTotal`, fields the create
  response never sends. Fix is a one-line manifest correction; not done here
  since it was found, not caused, by this pass.
- **`approval_request_type` has no `refund_transaction` member (2026-07-28).**
  Refunds reuse the `void_transaction` enum value with a distinguishing
  `entityType` to tell them apart; adding a dedicated enum member is a
  migration, deliberately not done as part of the approval-threshold work.
- **[Delivered 2026-08-23] Day-summary CSV export.** The old disabled Day
  Summary button remains untouched, but `/reports` now owns the stable
  branch/day export: the server generates the CSV, hashes it, persists an
  `EXPORT` audit event, then returns the artifact. Audit failure prevents file
  delivery.

### Database-hygiene follow-ups (before real patient data — archive `2026-05-18-database-hygiene.md`)

- **Disaster-recovery drill** — beyond confirming backups exist (P0 #3), actually
  practice a restore at least once.
- **Filipino name handling** — suffixes (Jr./Sr./III), multiple surnames; a data-
  quality concern for the AppSheet import, not just display.
- **Effective-dated history** for `payer_contracts` + `tag_definitions` so price/
  tag changes keep an audit trail (currently last-write-wins).
- **Read-replica planning + connection pooling** — Phase 2 scale only; pooling
  defaults (H1) already shipped, replicas are net-new.

### External / decision-blocked

- **BIR receipt rebuild** (also P0) — needs real ops values: TIN, PTU/ATP, OR-series range, VAT breakdown, SC/PWD line, cashier signature, dynamic footer; drop the `[serviceType]` bracket; unify locale to `en-PH`.
- **Deposit invoice/receipt semantics, decision-gated and not changed (reviewed 2026-08-22)**: an item-less patient-credit deposit (`is_prepayment=true`) currently follows the ordinary payment-settlement receipt sequence. EOPT rules make an Invoice the principal sales document and permit supplementary collection acknowledgements, but code cannot infer when this clinic treats an advance as a billed sale. Phase 1 therefore keeps money and sequence behavior unchanged and labels deposit capture as patient-credit acknowledgement. Owner/bookkeeper must choose timing, document class, and registered series in [`phase-1-financial-controls-decisions.md`](phase-1-financial-controls-decisions.md).
- **The Statement of Account cannot render a TIN block (2026-07-25)**: `/patients/:id/statement` builds its letterhead straight from `patient_accounts` `GET /:id/ledger`, whose `branch` object carries only code/name/address/city/province/contactNumber. The BIR settings that drive the Official-Receipt layout live in `branches.settings.receipt.bir` and are NOT on that contract, so unlike `AcknowledgementReceipt` (which gets them via `buildClinicInfo`) the statement has no signal to check and always renders the acknowledgement form. Harmless while every branch is in acknowledgement mode; it is a gap the moment a branch is BIR-registered. Fix is additive: widen the ledger contract's `branch` to carry the receipt settings, then reuse the same conditional block the receipt uses. Fold into the BIR receipt rebuild.
- ~~**`branches.settings` is never written by any insert or update path (2026-07-27 sweep)**~~: **Resolved 2026-07-28.** A TenantAdmin can now set `branches.settings.receipt.bir` (TIN, registered name, permit number) via `BranchReceiptConfigDialog.tsx`; see "Shipped recently" above. Only the real BIR registration values remain outstanding, which is the unchanged P0 #2 blocker above.
- **Phase 2 customer trial** — onboarding playbook (`docs/runbooks/tenant-onboarding.md`) unrehearsed; catalog-copy SQL + rollback steps unverified.
- **H3 Redis rate-limit** — Phase 2 / multi-replica only.
- **M14 expanded observability** (log shipping, OpenTelemetry) — vendor decision; Sentry is the Phase 1 ceiling.
- **M17 audit JSONB encryption** — needs a threat model + key-mgmt choice (KMS vs Vault vs pgcrypto).
- **Railway spend cap** (also P0) — dashboard knob.
- **Cloudflare custom domains + R2** (also P2) — external knobs.
- **Bot1 / Pneumococcal / Hep-TDAP-Varicella-Shingles SOT offsets** — ops sign-off before catalog/seed changes.
- **Audit-log Wave A emit sites** (`CONFIG_CHANGE`, `AUDIT_ACCESS`) — upstream UI work; don't implement speculatively. (`CROSS_BRANCH_ACCESS` now emits via the break-glass flow, #531.)
- **SEC-7 operator DB-backed lockout** — in-process lockout (5 fails → 15-min) works for low-traffic operator login but resets on restart; the durable version (`platform_users.failed_login_count` + `locked_until`, mirroring `auth/db.ts`) is cheap when operator traffic grows.

### Phase 2 multi-tenant code references (unblock at tenant #2)

- `apps/frontend/src/features/admin/BranchesPage.tsx:91` — hardcoded `SVX` KPI → pull from tenant context.
- `apps/backend/src/shared/db/seed/*` — single-tenant seed → `pnpm db:seed --tenant <slug>` flag.
- `tenants.timezone` — stored but only consumed in some surfaces → thread through day-summary / retention.
- H3 Redis rate-limit (above).

### UI / UX deferred (owner-confirmed — leave as-is)

Appointments; automated lab-result feeds; richer (body-map) bite assessment;
per-role landing pages / role-gated UI; the command-verb bar ("collect 500
garcia" — explicitly excluded as power-user scope, don't build without a fresh
ask); tablet / kiosk / mobile / touch; offline
mode; dark mode (no `.dark` CSS vars); Tagalog / `fil-PH` i18n (no i18n
infrastructure); compliance bulk-exports (BIR / DOH / PhilHealth); payment-gateway
integration. **[2026-06-19 data pass, resolved 2026-07-26]** SMS reminders were
parked here, but the live-data pass (~11% usable email vs 88% valid mobile)
argued for promoting them to P1, and the owner approved a manual, QR-code-based
texting feature instead of full automation, see the "AppSheet live-data
capability gaps" section above and [`nurse-testing-readiness.md`](nurse-testing-readiness.md)
R2. Only the automated day-before send stays deferred here.

---

## Verification status (browser-driven)

~50 of ~54 user workflows verified end-to-end (~87%) at the last preview pass.
**Full per-workflow tracker (historical):**
[`archive/2026-05-23-preview-workflow-coverage.md`](handovers/archive/2026-05-23-preview-workflow-coverage.md).

**Remaining / blocked workflows** — most gated on seed data or a known bug:

- Bite-incident + 14-day outcome; AEFI new report (need PatientPicker exercise)
- Lab result with `criticalValue=true` (needs the B34 fix)
- Apply prepayment to a draft (needs a prepayment-state txn)
- Each payment method + BIR senior/PWD on a real receipt (previously listed as blocked by the currency-input bug; that claim was wrong, corrected 2026-07-26, see T1 #5 below and [`nurse-testing-readiness.md`](nurse-testing-readiness.md))
- Cash-drawer close with variance; Day-Summary "Close day" (defer to staging)
- Inventory transfer ship → receive (needs a 2nd branch); recall affecting a lot (needs a recall row)
- Approval approve / reject (seed has 0 approvals); notification template dry-run + send
- WHO cat I / III arrivals variants; edit-patient add allergy/condition inline
- `row_version` two-tab conflict; refresh-token rotation >15 min idle; `DirtyFormGuard` `beforeunload` in a real browser
- **Per-role walkthroughs** — only the SuperAdmin and Branch-kiosk personas have
  ever been click-tested end-to-end; the Cashier / Nurse / Physician journeys are
  unaudited (surfaced in the 2026-06-20 archive sweep, from
  `archive/2026-05-17-preview-walkthrough.md`).

**Seed-data prereqs to unblock the above:** ✅ all six in the seed as of
2026-06-12 — a prepayment-state transaction, a notification template, a pending
approval, a product recall whose pattern actually matches a current lot
(`FLU-2026-` bare prefix; the matcher escapes `%`), a second branch (TMG, with
TenantAdmin `user_branches` membership), and a lab order with
`has_critical_value = true`. The blocked workflows above are now drivable.

**Also fixed in the seed (2026-07-26, nurse-testing readiness pass)**, see
[`nurse-testing-readiness.md`](nurse-testing-readiness.md) R9: vaccine lot
expiries now compute relative to the run date (`dateStr(daysFromNow(N))`)
instead of hardcoded absolute strings, some of which had already silently
expired; the anti-rabies pool is raised from 56 to 400 (Abhayrab) plus 300
(Speeda) units; ERIG raised 17 to 270 and HRIG 13 to 305; ATS and HTIG, which
previously had no lot at all, are now seeded at 250 each. **Caveat:**
`pnpm db:seed` is idempotent (`onConflictDoNothing()`) and will not top up an
existing lot: a database seeded before this change needs a fresh reseed
(`pnpm run setup --force`, or a plain reseed) to get the new stock.

### E2E coverage backlog — highest-leverage workflows to automate next (AppSheet-migration lens)

Elaborates P1 #6. The lens: what does the clinic do **every day in AppSheet
today** that would break trust or clinical safety if it silently regressed in the
new CMS, and which **AppSheet bot logic** (the automations we re-implemented) has
no regression net. IDs in parentheses trace to the conformance audit
([`docs/audits/2026-05-17-appsheet-conformance/SureVaxCMS_Conformance_Checklist.md`](audits/2026-05-17-appsheet-conformance/SureVaxCMS_Conformance_Checklist.md))
and the invariants in [`docs/ai-context/06-PRODUCT-WORKFLOWS.md`](ai-context/06-PRODUCT-WORKFLOWS.md).

**A third, separate layer sits alongside this regression backlog:**
[`e2e/readiness/`](../e2e/readiness) is the nurse-testing readiness checklist
([`docs/nurse-testing-readiness.md`](nurse-testing-readiness.md)), run via
`pnpm test:readiness`. It is opt-in, deliberately **not** part of `pnpm
test:e2e`, and does not gate CI, because it answers "can a nurse do their job
yet?" against the actual Branch-login workflows, not "did this commit
regress?" A red readiness checklist is a status report for the owner, not a
broken build. **Executed for real 2026-07-26** (it had only ever been
compile-verified before), and again after the week-one polish batch cleared
what it flagged: 19 passed, 5 skipped, 0 failed, plus the CI-gating suite at
19 passed, the backend integration suite at 324 passed across 38 files, 99
frontend component tests, and 161 backend unit tests. See "Shipped recently
(2026-07-26, week-one polish batch cleared)" and "Shipped recently
(2026-07-26, nurse-testing readiness suite proven plus two fixes it
surfaced)" above.

**Already covered by `e2e/`** (don't re-list): login variants (`auth.spec.ts`),
authenticated page-load smoke (`smoke.spec.ts`), the anti-rabies PEP **Day-0**
loop register→administer→collect at WHO Cat II / IM 5-dose (`daily-loop.spec.ts`),
the Arrivals wizard non-Rabies happy path (`arrivals.spec.ts`), cashier
create-transaction-as-Pending (`transactions.spec.ts`), the end-of-day
day-summary report + "Close day" snapshot (`day-summary.spec.ts`, structure +
snapshot only — **not** the cash-drawer variance path), and new-patient create
happy path with a unique name (`patient-registration.spec.ts`, **not** the
duplicate-match block path).

**T0 — the AppSheet bot logic with the most complex behavior + highest clinical stakes (do first):**

1. **Follow-up dose over multiple visits + late-dose cascade recalc** (Bot 3
   `Adjust future appointments`; S1/S2/S3 slices; Invariant 4). The single biggest
   gap: `daily-loop.spec.ts` stops at Day-0. Administer a Day-3 dose **off-schedule**
   (e.g. on Day-5) and assert all downstream sibling `current_scheduled_date`
   values shift by the delta (`scheduled_orders` recompute). This cascade is the
   entire reason AppSheet had the SOT + `_THISROW_BEFORE/AFTER` bots; it drives PEP
   completion (the named "follow-up scheduling failure" risk). Drives
   `ScheduledOrdersPage` → `AdministerDialog`.
2. **WHO Category III arrivals: multi-template bundle + weight-based RIG** (Bot 9
   `Create immunization bundle` / `fanOutBundle`; Invariants 18, 22). `arrivals`/
   `daily-loop` deliberately dodge this via Cat II. Register a Cat III bite walk-in,
   multi-select ARV + ERIG/HRIG + ATS, hit the RIG commit gate, enter `weight_kg`,
   and assert the auto-computed vial count. Drives `/arrivals` Step 3 + dose calc
   (`/api/dose-calc`).
3. **Cash-drawer close with variance** (V8 `Time In/Time Out`, NurseShift
   `Time Out`; Invariant 26). The day-summary report + "Close day" snapshot is now
   covered (`day-summary.spec.ts`); the still-untested half is the drawer money
   path: clock-in opens a drawer → create transactions → Close Register → enter a
   physical count **with a variance** → assert Over/Short + the mandatory
   `discrepancy_reason` gate. Drives `BranchKiosk`. **Check before writing this
   one** (2026-07-27 sweep finding, small-cleanup section above):
   `cash_drawer_sessions.state` only ever moves Open to Closed in app code
   today, so `Discrepancy`/`Reconciled` may not exist yet to assert against.
4. **Backfill (Past & Valid) administration** (V6/S1 `Past and Valid`, the 3-day
   window). A pure AppSheet slice. Open the `Backfill · 3d` tab on
   `ScheduledOrdersPage` and administer an overdue dose; assert it leaves the
   backfill list and `backfillCount` decrements.

**T1 — daily money + clinical closure workflows staff touch constantly:**

5. **Payment variants on a real receipt** (Transaction actions; Invariants 2, 5,
   13). Split/partial tender (cash + GCash) and SC/PWD BIR discount math.
   **Unblocked** (corrected 2026-07-26 by the nurse-testing readiness
   assessment): the currency-input `setValue` bug never actually blocked a
   browser test, only a programmatic `.value`/`setValue` assignment outside a
   real input event; see the deferred backlog entry for what the bug actually
   is. **Fully covered now**: `e2e/readiness/money.spec.ts` (opt-in, `pnpm
test:readiness`) drives a real, passing split-tender settlement on the
   cashier create page, and the OSCA/PWD discount specs there are now real,
   passing tests too, since the VAT-exemption bug they were waiting on (P0
   #15) is fixed; see [`nurse-testing-readiness.md`](nurse-testing-readiness.md)
   R4 and R8.
6. **Void / refund with approval threshold** (Transaction `Request Modification`,
   Stories 30/32; void >₱1,000 → manager, refund >₱5,000 → admin). Assert the
   revenue/AR aggregates exclude the voided/refunded row. **The gate itself
   now exists** (2026-07-28, see "Shipped recently" above): `voidTransaction`
   files a Pending `approval_requests` row and refuses `APPROVAL_REQUIRED`
   past the threshold, covered by eight backend integration tests. What is
   still missing is the browser E2E driving this through the UI.
7. **Scheduling-FSM terminal closure — Defaulted / Transferred** (Invariant 24).
   The ABTC "ghosted patient" close-out (patient transferred to an LGU facility):
   close a standing-order chain with a reason code and assert all remaining
   Pending/Due/Overdue orders move terminal and drop off active worklists.
8. **Duplicate-detection block on registration** (MPI, Req 2; `PatientDuplicatePanel`).
   The new-patient create happy path is now covered (`patient-registration.spec.ts`,
   which deliberately uses a unique name to avoid the panel); the untested half is
   the **match** path: register a patient whose name+DOB collides with an existing
   record and assert the panel surfaces the match and gates the submit. Drives
   `/patients/new`.

**T2 — periodic / multi-actor workflows (lower daily frequency, still migration-critical):**

9. **Inventory transfer ship → receive** (Bot 10 `Create inventory log transfer`,
   the reciprocal-log bot). Now unblocked by the seeded 2nd branch (TMG). Ship from
   source, receive at destination, assert paired `Transfer` movements + balances.
10. **Brand-pick ordering + lot hard-stops through the UI** (Invariants 6, 14).
    The backend side landed 2026-07-25 with integration coverage
    (`tests/integration/brand-selection.test.ts`: house-brand-first ordering,
    `LOT_NOT_ELIGIBLE` / `LOT_QUARANTINED` / `LOT_NOT_FOUND`, brand price ladder,
    variance audit). Still missing at the browser layer: driving the picker to a
    NON-default brand and asserting the "over billed" warning gates Confirm.
11. **Break-glass cross-branch PHI reveal** (Invariant 25). The emergency override
    for a patient mid-PEP at another branch: typed reason → `POST
/api/patients/:id/break-glass` → chart reveal + `CROSS_BRANCH_ACCESS` audit.
    **Now covered**: `e2e/readiness/patient-access.spec.ts` drives this exact
    flow as a real, passing test. It used to be blocked on the route being
    `TenantAdmin`/`BranchAdmin`-only for the `Branch` persona and on no seeded
    patient being homed off HST; both are fixed (closes P0 #14), see
    [`nurse-testing-readiness.md`](nurse-testing-readiness.md) R3.
12. **Corporate/group billing** now has a Chromium happy path in
    `e2e/group-billing.spec.ts` (review exact patient/service allocations before
    commit, create one group bill, and read it back). The older generic
    **multi-patient family-billing** flow from 2026-06-20 remains untested at the
    browser layer. **Prepayment / patient credit is also covered**:
    `e2e/readiness/money.spec.ts` (opt-in, `pnpm test:readiness`) drives a real,
    passing prepay-a-future-dose-in-full-plus-downpayment-hold-balance check; see
    [`nurse-testing-readiness.md`](nurse-testing-readiness.md) R7.
13. **Health card PDF** (B11), **product recall affecting a lot** (Req 13),
    **approvals approve/reject**, **notification-template dry-run + send**, and the
    **Cashier / Nurse / Physician per-role walkthroughs** (only SuperAdmin +
    Branch-kiosk personas are audited).

### Sensitive-correction workflows — logged + warned, not queued (owner decision 2026-07-06)

Nurses need to **correct** records after the fact (wrong date, wrong payment
method, wrong vaccine brand, void a mistaken sale, pull a chart from another
branch). In AppSheet these were `[ADMIN]` overrides + a "Request Modification →
manager approve" flow. **Owner decision:** do **not** build a blocking approval
queue for these. Instead the correction is performed **inline**, the UI shows an
at-point-of-action **warning that the action is logged**, and each event lands in
a **reviewable log** (`audit_logs` + a dedicated "Sensitive corrections" review
surface, in the spirit of `/admin/cross-branch-access`). This is deliberately
lighter than the existing `approval_requests` infra (keep that for the money
thresholds in Invariant on void/refund >₱1,000 / >₱5,000). The point of the
loud "this is logged" warning is that accountability, not pre-approval, is the
control.

The corrections themselves collide with the DB **immutability triggers**
(`0004_immutability_and_generated.sql`): Paid/Voided `transactions` and Completed
`clinical_orders` are locked, so three of the five need a build before they can
be tested. "Nurse requests the edit" = nurse performs it inline (warned +
logged), not a pre-approval gate.

**Test-now (already built — write the E2E, add the logged-event + warning UX if missing):**

- **Void / delete a transaction** (`POST /api/transactions/:id/void` for
  non-Paid, `POST /:id/refund` for Paid; `useVoidTransaction` + `RefundDialog`
  already wired, and it records `voidReason`/`voidedById`/`voidedAt` + audit).
  E2E: void a Pending txn with a reason and assert it drops out of revenue/AR
  aggregates; refund a Paid txn and assert the reason + threshold gate (the
  gate itself now exists as of 2026-07-28, see "Shipped recently" above; the
  E2E for it is still not written, see T1 #6 above). Confirm the "this action
  is logged" warning renders in the void/refund dialogs.
- **Request cross-branch patient access** (`POST /api/patients/:id/break-glass`
  - `cross_branch_access_grants` + `/admin/cross-branch-access` review page).
    This already **is** the logged-not-queued model (typed reason → immediate
    read access → `CROSS_BRANCH_ACCESS` audit + grant row, reviewed after the
    fact). E2E: open an out-of-branch patient → `BreakGlassReveal` (assert the
    logged-action warning) → chart reveal → grant appears in the admin review
    list. (This is the same workflow as T2 #11 above; the correction lens just
    confirms the warning + review surface exist.)

**Build-first, then E2E (net-new — immutability blocks it today):**

- **Backdate a transaction date to a prior day.** `transaction_date` (business
  date) has no edit endpoint and each row's real wall-clock `created_at` must
  stay untouched. Enhancement: an endpoint to amend `transaction_date` only,
  which asserts `created_at` is preserved, writes a logged correction, and warns
  the nurse. Decide whether backdating a Paid txn is allowed (immutability
  trigger currently permits only status/deleted_at/prepayment changes on Paid) or
  restricted to Pending. E2E once built: edit date to yesterday → assert
  `transaction_date` moved, `created_at` unchanged, correction logged.
- **Change a payment's method (one MOP → another,** e.g. recorded Cash, actually
  GCash). Payments are immutable; no change-method endpoint exists. Enhancement:
  correct `payment_method` (+ reference) with a logged event + warning, keeping
  the money total invariant intact. E2E once built.
- **Change which vaccine brand/product was administered.** The hardest: Completed
  `clinical_orders` are immutable (only `deleted_at`), and per `patterns.md` an
  amendment must be a **new row**, not a mutate. The correction must also
  **reverse the wrong lot's inventory deduction and deduct the correct lot**
  (stock integrity, Invariant 3/6), then log it + warn. Enhancement is a
  correction/amendment path over administered orders. E2E once built: administer
  brand A → correct to brand B → assert brand-B lot deducted, brand-A lot
  restored, amendment logged.

---

## Decisions only the owner can make (these gate P0)

> Collect these via the **go-live requirements questionnaire**
> ([`docs/go-live-requirements-questionnaire.pdf`](go-live-requirements-questionnaire.pdf),
> generated by `scripts/gen-golive-questionnaire.py`) — the cross-department
> instrument built for exactly this (clinical / business-dev / ops / compliance / IT).

- **Pick a go-live date with ONE specific clinic** — everything sorts from here.
- Provide the **real BIR registration values**.
- Choose the **AppSheet cutover approach** (big-bang import vs parallel-run).
- Provide the **external account knobs**: Cloudflare domains, Sentry DSN, Railway spend cap, R2 bucket.
- Have a bookkeeper or the clinic's BIR consultant confirm the **SC/PWD discount receipt layout** satisfies the separate-disclosure requirement; the VAT math itself is now fixed (closes P0 #15), see [`nurse-testing-readiness.md`](nurse-testing-readiness.md) R8.
- **Decide whether to backfill `clinical_orders.indication` on pre-existing standing-order courses (2026-07-28).** As of this pass `indication` is written going forward (see "Shipped recently" above), so `getPepProgress` works for any course started from now on, but every course registered before this pass still reads not-started. A backfill would key on `patient_standing_orders.template_id` with the same four-template mapping the going-forward write uses. Deliberately not written here: rewriting clinical classification on existing rows is an owner decision, not a migration to slip into a sweep. This is the highest-value remaining gap on the patient chart.

### Open clinical questions (need a clinician/owner sign-off — gate the catalog + AppSheet migration)

These are clinical decisions, not engineering. They block finalizing the vaccine
catalog/seed and closing the AppSheet dose migration (surfaced in the 2026-06-20
archive sweep, from `archive/2026-05-19-remaining-todos.md` and risks.md #4):

- **Pneumococcal (PCV13 / PPSV23)** — include in the catalog? what Day-365 booster
  offset for high-risk patients?
- **Hep / TDAP / Varicella / Shingles** — the standing-order day-offsets in the
  seed need validating against the clinic's actual SOP document. **[2026-06-19
  appdoc pass]** the legacy `_SD` creators schedule these by calendar month
  (`EOMONTH`, day-of-month preserved), not the fixed 28/30/180-day offsets the
  seed uses — see `docs/migration/appsheet/OPEN-QUESTIONS.md` Q17/Q18.
- **Bot1 regimen** — has 3 empty "New step" placeholders; recommendation is to
  delete them, awaiting owner confirmation. **[2026-06-19 appdoc pass]**
  re-checked against the raw AppSheet export: these are actually configured (they
  set `i_Label`, touch remarks, and trigger the pet-update action), not empty —
  only one bare `New step Output` process-state stub exists, and all are moot
  under v2's explicit standing-order items. Effectively closed.
- **PEP/PrEP rabies dose reconstruction** — deferred clinical calls remain (the
  "A2 4→5 dose transition" and questions Q4/Q5/Q8/Q11); ~2,824 dose rows are
  flagged for manual review before the migration can fully close.

## Recommendation

Don't add features. **Commit to a go-live date with one clinic and work backward.**
That forces the right order: production hardening → BIR values + backups → data
migration → frontend/E2E tests + alerting. Phase 2 (more clinics) only makes sense
after one clinic is happily running on it.

---

## Archive sweep (2026-06-20)

A full pass over the 30 archived handovers folded the net-new items above into
this doc (small cleanup, DB-hygiene follow-ups, the per-role verification gap,
and the open clinical questions). The pass also **confirmed against current code**
that the alarming-sounding bugs flagged in the May 23 + May 27 audits are already
fixed — do not re-chase these:

- `analyticsRefresh` querying the dropped `users.role` column (`// WORK-1 fix`).
- Notification pipeline logic (`NOTIF-1`/`NOTIF-3` — template matching, recipient
  resolution, sender hook all wired; only the real SMS/email provider is a
  deliberate Phase-1 stub, which is the already-deferred integrations item).
- ~~Product-recall → patient notification fan-out (`product_recalls/db.ts`, RECALL-1).~~
  **Correction (2026-07-26): this was wrong, do not repeat it.** The
  nurse-testing readiness pass re-checked the code: `fanOutRecallNotifications`
  is fully implemented but is called from nowhere, not `createRecall`/
  `updateRecall`, no route in `product_recalls/routes.ts`, no frontend caller,
  no worker. A real product recall today notifies zero patients. See P0 #21
  below and [`nurse-testing-readiness.md`](nurse-testing-readiness.md) "Found
  alongside, not part of the ten."
- Previously-skipped integration suites (zero `describe.skip` remain).
- "SuperAdmin" in the add-user role picker (type-only back-compat; not offered in UI).
- Day-Summary 500, the administer-dose ID-format crash, PatientPicker submit (B27),
  the format-module consolidation, and the D2 branch-invariant trigger.

## Codebase hygiene status

| Area              | State                                                                                                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend tests     | 396 tests across 47 files (unit + integration), green on the PR #615 branch after isolating the group-billing credit fixtures; BEGIN/ROLLBACK helper; strict-tenant + cross-branch suites green |
| Frontend tests    | MSW + RTL + jsdom scaffold; 101 tests, including 2 group-billing allocation/form tests; coverage floor still 1% — depth growing (P1 #6)                                                         |
| Schema/migrations | Schema v2 cutover complete; 8 themed migration files + later additive ones; migrations apply cleanly (Railway-parity CI green)                                                                  |
| RLS               | `branch_isolation` now `AS RESTRICTIVE` + default-closed (#531); break-glass read-only via `WITH CHECK`; two-role split (AUTH-2)                                                                |
| Audit             | Strict-tenant trigger; SHA-256 hash chain; PHI access log default-on                                                                                                                            |
| Routing           | Data router (`createBrowserRouter`); `DirtyFormGuard` SPA-nav guard                                                                                                                             |
| Security headers  | Helmet hardened — CSP `'none'` (JSON-only API), HSTS 2y + preload, CORP same-site                                                                                                               |
| Observability     | Sentry init (errors only; needs DSN); pino-http correlation IDs                                                                                                                                 |
| API contracts     | 16 modules on contract.ts + gen:contracts + CI drift gate (#558/#559), with group-billing input schemas sourced from `@surevax/shared`; rest convert on next touch                              |

---

## Cross-references

- [`TODO.md`](../TODO.md) — conventional root pointer to this backlog
- [`docs/specs/review-center-phase-1.md`](specs/review-center-phase-1.md) — Runtime Review Center behavior, safety boundary, and explicit next slices
- [`docs/handovers/2026-08-23-review-center-phase-1.md`](handovers/2026-08-23-review-center-phase-1.md) — dated implementation, adversarial-review, verification, and deployment record for PR #616
- [`docs/audits/2026-07-25-ux-ui-density-audit.md`](audits/2026-07-25-ux-ui-density-audit.md) — UX/UI/visual-density audit measured at 2560×1440; source of the density + dead-end items above
- [`docs/audits/2026-06-12-comprehensive-review.md`](audits/2026-06-12-comprehensive-review.md) — 360° review. **Was orphaned** (no inbound links) and several findings are still open in code — verify against code, not this doc, before assuming any of them shipped
- [`docs/handovers/2026-06-19-appsheet-data-crosscheck.md`](handovers/2026-06-19-appsheet-data-crosscheck.md) — AppSheet cross-check + live-data pass; source of the "AppSheet live-data capability gaps" section above
- [`docs/handovers/2026-08-23-phase-1-revenue-integrity-reporting.md`](handovers/2026-08-23-phase-1-revenue-integrity-reporting.md) — PR #618 implementation, investigation, financial semantics, access matrix, adversarial review, verification, and limits
- [`docs/go-live-requirements-questionnaire.pdf`](go-live-requirements-questionnaire.pdf): cross-department go-live question set (owner decisions gating P0)
- [`docs/ENVIRONMENTS.md`](ENVIRONMENTS.md) — dev → production transition plan
- [`docs/specs/cross-branch-phi-access.md`](specs/cross-branch-phi-access.md) — cross-branch design (implemented)
- [`docs/runbooks/tenant-onboarding.md`](runbooks/tenant-onboarding.md) — Phase 2 onboarding playbook (unrehearsed)
- [`docs/runbooks/auth2-rls-cutover.md`](runbooks/auth2-rls-cutover.md) — RLS cutover runbook
- [`docs/ai-context/_INDEX.md`](ai-context/_INDEX.md) — deep architecture / context docs
- [`docs/decisions/README.md`](decisions/README.md) — architecture-decision index; the corporate/group billing ADR owns the accounting, privacy, BIR terminology, and migration compatibility decisions
- [`docs/handovers/2026-08-23-corporate-group-billing-pr.md`](handovers/2026-08-23-corporate-group-billing-pr.md) — PR #615 implementation/review/verification history
- [`.claude/rules/gotchas.md`](../.claude/rules/gotchas.md) + [`patterns.md`](../.claude/rules/patterns.md) — implementation landmines + patterns
- [`docs/handovers/archive/`](handovers/archive/) — all historical handovers (incl. the two this doc supersedes)
