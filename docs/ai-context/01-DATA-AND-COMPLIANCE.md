# 01 — Data Model & Compliance

> **Schema v2 cutover complete (Phases 1–4 shipped 2026-05-07).** Dual-write pairs collapsed, legacy columns dropped, transitional migrations squashed into an 8-file baseline ([`#228`](https://github.com/njvil/surevax-cms-revamp/pull/228)). Original phased plan archived at [`docs/handovers/archive/2026-05-01-schema-v2-phase1.md`](../handovers/archive/2026-05-01-schema-v2-phase1.md). Authoritative target schema: [`docs/specs/schema-v2-redesign.md`](../specs/schema-v2-redesign.md). The body of this document reflects the current shape only — no parallel-state columns remain.
> **ID redesign landed 2026-05-19.** Every entity table is `bigserial` PK + `display_id text NOT NULL UNIQUE`; FKs are `bigint`. API responses surface `display_id` only — bigint never leaves the backend. See [`.claude/rules/gotchas.md`](../../.claude/rules/gotchas.md) "Display IDs — two-tier model" and [`docs/handovers/archive/2026-05-18-id-redesign.md`](../handovers/archive/2026-05-18-id-redesign.md) for the full table-by-table mapping.

> **Last Synthesized**: 2026-04-11 | **Updated**: 2026-08-23 (corporate AR, active-clinical-order billing, tenant linkage, SC/PWD and receiver controls, branch-wide Open cash-drawer invariant, and Runtime Review Center) | **Self-contained** — synthesized from now-archived source docs

---

## Critical Decisions (Non-Negotiable)

| #     | Decision                                            | Rationale                                                                                       |
| ----- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **1** | **PostgreSQL RLS** for **multi-tenancy**            | **Database-level isolation** — **not** sole reliance on app-layer `WHERE` filters               |
| **2** | **Strict audit trail**                              | **who**, **what**, **when**, **old_value**, **new_value** — **Philippine DPA** / accountability |
| **3** | **Zod** = **single source of truth** for validation | Shared schemas; API + DB alignment                                                              |
| **4** | **Soft deletes** via **`deleted_at`**               | **No** hard deletes for clinical/financial integrity                                            |
| **5** | **Generic `audit_logs`**                            | **Not** per-entity audit tables; monthly-partitioned                                            |
| **6** | **Standing orders** = **core clinical abstraction** | Templates → items table → patient protocols → **`clinical_orders`**                             |

### Phase-1 financial data controls (PR #617)

- **One active bill per clinical order:**
  `transaction_items(tenant_id, clinical_order_id)` has a validated composite
  FK to `clinical_orders(tenant_id, id)`. A database trigger locks the clinical
  order as the concurrency key and rejects a second item whose parent
  transaction is active. A companion transaction-activation trigger prevents
  Voided/Refunded reactivation and rechecks claims when a soft-deleted open
  transaction is restored.
- **History remains history:** Void/Refund releases only the active claim so a
  corrected bill can be created; the old transaction/item remains immutable and
  auditable. Totals and receipt/transaction sequences are unchanged.
- **SC/PWD evidence:** `discount_id_number` is required and nonblank when
  `discount_id_type` is `OSCA` or `PWD`, enforced by the shared Zod contract and
  again at the backend service boundary before any write. `NA`/`Other` policy
  is unchanged.
- **Receiver accountability:** each HTTP money route supplies authenticated
  caller identity. Shared Branch sessions resolve a named, PIN-attested staff
  receiver; payment correction preserves the original receiver and records the
  correction actor separately. Public contracts expose `USR_…` display IDs,
  never bigint receiver keys.
- **Legacy null receiver:** correction fails closed. A TenantAdmin must repair
  attribution from source evidence through an audited process; staff must not
  infer or guess it.
- **Deployment proof:** migration DDL uses a bounded lock timeout and the
  migrator asserts both billing triggers plus the validated tenant FK before
  success.

---

## Schema Overview

### Design Philosophy

- **Simple**, **modular**
- **Generic audit logs**; **JSONB** for flexible, non-indexed payloads only — surfaced to columns wherever queried
- **Tables** only where **complex queries** / FK graphs justify them

### System-Wide Standards

| Standard                             | Rule                                                                                                                                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Primary keys**                     | **Tiered text display IDs** — code-suffixed (`TEN-SUREVAX`, `TEN-SUREVAX.SVC-ARVPEP-IM`), random-suffixed (`PAT-K9MX3VQ2P5`), year-prefixed (`TXN-2026-…`), parent-embedded (`PAT-….ENC-2026-…`, `TXN-….IA8K3M9`); generated app-side via `displayId.ts`. UUIDs are gone. |
| **Row audit columns**                | **`created_at`**, **`updated_at`**, **`created_by_id`** (FK → `users.id`)                                                                                                                                                                                                 |
| **Soft delete**                      | **`deleted_at`** (where applicable)                                                                                                                                                                                                                                       |
| **Tenant boundary + branch scoping** | **`tenant_id` required on all tenant-scoped core tables**; **`branch_id`** (or **`home_branch_id`**) is operational scope/filter                                                                                                                                          |
| **Central audit store**              | **`audit_logs`** — partitioned **by month** (implemented)                                                                                                                                                                                                                 |
| **Money**                            | **`NUMERIC(12,2)`** everywhere — never REAL/FLOAT                                                                                                                                                                                                                         |
| **Dates**                            | **`DATE`** type for calendar dates (DOB, expiry); **`TIMESTAMPTZ`** for event timestamps                                                                                                                                                                                  |
| **Integers**                         | **`INTEGER`** for counts, versions, offsets — never `decimal(n,0)`                                                                                                                                                                                                        |

### Domain Map (6)

| Domain                     | Scope                                                              |
| -------------------------- | ------------------------------------------------------------------ |
| **Multi-Tenancy & Access** | branches, users, RBAC, RLS context                                 |
| **Patient Registry**       | demographics, tags, search                                         |
| **Catalog & Pricing**      | `service_catalog`, payer rules                                     |
| **Clinical Operations**    | encounters, **standing orders**, `clinical_orders`, labs, consents |
| **Inventory Traceability** | lots, FEFO, movements                                              |
| **Billing & AR**           | transactions, items, payments, payers                              |

### Core Tables (24)

| #       | Table                                | Purpose / Highlights                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1**   | **`branches`**                       | **`tenant_id` FK**, **`code` UNIQUE per tenant**, name, address, contacts, **`is_active`**, **`settings` JSONB**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **2**   | **`users`**                          | **`tenant_id` FK**, **`primary_branch_id`** (nullable bigint; multi-branch access is the **`user_branches`** junction, not a column here, schema v2 dropped `users.branch_id`), **`email` UNIQUE per tenant** (citext), **`password_hash`**, name, role via the **`user_roles`** junction (`TenantAdmin` canonical / `SuperAdmin` legacy alias / `BranchAdmin` / `Physician` / `Nurse` / `Cashier` / **`Branch`**; precedence resolved by `userPrimaryRoleSql()`, schema v2 dropped the `users.role` column), **`license_number`**, **`is_active`**, **`can_login`** (Phase 1: only `TenantAdmin`/`SuperAdmin`/`BranchAdmin`/`Branch` default to true; per-user toggle gates `/api/auth/login`). **Seeded 2026-07-30**: every branch in the `Branch` sheet gets its own `Branch` kiosk login (`can_login = true`, its own mailbox from `b_BranchEmail`), and the clinic's 103 real nurses from the `Nurse` sheet are seeded `can_login = false` with a kiosk PIN and `user_branches` rows for the branches that sheet assigns them to, since a nurse identifies herself by PIN on the shared session rather than by password. `license_number` is left null for them: the export carries no PRC numbers and a fabricated licence on an immunization record is worse than none, **`last_login_at`**                                                                                            |
| **3**   | **`staff_time_logs`**                | **`tenant_id` FK**, **`user_id`** (target staff), **`branch_id`**, **`clock_in_at`**, **`clock_out_at`**, **`total_hours`**, **`float_amount NUMERIC(12,2)`** (cashier drawer float at start of shift, default `0`), **`drawer_state`** (free-text, default `'open'`; Phase 2 candidate for enum), notes, **`created_by_id`** (= `user_id` on self clock-in; = Branch-account user id when a kiosk session clocks someone else in)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **4**   | **`patients`**                       | **`tenant_id` FK**, **`home_branch_id`**, demographics (**`sex` enum**, **`date_of_birth DATE`**), guardians, allergies JSONB (legacy), conditions JSONB (legacy), onboarding JSONB, **`onboarding_channel`** (acquisition "lead source" text; allowed values validated by Zod, not a DB `pgEnum`, so the list grows without the append-only-enum ratchet) + **`onboarding_channel_payer_id`** FK → `payer_profiles` ON DELETE SET NULL (set only for `Partner`/`HMO` channels; `getPatient` projects it to `{ id, name }` so the bigint never leaks), migration `0008`, insurance, **`region` text** (Philippine region, added PR #250; auto-filled by `AddressAutocomplete` via Places API), **`is_active`**, **`deleted_at`**, **`search_vector` tsvector**. **Phase 2 read path** (PR #99): `GET /api/patients/:id` now joins `patient_allergies` rows + `patient_conditions` rows + `tag_definitions` (via `patient_tags.tag_definition_id`); legacy JSONB columns + free-text `patient_tags.tag` remain until Phase 4 drop.                                                                                                                                                                                                                                                                                                                                                             |
| **5**   | **`service_catalog`**                | **`tenant_id` FK**, **`code` UNIQUE per tenant**, **`sku`** (BIR-compliant, nullable; surfaced as a separate column from internal `code` so cashier UI can render the customer-facing SKU), name, **`service_type`**, **`category_id` FK → `service_categories`** (replaces freeform `category` text — dropped in 0011), **`product_id` FK → `products`** (one-product hint — nullable; for multi-brand services use `service_eligible_products`), **`requires_dose_calculation`** (weight-based dosing for ERIG/HRIG/HTIG/ATS — added 0010), **`is_vat_exempt`** (default `false`; drives the auto-populated VAT-EX vs 12% badge in the cashier cart), **`is_active`** (default `true`; user-facing service pickers must filter `is_active = true` — the 32 panel-only lab tests carry `false` so they don't appear as orderable services), stock flags, Rx requirement, **`deleted_at`**, **`search_vector`** (name + code only; category dropped 0011). **Phase 2 read path** (PR #100): effective price resolved from `service_prices` via a most-specific-match resolver in `apps/backend/src/shared/lib/pricing.ts` (`(branch, payer, segment) → (branch, payer) → (branch) → tenant-wide`). **2026-05-17 cleanup (PR #351)**: catalog rows are now abstract per clinical entity (`ARVPEP_IM`, not brand variants); partner pricing lives in `service_prices` rows keyed by `payer_id`. |
| **5b**  | **`service_eligible_products`**      | Added 0016. Junction: which products satisfy an abstract service. `(tenant_id, service_id, product_id, is_default, ranking)` with `UNIQUE(tenant_id, service_id, product_id)`. Lets `ARVPEP_IM` draw from Abhayrab or Speeda stock without separate catalog rows. Read at administer-time via `eligibleProductIdsSql` to build the nurse's brand picker (`is_default`/`ranking` order it house-brand-first, then earliest expiry within a brand — 2026-07-25).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **6**   | **`standing_order_templates`**       | **`tenant_id` FK**, **`code` UNIQUE per tenant**, description, **`requires_physician_auth`**, **`version INTEGER`**, **`is_active`**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **6b**  | **`standing_order_template_items`**  | Protocol line items — **`template_id` FK**, **`service_id` FK** (referential integrity enforced at DB), **`day_offset INTEGER`**, **`sequence INTEGER`**, **`quantity NUMERIC(8,2)`**, instructions; `UNIQUE(template_id, day_offset, sequence)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **7**   | **`patient_standing_orders`**        | **`tenant_id` FK**, patient + template + encounter + authorizing provider; dates; **`status`**; discontinuation fields; notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **8**   | **`encounters`**                     | **`tenant_id` FK**, patient, branch, provider, type, times, complaint, status, **`specialty`**, **`specialty_data` JSONB**, **`clinical_notes` JSONB** (vitals/SOAP), **`deleted_at`**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **9**   | **`clinical_orders`**                | **`tenant_id` FK**, links **`patient_standing_order_id`** (nullable), **`service_id`**, encounter; order type (**`Standing_Order` / `Ad_Hoc` / `STAT`**); **`original_scheduled_date`** + **`current_scheduled_date`** (rescheduling); **`quantity NUMERIC(8,2)`**; **`dose_number INTEGER`**; **`administration_route`**, **`administration_site`**, **`indication`** (surfaced from JSONB); remaining admin context in **`notes` JSONB**; **`deleted_at`**. **Phase 2 read path** (PR #98): detail responses now expose `documentedById` + `administeredById` (canonical) alongside legacy `completedById` (Phase 4 drop). `shifts/db.ts` filters dose counts by `documentedById` instead of `completedById`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **9b**  | **`consent_records`** (legacy)       | VIS provision + consent per clinical order — **`clinical_order_id` FK** (UNIQUE), **`encounter_id` FK**, **`patient_id` FK**; **`vis_provided`**, **`vis_date DATE`**, **`vis_version`**; **`consent_obtained`**, **`consent_by`**, **`consent_timestamp`** — independent audit trail (Philippine DPA). **Phase 2 read path** (PR #98): `scheduled_orders/db.ts` now reads from the new polymorphic **`consents`** table (`scopeRefType='clinical_order', scopeRefId=clinical_order.id`); `consent_obtained` inferred as `revokedAt IS NULL`; `consent_by` maps to `consents.consenterName`. `consent_records` remains until Phase 4 drop.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **10**  | **`transactions`**                   | **`tenant_id` FK**; **`id` bigserial PK** + **`display_id` text** (`TXN_<8 base32>`, e.g. `TXN_M3WPK7VR` — post-2026-05-19 ID redesign) is the public handle. **`receipt_no`** (text) is the BIR Official Receipt number — allocated from `tenant_counters` with `counter_kind='BIR_RECEIPT'` (tenant-wide, `branchId=null`) atomically the first time `addPaymentTx` pushes the txn to `Paid` (inline at create-time or via `POST /:id/payments`); 8-digit zero-padded; UNIQUE per `(tenant_id, receipt_no)` (text column so a BIR-registration migration can revise the format without schema change — shipped 2026-05-21 #434). **`branch_seq`** (integer, nullable) is the gapless per-branch transaction sequence, allocated from `tenant_counters` with `counter_kind='TXN'` inside `createTransaction` (#424); surfaced in `TransactionDetail` + AcknowledgementReceipt ("Branch Txn #" line). Branch, patient, encounter, dates, cashier, payer; gross/discount/VAT splits (**`NUMERIC(12,2)`**); **`discount_id_type`**, **`discount_id_number`** (BIR); status; void fields; prepayment flags; **`deleted_at`**.                                                                                                                                                                                                                                                                    |
| **10a** | **`group_bills`**                    | **2026-08-22 corporate group-billing sidecar.** **`tenant_id`**, public **`display_id`** (`GBL_<8 base32>`), one-to-one **`transaction_id`**, **`branch_id`**, **`payer_id`**, reference, and creator; tenant/branch RLS and audit apply. The linked transaction remains the sole money/payment/receipt/day-summary/void/refund engine. `group_bills` identifies the payer-owned AR position; its linked transaction is excluded from patient AR. Exact real-patient/service allocation remains in `transaction_patients`/`transaction_items`; the transaction header patient is a compatibility clinical anchor, not the debtor. No placeholder patient or proportional patient payment allocation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **11**  | **`transaction_items`**              | **`tenant_id` FK**, service, qty, **`unit_price NUMERIC(12,2)`** (sale-time snapshot), discounts, VAT flags, **`subtotal NUMERIC(12,2)`**, prepaid flags (**`prepaid_transaction_id` FK**), **`performed_by_id` FK → `users`** (attending clinician for the line — added 0016; replaces per-physician catalog rows for consultation/medcert revenue attribution). **2026-06-20 (multi-patient):** **`patient_id` FK → `patients`** (nullable; NULL ⇒ the header/primary patient) attributes a line to a patient on a family/group bill; reads `COALESCE(item.patient_id, txn.patient_id)`. Per-patient billing metadata lives in the new **`transaction_patients`** sub-header (one row per `(transaction_id, patient_id)`: `discount_id_type`/`discount_id_number` + optional `encounter_id`; bigserial-only, tenant-RLS, audited). The header `transactions.patient_id` stays the primary/bill-to patient. `transaction_items_txn_service[_no_physician]_uniq` now key on `patient_id` with `NULLS NOT DISTINCT` so two patients can take the same service on one bill. See `.claude/rules/gotchas.md` "Multi-patient transactions".                                                                                                                                                                                                                                                        |
| **12**  | **`payments`**                       | **`tenant_id` FK**, method (`payment_method` enum incl. internal **`Credit`** = patient-credit draw), **`amount NUMERIC(12,2)`**, payer, refs, dates, **`received_by_id`**, **`funded_by_transaction_id`** (source deposit when method=`Credit`; a deposit's remaining balance = `amount_paid − Σ` its funded draws — 2026-06-04)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **13**  | **`payer_profiles`**                 | **`tenant_id` FK**, HMO/corporate/gov/promo; **`payment_terms_days INTEGER`**; contacts. **Seeded 2026-07-30**: 11 profiles, the 8 originals plus `HMO` (the clinic-wide card rate), `HPPI` (anti-rabies line only) and `mWell` (platform uplift), which are the three highest-volume payer tokens in the AppSheet `Vaccine` sheet and were previously absent from both the seed and `data_migration/transform/catalog.ts`. Vaccine partner pricing is one `service_prices` row per (service, payer), 65 rows regenerated from the sheet: safe to collapse from the sheet's 271 brand x payer rows because no two brands anywhere in the export disagree on a payer price                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **14**  | **`inventory_lots`**                 | **`tenant_id` FK**, batch, **`expiry_date DATE`**, **`quantity_on_hand NUMERIC`** (≥ 0 CHECK), quarantine, branch, **`product_id` FK NOT NULL → `products`** (replaces `service_id` — dropped in 0011 so one Abhayrab vial batch can serve both Abhayrab-IM and Abhayrab-ID services); UNIQUE per **(tenant, branch, product, batch)**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **15**  | **`inventory_transactions`**         | **`tenant_id` FK**, **`movement_type` enum** (`In`/`Out`/`Adjustment`/`Transfer`/`Expire`); **`reference_type`** + **`reference_id`** (polymorphic to e.g. **`clinical_orders.id`**)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **—**   | **`inventory_transfers`** (Wave 2.3) | **`tenant_id` FK**, `source_branch_id` FK → `branches`, `destination_branch_id` FK → `branches`, `lot_id` FK → `inventory_lots`, `destination_lot_id` FK (nullable, resolved on receive), `quantity NUMERIC(12,4)`, **`status` enum** (`PendingReceipt`/`Received`/`Cancelled`), `shipped_at`, `received_at`, `cancelled_at`, `shipped_by_id`/`received_by_id`/`cancelled_by_id` FK → `users`, `notes`, `row_version`; migration 0019; RLS + audit trigger in 0019a. ID: `TRF-YYYY-XXXXXXXXXX` via `yearId('TRF')`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **16**  | **`partner_laboratories`**           | **`tenant_id` FK**, external lab config; **`api_config` JSONB**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **17**  | **`lab_orders`**                     | **`tenant_id` FK**, ties to clinical order; **`status` enum** (`Pending`/`Sent`/`ResultReceived`/`Cancelled`); **`result_data` JSONB**; `result_file_url` (legacy); `result_file_attachment_id` FK → `attachments` (Phase 2 — commit 5dab081); workflow timestamps. Both result fields are exposed on list + detail read paths; `result_file_url` remains until Phase 4 drop.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **18**  | **`audit_logs`**                     | **`tenant_id`**, user, **action**, **entity_type**, **entity_id**, **branch_id**, IP, UA, **`changes` JSONB**, **timestamp**; **monthly partitions** (implemented — 2026-01 through 2027-06 + default partition)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **19**  | **`feature_flags`**                  | **`tenant_id` FK**, optional **`branch_id`** (NULL = tenant-wide); the flag-name column is **`key`** (text, not `feature_name`), composite PK **`(tenant_id, branch_id, key)`**. **Zero readers in application code**: only `schema.ts` references the table; no route, module, or worker queries it yet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **20**  | **`notifications`**                  | **`tenant_id` FK**, SMS/email/push queue; **`status` enum** (`Queued`/`Sent`/`Failed`/`Cancelled`); delivery metadata JSONB                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **21**  | **`patient_tags`**                   | **`tenant_id` FK**, **`UNIQUE(patient_id, tag)`**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **22**  | **`approval_requests`**              | **`tenant_id` FK**, **`branch_id` FK**, **`request_type` enum** (`void_transaction`/`inventory_adjustment`/`schedule_change`/`discount_override`), **`status` enum** (`Pending`/`Approved`/`Rejected`), **`requested_by_id`**, **`reviewed_by_id`**, polymorphic **`entity_type`** + **`entity_id`**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **23**  | **`cross_branch_access_grants`**     | Cross-Branch PHI RFC Step 3 (0026). **`tenant_id` FK**, **`user_id` FK**, **`source_branch_id` FK** (where user was clocked in), **`target_branch_id` FK** (branch whose data was read), **`patient_id` FK** (required per D1), **`reason_category` CHECK enum** (`Continuity_of_care`/`Emergency`/`Patient_request`/`Quality_review`/`Other`), **`reason_detail` text**, `correlation_id`. **D1 LOCKED (2026-05-24):** persistent per-`(tenant_id, target_branch_id, patient_id)` — no re-prompting. `UNIQUE(tenant_id, target_branch_id, patient_id)`. Tenant RLS; no branch_isolation (table has two branch columns). See `docs/specs/cross-branch-phi-access.md`. **View**: `patients_demographic_v` — Tier-1 safe cross-branch projection (demographics + allergies + active conditions + DPA consent flag); RLS inherited from `patients` table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### Key Indexes (Representative)

| Index                                                                        | Intent                                                                                                                                                         |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`idx_inventory_lots_fefo`**                                                | **FEFO**: `(product_id, branch_id, expiry_date, quantity_on_hand)` **WHERE** `quantity_on_hand > 0` **AND** `NOT is_quarantined` (re-keyed to product in 0011) |
| **`clinical_orders_scheduled_idx`**                                          | Scheduled-orders worklist: PSO + status + **`current_scheduled_date`**                                                                                         |
| **`clinical_orders_tenant_encounter_idx`**                                   | `(tenant_id, encounter_id)` — all orders for an encounter (core clinical UI)                                                                                   |
| **`tx_items_clinical_order_idx`**                                            | `(clinical_order_id)` — is this order already billed?                                                                                                          |
| **`inventory_lots_batch_idx`**                                               | `UNIQUE(tenant_id, branch_id, product_id, batch_number)` — no duplicate lots (re-keyed to product in 0011)                                                     |
| **`soti_template_day_seq_idx`**                                              | `UNIQUE(template_id, day_offset, sequence)` — no duplicate protocol positions                                                                                  |
| **GIN** on **`patients.search_vector`**, **`service_catalog.search_vector`** | Full-text search                                                                                                                                               |
| **Soft-delete partial indexes**                                              | `WHERE deleted_at IS NULL` on patients, encounters, clinical_orders, service_catalog, transactions                                                             |
| **`audit_logs`**                                                             | Partition **by month** + entity/time composite indexes                                                                                                         |

### Complexity Deliberately **Not** Separate Tables

| Removed as standalone             | Replaced by                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------ |
| cross-branch access requests/logs | **`audit_logs`** + app workflow                                                |
| patient_data_change_requests      | **`audit_logs`**                                                               |
| transaction_modifications         | **`audit_logs`**                                                               |
| clinical_order_schedule_changes   | **`audit_logs`** (`original_scheduled_date` on `clinical_orders` enables diff) |
| scheduled-order schedules         | **Computed** from **`clinical_orders`**                                        |
| lab_results                       | **`lab_orders.result_data` JSONB**                                             |

---

## Schema v2 Phase 2 Read-Switchover Status (historical)

Phases 1–4 all shipped 2026-05-07; legacy columns/tables listed below are no longer in the schema. The table is kept as a record of the per-module read-path rewrites. See [`docs/handovers/archive/2026-05-01-schema-v2-phase1.md`](../handovers/archive/2026-05-01-schema-v2-phase1.md) for the original phased plan and [`gotchas.md`](../../.claude/rules/gotchas.md) "Schema v2 cutover complete" for the dropped-objects table.

| Module                                          | PR / Commit | What changed (reads)                                                                                                                                                                                                                                                                                                     | Legacy still present                                                                  |
| ----------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| **Service pricing**                             | #100        | `service_catalog/db.ts`, `transactions/db.ts`, `inventory/db.ts`, `arrivals/db.ts` resolve effective price via `apps/backend/src/shared/lib/pricing.ts` — most-specific-match `(branch, payer, segment) → (branch, payer) → (branch) → tenant-wide` against `service_prices`; falls back to `service_catalog.base_price` | `service_catalog.base_price`                                                          |
| **Patient allergies / conditions / tags**       | #99         | `patients/db.ts` `getPatient` joins `patient_allergies` + `patient_conditions` rows + `tag_definitions` (via `patient_tags.tag_definition_id`). New `GET /api/patients/:id/tags` endpoint.                                                                                                                               | `patients.allergies` JSONB, `patients.conditions` JSONB, `patient_tags.tag` free-text |
| **Consents + clinical completion**              | #98         | `scheduled_orders/db.ts` reads `consents` (polymorphic `scopeRefType=clinical_order`); `consent_obtained` inferred as `revokedAt IS NULL`. `clinical_orders/db.ts` + `shifts/db.ts` surface `documentedById` / `administeredById` as canonical completion fields.                                                        | `consent_records`, `clinical_orders.completedById`                                    |
| **Lab order attachment**                        | 5dab081     | `lab_orders/db.ts` list + detail now include `resultFileAttachmentId` (nullable FK → `attachments`) alongside legacy `resultFileUrl`.                                                                                                                                                                                    | `lab_orders.result_file_url`                                                          |
| **Audit — sessionId/correlationId**             | #104        | `audit/db.ts` list + detail surface `sessionId`, `correlationId`, `metadata`. `?sessionId=` filter added for session-scoped queries.                                                                                                                                                                                     | —                                                                                     |
| **Encounters — vitals + diagnoses**             | #116        | `encounters/db.ts` detail joins `vitals[]` + `diagnoses[]` rows. New endpoints: `GET/POST /api/encounters/:id/vitals`, `GET/POST /api/encounters/:id/diagnoses`. Detail also surfaces `dispositionCode`, `closedById`, `appointmentId`.                                                                                  | `encounters.clinical_notes` JSONB (still written; normalized rows are additive)       |
| **Patients — sub-resources**                    | #120        | `GET/POST /api/patients/:id/emergency-contacts`, `GET/POST /api/patients/:id/external-immunizations`, `GET /api/patients/:id/consents`. Reads from `emergency_contacts`, `external_immunizations`, `consents` tables.                                                                                                    | —                                                                                     |
| **Transactions — new FKs + computed**           | #112        | `transactions/db.ts` detail surfaces `amountPaid`, `amountOutstanding`, `vatRate`, `payerContractId`, `cashDrawerSessionId`, `idempotencyKey`.                                                                                                                                                                           | —                                                                                     |
| **Payer contracts**                             | #107        | `payer_profiles/db.ts` exposes `payer_contracts` sub-resource: `GET/POST/PUT /:id/contracts/:contractId`.                                                                                                                                                                                                                | —                                                                                     |
| **Service catalog — clinical codes**            | #109        | `service_catalog/db.ts` detail surfaces `cvxCode`, `ndcCode`, `cptCode`, `loincCode`, `defaultRoute`, `requiresConsent`, `visDocument`.                                                                                                                                                                                  | —                                                                                     |
| **Shifts — cash drawer session surface**        | #119        | `shifts/db.ts` response includes `cashDrawerSessionId` + `cashDrawerSession` sub-object from `cash_drawer_sessions`.                                                                                                                                                                                                     | `staff_time_logs.float_amount`, `staff_time_logs.drawer_state`                        |
| **Admin/users — roles + branches**              | #111        | `admin/users/db.ts` detail includes `roles[]` from `user_roles` and `branches[]` from `user_branches`.                                                                                                                                                                                                                   | `users.role`, `users.branch_id`                                                       |
| **Auth — role from user_roles**                 | #113        | Login reads primary role from `user_roles` (falls back to `users.role`). Lockout enforcement added.                                                                                                                                                                                                                      | `users.role`                                                                          |
| **Branch — staff/physicians via user_branches** | #106        | `branch/db.ts` staff + physicians lists read via `user_branches` join.                                                                                                                                                                                                                                                   | `users.branch_id`                                                                     |
| **Lab orders — collection/critical fields**     | #118        | `lab_orders/db.ts` list + detail surface `collectedAt`, `collectedBy`, `criticalValue`, `criticalValueNote`. New `POST /:id/ack-critical` endpoint.                                                                                                                                                                      | —                                                                                     |
| **Admin/claims**                                | #121        | New `admin/claims` sub-router; `GET/POST /api/admin/claims`, status history sub-resource.                                                                                                                                                                                                                                | —                                                                                     |
| **Inventory** (PENDING)                         | #114        | `inventory/db.ts` reads via `inventory_movements` + `lot_balances`. **PR #114 is open — not yet merged.**                                                                                                                                                                                                                | `inventory_transactions`, `inventory_lots`                                            |

---

## Schema v2 Phase 3 Write-Switchover Status

Phase 3 stops writing to old columns/tables and writes only to the new shape. Old columns/tables remain until Phase 4 drops them. Merged to `main` as of 2026-05-05:

| Module                                        | PR   | What changed (writes)                                                                                                                                      | Old write path (now dropped)                                   |
| --------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Admin/users — dual-write roles/branches**   | #127 | `PATCH /api/admin/users/:id` writes role changes to `user_roles` and branch changes to `user_branches` in the same transaction.                            | `users.role`, `users.branch_id` (still present, Phase 4 drop)  |
| **Service catalog — dual-write prices**       | #126 | `POST/PATCH /api/services` dual-writes a tenant-wide `service_prices` row in the same transaction as the `service_catalog` write.                          | `service_catalog.base_price` (still present, Phase 4 drop)     |
| **Transactions — Idempotency-Key**            | #123 | Transaction create + payment endpoints consume `Idempotency-Key` middleware and deduplicate writes.                                                        | N/A (new capability)                                           |
| **Scheduled orders — consent capture**        | #122 | `POST /api/scheduled-orders/:id/administer` writes consent to `consents` table (drops `consent_records` write).                                            | `consent_records`                                              |
| **Cash drawer lifecycle**                     | #128 | `POST /clock-in` creates a `cash_drawer_sessions` row for cashier-role users; `POST /clock-out` closes it.                                                 | `staff_time_logs.float_amount`, `staff_time_logs.drawer_state` |
| **Inventory movements** (PENDING)             | #132 | `POST /api/scheduled-orders/:id/administer` will write to `inventory_movements` instead of `inventory_transactions`. **PR #132 is open — not yet merged.** | `inventory_transactions`                                       |
| **Patients allergies/conditions** (PENDING)   | W32  | `POST /api/patients` will stop writing to `patients.allergies`/`conditions` JSONB. **W32 not yet merged.**                                                 | `patients.allergies`, `patients.conditions` JSONB              |
| **Standing orders is_locked** (PENDING)       | W33  | Template lock enforcement + copy-on-write versioning. **W33 not yet merged.**                                                                              | In-place template mutation                                     |
| **Amount paid/outstanding trigger** (PENDING) | #136 | DB trigger to keep `transactions.amount_paid` + `amount_outstanding` in sync. **PR #136 is open — not yet merged.**                                        | Application-level computation at query time                    |

**Open-drawer invariant hardening (PR #616, pending merge):**
`0011_cash_drawer_branch_invariant.sql` adds a partial unique index on
`(tenant_id, branch_id) WHERE state = 'Open'`. Drawer
ownership is physical and branch-wide, not per user. The forward migration does
not auto-close or choose among pre-existing duplicates; it fails so an
accountable financial operator can correct history before deployment. Current
drawer lookup, payments, and deposits deterministically use the same oldest
Open branch session across Manila-day rollover.

---

## Schema v2 Phase 4 Enforcement Status

Phase 4 adds DB-layer enforcement for invariants that were previously
app-only. Migrations 0017–0023:

| Area                                             | Migration | What it does                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Polymorphic FK hardening                         | 0017      | `inventory_transactions.reference_type/_id`, `consents.scope_ref_type/_id`, `attachments.owner_type/_id` get type allow-list CHECK + non-empty pair CHECK. `audit_logs.entity_type` stays polymorphic by design (documented).                                                                                                                       |
| Status-history composite FKs                     | 0017      | All 7 `*_status_history` tables: `(tenant_id, entity_id) → parent(tenant_id, id) ON DELETE CASCADE`.                                                                                                                                                                                                                                                |
| Phase-4 columns                                  | 0017a     | `adverse_events.lot_id` (FK → inventory_lots), `inventory_lots.remaining_volume_ml` (ID-route fractional dose), `deleted_at` on `payer_profiles`/`partner_laboratories`/`standing_order_template_items`/`approval_requests`/`approval_decisions`/`claim_items`.                                                                                     |
| Display-ID format CHECKs (closeout)              | 0018      | Enables CHECK on `notification_templates`, `consents` (deferred from 0009 with stale rationale; both pass current data). Relaxes `service_catalog_id_format` to allow optional tenant prefix (`TEN-….SVC-…`) used by post-#204 seed.                                                                                                                |
| Immutability-trigger attachment                  | 0019      | Attaches `reject_immutable_update_except_void()` to `transactions` and `reject_immutable_update()` to `clinical_orders` (functions defined in 0014/0015/0016).                                                                                                                                                                                      |
| Status-history CHECK + transaction_items uniques | 0020      | Each `*_status_history.to_status` (and `from_status`) CHECK-bounded to its parent enum's literal values. `transaction_items` gets `UNIQUE(tenant_id, transaction_id, service_id)` + partial unique on `(tenant_id, transaction_id, clinical_order_id)`.                                                                                             |
| Audit redaction extension                        | 0021      | `audit_log_changes()` strips `notes`, `specialty_data`, `clinical_notes`, `symptoms_coded`, `result_data`, `onboarding_data` from `audit_logs.changes` (in addition to the PII set already stripped).                                                                                                                                               |
| Audit-partition runway                           | 0022      | Bumps `create_next_audit_partitions(months_ahead)` runway to 12 months and (if `pg_cron` extension is present) auto-schedules monthly maintenance. Without `pg_cron`, ops must run `CALL create_next_audit_partitions(6);` monthly via Railway cron / GitHub Actions.                                                                               |
| `amount_outstanding` GENERATED                   | 0023      | Drops the trigger-driven column and re-adds as `GENERATED ALWAYS AS (GREATEST(net_amount - amount_paid, 0)) STORED`. Removes a class of drift bugs. Direct UPDATE on the column raises; `sync_transaction_amounts` trigger now updates only `amount_paid`.                                                                                          |
| Dual-write table drop                            | 0024      | Drops `inventory_transactions`, `consent_records`, legacy `users.role`/`branch_id`, `service_catalog.base_price`, `patients.allergies`/`conditions` and all related legacy columns. Schema is now v2-only.                                                                                                                                          |
| Modern PG features (Wave 2B)                     | 0025      | **CITEXT** on `users.email` + `patients.email` (case-insensitive uniqueness). `patients.full_name` GENERATED column + **pg_trgm GIN** index for fuzzy name search. **tstzrange EXCLUDE** on `appointments` prevents provider double-booking. Partial UNIQUE on `patients (tenant_id, mrn) WHERE deleted_at IS NULL`. COMMENT ON TABLE for 7 tables. |

Deferred Phase 4 items (still open):

- ~~Exclusion constraints on `service_prices` (overlapping daterange)~~ — landed as `service_prices_no_overlap` in `0005_modern_pg.sql`, keyed on `(tenant, service, COALESCE(branch,0), COALESCE(payer,0), COALESCE(product,0), COALESCE(segment,'__ALL__'), daterange)`. `product_id` joined the key on 2026-07-25 so a brand-specific price can coexist with the brand-agnostic row over the same range.
- `NOT NULL` on remaining backfilled columns (`patient_tags.tag_definition_id`, `inventory_lots.manufacturer/unit_cost`, `notifications.recipient_address`, `clinical_orders.patient_id`).
- Drop of deprecated columns/tables (`users.role`, `users.branch_id`, `service_catalog.base_price`, `patients.allergies`/`conditions`, `consent_records`, `inventory_transactions`, etc.) — pending Phase 3 write-switchover completion across all consumers.

---

## Phase 5 New Tables In Use

| Table            | PR   | Status                | Notes                                                                                                                                                                                                       |
| ---------------- | ---- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `phi_access_log` | #125 | Active                | Rows written for every `GET /api/patients/:id` read. Captures `userId`, `patientId`, `tenantId`, `branchId`, `ipAddress`, `userAgent`, `accessedAt`. Scope limited to patient detail reads in Phase 5.      |
| `domain_events`  | #124 | Gated                 | Rows written by service layer inside transactions. Publisher worker (`src/workers/domainEventsPublisher.ts`) polls for `Pending` rows; **gated on `WORKERS_ENABLED=true`** env var — not active by default. |
| `analytics.*`    | #129 | Schema only (PENDING) | Analytics fact/dim/rollup tables + `dim_date` seed created. **PR #129 is open — no refresh worker yet.**                                                                                                    |

### Biting-animal observation model (migration 0017, 2026-05-18)

| Table                          | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bite_incidents`               | First-class entity capturing exposure facts at intake (species, exposure category, bite site, animal vaccination status, etc.). PK via `yearId('BIT')`. Tenant-scoped, RLS-enabled, audit-triggered. `requiresObservation=true` default triggers followup creation. `metadata jsonb` for SOP-driven free facts.                                                                                                                                                                                                                 |
| `animal_observation_followups` | One Day-14 followup task per bite incident, auto-created at intake (`childId(incidentId,'OBS')`). `Pending` means no final outcome has been recorded; overdue status is derived from the patient's first ARV date plus 14 full calendar days. `DiedUnknownCause` preserves a generic source value of "Dead" without inventing a cause or FAT result. Only `AliveHealthy` or `DiedNaturally` + `fatTestResult=Negative` calls `cancelDay28ArvPepForPatient()` in `scheduled_orders/db.ts`; `DiedUnknownCause` never cancels PEP. |

New enums: `bite_species`, `animal_vaccination_status`, `exposure_category`, `animal_outcome`, `fat_test_result`.

### Catalog / Inventory product abstraction (migrations 0010 + 0011, 2026-05-16)

| Table                  | Purpose                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `products`             | Physical SKU (Abhayrab, Speeda, Vaxigrip Tetra, …). `inventory_lots.product_id` and `service_catalog.product_id` both reference it. **One Abhayrab vial batch = one lot**, shared by every service variant that uses that product (Abhayrab-IM and Abhayrab-ID). FEFO + maintain_lot_balances key on product_id post-0011.                   |
| `service_categories`   | Hierarchical grouping (Vaccines → Anti-Rabies → PEP, …) with self-FK `parent_id`. Replaces the freeform `service_catalog.category` text column (dropped 0011). Name-unique within `(tenant, parent)` via COALESCE-based partial index. Seed auto-derives flat (no-parent) categories from existing rows; hierarchy is a follow-up UI.        |
| `service_bundle_items` | Composition of a bundle catalog row (lab panels SV01–SV23, …). Bundle stays the billable unit in `service_catalog` + `service_prices`; this table enumerates constituents. CHECK guards: `bundle_service_id <> item_service_id`, `quantity > 0`. Constituents expand to `lab_orders` rows at order time (service layer, not enforced at DB). |

Also added by 0010/0011:

- `administration_route` enum gained **`INF`** (wound infiltration, for ERIG/HRIG).
- `service_catalog.requires_dose_calculation boolean` — UI prompts a weight-based calculator instead of accepting `defaultDoseVolumeMl` (ERIG / HRIG / HTIG / ATS).
- `product_recalls.service_id` renamed to `product_id` (FK → `products`) — recalls are scoped by physical SKU, not by service variant.
- `service_catalog.category` text **dropped**; `category_id` FK is the truth. `service_catalog_search_vector_update()` no longer references the text column (name + code only).
- `inventory_lots.service_id` and `inventory_lot_balances.service_id` **dropped**; both now key on `product_id NOT NULL`. Consumer joins (`inventory/db.ts`, `dashboard/db.ts`, `arrivals/db.ts`, `product_recalls/db.ts`) JOIN through `products` instead of `service_catalog`. deduction helpers in `inventory/fefo.ts` (`deductLot`, `pickEarliestExpiringLot`) accept the same `serviceId` argument and resolve eligible products through `eligibleProductIdsSql` so callers don't change.

---

## JSONB Structure Reference (Implementation-Critical)

### `encounters.specialty_data` — Rabies

```jsonb
{
  "incident_date": "2026-03-09",
  "source_of_concern": "Stray dog bite on right arm, unprovoked",
  "animal_type": "Dog",
  "animal_ownership": "Stray",
  "animal_vaccination_status": "Unknown",
  "animal_behavior": "Unprovoked",
  "animal_status": "Unknown",
  "animal_observation_start": "2026-03-09",
  "animal_observation_end": "2026-03-23",
  "animal_observation_result": null,
  "bite_category": "III",
  "bite_location": "Right forearm, 3cm laceration",
  "bite_severity": "Moderate",
  "wound_type": "Bite",
  "incident_location": "Street corner near home",
  "incident_barangay": "Barangay 1",
  "incident_city": "Quezon City",
  "incident_province": "Metro Manila",
  "is_repeat_exposure": false,
  "previous_pep_completed": null,
  "previous_pep_date": null
}
```

### `encounters.specialty_data` — General/Flu/Vaccination

```jsonb
{
  "chief_complaint": "Fever and cough for 3 days",
  "symptoms": ["Fever", "Cough", "Fatigue"],
  "duration_days": 3,
  "severity": "Moderate",
  "vaccine_type": "Quadrivalent",
  "high_risk_group": true,
  "risk_factors": ["Elderly", "Chronic_Disease"]
}
```

### `encounters.clinical_notes` — Vitals & SOAP

```jsonb
{
  "vitals": {
    "bp_systolic": 120, "bp_diastolic": 80,
    "temperature_c": 37.2, "heart_rate": 72,
    "respiratory_rate": 16, "weight_kg": 65, "height_cm": 170
  },
  "soap": {
    "subjective": "Patient reports dog bite 2 hours ago",
    "objective": "3cm laceration on right forearm, bleeding controlled",
    "assessment": "Category III dog bite, stray, unknown vaccination status",
    "plan": "Wound cleaning, ERIG, ARV PEP 4-dose (Day 0/3/7/14), TT booster"
  },
  "allergies_confirmed": ["None"],
  "medications_given": ["Paracetamol 500mg PO"],
  "discharge_instructions": "Return Day 3 for 2nd ARV dose"
}
```

### `clinical_orders.notes` — Remaining Administration Context

Consent, route, site, dose_number, indication are now **first-class columns** on `clinical_orders`. Only needle-level detail and adverse events remain in JSONB:

```jsonb
{
  "administration": {
    "volume_ml": 0.5,
    "needle_gauge": "23G",
    "needle_length": "1 inch"
  },
  "adverse_events": {
    "immediate_reaction": false,
    "observation_period_minutes": 15,
    "reaction_type": null,
    "notes": "No adverse reaction observed"
  }
}
```

### `audit_logs.changes` — Cross-Branch Access Request

```jsonb
{
  "request_type": "cross_branch_access",
  "patient_id": "PAT-K9MX3VQ2P5", "patient_home_branch": "Cainta",
  "requesting_branch": "Antipolo", "reason": "Emergency dose needed",
  "status": "Approved", "approved_by": "USR-A8K3M9X2P5",
  "access_granted_until": "2026-03-10T18:00:00Z"
}
```

### `audit_logs.changes` — Transaction Modification

```jsonb
{
  "modification_type": "payment_method_change",
  "transaction_id": "TXN-2026-K9MX3VQ2P5",
  "old_value": {"method": "Cash", "amount": 5000},
  "new_value": {"method": "GCash", "amount": 5000, "reference": "GC-123456"},
  "reason": "Patient requested change",
  "requested_by": "USR-A8K3M9X2P5", "approved_by": "USR-Q2P5W7K9MX"
}
```

### `audit_logs.changes` — Missed Dose Recalculation

```jsonb
{
  "change_type": "missed_dose_recalculation",
  "clinical_order_id": "PAT-K9MX3VQ2P5.ENC-2026-A8K3M9.ORD-Q2P5W7",
  "old_scheduled_date": "2026-03-12",
  "new_scheduled_date": "2026-03-14",
  "delay_days": 2,
  "reason": "Patient arrived late",
  "affected_orders": ["PAT-….ORD-AAAAA1", "PAT-….ORD-AAAAA2", "PAT-….ORD-AAAAA3"]
}
```

---

## Key Operational SQL Queries

### Standing Order Progress (with payment status)

`standing_order_template_items` replaces the former `CROSS JOIN LATERAL jsonb_array_elements(protocol_items)` pattern:

```sql
SELECT
  soti.day_offset,
  soti.sequence,
  sc.name AS service_name,
  co.status,
  co.dose_number,
  co.original_scheduled_date,
  co.current_scheduled_date,
  co.completed_at,
  CASE
    WHEN ti.is_prepaid = TRUE THEN 'Prepaid'
    WHEN t.status = 'Paid' THEN 'Paid'
    ELSE 'Unpaid'
  END AS payment_status
FROM patient_standing_orders pso
JOIN standing_order_template_items soti ON soti.template_id = pso.template_id
JOIN clinical_orders co
  ON co.patient_standing_order_id = pso.id
 AND co.service_id = soti.service_id
 AND co.dose_number = soti.sequence
JOIN service_catalog sc ON sc.id = co.service_id
LEFT JOIN transaction_items ti ON ti.clinical_order_id = co.id
LEFT JOIN transactions t ON t.id = ti.transaction_id
WHERE pso.id = :standing_order_id
ORDER BY soti.day_offset, soti.sequence;
```

### Patient Bite History (All Rabies Incidents)

```sql
SELECT
  e.started_at::date AS incident_date,
  e.specialty_data->>'animal_type' AS animal_type,
  e.specialty_data->>'bite_category' AS bite_category,
  e.specialty_data->>'bite_location' AS bite_location,
  e.specialty_data->>'animal_status' AS animal_status,
  pso.status AS pep_status,
  COUNT(co.id) FILTER (WHERE co.status = 'Completed') AS doses_completed,
  COUNT(co.id) AS total_doses
FROM encounters e
LEFT JOIN patient_standing_orders pso ON pso.initiating_encounter_id = e.id
LEFT JOIN clinical_orders co ON co.patient_standing_order_id = pso.id
WHERE e.patient_id = :patient_id AND e.specialty = 'Rabies'
GROUP BY e.id, e.started_at, e.specialty_data, pso.status
ORDER BY e.started_at DESC;
```

### Animal Observation Tracking (14-Day Follow-Up)

```sql
SELECT
  p.first_name || ' ' || p.last_name AS patient_name,
  p.contact_number,
  e.specialty_data->>'animal_type' AS animal_type,
  (e.specialty_data->>'animal_observation_end')::date AS observation_end,
  e.specialty_data->>'animal_observation_result' AS observation_result,
  CASE
    WHEN e.specialty_data->>'animal_observation_result' = 'Healthy' THEN 'Can discontinue PEP'
    WHEN e.specialty_data->>'animal_observation_result' IS NULL
         AND (e.specialty_data->>'animal_observation_end')::date < CURRENT_DATE THEN 'Overdue for follow-up'
    WHEN e.specialty_data->>'animal_observation_result' IS NULL THEN 'Observation in progress'
    ELSE 'Continue PEP'
  END AS recommendation
FROM encounters e
JOIN patients p ON p.id = e.patient_id
WHERE e.specialty = 'Rabies'
  AND (e.specialty_data->>'animal_observation_end')::date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY (e.specialty_data->>'animal_observation_end')::date;
```

### Vaccine Administration Report (surfaced columns)

```sql
SELECT
  co.dose_number,
  co.administration_route,
  co.administration_site,
  co.indication,
  co.completed_at,
  cr.consent_obtained,
  cr.consent_by,
  cr.vis_date,
  sc.name AS service_name,
  u.first_name || ' ' || u.last_name AS administered_by
FROM clinical_orders co
JOIN service_catalog sc ON sc.id = co.service_id
LEFT JOIN consent_records cr ON cr.clinical_order_id = co.id
LEFT JOIN users u ON u.id = co.completed_by_id
WHERE co.patient_standing_order_id = :standing_order_id
  AND co.status = 'Completed'
ORDER BY co.dose_number;
```

### Epidemiological Tracking (Bite Incidents by Location)

```sql
SELECT
  e.specialty_data->>'incident_city' AS city,
  e.specialty_data->>'incident_barangay' AS barangay,
  COUNT(*) AS total_bites,
  SUM(CASE WHEN e.specialty_data->>'bite_category' = 'III' THEN 1 ELSE 0 END) AS category_3,
  SUM(CASE WHEN e.specialty_data->>'animal_type' = 'Dog' THEN 1 ELSE 0 END) AS dog_bites,
  SUM(CASE WHEN e.specialty_data->>'animal_ownership' = 'Stray' THEN 1 ELSE 0 END) AS stray_animals
FROM encounters e
WHERE e.specialty = 'Rabies' AND e.started_at >= :start_date
GROUP BY e.specialty_data->>'incident_city', e.specialty_data->>'incident_barangay'
ORDER BY total_bites DESC;
```

---

## Standing Orders — Canonical Flow

| Step  | Actor / System | Effect                                                                                                                  |
| ----- | -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **1** | Admin          | Creates **`standing_order_templates`** with line items in **`standing_order_template_items`** (service_id FK enforced)  |
| **2** | Physician      | Orders template for patient → **`patient_standing_orders`** row                                                         |
| **3** | System         | Reads **`standing_order_template_items`** → generates **`clinical_orders`** per item (copies dose_number from sequence) |
| **4** | Data model     | Each **`clinical_orders.patient_standing_order_id`** links back to active protocol                                      |
| **5** | Versioning     | **Template updates do not mutate** existing patient standing orders or issued clinical_orders                           |

---

## Schema Improvements — Applied vs Planned

| Category              | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Applied**           | Fractional inventory (NUMERIC); soft deletes; richer vaccine admin context in `clinical_orders` columns; **`standing_order_template_items`** table (FK integrity on service_id); **`consent_records`** table (DPA-compliant consent); `dose_number`, `administration_route`, `administration_site`, `indication`, `original_scheduled_date`, `quantity` surfaced on `clinical_orders`; `sex`, `movement_type`, `lab_order_status`, `notification_status` enums; `DATE` type for DOB and expiry; `INTEGER` for version and payment_terms; `email` unique per tenant (not globally); **tiered text display IDs replace UUIDs** — receipt number is the transaction's own `id`; `created_by_id` FK on all tables; `prepaid_transaction_id` FK; `transactions.deleted_at`; CHECK constraints on quantities and amounts; RLS `WITH CHECK` on all tenant tables; `audit_logs` monthly partitioned; soft-delete partial indexes |
| **Future (additive)** | `cold_chain_logs`, `appointments`, `diagnoses`, `prescriptions`, `queue_entries`, `adverse_events` (standalone table), `daily_metrics`, future partition maintenance cron                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Rule**              | **All enhancements additive** — **no breaking** migrations without explicit program                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

---

## RLS Implementation

### Model Choice (EMR Multi-Tenancy)

| Model                              | Trait                                               | SureVax                |
| ---------------------------------- | --------------------------------------------------- | ---------------------- |
| **Pool** (shared schema + **RLS**) | Cost-efficient; **risk** if session context dropped | **Selected — Phase 1** |
| **Bridge** (schema/tenant)         | Isolation ↑; drift ↓                                | Not Phase 1            |
| **Silo** (DB-per-tenant)           | Strongest isolation; cost ↑                         | **Phase 2** evaluation |

### Requirements

| Topic                | Rule                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Isolation axis**   | **`tenant_id` is the Day 1 absolute boundary** for all tenant-scoped tables; **`branch_id` is operational scope only** — policies must **deny by default** |
| **Session context**  | **`SET LOCAL`** per-transaction vars (at minimum: `app.current_user_id`, `app.current_tenant_id`, optional `app.current_branch_id`) **before** queries     |
| **Defense in depth** | RLS **+** application checks — **never** "RLS OR app," **always** **RLS AND app**                                                                          |
| **Write isolation**  | All policies include **`WITH CHECK`** — cross-tenant INSERTs/UPDATEs are blocked at DB level, not just reads                                               |
| **Cross-branch**     | Logged actions (**`CROSS_BRANCH_ACCESS`**, **`audit_logs`**)                                                                                               |

### Policy Pattern

| Layer                        | Responsibility                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| **`USING`**                  | Controls SELECT, UPDATE (existing row), DELETE — requires `tenant_id = app.current_tenant_id` |
| **`WITH CHECK`**             | Controls INSERT, UPDATE (new row values) — same constraint, prevents cross-tenant writes      |
| **Append-only `audit_logs`** | Restrictive UPDATE and DELETE policies (always false)                                         |

---

## Audit Trail Architecture

### Generic `audit_logs`

| Column / Aspect                      | Role                                                                                                                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`user_id`**                        | **Who**                                                                                                                                                                                                    |
| **`action`**                         | **What** class: `CREATE`, `READ`, `UPDATE`, `DELETE`, `LOGIN`, `LOGOUT`, `CROSS_BRANCH_ACCESS`, `TRANSACTION_MODIFY`, `SCHEDULE_CHANGE`                                                                    |
| **`entity_type`**, **`entity_id`**   | **What** record                                                                                                                                                                                            |
| **`branch_id`**                      | Scope                                                                                                                                                                                                      |
| **`timestamp`**                      | **When**                                                                                                                                                                                                   |
| **`changes` JSONB**                  | **`before` / `after`** full row payloads                                                                                                                                                                   |
| **Partitioning**                     | **Monthly** partitions — 2026-01 through 2027-06 pre-created; default partition for overflow; add future partitions at deployment                                                                          |
| **Generation mechanism (mandatory)** | **Database-level PostgreSQL `AFTER INSERT/UPDATE/DELETE` triggers** populate `audit_logs` — **never** app-only middleware logging                                                                          |
| **Actor propagation**                | Application sets **`SET LOCAL app.current_user_id = '<display-id>'`** (e.g. `USR-K9MX3VQ2P5`; same for tenant/branch) inside transaction; trigger reads session vars (text — no `::uuid` cast) for **who** |
| **No-op skip**                       | Trigger skips UPDATE when `to_jsonb(OLD) = to_jsonb(NEW)` — no spurious audit rows                                                                                                                         |

### DPA Alignment

| Requirement    | Mapping                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------- |
| Accountability | **`user_id`** + immutable **timestamp**                                                            |
| Integrity      | Append-oriented log; restricted UPDATE/DELETE on `audit_logs` itself                               |
| Traceability   | **`changes`** captures full before/after for state reconstruction                                  |
| Consent        | **`consents`** (Phase 2) — polymorphic consent table; **`consent_records`** (legacy, Phase 4 drop) |

---

## Philippine DPA Compliance Rules

| Instrument                      | Key Rule                                                                                                                                                                                                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Data Privacy Act (RA 10173)** | Health records = **Sensitive Personal Information (SPI)**; processing **prohibited** unless **lawful basis** — **explicit consent** or **life/health** protection exception                                                                                                                  |
| **NPC Circular 2023-06**        | **AES-256** at **rest** and **in transit**; **RBAC**; **PIA**; **BCP**; **72-hour** breach notification — at-rest control register documented in [`docs/compliance/dpa-controls.md`](../compliance/dpa-controls.md) (Railway-managed AES-256 disk encryption + R2 SSE-S3 adopted 2026-05-21) |
| **Retention**                   | See **Data Retention Schedule** below                                                                                                                                                                                                                                                        |
| **Secure disposition**          | **Cryptographic erasure** — ordinary delete **insufficient** for SPI retirement                                                                                                                                                                                                              |

---

## BIR POS Requirements

| Topic                    | Rule                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **SC/PWD discount math** | **Strip 12% VAT first**, then apply **20%** discount on VAT-exclusive amount                                  |
| **ID capture**           | **OSCA / PWD ID** on receipt — maps to **`discount_id_type`**, **`discount_id_number`** on **`transactions`** |
| **E-journal**            | **Immutable** electronic journal of sales — design POS posting to **append-only** financial facts             |

---

## Data Retention Schedule

| Record Class      | Retention Anchor                                                                |
| ----------------- | ------------------------------------------------------------------------------- |
| **Outpatient**    | **10 years** from **last consultation**                                         |
| **Inpatient**     | **15 years**                                                                    |
| **Medico-legal**  | **25 years** **or** **7 years** post case resolution (whichever policy governs) |
| **Consent forms** | Same as **associated clinical record** (`consent_records` → `clinical_orders`)  |

> **Implementation note**: enforce via **scheduled jobs** + **legal hold** flags — **not** ad-hoc deletes.

---

## PIDSR / NaRIS Requirements

| System                             | Obligation                                                            | Capture (Conceptual)                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **PIDSR** (RA 11332)               | **Notifiable diseases** — **Category I** = **immediate** notification | Condition codes, onset, facility, patient identifiers per DOH rules                                   |
| **NaRIS (ABTC)**                   | Animal bite registry                                                  | **WHO category**, wound site, animal status, **PEP** compliance                                       |
| **SCIV / FHIR** (PhilHealth / DOH) | **HL7 FHIR** — **Philippine Core** IG                                 | Export/interop layer; map **`encounters`**, **`clinical_orders`**, **`lab_orders`** to FHIR resources |

---

## EMR Patterns (Reference)

| Pattern                                            | Use in SureVax                                                                                                                                                                                            |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Class-table inheritance** (catalog polymorphism) | **`service_catalog.service_type`** + typed JSON where needed — avoid exploding tables prematurely                                                                                                         |
| **FEFO**                                           | **Ordering convention**, not an automatic pick (2026-07-25) — the dose lot is chosen by the nurse; the index-backed earliest-expiry query orders the picker and still drives point-of-sale bundle fan-out |
| **Immutable double-entry** (financial ledger)      | **Decouple** clinical facts from **posting**; **`transactions`** / items reflect **point-in-sale** snapshots                                                                                              |

### Data Dictionary Cross-Refs

| Concept                                                    | Schema home                                                                  |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Administration context** (route, site, dose, indication) | **`clinical_orders`** columns (first-class)                                  |
| **Remaining admin detail** (volume, needle)                | **`clinical_orders.notes` JSONB**                                            |
| **Consent** (VIS, consent_by, timestamp)                   | **`consents`** table (Phase 2); **`consent_records`** (legacy, Phase 4 drop) |
| **BIR discount ID**                                        | **`transactions.discount_id_type`**, **`discount_id_number`**                |
| **Price at sale**                                          | **`transaction_items.unit_price`** (historical integrity)                    |
| **AR on account**                                          | **`payments.payer_id`**, **`payer_profiles`**                                |
| **Inventory link**                                         | **`inventory_transactions.reference_id`** → e.g. **`clinical_orders.id`**    |
| **Protocol structure**                                     | **`standing_order_template_items`** table (FK-safe, queryable)               |

---

## Zod as Single Source of Truth

| Layer               | Practice                                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Package**         | **`packages/shared`** exports **Zod** schemas + inferred **TypeScript** types                                                                         |
| **API**             | Request/response validation **=** same schemas                                                                                                        |
| **DB**              | Drizzle models **mirror** constraints; **Zod** remains **authoritative** for **business rules**                                                       |
| **Standing orders** | Validate **`standing_order_template_items`** array shape before persist                                                                               |
| **Consent**         | Validate **`consent_records`** insert (consent_obtained required, consent_timestamp required)                                                         |
| **Money / qty**     | App types: **decimal string / branded decimal**; DB types: currency columns must be **`NUMERIC(12,2)`** — **never** `REAL`/`FLOAT`/`DOUBLE PRECISION` |

---

## Compliance Invariants

1. **RLS enabled** on all **tenant-scoped** tables with **`tenant_id` as mandatory boundary** — both `USING` (reads) and `WITH CHECK` (writes).
2. **SPI** encrypted **AES-256** **at rest** and **in transit**; secrets **not** in repo.
3. **Every** mutating clinical/financial action **audited via DB triggers** — PostgreSQL `AFTER INSERT/UPDATE/DELETE` writes to **`audit_logs`** (app sets actor via `SET LOCAL`).
4. **`changes` JSONB** must support **old/new** reconstruction for regulated fields.
5. **Soft delete only** (**`deleted_at`**) for governed entities — **hard delete** only via **cryptographic erasure** / **retention job**.
6. **Standing order templates** **never** retroactively rewrite active **`patient_standing_orders`** or issued **`clinical_orders`**.
7. **Lot selection for a dose is the nurse's** (`administerBody.lotId` required, 2026-07-25); the server **enforces eligibility** (product satisfies the service), **branch**, **expiry**, **quarantine**, and **quantity** on the named lot. Automatic earliest-expiry selection remains only for point-of-sale bundle fan-out.
8. **BIR** SC/PWD: **VAT strip → discount** order; **IDs** persisted on **`transactions`**.
9. **PIDSR / NaRIS / FHIR** exports must be **traceable** (user + timestamp in **`audit_logs`**).
10. **Zod** is the **contract** for inputs; DB is **enforcement** — **no** duplicate divergent validation rules.
11. **Consent records** (`consents` table, Phase 2) must exist for every completed vaccine administration — enforced at application layer with Zod. `consent_records` is the legacy equivalent (Phase 4 drop).
