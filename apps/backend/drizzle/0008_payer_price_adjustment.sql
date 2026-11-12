-- 0008_payer_price_adjustment.sql: forward migration for the payer-wide
-- percentage price adjustment (payer_profiles.price_adjustment_percent +
-- the payer_price_adjustment_exclusions opt-out table).
--
-- WHY THIS FILE EXISTS
--
-- Both objects were added by hand-editing the baseline (0000_initial.sql),
-- which is the repo's convention for schema changes — and it works ONLY for
-- a database created from scratch. Any database that already recorded
-- `0000_initial` as applied (every existing deploy, including Railway) never
-- re-runs it, so the column and table would never reach them without this
-- file. Mirrors 0009_brand_pricing.sql's role for service_prices.product_id
-- before that file was folded back into the baseline in the 2026-07-30
-- consolidation once it had done its job everywhere.
--
-- Idempotent throughout: a no-op on a database created from the current
-- baseline, and brings an existing database up to the baseline's shape.

SET lock_timeout = '5s';

-- 1. The column itself. NULL = no adjustment for this payer.
ALTER TABLE payer_profiles
  ADD COLUMN IF NOT EXISTS price_adjustment_percent numeric(5, 2);

-- 2. The exclusion junction table.
CREATE TABLE IF NOT EXISTS "payer_price_adjustment_exclusions" (
  "tenant_id" text NOT NULL,
  "payer_id" bigint NOT NULL,
  "service_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_id" bigint,
  CONSTRAINT "payer_price_adjustment_exclusions_tenant_id_payer_id_service_id_pk"
    PRIMARY KEY ("tenant_id", "payer_id", "service_id")
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payer_price_adjustment_exclusions_tenant_id_tenants_id_fk'
  ) THEN
    ALTER TABLE payer_price_adjustment_exclusions
      ADD CONSTRAINT payer_price_adjustment_exclusions_tenant_id_tenants_id_fk
      FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payer_price_adjustment_exclusions_payer_id_payer_profiles_id_fk'
  ) THEN
    ALTER TABLE payer_price_adjustment_exclusions
      ADD CONSTRAINT payer_price_adjustment_exclusions_payer_id_payer_profiles_id_fk
      FOREIGN KEY (payer_id) REFERENCES payer_profiles(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payer_price_adjustment_exclusions_service_id_service_catalog_id_fk'
  ) THEN
    ALTER TABLE payer_price_adjustment_exclusions
      ADD CONSTRAINT payer_price_adjustment_exclusions_service_id_service_catalog_id_fk
      FOREIGN KEY (service_id) REFERENCES service_catalog(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS payer_price_adjustment_exclusions_payer_idx
  ON payer_price_adjustment_exclusions (tenant_id, payer_id);

-- Audit trigger (mirrors the service_eligible_products attachment in
-- 0002_audit_and_redaction.sql). Relies on audit_log_changes() already
-- existing from that file, which runs before this one in migrate.ts.
DROP TRIGGER IF EXISTS trg_payer_price_adjustment_exclusions_audit
  ON payer_price_adjustment_exclusions;
CREATE TRIGGER trg_payer_price_adjustment_exclusions_audit
  AFTER INSERT OR UPDATE OR DELETE ON payer_price_adjustment_exclusions
  FOR EACH ROW EXECUTE FUNCTION audit_log_changes();

-- RLS: tenant_isolation only — no branch_id column, same shape as
-- service_eligible_products (tenant-wide reference/config data).
ALTER TABLE payer_price_adjustment_exclusions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payer_price_adjustment_exclusions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON payer_price_adjustment_exclusions;
CREATE POLICY tenant_isolation ON payer_price_adjustment_exclusions
  USING (
    current_setting('app.is_platform_admin', true) = 'true'
    OR tenant_id = current_setting('app.current_tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.is_platform_admin', true) = 'true'
    OR tenant_id = current_setting('app.current_tenant_id', true)
  );
