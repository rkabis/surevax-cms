-- =============================================================================
-- 0007_retention_procs.sql — partition rotation + PHI retention procedures
-- =============================================================================
-- Two SECURITY-DEFINER / OWNER-only procedures:
--   1. create_next_audit_partitions(months_ahead INT)
--      Pre-creates monthly audit_logs partitions; called from pg_cron (if
--      installed) or external scheduler (Railway cron).
--   2. purge_phi_access_log(p_tenant_id, p_retention_days, OUT p_deleted)
--      SECURITY DEFINER deleter that bypasses the RESTRICTIVE FOR DELETE
--      policy on phi_access_log (defined in 0001). The caller must supply
--      tenant_id explicitly so cross-tenant data is never touched.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. audit_logs partition maintenance
-- ---------------------------------------------------------------------------

-- AUTH-2: SECURITY DEFINER so the demoted app role (surevax_app, NOBYPASSRLS,
-- non-superuser) can CALL this. The procedure does DDL (CREATE TABLE partition)
-- which the app role cannot do on its own. The auditPartitionRotate worker
-- runs as the app role per the standard runtime connection.
CREATE OR REPLACE PROCEDURE create_next_audit_partitions(months_ahead INT DEFAULT 3)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  i       INT;
  p_start DATE;
  p_end   DATE;
  p_name  TEXT;
BEGIN
  FOR i IN 0..months_ahead LOOP
    p_start := date_trunc('month', CURRENT_DATE + (i || ' months')::interval)::date;
    p_end   := (p_start + INTERVAL '1 month')::date;
    p_name  := 'audit_logs_' || to_char(p_start, 'YYYY_MM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
      p_name, p_start, p_end
    );
  END LOOP;
END;
$$;

COMMENT ON PROCEDURE create_next_audit_partitions(INT) IS
  'Maintenance: pre-creates monthly partitions of audit_logs. Run via pg_cron (auto-scheduled below) or external scheduler at least monthly with months_ahead >= 3 to avoid INSERT failures on month rollover.';

-- One-off seed: ensure 12 months of forward partitions on a fresh DB.
CALL create_next_audit_partitions(12);

-- pg_cron auto-schedule (only if extension installed). Runs 02:30 UTC on
-- the 1st of each month. Safe to no-op on environments without pg_cron.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('audit_logs_partition_maintenance');
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- first run — nothing to unschedule
    END;

    PERFORM cron.schedule(
      'audit_logs_partition_maintenance',
      '30 2 1 * *',
      $cron$ CALL create_next_audit_partitions(6); $cron$
    );
  ELSE
    RAISE NOTICE 'pg_cron not installed — schedule audit partition maintenance externally (Railway cron / k8s CronJob).';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. PHI access-log retention purge
-- The phi_access_log_no_delete RESTRICTIVE policy in 0001 blocks all DELETEs
-- via the app connection. SECURITY DEFINER lets this procedure bypass RLS as
-- the DB owner; the caller still passes tenant_id explicitly so cleanup never
-- crosses tenant boundaries.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE PROCEDURE purge_phi_access_log(
  p_tenant_id      text,
  p_retention_days int,
  INOUT p_deleted  bigint DEFAULT 0
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM phi_access_log
  WHERE tenant_id = p_tenant_id
    AND "timestamp" < now() - (p_retention_days || ' days')::interval;

  GET DIAGNOSTICS p_deleted = ROW_COUNT;
END;
$$;

-- ─── Audit-log retention (folded from 0010_audit_retention.sql) ──────────────
-- DPA-aligned 10-year retention: drops audit_logs partitions via pg_cron.

CREATE OR REPLACE PROCEDURE retain_audit_partitions(retain_years int DEFAULT 10)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cutoff       date;
  p_name       text;
  p_range_end  date;
  rec          record;
BEGIN
  IF retain_years < 1 THEN
    RAISE EXCEPTION 'retain_years must be >= 1 (refusing to prune everything)';
  END IF;

  cutoff := (date_trunc('month', CURRENT_DATE) - (retain_years || ' years')::interval)::date;

  FOR rec IN
    SELECT
      c.oid::regclass::text AS partition_name,
      pg_get_expr(c.relpartbound, c.oid) AS bound_expr
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = 'audit_logs'::regclass
      AND c.relname <> 'audit_logs_default'
  LOOP
    BEGIN
      p_range_end := (regexp_replace(rec.bound_expr, '.*TO \(''([^'']+)''\).*', '\1'))::date;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'retain_audit_partitions: could not parse bound on %, skipping', rec.partition_name;
      CONTINUE;
    END;

    IF p_range_end <= cutoff THEN
      p_name := rec.partition_name;
      RAISE NOTICE 'retain_audit_partitions: dropping %', p_name;
      EXECUTE format('DROP TABLE IF EXISTS %s', p_name);
    END IF;
  END LOOP;
END;
$$;

COMMENT ON PROCEDURE retain_audit_partitions(int) IS
  'DPA-aligned retention: drops audit_logs partitions whose range_end <= today - retain_years (default 10). Runs via pg_cron auto-schedule below, or via the external scheduler if pg_cron is absent.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('audit_logs_retention');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    PERFORM cron.schedule(
      'audit_logs_retention',
      '0 3 5 * *',
      $cron$ CALL retain_audit_partitions(10); $cron$
    );
  ELSE
    RAISE NOTICE 'pg_cron not installed — schedule retain_audit_partitions(10) externally (Railway cron / k8s CronJob).';
  END IF;
END $$;

-- ─── Tenant counters procedures (folded from 0012_tenant_counters.sql) ────────
-- Procedures only — CREATE TABLE is already in 0000_initial.sql.

-- updated_at trigger (set_updated_at is defined in 0001).
DROP TRIGGER IF EXISTS tenant_counters_set_updated_at ON tenant_counters;
CREATE TRIGGER tenant_counters_set_updated_at
  BEFORE UPDATE ON tenant_counters
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE tenant_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_counters FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON tenant_counters;
CREATE POLICY tenant_isolation ON tenant_counters
  USING (
    current_setting('app.is_platform_admin', true) = 'true'
    OR tenant_id = current_setting('app.current_tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.is_platform_admin', true) = 'true'
    OR tenant_id = current_setting('app.current_tenant_id', true)
  );

DROP TRIGGER IF EXISTS tenant_counters_audit ON tenant_counters;
CREATE TRIGGER tenant_counters_audit
  AFTER INSERT OR UPDATE OR DELETE ON tenant_counters
  FOR EACH ROW EXECUTE FUNCTION audit_log_changes();

COMMENT ON TABLE tenant_counters IS
  'Gapless monotonic counter allocator scoped to (tenant_id, branch_id, counter_kind). Allocate via SELECT FOR UPDATE inside withTenantTx.';
COMMENT ON COLUMN tenant_counters.branch_id IS
  'NULL for tenant-wide counters (e.g. BIR_RECEIPT issued centrally); set for per-branch counters (e.g. TXN).';
COMMENT ON COLUMN tenant_counters.counter_kind IS
  'Identifier for the counter purpose. Conventions: TXN, BIR_RECEIPT, LAB_REQ, CLAIM_BATCH.';

-- ─── DPA purge_patient function (folded from 0018_dpa_purge_function.sql) ────
-- Dry-run-only cascade impact analysis for DPA right-to-erasure.

CREATE OR REPLACE FUNCTION purge_patient(
  p_patient_display_id text,
  p_dry_run            boolean DEFAULT true
)
RETURNS TABLE (entity text, affected_count integer)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_patient_id        bigint;
  v_tenant_id         text;
BEGIN
  SELECT id, tenant_id
    INTO v_patient_id, v_tenant_id
    FROM patients
   WHERE display_id = p_patient_display_id
   LIMIT 1;

  IF v_patient_id IS NULL THEN
    RAISE EXCEPTION 'DPA_PURGE_PATIENT_NOT_FOUND: %', p_patient_display_id
      USING ERRCODE = '22023';
  END IF;

  IF NOT p_dry_run THEN
    RAISE EXCEPTION 'DPA_PURGE_NOT_ENABLED: live purge requires the dpaPurger worker + multi-approver workflow (handover §5 B2). Use dry_run=true for impact analysis.'
      USING ERRCODE = '0A000';
  END IF;

  RETURN QUERY SELECT 'encounters'::text, COUNT(*)::int FROM encounters WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'clinical_orders'::text, COUNT(*)::int FROM clinical_orders WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'lab_orders'::text, COUNT(*)::int
    FROM lab_orders lo
    WHERE lo.clinical_order_id IN (SELECT co.id FROM clinical_orders co WHERE co.patient_id = v_patient_id);
  RETURN QUERY SELECT 'consents'::text, COUNT(*)::int FROM consents WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'patient_allergies'::text, COUNT(*)::int FROM patient_allergies WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'patient_conditions'::text, COUNT(*)::int FROM patient_conditions WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'patient_emergency_contacts'::text, COUNT(*)::int FROM patient_emergency_contacts WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'patient_external_immunizations'::text, COUNT(*)::int FROM patient_external_immunizations WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'patient_tags'::text, COUNT(*)::int FROM patient_tags WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'adverse_events'::text, COUNT(*)::int FROM adverse_events WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'bite_incidents'::text, COUNT(*)::int FROM bite_incidents WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'transactions (anonymize)'::text, COUNT(*)::int FROM transactions WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'payments (anonymize, via transactions)'::text, COUNT(*)::int
    FROM payments pmt
    WHERE pmt.transaction_id IN (SELECT t.id FROM transactions t WHERE t.patient_id = v_patient_id);
  RETURN QUERY SELECT 'notifications'::text, COUNT(*)::int FROM notifications WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'audit_logs (entity)'::text, COUNT(*)::int
    FROM audit_logs
    WHERE entity_type = 'patients'
      AND entity_display_id = p_patient_display_id;
END;
$$;

COMMENT ON FUNCTION purge_patient(text, boolean) IS
  'DPA right-to-erasure cascade-impact analysis (dry-run). Live purge gated until dpaPurger worker + multi-approver workflow ship — see docs/handovers/2026-05-19-remaining-todos.md §5 B2.';
