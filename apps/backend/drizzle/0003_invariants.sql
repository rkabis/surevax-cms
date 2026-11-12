-- =============================================================================
-- 0003_invariants.sql — domain CHECKs, polymorphic guards, composite FKs,
-- status-history coupling, EXCLUDE constraints, clinical sanity bounds
-- =============================================================================
-- Post-ID-redesign (W1.B) rewrite:
--   - Legacy *_id_format CHECKs are gone — display_id format CHECKs now live
--     in 0000_initial.sql on each entity table.
--   - transactions_id_format is gone — TXN ID format is now uniform TXN_*.
--   - clinical_order_schedule_changes_id_format / feature_flags_id_format
--     are gone (those tables no longer have a text id).
--   - appointments GIST EXCLUDE uses int8_ops (branch_id, provider_id bigint).
--   - Clinical sanity bounds (DB-hygiene A4) added at the bottom.
--
-- Idempotent: every ALTER is wrapped in a DO block guarded by pg_constraint.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Domain CHECKs
-- ---------------------------------------------------------------------------

ALTER TABLE inventory_lots
  DROP CONSTRAINT IF EXISTS chk_quantity_on_hand_non_negative;
ALTER TABLE inventory_lots
  ADD CONSTRAINT chk_quantity_on_hand_non_negative
  CHECK (quantity_on_hand::numeric >= 0);

ALTER TABLE inventory_lots
  DROP CONSTRAINT IF EXISTS chk_quantity_received_positive;
ALTER TABLE inventory_lots
  ADD CONSTRAINT chk_quantity_received_positive
  CHECK (quantity_received::numeric > 0);

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS chk_gross_amount_non_negative;
ALTER TABLE transactions
  ADD CONSTRAINT chk_gross_amount_non_negative
  CHECK (gross_amount::numeric >= 0);

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS chk_discount_amount_non_negative;
ALTER TABLE transactions
  ADD CONSTRAINT chk_discount_amount_non_negative
  CHECK (discount_amount::numeric >= 0);

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS chk_net_amount_non_negative;
ALTER TABLE transactions
  ADD CONSTRAINT chk_net_amount_non_negative
  CHECK (net_amount::numeric >= 0);

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS chk_payment_amount_positive;
ALTER TABLE payments
  ADD CONSTRAINT chk_payment_amount_positive
  CHECK (amount::numeric > 0);

ALTER TABLE transaction_items
  DROP CONSTRAINT IF EXISTS chk_tx_item_quantity_positive;
ALTER TABLE transaction_items
  ADD CONSTRAINT chk_tx_item_quantity_positive
  CHECK (quantity::numeric > 0);

ALTER TABLE clinical_orders
  DROP CONSTRAINT IF EXISTS chk_clinical_order_quantity_positive;
ALTER TABLE clinical_orders
  ADD CONSTRAINT chk_clinical_order_quantity_positive
  CHECK (quantity::numeric > 0);

ALTER TABLE clinical_orders
  DROP CONSTRAINT IF EXISTS chk_dose_number_positive;
ALTER TABLE clinical_orders
  ADD CONSTRAINT chk_dose_number_positive
  CHECK (dose_number IS NULL OR dose_number > 0);

ALTER TABLE standing_order_template_items
  DROP CONSTRAINT IF EXISTS chk_soti_day_offset_non_negative;
ALTER TABLE standing_order_template_items
  ADD CONSTRAINT chk_soti_day_offset_non_negative
  CHECK (day_offset >= 0);

ALTER TABLE standing_order_template_items
  DROP CONSTRAINT IF EXISTS chk_soti_sequence_positive;
ALTER TABLE standing_order_template_items
  ADD CONSTRAINT chk_soti_sequence_positive
  CHECK (sequence > 0);

ALTER TABLE standing_order_template_items
  DROP CONSTRAINT IF EXISTS chk_soti_quantity_positive;
ALTER TABLE standing_order_template_items
  ADD CONSTRAINT chk_soti_quantity_positive
  CHECK (quantity::numeric > 0);

ALTER TABLE standing_order_templates
  DROP CONSTRAINT IF EXISTS chk_version_positive;
ALTER TABLE standing_order_templates
  ADD CONSTRAINT chk_version_positive
  CHECK (version > 0);

-- branches.code: 3 uppercase letters (used as the branch segment of display_id).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='branches_code_format') THEN
    ALTER TABLE branches ADD CONSTRAINT branches_code_format
      CHECK (code ~ '^[A-Z]{3}$');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Polymorphic-FK guards (allow-list + nonempty pair CHECKs)
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='consents_scope_ref_type_check') THEN
    ALTER TABLE consents
      ADD CONSTRAINT consents_scope_ref_type_check
      CHECK (
        scope_ref_type IS NULL
        OR scope_ref_type IN (
          'clinical_order', 'patient_standing_order', 'encounter',
          'service', 'lab_order', 'transaction'
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='consents_scope_ref_pair_check') THEN
    ALTER TABLE consents
      ADD CONSTRAINT consents_scope_ref_pair_check
      CHECK (
        (scope_ref_type IS NULL AND scope_ref_id IS NULL)
        OR (scope_ref_type IS NOT NULL AND scope_ref_id IS NOT NULL AND scope_ref_id <> '')
      );
  END IF;
END $$;
COMMENT ON COLUMN consents.scope_ref_type IS
  'Polymorphic scope target: clinical_order|patient_standing_order|encounter|service|lab_order|transaction.';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='attachments_owner_type_check') THEN
    ALTER TABLE attachments
      ADD CONSTRAINT attachments_owner_type_check
      CHECK (
        owner_type IN (
          'patient', 'encounter', 'clinical_order', 'lab_order',
          'transaction', 'consent', 'claim', 'adverse_event',
          'inventory_lot', 'user', 'tenant'
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='attachments_owner_id_nonempty_check') THEN
    ALTER TABLE attachments
      ADD CONSTRAINT attachments_owner_id_nonempty_check
      CHECK (owner_id IS NOT NULL AND owner_id <> '');
  END IF;
END $$;
COMMENT ON COLUMN attachments.owner_type IS
  'Polymorphic owner target: patient|encounter|clinical_order|lab_order|transaction|consent|claim|adverse_event|inventory_lot|user|tenant.';

-- ---------------------------------------------------------------------------
-- 3. Composite tenant FKs — leverage UNIQUE (tenant_id, id) on each parent.
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_co_patient_composite') THEN
    ALTER TABLE clinical_orders
      ADD CONSTRAINT fk_co_patient_composite
      FOREIGN KEY (tenant_id, patient_id)
      REFERENCES patients(tenant_id, id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_co_encounter_composite') THEN
    ALTER TABLE clinical_orders
      ADD CONSTRAINT fk_co_encounter_composite
      FOREIGN KEY (tenant_id, encounter_id)
      REFERENCES encounters(tenant_id, id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_co_pso_composite') THEN
    ALTER TABLE clinical_orders
      ADD CONSTRAINT fk_co_pso_composite
      FOREIGN KEY (tenant_id, patient_standing_order_id)
      REFERENCES patient_standing_orders(tenant_id, id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_ti_transaction_composite') THEN
    ALTER TABLE transaction_items
      ADD CONSTRAINT fk_ti_transaction_composite
      FOREIGN KEY (tenant_id, transaction_id)
      REFERENCES transactions(tenant_id, id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_pay_transaction_composite') THEN
    ALTER TABLE payments
      ADD CONSTRAINT fk_pay_transaction_composite
      FOREIGN KEY (tenant_id, transaction_id)
      REFERENCES transactions(tenant_id, id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_enc_patient_composite') THEN
    ALTER TABLE encounters
      ADD CONSTRAINT fk_enc_patient_composite
      FOREIGN KEY (tenant_id, patient_id)
      REFERENCES patients(tenant_id, id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_pso_patient_composite') THEN
    ALTER TABLE patient_standing_orders
      ADD CONSTRAINT fk_pso_patient_composite
      FOREIGN KEY (tenant_id, patient_id)
      REFERENCES patients(tenant_id, id);
  END IF;

  -- Multi-patient transactions: per-line patient + per-patient sub-header.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_ti_patient_composite') THEN
    ALTER TABLE transaction_items
      ADD CONSTRAINT fk_ti_patient_composite
      FOREIGN KEY (tenant_id, patient_id)
      REFERENCES patients(tenant_id, id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_tp_transaction_composite') THEN
    ALTER TABLE transaction_patients
      ADD CONSTRAINT fk_tp_transaction_composite
      FOREIGN KEY (tenant_id, transaction_id)
      REFERENCES transactions(tenant_id, id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_tp_patient_composite') THEN
    ALTER TABLE transaction_patients
      ADD CONSTRAINT fk_tp_patient_composite
      FOREIGN KEY (tenant_id, patient_id)
      REFERENCES patients(tenant_id, id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_tp_encounter_composite') THEN
    ALTER TABLE transaction_patients
      ADD CONSTRAINT fk_tp_encounter_composite
      FOREIGN KEY (tenant_id, encounter_id)
      REFERENCES encounters(tenant_id, id);
  END IF;

  -- Brand-specific pricing: a service_prices row scoped to one product must
  -- reference a product in the SAME tenant. NULL product_id (base / any-brand
  -- price) is unaffected — composite FKs are not enforced when any column is NULL.
  -- The column-existence guard is load-bearing: this file re-runs on every
  -- deploy. product_id has lived in the baseline since the 2026-07-30
  -- consolidation (formerly forward-migrated by the now-deleted
  -- 0009_brand_pricing.sql for pre-#581 databases), so the guard is always
  -- true today — kept as defense-in-depth against a future baseline edit
  -- that drops the column without updating this file.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_sp_product_composite')
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'service_prices' AND column_name = 'product_id'
     ) THEN
    ALTER TABLE service_prices
      ADD CONSTRAINT fk_sp_product_composite
      FOREIGN KEY (tenant_id, product_id)
      REFERENCES products(tenant_id, id);
  END IF;

  -- cash_deposits: a deposit's branch/session must belong to the SAME tenant.
  -- Folded in from the deleted 0010_cash_deposits.sql supplemental.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_cd_branch_composite') THEN
    ALTER TABLE cash_deposits
      ADD CONSTRAINT fk_cd_branch_composite
      FOREIGN KEY (tenant_id, branch_id)
      REFERENCES branches(tenant_id, id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_cd_session_composite') THEN
    ALTER TABLE cash_deposits
      ADD CONSTRAINT fk_cd_session_composite
      FOREIGN KEY (tenant_id, cash_drawer_session_id)
      REFERENCES cash_drawer_sessions(tenant_id, id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Status-history coupling — composite FK ON DELETE CASCADE + status enum CHECKs.
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pso_status_history_parent_fk') THEN
    ALTER TABLE patient_standing_orders_status_history
      ADD CONSTRAINT pso_status_history_parent_fk
      FOREIGN KEY (tenant_id, entity_id)
      REFERENCES patient_standing_orders (tenant_id, id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='co_status_history_parent_fk') THEN
    ALTER TABLE clinical_orders_status_history
      ADD CONSTRAINT co_status_history_parent_fk
      FOREIGN KEY (tenant_id, entity_id)
      REFERENCES clinical_orders (tenant_id, id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='encounters_status_history_parent_fk') THEN
    ALTER TABLE encounters_status_history
      ADD CONSTRAINT encounters_status_history_parent_fk
      FOREIGN KEY (tenant_id, entity_id)
      REFERENCES encounters (tenant_id, id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='transactions_status_history_parent_fk') THEN
    ALTER TABLE transactions_status_history
      ADD CONSTRAINT transactions_status_history_parent_fk
      FOREIGN KEY (tenant_id, entity_id)
      REFERENCES transactions (tenant_id, id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='claims_status_history_parent_fk') THEN
    ALTER TABLE claims_status_history
      ADD CONSTRAINT claims_status_history_parent_fk
      FOREIGN KEY (tenant_id, entity_id)
      REFERENCES claims (tenant_id, id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='lab_orders_status_history_parent_fk') THEN
    ALTER TABLE lab_orders_status_history
      ADD CONSTRAINT lab_orders_status_history_parent_fk
      FOREIGN KEY (tenant_id, entity_id)
      REFERENCES lab_orders (tenant_id, id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='appointments_status_history_parent_fk') THEN
    ALTER TABLE appointments_status_history
      ADD CONSTRAINT appointments_status_history_parent_fk
      FOREIGN KEY (tenant_id, entity_id)
      REFERENCES appointments (tenant_id, id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pso_status_history_to_status_check') THEN
    ALTER TABLE patient_standing_orders_status_history
      ADD CONSTRAINT pso_status_history_to_status_check
      CHECK (to_status IN ('Active','Completed','Discontinued','Suspended'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pso_status_history_from_status_check') THEN
    ALTER TABLE patient_standing_orders_status_history
      ADD CONSTRAINT pso_status_history_from_status_check
      CHECK (from_status IS NULL OR from_status IN ('Active','Completed','Discontinued','Suspended'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='co_status_history_to_status_check') THEN
    ALTER TABLE clinical_orders_status_history
      ADD CONSTRAINT co_status_history_to_status_check
      CHECK (to_status IN ('Scheduled','Pending','Completed','Missed','Cancelled','Deferred','Refused'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='co_status_history_from_status_check') THEN
    ALTER TABLE clinical_orders_status_history
      ADD CONSTRAINT co_status_history_from_status_check
      CHECK (from_status IS NULL OR from_status IN ('Scheduled','Pending','Completed','Missed','Cancelled','Deferred','Refused'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='encounters_status_history_to_status_check') THEN
    ALTER TABLE encounters_status_history
      ADD CONSTRAINT encounters_status_history_to_status_check
      CHECK (to_status IN ('Open','InProgress','Completed','Cancelled','CheckedIn','Triage','OnHold','NoShow'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='encounters_status_history_from_status_check') THEN
    ALTER TABLE encounters_status_history
      ADD CONSTRAINT encounters_status_history_from_status_check
      CHECK (from_status IS NULL OR from_status IN ('Open','InProgress','Completed','Cancelled','CheckedIn','Triage','OnHold','NoShow'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='txn_status_history_to_status_check') THEN
    ALTER TABLE transactions_status_history
      ADD CONSTRAINT txn_status_history_to_status_check
      CHECK (to_status IN ('Draft','Pending','Paid','Voided','Refunded','PartiallyPaid'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='txn_status_history_from_status_check') THEN
    ALTER TABLE transactions_status_history
      ADD CONSTRAINT txn_status_history_from_status_check
      CHECK (from_status IS NULL OR from_status IN ('Draft','Pending','Paid','Voided','Refunded','PartiallyPaid'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='claims_status_history_to_status_check') THEN
    ALTER TABLE claims_status_history
      ADD CONSTRAINT claims_status_history_to_status_check
      CHECK (to_status IN ('Draft','Submitted','Acknowledged','InReview','Approved','PartiallyApproved','Denied','Paid','Appealed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='claims_status_history_from_status_check') THEN
    ALTER TABLE claims_status_history
      ADD CONSTRAINT claims_status_history_from_status_check
      CHECK (from_status IS NULL OR from_status IN ('Draft','Submitted','Acknowledged','InReview','Approved','PartiallyApproved','Denied','Paid','Appealed'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='lab_orders_status_history_to_status_check') THEN
    ALTER TABLE lab_orders_status_history
      ADD CONSTRAINT lab_orders_status_history_to_status_check
      CHECK (to_status IN ('Pending','Sent','ResultReceived','Cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='lab_orders_status_history_from_status_check') THEN
    ALTER TABLE lab_orders_status_history
      ADD CONSTRAINT lab_orders_status_history_from_status_check
      CHECK (from_status IS NULL OR from_status IN ('Pending','Sent','ResultReceived','Cancelled'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='appt_status_history_to_status_check') THEN
    ALTER TABLE appointments_status_history
      ADD CONSTRAINT appt_status_history_to_status_check
      CHECK (to_status IN ('Scheduled','Confirmed','CheckedIn','Completed','Cancelled','NoShow','Rescheduled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='appt_status_history_from_status_check') THEN
    ALTER TABLE appointments_status_history
      ADD CONSTRAINT appt_status_history_from_status_check
      CHECK (from_status IS NULL OR from_status IN ('Scheduled','Confirmed','CheckedIn','Completed','Cancelled','NoShow','Rescheduled'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. transaction_items composite uniqueness
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS transaction_items_txn_service_uniq
  ON transaction_items (tenant_id, transaction_id, service_id);

CREATE UNIQUE INDEX IF NOT EXISTS transaction_items_txn_clinical_order_uniq
  ON transaction_items (tenant_id, transaction_id, clinical_order_id)
  WHERE clinical_order_id IS NOT NULL;

-- A clinical order can have one live bill at a time. A plain partial unique
-- index would incorrectly block a replacement bill after its original
-- transaction is voided/refunded, because an index predicate cannot inspect
-- the parent transaction status. Lock the order row first to serialize two
-- concurrent attempts, then reject any other non-void/refund bill. This gives
-- the required uniqueness semantics without making a legitimate reissue
-- impossible.
CREATE OR REPLACE FUNCTION enforce_single_live_clinical_order_billing()
RETURNS TRIGGER AS $$
DECLARE
  existing_item_id bigint;
BEGIN
  IF NEW.clinical_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- The row lock is the concurrency boundary: a competing insert for the same
  -- clinical order must observe this transaction's committed item before it can
  -- pass the live-bill check below.
  PERFORM 1
  FROM clinical_orders co
  WHERE co.id = NEW.clinical_order_id
    AND co.tenant_id = NEW.tenant_id
  FOR UPDATE;

  SELECT ti.id INTO existing_item_id
  FROM transaction_items ti
  JOIN transactions t ON t.id = ti.transaction_id
  WHERE ti.tenant_id = NEW.tenant_id
    AND ti.clinical_order_id = NEW.clinical_order_id
    AND ti.id <> COALESCE(NEW.id, 0)
    AND t.deleted_at IS NULL
    AND t.status NOT IN ('Voided', 'Refunded')
  LIMIT 1;

  IF existing_item_id IS NOT NULL THEN
    RAISE EXCEPTION 'Clinical order % already has a live billing item', NEW.clinical_order_id
      USING ERRCODE = 'unique_violation', CONSTRAINT = 'clinical_order_single_live_bill';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transaction_items_single_live_clinical_order ON transaction_items;
CREATE TRIGGER trg_transaction_items_single_live_clinical_order
  BEFORE INSERT OR UPDATE OF clinical_order_id, transaction_id ON transaction_items
  FOR EACH ROW
  EXECUTE FUNCTION enforce_single_live_clinical_order_billing();

-- group_bills is intentionally a non-financial wrapper. The paired
-- transaction must be from the same tenant and branch and must name exactly
-- the corporate payer carried by the wrapper. `is_active` belongs in the app
-- create rule (disabling a payer must not invalidate historic group bills).
CREATE OR REPLACE FUNCTION enforce_group_bill_transaction_match()
RETURNS TRIGGER AS $$
DECLARE
  tx_tenant_id text;
  tx_branch_id bigint;
  tx_payer_id bigint;
  group_payer_type payer_type;
BEGIN
  SELECT tenant_id, branch_id, payer_id
    INTO tx_tenant_id, tx_branch_id, tx_payer_id
  FROM transactions
  WHERE id = NEW.transaction_id;

  IF tx_tenant_id IS NULL
     OR tx_tenant_id IS DISTINCT FROM NEW.tenant_id
     OR tx_branch_id IS DISTINCT FROM NEW.branch_id
     OR tx_payer_id IS DISTINCT FROM NEW.payer_id THEN
    RAISE EXCEPTION 'group bill transaction must match tenant, branch, and payer'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'group_bills_transaction_match';
  END IF;

  SELECT payer_type INTO group_payer_type
  FROM payer_profiles
  WHERE id = NEW.payer_id AND tenant_id = NEW.tenant_id;

  IF group_payer_type IS DISTINCT FROM 'Corporate'::payer_type THEN
    RAISE EXCEPTION 'group bill payer must be Corporate'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'group_bills_corporate_payer';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_group_bills_transaction_match ON group_bills;
CREATE TRIGGER trg_group_bills_transaction_match
  BEFORE INSERT OR UPDATE OF tenant_id, branch_id, transaction_id, payer_id ON group_bills
  FOR EACH ROW
  EXECUTE FUNCTION enforce_group_bill_transaction_match();

-- A group-bill payment belongs to the corporate payer, never to the header
-- patient or one of that patient's deposits. This DB boundary covers internal
-- callers as well as the dedicated and generic HTTP payment routes.
CREATE OR REPLACE FUNCTION enforce_group_bill_payment_owner()
RETURNS TRIGGER AS $$
DECLARE
  group_payer_id bigint;
BEGIN
  SELECT payer_id INTO group_payer_id
  FROM group_bills
  WHERE tenant_id = NEW.tenant_id
    AND transaction_id = NEW.transaction_id
    AND deleted_at IS NULL;

  IF group_payer_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.method = 'Credit'::payment_method THEN
    RAISE EXCEPTION 'patient credit cannot settle a payer-owned group bill'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'group_bill_patient_credit_forbidden';
  END IF;

  IF NEW.payer_id IS DISTINCT FROM group_payer_id THEN
    RAISE EXCEPTION 'group bill payment payer must match the corporate payer'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'group_bill_payment_payer_match';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_group_bill_payment_owner ON payments;
CREATE TRIGGER trg_group_bill_payment_owner
  BEFORE INSERT OR UPDATE OF tenant_id, transaction_id, payer_id, method ON payments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_group_bill_payment_owner();

-- ---------------------------------------------------------------------------
-- 6. appointments GIST EXCLUDE (no double-book) — int8_ops for bigint cols
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='appointments_no_double_book'
  ) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_no_double_book
      EXCLUDE USING gist (
        tenant_id WITH =,
        provider_id WITH =,
        branch_id WITH =,
        tstzrange(scheduled_start_at, scheduled_end_at, '[)') WITH &&
      ) WHERE (provider_id IS NOT NULL AND deleted_at IS NULL);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 7. Clinical sanity bounds (DB-hygiene A4, 2026-05-18)
-- ---------------------------------------------------------------------------
-- Column names align with schema.ts: temperature_c, systolic_bp/diastolic_bp,
-- weight_kg, heart_rate_bpm (not pulse_bpm), quantity_on_hand, amount,
-- date_of_birth.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='encounter_vitals_temp_range') THEN
    ALTER TABLE encounter_vitals
      ADD CONSTRAINT encounter_vitals_temp_range
      CHECK (temperature_c IS NULL OR temperature_c BETWEEN 30 AND 45);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='encounter_vitals_bp_positive') THEN
    ALTER TABLE encounter_vitals
      ADD CONSTRAINT encounter_vitals_bp_positive
      CHECK ((systolic_bp IS NULL AND diastolic_bp IS NULL)
          OR (systolic_bp > diastolic_bp AND diastolic_bp > 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='encounter_vitals_weight_positive') THEN
    ALTER TABLE encounter_vitals
      ADD CONSTRAINT encounter_vitals_weight_positive
      CHECK (weight_kg IS NULL OR weight_kg > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='encounter_vitals_pulse_range') THEN
    ALTER TABLE encounter_vitals
      ADD CONSTRAINT encounter_vitals_pulse_range
      CHECK (heart_rate_bpm IS NULL OR heart_rate_bpm BETWEEN 20 AND 250);
  END IF;

  -- inventory_lots.quantity_on_hand non-negative is already enforced via
  -- chk_quantity_on_hand_non_negative above; payments.amount > 0 is in
  -- chk_payment_amount_positive above. Both are no-ops here — listed in
  -- spec for completeness.

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='patients_dob_sane') THEN
    ALTER TABLE patients
      ADD CONSTRAINT patients_dob_sane
      CHECK (date_of_birth IS NULL OR date_of_birth > '1900-01-01');
  END IF;
END $$;

-- ─── Negative inventory CHECK (folded from 0017_negative_inventory_check.sql) ─
-- Reject negative quantity_on_hand at the DB layer. FEFO concurrent races now
-- return 409 NEGATIVE_INVENTORY instead of silently dropping below zero.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inventory_lots_quantity_on_hand_nonneg'
  ) THEN
    ALTER TABLE inventory_lots
      ADD CONSTRAINT inventory_lots_quantity_on_hand_nonneg
      CHECK (quantity_on_hand >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inventory_lot_balances_quantity_on_hand_nonneg'
  ) THEN
    ALTER TABLE inventory_lot_balances
      ADD CONSTRAINT inventory_lot_balances_quantity_on_hand_nonneg
      CHECK (quantity_on_hand >= 0);
  END IF;
END $$;

COMMENT ON CONSTRAINT inventory_lots_quantity_on_hand_nonneg
  ON inventory_lots IS
  'AppSheet legacy tolerated negative stock; we reject it. FEFO concurrency races now return 409 NEGATIVE_INVENTORY instead of silently dropping below zero.';

-- ─── D2 branch-isolation trigger (folded from 0025_d2_branch_isolation.sql) ──
-- BEFORE INSERT on transactions rejects cross-branch sales where the cashier's
-- branch does not match the patient's last-administered branch.

CREATE OR REPLACE FUNCTION enforce_transaction_branch_invariant()
RETURNS TRIGGER AS $$
DECLARE
  last_branch_id bigint;
BEGIN
  -- Historical imports preserve each transaction's own source branch. They
  -- can legitimately post after a later administration at another branch.
  -- The bypass is transaction-local and requires the platform migration
  -- writer context; normal tenant/application writes never set this GUC.
  IF current_setting('app.migration_import', true) = 'true'
     AND current_setting('app.is_platform_admin', true) = 'true' THEN
    RETURN NEW;
  END IF;

  SELECT e.branch_id INTO last_branch_id
  FROM   clinical_orders co
  JOIN   encounters       e ON e.id = co.encounter_id
  WHERE  co.patient_id   = NEW.patient_id
    AND  co.tenant_id    = NEW.tenant_id
    AND  co.status       = 'Completed'
    AND  co.completed_at IS NOT NULL
    AND  co.deleted_at   IS NULL
  ORDER BY co.completed_at DESC
  LIMIT 1;

  IF last_branch_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.branch_id <> last_branch_id THEN
    RAISE EXCEPTION
      'D2: transaction branch (%) does not match patient''s last-administered branch (%). Cross-branch transactions are forbidden.',
      NEW.branch_id, last_branch_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_transaction_branch_invariant ON transactions;

CREATE TRIGGER enforce_transaction_branch_invariant
  BEFORE INSERT ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION enforce_transaction_branch_invariant();

-- ─── cross_branch_access_grants.reason_category CHECK (folded from 0026) ─────
-- Drizzle's pgTable builder doesn't express CHECK constraints, so the
-- enumerated allowlist is enforced via a named CHECK applied here. Keeping the
-- list in sync with the RFC's break-glass reason categories.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cba_grants_reason_category_check'
  ) THEN
    ALTER TABLE cross_branch_access_grants
      ADD CONSTRAINT cba_grants_reason_category_check
      CHECK (reason_category IN (
        'Continuity_of_care', 'Emergency', 'Patient_request', 'Quality_review', 'Other'
      ));
  END IF;
END $$;
