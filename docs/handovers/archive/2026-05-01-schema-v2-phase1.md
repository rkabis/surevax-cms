# Handover: Schema v2 Phase 1 — 2026-05-01

> Historical reference for the schema v2 redesign. The dual-write cutover is
> complete; this doc is preserved for the migration narrative.
>
> Authoritative target schema: [`docs/specs/schema-v2-redesign.md`](../specs/schema-v2-redesign.md)

---

## 1. Status as of 2026-05-07 (Phase 4 cutover complete + migrations squashed)

**Phase 1 (additive) shipped 2026-05-01. Phase 4 (drop dual-write tables/columns) shipped 2026-05-07. The transitional 32-file migration sequence was consolidated into a clean 8-file baseline the same day in [#228](https://github.com/njvil/surevax-cms-revamp/pull/228).** The dual-write pairs in §1.x below are now collapsed — only the new shape exists in the DB and code. There is no longer a Phase 1 backfill SQL: the old `0005_phase1_backfill.sql` (and the matching exemption migrations 0015/0017a) were dropped because the source columns/tables they targeted no longer exist in `schema.ts`. Re-running `pnpm setup --force` against a freshly-cutover DB applies one Drizzle migration plus seven hand-authored supplemental files; see `apps/backend/drizzle/` for the post-squash file set and `apps/backend/src/shared/db/migrate.ts` for the apply order.

Original Phase-1-only narrative is preserved below for the migration history.

### What Phase 1 did

- Added nullable/defaulted columns to existing tables — no behavior change.
- Created new empty tables and backfilled several from existing data.
- Attached new triggers in "shadow mode" (they fire, but no existing code reads
  their output).
- No module code changed. Every existing endpoint works exactly as before.

### Parallel-state inventory

The following old/new pairs now coexist. Both are valid; existing code uses the
old side. Phase 2 PRs switch reads; Phase 3 PRs switch writes; Phase 4 drops
the old side.

| Old (current code uses)                         | New (Phase 2+ should use)                                                 | Notes                                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `inventory_transactions` (table)                | `inventory_movements` (table)                                             | Backfilled: every row copied. Rename deferred to Phase 4.                                                                                     |
| `consent_records` (table)                       | `consents` (table)                                                        | Backfilled: copied with `consent_type='Vaccination'`, `scope='SingleOrder'`. Generalized for more types.                                      |
| `users.role` (single text enum)                 | `user_roles` (junction table)                                             | Backfilled: one row per user. Multi-role supported from Phase 2.                                                                              |
| `users.branch_id` (single FK)                   | `user_branches` (junction table) + `users.primary_branch_id` (UI default) | Backfilled: one row per user who had a branch. `primary_branch_id` set from `branch_id`.                                                      |
| `service_catalog.base_price`                    | `service_prices` (table)                                                  | Backfilled: one row per service, `branch_id=NULL`, `payer_id=NULL`, `effective_from='-infinity'`.                                             |
| `staff_time_logs.float_amount` / `drawer_state` | `cash_drawer_sessions` (table)                                            | Backfilled for shifts with drawer activity.                                                                                                   |
| `clinical_orders.completed_by_id`               | `documented_by_id` + `administered_by_id`                                 | `documented_by_id` is a mirror of `completed_by_id` in Phase 1. Phase 2 must clarify the semantic split (see §7).                             |
| `patients.allergies` (jsonb array)              | `patient_allergies` (rows)                                                | Backfilled: one row per array entry, `source='PatientReported'`.                                                                              |
| `patients.conditions` (jsonb array)             | `patient_conditions` (rows)                                               | Backfilled: same pattern as allergies.                                                                                                        |
| `patient_tags.tag` (free text)                  | `patient_tags.tag_definition_id` (FK to `tag_definitions`)                | `tag_definitions` backfilled from distinct tag values. `tag_definition_id` set by lookup. Column is nullable in Phase 1; NOT NULL in Phase 4. |
| `lab_orders.result_file_url` (text URL)         | `lab_orders.result_file_attachment_id` (FK to `attachments`)              | Parallel for Phase 1. Phase 4 drops `result_file_url`.                                                                                        |

### New tables with no Phase 1 data (net-new)

These tables exist and have RLS/audit trigger attached but are empty until Phase 2+ code writes to them:

`locations`, `appointments`, `attachments`, `claims`, `claim_items`, `claim_status_history`, `phi_access_log`, `domain_events`, `payer_contracts`, `notification_templates`, `approval_decisions`, `product_recalls`, `patient_emergency_contacts`, `patient_external_immunizations`, `encounter_vitals`, `encounter_diagnoses`, `adverse_events`, `password_reset_tokens`, `user_sessions`, `clinical_order_schedule_changes`, `patient_standing_orders_status_history`, `clinical_orders_status_history`, `encounters_status_history`, `transactions_status_history`, `lab_orders_status_history`, `appointments_status_history`.

Analytics schema skeleton (empty, no refresh jobs): `analytics.fact_doses_administered`, `analytics.fact_revenue`, `analytics.fact_inventory_movements`, `analytics.fact_appointment_outcomes`, `analytics.dim_date`, `analytics.dim_service`, `analytics.dim_user`, `analytics.dim_patient`, `analytics.rollup_daily_branch_revenue`, `analytics.rollup_daily_doses_by_service`, `analytics.rollup_monthly_provider_productivity`.

### New columns on existing tables (Phase 1, additive)

All nullable unless noted:

- **`tenants`**: `timezone` (default `Asia/Manila`), `country_code` (default `PH`), `retention_policy` jsonb
- **`branches`**: `timezone` (nullable, overrides tenant)
- **`users`**: `password_changed_at`, `failed_login_count` (default 0), `locked_until`, `mfa_enabled` (default false), `mfa_secret_encrypted`, `preferred_name`, `license_type`, `license_expires_at`, `status` enum (default `Active`), `primary_branch_id`
- **`patients`**: `mrn` (backfilled NOT NULL), `suffix`, `preferred_language` (default `en`), `sms_opt_in`, `email_opt_in`, `potential_duplicate_of_id`, `merged_into_id`, `merged_at`, `deletion_requested_at`, `scheduled_purge_at`
- **`service_catalog`**: `cvx_code`, `ndc_code`, `cpt_code`, `loinc_code`, `default_route`, `default_dose_volume_ml`, `default_manufacturer`, `requires_consent`, `requires_vis`
- **`inventory_lots`**: `location_id`, `manufacturer` (backfilled NOT NULL), `ndc_code_snapshot`, `unit_cost` (backfilled NOT NULL, default 0), `cost_currency`, `recall_id`, `supplier_invoice_number`
- **`clinical_orders`**: `patient_id` (backfilled from PSO), `administering_encounter_id`, `administered_by_id`, `documented_by_id`, `lot_id`, `manufacturer_snapshot`, `expiry_date_snapshot`, `dose_volume_ml_actual`, `needle_gauge`, `refusal_reason`, `deferral_reason`, `idempotency_key`
- **`transactions`**: `cash_drawer_session_id`, `payer_contract_id`, `or_series_id`, `vat_rate` (default 0.12), `amount_paid` (default 0), `amount_outstanding` (backfilled), `applied_to_transaction_id`, `replacement_transaction_id`, `refunded_from_transaction_id`, `idempotency_key`
- **`transaction_items`**: `lot_id`, `unit_cost_snapshot`, `service_price_id`
- **`payments`**: `cash_drawer_session_id`, `external_processor_fee`, `reconciliation_status` (default `Pending`), `cleared_at`, `idempotency_key`
- **`lab_orders`**: `external_order_id`, `collected_at`, `collected_by_id`, `rejection_reason`, `has_critical_value` (default false), `critical_value_acknowledged_at`, `critical_value_acknowledged_by_id`, `result_file_attachment_id`
- **`notifications`**: `template_id`, `recipient_address` (backfilled NOT NULL), `delivered_at`, `read_at`, `external_message_id`, `retry_count` (default 0), `consent_verified_at`
- **`audit_logs`**: `session_id`, `correlation_id`, `metadata` jsonb
- **Every domain table**: `row_version int not null default 0` (bumped by updated `set_updated_at()` trigger)

### New enums

`user_status_enum` (`Active`, `Inactive`, `Locked`, `PendingActivation`), `administration_route_enum` (`IM`, `SC`, `ID`, `IV`, `PO`, `IN`, `Topical`), `consenter_relation_enum` (`Patient`, `Parent`, `Guardian`, `Spouse`, `Caregiver`, `Other`), `claim_status_enum` (`Draft`–`Appealed`), `drawer_state_enum` (`Open`, `Closed`, `Reconciled`, `Discrepancy`).

### Enum value additions (via supplemental SQL)

`encounter_status` += `CheckedIn`, `Triage`, `OnHold`, `NoShow`; `clinical_order_status` += `Deferred`, `Refused`; `transaction_status` += `PartiallyPaid`.

### Gaps to the original design spec — explicitly NOT in this PR

The spec at [`docs/specs/schema-v2-redesign.md`](../specs/schema-v2-redesign.md) describes the full target state. Phase 1 deliberately ships only the additive subset. Everything below is in the spec but **not** in this PR — track each item against the corresponding phase.

**Schema-level constraints (Phase 4)**

- [x] ID-format `CHECK` constraints on every PK column (spec §3.8). Done in 0009 + 0018 (notification_templates, consents, service_catalog tenant-scoped form).
- [x] Status-history composite `FOREIGN KEY` references (spec §3.2). All 7 `*_status_history` tables now have `(tenant_id, entity_id) → parent(tenant_id, id)` ON DELETE CASCADE — see 0017.
- [x] Immutability triggers on completed `transactions` and `clinical_orders` (spec principle P5, §4.4, §4.6). Functions defined in 0014/0015/0016; attached to tables in 0019.
- [ ] Exclusion constraint on `service_prices` for overlapping `daterange` per `(tenant, service, branch, payer, segment)` (spec §4.3) — deferred to follow-up (needs btree_gist + price overlap policy decisions).
- [ ] Exclusion constraint on `appointments` for provider double-booking (spec §4.4) — deferred (needs `tstzrange` + btree_gist).
- [x] Polymorphic FK hardening — type allow-list CHECK + non-empty pair on `inventory_transactions`, `consents`, `attachments` (0017). audit_logs.entity_type kept polymorphic by design (documented).
- [x] `amount_outstanding` is now a `GENERATED ALWAYS AS (...) STORED` column (0023), removing trigger-driven sync drift class.
- [x] `transaction_items` composite uniqueness — `UNIQUE (tenant_id, transaction_id, service_id)` plus partial unique on `(tenant_id, transaction_id, clinical_order_id)` (0020).
- [x] Status-history `to_status` / `from_status` CHECK constraints constraining each history table to its parent enum's values (0020).
- [x] Audit redaction extended to clinical JSONB — `audit_log_changes()` now also strips `clinical_orders.notes`, `encounters.specialty_data`, `encounters.clinical_notes`, `adverse_events.symptoms_coded`, `lab_orders.result_data`, `patients.onboarding_data` from `audit_logs.changes` (0021).
- [x] Phase 4 column additions — `adverse_events.lot_id` (FK → inventory_lots), `inventory_lots.remaining_volume_ml` (ID-route fractional dose tracking), `deleted_at` on `payer_profiles` / `partner_laboratories` / `standing_order_template_items` / `approval_requests` / `approval_decisions` / `claim_items` (0017a + schema.ts).
- [x] Audit-partition runway pushed to 12 months ahead with optional `pg_cron` auto-schedule (0022). Without `pg_cron`, ops must run `CALL create_next_audit_partitions(6);` monthly via Railway cron.
- [ ] `NOT NULL` on backfilled columns: `patient_tags.tag_definition_id`, `patients.mrn`, `inventory_lots.manufacturer`, `inventory_lots.unit_cost`, `notifications.recipient_address`, `clinical_orders.patient_id` — partially done in 0012/0013; remaining items still nullable.
- [ ] Drop of deprecated columns/tables (spec §5 Phase 4): `users.role`, `users.branch_id`, `service_catalog.base_price`, `patients.allergies`/`conditions`, `staff_time_logs.float_amount`/`drawer_state`, `clinical_orders.completed_by_id`, `lab_orders.result_file_url`, plus tables `inventory_transactions` and `consent_records` — deferred (consumers in modules still read both shapes).

**Module / code work (Phase 2–3)**

- All 18 backend module rewrites — none done. Existing modules still read/write the old shape.
- All 13 frontend feature rewrites — none done.
- New endpoints for net-new tables: `claims`, `claim_items`, `appointments`, `encounter_vitals`, `encounter_diagnoses`, `patient_allergies`, `patient_conditions`, `patient_emergency_contacts`, `patient_external_immunizations`, `attachments`, `consents` (CRUD), `adverse_events`, `product_recalls`, `payer_contracts`, `notification_templates`, `approval_decisions`, `cash_drawer_sessions`, `user_branches`/`user_roles` admin endpoints.
- `service_prices` resolution algorithm — `apps/backend/src/shared/lib/pricing.ts` not yet created. Today, code still resolves price via `service_catalog.base_price`.
- Idempotency-Key middleware — header support not wired. The columns exist on `transactions`, `payments`, `clinical_orders`, but nothing reads/enforces them.
- Per-table specialized `set_updated_at()` trigger variants — Phase 1 uses a single generic function with `information_schema.columns` lookup on every UPDATE, which is acceptable for dev volumes but should become per-table generated triggers in Phase 2.
- Standing-order template copy-on-write logic (spec §4.4 — `is_locked`, `supersedes_id`, `superseded_by_id` columns exist; the application logic that creates a new version row instead of UPDATE-in-place is not implemented).
- `consents` write path — code still writes to `consent_records`. Phase 2 standing-orders rewrite owns the cutover.
- `inventory_movements` write path — code still writes to `inventory_transactions`. Phase 2 inventory rewrite owns the cutover.
- `cash_drawer_sessions` lifecycle (open/close/reconcile) — table exists, no module touches it.
- `domain_events` publisher worker — outbox table populated only by future code; no consumer worker exists.
- PHI access logging — `phi_access_log` table exists, but no read-side instrumentation writes rows. Phase 2 patients/encounters/clinical_orders rewrites must add it.
- `appointments` booking flow — table exists, no endpoints, no UI.
- `adverse_events` reporting flow — table exists, no endpoints.
- `product_recalls` lookup at order time — table exists, no integration into clinical-order completion.

**Infrastructure (Phase 5)**

- [x] `audit_logs` monthly partition maintenance cron — runway extended to 12 months in 0022 with optional `pg_cron` schedule. Manual fallback: `CALL create_next_audit_partitions(6);` monthly.
- `phi_access_log` partitioning — schema declares the table but partitioning configuration is not in supplemental SQL. Treat as standard table for now; add partitioning in Phase 5.
- Analytics schema refresh jobs — `analytics.fact_*`, `analytics.dim_*`, `analytics.rollup_*` tables are NOT created in Phase 1. Spec §4.9 describes them; supplemental SQL skipped them. Phase 5 owns both creation and refresh worker.
- `analytics.dim_date` population — not run (depends on analytics schema being created first).
- Materialized view `analytics.mv_patient_protocol_completion` — not created.
- Multi-language `notification_templates` content — table exists, no rows seeded.
- Hash-chained audit log immutability (spec §6 security) — not implemented.
- Field-level encryption on selected PHI columns — not implemented.
- Break-glass procedure documentation — not written.

**Decisions intentionally deferred**

The full §6 list of open questions from the spec is reproduced in §6 of this handover, every entry tagged `Deferred`. None were decided in this PR.

**Bonus fixes shipped (not in original spec)**

- `apps/backend/drizzle/0001_rls_triggers_extensions.sql`: the partitioned `audit_logs` recreation was missing the new columns (`session_id`, `correlation_id`, `metadata`) that Drizzle's Phase 1 migration adds. Patched in this PR — these supplemental-vs-Drizzle drift issues are likely to recur on future schema changes that touch the audit_logs table; verify after every migration that touches audit columns.
- `apps/backend/drizzle/0002_audit_redaction.sql`: the `audit_log_changes()` trigger function used `NEW.id` directly, which raised on junction tables (`user_branches`, `user_roles`) that have no `id` column. Switched to `to_jsonb(NEW) ->> 'id'` so missing columns return NULL instead of crashing. Affects any future junction table; the pattern is now established.

---

## 2. Phase 2 — Read Switchover (per module)

One PR per module is the recommended boundary. Small modules (partner_laboratories, payer_profiles) can be grouped. Aim for 12–15 PRs total across Phase 2.

**Before starting any Phase 2 PR**: read the relevant section of `docs/specs/schema-v2-redesign.md`, read the current module's `routes.ts`/`db.ts`/`service.ts`, and identify the parallel-state pair from §1 above.

### Backend modules

#### `auth` (`apps/backend/src/modules/auth/`)

Currently reads: `users`, `refresh_tokens`.

Phase 2 changes:

- Read primary role from `user_roles` (join on `tenant_id, user_id`) instead of `users.role`. When a user has multiple roles, the highest-privilege role governs auth claims (define the precedence order: SuperAdmin > BranchAdmin > Branch > Physician > Nurse > Cashier).
- Read primary branch from `users.primary_branch_id` (already backfilled) instead of `users.branch_id`.
- Check `users.locked_until` and `users.failed_login_count` before granting access. Increment `failed_login_count` on failed password check; set `locked_until = now() + interval '15 minutes'` after N failures (N = configurable, start at 5).
- Insert a `user_sessions` row at successful login (record `ip_address`, `user_agent`, `device_fingerprint`). Link session to refresh token family via `session_id` in JWT claims.
- Clear `failed_login_count` and update `password_changed_at` on password change.

New endpoints: none in Phase 2 (session management UI is Phase 3+).

PR boundary: one PR touching `auth/routes.ts`, `auth/db.ts`, `auth/service.ts`.

#### `branch` (`apps/backend/src/modules/branch/`)

Currently reads: `users` (filtered by `branch_id`), serves `/api/branch/staff` and `/api/branch/physicians`.

Phase 2 changes:

- Query users via `user_branches` membership rather than `users.branch_id`. A user who has multiple branch assignments appears on each relevant branch's staff list.
- Query roles via `user_roles` to populate the physician/staff dropdown.
- The `requireRole('Branch','SuperAdmin','BranchAdmin','Nurse')` guard stays — no change.

PR boundary: small module, can be grouped with `shifts`.

#### `clinical_orders` (`apps/backend/src/modules/clinical_orders/`)

Currently reads: `clinical_orders` joined with PSO, encounters, service catalog. Detail endpoint returns full record.

Phase 2 changes:

- Surface `lot_id`, `manufacturer_snapshot`, `expiry_date_snapshot`, `administered_by_id`, `documented_by_id` in detail response. These are on the row already (nullable); just add them to the response shape.
- Add `patient_id` to list query filter parameters (now denormalized, so no join needed for patient-filtered lists).
- Surface `refusal_reason` and `deferral_reason` on detail and list.
- When rendering the completion form (frontend), distinguish "administered by" from "documented by" — see §7 for the semantic question that must be resolved first.

New endpoints: none required in Phase 2 itself; `POST /api/clinical-orders/:id/adverse-event` is Phase 3+ once the `adverse_events` table is wired.

PR boundary: `clinical_orders` is one of the heavier modules — one dedicated PR.

#### `dashboard` (`apps/backend/src/modules/dashboard/`)

Currently reads: 8 tables for aggregates (transactions, clinical_orders, patients, inventory_lots, etc.).

Phase 2 changes:

- Leave existing aggregates alone. They read from old tables that still exist and will continue to exist through Phase 4.
- Do NOT switch dashboard reads to `analytics.*` rollup tables yet — those are empty in Phase 1. Phase 5 wires the analytics refresh job and then dashboard can switch.
- When `analytics.rollup_daily_branch_revenue` is populated (Phase 5), replace the `SUM(transactions.net_amount) GROUP BY date` query with a point-lookup against the rollup table for a large perf win.

PR boundary: skip Phase 2 for dashboard. Revisit in Phase 5.

#### `encounters` (`apps/backend/src/modules/encounters/`)

Currently reads: `encounters` joined with patients, clinical_orders.

Phase 2 changes:

- Expose `disposition_code`, `closed_by_id`, `appointment_id` in detail response (columns exist, just not returned).
- Optionally surface `encounter_vitals` in the encounter detail response (joined subarray).
- Optionally surface `encounter_diagnoses` in the encounter detail response.
- Add new endpoints for vitals and diagnoses creation:
  - `POST /api/encounters/:id/vitals` — insert into `encounter_vitals`
  - `POST /api/encounters/:id/diagnoses` — insert into `encounter_diagnoses`
  - `GET /api/encounters/:id/vitals` — list vitals for encounter
  - `GET /api/encounters/:id/diagnoses` — list diagnoses for encounter
- Status history: `encounters_status_history` now has backfilled seed data; wire the trigger reads if needed for audit UI.

PR boundary: one PR for encounters (backend) plus one PR for the frontend drawer update.

#### `inventory` (`apps/backend/src/modules/inventory/`)

Currently reads: `inventory_transactions` for movement history, `inventory_lots` for stock. Computes running balance via `SUM(quantity_delta)` from `inventory_transactions`.

Phase 2 changes:

- Switch movement-history reads from `inventory_transactions` to `inventory_movements`. Same shape; the copy is exact.
- Expose `manufacturer`, `unit_cost`, `cost_currency`, `location_id` on lot detail response (columns exist, just not returned).
- Replace the `SUM` balance computation with a point-lookup against `inventory_lot_balances` (populated by the Phase 1 trigger). Verify accuracy first — see §7, "inventory_lot_balances accuracy" TODO.
- Expose `quantity_on_hand`, `quantity_available`, `weighted_average_cost` from `inventory_lot_balances`.

PR boundary: one PR for the inventory module.

#### `lab_orders` (`apps/backend/src/modules/lab_orders/`)

Currently reads: `lab_orders` joined with partner_laboratories.

Phase 2 changes:

- Surface `collected_at`, `collected_by_id`, `has_critical_value`, `critical_value_acknowledged_at`, `critical_value_acknowledged_by_id`, `rejection_reason`, `external_order_id` in detail response.
- Surface `result_file_attachment_id` in parallel with existing `result_file_url` (show whichever is non-null; prefer the attachment FK).
- Add endpoint: `POST /api/lab-orders/:id/acknowledge-critical` — sets `critical_value_acknowledged_at`, `critical_value_acknowledged_by_id`.

PR boundary: can be grouped with `partner_laboratories`.

#### `partner_laboratories` (`apps/backend/src/modules/partner_laboratories/`)

No change in Phase 2. Schema unchanged. Group this PR with `lab_orders` if convenient.

#### `patients` (`apps/backend/src/modules/patients/`)

Currently reads: `patients`, `patient_tags`, `consent_records`.

Phase 2 changes:

- Switch allergy reads to `patient_allergies` rows (instead of `patients.allergies` jsonb). Present as an array in the patient detail response.
- Switch condition reads to `patient_conditions` rows (instead of `patients.conditions` jsonb).
- Expose `mrn`, `sms_opt_in`, `email_opt_in`, `preferred_language`, `suffix` on both list and detail (columns exist).
- New endpoints:
  - `GET /api/patients/:id/allergies` + `POST /api/patients/:id/allergies` + `DELETE /api/patients/:id/allergies/:allergyId`
  - `GET /api/patients/:id/conditions` + `POST /api/patients/:id/conditions`
  - `GET /api/patients/:id/emergency-contacts` + `POST /api/patients/:id/emergency-contacts`
  - `GET /api/patients/:id/external-immunizations`
  - `GET /api/patients/:id/consents` (reads from `consents`, not `consent_records`)
- Expose `patient_tags` resolved through `tag_definitions` (display the tag name, not the raw ID).
- Search by `mrn` (exact match, indexed).

PR boundary: patients is the heaviest module. Split into two PRs:

- PR A: read switchover + new allergy/condition endpoints
- PR B: emergency contacts, external immunizations, consents, tag resolution

#### `payer_profiles` (`apps/backend/src/modules/payer_profiles/`)

Currently reads: `payer_profiles`.

Phase 2 changes:

- Add `payer_contracts` endpoints:
  - `GET /api/payer-profiles/:id/contracts`
  - `POST /api/payer-profiles/:id/contracts`
  - `PUT /api/payer-profiles/:id/contracts/:contractId`

PR boundary: small, can group with `partner_laboratories`.

#### `scheduled_orders` (`apps/backend/src/modules/scheduled_orders/`)

Currently reads: `patient_standing_orders`, `clinical_orders` (scheduled view).

Phase 2 changes:

- Read `clinical_order_schedule_changes` for the reschedule history of each order. Expose as `scheduleChanges` array on clinical order detail.
- Surface `patient_id` on `clinical_orders` for direct filtering (no PSO join needed for patient filter).
- Expose `refusal_reason`, `deferral_reason` on order detail.

PR boundary: one PR.

#### `service_catalog` (`apps/backend/src/modules/service_catalog/`)

Currently reads: `service_catalog` including `base_price`.

Phase 2 changes:

- Stop returning `base_price` in API responses. Resolve price via a new shared util `apps/backend/src/shared/lib/pricing.ts` that looks up `service_prices`.
- The pricing resolution algorithm (most-specific match wins):
  1. Match on `(tenant_id, service_id, branch_id, payer_id, patient_segment)` where `effective_from <= today` and (`effective_to IS NULL` or `effective_to >= today`).
  2. Fall through progressively: branch+payer+segment → branch+payer → branch only → tenant-wide (branch=NULL, payer=NULL).
  3. Return the first match. If no match, fall back to `service_catalog.base_price` as a safety net (remove this fallback in Phase 4).
- Expose `cvx_code`, `ndc_code`, `cpt_code`, `loinc_code`, `default_route`, `requires_consent`, `requires_vis` on catalog endpoints.

PR boundary: one PR (service_catalog + pricing.ts util).

#### `shifts` (`apps/backend/src/modules/shifts/`)

Currently reads: `staff_time_logs` including `float_amount`, `drawer_state`.

Phase 2 changes:

- Read drawer state from `cash_drawer_sessions` instead of `staff_time_logs.float_amount`/`drawer_state`. A shift's drawer state is the `cash_drawer_sessions` row(s) linked to that time log's user+date+branch.
- Expose `opening_float`, `closing_total_declared`, `variance`, `state` from `cash_drawer_sessions` on the shift detail.
- New endpoint: `GET /api/shifts/:id/drawer` — returns the cash drawer session for a given shift.

PR boundary: group with `staff_time_logs`.

#### `staff_time_logs` (`apps/backend/src/modules/staff_time_logs/`)

Currently reads: `staff_time_logs` with drawer fields in response.

Phase 2 changes:

- Clock-in flow: if the user's role is `Cashier` or `Branch`, open a `cash_drawer_sessions` row in the same transaction. Set `state='Open'`, record `opening_float` from request body.
- Clock-out flow: close the `cash_drawer_sessions` row. Set `closed_at`, `closing_total_declared`, compute `variance = closing_total_declared - expected_total`.
- Stop reading `staff_time_logs.float_amount`/`drawer_state` in clock-in/clock-out responses; return drawer state from the session row instead.

PR boundary: group with `shifts`.

#### `standing_orders` (`apps/backend/src/modules/standing_orders/`)

Currently reads: `standing_order_templates`, `standing_order_template_items`, `patient_standing_orders`, `consent_records`.

Phase 2 changes:

- Respect `is_locked` on templates. When a template has `is_locked=true` (set when the first PSO is created against it), prevent direct edits. Editing a locked template must create a new version row (`version = old.version + 1`, `supersedes_id = old.id`) and set `superseded_by_id` on the old row.
- Read consents from `consents` table instead of `consent_records`. The list endpoint for a standing order should show associated consents from `consents` where `scope_ref_type='standing_order'` or `scope_ref_type='clinical_order'` and the order belongs to this PSO.
- Surface `patient_standing_orders_status_history` on PSO detail.

PR boundary: one PR (standing_orders is complex enough to stand alone).

#### `transactions` (`apps/backend/src/modules/transactions/`)

Currently reads: `transactions`, `transaction_items`, `payments`.

Phase 2 changes:

- Idempotency-Key middleware: read `Idempotency-Key` header on `POST /api/transactions` and `POST /api/transactions/:id/payments`. Reject with 409 if the key was used in the last 24 hours. Store the key in `transactions.idempotency_key` / `payments.idempotency_key`. See §7 for implementation notes.
- Consume `service_prices` resolution (via `pricing.ts`) when creating transaction items. Populate `transaction_items.service_price_id` and `transaction_items.unit_cost_snapshot` from the resolved lot.
- Track `amount_paid` (sum of non-voided payments) and `amount_outstanding` (net_amount - amount_paid) — keep in sync via trigger or on every payment insert. See §7 for the "generated column vs trigger" decision.
- Populate `lot_id` on transaction items when the service involves a lot (requires the inventory module to expose which lot was consumed).
- Respect `cash_drawer_session_id` on transaction creation (cashier must have an open drawer session).
- Surface `payer_contract_id`, `vat_rate`, `amount_paid`, `amount_outstanding` on transaction detail and list.

PR boundary: one PR, but coordinate with inventory and shifts PRs since they touch related fields.

#### `audit` (`apps/backend/src/modules/audit/`)

Currently reads: `audit_logs`.

Phase 2 changes:

- Surface `session_id`, `correlation_id`, `metadata` in audit log list/detail responses (columns exist, just not returned).
- Optionally: filter audit logs by `session_id`.

PR boundary: smallest module — can be grouped with admin PRs.

#### `admin` (4 routers under `apps/backend/src/modules/admin/`)

Currently: users, attendance, approvals, audit sub-routers.

Phase 2 changes:

- **Admin users**: User creation must write to `user_roles` (insert role row) and `user_branches` (insert branch row) in addition to writing `users`. Reading user list must join `user_roles` to show roles. Updating a user's role must update the `user_roles` row (not `users.role`).
- **Attendance**: wire to `staff_time_logs` with `cash_drawer_sessions` join for drawer state.
- **Approvals**: `approval_decisions` table now exists — wire the "record approval decision" flow to insert there instead of updating the approval request inline.
- **New CRUD endpoint set for claims** (Phase 2 or 3, depending on whether HMO functionality is needed):
  - `GET /api/admin/claims`, `POST /api/admin/claims`, `GET /api/admin/claims/:id`, `PUT /api/admin/claims/:id/status`
  - This can defer to Phase 3 if no HMO payer is active.

PR boundary: admin users is one PR; approval_decisions is one PR; claims endpoint set is one PR.

### Frontend features

For each feature, the Phase 2 backend changes that require corresponding frontend updates:

| Feature            | Phase 2 backend change requiring frontend work                                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin`            | User form: multi-branch assignment (checkboxes), multi-role display. Claims list (if Phase 2 admin).                                                                                                                                                                |
| `arrivals`         | No backend change in Phase 2; no frontend change needed.                                                                                                                                                                                                            |
| `branch`           | Staff list sourced from `user_branches` — transparent to frontend if response shape is unchanged.                                                                                                                                                                   |
| `clinical-orders`  | Detail drawer: add `lot_id`, `manufacturer_snapshot`, `administered_by_id`, `documented_by_id`, `refusal_reason`, `deferral_reason` fields. Order completion form: separate "Administered by" vs "Documented by" fields (semantic question in §7 must be resolved). |
| `dashboard`        | No change in Phase 2.                                                                                                                                                                                                                                               |
| `encounters`       | Detail drawer: add vitals tab, diagnoses tab. New forms: vitals entry, ICD-10 diagnosis entry.                                                                                                                                                                      |
| `inventory`        | Lot list: add `manufacturer`, `unit_cost`, `quantity_on_hand` (from balances). Movement history: switch to `inventory_movements` — transparent if shape unchanged.                                                                                                  |
| `lab-orders`       | Detail drawer: add `collected_at`, `has_critical_value` badge, acknowledge-critical button, `rejection_reason`.                                                                                                                                                     |
| `patients`         | Detail drawer: allergies tab (normalized rows, not jsonb blob), conditions tab, emergency contacts tab, external immunizations tab, consents tab. Search: add MRN field. Patient list: show `mrn` column.                                                           |
| `scheduled-orders` | Detail drawer: schedule change history section.                                                                                                                                                                                                                     |
| `services`         | Price display: resolve from `service_prices` API; remove hardcoded `base_price` field.                                                                                                                                                                              |
| `shift`            | Drawer session state: show opening float, closing float, variance from `cash_drawer_sessions`. Clock-in form: add opening float input.                                                                                                                              |
| `standing-orders`  | Template editor: lock indicator when `is_locked=true`; "Edit (creates new version)" button flow. Consent tab: read from `consents` instead of `consent_records`.                                                                                                    |
| `transactions`     | Create transaction: send `Idempotency-Key` header. Transaction detail: show `amount_paid`, `amount_outstanding`, `cash_drawer_session_id`.                                                                                                                          |

---

## 3. Phase 3 — Write Switchover

Stop writing to the old columns/tables. These are the concrete write touchpoints to migrate:

### User creation and management

**File**: `apps/backend/src/modules/admin/routes.ts`, `admin/db.ts`

- Stop writing `users.role` on `INSERT` and `UPDATE`. Instead, insert/update a `user_roles` row.
- Stop writing `users.branch_id` on `INSERT` and `UPDATE`. Instead, insert a `user_branches` row and set `users.primary_branch_id`.
- Existing read paths should already be using `user_roles`/`user_branches` from Phase 2. Phase 3 just stops the double-write.

### Service catalog pricing

**File**: `apps/backend/src/modules/service_catalog/routes.ts`, `service_catalog/db.ts`

- Stop writing `service_catalog.base_price` when creating or updating a service. Instead, create or update the corresponding `service_prices` row.
- The Phase 2 fallback `base_price` safety net in `pricing.ts` should be removed in Phase 4 (leave it for Phase 3 as a safety net).
- Service catalog admin form (frontend): rename "Base Price" field to "Default Price" and clarify it creates a tenant-wide `service_prices` row.

### Patient intake

**File**: `apps/backend/src/modules/patients/routes.ts`, `patients/db.ts`

- Stop writing `patients.allergies` jsonb on patient create/update. Instead, write `patient_allergies` rows.
- Stop writing `patients.conditions` jsonb on patient create/update. Instead, write `patient_conditions` rows.
- The existing jsonb columns stay (Phase 4 drops them); do not null them out in Phase 3, just stop maintaining them.

### Inventory consume on order completion

**File**: `apps/backend/src/modules/clinical_orders/service.ts` or wherever order completion writes inventory

- Stop writing `inventory_transactions` on lot consumption. Write `inventory_movements` instead.
- The `inventory_lot_balances` trigger fires on `inventory_movements`, so balance tracking stays accurate.

### Consent capture

**File**: wherever `consent_records` is currently inserted (likely `standing_orders` or `clinical_orders` completion flow)

- Stop writing `consent_records`. Write `consents` instead with `consent_type='Vaccination'`, `scope='SingleOrder'`, `scope_ref_type='clinical_order'`, `scope_ref_id=<order_id>`.

### Cash drawer

**File**: `apps/backend/src/modules/staff_time_logs/routes.ts` (clock-in/clock-out)

- Stop reading `staff_time_logs.float_amount`/`drawer_state` in the clock-in/clock-out response. The Phase 2 PR should already have moved these reads to `cash_drawer_sessions`. Phase 3 confirms no code still writes them.
- Ensure `staff_time_logs.float_amount` is never written after Phase 3 ships.

### Clinical order completion

**File**: order completion handler, wherever `completed_by_id` is currently set

- Explicitly populate both `administered_by_id` and `documented_by_id`. They may be the same user (single clinician who gave and documented the dose) or different users (a nurse administers; a physician co-signs and documents).
- The `completed_by_id` column stays until Phase 4 drops it. In Phase 3, set `completed_by_id = documented_by_id` for backward compatibility.

### Patient tag application

**File**: `apps/backend/src/modules/patients/` (wherever tags are applied)

- Stop writing `patient_tags.tag` (free text). Write `patient_tags.tag_definition_id` by looking up or creating the tag in `tag_definitions`.
- Once Phase 3 ships, all new tags are dictionary-backed. Phase 4 makes `tag_definition_id` NOT NULL.

---

## 4. Phase 4 — Cleanup

After Phase 3 is stable in production (all old write paths stopped), drop the dead weight.

### Columns to drop

```sql
ALTER TABLE users DROP COLUMN role;
ALTER TABLE users DROP COLUMN branch_id;
ALTER TABLE service_catalog DROP COLUMN base_price;
ALTER TABLE patients DROP COLUMN allergies;
ALTER TABLE patients DROP COLUMN conditions;
ALTER TABLE staff_time_logs DROP COLUMN float_amount;
ALTER TABLE staff_time_logs DROP COLUMN drawer_state;
ALTER TABLE clinical_orders DROP COLUMN completed_by_id;
ALTER TABLE lab_orders DROP COLUMN result_file_url;
```

### Tables to drop

```sql
DROP TABLE inventory_transactions;
DROP TABLE consent_records;
```

### Add NOT NULL constraints

```sql
ALTER TABLE patient_tags ALTER COLUMN tag_definition_id SET NOT NULL;
ALTER TABLE patients ALTER COLUMN mrn SET NOT NULL;         -- already backfilled
ALTER TABLE inventory_lots ALTER COLUMN manufacturer SET NOT NULL;  -- already backfilled
ALTER TABLE inventory_lots ALTER COLUMN unit_cost SET NOT NULL;     -- already backfilled
ALTER TABLE notifications ALTER COLUMN recipient_address SET NOT NULL;  -- already backfilled
ALTER TABLE clinical_orders ALTER COLUMN patient_id SET NOT NULL;   -- backfilled from PSO
```

### Add ID-format CHECK constraints

One per PK column, matching the prefix patterns in `apps/backend/src/shared/utils/displayId.ts`. Example:

```sql
ALTER TABLE patients ADD CONSTRAINT pat_id_fmt CHECK (id ~ '^PAT-[A-Z0-9]{9,10}$');
ALTER TABLE transactions ADD CONSTRAINT txn_id_fmt CHECK (id ~ '^TXN-\d{4}-[A-Z0-9]+$');
-- etc. for every table
```

### Immutability triggers

```sql
-- Transactions: once Paid, only void/refund/delete allowed
CREATE TRIGGER trg_transactions_immutable BEFORE UPDATE ON transactions
FOR EACH ROW WHEN (OLD.status = 'Paid' AND OLD.deleted_at IS NULL)
EXECUTE FUNCTION reject_immutable_update_except_void();

-- Clinical orders: once Completed, only amendment flow allowed
CREATE TRIGGER trg_clinical_orders_immutable BEFORE UPDATE ON clinical_orders
FOR EACH ROW WHEN (OLD.status = 'Completed' AND OLD.deleted_at IS NULL)
EXECUTE FUNCTION reject_immutable_update();
```

### Exclusion constraints

Add the overlapping-range exclusion on `service_prices` (requires the btree_gist extension):

```sql
ALTER TABLE service_prices ADD CONSTRAINT service_prices_no_overlap
EXCLUDE USING gist (
  tenant_id WITH =, service_id WITH =,
  COALESCE(branch_id, '*') WITH =, COALESCE(payer_id, '*') WITH =,
  COALESCE(patient_segment, '*') WITH =,
  daterange(effective_from, effective_to, '[)') WITH &&
);
```

Add provider double-booking exclusion on `appointments`:

```sql
ALTER TABLE appointments ADD CONSTRAINT appointments_no_double_book
EXCLUDE USING gist (
  provider_id WITH =,
  tstzrange(scheduled_start_at, scheduled_end_at, '[)') WITH &&
) WHERE (status NOT IN ('Cancelled', 'NoShow'));
```

### Composite tenant FKs

Phase 1 added `(tenant_id, id)` unique indexes on every tenant-scoped table (via `0007_phase1_composite_indexes.sql`). Phase 4 adds the composite foreign key declarations that use them:

```sql
ALTER TABLE clinical_orders ADD CONSTRAINT fk_co_patient
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id);
-- ... similarly for every cross-table FK that should be composite
```

These are deferred to Phase 4 because they require all the unique indexes Phase 1 added to be present and stable before the FK is declared.

---

## 5. Phase 5 — Operational Hardening

Activate when the first real tenant onboards (real clinical data flowing).

### Audit log partition maintenance

`audit_logs` and `phi_access_log` are partitioned by month. Currently, manual partition creation covers through 2027-06. Phase 5 adds a cron-style maintenance job that creates the next 3 months' partitions ahead of time:

```sql
-- Run monthly (first day of month):
SELECT create_next_audit_partitions(3);  -- creates 3 months ahead
SELECT create_next_phi_access_partitions(3);
```

Implement as a PostgreSQL procedure or as a small Node.js script triggered by Railway cron.

### Analytics refresh worker

`domain_events` table is populated in-transaction with each state change (Phase 2 wires domain event inserts). Phase 5 adds a worker that:

1. Reads unpublished `domain_events` rows (where `published_at IS NULL`).
2. Dispatches each event to its consumers (analytics upsert, notification trigger, integration webhooks).
3. Marks `published_at = now()`, increments `publish_attempts`.
4. On failure: records `last_publish_error`, retries with exponential backoff up to a cap.

Until the worker is live, analytics tables remain empty and the dashboard continues using OLTP aggregate queries (same as Phase 2 state).

### Domain events publisher

The analytics upsert consumer updates `analytics.rollup_*` tables incrementally. Once rollups are populated, the dashboard can switch aggregation queries to rollup point-lookups. This is the Phase 5 → Phase 2 hand-off for dashboard.

### Hash-chained audit log

For tamper-evident audit logs, each new `audit_logs` row hashes the prior row's hash (stored in a new `prev_hash` column):

```sql
ALTER TABLE audit_logs ADD COLUMN prev_hash text;
```

The `audit_log_changes()` trigger function is updated to compute `prev_hash` from the partition's latest row before inserting. This makes the audit log append-only in practice (any deletion or modification breaks the hash chain and is immediately detectable).

Defer this until a regulatory requirement or certification requires it — it adds write complexity.

### Field-level encryption

Selected PHI columns (`patients.diagnoses`, `patient_conditions.condition_name`, etc.) may need field-level encryption for stronger DPA posture. Defer until a risk assessment specifies which fields. The `attachments.is_encrypted` flag and `storage_key` pattern cover files already.

### PHI access log activation

`phi_access_log` table exists but nothing writes to it. Phase 5 activates it: every read of `patients`, `encounters`, `clinical_orders` from the API layer writes a `phi_access_log` row (via middleware or service-layer hook). This is high-volume — confirm the partition maintenance job is running before activating.

---

## 6. Open Questions (from spec §6)

All items below are `Deferred` unless noted. Revisit when the corresponding business question becomes concrete.

### Multi-tenancy & scaling

- **Multi-tenant deployment model.** RLS (current) vs database-per-tenant for largest customers. Schema supports either; operational tooling differs. `Deferred — investigate before Phase 2 multi-tenant expansion.`
- **Cross-tenant data sharing.** National vaccine catalog, drug interaction database shared across tenants. Requires a `global` schema. `Deferred.`
- **Region-aware deployment.** Data residency for Southeast Asian markets. Schema unaffected; deployment topology concern. `Deferred.`

### Clinical depth

- **Drug interaction and allergy decision support.** Contraindication warnings at order time; requires a `drug_interactions` reference table. `Deferred.`
- **Clinical pathways beyond standing orders.** Care plans (multi-week, multi-modal). `Deferred.`
- **Telehealth modality.** `encounter.modality`, recording artifact links, telehealth consent type. `Deferred.`
- **Imaging and DICOM.** Separate radiology subsystem parallel to `lab_orders`. `Deferred.`

### Patient experience

- **Patient portal accounts.** Patients as users; linking `patients` and `users`; read-only permission model. `Deferred.`
- **Family/household grouping.** `households` table, parent-child relationships, guardian billing. `Deferred.`
- **Communication preferences beyond opt-in flags.** Quiet hours, preferred contact times per channel. `Deferred.`
- **Loyalty/membership programs.** Points, tiers, recurring billing. `Deferred.`

### Inventory & supply chain

- **Multi-location inventory transfers in transit.** In-transit balance between branches. `Deferred.`
- **Supplier/vendor master.** Normalized `suppliers` table with payable invoicing. `Deferred.`
- **Expiry alerting and forecasting.** Predictive alerts ("X doses will expire with Y remaining"). Reporting query; no schema change. `Deferred.`
- **Cold-chain monitoring.** Fridge sensor integration; high-volume time-series storage. `Deferred — investigate TimescaleDB if needed.`

### Billing & payments

- **Double-entry general ledger.** `journal_entries` + `journal_lines` for real accounting integration. `Deferred — investigate before Phase 3 if a clinic requires GL integration.`
- **Recurring billing / subscriptions.** `billing_schedules`, `scheduled_charges`. `Deferred.`
- **Refund method-specific flows.** Cash vs reverse-card vs HMO chargeback specialization. Current `refundedFromTransactionId` pattern may need extension. `Deferred.`
- **Multi-currency.** All amounts are PHP-implied. `Deferred.`

### HMO & claims

- **Prior authorization workflow.** Pre-encounter benefit verification; `prior_authorizations` table + appointments link. `Deferred.`
- **Capitation contracts.** Per-member-per-month payer model; different revenue model. `Deferred.`
- **Claim attachment requirements.** Per-payer rules for which attachments are required. Schema-ready (`attachments`); workflow tooling deferred. `Deferred.`
- **Electronic claim submission.** EDI 837 generation, X12 acknowledgments, ERA (835) parsing. Integration work; schema-ready. `Deferred.`

### Reporting & compliance

- **PIDSR / IIS reporting.** Philippine PIDSR format and triggers differ by disease. Driven from analytics fact tables. `Deferred.`
- **DOH / FDA regulatory reports.** Periodic inventory, controlled substances, vaccine usage exports. Analytics layer. `Deferred.`
- **Quality metrics.** HEDIS-style or local equivalent measures. Analytics layer. `Deferred.`
- **Patient consent for research / data use.** Separate `research_consents` table if clinic participates in studies. `Deferred.`

### Operational

- **Appointment booking via portal or marketplace integration.** Idempotency, slot reservation atomicity. Schema-ready. `Deferred.`
- **Wait time tracking.** Check-in to seen-by-provider duration, from `appointments.status` transitions. `Deferred.`
- **Provider productivity and compensation.** RVU-style metrics, commission rules, payroll integration. Analytics concern. `Deferred.`
- **Quality improvement workflows.** Incident reporting, root cause analysis, corrective action tracking. `Deferred.`

### Security & privacy

- **End-to-end encryption of PHI fields.** Field-level encryption on diagnoses, conditions. Adds indexing complexity. `Deferred — defer until risk assessment requires it.`
- **Patient access requests (DSAR).** DPA right-to-access and right-to-deletion workflows. Schema-ready (deletion fields on patients). `Deferred.`
- **Audit log immutability via hash chaining.** Tamper-evident audit logs. `Deferred — Phase 5, only if certification requires.`
- **Anomaly detection on PHI access.** Unusual access pattern detection over `phi_access_log`. Analytics layer. `Deferred.`

### Internationalization

- **Multilingual content.** Service names, notification templates in multiple languages; side-table for translations. `Deferred.`
- **Locale-specific clinical coding.** ICD-10-PH variants, local drug formularies. Reference data. `Deferred.`

### Integration

- **HL7 FHIR interoperability.** FHIR mapping layer for exchanging records. Serialization concern; no schema change. `Deferred.`
- **Lab integrations beyond manual entry.** HL7 ORU/ORM messaging for bidirectional lab orders. Structurally supported. `Deferred.`
- **Wearable / IoT vitals ingestion.** `encounter_vitals.is_self_reported` flag and ingestion path. `Deferred.`

---

## 7. New TODOs Uncovered During Phase 1

These are specific questions and tasks that surfaced during Phase 1 implementation and must be resolved before or during the relevant Phase 2 PR.

**`clinical_orders.completed_by_id` vs `documented_by_id` vs `administered_by_id` semantic split.**
The current code sets `completed_by_id` to whoever completed the order. The v2 model distinguishes: `administered_by_id` = the person who physically gave the dose (e.g., a Nurse); `documented_by_id` = the person who recorded it in the system (e.g., the same Nurse, or a Physician co-signing). In many workflows these are the same person. The Phase 2 standing-orders completion form rewrite MUST clarify which fields the UI populates and under what rules. Do not launch the completion form rewrite without this decision documented. Files: `apps/backend/src/modules/clinical_orders/`, `apps/backend/src/modules/standing_orders/`.

**`transactions.amount_outstanding` derived value: generated column vs trigger.**
Currently backfilled as `net_amount - sum(payments)`. In Phase 2, every payment insert must keep this up to date. Two options: (a) Postgres `GENERATED ALWAYS AS` column (re-computes from `amount_paid` on every read — requires `amount_paid` to be accurate); (b) trigger on `payments` INSERT/DELETE that updates `transactions.amount_outstanding` directly. Decision needed before the transactions Phase 2 PR ships. Recommendation: trigger pattern (option b) — same approach as `inventory_lot_balances`, avoids recalculating a potentially expensive subquery on every transaction read.

**`service_prices` resolution algorithm — implement `apps/backend/src/shared/lib/pricing.ts`.**
The algorithm is: most-specific match wins, with deterministic fallback through (branch+payer+segment) → (branch+payer) → (branch) → (tenant-wide). Implement this as a shared utility in Phase 2. It must be a pure function (takes `{tenantId, serviceId, branchId, payerId, patientSegment, date}`) and returns a price row or null. Callers: service_catalog module, transactions module. File to create: `apps/backend/src/shared/lib/pricing.ts`.

**Idempotency-Key middleware — implement before transactions Phase 2 PR.**
Read the `Idempotency-Key` request header; look up in `transactions.idempotency_key` (or `payments.idempotency_key`); if found and the prior response was 2xx, return the original response body with 200. If found and prior was in-flight, return 409. If not found, proceed and store the key on commit. This is a prereq for safe payment retries from the frontend. File to create: `apps/backend/src/shared/middleware/idempotency.ts`.

**Status history triggers in shadow mode — verify they don't break existing UPDATE flows.**
The Phase 1 `0004_phase1_rls_triggers.sql` attaches status history triggers to `patient_standing_orders`, `clinical_orders`, `encounters`, `transactions`, `lab_orders`. These fire on every status-changing UPDATE. Verify during Phase 1 integration testing: run existing endpoints that update status and confirm no unexpected errors from the trigger. If any trigger raises (e.g., due to missing `changed_by_id` or `tenant_id` GUC not set), fix before Phase 2. The trigger must not break existing flows — it's in shadow mode.

**`analytics` schema placement decision for Phase 5.**
The analytics schema is in the same Postgres database as the operational schema. Before Phase 5 builds the refresh worker, decide: keep analytics in the same database (simpler ops; OLAP queries on same instance) or move to a dedicated replica/instance (better OLTP isolation; more ops complexity). Current load doesn't justify a separate instance, but document the trigger (e.g., "when P99 dashboard query > 500ms, evaluate extraction"). File the decision in `docs/ai-context/` when made.

**`notifications.recipient_address` backfill completeness.**
The Phase 1 backfill populates `recipient_address` from `patient.contact_number` (SMS channel), `patient.email` (Email channel), or `user.email` (staff notifications). If neither source exists, the row's `recipient_address` may be null. The column is NOT NULL — the backfill must handle nulls gracefully (skip or use a placeholder). Audit the seed data and production data before Phase 2 notification sends go live. File: `apps/backend/drizzle/0005_phase1_backfill.sql`.

**`consents` historical linkage from `consent_records`.**
The Phase 1 backfill copies `consent_records` rows into `consents` with `consent_type='Vaccination'`, `scope='SingleOrder'`. Pre-Phase-1 consent records may have sparse data (no `consenter_relation`, no `vis_*` fields). Decide in Phase 2 patients PR: (a) accept sparse historical consents as-is; (b) attempt to enrich from `clinical_orders.notes` jsonb if that field stored consent metadata; (c) mark pre-migration consents with a `source='LegacyImport'` metadata tag. Option (c) is recommended as the least risky approach.

**`inventory_lot_balances` accuracy verification.**
The `inventory_lot_balances` running totals are populated by the Phase 1 backfill (seeded from `inventory_transactions` aggregate) and maintained by the trigger attached after backfill in `0006_phase1_inventory_trigger_enable.sql`. Before Phase 2 inventory PR reads from balances instead of computing live, run an accuracy check:

```sql
SELECT ilb.lot_id,
  ilb.quantity_on_hand AS balance_table,
  SUM(im.quantity_delta) AS live_sum
FROM inventory_lot_balances ilb
JOIN inventory_movements im ON im.lot_id = ilb.lot_id
GROUP BY ilb.lot_id, ilb.quantity_on_hand
HAVING ilb.quantity_on_hand != SUM(im.quantity_delta);
```

If any rows return, the trigger backfill had a gap — investigate before switching reads.

**Partition automation for `audit_logs` and `phi_access_log`.**
Phase 1 creates manual partitions through 2027-06. Phase 5 must add an automated maintenance job. The gap between Phase 1 (2026-05) and Phase 5 (first real tenant) must not leave the partitions unattended — if no new partitions exist when the next year rolls over, inserts will fail. Add a calendar reminder or Railway scheduled task to create 2028 partitions before they're needed.

**`feature_flags_uniq` index correctness.**
The spec requires `COALESCE(branch_id, '__TENANT_WIDE__')` in the unique index on `feature_flags` to handle NULL branch values correctly. Verify that the Phase 1 supplemental SQL applied this correctly and that the index from `0001_rls_triggers_extensions.sql` was either already correct or has been updated. File: `apps/backend/drizzle/0004_phase1_rls_triggers.sql` or `0001_rls_triggers_extensions.sql`.

---

## 8. Decision Log

What was considered and rejected during Phase 1 planning:

**Big-bang single PR.** Rejected. ~38-table schema change in one PR is unreviewable, makes rollback impossible, and prevents incremental verification. The 5-phase approach allows each phase to ship, verify, and rest before the next begins.

**Versioned API (v1 + v2).** Rejected. No external API consumers exist. The sole consumer is the React frontend, which is rewritten in lockstep with each backend module during Phase 2/3. A versioning layer would add indirection with no benefit. Rewrite freely per module.

**Dual-write / single-read (write to both old and new simultaneously).** Rejected. Adds complexity for every write path during the transition period. The 5-phase approach instead defers the cost: Phase 2 switches reads (zero risk), Phase 3 switches writes (controlled risk per module), Phase 4 drops old tables. Cleaner and more debuggable.

**Replacing `docs/ai-context/01-DATA-AND-COMPLIANCE.md` outright.** Rejected. The AI context doc tracks "current state" (what the running system does today). The spec at `docs/specs/schema-v2-redesign.md` carries the rationale and target shape. Overwriting the AI context doc with the v2 target would make it incorrect (the system is still running v1 behavior). Instead, the AI context doc is updated incrementally as each Phase 2/3 module rewrite lands. A banner at the top (added in this PR) points future sessions to the spec and this handover.

**Deferring Phases 4–5 indefinitely.** The project is dev-only with no real clinical data. Phase 4 (immutability triggers, exclusion constraints, NOT NULL enforcement, CHECK constraints) and Phase 5 (partition automation, analytics refresh, PHI access logging activation, hash-chained audit) are expensive to operate but add little value before real data is flowing. They are explicitly tracked as "scheduled work" in the risk register, not abandoned.

---

## 9. How to Start Phase 2

Quickstart for the next session picking up any Phase 2 module:

1. **Read this handover first.** §1 tells you which old/new pair you're touching. §2 tells you the specific changes for your module.

2. **Read the spec section for the table(s) you're touching.** `docs/specs/schema-v2-redesign.md` §4.x contains the full column list and rationale for each domain.

3. **Read the current module code.** `apps/backend/src/modules/<module>/routes.ts`, `db.ts`, `service.ts`. Understand what the module currently reads and writes before changing anything.

4. **Identify the parallel-state pair from §1 of this handover.** Confirm both the old column/table and the new column/table are present in the DB before writing any Phase 2 code.

5. **Land one module per PR.** Do not combine two unrelated module rewrites in the same PR. Each PR must be independently reviewable and revertable.

6. **Update `docs/ai-context/01-DATA-AND-COMPLIANCE.md`.** After your Phase 2 PR merges, update the relevant section of that doc to reflect the new state of the table(s) you migrated. This keeps the AI context doc accurate for future sessions.

7. **Cross out the relevant line from §3 (Phase 3 write touchpoints) in this handover** once you complete the write switchover for your module. Edit this file directly — it is a living document.

8. **Follow the standard worktree setup.** `pnpm setup` from worktree root, then `pnpm dev`. Use `DATABASE_URL=$DATABASE_PUBLIC_URL pnpm --filter @surevax/backend db:deploy` if you add a migration. Full instructions in `.claude/rules/worktree.md` and the `railway-ops` skill.

9. **Run the standard verification recipe before opening a PR.** At minimum: `pnpm --filter @surevax/backend typecheck`, `pnpm --filter @surevax/frontend build`, and curl the endpoints you changed against the running dev server.
