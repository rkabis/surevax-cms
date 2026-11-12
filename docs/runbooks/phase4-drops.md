# Phase 4 Column-Drop Runbook

> **Status: EXECUTED 2026-05-07, then migration sequence squashed the same day in
> [#228](https://github.com/njvil/surevax-cms-revamp/pull/228).** The drop landed
> as a single consolidated migration `0024_drop_dualwrite.sql` in
> [#217](https://github.com/njvil/surevax-cms-revamp/pull/217), then the entire
> 32-file transitional sequence (including 0024) was collapsed into the clean
> 8-file baseline (`0000_initial.sql` + `0001_extensions_and_rls.sql` …
> `0007_retention_procs.sql`). The dropped objects are simply no longer in
> `schema.ts`, so a fresh DB never creates them in the first place — the
> drop migration is no longer needed.
>
> Kept below as a historical record of the planning + per-column verification
> queries — useful if a similar staged drop ever needs to be sequenced against
> a populated production database.
>
> Development DB posture (`pnpm run setup --force` rebuilds clean) made the staged
> rollout precaution unnecessary; production was never on Phase 1 dual-write.
>
> Original handover: [`docs/handovers/archive/2026-05-01-schema-v2-phase1.md`](../handovers/archive/2026-05-01-schema-v2-phase1.md) §4

---

## Overview

Phase 4 removes legacy columns and tables that Phase 1 (additive) added alongside and
Phase 3 (write-switch) stopped populating. Each drop is irreversible without a
point-in-time restore. Execute one migration at a time, observe the monitoring window,
then proceed.

**This runbook does not cover:**

- Phase 4 immutability triggers, exclusion constraints, or composite FKs (W37 / #137 —
  separate runbook)
- Phase 5 hardening: analytics worker, hash-chained audit, field-level encryption

---

## Preconditions (all must pass before any drop)

Run this checklist before executing the _first_ drop. Re-verify steps 3–4 before each
subsequent drop.

| #   | Check                                                       | How to verify                                                                       |
| --- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | All Phase 3 write-switches live in production for ≥ 30 days | Compare Phase 3 PR merge date against today's date in Railway deploy history        |
| 2   | Zero new rows on the legacy column/table for ≥ 7 days       | Run the staleness query for each target (see per-drop sections below)               |
| 3   | Zero application code references the legacy column          | Run the grep proof (see per-drop sections below); record output in the Decision Log |
| 4   | Railway backup snapshot taken immediately before the drop   | Railway dashboard → your service → Backups → Take snapshot; record snapshot ID      |

Do not proceed if any check fails. Fix the root cause (a missed write-switch, stale app
code) and restart the 7-day zero-row window.

---

## Migration file conventions

- One migration per drop — small, atomic, easy to monitor independently.
- Filename pattern: `NNNN_phase4_drop_<target>.sql`
- Suggested numbering (adjust if earlier migrations consume slots):

| Slot | File                                                   | Covers                                                         |
| ---- | ------------------------------------------------------ | -------------------------------------------------------------- |
| 0014 | `0014_phase4_drop_users_role.sql`                      | `users.role`                                                   |
| 0015 | `0015_phase4_drop_users_branch_id.sql`                 | `users.branch_id`                                              |
| 0016 | `0016_phase4_drop_service_catalog_base_price.sql`      | `service_catalog.base_price`                                   |
| 0017 | `0017_phase4_drop_patients_allergies_conditions.sql`   | `patients.allergies`, `patients.conditions`                    |
| 0018 | `0018_phase4_drop_staff_time_logs_legacy.sql`          | `staff_time_logs.float_amount`, `staff_time_logs.drawer_state` |
| 0019 | `0019_phase4_drop_clinical_orders_completed_by_id.sql` | `clinical_orders.completed_by_id`                              |
| 0020 | `0020_phase4_drop_lab_orders_result_file_url.sql`      | `lab_orders.result_file_url`                                   |
| 0021 | `0021_phase4_drop_inventory_transactions.sql`          | `inventory_transactions` table                                 |
| 0022 | `0022_phase4_drop_consent_records.sql`                 | `consent_records` table                                        |
| 0023 | `0023_phase4_notnull_backfilled_columns.sql`           | NOT NULL constraints on backfilled columns                     |

All statements use `IF EXISTS` so re-running a migration is idempotent.

---

## Monitoring window

After each migration:

1. Watch `/api/health` response for 72 hours — any 5xx degrades must be investigated
   before the next drop.
2. Tail Railway logs for `column does not exist` or `relation does not exist` errors.
3. If errors appear, **stop the drop sequence** and follow the Rollback procedure.

```bash
# Stream Railway logs (filter to errors only)
railway logs --service backend | grep -i "does not exist"
```

Only proceed to the next migration after a clean 72-hour window.

---

## Drop sequence

### 1 — `users.role`

**Replaces:** `user_roles` table (added Phase 1)

**Staleness query:**

```sql
SELECT count(*)
FROM users
WHERE role IS NOT NULL
  AND updated_at > now() - interval '7 days';
```

Expected result: `0`

**Grep proof:**

```bash
grep -r "users\.role\b" apps/ packages/ --include="*.ts" --include="*.sql" -l
```

Expected result: no output

**Migration — `0014_phase4_drop_users_role.sql`:**

```sql
ALTER TABLE users DROP COLUMN IF EXISTS role;
```

**Verification after drop:**

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'users' AND column_name = 'role';
-- Expected: 0 rows
```

**Rollback:** Point-in-time restore from snapshot taken in precondition step 4.
`ALTER TABLE users ADD COLUMN role text;` without the snapshot loses all historical
values — restore is the only safe path.

---

### 2 — `users.branch_id`

**Replaces:** `user_branches` join table + `users.primary_branch_id` (added Phase 1)

**Staleness query:**

```sql
SELECT count(*)
FROM users
WHERE branch_id IS NOT NULL
  AND updated_at > now() - interval '7 days';
```

Expected result: `0`

**Grep proof:**

```bash
grep -r "users\.branch_id\b" apps/ packages/ --include="*.ts" --include="*.sql" -l
```

Expected result: no output

**Migration — `0015_phase4_drop_users_branch_id.sql`:**

```sql
ALTER TABLE users DROP COLUMN IF EXISTS branch_id;
```

**Verification after drop:**

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'users' AND column_name = 'branch_id';
-- Expected: 0 rows
```

**Rollback:** Point-in-time restore from snapshot.

---

### 3 — `service_catalog.base_price`

**Replaces:** `service_prices` table (added Phase 1)

**Staleness query:**

```sql
SELECT count(*)
FROM service_catalog
WHERE base_price IS NOT NULL
  AND updated_at > now() - interval '7 days';
```

Expected result: `0`

**Grep proof:**

```bash
grep -r "base_price\b" apps/ packages/ --include="*.ts" --include="*.sql" -l
```

Expected result: no output (or only `service_prices` references — no `service_catalog.base_price`)

**Migration — `0016_phase4_drop_service_catalog_base_price.sql`:**

```sql
ALTER TABLE service_catalog DROP COLUMN IF EXISTS base_price;
```

**Verification after drop:**

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'service_catalog' AND column_name = 'base_price';
-- Expected: 0 rows
```

**Rollback:** Point-in-time restore from snapshot.

---

### 4 — `patients.allergies` and `patients.conditions`

**Replaces:** `patient_allergies` and `patient_conditions` rows (added Phase 1)

**Staleness query:**

```sql
SELECT count(*)
FROM patients
WHERE (allergies IS NOT NULL OR conditions IS NOT NULL)
  AND updated_at > now() - interval '7 days';
```

Expected result: `0`

**Grep proof:**

```bash
grep -r "patients\.allergies\|patients\.conditions\b" apps/ packages/ \
  --include="*.ts" --include="*.sql" -l
```

Expected result: no output

**Migration — `0017_phase4_drop_patients_allergies_conditions.sql`:**

```sql
ALTER TABLE patients DROP COLUMN IF EXISTS allergies;
ALTER TABLE patients DROP COLUMN IF EXISTS conditions;
```

**Verification after drop:**

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'patients'
  AND column_name IN ('allergies', 'conditions');
-- Expected: 0 rows
```

**Rollback:** Point-in-time restore from snapshot. Note that JSONB arrays in these
columns may not have been fully migrated to rows for all historical patients — validate
the `patient_allergies` and `patient_conditions` row counts match expectations before
dropping.

---

### 5 — `staff_time_logs.float_amount` and `staff_time_logs.drawer_state`

**Replaces:** `cash_drawer_sessions` table (added Phase 1)

**Staleness query:**

```sql
SELECT count(*)
FROM staff_time_logs
WHERE (float_amount IS NOT NULL OR drawer_state IS NOT NULL)
  AND created_at > now() - interval '7 days';
```

Expected result: `0`

**Grep proof:**

```bash
grep -r "float_amount\|drawer_state\b" apps/ packages/ --include="*.ts" --include="*.sql" -l
```

Expected result: no output

**Migration — `0018_phase4_drop_staff_time_logs_legacy.sql`:**

```sql
ALTER TABLE staff_time_logs DROP COLUMN IF EXISTS float_amount;
ALTER TABLE staff_time_logs DROP COLUMN IF EXISTS drawer_state;
```

**Verification after drop:**

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'staff_time_logs'
  AND column_name IN ('float_amount', 'drawer_state');
-- Expected: 0 rows
```

**Rollback:** Point-in-time restore from snapshot.

---

### 6 — `clinical_orders.completed_by_id`

**Replaces:** `clinical_orders.documented_by_id` + `clinical_orders.administered_by_id`
(added Phase 1)

**Staleness query:**

```sql
SELECT count(*)
FROM clinical_orders
WHERE completed_by_id IS NOT NULL
  AND created_at > now() - interval '7 days';
```

Expected result: `0`

**Grep proof:**

```bash
grep -r "completed_by_id\b" apps/ packages/ --include="*.ts" --include="*.sql" -l
```

Expected result: no output

**Migration — `0019_phase4_drop_clinical_orders_completed_by_id.sql`:**

```sql
ALTER TABLE clinical_orders DROP COLUMN IF EXISTS completed_by_id;
```

**Verification after drop:**

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'clinical_orders' AND column_name = 'completed_by_id';
-- Expected: 0 rows
```

**Rollback:** Point-in-time restore from snapshot.

---

### 7 — `lab_orders.result_file_url`

**Replaces:** `lab_orders.result_file_attachment_id` (added Phase 1)

**Staleness query:**

```sql
SELECT count(*)
FROM lab_orders
WHERE result_file_url IS NOT NULL
  AND created_at > now() - interval '7 days';
```

Expected result: `0`

**Grep proof:**

```bash
grep -r "result_file_url\b" apps/ packages/ --include="*.ts" --include="*.sql" -l
```

Expected result: no output

**Migration — `0020_phase4_drop_lab_orders_result_file_url.sql`:**

```sql
ALTER TABLE lab_orders DROP COLUMN IF EXISTS result_file_url;
```

**Verification after drop:**

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'lab_orders' AND column_name = 'result_file_url';
-- Expected: 0 rows
```

**Rollback:** Point-in-time restore from snapshot.

---

### 8 — Drop table `inventory_transactions`

**Replaces:** `inventory_movements` table (added Phase 1)

**Staleness query:**

```sql
SELECT count(*)
FROM inventory_transactions
WHERE created_at > now() - interval '7 days';
```

Expected result: `0`

**Grep proof:**

```bash
grep -r "inventory_transactions\b" apps/ packages/ --include="*.ts" --include="*.sql" -l
```

Expected result: no output

**Migration — `0021_phase4_drop_inventory_transactions.sql`:**

```sql
DROP TABLE IF EXISTS inventory_transactions;
```

**Verification after drop:**

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_name = 'inventory_transactions';
-- Expected: 0 rows
```

**Rollback:** Point-in-time restore from snapshot. Table drops are the most destructive
operation in this runbook — triple-check the grep proof before executing.

---

### 9 — Drop table `consent_records`

**Replaces:** `consents` table (added Phase 1)

**Staleness query:**

```sql
SELECT count(*)
FROM consent_records
WHERE created_at > now() - interval '7 days';
```

Expected result: `0`

**Grep proof:**

```bash
grep -r "consent_records\b" apps/ packages/ --include="*.ts" --include="*.sql" -l
```

Expected result: no output

**Migration — `0022_phase4_drop_consent_records.sql`:**

```sql
DROP TABLE IF EXISTS consent_records;
```

**Verification after drop:**

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_name = 'consent_records';
-- Expected: 0 rows
```

**Rollback:** Point-in-time restore from snapshot.

---

### 10 — Set NOT NULL on backfilled columns

These columns were backfilled during Phase 2/3 and are logically required. Setting NOT
NULL is the final structural assertion.

> **Prerequisite:** PR #131 must be merged before running this migration.

**Columns:**

| Table             | Column              |
| ----------------- | ------------------- |
| `patient_tags`    | `tag_definition_id` |
| `patients`        | `mrn`               |
| `inventory_lots`  | `manufacturer`      |
| `inventory_lots`  | `unit_cost`         |
| `notifications`   | `recipient_address` |
| `clinical_orders` | `patient_id`        |

**Staleness / null check (run for each column before migrating):**

```sql
-- Example for patient_tags.tag_definition_id
SELECT count(*)
FROM patient_tags
WHERE tag_definition_id IS NULL;
-- Expected: 0
```

Repeat for each column listed above. Any non-zero count means the backfill is
incomplete — do not proceed until backfill is re-run.

**Migration — `0023_phase4_notnull_backfilled_columns.sql`:**

```sql
ALTER TABLE patient_tags
  ALTER COLUMN tag_definition_id SET NOT NULL;

ALTER TABLE patients
  ALTER COLUMN mrn SET NOT NULL;

ALTER TABLE inventory_lots
  ALTER COLUMN manufacturer SET NOT NULL;

ALTER TABLE inventory_lots
  ALTER COLUMN unit_cost SET NOT NULL;

ALTER TABLE notifications
  ALTER COLUMN recipient_address SET NOT NULL;

ALTER TABLE clinical_orders
  ALTER COLUMN patient_id SET NOT NULL;
```

**Verification after migration:**

```sql
SELECT table_name, column_name, is_nullable
FROM information_schema.columns
WHERE (table_name, column_name) IN (
  ('patient_tags',    'tag_definition_id'),
  ('patients',        'mrn'),
  ('inventory_lots',  'manufacturer'),
  ('inventory_lots',  'unit_cost'),
  ('notifications',   'recipient_address'),
  ('clinical_orders', 'patient_id')
)
ORDER BY table_name, column_name;
-- Expected: is_nullable = 'NO' for all rows
```

**Rollback:** `ALTER TABLE <t> ALTER COLUMN <c> DROP NOT NULL;` for each affected
column. No data is lost — this is the only reversible operation in the sequence.

---

## Rollback procedure

> Drops of columns and tables are **not reversible** without a point-in-time restore.

1. Open Railway dashboard → your backend service → Backups.
2. Select the snapshot taken immediately before the drop (recorded in the Decision Log
   below).
3. Click "Restore" and confirm. Railway will provision a new instance from the snapshot.
4. Re-point your custom domain / DNS to the restored instance if needed.
5. Verify the restored table/column exists:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = '<table>' AND column_name = '<column>';
```

6. Investigate the root cause before re-running the migration sequence.

---

## Decision log template

Fill in one row per drop executed. Keep this file updated — it is the audit trail for
regulatory and incident review.

| #   | Drop target                                     | Date | Approver | Snapshot ID | Staleness query result | Grep clean? | Verification result | Rollback notes |
| --- | ----------------------------------------------- | ---- | -------- | ----------- | ---------------------- | ----------- | ------------------- | -------------- |
| 1   | `users.role`                                    |      |          |             |                        |             |                     |                |
| 2   | `users.branch_id`                               |      |          |             |                        |             |                     |                |
| 3   | `service_catalog.base_price`                    |      |          |             |                        |             |                     |                |
| 4   | `patients.allergies` / `conditions`             |      |          |             |                        |             |                     |                |
| 5   | `staff_time_logs.float_amount` / `drawer_state` |      |          |             |                        |             |                     |                |
| 6   | `clinical_orders.completed_by_id`               |      |          |             |                        |             |                     |                |
| 7   | `lab_orders.result_file_url`                    |      |          |             |                        |             |                     |                |
| 8   | `inventory_transactions` (table)                |      |          |             |                        |             |                     |                |
| 9   | `consent_records` (table)                       |      |          |             |                        |             |                     |                |
| 10  | NOT NULL on backfilled columns                  |      |          |             |                        |             |                     |                |
