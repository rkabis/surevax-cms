# 06 — Clinical Product Workflows

> **Last Synthesized**: 2026-03-22 | **Updated**: 2026-08-23 (corporate payer-owned AR, active-bill and payment controls, plus Runtime Review Center for missing guardians and Manila-day loose ends; prior workflow updates retained) | **Self-contained** — synthesized from now-archived source docs

**Scope**: **Business logic** — clinical **state machines**, **workflows**, and **invariants** driving SureVax CMS **v2.0**. Not UI copy.

## Phase 1 G3 implementation status (as of 2026-05-02)

The "new patient arrival" workflow is substantially complete. The `/arrivals` wizard composes the working steps in order:

| Step                                                                            | Status                              | Where it lives                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Patient check-in / register (with duplicate-detect)                          | ✅ Live                             | `features/patients/PatientForm.tsx` + `PatientDuplicatePanel.tsx`; `POST /api/patients`. **[#250](https://github.com/njvil/surevax-cms-revamp/pull/250)**: address field now uses `AddressAutocomplete` + `RegionCascadeSelect`; region stored in `patients.region`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2. Open encounter (specialty + chief complaint)                                 | ✅ Live                             | `features/encounters/EncounterForm.tsx`; `POST /api/encounters`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 3. Capture vitals + (Rabies) bite assessment                                    | ✅ Live                             | `VitalsPanel.tsx` + `BiteAssessmentPanel.tsx` write to `clinicalNotes.vitals` and `specialtyData` JSONB; Step 3 also renders `BundleCard` + `CommitRail` from real `GET /api/arrivals/preview-bundle` stock data — PR #75 (the lot shown per item is indicative; the nurse picks the brand when administering). **Phase 2** (#116): vitals now persist as a structured row via `POST /api/encounters/:id/vitals`; diagnoses via `POST /api/encounters/:id/diagnoses`. Encounter `GET /:id` joins both as `vitals[]` + `diagnoses[]`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 4. Initiate standing-order protocol (template → schedule)                       | ✅ Live                             | `features/standing-orders/InitiateProtocolSheet.tsx`; `POST /api/patient-standing-orders` (creates `clinical_orders` for each Day-offset; status=`Pending`). The Arrivals wizard drafts the encounter client-side in Step 2 and commits encounter + PSO atomically in Step 3 via `POST /api/arrivals/atomic` (PR #85). Step 2 explicitly records whether consent came from the patient or guardian; only that attestation creates the encounter consent row. Step 3 is **multi-select**: a WHO Cat III walk-in commits the ARV course **plus** ERIG/HRIG + ATS together (one PSO per `templateIds[]` entry, all in the same transaction). The API rejects Rabies without a WHO category and independently verifies that Category III selections contain an ERIG/HRIG service. Protocols can also be initiated from a patient chart with no open encounter (`InitiateProtocolPage`, `?patientId=…`, `encounterId` omitted) — e.g. a returning-patient booster.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 5. Transaction draft + payment collection                                       | ✅ Live (G4 billing pulled forward) | `features/transactions/TransactionsCreatePage.tsx` + `TenderRail.tsx`; `POST /api/transactions` accepts an optional inline `payment` body (atomic create + record + Paid transition + `OR-YYYY-…` issuance). Tender rail consumes `GET /api/shifts/current` for drawer fields. Encounter rows expose a derived `bundleLabel` ("Rabies PEP bundle" / "Flu vaccination" / etc.) used in the cashier-page header. **Split tender (2026-06-08)**: the create endpoint also accepts a `payments[]` array so one bill settles across several methods (part cash, part GCash) in a single atomic commit — full coverage → Paid, partial → Pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 6. Day-0 administration (mark Completed, brand pick + stock deduction, consent) | ✅ Live — PR #76 (2026-05-01)       | `POST /api/scheduled-orders/:id/administer` — atomic: the nurse explicitly selects the brand; the system resolves an eligible internal lot for stock deduction (`lotId` remains the backend commit field; 409 `LOT_*` protects ineligible, expired, quarantined, recalled, or insufficient inventory and deducts the order's actual quantity) → consent insert → status=`Completed` → downstream auto-recompute. Patient-specific lot selection/attestation and patient-facing batch display are not part of the current nurse workflow; the internal lot remains an inventory/audit implementation detail. Direct order reads and writes are branch-scoped for clinical branch roles. Payment is collected separately; administration is not gated on payment status. `AdministerDialog.tsx` includes the bedside identity/dose/clinical-flags checkpoint, clinician attribution, and consent confirmation. **[2026-07-30] the dose now records WHO GAVE IT, not which login typed it in.** The clinic works from one shared day-scoped `Branch` session, so `administered_by_id` was the branch service account for every dose in the building, and the legacy `Immunization.i_NurseRef` records the nurse per dose, making it a parity regression as well as a clinical-record one. `AdministeredByField` names the clinician and proves it with their 4-digit kiosk PIN (the same PIN and `pin_attempts` lockout counters clock-in uses); a clinician logged in as themselves attests implicitly and sees no extra step. `documented_by_id` stays the session principal, because which terminal typed the entry is a different fact from who injected. The response echoes the attributed clinician so the panel can show it after commit. Post-cutover: consent inserts go to `consents`; inventory movements go to `inventory_movements` (legacy `consent_records` + `inventory_transactions` tables dropped in [#217](https://github.com/njvil/surevax-cms-revamp/pull/217)). |
| 7. Scheduled-orders SMS / job runner                                            | ⬜ G3 close-out (only item left)    | Not started. Needs a job runner + SMS gateway integration (Semaphore/Twilio).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

**Hard-rule gates now enforced in code**:

- Physician authorization for Nurse-initiated standing orders: `POST /api/patient-standing-orders` rejects with 400 when `req.user.role === 'Nurse'` and `authorizingProviderId` is missing.

**Remaining open items** (see `docs/handovers/archive/2026-05-02-scheduled-orders-handover.md` for details):

- Arrivals wizard atomic-commit consolidation (Step 2 must defer encounter creation)
- `transaction_items.clinical_order_id` not seeded — manual insert required to smoke-test administer happy path

---

## Two Critical Failure Points (Case Study)

| Failure                          | Mechanism                                                                                | SureVax lever                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Intake bottleneck**            | Documentation & digital entry **slow** clinical throughput                               | **Service bundles** — single atomic action covering clinical orders, billing, and inventory |
| **Follow-up scheduling failure** | Multi-day protocols **lose** patients to follow-up (e.g. rural ABTC completion **~19%**) | **Scheduling FSM** + **standing orders** + **SMS** + **dynamic date recalc**                |

---

## Service Bundles

A bundle is a `service_catalog` row with `service_type='Bundle'` plus its linked items. Selecting a bundle in the intake form fans out into a single atomic action that creates: (1) the **clinical orders** for each bundled service, (2) the **ICD-10 / CPT** entries for billing, (3) the inventory deductions (bundle fan-out keeps the automatic earliest-expiry pick — no clinician is choosing a brand at the point of sale), and (4) any **standing orders** for future visits in a multi-day protocol.

This is the lever for the intake bottleneck — without it, a nurse has to enter clinical, billing, and inventory data separately, which is where time is lost and rows fall out of sync.

---

## Day 0 Intake State Machine

**Most critical workflow.** **Atomic** bundle intake: **single form** → **patient + encounter + multiple clinical orders + transaction** (see Req 4–5).

### 1. Patient creation (or lookup)

- **Required**: `first_name`, `last_name`, `dob`, `home_branch_id`.
- **Duplicate check**: `search_vector` / fuzzy search; **no** silent duplicates across branches without policy (see **MPI**, Req 2).
- **Minor**: capture **guardian** info when applicable.
- `POST /api/patients` writes allergies to `patient_allergies` rows and conditions to `patient_conditions` rows (normalized). Tags use `patient_tags.tag_definition_id` → `tag_definitions`. The legacy JSONB `allergies`/`conditions` columns and the `patient_tags.tag` text column were dropped in [#217](https://github.com/njvil/surevax-cms-revamp/pull/217). Wire-shape note: the patient/tag/dose/bite-followup responses speak `display_id`s only — internal bigint PKs/FKs never cross the wire (display-id convention). Tag rows expose `tag`/`color`/`category`; the scheduled-order detail resolves `documentedById`/`administeredById`/`createdById` to `USR_…` display ids; patient detail omits `homeBranchId`/`createdById` (cross-branch logic reads `homeBranchId` from `GET /api/patients/:id/demographic`).

### 2. Encounter creation

- `patient_id` + `branch_id` + **provider**.
- `encounter_type`: **Initial** | **Follow_Up**.
- **Specialty** (e.g. **Rabies**) + `specialty_data` **JSONB** (animal type, bite **category**, wound location, etc.).
- `clinical_notes` **JSONB** (vitals, SOAP).

### 3. Bundle selection → clinical orders

- Clinician selects template (e.g. **Rabies PEP Category III**).
- System creates **`patient_standing_orders`** (Req 7).
- Reads **`protocol_items`** **JSONB** from template.
- **Auto-generates** `clinical_orders` per item, e.g.:
  - **Day 0**: Consultation, Wound cleaning, **ARV** dose 1, **ERIG**, **TT**
  - **Day 3 / 7 / 14**: subsequent ARV doses (profile-dependent)
- Each order: **`original_scheduled_date`** = `start_date` + `day_offset`.
- **Rule**: **Day 0** orders **Completed** on administration **same visit**; future orders remain **Pending** / enter the **scheduling FSM**.

#### Nurse-initiated orders & authorizing physician

In most ABTC settings, the **nurse** operates the CMS while the **physician** authorizes orders via teleconsult or verbal instruction. The system must reflect this reality:

- If the logged-in user's role is **Nurse**, `authorizing_physician_id` is **MANDATORY** before the standing order can be saved. The nurse selects the physician from a dropdown (filtered to doctors with active privileges at the branch or via teleconsult roster).
- **Audit trail** records both actors: _"Action by {nurse_name}, Authorized by {physician_name}"_ — stored in `audit_logs` with `performed_by_id` and `authorized_by_id`.
- If the user's role is **Physician**, `authorizing_physician_id` auto-fills to self.

#### Consultation waiver (ABTC)

Per clinic memo: ABTC patients may **refuse** the paid consultation provided a signed waiver is secured.

- UI toggle: **`consultation_waived`** (boolean, default `false`).
- If `true`: **drops** the Consultation line item from `transaction_items` (no consult fee billed), but **retains** all PEP clinical orders (ARV schedule, ERIG, wound care).
- **Mandatory documentation**: `waiver_reference` (text — waiver form number) **or** `waiver_file_upload` (scanned/photo). System blocks save if waiver toggle is checked but no reference/file is attached.
- **Audit**: logged as `action='CONSULTATION_WAIVED'` with waiver reference.

#### Preventive vaccine hard-stop

For **Preventive** specialty encounters (e.g. Flu, HPV, Pneumococcal — non-emergency, non-ABTC):

- **Strict rule**: `authorizing_physician_id` **OR** `external_rx_reference` (external prescription) is **MANDATORY**. No Rx / No Consult = **No Transaction**. System blocks progression to the Transaction step.
- Rationale: preventive vaccines are elective; dispensing without physician authorization exposes the clinic to liability.

#### Weight-based ERIG / HRIG computation

ERIG and HRIG dosing is strictly weight-dependent (ERIG = **40 IU/kg**, HRIG = **20 IU/kg**).

- If a bundle includes **ERIG** or **HRIG**, `weight_kg` in `clinical_notes` becomes **STRICTLY MANDATORY** — system blocks bundle save without it.
- System **auto-computes**: required IU = `weight_kg × IU_per_kg`, then converts to **number of vials** = `CEIL(required_IU / IU_per_vial)` using the selected product's `iu_per_vial` from `service_catalog`.
- `transaction_items.quantity` and `transaction_items.unit_price` are **dynamically updated** to reflect the computed vial count **before** the transaction is finalized.
- Nurse can **override** the computed quantity (e.g. partial vial from another patient) but override triggers `action='RIG_QTY_OVERRIDE'` audit entry requiring `override_reason`.

### 4. Transaction (Payment)

- `transaction` linked to **encounter**.
- `transaction_items` per **clinical_order** (and catalog line items as designed).
- **Optional**: `is_prepayment=TRUE` for a free-standing deposit; consumed later via a `Credit` payment (`prepayment_applied_at` marks it spent). No `prepaid_for_date` column; see `.claude/rules/gotchas.md` "Patient credit / prepayment".
- **Discounts**: **SC** / **PWD** / **HMO**; **BIR-compliant** math (see **Correctness Properties**).
- **Multi-patient family billing (2026-06-20)**: one transaction can cover services for several patients, settled by **one combined payment**, with **per-patient SC/PWD discounts** (a senior grandparent's lines discounted, the kids' not). The header patient remains the primary/bill-to for this family shape; each `transaction_item` carries an optional `patient_id`; per-patient discount/encounter live in the `transaction_patients` sub-header. Consent + the D2 branch invariant are enforced per patient. See `.claude/rules/gotchas.md` "Multi-patient transactions".
- **Corporate group billing (2026-08-22)**: `group_bills` is an additive one-to-one sidecar over the existing transaction. The payer owns AR; the linked transaction remains the money, payment, receipt, day-summary, void, and refund engine and is excluded from patient AR. `transaction_patients`/`transaction_items` remain the exact real-patient/service allocation. The first real patient is only the compatibility clinical anchor in `transactions.patient_id`, not the debtor; do not create a placeholder patient or proportional patient-payment allocation.
- **Split payment**: e.g. Cash + GCash + ChargeToAccount (Req 10).
- **Transaction acknowledgement/reference** identified by the transaction's own `id` (e.g. `TXN-2026-K9MX3VQ2P5`). This identifier is not by itself a tax-invoice number or a compliance certification; Finance Operations and the tax owner must approve configured document terminology, numbering, registration, and branch use (Req 11; see the corporate group-billing ADR for the same boundary).
- Administration proceeds regardless of transaction status — payment is collected as a parallel workflow, not a gate.
- **Service pricing**: `unit_price` on each `transaction_item` resolved via `pricing.ts` — weighted most-specific-match against `service_prices` (payer 4 > product/brand 2 > branch 1, so `payer+brand > payer > brand > tenant-wide`). A line billing an already-administered dose prices the ADMINISTERED BRAND (resolved from `clinical_orders.lot_id`); a line billed in advance cannot know the brand, so it prices brand-agnostically and any later uplift is recorded as a `brand_price_variance` audit row rather than re-billed. The legacy `service_catalog.base_price` fallback was dropped in [#217](https://github.com/njvil/surevax-cms-revamp/pull/217); every priced service now requires at least a tenant-wide `service_prices` row. Snapshotted at line-item creation (immutable post-commit).
- **Patient balance / pay-on-account (2026-07-25; corporate exception 2026-08-22)**: a patient's balance is derived, never stored. `GET /api/patients/:id/balance` sums `amount_outstanding` across open bills (plus available credit, net outstanding, per-bill aging); `GET /api/patients/:id/ledger` is the full statement-of-account. `POST /api/patients/:id/payments` lets a cashier tender an amount allocated across open bills oldest-first (by `transacted_at`); tender above the total outstanding 422s unless the caller opts in with `allowCredit`, which banks the excess as patient credit (the per-bill payment route's hard overpayment reject is unchanged). A transaction linked to `group_bills` is excluded from patient AR because its payer owns the receivable; it has no proportional patient-payment or credit allocation. `GET /api/accounts-receivable` is the clinic-wide worklist of who owes what. Administration stays ungated, same as single-bill payment above.

### Phase-1 financial workflow controls (PR #617)

1. **Bill a clinical order once:** one clinical order can belong to only one
   active transaction. Concurrent attempts serialize in PostgreSQL; the loser
   receives `CLINICAL_ORDER_ALREADY_BILLED`. A legitimate Void/Refund releases
   the active claim for corrected rebilling without deleting history, and a
   terminal bill cannot be reactivated.
2. **Collect SC/PWD evidence:** OSCA/senior and PWD discounts require a nonblank
   ID number in the shared contract, server boundary, and cashier form. `NA` and
   `Other` rules were deliberately left unchanged.
3. **Name the money receiver:** a personal login self-attests. A shared Branch
   login must select an authorized staff member and pass their PIN before any
   HTTP payment write. Omitting caller context is an error; it is never an
   implicit kiosk opt-out.
4. **Correct tender without rewriting history:** method correction voids and
   reissues the payment in one transaction, preserves the original receiver,
   and audits the correction actor separately. A legacy null receiver fails
   closed pending evidence-backed TenantAdmin repair.
5. **Preserve policy gates:** void/refund thresholds and authorized approver
   roles remain unchanged. Non-admin staff are directed to a Branch Admin or
   Tenant Admin, not to a page that will 403.
6. **Do not reinterpret deposits:** an item-less deposit remains patient credit
   on the existing money and receipt sequence. UI calls it an acknowledgement
   and says it does not mark service rendered. Any invoice/receipt semantic or
   registered-series change needs owner + bookkeeper/BIR-adviser sign-off.

### 5. Scheduling FSM armed

- Future `clinical_orders` with `status=Pending` (or **Due** per FSM) **enter FSM**.
- **Daily batch**: compare `current_date` to scheduled dates; **SMS** **1 day before** due (Req 26).
- **Standing order execution**: nurse administers **without** new physician auth when policy allows.
- **The order the nurse works in (updated 2026-08-16)**: the standing order fixes the SERVICE, the nurse explicitly picks the BRAND at the bedside, the PAYER is chosen at settlement, and payments are added last. The current UI does not ask the nurse to choose or attest a patient-specific lot; inventory maps the selected brand to an eligible internal lot until lot-to-patient traceability is implemented as a staffed workflow. Payer is deliberately last of the three: price is a billing fact, so an insurance card turning up at the counter must not reopen the clinical record. Before this, the dose-worklist collect step offered no payer at all and billed every dose at the cash rate, so an HMO patient's ARV PEP IM dose read PHP 1,500 against a contracted PHP 2,200. `HMO` and `Corporate` tenders appear only once a payer is named, since those tenders mean "the payer settles this".
- **Late dose**: **dynamic recalculation** — shift **all** subsequent dates (e.g. Day 3 given on Day 5 → **+2 days** for remaining).

---

## Scheduling FSM

**Finite state machine** (Req 6). **Core business object**: scheduled clinical order awaiting administration.

### States

| Path         | States                                                                            |
| ------------ | --------------------------------------------------------------------------------- |
| **Happy**    | **Pending** → **Due** → **Completed**                                             |
| **Late**     | **Pending** → **Due** → **Overdue** → **Completed**                               |
| **Terminal** | **Cancelled** (from allowed states per policy)                                    |
| **Terminal** | **Defaulted** — lost to follow-up (patient unreachable / refused to return)       |
| **Terminal** | **Transferred** — patient moved to LGU, Barangay Health Center, or another clinic |

#### Closing out "ghosted" patients

A large percentage of ABTC patients receive Day 0 at a private clinic, then transfer to a free LGU facility for remaining doses. Without explicit closure, these patients sit in `Overdue` indefinitely — wasting SMS budget and polluting compliance dashboards.

- Nurses must have a **UI action** to manually close a standing order chain with reason codes: `Defaulted` or `Transferred`.
- `Transferred` requires `transfer_destination` (free text — e.g. "QC Health Center") for referral tracking.
- `Defaulted` requires `default_reason` (e.g. "Unreachable after 3 attempts", "Patient refused").
- **On terminal transition**: all remaining `Pending`/`Due`/`Overdue` orders in the standing order chain move to the selected terminal state. **Automated SMS firing stops immediately.**
- **Dashboard**: Defaulted/Transferred patients appear in a separate "Closed — Incomplete Protocol" report, distinct from active compliance metrics.

### Transitions (batch / date-driven)

| Condition                                | Effect                                                 |
| ---------------------------------------- | ------------------------------------------------------ |
| `current_date < due_date`                | **Compliance** — no escalation                         |
| `current_date = due_date`                | **Action** — e.g. populate **daily roster**, reminders |
| `current_date > due_date + grace_period` | **Violation** — escalation (alerts / lists per config) |

**Dynamic recalculation**: If a dose is given **off-schedule**, **recompute** all **remaining** `current_scheduled_date` values **consistently** (Invariant: protocol date recalculation). The projection (`projectDownstream` in `scheduled_orders/dateMath.ts`) anchors on the **Manila-local calendar date** of the administration (`clinicCalendarDate`), not the raw UTC timestamp — an administration before 08:00 PHT falls on the previous UTC date, which previously shifted every downstream dose one calendar day early (nurse user-test §5; covered by `tests/unit/dateMath.test.ts`).

**Standing orders**: Enable **nurse** execution of follow-up doses **without** repeat physician authorization **when** standing order chain is valid (Invariant: standing order authorization chain).

**Nurse reminder horizon (2026-08-16)**: the Upcoming worklist includes only
tomorrow and the following Manila clinic day (`>= tomorrow`, `< today + 3 days`).
Later doses stay on the protocol timeline but do not compete for the nurse's
near-term attention.

---

## Standing Orders

- **Created** from bundle / template (e.g. PEP protocol).
- **Authorize** predefined **clinical_orders** on **future** dates.
- **Nurse** executes against **standing order** + **patient** context; **no** new order per dose **when** policy satisfied.
- **Tied** to the **scheduling FSM** and **audit** (selective clinical audit, Req 23).
- **Phase 2** (#108): detail/timeline responses include `statusHistory[]` and consent data joined from `consents` table.
- **NOTE — W33 (template lock + copy-on-write versioning)**: `is_locked` enforcement and version-bump copy-on-write when a locked template is edited are **not yet merged**.

---

## Rabies PEP Schedule Logic

| Patient profile                               | Schedule (days)     | Notes                               |
| --------------------------------------------- | ------------------- | ----------------------------------- |
| Healthy, unvaccinated (**WHO** pre-qualified) | **0, 3, 7, 14**     | **HRIG** on **Day 0**               |
| Healthy, unvaccinated (**non-WHO**)           | **0, 3, 7, 14, 28** | Extended monitoring                 |
| **Immunocompromised**                         | **0, 3, 7, 14, 28** | **Day 28** + **serology** mandatory |
| **Previously vaccinated**                     | **0, 3**            | **No** HRIG                         |

**Rule**: Template selection drives **`protocol_items`** and **order generation**; schedule rows are **not** hardcoded only in UI — **backend** truth.

### ID vs IM Route (Shared Vial Economics)

The Philippine DOH recommends the **Intradermal (ID)** rabies regimen to reduce costs. The system **MUST** distinguish between the two routes because they have radically different inventory and billing implications:

| Route                  | Dose per administration      | Vial usage                                   | Billing model                           |
| ---------------------- | ---------------------------- | -------------------------------------------- | --------------------------------------- |
| **Intramuscular (IM)** | 0.5 mL or 1.0 mL (full vial) | **1 vial = 1 patient**                       | Full vial price per dose                |
| **Intradermal (ID)**   | 0.1 mL × 2 sites = 0.2 mL    | **1 vial = 2–5 patients** (same-day sharing) | Fractional / shared-vial price per dose |

**Implementation rules**:

- `clinical_orders` must include `administration_route` field: `IM` | `ID`.
- `service_catalog` must carry **separate billing codes** (and prices) for ID vs IM of the same vaccine product.
- **Inventory deduction for ID** must support **fractional deduction** (e.g. 0.2 of a 1.0 mL vial) **OR** use an end-of-day pooling model where daily ID patients are batched to calculate total vials opened.
- **Fractional lot tracking**: `inventory_lots` must track `remaining_volume_ml` alongside `quantity_on_hand` (whole vials). When a vial is opened for ID, the system records the opened lot and tracks remaining volume until depleted or expired (opened vial expiry per manufacturer — typically 6–8 hours).
- If a digital inventory shows 0 whole vials but physical fridge has stock, the data is wrong — this rule prevents that mismatch.

---

## Revenue Leakage Prevention

| Leak                            | Mitigation                                              |
| ------------------------------- | ------------------------------------------------------- |
| **Missed appointments**         | **SMS reminders**; upcoming / missed views              |
| **Undocumented inventory**      | **Bundle** links **lots** to **superbill** / line items |
| **Claim denials** (wrong codes) | **Bundle** enforces **correct** **ICD-10 / CPT** pairs  |

---

## Approval Workflows

### Cross-Branch Data Access (Stories 29, 31)

#### Standard path (non-urgent)

| Step  | Actor   | Action                                                                                      |
| ----- | ------- | ------------------------------------------------------------------------------------------- |
| **1** | Nurse   | Searches patient → "Not found in your branch" → clicks **"Search Other Branches"**          |
| **2** | Nurse   | Finds patient → clicks **"Request Access"** → enters reason                                 |
| **3** | System  | Logs in **`audit_logs`** (`action='CROSS_BRANCH_ACCESS'`), notifies **home branch manager** |
| **4** | Manager | Reviews request → **Approve** (with time limit: 24h/48h/1wk) or **Deny** (with reason)      |
| **5** | System  | Grants time-limited access, logs approval, notifies nurse                                   |
| **6** | System  | **All access logged** for audit; access **auto-expires** after time limit                   |

#### Emergency "Break Glass" Protocol (time-critical — patient on site)

The standard approval path creates a dangerous bottleneck for **time-sensitive protocols** (e.g. Rabies PEP Day 3 due _today_, patient at a different branch, manager unavailable). Turning the patient away risks a **missed dose** in a life-threatening protocol.

| Step  | Actor  | Action                                                                                                                                                                                             |
| ----- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | Nurse  | Searches patient → found at another branch → clicks **"Emergency Override — Patient On Site"**                                                                                                     |
| **2** | System | Prompts nurse for: `override_reason` (mandatory, e.g. "Rabies Day 3 due today, patient present"), `patient_verification` (confirms DOB + name match)                                               |
| **3** | System | **Grants immediate, temporary access** (default **2-hour** window, configurable per branch policy)                                                                                                 |
| **4** | System | **Simultaneously**: fires **high-priority alert** (push notification + SMS) to home branch manager AND admin, creates `audit_logs` entry with `action='BREAK_GLASS_ACCESS'`, `severity='CRITICAL'` |
| **5** | Nurse  | Can view chart, administer due dose, record in encounter — all actions logged with `break_glass_session_id`                                                                                        |
| **6** | System | Access **auto-expires** after time window. Manager receives post-hoc review task to **Acknowledge** or **Flag for Investigation**                                                                  |

**Safeguards**: Break Glass access is limited to **read + administer due orders**. It does NOT grant edit/delete on historical records. Abuse patterns (frequency per nurse) surfaced in admin dashboards. Repeated use without manager acknowledgment triggers escalation.

### Transaction Modification (Stories 30, 32)

> **Superseded 2026-08-02.** Earlier drafts of this section described a
> "Request Modification" queue where a nurse requested any change (including
> a payment-method correction) and a manager approved or denied it before
> anything was applied. That was never how void/refund worked (both already
> ran inline through `approval_requests` with the threshold rule below, not a
> generic request/approve queue), and it is not how payment-method correction
> works either, per the owner's standing decision (2026-07-06, see
> `.claude/rules/gotchas.md` "Money attestation" and the "Sensitive
> Corrections Logged Not Queued" convention): record corrections are inline,
> warned, and logged, not queued for approval. `approval_requests` is reserved
> for the void/refund money thresholds only.

**Payment-method correction** (`correctPaymentMethod`,
`apps/backend/src/modules/transactions/db.ts`): a cashier or nurse corrects a
mis-recorded tender type (e.g. Cash was keyed instead of GCash) directly from
the transaction detail rail.

| Step  | Actor  | Action                                                                                                                                                                                                   |
| ----- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | Staff  | Opens the transaction → **"Correct payment method"** → picks the new method / reference number, enters a reason                                                                                          |
| **2** | System | On the shared `Branch` kiosk login, prompts for the name + 4-digit PIN of whoever is performing the correction (see money attestation)                                                                   |
| **3** | System | Shows an inline warning (this replaces the original payment row; the receipt number and amounts do not change) before the request is sent                                                                |
| **4** | System | Applies the correction immediately: voids the original payment row and inserts a replacement, in one transaction. No approval wait                                                                       |
| **5** | System | Logs an `audit_logs` row (`action='TRANSACTION_MODIFY'`, `metadata.reason='payment_method_correction'`) with old/new method, who performed the correction, and whether it touched a closed drawer period |

The correction never blocks on a manager: it is amount-neutral (bill totals,
receipt number, and receiving cashier's attribution are all preserved), so
the control is "warn, attest, and log", not "queue for sign-off". A
correction that lands after the original drawer session closed is flagged
(`touchesClosedPeriod: true` in the audit metadata) for exception reporting,
but still proceeds inline.

**Void and refund** are the two operations still gated by
`approval_requests`, unchanged by the above:

**Rule**: Void/refund > **₱1,000** requires **manager approval**. Refund > **₱5,000** requires **admin approval**.

---

## BIR-Compliant Receipt Format (Story 21)

> **Current implementation (2026-06-20): acknowledgement receipt, not a BIR
> Official Receipt.** The clinic is a record system; manual Official Receipts are
> issued alongside on customer request. Both renderers (`AcknowledgementReceipt`
> HTML + `lib/escpos/receipt.ts` thermal) print an explicit "THIS IS NOT AN
> OFFICIAL RECEIPT" disclaimer and an "Official Receipt (BIR) issued on request"
> footer; no system-issued "OR No." appears. Header values (name / address /
> contact) come from the **transaction's branch** (exposed on the detail payload
> as `branch`, built by `features/transactions/receiptClinic.ts`), so they vary
> per branch of sale. **BIR pivot is data-only:** populating
> `branches.settings.receipt.bir` (TIN / registered name / permit / OR series)
> for a branch flips that branch to the Official-Receipt layout below with no
> code change. The table below is the target Official-Receipt format for when a
> branch is BIR-registered.

| Field                        | Source                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| **Clinic name + TIN**        | Branch config                                                                                     |
| **Branch address**           | `branches.address`                                                                                |
| **Receipt number**           | `transactions.id` format: `TXN-{YEAR}-{10 Crockford base32 chars}` (e.g. **TXN-2026-K9MX3VQ2P5**) |
| **Date and time**            | `transactions.transaction_date` + `created_at`                                                    |
| **Patient name**             | `patients.first_name + last_name`                                                                 |
| **Itemized services**        | `transaction_items` → `service_catalog.name`, qty, unit_price                                     |
| **Gross amount**             | `transactions.total_gross`                                                                        |
| **VAT breakdown**            | `total_vat_exempt`, `total_vat`                                                                   |
| **Discounts**                | `total_discount` + `discount_id_type` + `discount_id_number` (SC/PWD)                             |
| **Net amount**               | `transactions.total_net`                                                                          |
| **Payment method**           | `payments.payment_method` + reference                                                             |
| **Amount tendered / change** | Application-level (cash only)                                                                     |
| **Received by**              | `users.first_name + last_name` via `payments.received_by_id`                                      |
| **Footer**                   | "This serves as your official receipt"                                                            |

**SC/PWD Receipt must show**: Gross → Less VAT Exempt (12%) → Less Discount (20%) → Net; **OSCA/PWD ID number**.

---

## Admin Dashboard Categories (Story 34)

| Dashboard     | Key Metrics                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Overview**  | Total patients (all branches), encounters today, revenue today, active standing orders, pending appointments                     |
| **Financial** | Revenue by branch, revenue by service type, payment method breakdown, outstanding receivables (HMO/Corporate), discount analysis |
| **Clinical**  | Encounters by type, protocol completion rates, missed appointments by branch, average wait time                                  |
| **Inventory** | Stock levels by item, items expiring soon, items out of stock, inventory value                                                   |
| **Staff**     | Attendance, overtime hours, productivity (encounters/staff), performance trends                                                  |

---

## Runtime Review Center

**Publication state:** implemented in PR #616, pending merge to `main` as of
2026-08-23.

The `/review-center` page answers “what needs attention now?” from current
runtime state under the signed-in branch. Phase 1 provides two complete queues:

1. Active, non-merged patients under 18 with any missing guardian name,
   relationship, or contact field. Staff see the exact commit effects and must
   confirm all fields; the server applies an optimistic, audited same-branch
   correction without creating or closing clinical or financial records.
2. Prior Manila-day loose ends: stale Open/InProgress encounters, unsettled
   non-prepayment transactions, prior open drawers, and completed orders with
   no documenting actor. Rows open the existing owner workflow; the center
   never settles money, closes a drawer, completes an encounter, or invents an
   administration actor.

Drawer exceptions preserve the financial role boundary: only `TenantAdmin`,
`BranchAdmin`, `Cashier`, and the shared `Branch` account can operate the
branch kiosk drawer. PostgreSQL permits one Open drawer per tenant+branch; the
resolver, payment linkage, and deposits use that same session across
Asia/Manila day rollover. The migration refuses to choose or auto-close
pre-existing duplicates.

Approvals and cross-branch access remain separate linked review surfaces.
Potential-patient merge is deferred until every clinical/financial FK has an
explicit ownership and audited correction strategy. External-immunization
reconciliation is deferred until runtime records carry a durable “needs review”
fact. AppSheet migration exception queues are not runtime worklists. See
[`docs/specs/review-center-phase-1.md`](../specs/review-center-phase-1.md).

---

## End-of-Day / Shift Cash Drawer Reconciliation

**Req 14 (Shift) + Req 15 (EOD Reporting) — operationalized.**

At close-out, the accountable drawer operator compares the system-owned
session ledger with the physical cash. The drawer is a shared physical branch
resource, not one independent drawer per nurse.

### Workflow

| Step  | Actor              | Action                                                                                                                                                                                               |
| ----- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | Financial operator | `TenantAdmin`, `BranchAdmin`, `Cashier`, or `Branch` opens the branch drawer with an opening float, either through the cash-drawer owner workflow or the applicable clock-in path.                   |
| **2** | Database           | A partial unique index permits only one row with `state='Open'` per tenant+branch. A prior-day session remains the current drawer until an accountable operator closes it.                           |
| **3** | System             | Cash payments and physical bank deposits are linked to the immutable `cash_drawer_session_id`; date inference is not used to choose ownership.                                                       |
| **4** | Financial operator | At `/branch/kiosk`, reviews the opening float, on-hand cash, and deposit history, counts the physical cash, then submits `closingTotalDeclared`.                                                     |
| **5** | System             | Computes `expectedTotal = openingFloat + session-linked Cash payments - session-linked deposits` and `variance = closingTotalDeclared - expectedTotal`; closes with `state='Closed'` and `closedAt`. |
| **6** | Audit layer        | The normal database audit trigger records the accountable write. The Review Center only identifies and links the exception; it cannot close the drawer.                                              |

### Rules

- **Role boundary**: Nurse and Physician accounts may see a drawer exception in
  the Review Center but cannot open, close, deposit from, or void against it.
- **Logout behavior**: the shared `Branch` session receives a close-out warning
  when a drawer is Open; it remains an accountable soft warning, not an
  automatic close.
- **Handover**: overlapping staff use the same Open physical branch session.
  Another session cannot open until the existing one is closed.
- **Stored fields**: `state`, `opening_float`, `closing_total_declared`,
  `expected_total`, `variance`, `opened_at`, and `closed_at`. Deposits are
  separate, audited rows; voiding marks a reversal and never deletes history.

---

## Future Schema Enhancements (Additive, Non-Breaking)

| Priority          | Tables                                                                                                                                | Purpose                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **P1 Critical**   | `cold_chain_logs`, `appointments`, `diagnoses`, `prescriptions`                                                                       | Temperature monitoring, time-slot booking, ICD-10, Rx management |
| **P2 CRM**        | `patient_lifecycle_events`, `marketing_campaigns`, `campaign_sends`, `referral_rewards`                                               | Retention, outreach, referral tracking                           |
| **P3 POS**        | ~~`cash_drawer_sessions`~~ (promoted to core — see EOD workflow above), `cash_drawer_transactions`, `loyalty_points`                  | Cash reconciliation, loyalty program                             |
| **P4 Ops**        | `queue_entries`, `product_recalls`, `product_recall_notifications`, `staff_performance_metrics`, `equipment`, `equipment_maintenance` | Patient flow, product-recall management, staff metrics           |
| **P5 Compliance** | `data_retention_policies`, `consent_forms`, `adverse_events`, `system_config`                                                         | DOH retention, consent tracking, AEFI reporting                  |
| **P6 Analytics**  | `daily_metrics`, `monthly_metrics`, `patient_cohorts`, `cohort_members`                                                               | Pre-calculated dashboards, cohort analysis                       |

**Rule**: All enhancements are **additive** — **no breaking** migrations without explicit program.

---

## User Story Summary (by actor)

| Actor                   | Count | Focus                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nurse**               | 30    | **Patient CRUD** (create, edit, remarks, **fuzzy** search); **encounters** (log, history, from appointment); **bundle intake** **Day 0**; **appointments** (upcoming, create, missed, **SMS**); **standing orders** (Rabies PEP Cat II/III, Flu, Tetanus, consult+lab); **body map** (SVG bite location); **transactions** (from appointments, **SC/PWD/HMO**, split, partial, prepay, void, refund); **clock** / OT; **cross-branch** data request |
| **Admin**               | 4     | Approve/deny **cross-branch**; approve/deny **transaction** changes; **unrestricted** access; **dashboards**                                                                                                                                                                                                                                                                                                                                        |
| **System**              | 1     | **Audit**: security **always**, financial **always**, clinical **selective**, data access **always**                                                                                                                                                                                                                                                                                                                                                |
| **Additional / future** | 7     | Roadmap — not core v2.0 cut                                                                                                                                                                                                                                                                                                                                                                                                                         |

**Total**: **42** stories (30 + 4 + 1 + 7).

---

## Requirements Map (condensed)

| Req   | Topic                             | Workflow note                                                                                          |
| ----- | --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1     | Multi-tenant **branch isolation** | All clinical/financial **scoped**                                                                      |
| 2     | **MPI**                           | Single patient identity rules                                                                          |
| 3     | **Encounters**                    | Core visit record                                                                                      |
| 4     | Single immunization intake        | Atomic single-service path                                                                             |
| 5     | **Bundle intake**                 | **Atomic** patient + encounter + orders + txn                                                          |
| 6     | **Scheduling FSM**                | **10** ACs — batch, states, grace, **recalc**                                                          |
| 7     | **Standing orders**               | Template-linked authorization                                                                          |
| 8     | **Service catalog**               | Polymorphic services                                                                                   |
| 9     | Dynamic pricing                   | HMO / discount **tiers**                                                                               |
| 10    | **Split payments**                | Multi-channel settlement                                                                               |
| 11    | **BIR** receipts                  | Compliance                                                                                             |
| 12    | Inventory brand / lot resolution  | Nurse picks brand; system resolves eligible internal lot. Patient-to-lot tracking is future expansion. |
| 13    | Product **recall** traceability   | Lot-level                                                                                              |
| 14    | **Shift** management              | Staff time                                                                                             |
| 15    | **End-of-day** reporting          | Ops                                                                                                    |
| 16–17 | **DPA** / breach                  | Compliance                                                                                             |
| 18–19 | **PIDSR** / **NaRIS**             | Surveillance / registry                                                                                |
| 20    | **Retention**                     | Medical records                                                                                        |
| 21    | **FHIR**                          | Interop                                                                                                |
| 22–23 | **Auth** / **audit**              | Security + selective logging                                                                           |
| 24    | **Lab** integration               | Orders/results                                                                                         |
| 25    | **Patient portal**                | Self-service                                                                                           |
| 26    | **SMS**                           | Reminders, idempotent                                                                                  |
| 27    | **Migration** AppSheet            | Data                                                                                                   |
| 28    | **Performance**                   | e.g. **100** concurrent, **500ms** search, **3s** API p95                                              |
| 29–30 | **Backup/DR**, **system config**  | Ops                                                                                                    |

---

## Key Correctness Properties (28)

**Invariants** — system **must never** violate:

| #   | Property                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Branch isolation**                                                                                                                                   |
| 2   | **Financial balance**: Σ payments = **net total**                                                                                                      |
| 3   | **Inventory deduction atomicity** (with txn / order completion)                                                                                        |
| 4   | **Protocol date recalculation** consistency                                                                                                            |
| 5   | **Mandated discount**: `(base_price / 1.12) * 0.20` **exactly** as specified                                                                           |
| 6   | Brand selection — nurse-picked; an eligible internal lot is resolved server-side for stock controls. Patient-specific lot attestation is future scope. |
| 7   | **Audit log immutability**                                                                                                                             |
| 8   | **Encryption at rest** (AES-256)                                                                                                                       |
| 9   | **Session timeout** (30 min)                                                                                                                           |
| 10  | **FHIR** round-trip integrity                                                                                                                          |
| 11  | **Standing order authorization** chain                                                                                                                 |
| 12  | **Scheduling FSM** valid transitions only                                                                                                              |
| 13  | **Duplicate payment** prevention                                                                                                                       |
| 14  | **Expired lot** hard-stop                                                                                                                              |
| 15  | **No** cross-branch encounter **without** policy                                                                                                       |
| 16  | **Consent** retention alignment                                                                                                                        |
| 17  | **Price snapshot** immutability post-commit                                                                                                            |
| 18  | **Bundle atomicity** (all-or-nothing)                                                                                                                  |
| 19  | **Notification idempotency**                                                                                                                           |
| 20  | **Audit completeness** (required fields / events)                                                                                                      |
| 21  | **Nurse authorization chain**: If `performed_by` role = Nurse, `authorizing_physician_id` is mandatory on standing orders and bundle creation          |
| 22  | **Weight-based RIG dosing**: ERIG/HRIG quantity derived from `weight_kg`; manual override requires audit entry                                         |
| 23  | **ID/IM inventory accuracy**: Intradermal fractional deductions must keep `inventory_lots.remaining_volume_ml` consistent with physical stock          |
| 24  | **Scheduling FSM terminal closure**: `Defaulted`/`Transferred` transitions halt all automated notifications for the standing order chain               |
| 25  | **Break Glass audit**: Every emergency cross-branch override creates a `CRITICAL` severity audit entry and requires post-hoc manager acknowledgment    |
| 26  | **Cash drawer integrity**: `cash_drawer_sessions` Over/Short logged on every close; no transaction without an open session                             |
| 27  | **Preventive hard-stop**: Preventive-specialty encounters block transaction creation without `authorizing_physician_id` or `external_rx_reference`     |

---

## Overdue / Due Today — Example Query

**Operational list** (adjust schema names to implementation):

```sql
SELECT p.name, p.contact_number, sc.name AS service, co.current_scheduled_date, co.status
FROM clinical_orders co
JOIN patients p ON p.id = co.patient_id
JOIN service_catalog sc ON sc.id = co.service_id
WHERE co.current_scheduled_date = CURRENT_DATE
  AND co.status IN ('Pending', 'Due')
ORDER BY co.current_scheduled_date, p.last_name;
```

---

## Workflow Invariants

- **Bundle intake** is **atomic**: **patient + encounter + orders + transaction** (or explicit rollback) — **Invariant 18**.
- **Scheduled orders** ride a **date-driven FSM** with **grace** and **violations**; **only** valid **Invariant 12** transitions. Terminal states `Defaulted`/`Transferred` halt notifications — **Invariant 24**.
- **Late administration** triggers **full** **remaining** schedule **recalc** — **Invariant 4**.
- **Money**: **Invariant 2** on every posted transaction; **split** payments **Invariant 13**-safe. **Cash drawer integrity** — **Invariant 26**.
- **Stock**: explicitly selected brand maps to an eligible internal lot; **Invariant 3** + **Invariant 14** still hard-stop expiry / quarantine / ineligibility. Patient-specific lot attestation is future scope. **ID/IM fractional accuracy** — **Invariant 23**.
- **Clinical authorization**: Nurse-initiated orders require physician link — **Invariant 21**. Weight-based RIG dosing — **Invariant 22**. Preventive hard-stop — **Invariant 27**.
- **Cross-branch**: Standard approval **Invariant 15**; emergency Break Glass **Invariant 25**.
- **Compliance**: **BIR** math **Invariant 5**; **audit** **Invariant 7** + **20**; **branch** **Invariant 1** + **15**.
- **Interop / security**: **FHIR 10**, **session 9**, **encryption 8**, **standing orders 11**.
