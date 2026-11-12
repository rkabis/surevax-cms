-- 0009_payment_void.sql: forward migration for the "correct a payment's
-- method after posting" feature. Adds void-tracking columns to `payments`
-- (voided_at / voided_by_id / void_reason / replaced_by_payment_id) so a
-- posted payment is corrected by voiding the original row and inserting a
-- replacement, never an in-place UPDATE of `method`.
--
-- WHY THIS FILE EXISTS
--
-- The four columns were added by hand-editing the baseline
-- (0000_initial.sql), which is the repo's convention for schema changes,
-- and it works ONLY for a database created from scratch. Any database that
-- already recorded `0000_initial` as applied (every existing deploy,
-- including Railway) never re-runs it, so the columns would never reach
-- them without this file. Mirrors 0008_payer_price_adjustment.sql's role.
--
-- All four columns are nullable, so no backfill is required: this file
-- contains no INSERT/UPDATE/DELETE on audited tables and therefore needs no
-- set_config('app.current_tenant_id', ...) DO-block wrapper (see
-- gotchas.md "Audit trigger raises on missing tenant GUC").
--
-- This file ALSO redefines two objects that 0001_extensions_and_rls.sql and
-- 0005_modern_pg.sql create, so it must run AFTER both:
--   - sync_transaction_amounts(): the amount_paid recompute must exclude
--     voided rows, else a voided payment keeps counting toward
--     transactions.amount_paid and the reissue would double it.
--   - payments_tenant_txn_method_ref_uniq: must exclude voided rows, else
--     correcting a payment while keeping the same reference number is
--     permanently blocked by the row that was just voided.
--
-- Idempotent throughout: a no-op on a database created from the current
-- baseline, and brings an existing database up to the baseline's shape.
-- No CREATE INDEX CONCURRENTLY here: migrate.ts wraps each supplemental
-- file in a transaction, and CONCURRENTLY cannot run inside one.

-- SET LOCAL, not SET: migrate.ts applies every supplemental file on ONE
-- client, and a session-scoped SET survives this file's COMMIT. A plain SET
-- here would silently impose a 5s lock timeout on whatever file is appended
-- after this one, aborting a legitimately slow DDL for a reason that appears
-- nowhere in the file being run.
SET LOCAL lock_timeout = '5s';

-- 1. The four void-tracking columns. NULL/absent = payment is live.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS voided_at timestamp with time zone;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS voided_by_id bigint;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS void_reason text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS replaced_by_payment_id bigint;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_voided_by_id_users_id_fk'
  ) THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_voided_by_id_users_id_fk
      FOREIGN KEY (voided_by_id) REFERENCES users(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_replaced_by_payment_id_payments_id_fk'
  ) THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_replaced_by_payment_id_payments_id_fk
      FOREIGN KEY (replaced_by_payment_id) REFERENCES payments(id);
  END IF;
END $$;

-- 2. Fast lookup of a transaction's live (non-voided) payments: the shape
-- every money aggregate and the correction flow actually wants.
CREATE INDEX IF NOT EXISTS payments_active_idx
  ON payments (tenant_id, transaction_id)
  WHERE voided_at IS NULL;

-- 3. sync_transaction_amounts(), redefined to exclude voided rows from the
-- amount_paid recompute. Copied from 0001_extensions_and_rls.sql with only
-- the SUM query changed (WHERE voided_at IS NULL added).
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

-- 4. Rebuild payments_tenant_txn_method_ref_uniq (from 0005_modern_pg.sql) to
-- exclude voided rows: without this, correcting a payment while keeping the
-- same reference number is permanently blocked by the row just voided.
DROP INDEX IF EXISTS payments_tenant_txn_method_ref_uniq;
CREATE UNIQUE INDEX payments_tenant_txn_method_ref_uniq
  ON payments (tenant_id, transaction_id, method, reference_number)
  WHERE reference_number IS NOT NULL AND voided_at IS NULL;
