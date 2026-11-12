# AppSheet → SureVax v2 — Importer Design

> The importer is a pure-functional ETL: `extract → transform → load`, with a
> mock DB adapter for tests and a (stubbed) Drizzle adapter for production.
> Module: `apps/backend/src/modules/data_migration/`. No new tables — see
> `DECISIONS.md` "use existing schema" verdict.

> **2026-08-16 correction:** direct `extract → transform → load` is insufficient
> for the live-source reality. Current immunizations can be deleted/recreated,
> paid transactions can contain several future doses, and clinic trackers add
> independent but name-only evidence. Insert an immutable observation/event
> reconciliation stage before target transformation. See
> [`EVIDENCE-AND-RECONCILIATION.md`](EVIDENCE-AND-RECONCILIATION.md). The “no new
> domain tables” verdict still applies to normal clinical/financial storage;
> permanent migration-provenance tables versus external run artifacts is open.

## Module structure

```
apps/backend/src/modules/data_migration/
├── types.ts          # SrcXxx row types (one per sheet) + SourceBundle + MigrationContext/Report
├── normalize.ts      # boundary coercion: str/num/money/bool/dateOnly/ts/sex/firstBranchSlug
├── idMap.ts          # RowIdMap — kind-partitioned AppSheet RowID ↔ bigint
├── extract.ts        # exceljs reader → SourceBundle; bundleFromMap() for tests
├── targets.ts        # TargetXxx row shapes (minimal projections of Drizzle cols) + LoadPlan
├── adapter.ts        # drizzleAdapter() [stub] + createMemoryAdapter() [tests]
├── load.ts           # dependency-ordered, batched loader (withPlatformTx in prod)
├── index.ts          # runMigration({ xlsxPath, tenantId, dryRun, adapter })
└── transform/
    ├── index.ts          # orchestrator — runs all transformers in dependency order
    ├── branches.ts       # Branch → branches (3-letter code synthesis, drop b_AllowAccess)
    ├── users.ts          # Nurse + AdminEmails → users + roles (migration-bot service acct)
    ├── catalog.ts        # Vaccine → products + service_catalog + eligible + prices
    ├── patients.ts       # Patient → patients (dedup via merged_into_id; MRN chronological)
    ├── encounters.ts     # synthesise encounters (patient,branch,day); triage_category; remarks
    ├── clinicalOrders.ts # Immunization → clinical_orders (+ PSO course synthesis)
    ├── transactions.ts   # Transactions+Imm → transactions+items+payments
    ├── shifts.ts         # future TimeLog + NurseShift union → staff_time_logs
    ├── cash.ts           # CashBalanceLog → cash_drawer_sessions
    └── remarks.ts        # orphan Remarks → patients.onboarding_data.legacyNotes
```

Why an injected `DbAdapter`: the loader is table-agnostic. Tests pass an
in-memory recorder that verifies batching/ordering/idempotency without Postgres.
Production `drizzleAdapter` wraps `withPlatformTx({ targetTenantId })` so the
audit trigger's `app.current_tenant_id` GUC is set (see `.claude/rules/gotchas.md`
"Audit trigger raises on missing tenant GUC").

## Load order (referential)

1. branches → users → products → service_catalog
2. service_eligible_products / service_prices (need svc + product ids)
3. patients → patient_tags
4. encounters (need patient + branch + user ids)
5. patient_standing_orders (need patient + encounter ids)
6. clinical_orders (need PSO + encounter + service ids)
7. transactions → transaction_items → payments **(Bot-12 atomicity: items + payments for the same txn must batch together)**
8. cash_drawer_sessions; optional staff_time_logs only after the C1 source union

## Field mapping (legacy column → v2 column)

### Patient → patients

| legacy                                    | v2                                                                   | notes                                                                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `Row ID`                                  | (in-memory RowIdMap only)                                            | not persisted (A3)                                                                                                       |
| `p_FirstName`/`p_LastName`/`p_MiddleName` | `first_name`/`last_name`/`middle_name`                               | split from `p_FullName` if missing                                                                                       |
| `p_DateOfBirth`                           | `date_of_birth`                                                      |                                                                                                                          |
| `p_Gender`                                | `sex`                                                                | Male/Female/Other/Unknown                                                                                                |
| `p_ContactNumber`                         | `contact_number`                                                     | normalised `+63XXXXXXXXXX`                                                                                               |
| `p_EmailAddress`                          | `email` (citext)                                                     | rejected if not valid-email shaped                                                                                       |
| `p_HomeAddress`                           | `address`                                                            |                                                                                                                          |
| `p_Branch` (CSV)                          | `home_branch_id` = first slug                                        | other branches surface via encounters                                                                                    |
| `p_OnboardingChannel`                     | `onboarding_data.channel`                                            |                                                                                                                          |
| `p_SourceOfConcern`                       | `onboarding_data.sourceOfConcern`                                    |                                                                                                                          |
| `p_Categorization`                        | → `encounters.triage_category`                                       | NOT on patient (B6)                                                                                                      |
| `p_HealthCard`                            | **dropped** (B2)                                                     | regenerated in v2                                                                                                        |
| `p_PetStatus`                             | `animal_observation_followups` / raw migration provenance            | `Alive` = alive/healthy Day 14; `Dead` = generic death unless remarks say more; `Pending` = outcome not recorded/updated |
| `p_PetFirstARVDate`                       | `onboarding_data.legacyHumanFirstArvDate` + regimen anchor candidate | human patient's first ARV date; never animal-vaccination proof                                                           |
| `p_DateFirstVisit`                        | `created_at` + MRN sequence order                                    |                                                                                                                          |
| —                                         | `mrn`                                                                | `nextval('mrn_seq_<slug>')`, chronological by first visit                                                                |

### Vaccine → products / service_catalog / junctions / prices

- brand → `products.name`/`.manufacturer`
- (type, route) → `service_catalog` code; `TYPE_TO_SERVICE_CODE` maps `Anti Rabies - PEP`→`ARVPEP`, `Tetanus Toxoid`→`TT`, etc. + `_<ROUTE>` suffix
- brand × service → `service_eligible_products` (first = `is_default`)
- payer route value (Hati Health/Forticare/MedAsia/Philbritish) → `service_prices.payer_id`
- physician route value + OR/NoOR → collapse to canonical service (attribution via `performed_by_id` at sale time)
- every source Row ID registered in `legacyRefToServiceId` (fixes the 1,644-row drop)

### Immunization → clinical_orders (+ patient_standing_orders)

| legacy                                | v2                                      | notes                                                                                        |
| ------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------- |
| `i_VaccineRef`                        | `service_id` (via legacyRefToServiceId) |                                                                                              |
| `i_IsAdministered?` + evidence ledger | `status`                                | Completed only with administration evidence; otherwise Scheduled unless explicitly Cancelled |
| `i_Timestamp_Actual`                  | `completed_at`                          |                                                                                              |
| `i_Timestamp_Ideal`                   | `scheduled_at`                          | clamp typos                                                                                  |
| `i_NurseRef`                          | `administered_by_id`                    | when administered                                                                            |
| `i_VaccineRoute`                      | `administration_route`                  | Oral→PO                                                                                      |
| `i_SiteAdministered`                  | `administration_site`                   |                                                                                              |
| `i_Label` dose marker                 | `dose_number`                           | **parse from label, not i_DosageCount** (see pending §)                                      |
| —                                     | `patient_standing_order_id`             | set for ARV-PEP course members                                                               |

### Transactions → transactions + transaction_items + payments

| legacy                                                 | v2                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `t_PatientRef`/`t_BranchRef`/`t_NurseRef`              | `patient_id`/`branch_id`/`cashier_id`                                                                                    |
| `t_TransactionValue` + `t_TransactionValueNonService`  | `gross_amount` (combined; non-service NOT a separate line — B8)                                                          |
| `t_Adjustment` (<0) / `t_DiscountRef`                  | `discount_amount` + `discount_id_type` + `discount_id_number`                                                            |
| linked `Immunization` rows (forward+inverse union)     | `transaction_items` (1 per imm)                                                                                          |
| `t_AmountPaid_{Cash,GCash,BankTransfer,PayMongo,Misc}` | `payments` (1 row per non-zero method)                                                                                   |
| `t_MiscPaymentType` (closed 11-enum)                   | **`transactions.payer_id`** (R1′ — authoritative payer; misc amt = partner settlement). Normalise "Ayala Malls"→"(UPTC)" |
| ChargeAccounts overlay                                 | `payments.reconciliation_status` ONLY (R7 — derived view ≡ the 587 misc txns; not the payer source)                      |
| label `HSxxxx`                                         | reference field only (NOT branch_seq — not gapless)                                                                      |

## Transaction consolidation rule (the core grain fix)

Source has a per-vaccine-transaction antipattern (DATA-ANALYSIS §6). Pre-pass
that groups source transaction rows **before** the existing fan-out:

> **Merge** transactions when: same patient + same day + same nurse + **disjoint
> item sets**. Consolidated transaction:
>
> - `total = Σ split totals`
> - `transaction_items = ∪ all split items`
> - `payments` = one row per (method, source-split) → handles the 55 mixed-tender cases natively
> - original receipt labels preserved in `notes`/metadata
> - fresh gapless `branch_seq` assigned (legacy `HSxxxx` is NOT gapless)
>
> **Do NOT merge:**
>
> - different-nurse same-day groups (19) — possible separate visits
> - overlapping-item groups (5) — suspected duplicate charges; flag for ops
> - no-item groups (2) — manual

This is **orthogonal** to the cross-patient "Multiple Patients" group-drive
transactions (68 txns, one txn → many patients) which need their own per-patient
split-out — see OPEN-QUESTIONS.

## Idempotency

Every INSERT: `ON CONFLICT (tenant_id, legacy_appsheet_id) DO NOTHING`. The
loader registers inserted bigint ids in the `RowIdMap` as it goes; downstream FK
resolution is by lookup. Re-running the same export is a no-op. Patients use the
in-memory map only (no persisted legacy id per A3) — so patient re-import is NOT
idempotent across separate runs; acceptable for a one-shot cutover (B1).

## Changes surfaced by the deep-dive but NOT YET applied to code

The code's last green state (103 tests passing) predates the financial/grain
deep-dive. These are the deltas to fold in next:

| #   | Change                                                                                          | Status            | Ambiguity                        |
| --- | ----------------------------------------------------------------------------------------------- | ----------------- | -------------------------------- |
| 1   | **Dose number from `i_Label` parse** (`(\d+)(?:st\|nd\|rd\|th) Dose`), not `i_DosageCount`      | unapplied bug fix | none                             |
| 2   | **Full 8-code discount map** (add QCID/DMCI/BFP/PPSV3 → `Other`+number; `Employee` → drop+warn) | unapplied         | none                             |
| 3   | **Clamp pre-2024 + epoch dates** too (not just future)                                          | unapplied         | none                             |
| 4   | **AyalaMalls → `service_prices` +15% uplift**, set `payer_id` not discount                      | unapplied         | confirm modeling                 |
| 5   | **Transaction consolidation pre-pass** (the grain rule above)                                   | unapplied         | edge decisions in OPEN-QUESTIONS |
| 6   | **Cross-patient group-drive split** (68 txns)                                                   | unapplied         | split-vs-group decision          |

Items 1–3 are unambiguous correctness fixes (apply with tests). 4–6 need the
open-question answers first.

Round-2 analysis (DATA-ANALYSIS §14–22) added these:

| #   | Change                                                                                                                                                                                                                                                                | Status              | Ambiguity              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------- |
| R1′ | **Payer from `t_MiscPaymentType` (closed 11-enum), NOT ChargeAccounts.** Seed used payers (Intellicare/Avega/Ayala/Hati/MedAsia/Forticare); SureVax+Luis Sia→null. ChargeAccounts → `reconciliation_status` only (R7). AyalaMalls = signed `t_Adjustment` markup (R8) | 🔴 high — unapplied | none (grounded §23–25) |
| R2  | **Add `abf→Aguirre`, `nova→Novaliches`, `alabang15→Alabang` to shifts.ts email map**                                                                                                                                                                                  | 🔴 high — unapplied | none (447 shift rows)  |
| R3  | **`email_opt_in` default false (SMS-first); clamp 30 implausible DOBs (age<0 or >120)**                                                                                                                                                                               | unapplied           | none                   |
| R4  | **Tag ~205 condition-mentioning patients `LEGACY_NOTE_NEEDS_CLINICAL_REVIEW`** (no auto-parse)                                                                                                                                                                        | unapplied           | none                   |
| R5  | **Flag 46 mid-course route-switch PEP patients** (PSO uses first-dose route — already does)                                                                                                                                                                           | unapplied           | none — flag only       |
| R6  | **`SureVax`/`Luis Sia` charge accounts → `payer_id` null** (self-pay/individual)                                                                                                                                                                                      | unapplied           | none                   |

R1 + R2 are the highest-value corrections (they affect ₱4.46M of AR attribution
and 447 staff rows respectively) and are mechanically unambiguous — apply with
tests next. R1's seed half (the two payer rows) is coupled to the seed-edit
permission (OPEN-QUESTIONS Q14); the `mapPayerCode` half is standalone.

Round-4 analysis (DATA-ANALYSIS §27–32) added these — two are the most serious
findings of the whole effort:

| #   | Change                                                                                                                                                                                                           | Status                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| R9  | **Derive `EXPORT_DATE` from data `max(admin/txn date)` (≈2026-05-21), NOT the hardcoded `2025-05-21`**                                                                                                           | 🔴🔴 confirmed bug — unapplied |
| R10 | **Synthesise one active `consents` row per migrated patient** (else `assertActiveConsent` freezes them post-cutover)                                                                                             | 🔴 blocker — unapplied         |
| R11 | 223 purchased-but-not-administered doses → normal transaction with one item per allocated dose slot; slot remains `Scheduled`. Reserve `transactions.is_prepayment=true` for an itemless patient-credit deposit. | superseded by E5 — unapplied   |
| R12 | Import bundle ERIG fallback for the 19 un-fanned-out patients (refines A2)                                                                                                                                       | unapplied                      |
| R13 | 30 NurseShift names unresolved → fuzzy-match by last name or skip-with-warning                                                                                                                                   | unapplied                      |

**R9 is a confirmed latent bug in the recreated code** (`transform/clinicalOrders.ts`
`EXPORT_DATE`), and fixing it changes the date assumptions baked into
`transform-clinical-orders.test.ts` (the fixtures assume the 2025 cutoff) — so it
must land with test updates. **R10 is the only true cutover blocker** — migrated
patients are clinically frozen without a synthetic consent row. Apply R9 + R10 +
the loader-side consent stage before any real cutover.

Round-6 verification (DATA-ANALYSIS §38–45) added these — found by auditing the
code + cross-checking counts:

| #   | Change                                                                                                                                         | Status                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| V1  | **Map `v_Type='Other'` (21 rows) → `SVC_OTHER` or explicit skip-with-warning** (catalog.ts currently silently drops them)                      | 🔴 silent drop — unapplied |
| V2  | **8 lab-panel-string `i_VaccineRef`s** → name-match seeded bundle or skip-with-warning (~29 items/orders lost with V1)                         | medium — unapplied         |
| V3  | **Dedup catches only 5/15 mixed-format dups** — keep strict triple as auto-merge, flag the 10 phone-mismatch near-matches for review           | medium — unapplied         |
| V4  | **Weight-based services** (ERIG/HRIG/HTIG/ATS): suppress/nominal-flag the single `service_prices` list-price; mark `requires_dose_calculation` | low — unapplied            |

R9's quantified impact is now exact: **9,146 orders mislabelled Scheduled** (true
split is 1,721 Scheduled / 11,716 Cancelled / ~46,039 Completed). V1 is a newly
found **silent** drop (21 `Other`-type orders + items) — promote to a warning at
minimum. The `clinicalOrders.ts` status-mapping comment was corrected to the
post-fix counts + an inline R9 warning (code change made; the `EXPORT_DATE`
constant itself is still unapplied pending the test-fixture update).

## Cutover sequence

1. Ops declares an Asia/Manila cutoff, freezes AppSheet writes, and confirms no
   in-flight bots/syncs (H20/Q31).
2. Create immutable historical/current source copies; refresh
   [`SOURCE-MANIFEST.json`](SOURCE-MANIFEST.json) with Drive IDs, timestamps and
   export SHA-256 hashes.
3. Export the AppSheet database and all 14 clinic trackers, including Cubao;
   quarantine copied/ownerless sheets.
4. Ops cleans the must-fix-in-source items (see OPEN-QUESTIONS "clean before
   export").
5. Extract immutable source observations, apply only approved append-only
   augmentations, reconcile canonical events, and emit all exception queues
   from `EVIDENCE-AND-RECONCILIATION.md`.
6. Run `runMigration({ dryRun: true })` → produces source-coverage, financial,
   purchase/admin, dose-schedule and provenance reports. Iterate until the
   acceptance gate is signed off.
7. Apply schema/seed prerequisites—including unknown-date external history and
   `legacy-import` consent idempotency—and the production Drizzle adapter.
8. Run `runMigration({ dryRun: false })` against the `SVX` tenant.
9. Run post-load invariants and UI spot checks; flip only after sign-off.
