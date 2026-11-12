-- 0010_fanout_linkage.sql: forward migration for the bundle fan-out linkage
-- feature. Adds clinical_orders.fan_out_transaction_id (nullable bigint, FK
-- to transactions) so voiding a point-of-sale transaction can find and
-- unwind the clinical_orders its bundle fan-out created.
--
-- WHY THIS FILE EXISTS
--
-- The column was added by hand-editing the baseline (0000_initial.sql),
-- which is the repo's convention for schema changes, and it works ONLY for
-- a database created from scratch. Any database that already recorded
-- 0000_initial as applied (every existing deploy, including Railway) never
-- re-runs it, so the column would never reach them without this file.
-- Mirrors 0009_payment_void.sql's role.
--
-- This replaces a stopgap that stamped clinical_orders.notes (a JSONB,
-- client-visible column) with {"fanOutTransactionId": <transactions.id>}
-- and read it back with notes ->> 'fanOutTransactionId'. That leaked an
-- internal bigint PK onto the wire and was destroyed the first time anyone
-- wrote a real note to a fanned-out order. See gotchas.md / bundleFanOut.ts
-- / fanOutVoid.ts for the linkage's actual use.
--
-- The column is nullable with no backfill required: this file contains no
-- INSERT/UPDATE/DELETE on audited tables and therefore needs no
-- set_config('app.current_tenant_id', ...) DO-block wrapper (see
-- gotchas.md "Audit trigger raises on missing tenant GUC").
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

-- 1. The linkage column. NULL = not created by a bundle fan-out.
ALTER TABLE clinical_orders ADD COLUMN IF NOT EXISTS fan_out_transaction_id bigint;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clinical_orders_fan_out_transaction_id_transactions_id_fk'
  ) THEN
    ALTER TABLE clinical_orders
      ADD CONSTRAINT clinical_orders_fan_out_transaction_id_transactions_id_fk
      FOREIGN KEY (fan_out_transaction_id) REFERENCES transactions(id);
  END IF;
END $$;

-- 2. Fast lookup of "every clinical_order this transaction fanned out": the
-- only query shape the void-unwind path actually needs.
CREATE INDEX IF NOT EXISTS clinical_orders_fan_out_txn_idx
  ON clinical_orders (fan_out_transaction_id)
  WHERE fan_out_transaction_id IS NOT NULL;
