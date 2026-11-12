-- =============================================================================
-- 0005_modern_pg.sql — CITEXT, GENERATED full_name, EXCLUDE, partial uniques
-- =============================================================================
-- Postgres-native features that Drizzle can't express cleanly:
--   1. CITEXT for case-insensitive emails (users, patients).
--   2. patients.full_name as a GENERATED column for fuzzy search.
--   3. pg_trgm GIN on full_name (excluding soft-deleted rows).
--   4. Partial UNIQUE on patients.mrn — soft-deleted MRNs can be reused.
--   5. EXCLUDE constraints — appointments provider double-booking,
--      service_prices effective-date overlap.
--   6. COMMENT ON TABLE — naming-overlap clarity.
--
-- Required extensions (citext, pg_trgm, btree_gist) are created in 0001.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. CITEXT email columns (case-insensitive equality / hashing)
-- Idempotent: only run the type-change when the column is still text.
-- A previously-deployed DB already has email as citext AND has
-- fhir_patient_view (from 0006) referencing patients.email — Postgres
-- refuses ALTER COLUMN TYPE on a column with a dependent view, even if
-- the new type matches the current type. Skip the ALTER on re-runs.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF (
    SELECT udt_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users' AND column_name='email'
  ) <> 'citext' THEN
    DROP INDEX IF EXISTS users_tenant_email_idx;
    ALTER TABLE users ALTER COLUMN email TYPE citext USING email::citext;
    CREATE UNIQUE INDEX users_tenant_email_idx ON users (tenant_id, email);
  END IF;

  IF (
    SELECT udt_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='patients' AND column_name='email'
  ) <> 'citext' THEN
    ALTER TABLE patients ALTER COLUMN email TYPE citext USING email::citext;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. patients.full_name (GENERATED) + 3. pg_trgm GIN
-- ---------------------------------------------------------------------------

-- schema.ts declares full_name as a regular text column (Drizzle has no
-- GENERATED helper for derived strings). Drop + re-add as GENERATED so the
-- column stays in sync automatically. Idempotent: only rebuild when the
-- column isn't already a GENERATED column.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='patients' AND column_name='full_name'
      AND is_generated = 'ALWAYS'
  ) THEN
    ALTER TABLE patients DROP COLUMN IF EXISTS full_name CASCADE;
    ALTER TABLE patients
      ADD COLUMN full_name text
        GENERATED ALWAYS AS (
          trim(
            coalesce(first_name, '') || ' ' ||
            coalesce(middle_name || ' ', '') ||
            coalesce(last_name, '')
          )
        ) STORED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS patients_full_name_trgm_idx
  ON patients
  USING gin (full_name gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Partial UNIQUE on patients.mrn — soft-deleted MRNs are reusable.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS patients_tenant_mrn_uniq
  ON patients (tenant_id, mrn)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 5. EXCLUDE constraints
-- ---------------------------------------------------------------------------

-- 5a. service_prices — no overlapping effective date ranges per
--     (tenant, service, branch, payer, product, patient_segment). NULL
--     branch/payer/product collapse to 0 (no real bigserial value is 0); NULL
--     patient_segment collapses to '__ALL__' so unscoped prices are unique
--     against scoped prices too. branch_id / payer_id / product_id are bigint
--     post-ID-redesign.
--
--     `product_id` is part of the key because a brand-specific price
--     (service_prices.product_id → products.id, e.g. Speeda above the
--     Abhayrab-based ARV PEP base rate) legitimately coexists with the
--     brand-agnostic row over the SAME date range. Without it in the key the
--     brand row is an exclusion violation and brand pricing cannot be stored
--     at all — which is exactly what happened when the column was first added.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='service_prices_no_overlap'
  ) THEN
    ALTER TABLE service_prices
      ADD CONSTRAINT service_prices_no_overlap
      EXCLUDE USING gist (
        tenant_id            WITH =,
        service_id           WITH =,
        COALESCE(branch_id,       0) WITH =,
        COALESCE(payer_id,        0) WITH =,
        COALESCE(product_id,      0) WITH =,
        COALESCE(patient_segment, '__ALL__') WITH =,
        daterange(effective_from, effective_to, '[)') WITH &&
      )
      WHERE (deleted_at IS NULL);
  END IF;
END $$;

-- 5b. appointments — no provider double-booking. Two equivalent constraints
--     intentionally retained (current schema has both):
--       * appointments_no_provider_double_book — uses inline tstzrange()
--         and a tenant_id key (cross-tenant providers couldn't double-book
--         anyway, but the key keeps the index narrow per tenant).
--       * appointments_provider_no_overlap — uses the `during` GENERATED
--         column and excludes Cancelled / NoShow rows.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='appointments_no_provider_double_book'
  ) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_no_provider_double_book
      EXCLUDE USING gist (
        tenant_id   WITH =,
        provider_id WITH =,
        tstzrange(scheduled_start_at, scheduled_end_at, '[)') WITH &&
      )
      WHERE (provider_id IS NOT NULL AND deleted_at IS NULL);
  END IF;
END $$;

-- `during` GENERATED column derived from the existing scheduled_*_at columns.
-- schema.ts declares it as `text('during')` (Drizzle has no tstzrange type);
-- drop + re-add as tstzrange so the EXCLUDE constraint below typechecks.
-- Idempotent: only rebuild when `during` is the wrong type. CASCADE drops
-- the dependent EXCLUDE constraint on re-runs; we re-add it below.
DO $$
BEGIN
  IF (
    SELECT udt_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='appointments' AND column_name='during'
  ) IS DISTINCT FROM 'tstzrange' THEN
    ALTER TABLE appointments DROP COLUMN IF EXISTS during CASCADE;
    ALTER TABLE appointments
      ADD COLUMN during tstzrange
        GENERATED ALWAYS AS (
          tstzrange(scheduled_start_at, scheduled_end_at, '[)')
        ) STORED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='appointments_provider_no_overlap'
  ) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_provider_no_overlap
      EXCLUDE USING gist (
        provider_id WITH =,
        during      WITH &&
      )
      WHERE (
        provider_id IS NOT NULL
        AND status NOT IN ('Cancelled', 'NoShow')
        AND deleted_at IS NULL
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Documentation COMMENTs — name-overlap clarity for tables that confuse
--    readers (payer_profiles vs payer_contracts, etc.).
-- ---------------------------------------------------------------------------

COMMENT ON TABLE payer_profiles IS
  'HMO/Corp partner master data (name, contact, terms). '
  'Represents the payer organisation, not a contract or rate schedule.';

COMMENT ON TABLE payer_contracts IS
  'Service contracts with a payer (pricing, coverage, segments). '
  'One payer_profile may have multiple contracts (e.g. per product line or year).';

COMMENT ON TABLE patient_emergency_contacts IS
  'Contact info for guardians / next-of-kin. Separate from insurance/payer records. '
  'A minor patient may have multiple rows (e.g. mother + school nurse).';

COMMENT ON TABLE clinical_orders_status_history IS
  'Append-only status transitions for clinical_orders. '
  'Never update rows here; each transition inserts a new row with a timestamp.';

COMMENT ON TABLE clinical_order_schedule_changes IS
  'PSO/protocol schedule reflows — insertions, advances, skips. '
  'Records the original and revised dates whenever a dose schedule is modified.';

COMMENT ON TABLE inventory_movements IS
  'Granular stock movements (dispense, receive, adjust, transfer, expire). '
  'Source of truth for FEFO deductions. Replaces the dropped inventory_transactions table.';

COMMENT ON TABLE inventory_lot_balances IS
  'Materialised per-lot quantity (units on hand). '
  'Maintained by trigger; do not write directly from application code — '
  'use inventory_movements to drive changes.';

-- ─── Idempotency partial unique indexes (folded from 0027_idempotency_unique.sql) ─
-- CONC-1: Prevent duplicate rows on concurrent same-Idempotency-Key requests.

CREATE UNIQUE INDEX IF NOT EXISTS transactions_tenant_idempotency_uniq
  ON transactions (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payments_tenant_idempotency_uniq
  ON payments (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS clinical_orders_tenant_idempotency_uniq
  ON clinical_orders (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ─── DB-1: patients_tenant_mrn_uniq — partial index (from 0028_db_remediation.sql) ─
-- Fix full unique → partial (WHERE deleted_at IS NULL) so soft-deleted MRNs are reusable.

DROP INDEX IF EXISTS patients_tenant_mrn_uniq;
CREATE UNIQUE INDEX patients_tenant_mrn_uniq
  ON patients (tenant_id, mrn)
  WHERE deleted_at IS NULL;

-- ─── DB-2: transaction_items_txn_service_uniq — include performed_by_id (from 0028_db_remediation.sql) ─
-- Dedupe same-service lines on one transaction, distinguished by physician.
-- Multi-patient (family billing): two patients legitimately get the SAME
-- service on one transaction, so `patient_id` is part of the key. NULLS NOT
-- DISTINCT keeps NULL (= primary patient) deduped against itself, so a true
-- duplicate primary line is still rejected while primary-vs-secondary differ.
DROP INDEX IF EXISTS transaction_items_txn_service_uniq;
CREATE UNIQUE INDEX transaction_items_txn_service_uniq
  ON transaction_items (tenant_id, transaction_id, service_id, patient_id, performed_by_id)
  NULLS NOT DISTINCT
  WHERE performed_by_id IS NOT NULL;

DROP INDEX IF EXISTS transaction_items_txn_service_no_physician_uniq;
CREATE UNIQUE INDEX transaction_items_txn_service_no_physician_uniq
  ON transaction_items (tenant_id, transaction_id, service_id, patient_id)
  NULLS NOT DISTINCT
  WHERE performed_by_id IS NULL;

-- ─── CONC-4: cash_drawer_sessions partial unique (from 0028_db_remediation.sql) ─
-- A clinic branch operates one shared physical drawer. Enforce that invariant
-- at the database boundary so two different users cannot race two sessions
-- open and split payments across them.

DROP INDEX IF EXISTS cash_drawer_sessions_one_open_per_user_branch;
CREATE UNIQUE INDEX IF NOT EXISTS cash_drawer_sessions_one_open_per_branch
  ON cash_drawer_sessions (tenant_id, branch_id)
  WHERE state = 'Open';

-- ─── CONC-5: payments partial unique on reference_number (from 0028_db_remediation.sql) ─
-- Prevent duplicate same-reference payments. Excludes voided rows: without
-- the voided_at filter, correcting a payment while keeping the same
-- reference number is permanently blocked by the row that was just voided.

DROP INDEX IF EXISTS payments_tenant_txn_method_ref_uniq;
CREATE UNIQUE INDEX payments_tenant_txn_method_ref_uniq
  ON payments (tenant_id, transaction_id, method, reference_number)
  WHERE reference_number IS NOT NULL AND voided_at IS NULL;
