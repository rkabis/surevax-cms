# Executive Summary

## Branch-account live usability audit

- **Requested artifact date:** 2026-08-22
- **Live walkthrough performed:** 2026-08-23 (Asia/Manila)
- **Persona:** busy Philippine ABTC branch nurse/cashier on a shared clinic workstation
- **Account role:** Branch — Main Branch Account
- **Branch:** HST — SureVax Holy Spirit Branch
**Evidence basis:** rendered browser interaction against a fresh, task-specific database containing only repository seed data

> **Pilot judgment: NO-GO, including for a supervised pilot.** A Branch account can update a patient whose home chart belongs to another branch without first using the visible reveal/break-glass control. The app also presents the prior calendar date as “Today” in transactions and day close, signs the Branch session out after a mistyped staff PIN, and permits prepayment against a dose that the same chart describes as completed with no active standing order. Supervision would reduce neither the cross-branch integrity exposure nor the risk of reconciling the wrong clinic day.

The strongest parts are the clinical checkpoints: patient identity is prominent once an encounter or administration review is open; required consent, specialty and chief complaint fail inline; WHO Category III is plainly described as requiring ARV plus RIG; and the administration review repeats patient, dose and date before attestation. Those strengths are undermined at the queue, account, stock-lot and recovery boundaries.

### Decision gates before any pilot

1. Block cross-branch writes until an authorized, auditable break-glass event has succeeded.
2. Make every “Today” surface use the branch-local clinic date and reconcile transaction, drawer and day-summary totals to that same boundary.
3. Treat staff PIN failure as an action-level validation error, not an account-authentication failure.
4. Prevent collection against completed or nonexistent standing-order doses.
5. Require the administering clinician to verify the actual lot/expiry (or scan it) before committing.

## Method and evidence labels

- **Observed:** directly interacted with and visually inspected in the rendered app. Browser snapshots were used only to locate controls and confirm accessible state; they were not treated as visual QA.
- **Code context:** read-only repository context used to understand intended role and workflow boundaries. It did not replace live reproduction.
- **Inference:** operational or safety consequence derived from the observed behavior; it is explicitly labeled where material.
- All displayed patients, staff, transactions and identifiers were synthetic repository fixtures. Credentials, passwords, PINs, tokens and browser internals are absent from this report and its screenshots.
- HST was selected because the clean seed gave it the fullest daily-workflow fixture set: an open clinic day and drawer, on-shift nurse/physician/cashier staff, active encounters and scheduled orders, payments, inventory lots, transfers, an approval fixture and a cross-branch patient.

## Workflow coverage

| Area | Status | What was exercised | Material limitation |
|---|---|---|---|
| Branch sign-in and orientation | Completed | UI sign-in, Branch/HST identity, landing route, persistent clinic-day banner | Password reset and SSO are marked “Soon” |
| Open day / clock-in | Completed | Open-drawer state, opening float, on-shift roster, available staff, incorrect-PIN recovery | Did not clock staff in/out with a valid PIN |
| Today dashboard | Completed | Care-now, payment, done, due/overdue priorities, links and cross-surface count comparison | No live SMS delivery |
| Arrival / patient identification | Completed | Existing-patient search, no-match registration path, identity display, required fields, consent | Did not create a new patient record |
| Rabies encounter / protocol | Partially exercised | WHO categories, Category III RIG guidance, protocol selection screen, discard/recovery | Did not commit a second synthetic course or consume stock |
| Scheduled orders | Completed | Today, overdue, backfill, recompute preview, administration review, brand choice, staff/PIN failure | No successful administration was committed |
| Patient chart | Completed | Clinical context, chart tabs, standing order, external immunizations, account and cross-branch behavior | Health-card printing is outside this audit |
| Cashier-like flows | Partially exercised | Collect/add payment, partial amount, tender method, prepayment, receipt/void affordances, wrong PIN, approval route | No payment, void, refund or receipt was committed/printed; split tender appears to require repeated payments |
| Inventory / transfers | Partially exercised | Lot list, expiry/status filters, movements, outbound transfer detail and receipt action | No shipment, receipt or adjustment was committed |
| End of day | Partially exercised | Day summary, drawer totals, deposit/close dialogs, close-day snapshot semantics | Did not close the seeded drawer, record a deposit or snapshot the day |
| Role boundaries | Completed | Direct admin-route check, cross-branch reveal/edit, outbound receipt action | No BranchAdmin fixture was available for comparison |
| Loading, empty, keyboard, interruption | Partially exercised | Inline validation, loading skeletons, no-match/empty states, command hint, discard warning, bad-PIN recovery | Full keyboard-only traversal was not exhaustively timed |
| Responsive sanity | Completed | 1440×900 clinic desktop and 1280×720 laptop | Mobile was intentionally not assessed |

## Prioritized findings

| ID | Severity | Confidence | Workflow | Finding |
|---|---:|---:|---|---|
| BR-01 | P0 | High | Cross-branch chart | Branch can edit a cross-branch patient without reveal/break-glass |
| BR-02 | P1 | High | Transactions / EOD | “Today” resolves to the previous date while the clinic banner is on the current date |
| BR-03 | P1 | High | Administration / payment | Wrong staff PIN signs the Branch session out and loses action context |
| BR-04 | P1 | High | Patient account | Prepay offers a completed dose despite no standing order |
| BR-05 | P1 | High | Administration / inventory | Clinician selects a brand, but cannot attest the actual lot or expiry |
| BR-06 | P1 | High | Today / dashboard / orders | Priority and due/overdue counts contradict one another |
| BR-07 | P1 | High | Patient account | Account summary reports zero while the ledger shows a negative running balance |
| BR-08 | P1 | High | Quick worklists | Patient quick actions omit DOB/MRN and show repeated same-name course rows |
| BR-09 | P1 | Medium-high | Arrival / interruption | Existing in-progress patient can enter another arrival; abandoning leaves the saved encounter |
| BR-10 | P1 | High | Late-dose recovery | Recompute promises shifted doses but previews unchanged dates |
| BR-11 | P2 | High | Inventory transfer | Source Branch sees a receipt action for its outbound transfer, then gets a generic server error |
| BR-12 | P2 | High | End of day | “Close day” is only an archival snapshot and does not gate loose ends or attest the closer |
| BR-13 | P2 | High | Inventory | “Quarantined” filter returns expired/out-of-stock rows whose displayed status is not quarantined |
| BR-14 | P2 | High | Arrival search | Exact displayed “Last, First” text returns no match while first-name search succeeds |
| BR-15 | P3 | High | Responsive | 1280×720 remains usable, but long course names truncate and verification context stays off-row |

## Detailed evidence

### BR-01 — Cross-branch write bypasses reveal

- **Severity / confidence:** P0 / High
- **Role / workflow:** Branch / patient chart and cross-branch access
- **Reproduction:** Sign in as HST Branch → open the seeded TMG-home patient → observe “Cross-branch record” and “Reveal record” → choose **Edit** without revealing → save the unchanged form.
- **Observed result:** The edit form loaded and the save succeeded twice; a “Patient updated” toast appeared while the page still presented the record as cross-branch. The page also exposed **Initiate protocol** and **New encounter** before reveal.
- **Impact:** A Branch session can write another branch’s patient identity record without the visible disclosure step or a clear break-glass event. This is a patient-integrity and privacy-boundary failure, not merely confusing information scent.
- **Recommended correction:** Enforce the branch boundary server-side for every write. Require a successful, reasoned, auditable reveal/break-glass grant before rendering or accepting edit/encounter/protocol actions; keep the grant narrowly scoped and expiring.
- **Acceptance test:** A Branch user receives no write controls before reveal; crafted/direct write requests fail; after an authorized reveal with reason, only permitted actions succeed and the audit entry records actor, home branch, accessing branch, reason and time.
- **Evidence:** [Cross-branch save succeeds without reveal](2026-08-22-branch-account-live-usability-screenshots/08-cross-branch-edit-succeeds-without-reveal.png)

### BR-02 — The financial “Today” is yesterday

- **Severity / confidence:** P1 / High
- **Role / workflow:** Branch cashier / transactions, inventory movements and day close
- **Reproduction:** On 2026-08-23 Manila clinic day → open **Transactions** and **Day Summary** → press each page’s **Today** button.
- **Observed result:** The global clinic banner stayed on Aug 23, but Transactions and Day Summary remained on Aug 22. Transactions labeled seven Aug 22 rows “Today’s transactions”; Day Summary labeled Aug 22 under an Aug 23 open-day banner. “Today” did not advance either date.
- **Impact:** Staff can collect, reconcile, snapshot or investigate the wrong accounting day. The drawer/Today totals therefore cannot be trusted as one operational close.
- **Recommended correction:** Derive one branch-local clinic date from the open clinic-day record, not browser/UTC date conversion. Pass it through transactions, movements, drawer and summary queries, labels, defaults and “Today” actions.
- **Acceptance test:** At 00:01–00:30 Asia/Manila, all relevant pages default to the same clinic date and totals; “Today” returns to that date; UTC storage remains correct; DST-independent timezone tests cover positive-offset branches.
- **Evidence:** [Transactions show Aug 22 as Today](2026-08-22-branch-account-live-usability-screenshots/09-transactions-today-shows-previous-date.png), [Day Summary shows Aug 22 under Aug 23 clinic day](2026-08-22-branch-account-live-usability-screenshots/11-day-summary-today-uses-previous-date.png)

### BR-03 — Bad staff PIN ejects the whole Branch session

- **Severity / confidence:** P1 / High
- **Role / workflow:** Nurse and cashier / administer and record payment
- **Reproduction:** Open an administration review or draft-transaction payment dialog → choose an on-shift staff member → enter an invalid four-digit PIN → submit.
- **Observed result:** The action did not commit, but the UI navigated away without a field error. Subsequent data access revealed the login screen. The behavior reproduced in both clinical administration and payment.
- **Impact:** A common typing error destroys task context and can make staff unsure whether a dose/payment posted. On a shared workstation it also encourages PIN sharing and rushed retries.
- **Recommended correction:** Separate staff-attestation failure from web-session authentication. Keep the dialog and non-secret inputs, clear only the PIN, state that nothing posted, and rate-limit attempts without invalidating the Branch session.
- **Acceptance test:** Invalid PIN returns a typed action error, leaves the Branch session authenticated and the action uncommitted, preserves selections, focuses the cleared PIN field and shows a retry-safe message. Valid PIN commits exactly once.

### BR-04 — Prepayment can target a completed/nonexistent dose

- **Severity / confidence:** P1 / High
- **Role / workflow:** Branch cashier / patient standing order and prepayment
- **Reproduction:** Open the seeded completed influenza patient → **Standing order** shows “No standing orders found” → choose **Prepay a dose**.
- **Observed result:** An enabled collection dialog preselected Dose 1 Influenza for the current date and ₱1,200 even though the chart says the dose is completed and there is no active standing order.
- **Impact:** Staff can charge a patient twice or create credit against a clinically invalid target.
- **Recommended correction:** Generate prepayment choices only from active, payable, not-completed scheduled orders; revalidate the target at submit time and show why no dose is eligible.
- **Acceptance test:** Completed/cancelled/missing orders never appear; stale direct requests fail without a transaction; an eligible future dose can be partially or fully prepaid once and is visibly linked to that order.
- **Evidence:** [Completed dose offered for prepayment](2026-08-22-branch-account-live-usability-screenshots/06-prepay-completed-dose-despite-no-standing-orders.png)

### BR-05 — No actual lot verification at administration

- **Severity / confidence:** P1 / High
- **Role / workflow:** Branch nurse / administration and stock traceability
- **Reproduction:** Scheduled Orders → open an administer action → review patient/dose → choose a brand.
- **Observed result:** The screen offers brand-level aggregate stock and says inventory handles the eligible lot internally. There is no visible lot/expiry selection, scan or attestation. Seeded completed administrations in Day Summary show “—” in the Lot column.
- **Impact:** The nurse cannot verify that the vial in hand matches the recorded FEFO allocation or avoid a recalled/quarantined lot at the final checkpoint. Recall traceability is weakened.
- **Recommended correction:** Allocate FEFO server-side but require visible confirmation or scanning of lot and expiry; hard-block recalled, expired and quarantined lots; show override authority and reason when permitted.
- **Acceptance test:** The commit records the displayed/scanned lot; mismatched, recalled, expired, quarantined and depleted lots fail; concurrent depletion re-prompts safely; Day Summary and patient history show the committed lot.
- **Evidence:** [Brand-only administration review](2026-08-22-branch-account-live-usability-screenshots/05-administration-brand-only-no-lot-attestation.png)

### BR-06 — Priority counts disagree

- **Severity / confidence:** P1 / High
- **Role / workflow:** Branch nurse / deciding what needs attention now
- **Reproduction:** Compare **Today**, **Dashboard** and **Scheduled Orders** without changing filters.
- **Observed result:** Today showed 12 due and 5 overdue. Dashboard described the queue as 14 total but “0 overdue · 0 due · 5 upcoming,” while other dashboard nudges referred to overdue Dose 1. Scheduled Orders said 9 due and 5 overdue, but its Today sections visibly totaled 1 overdue + 6 due.
- **Impact:** Staff cannot safely prioritize callbacks and administrations or tell whether a queue is stale, filtered or wrong.
- **Recommended correction:** Use one order-state classifier and one branch-local “now”; display explicit, mutually exclusive definitions and filter chips; make every KPI drill into the exact counted set.
- **Acceptance test:** For a fixed fixture, counts reconcile across surfaces and visible row totals; a row has one state; clicking a KPI yields exactly its count; cache refresh cannot transiently mix versions.
- **Evidence:** [Today queue](2026-08-22-branch-account-live-usability-screenshots/01-today-dashboard-desktop.png), [Dashboard conflict](2026-08-22-branch-account-live-usability-screenshots/02-dashboard-conflicting-priorities.png), [Scheduled Orders mismatch](2026-08-22-branch-account-live-usability-screenshots/03-scheduled-orders-counts-and-identity.png)

### BR-07 — Account headline contradicts its ledger

- **Severity / confidence:** P1 / High
- **Role / workflow:** Branch cashier / balance and handoff
- **Reproduction:** Open the seeded completed influenza patient → Account tab → compare summary cards with the ledger running balance.
- **Observed result:** Outstanding, credit and net position all displayed ₱0.00 and “Nothing owed,” while the only visible ledger entry was a payment credit and the running balance showed negative ₱1,478.57.
- **Impact:** A cashier may collect again, fail to apply a credit or give the patient contradictory information.
- **Recommended correction:** Define and expose one signed-balance convention; calculate summary and ledger from the same posted entries; label unapplied credit separately.
- **Acceptance test:** For payment-only, charge-only, overpayment, refund, void and prepayment fixtures, summary = ledger closing balance and wording matches the sign.
- **Evidence:** [Zero summary versus negative ledger](2026-08-22-branch-account-live-usability-screenshots/07-account-summary-zero-vs-negative-ledger.png)

### BR-08 — Quick administration rows are weak identity checkpoints

- **Severity / confidence:** P1 / High
- **Role / workflow:** Branch nurse / Today and Scheduled Orders
- **Reproduction:** Review Today and Scheduled Orders before opening administration.
- **Observed result:** Actionable rows show patient name, course and dose but omit DOB and MRN. The same patient can occupy several adjacent rows for different doses/services. Strong identifiers appear only after opening the review.
- **Impact:** The highest-speed click point is also the weakest identity point, increasing wrong-patient selection on a shared, interruption-prone workstation.
- **Recommended correction:** Add at least DOB plus MRN/age to every clinical quick-action row; visually bind the action to the row; require a second identifier in final review.
- **Acceptance test:** Duplicate-name and repeated-course fixtures remain distinguishable before any action; accessible names include the second identifier; confirmation repeats the same patient/dose.
- **Evidence:** [Today rows](2026-08-22-branch-account-live-usability-screenshots/01-today-dashboard-desktop.png), [Scheduled-order rows](2026-08-22-branch-account-live-usability-screenshots/03-scheduled-orders-counts-and-identity.png)

### BR-09 — Arrival can create an orphan/duplicate encounter

- **Severity / confidence:** P1 / Medium-high
- **Role / workflow:** Branch nurse / arrival and interruption recovery
- **Reproduction:** Start New Arrival → select a patient already shown InProgress on Today → complete specialty, complaint, consent and WHO category → reach Protocol → choose **Discard**.
- **Observed result:** No existing-visit warning appeared. The discard dialog stated that wizard state would be lost but “any saved encounter will remain.”
- **Impact:** An interruption or mistaken patient choice can leave a second, incomplete encounter that competes with the real visit and obscures who owns the next action.
- **Recommended correction:** Detect an open encounter before creating another; offer **Resume existing** as default and require explicit reason/authority for a concurrent encounter. Make discard outcome concrete and provide a cleanup path.
- **Acceptance test:** Selecting an in-progress patient routes to resume; concurrent creation is blocked or reason-gated; abandoning before protocol leaves no orphan unless the user explicitly preserves it; Today shows one unambiguous visit.

### BR-10 — Late-dose recompute preview shows no change

- **Severity / confidence:** P1 / High
- **Role / workflow:** Branch nurse / late-dose recovery
- **Reproduction:** Scheduled Orders → open a course marked “needs recompute” → inspect “On completion · schedule update.”
- **Observed result:** The page promised to shift future doses, but every displayed before/after date was identical (for example Aug 16 → Aug 16 and Aug 23 → Aug 23).
- **Impact:** Staff cannot know whether the schedule will change and may communicate or administer against the wrong follow-up date.
- **Recommended correction:** Show a deterministic, clinically governed before/after schedule and explain unchanged rows; disable commit when the computed result is a no-op unless the intended action is explicitly “acknowledge unchanged.”
- **Acceptance test:** Late fixtures produce expected shifted dates; on-time fixtures show no recompute action; no-op output is labeled and cannot masquerade as a shift.
- **Evidence:** [No-op recompute preview](2026-08-22-branch-account-live-usability-screenshots/04-recompute-preview-no-op-shifts.png)

### BR-11 — Outbound transfer exposes the wrong action

- **Severity / confidence:** P2 / High
- **Role / workflow:** Branch inventory / transfer receiving
- **Reproduction:** HST Inventory Transfers → open a pending transfer from HST to another branch → choose **Confirm Receipt**.
- **Observed result:** HST, the source branch, was shown both **Confirm Receipt** and **Cancel Transfer**. Confirm Receipt failed with “Server error. Try again in a moment.” The table initially represented branches and lots as raw numbers; detail resolved branch names but showed the lot as `ERI-2026-009 (undefined)`.
- **Impact:** Role intent is unclear, staff waste time on guaranteed failures, and generic errors hide whether the system rejected authority or malfunctioned.
- **Recommended correction:** Render actions by transfer direction and role; use names/codes in the table; return a specific authorization/state message as a backstop.
- **Acceptance test:** Source sees ship/cancel only, destination sees receive only, unrelated branch sees read-only or nothing; direct wrong-side receipt gets a typed 403/409 and no state change.
- **Evidence:** [Outbound receipt action and generic error](2026-08-22-branch-account-live-usability-screenshots/10-outbound-transfer-shows-receipt-action-and-generic-error.png)

### BR-12 — End-of-day controls do not represent one accountable close

- **Severity / confidence:** P2 / High
- **Role / workflow:** Branch cashier / drawer, deposit and day close
- **Reproduction:** Open Staff Kiosk and Day Summary → inspect **Record deposit**, **Close drawer** and **Close day**.
- **Observed result:** Deposit slip and notes were optional and there was no staff attestation. Drawer close requested only a counted amount. Day Summary’s **Close day** opened “Snapshot the day?” and said it could be re-snapshotted; it did not surface unsettled work, open encounters, on-shift staff or drawer state as gates.
- **Impact:** The UI does not make it clear who physically moved cash or whether the clinic is operationally closed; snapshot language can be mistaken for final close.
- **Recommended correction:** Separate **Snapshot report** from **Close clinic day**. Require closer identity/PIN, variance reason above threshold, deposit reference by policy, and explicit loose-end resolution or signed exceptions.
- **Acceptance test:** Close is blocked by configured loose ends, records actor and exceptions, reconciles drawer/deposits/transactions, and is idempotent; snapshot remains a non-final report action.
- **Evidence:** [Close day is an archival snapshot](2026-08-22-branch-account-live-usability-screenshots/12-close-day-is-archive-snapshot-with-no-loose-ends-gate.png)

### BR-13 — “Quarantined” does not match displayed lot status

- **Severity / confidence:** P2 / High
- **Role / workflow:** Branch nurse/inventory / stock confidence
- **Reproduction:** Inventory → choose **Quarantined**.
- **Observed result:** KPI reported two quarantined lots, while the filtered table showed one expired/out-of-stock lot and one expired lot; neither row’s displayed status said quarantined.
- **Impact:** Staff cannot distinguish stock held for investigation/recall from ordinary expiry/depletion, which weakens recall handling and count confidence.
- **Recommended correction:** Separate availability, expiry and quarantine dimensions; show quarantine reason/status directly; provide a distinct recalled signal.
- **Acceptance test:** Each filter returns only matching lots, combined states are visibly labeled, and quarantined/recalled stock is excluded from administration regardless of quantity.

### BR-14 — Patient search rejects its own displayed name format

- **Severity / confidence:** P2 / High
- **Role / workflow:** Branch front desk/nurse / patient identification
- **Reproduction:** New Arrival → search the exact displayed text `Torres, Miguel` → then search `Miguel`.
- **Observed result:** Exact displayed “Last, First” returned no patients and offered registration; first-name-only search returned the correct seeded patient with MRN, DOB, age and contact.
- **Impact:** Staff may start a duplicate registration after copying the visible name format.
- **Recommended correction:** Normalize comma, whitespace, accents and name order; keep a “no match” state separate from the high-consequence register action.
- **Acceptance test:** First-last, last-first, displayed comma format, MRN and normalized phone all return the same record; no-match registration requires an explicit duplicate check.

### BR-15 — Laptop layout is usable but still verification-light

- **Severity / confidence:** P3 / High
- **Role / workflow:** Branch nurse / responsive sanity
- **Reproduction:** Set the clinic viewport to 1280×720 and open Scheduled Orders.
- **Observed result:** Navigation, KPIs, tabs and action buttons stayed visible with no destructive horizontal overflow. Long course names truncated, and the row still lacked a second patient identifier.
- **Impact:** The narrower layout is operationally usable, but truncation plus identity-light rows can slow differentiation.
- **Recommended correction:** Preserve action visibility; add compact second identifiers and accessible full course text via wrapping or a safe disclosure pattern.
- **Acceptance test:** At 1280×720, all primary actions remain visible, focus order is logical, no horizontal page scroll occurs and duplicate-name rows remain distinguishable.
- **Evidence:** [Scheduled Orders at 1280×720](2026-08-22-branch-account-live-usability-screenshots/15-scheduled-orders-narrow-laptop-1280x720.png)

## Successful flows and strengths

| Strength | Direct observation | Why it matters |
|---|---|---|
| Persistent role and clinic-day context | Main Branch Account, Branch/HST and open-day banner remained visible across workflows | Reduces wrong-branch and wrong-day slips when the date itself is correct |
| Strong identity after opening a task | Encounter and administration review showed name, MRN, DOB/age, service, dose and date | Good final-check foundation |
| Consent is not a silent default | Arrival consent is unchecked and blank submission creates a local, specific error | Supports affirmative consent and recovery |
| WHO Category III guidance is explicit | Category III states ARV + RIG; protocol page repeats RIG requirement and composite options | Good clinical decision support at a high-risk decision |
| Atomic intent is explained | Protocol page explains encounter, protocol, stock and Day-0 charge commit together | Helps staff understand downstream effects |
| Patient search results can be identity-rich | Matching rows can show MRN, DOB, age and contact | Stronger than the quick-action worklists |
| Staff attestation identifies on-shift people first | Administration/payment staff lists prioritized four on-shift staff and labeled off-shift names | Good accountability scent, despite the PIN failure behavior |
| External immunization state is explicit | Patient chart clearly said no external immunization records | Avoids mistaking an unloaded section for proof of no history |
| Narrow laptop layout remains functional | 1280×720 preserved the desktop navigation and primary actions | No mobile redesign is required for the pilot target |

## Remediation sequence

### First 48 hours

1. Disable cross-branch **Edit**, **New encounter** and **Initiate protocol** until the server-enforced reveal grant exists; add request-level regression coverage.
2. Fix the Asia/Manila/current-clinic-day derivation for Transactions, Inventory movements and Day Summary; temporarily remove misleading “Today” labels/buttons if the unified fix cannot ship immediately.
3. Stop staff-PIN failures from clearing web authentication; add explicit “nothing was recorded” recovery.
4. Disable prepayment unless an eligible active order is returned and revalidated.
5. Block pilot use of administration unless actual lot/expiry is visible and committed.

### First week

1. Consolidate due/overdue/backfill state computation and reconcile all counts.
2. Reconcile patient account summary and ledger signs across payment/prepayment/refund fixtures.
3. Add MRN plus DOB/age to quick-action rows and duplicate-name tests.
4. Add open-encounter detection and resume-first arrival behavior.
5. Correct late-dose recompute previews and require clinically reviewed fixture expectations.
6. Direction-scope transfer actions and replace raw branch/lot IDs and `undefined` labels.
7. Separate snapshot, drawer close and clinic-day close with actor attestation and loose-end gates.

### Later backlog

- Improve normalized patient search and duplicate-registration prevention.
- Separate quarantine, recall, expiry and quantity states in inventory.
- Add receipt print/download verification and explicit split-tender composition.
- Complete keyboard-only timing studies with actual branch nurses/cashiers.
- Add compact course-detail disclosure for the 1280×720 layout.

## P0/P1 E2E regression scenarios

| Finding | Required scenario |
|---|---|
| BR-01 | Branch A opens Branch B patient; write controls absent; direct update denied; authorized reasoned reveal enables only scoped action; audit event asserted |
| BR-02 | Freeze time at 00:15 Asia/Manila; Today, transactions, inventory movements, drawer and summary all resolve to the open clinic date and reconcile |
| BR-03 | Invalid nurse/cashier PIN leaves session and dialog intact, clears only PIN, preserves inputs, posts nothing; valid retry posts once |
| BR-04 | Completed/missing/cancelled order cannot be prepaid through UI or direct request; active future order can be prepaid and linked once |
| BR-05 | Administer by scanned/selected lot; recalled/expired/quarantined/depleted/mismatched lot blocked; concurrent depletion safely re-prompts; recorded lot appears downstream |
| BR-06 | Fixture rows classify once; KPI counts equal filtered rows across Today, Dashboard and Scheduled Orders before/after refresh |
| BR-07 | Charges, payments, overpayment, prepayment, refund and void each reconcile summary to final ledger balance and wording |
| BR-08 | Duplicate-name and repeated-course rows include second identifier before action; final confirmation matches selected row |
| BR-09 | Patient with open encounter routes to resume; concurrent encounter requires explicit reason; discard behavior leaves no unacknowledged orphan |
| BR-10 | Late-dose fixtures yield approved before/after dates; no-op is explicit and cannot be committed as a shift |

## Environment and verification blockers

- The normal setup script derives the per-worktree database name from the checkout basename. Multiple Codex worktrees share `surevax-cms-revamp`, so the first setup collided with another task’s seeded database. Those observations were discarded. This audit created and used the isolated `surevax_codex_2476_branch_audit` database instead. The setup naming rule should include a unique worktree identifier.
- The setup-selected frontend/backend ports were already occupied by another local task. The audit used isolated local ports; this did not change application behavior.
- Required migrations and seed completed. The setup script later exited nonzero in its optional Graphify interpreter-pin step; that tooling was not required for the UI walkthrough.
- The repository is development-only. Production identity, notification delivery, printing hardware, real scanner behavior, external payment rails and real multi-user latency were not verifiable locally.
- No seeded BranchAdmin persona was available, so approval completion was not compared end to end. Direct Branch navigation to the admin approval route redirected to Today.
- A correct staff PIN was intentionally not used to post a new payment or administration. Success-state presentation was inspected through seeded completed records; transactional mutation and physical receipt output remain unverified.
- Deposit, drawer close, clinic-day snapshot, inventory shipment/receipt and stock adjustment were inspected up to the final action but not committed, preserving the seeded audit baseline as far as practical.

## Evidence index

All links below are relative to this report and were validated locally.

1. [Today dashboard — desktop](2026-08-22-branch-account-live-usability-screenshots/01-today-dashboard-desktop.png)
2. [Dashboard priority conflicts](2026-08-22-branch-account-live-usability-screenshots/02-dashboard-conflicting-priorities.png)
3. [Scheduled Orders counts and identity](2026-08-22-branch-account-live-usability-screenshots/03-scheduled-orders-counts-and-identity.png)
4. [Late-dose recompute no-op preview](2026-08-22-branch-account-live-usability-screenshots/04-recompute-preview-no-op-shifts.png)
5. [Administration brand without lot attestation](2026-08-22-branch-account-live-usability-screenshots/05-administration-brand-only-no-lot-attestation.png)
6. [Prepay completed dose](2026-08-22-branch-account-live-usability-screenshots/06-prepay-completed-dose-despite-no-standing-orders.png)
7. [Account summary and ledger contradiction](2026-08-22-branch-account-live-usability-screenshots/07-account-summary-zero-vs-negative-ledger.png)
8. [Cross-branch edit succeeds](2026-08-22-branch-account-live-usability-screenshots/08-cross-branch-edit-succeeds-without-reveal.png)
9. [Transactions “Today” on previous date](2026-08-22-branch-account-live-usability-screenshots/09-transactions-today-shows-previous-date.png)
10. [Outbound transfer receipt action](2026-08-22-branch-account-live-usability-screenshots/10-outbound-transfer-shows-receipt-action-and-generic-error.png)
11. [Day Summary “Today” on previous date](2026-08-22-branch-account-live-usability-screenshots/11-day-summary-today-uses-previous-date.png)
12. [Close day is a snapshot](2026-08-22-branch-account-live-usability-screenshots/12-close-day-is-archive-snapshot-with-no-loose-ends-gate.png)
13. [Scheduled Orders — 1280×720](2026-08-22-branch-account-live-usability-screenshots/15-scheduled-orders-narrow-laptop-1280x720.png)

## Next Steps / Considerations

- **Pilot authority:** define who may authorize cross-branch reveal and concurrent encounters, and the maximum grant duration.
- **Clinic-day policy:** define whether the operational day follows Asia/Manila calendar date, explicit open/close session, or a configurable cutoff; all financial surfaces must follow the same rule.
- **Lot workflow:** choose barcode scan, manual lot confirmation or both, plus the permitted override roles and required reason.
- **Cash controls:** define variance thresholds, mandatory deposit-reference policy, closer role and the loose ends that hard-block versus allow signed exception.
- **Identity standard:** select the two identifiers required on every clinical quick-action row; MRN + DOB is the practical default.
- **Pilot exit criteria:** all P0/P1 acceptance tests green, branch-nurse and cashier scenario run completed, and a clean day close reconciled before reassessment.
