-- =============================================================================
-- 0004_immutability_and_generated.sql — Phase 4 immutability + GENERATED
-- =============================================================================
-- Two coupled changes:
--   1. Convert transactions.amount_outstanding from a regular numeric column
--      to GENERATED ALWAYS AS (GREATEST(net_amount - amount_paid, 0)) STORED.
--      Drizzle declares it as a regular column with default '0'; we DROP and
--      re-ADD as GENERATED. The 0001 sync_transaction_amounts() trigger only
--      writes amount_paid; amount_outstanding recomputes automatically.
--   2. Define + attach immutability triggers:
--        - transactions: BEFORE UPDATE rejects non-void/refund changes once
--          status is Paid (or Voided), with two exemptions:
--            a) cascaded sibling updates (pg_trigger_depth() > 1) — needed
--               by sync_transaction_amounts.
--            b) prepayment_applied_at NULL → timestamp transitions (POST
--               /api/transactions/:id/apply-prepayment).
--          Soft-delete (deleted_at flip) always permitted.
--        - clinical_orders: BEFORE UPDATE rejects all changes once status is
--          Completed except deleted_at. Same cascade exemption as above.
--          patient_id NULL→non-NULL exemption from the Phase 1 backfill is
--          NO LONGER needed — patient_id is now NOT NULL on schema.ts and
--          seed inserts always provide a value.
--
-- Idempotent: CREATE OR REPLACE / DROP IF EXISTS.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. amount_outstanding → GENERATED column
-- Fresh-DB safe: DROP COLUMN runs against an empty transactions table.
-- ---------------------------------------------------------------------------

ALTER TABLE transactions DROP COLUMN IF EXISTS amount_outstanding;

ALTER TABLE transactions
  ADD COLUMN amount_outstanding NUMERIC(12,2) NOT NULL
    GENERATED ALWAYS AS (GREATEST(net_amount - amount_paid, 0)) STORED;

-- ---------------------------------------------------------------------------
-- 2. Immutability trigger functions
-- ---------------------------------------------------------------------------

-- 2a. Paid / Voided transactions — allow void/refund transitions, soft-delete,
--     cascaded sibling updates, and prepayment_applied_at NULL→timestamp.
CREATE OR REPLACE FUNCTION reject_immutable_update_except_void()
RETURNS TRIGGER AS $$
BEGIN
  -- Cascaded updates (sibling triggers like sync_transaction_amounts) are
  -- system-internal, not user-driven.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- One-way prepayment-application link: transitioning prepayment_applied_at
  -- from NULL to a timestamp is an accounting bookkeeping change, not a
  -- financial amendment.
  IF OLD.prepayment_applied_at IS NULL AND NEW.prepayment_applied_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('Voided', 'Refunded')
     AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at
  THEN
    RAISE EXCEPTION
      'Paid transactions are immutable (status %); use void/refund flow',
      OLD.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2b. Completed clinical_orders — only deleted_at change permitted; create
--     an amendment row instead.
CREATE OR REPLACE FUNCTION reject_immutable_update()
RETURNS TRIGGER AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION
      'Completed clinical orders are immutable; create amendment instead';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 3. Attach the immutability triggers
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_transactions_immutable ON transactions;
CREATE TRIGGER trg_transactions_immutable
  BEFORE UPDATE ON transactions
  FOR EACH ROW
  WHEN (OLD.status IN ('Paid', 'Voided'))
  EXECUTE FUNCTION reject_immutable_update_except_void();

DROP TRIGGER IF EXISTS trg_clinical_orders_immutable ON clinical_orders;
CREATE TRIGGER trg_clinical_orders_immutable
  BEFORE UPDATE ON clinical_orders
  FOR EACH ROW
  WHEN (OLD.status = 'Completed')
  EXECUTE FUNCTION reject_immutable_update();
