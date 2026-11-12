-- =============================================================================
-- 0001_extensions_and_rls.sql — partitioning, utility triggers, RLS
-- =============================================================================
-- Post-ID-redesign (W1.B) rewrite:
--   - Extensions are now declared at the top of 0000_initial.sql.
--   - audit_logs is re-created here as PARTITION BY RANGE (timestamp), since
--     PG requires the partition key in the PK. The bigserial id stays.
--   - Self-referencing / circular FKs all moved into 0000_initial.sql.
--   - branch_isolation policy casts the app.current_branch_id GUC (text) to
--     bigint since branch_id is now a bigint column.
--   - write_status_history trigger no longer mints text IDs (bigserial default).
--   - write_clinical_order_schedule_change no longer concatenates text IDs.
--   - feature_flags_uniq uses COALESCE(branch_id, 0) since NULLs in composite
--     PKs don't dedupe in Postgres.
--
-- Idempotent: CREATE OR REPLACE / DROP IF EXISTS / DO blocks guarded by
-- pg_constraint / information_schema lookups. Safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extensions (idempotent — also created in 0000_initial.sql)
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "unaccent";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- ---------------------------------------------------------------------------
-- 2. audit_logs — drop the plain table from 0000 and recreate as PARTITION BY
--    RANGE (timestamp). The bigserial id stays — the partition key must be in
--    the PK, so the PK becomes (id, timestamp) on the partitioned table.
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS audit_logs CASCADE;

CREATE TABLE audit_logs (
    id BIGSERIAL NOT NULL,
    tenant_id TEXT NOT NULL,
    user_id BIGINT,
    session_id BIGINT,
    correlation_id TEXT,
    action audit_action NOT NULL,
    entity_type TEXT NOT NULL,
    -- Stores display_id of the audited row (text). NULL when the audited row
    -- has no display_id (junction tables, status history) — we then fall back
    -- to NEW.id::text. See 0002 audit_log_changes() for the logic.
    entity_id TEXT,
    -- Denormalized copy of the audited row's display_id (populated by the trigger).
    entity_display_id TEXT,
    branch_id BIGINT,
    ip_address TEXT,
    user_agent TEXT,
    changes JSONB,
    metadata JSONB,
    chain_sequence BIGINT,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, "timestamp")
) PARTITION BY RANGE ("timestamp");

-- Pre-create 18 months of partitions starting 2026-01.
-- The cron procedure in 0007_retention_procs.sql renews the runway monthly.
DO $$
DECLARE
  start_date DATE := '2026-01-01';
  end_date   DATE;
  part_name  TEXT;
BEGIN
  FOR i IN 0..17 LOOP
    end_date  := start_date + INTERVAL '1 month';
    part_name := 'audit_logs_' || to_char(start_date, 'YYYY_MM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
      part_name, start_date, end_date
    );
    start_date := end_date;
  END LOOP;
END;
$$;

CREATE TABLE IF NOT EXISTS audit_logs_default PARTITION OF audit_logs DEFAULT;

CREATE INDEX audit_logs_tenant_entity_idx ON audit_logs (tenant_id, entity_type, entity_id);
CREATE INDEX audit_logs_tenant_user_idx   ON audit_logs (tenant_id, user_id, "timestamp");
CREATE INDEX audit_logs_timestamp_idx     ON audit_logs ("timestamp");
CREATE INDEX IF NOT EXISTS audit_logs_correlation_idx
  ON audit_logs (correlation_id) WHERE correlation_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2b. group_bills — payer AR identity over the existing transactions engine.
-- The transaction remains the sole owner of totals, payments, void/refund,
-- inventory fan-out and day-summary effects. This table intentionally carries
-- no money or status columns, so it cannot drift from its transaction.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS group_bills (
  id BIGSERIAL PRIMARY KEY,
  display_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  branch_id BIGINT NOT NULL REFERENCES branches(id),
  transaction_id BIGINT NOT NULL UNIQUE REFERENCES transactions(id),
  payer_id BIGINT NOT NULL REFERENCES payer_profiles(id),
  reference_number TEXT,
  idempotency_key TEXT,
  row_version INTEGER NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_id BIGINT REFERENCES users(id)
);

-- Keep post-0000 group-bill shape idempotent even if a local database has a
-- pre-existing table from an earlier supplemental run.
ALTER TABLE group_bills ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE group_bills ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_bills_display_id_format') THEN
    ALTER TABLE group_bills ADD CONSTRAINT group_bills_display_id_format
      CHECK (display_id ~ '^GBL_[0-9A-HJKMNPQRSTVWXYZ]{8}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_bills_reference_number_length') THEN
    ALTER TABLE group_bills ADD CONSTRAINT group_bills_reference_number_length
      CHECK (reference_number IS NULL OR char_length(reference_number) <= 120);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS group_bills_tenant_id_uniq
  ON group_bills (tenant_id, id);
CREATE INDEX IF NOT EXISTS group_bills_tenant_payer_idx
  ON group_bills (tenant_id, payer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS group_bills_tenant_branch_idx
  ON group_bills (tenant_id, branch_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS group_bills_tenant_idempotency_uniq
  ON group_bills (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Utility trigger functions
-- ---------------------------------------------------------------------------

-- 3a. set_updated_at — bumps updated_at and (if present) row_version.
-- DB-7: uses pg_attribute (OID lookup) instead of information_schema join to avoid
-- a per-row catalog table scan on every UPDATE across ~45 tables.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
DECLARE
  has_row_version boolean;
BEGIN
  NEW.updated_at = now();
  -- Check pg_attribute directly (single-table OID lookup, no information_schema join).
  SELECT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = TG_RELID
      AND attname   = 'row_version'
      AND attnum    > 0
      AND NOT attisdropped
  ) INTO has_row_version;
  IF has_row_version THEN
    NEW.row_version = COALESCE(OLD.row_version, 0) + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3b. patients.search_vector — ts_vector composed from name + contact.
CREATE OR REPLACE FUNCTION patients_search_vector_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', unaccent(coalesce(NEW.last_name, ''))), 'A') ||
    setweight(to_tsvector('simple', unaccent(coalesce(NEW.first_name, ''))), 'A') ||
    setweight(to_tsvector('simple', unaccent(coalesce(NEW.middle_name, ''))), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.contact_number, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(NEW.email::text, '')), 'C');
  RETURN NEW;
END;
$$;

-- 3c. service_catalog.search_vector — name / code.
CREATE OR REPLACE FUNCTION service_catalog_search_vector_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', unaccent(coalesce(NEW.name, ''))), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.code, '')), 'A');
  RETURN NEW;
END;
$$;

-- 3d. write_status_history — generic helper for *_status_history tables.
--     bigserial id defaults; entity_id is the parent's bigint PK (cast to bigint).
--     TG_ARGV[0] = history table name; TG_ARGV[1] = status column (default 'status').
CREATE OR REPLACE FUNCTION write_status_history() RETURNS trigger AS $$
DECLARE
  v_history_table text := TG_ARGV[0];
  v_status_column text := COALESCE(TG_ARGV[1], 'status');
  v_old_status    text;
  v_new_status    text;
  v_entity_id     bigint;
  v_changed_by    bigint;
BEGIN
  EXECUTE format('SELECT ($1).%I::text, ($2).%I::text, ($1).id',
                 v_status_column, v_status_column)
    USING OLD, NEW
    INTO v_old_status, v_new_status, v_entity_id;

  IF v_old_status IS DISTINCT FROM v_new_status THEN
    v_changed_by := NULLIF(current_setting('app.current_user_id', true), '')::bigint;
    EXECUTE format(
      'INSERT INTO %I (tenant_id, entity_id, from_status, to_status, changed_at, changed_by_id)
       VALUES ($1, $2, $3, $4, now(), $5)',
      v_history_table
    ) USING
      NEW.tenant_id,
      v_entity_id,
      v_old_status,
      v_new_status,
      v_changed_by;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3e. write_clinical_order_schedule_change — fires when current_scheduled_date changes.
--     bigserial id defaults; no more text-id concatenation.
CREATE OR REPLACE FUNCTION write_clinical_order_schedule_change() RETURNS trigger AS $$
BEGIN
  IF OLD.current_scheduled_date IS DISTINCT FROM NEW.current_scheduled_date THEN
    INSERT INTO clinical_order_schedule_changes
      (tenant_id, clinical_order_id, old_date, new_date, reason, changed_at, changed_by_id)
    VALUES (
      NEW.tenant_id,
      NEW.id,
      OLD.current_scheduled_date,
      NEW.current_scheduled_date,
      NULL,
      now(),
      NULLIF(current_setting('app.current_user_id', true), '')::bigint
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3f. maintain_lot_balances — keeps inventory_lot_balances in sync with
--     each insert into inventory_movements.
CREATE OR REPLACE FUNCTION maintain_lot_balances() RETURNS trigger AS $$
DECLARE
  v_lot inventory_lots%ROWTYPE;
BEGIN
  SELECT * INTO v_lot FROM inventory_lots WHERE id = NEW.lot_id;

  -- UPDATE-first, INSERT-if-missing. Deliberately NOT `INSERT … ON CONFLICT`:
  -- Postgres evaluates a table's CHECK constraints
  -- (`inventory_lot_balances_quantity_on_hand_nonneg`, see 0003) against the
  -- *candidate* insert tuple BEFORE the ON CONFLICT arbiter can redirect to the
  -- DO UPDATE branch. An "Out" movement carries a negative quantity_delta, so the
  -- candidate row (quantity_on_hand = NEW.quantity_delta < 0) trips the
  -- non-negative CHECK and the whole administer/deduct transaction errors out —
  -- even though existing_balance + delta would be perfectly valid. Updating the
  -- existing row first evaluates the CHECK against the *resulting* balance; the
  -- INSERT path only runs for a lot's first-ever movement (always a positive
  -- stock-in). A genuine over-deduction still (correctly) raises 23514 on the
  -- UPDATE result.
  UPDATE inventory_lot_balances SET
    quantity_on_hand   = quantity_on_hand   + NEW.quantity_delta,
    quantity_available = quantity_available + NEW.quantity_delta,
    last_movement_at   = NEW.performed_at,
    updated_at         = now()
  WHERE lot_id = NEW.lot_id;

  IF NOT FOUND THEN
    INSERT INTO inventory_lot_balances
      (lot_id, tenant_id, branch_id, product_id,
       quantity_on_hand, quantity_reserved, quantity_available,
       last_movement_at, weighted_average_cost, updated_at)
    VALUES
      (NEW.lot_id, NEW.tenant_id, NEW.branch_id, v_lot.product_id,
       NEW.quantity_delta, 0, NEW.quantity_delta,
       NEW.performed_at, NEW.unit_cost_snapshot, now());
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3g. sync_transaction_amounts — recompute transactions.amount_paid from
--     payments. amount_outstanding is GENERATED (see 0004), recomputes auto.
--     transaction_id is now bigint.
CREATE OR REPLACE FUNCTION sync_transaction_amounts() RETURNS TRIGGER AS $$
DECLARE
  v_txn_id bigint;
  v_paid   numeric(12,2);
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_txn_id := OLD.transaction_id;
  ELSE
    v_txn_id := NEW.transaction_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM transactions WHERE id = v_txn_id) THEN
    RETURN NULL;
  END IF;

  -- Voided rows (voided_at IS NOT NULL) are excluded: correcting a payment's
  -- method is void-the-row + insert-replacement, so a voided row's amount
  -- must not double-count alongside its replacement.
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM payments
   WHERE transaction_id = v_txn_id
     AND voided_at IS NULL;

  v_paid := GREATEST(v_paid, 0);

  UPDATE transactions
     SET amount_paid = v_paid,
         updated_at  = now()
   WHERE id = v_txn_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 4. Attach utility triggers
-- ---------------------------------------------------------------------------

-- 4a. set_updated_at on every table that has updated_at.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants', 'branches', 'users', 'staff_time_logs', 'patients',
    'service_catalog', 'payer_profiles', 'standing_order_templates',
    'encounters', 'patient_standing_orders', 'clinical_orders',
    'inventory_lots', 'transactions', 'transaction_items', 'transaction_patients', 'payments', 'group_bills',
    'partner_laboratories', 'lab_orders', 'feature_flags', 'notifications',
    'locations', 'cash_drawer_sessions',
    'patient_emergency_contacts', 'patient_allergies', 'patient_conditions',
    'patient_external_immunizations', 'tag_definitions',
    'service_prices', 'payer_contracts',
    'appointments', 'encounter_vitals', 'encounter_diagnoses',
    'consents', 'adverse_events',
    'inventory_lot_balances', 'product_recalls',
    'claims', 'claim_items', 'notification_templates',
    'products', 'service_categories',
    'bite_incidents', 'animal_observation_followups',
    'inventory_transfers',
    'platform_users',
    'cash_deposits'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at
       BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t, t
    );
  END LOOP;
END;
$$;

-- 4b. patients tsvector trigger
DROP TRIGGER IF EXISTS trg_patients_search_vector ON patients;
CREATE TRIGGER trg_patients_search_vector
BEFORE INSERT OR UPDATE ON patients
FOR EACH ROW EXECUTE FUNCTION patients_search_vector_update();

-- 4c. service_catalog tsvector trigger
DROP TRIGGER IF EXISTS trg_service_catalog_search_vector ON service_catalog;
CREATE TRIGGER trg_service_catalog_search_vector
BEFORE INSERT OR UPDATE ON service_catalog
FOR EACH ROW EXECUTE FUNCTION service_catalog_search_vector_update();

-- 4d. write_status_history triggers
DROP TRIGGER IF EXISTS trg_psohist ON patient_standing_orders;
CREATE TRIGGER trg_psohist
  AFTER UPDATE ON patient_standing_orders
  FOR EACH ROW EXECUTE FUNCTION write_status_history('patient_standing_orders_status_history');

DROP TRIGGER IF EXISTS trg_cohist ON clinical_orders;
CREATE TRIGGER trg_cohist
  AFTER UPDATE ON clinical_orders
  FOR EACH ROW EXECUTE FUNCTION write_status_history('clinical_orders_status_history');

DROP TRIGGER IF EXISTS trg_enchist ON encounters;
CREATE TRIGGER trg_enchist
  AFTER UPDATE ON encounters
  FOR EACH ROW EXECUTE FUNCTION write_status_history('encounters_status_history');

DROP TRIGGER IF EXISTS trg_txnhist ON transactions;
CREATE TRIGGER trg_txnhist
  AFTER UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION write_status_history('transactions_status_history');

DROP TRIGGER IF EXISTS trg_claimhist ON claims;
CREATE TRIGGER trg_claimhist
  AFTER UPDATE ON claims
  FOR EACH ROW EXECUTE FUNCTION write_status_history('claims_status_history');

DROP TRIGGER IF EXISTS trg_labhist ON lab_orders;
CREATE TRIGGER trg_labhist
  AFTER UPDATE ON lab_orders
  FOR EACH ROW EXECUTE FUNCTION write_status_history('lab_orders_status_history');

DROP TRIGGER IF EXISTS trg_appthist ON appointments;
CREATE TRIGGER trg_appthist
  AFTER UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION write_status_history('appointments_status_history');

-- 4e. clinical_orders schedule-change trigger
DROP TRIGGER IF EXISTS trg_clinical_orders_schedule_change ON clinical_orders;
CREATE TRIGGER trg_clinical_orders_schedule_change
  AFTER UPDATE ON clinical_orders
  FOR EACH ROW EXECUTE FUNCTION write_clinical_order_schedule_change();

-- 4f. inventory_movements → maintain_lot_balances
DROP TRIGGER IF EXISTS trg_inventory_movements_balance ON inventory_movements;
CREATE TRIGGER trg_inventory_movements_balance
  AFTER INSERT ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION maintain_lot_balances();

-- 4g. payments → sync_transaction_amounts
DROP TRIGGER IF EXISTS trg_sync_txn_amounts ON payments;
CREATE TRIGGER trg_sync_txn_amounts
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION sync_transaction_amounts();

-- ---------------------------------------------------------------------------
-- 5. Performance indexes that aren't expressible as plain Drizzle indexes
-- ---------------------------------------------------------------------------

-- FEFO partial index — non-quarantined, in-stock lots ordered by expiry.
DROP INDEX IF EXISTS idx_inventory_lots_fefo;
CREATE INDEX idx_inventory_lots_fefo
  ON inventory_lots (product_id, branch_id, expiry_date, quantity_on_hand)
  WHERE quantity_on_hand::numeric > 0 AND is_quarantined = false;

-- Soft-delete partial indexes
CREATE INDEX IF NOT EXISTS patients_active_idx
  ON patients (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS encounters_active_idx
  ON encounters (tenant_id, patient_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS clinical_orders_active_idx
  ON clinical_orders (tenant_id, patient_standing_order_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS service_catalog_active_idx
  ON service_catalog (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS transactions_active_idx
  ON transactions (tenant_id) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 6. feature_flags uniqueness — branch_id NULL collapses for tenant-wide rows
-- ---------------------------------------------------------------------------
-- Composite PK (tenant_id, branch_id, key) is declared in 0000, but Postgres
-- treats NULL as distinct from NULL in composite keys, so two
-- tenant-wide rows for the same (tenant, key) could both insert. Add a partial
-- unique to catch that.
DROP INDEX IF EXISTS feature_flags_uniq;
CREATE UNIQUE INDEX feature_flags_uniq
  ON feature_flags (tenant_id, key)
  WHERE branch_id IS NULL;

-- ---------------------------------------------------------------------------
-- 7a. RLS — enable + tenant_isolation policy on every tenant-scoped table.
--     Policy includes platform-admin bypass (app.is_platform_admin GUC).
--     tenant_id stays TEXT (tenants.id is the slug), so no cast needed.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'branches', 'users', 'refresh_tokens', 'staff_time_logs',
    'patients', 'service_catalog', 'payer_profiles',
    'standing_order_templates', 'standing_order_template_items',
    'encounters', 'patient_standing_orders', 'clinical_orders',
    'inventory_lots',
    'transactions', 'transaction_items', 'transaction_patients', 'payments', 'group_bills',
    'partner_laboratories', 'lab_orders',
    'audit_logs', 'feature_flags', 'notifications', 'patient_tags',
    'user_branches', 'user_roles', 'user_sessions', 'password_reset_tokens',
    'locations', 'cash_drawer_sessions',
    'patient_emergency_contacts', 'patient_allergies', 'patient_conditions',
    'patient_external_immunizations', 'tag_definitions',
    'service_prices', 'payer_contracts',
    'appointments', 'appointments_status_history',
    'encounter_vitals', 'encounter_diagnoses',
    'consents', 'adverse_events',
    'clinical_order_schedule_changes',
    'clinical_orders_status_history',
    'encounters_status_history',
    'patient_standing_orders_status_history',
    'inventory_movements', 'inventory_lot_balances', 'product_recalls',
    'transactions_status_history',
    'claims', 'claims_status_history', 'claim_items',
    'lab_orders_status_history',
    'attachments', 'notification_templates',
    'approval_decisions', 'approval_requests',
    'phi_access_log', 'domain_events',
    'products', 'service_categories', 'service_bundle_items',
    'service_eligible_products',
    'day_summary_snapshots',
    'bite_incidents', 'animal_observation_followups',
    'inventory_transfers',
    -- Folded in from deleted post-#228 supplementals:
    'pin_attempts',                  -- ex-0021
    'cross_branch_access_grants',    -- ex-0026
    'tenant_counters',               -- ex-0012
    -- Folded in from deleted post-2026-05-07 supplementals:
    'cash_deposits',                    -- ex-0010
    'payer_price_adjustment_exclusions' -- ex-0011
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = t
    ) THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
       USING (
         current_setting(''app.is_platform_admin'', true) = ''true''
         OR tenant_id = current_setting(''app.current_tenant_id'', true)
       )
       WITH CHECK (
         current_setting(''app.is_platform_admin'', true) = ''true''
         OR tenant_id = current_setting(''app.current_tenant_id'', true)
       )',
      t
    );
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7b. RLS — branch_isolation policy on tenant-scoped tables with a branch_id
--     column. branch_id is bigint, GUC is text — cast with NULLIF/::bigint.
--     Empty/NULL GUC means "no branch filter" (cross-branch).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'branches', 'users', 'staff_time_logs',
    'patients', 'service_catalog', 'payer_profiles',
    'standing_order_templates', 'standing_order_template_items',
    'encounters', 'patient_standing_orders', 'clinical_orders',
    'inventory_lots',
    'transactions', 'transaction_items', 'payments', 'group_bills',
    'partner_laboratories', 'lab_orders',
    'feature_flags', 'notifications',
    'user_branches', 'user_roles', 'user_sessions',
    'locations', 'cash_drawer_sessions',
    'service_prices',
    'appointments',
    'encounter_vitals', 'encounter_diagnoses',
    'consents', 'adverse_events',
    'clinical_order_schedule_changes',
    'inventory_movements', 'inventory_lot_balances', 'product_recalls',
    'claims', 'claim_items',
    'attachments',
    'day_summary_snapshots',
    'cash_deposits'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = t AND column_name = 'branch_id'
    ) THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS branch_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY branch_isolation ON %I
       USING (
         current_setting(''app.is_platform_admin'', true) = ''true''
         OR NULLIF(current_setting(''app.current_branch_id'', true), '''') IS NULL
         OR branch_id = NULLIF(current_setting(''app.current_branch_id'', true), '''')::bigint
       )
       WITH CHECK (
         current_setting(''app.is_platform_admin'', true) = ''true''
         OR NULLIF(current_setting(''app.current_branch_id'', true), '''') IS NULL
         OR branch_id = NULLIF(current_setting(''app.current_branch_id'', true), '''')::bigint
       )',
      t
    );
  END LOOP;
END;
$$;

-- 8. Append-only RESTRICTIVE policies

DROP POLICY IF EXISTS audit_logs_no_update ON audit_logs;
CREATE POLICY audit_logs_no_update ON audit_logs
  AS RESTRICTIVE FOR UPDATE USING (false);

DROP POLICY IF EXISTS audit_logs_no_delete ON audit_logs;
CREATE POLICY audit_logs_no_delete ON audit_logs
  AS RESTRICTIVE FOR DELETE USING (false);

DROP POLICY IF EXISTS phi_access_log_no_update ON phi_access_log;
CREATE POLICY phi_access_log_no_update ON phi_access_log
  AS RESTRICTIVE FOR UPDATE USING (false);

DROP POLICY IF EXISTS phi_access_log_no_delete ON phi_access_log;
CREATE POLICY phi_access_log_no_delete ON phi_access_log
  AS RESTRICTIVE FOR DELETE USING (false);

DROP POLICY IF EXISTS domain_events_no_delete ON domain_events;
CREATE POLICY domain_events_no_delete ON domain_events
  AS RESTRICTIVE FOR DELETE USING (false);

-- ---------------------------------------------------------------------------
-- 9. Analytics schema — internal/migrator-only. No RLS by design.
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS analytics.dim_date (
  date_id    INT     PRIMARY KEY,
  date       DATE    NOT NULL,
  year       INT     NOT NULL,
  month      INT     NOT NULL,
  day        INT     NOT NULL,
  quarter    INT     NOT NULL,
  iso_week   INT     NOT NULL,
  iso_year   INT     NOT NULL,
  is_weekend BOOL    NOT NULL DEFAULT FALSE,
  is_holiday BOOL    NOT NULL DEFAULT FALSE
);

INSERT INTO analytics.dim_date (
  date_id, date, year, month, day, quarter, iso_week, iso_year, is_weekend
)
SELECT
  to_char(d, 'YYYYMMDD')::INT,
  d::DATE,
  EXTRACT(YEAR    FROM d)::INT,
  EXTRACT(MONTH   FROM d)::INT,
  EXTRACT(DAY     FROM d)::INT,
  EXTRACT(QUARTER FROM d)::INT,
  EXTRACT(WEEK    FROM d)::INT,
  EXTRACT(ISOYEAR FROM d)::INT,
  EXTRACT(ISODOW  FROM d) IN (6, 7)
FROM generate_series('2020-01-01'::DATE, '2030-12-31'::DATE, '1 day'::INTERVAL) AS gs(d)
ON CONFLICT (date_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS analytics.dim_service (
  service_key  TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  service_name TEXT NOT NULL,
  service_type TEXT,
  is_active    BOOL NOT NULL DEFAULT TRUE,
  valid_from   TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to     TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS analytics.dim_user (
  user_key          TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  full_name         TEXT NOT NULL,
  role              TEXT NOT NULL,
  primary_branch_id TEXT,
  is_active         BOOL NOT NULL DEFAULT TRUE,
  valid_from        TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to          TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS analytics.dim_patient (
  patient_key TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  age_band    TEXT,
  sex         TEXT,
  barangay    TEXT,
  city        TEXT,
  is_active   BOOL NOT NULL DEFAULT TRUE,
  valid_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to    TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS analytics.fact_doses_administered (
  dose_id             TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  date_id             INT  NOT NULL REFERENCES analytics.dim_date(date_id),
  patient_key         TEXT NOT NULL,
  service_key         TEXT NOT NULL,
  administered_by_key TEXT,
  branch_id           TEXT NOT NULL,
  encounter_id        TEXT,
  dose_sequence       INT,
  lot_number          TEXT,
  administered_at     TIMESTAMPTZ NOT NULL,
  refreshed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fact_doses_administered_date_idx
  ON analytics.fact_doses_administered(date_id);
CREATE INDEX IF NOT EXISTS fact_doses_administered_tenant_branch_idx
  ON analytics.fact_doses_administered(tenant_id, branch_id);

CREATE TABLE IF NOT EXISTS analytics.fact_revenue (
  revenue_id      TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  date_id         INT  NOT NULL REFERENCES analytics.dim_date(date_id),
  transaction_id  TEXT NOT NULL,
  patient_key     TEXT NOT NULL,
  service_key     TEXT NOT NULL,
  cashier_key     TEXT,
  branch_id       TEXT NOT NULL,
  quantity        INT  NOT NULL DEFAULT 1,
  unit_price      NUMERIC(12,2) NOT NULL,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_amount      NUMERIC(12,2) NOT NULL,
  payment_method  TEXT,
  discount_type   TEXT,
  transacted_at   TIMESTAMPTZ NOT NULL,
  refreshed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fact_revenue_date_idx
  ON analytics.fact_revenue(date_id);
CREATE INDEX IF NOT EXISTS fact_revenue_tenant_branch_idx
  ON analytics.fact_revenue(tenant_id, branch_id);

CREATE TABLE IF NOT EXISTS analytics.fact_inventory_movements (
  movement_id    TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  date_id        INT  NOT NULL REFERENCES analytics.dim_date(date_id),
  service_key    TEXT NOT NULL,
  branch_id      TEXT NOT NULL,
  movement_type  TEXT NOT NULL,
  quantity_delta INT  NOT NULL,
  lot_number     TEXT,
  expiry_date    DATE,
  cost_per_unit  NUMERIC(12,2),
  moved_at       TIMESTAMPTZ NOT NULL,
  refreshed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fact_inventory_movements_date_idx
  ON analytics.fact_inventory_movements(date_id);
CREATE INDEX IF NOT EXISTS fact_inventory_movements_tenant_branch_idx
  ON analytics.fact_inventory_movements(tenant_id, branch_id);

CREATE TABLE IF NOT EXISTS analytics.fact_appointment_outcomes (
  outcome_id       TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  date_id          INT  NOT NULL REFERENCES analytics.dim_date(date_id),
  patient_key      TEXT NOT NULL,
  service_key      TEXT,
  provider_key     TEXT,
  branch_id        TEXT NOT NULL,
  outcome_status   TEXT NOT NULL,
  wait_minutes     INT,
  duration_minutes INT,
  booked_at        TIMESTAMPTZ,
  occurred_at      TIMESTAMPTZ NOT NULL,
  refreshed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fact_appointment_outcomes_date_idx
  ON analytics.fact_appointment_outcomes(date_id);
CREATE INDEX IF NOT EXISTS fact_appointment_outcomes_tenant_branch_idx
  ON analytics.fact_appointment_outcomes(tenant_id, branch_id);

CREATE TABLE IF NOT EXISTS analytics.rollup_daily_branch_revenue (
  tenant_id         TEXT NOT NULL,
  branch_id         TEXT NOT NULL,
  date_id           INT  NOT NULL REFERENCES analytics.dim_date(date_id),
  transaction_count INT  NOT NULL DEFAULT 0,
  total_gross       NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_discount    NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_net         NUMERIC(12,2) NOT NULL DEFAULT 0,
  cash_net          NUMERIC(12,2) NOT NULL DEFAULT 0,
  card_net          NUMERIC(12,2) NOT NULL DEFAULT 0,
  other_net         NUMERIC(12,2) NOT NULL DEFAULT 0,
  refreshed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, branch_id, date_id)
);

CREATE TABLE IF NOT EXISTS analytics.rollup_daily_doses_by_service (
  tenant_id          TEXT NOT NULL,
  branch_id          TEXT NOT NULL,
  date_id            INT  NOT NULL REFERENCES analytics.dim_date(date_id),
  service_key        TEXT NOT NULL,
  doses_administered INT  NOT NULL DEFAULT 0,
  unique_patients    INT  NOT NULL DEFAULT 0,
  refreshed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, branch_id, date_id, service_key)
);

CREATE TABLE IF NOT EXISTS analytics.rollup_monthly_provider_productivity (
  tenant_id             TEXT NOT NULL,
  branch_id             TEXT NOT NULL,
  year_month            TEXT NOT NULL,
  provider_key          TEXT NOT NULL,
  encounters_completed  INT  NOT NULL DEFAULT 0,
  doses_administered    INT  NOT NULL DEFAULT 0,
  unique_patients       INT  NOT NULL DEFAULT 0,
  avg_encounter_minutes NUMERIC(6,1),
  refreshed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, branch_id, year_month, provider_key)
);

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.mv_patient_protocol_completion AS
SELECT
  pso.tenant_id,
  pso.patient_id  AS patient_key,
  pso.id          AS pso_id,
  pso.template_id,
  COUNT(co.id)    AS total_ordered,
  COUNT(co.id) FILTER (WHERE co.status = 'Completed') AS total_completed,
  ROUND(
    COUNT(co.id) FILTER (WHERE co.status = 'Completed')::NUMERIC
      / NULLIF(COUNT(co.id), 0) * 100,
    1
  ) AS pct_complete,
  MIN(co.current_scheduled_date) AS first_dose_date,
  MAX(co.current_scheduled_date) FILTER (WHERE co.status = 'Completed')
    AS last_completed_date,
  now() AS refreshed_at
FROM patient_standing_orders pso
LEFT JOIN clinical_orders co
  ON co.patient_standing_order_id = pso.id
 AND co.deleted_at IS NULL
WHERE pso.discontinued_at IS NULL
GROUP BY pso.tenant_id, pso.patient_id, pso.id, pso.template_id
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS mv_patient_protocol_completion_pkey
  ON analytics.mv_patient_protocol_completion(tenant_id, pso_id);
CREATE INDEX IF NOT EXISTS mv_patient_protocol_completion_patient_idx
  ON analytics.mv_patient_protocol_completion(tenant_id, patient_key);

-- ---------------------------------------------------------------------------
-- 10. AUTH-2: app role (surevax_app) — RLS-bound runtime identity.
--
-- This migration runs as the BYPASSRLS migrator role (typically `surevax`
-- locally / Railway's master role in prod). It creates a non-superuser
-- `surevax_app` role that the running app connects as. Because it does NOT
-- carry BYPASSRLS, the RLS policies declared above are actually enforced.
--
-- Password is intentionally NOT set here — env-specific:
--   • local dev: setup-worktree.sh runs ALTER ROLE … PASSWORD after migrate.
--   • Railway:  the railway-ops skill documents the one-time ALTER ROLE.
--
-- Idempotent: pg_roles check before CREATE ROLE; GRANTs are idempotent
-- (Postgres records grants once, re-issue is a no-op).
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'surevax_app') THEN
    CREATE ROLE surevax_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

-- Public schema — app reads + writes RLS-enforced rows here.
GRANT USAGE ON SCHEMA public TO surevax_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO surevax_app;
GRANT USAGE, SELECT, UPDATE          ON ALL SEQUENCES IN SCHEMA public TO surevax_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO surevax_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE          ON SEQUENCES TO surevax_app;

-- Routine execution is intentionally not granted wholesale. The final
-- supplemental migration revokes any legacy/default routine grants and
-- allowlists only the functions/procedures invoked by runtime code.

-- Analytics schema — app reads materialised views populated by the worker.
GRANT USAGE ON SCHEMA analytics TO surevax_app;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO surevax_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics
  GRANT SELECT ON TABLES TO surevax_app;

-- Drizzle's migration bookkeeping. The migrator owns it; surevax_app only
-- needs SELECT so app code can read its own migration-applied state (no app
-- code does this today, but harmless and forward-compatible).
GRANT USAGE  ON SCHEMA drizzle TO surevax_app;
GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO surevax_app;

-- ─── Session timeouts (folded from 0008_session_timeouts.sql) ────────────────
-- Prevent runaway queries and abandoned transactions from stalling the pool.
-- ALTER DATABASE settings take effect for new sessions only.

DO $$
DECLARE
  db_name text;
BEGIN
  SELECT current_database() INTO db_name;
  EXECUTE format('ALTER DATABASE %I SET statement_timeout = %L', db_name, '30s');
  EXECUTE format('ALTER DATABASE %I SET lock_timeout = %L', db_name, '5s');
  EXECUTE format('ALTER DATABASE %I SET idle_in_transaction_session_timeout = %L', db_name, '60s');
END $$;

-- ─── RLS hardening (folded from 0022_rls_hardening.sql) ──────────────────────
-- M11: enable tenant_isolation on `tenants` table.
-- M12: invert branch_isolation so empty GUC no longer opens cross-branch reads.

SET lock_timeout = '5s';

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_tenants ON tenants;
CREATE POLICY tenant_isolation_tenants ON tenants
  USING (
    current_setting('app.is_platform_admin', true) = 'true'
    OR id = current_setting('app.current_tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.is_platform_admin', true) = 'true'
    OR id = current_setting('app.current_tenant_id', true)
  );

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'branches', 'users', 'staff_time_logs',
    'patients', 'service_catalog', 'payer_profiles',
    'standing_order_templates', 'standing_order_template_items',
    'encounters', 'patient_standing_orders', 'clinical_orders',
    'inventory_lots',
    'transactions', 'transaction_items', 'payments', 'group_bills',
    'partner_laboratories', 'lab_orders',
    'feature_flags', 'notifications',
    'user_branches', 'user_roles', 'user_sessions',
    'locations', 'cash_drawer_sessions',
    'service_prices',
    'appointments',
    'encounter_vitals', 'encounter_diagnoses',
    'consents', 'adverse_events',
    'clinical_order_schedule_changes',
    'inventory_movements', 'inventory_lot_balances', 'product_recalls',
    'claims', 'claim_items',
    'attachments',
    'day_summary_snapshots',
    'cash_deposits'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = t AND column_name = 'branch_id'
    ) THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS branch_isolation ON %I', t);
    -- M12 / Cross-Branch PHI Step 7a (BREAKING) — branch_isolation is declared
    -- `AS RESTRICTIVE` so it AND-combines with the permissive `tenant_isolation`
    -- policy. This is REQUIRED for branch scoping to actually enforce: PostgreSQL
    -- OR-combines permissive policies, so a same-tenant row would otherwise be
    -- visible/writable on tenant_isolation alone and branch_isolation would be
    -- inert. RESTRICTIVE makes the M12 USING flip (default-closed reads) AND the
    -- 7a WITH-CHECK tightening (writes never cross-branch) operative.
    --
    --   USING (read visibility): a row at another branch is readable only when
    --   the session is a platform admin, OR `app.cross_branch_read='true'` (the
    --   audited break-glass / tenant-wide-read path, set by withTenantTx's
    --   `crossBranchRead` intent or a null branchId, by withSystemTx, and by
    --   withPlatformTx), OR the row is tenant-wide reference data
    --   (branch_id IS NULL — AUTH-3 exception), OR the row''s branch matches the
    --   session''s `app.current_branch_id`.
    --
    --   WITH CHECK (write authorization): WRITES ARE NEVER CROSS-BRANCH. Per
    --   RFC §4.3, break-glass is read-only — to write at another branch you
    --   clock in there (and the D2 enforce_transaction_branch_invariant trigger
    --   layers on top for transactions). `app.cross_branch_read='true'` is
    --   deliberately ABSENT from WITH CHECK: a session reading Branch-B under
    --   break-glass cannot INSERT/UPDATE a Branch-B row. `branch_id IS NULL` is
    --   KEPT so TenantAdmin/system can still write tenant-wide reference rows
    --   (service_prices, feature_flags, user_roles, ...); is_platform_admin is
    --   KEPT for the platform-admin bypass.
    EXECUTE format(
      'CREATE POLICY branch_isolation ON %I
       AS RESTRICTIVE
       USING (
         current_setting(''app.is_platform_admin'', true) = ''true''
         OR current_setting(''app.cross_branch_read'', true) = ''true''
         OR branch_id IS NULL
         OR branch_id = NULLIF(current_setting(''app.current_branch_id'', true), '''')::bigint
       )
       WITH CHECK (
         current_setting(''app.is_platform_admin'', true) = ''true''
         OR branch_id IS NULL
         OR branch_id = NULLIF(current_setting(''app.current_branch_id'', true), '''')::bigint
       )',
      t
    );
  END LOOP;
END;
$$;

-- ─── Migration control-plane isolation ─────────────────────────────────────
-- The migration.* tables are immutable evidence. State transitions are later
-- run_events / exception_events / canonical_events, never UPDATEs. We do not
-- attach audit_log_changes(): canonical event payloads may contain restricted
-- reconciliation facts and must not be duplicated into audit_logs JSON.

CREATE OR REPLACE FUNCTION migration.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'migration evidence is append-only; insert a superseding event instead'
    USING ERRCODE = 'object_not_in_prerequisite_state';
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'runs', 'run_events', 'source_snapshots', 'observations',
    'canonical_events', 'event_evidence', 'decisions', 'target_links',
    'exceptions', 'exception_events', 'sync_checkpoints'
  ]
  LOOP
    EXECUTE format('ALTER TABLE migration.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE migration.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON migration.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON migration.%I
       USING (tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), ''''))
       WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), ''''))',
      t
    );
    EXECUTE format('DROP TRIGGER IF EXISTS reject_mutation ON migration.%I', t);
    EXECUTE format(
      'CREATE TRIGGER reject_mutation BEFORE UPDATE OR DELETE ON migration.%I
       FOR EACH ROW EXECUTE FUNCTION migration.reject_mutation()',
      t
    );
  END LOOP;
END;
$$;

-- SQL NULLs compare as distinct inside an ordinary unique index. Normalize
-- optional row locators so the same source observation version cannot be
-- inserted twice merely because sheet_name/source_row_id/row_number is NULL.
DROP INDEX IF EXISTS migration.observations_version_uniq;
CREATE UNIQUE INDEX observations_version_uniq
  ON migration.observations (
    tenant_id,
    snapshot_id,
    source_kind,
    COALESCE(sheet_name, ''),
    COALESCE(source_row_id, ''),
    COALESCE(row_number, 0),
    row_hash
  );

GRANT USAGE ON SCHEMA migration TO surevax_app;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA migration TO surevax_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA migration TO surevax_app;
REVOKE UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA migration FROM surevax_app;

COMMENT ON SCHEMA migration IS
  'Append-only control plane for legacy snapshots, reconciliation, decisions, target links and bounded catch-up sync.';
