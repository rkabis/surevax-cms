-- =============================================================================
-- 0002_audit_and_redaction.sql — audit trigger + per-tenant counter provisioner
-- =============================================================================
-- Post-ID-redesign (W1.B) rewrite:
--   - audit_logs.id is bigserial (defaults). No in-trigger ID generation.
--   - entity_id stores the audited row's display_id (text). When the audited
--     table has no display_id (junction tables, status_history rows), we
--     fall back to NEW.id::text.
--   - entity_display_id is denormalized: same as entity_id when the row has
--     a display_id, else NULL.
--   - user_id / branch_id GUCs are read as text and cast to bigint before
--     INSERT (audit_logs.user_id and .branch_id are bigint).
--   - Trigger attachment list TRIMMED — notifications, service_eligible_products,
--     service_bundle_items, clinical_order_schedule_changes, patient_tags are
--     no longer audited (they're scoped via FK or composite-PK junctions whose
--     mutations are auditable via the parent entity).
--   - provision_tenant_counters(slug) added at the bottom — creates the
--     per-tenant MRN sequence (mrn_seq_<slug>).
--
-- The audit_action enum lives in 0000_initial.sql (trimmed + extended).
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS.
-- =============================================================================

CREATE OR REPLACE FUNCTION audit_log_changes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id        bigint;
  v_tenant_id      text;
  v_branch_id      bigint;
  v_changes        jsonb;
  v_entity_id      text;
  v_entity_disp    text;
  v_old            jsonb;
  v_new            jsonb;
  v_row_has_tenant boolean;
  v_row_has_disp   boolean;
BEGIN
  -- Skip UPDATE if nothing actually changed.
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) = to_jsonb(NEW) THEN
    RETURN NULL;
  END IF;

  -- Read session context (set inside db.transaction()).
  BEGIN
    v_user_id := NULLIF(current_setting('app.current_user_id', true), '')::bigint;
  EXCEPTION WHEN others THEN v_user_id := NULL; END;
  BEGIN
    v_tenant_id := NULLIF(current_setting('app.current_tenant_id', true), '');
  EXCEPTION WHEN others THEN v_tenant_id := NULL; END;
  BEGIN
    v_branch_id := NULLIF(current_setting('app.current_branch_id', true), '')::bigint;
  EXCEPTION WHEN others THEN v_branch_id := NULL; END;

  -- All audited tenant-scoped tables carry tenant_id; refuse the write if
  -- the GUC isn't set.
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_row_has_tenant := (to_jsonb(NEW) ? 'tenant_id');
  ELSE
    v_row_has_tenant := (to_jsonb(OLD) ? 'tenant_id');
  END IF;

  IF v_row_has_tenant AND v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'audit_log: app.current_tenant_id GUC not set — write must be inside db.transaction() with set_config'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Redact sensitive columns from the JSONB diff.
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_old := to_jsonb(OLD)
      - 'password_hash' - 'token' - 'token_hash' - 'credentials'
      - 'api_key' - 'api_secret' - 'api_config'
      - 'contact_number' - 'email' - 'address'
      - 'barangay' - 'city' - 'province'
      - 'date_of_birth' - 'first_name' - 'last_name' - 'middle_name' - 'suffix'
      - 'preferred_name' - 'full_name' - 'mrn' - 'search_vector'
      - 'civil_status' - 'nationality' - 'region'
      - 'guardian_name' - 'guardian_contact' - 'guardian_relationship'
      - 'insurance_policy_number' - 'insurance_provider'
      - 'allergies' - 'conditions' - 'onboarding_data' - 'details'
      - 'notes' - 'specialty_data' - 'clinical_notes'
      - 'symptoms_coded' - 'result_data';
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_new := to_jsonb(NEW)
      - 'password_hash' - 'token' - 'token_hash' - 'credentials'
      - 'api_key' - 'api_secret' - 'api_config'
      - 'contact_number' - 'email' - 'address'
      - 'barangay' - 'city' - 'province'
      - 'date_of_birth' - 'first_name' - 'last_name' - 'middle_name' - 'suffix'
      - 'preferred_name' - 'full_name' - 'mrn' - 'search_vector'
      - 'civil_status' - 'nationality' - 'region'
      - 'guardian_name' - 'guardian_contact' - 'guardian_relationship'
      - 'insurance_policy_number' - 'insurance_provider'
      - 'allergies' - 'conditions' - 'onboarding_data' - 'details'
      - 'notes' - 'specialty_data' - 'clinical_notes'
      - 'symptoms_coded' - 'result_data';
  END IF;

  -- entity_id: prefer display_id text; fall back to bigint PK as text.
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_row_has_disp := (to_jsonb(NEW) ? 'display_id');
    IF v_row_has_disp THEN
      v_entity_disp := to_jsonb(NEW) ->> 'display_id';
      v_entity_id   := v_entity_disp;
    ELSE
      v_entity_disp := NULL;
      v_entity_id   := to_jsonb(NEW) ->> 'id';
    END IF;
    IF TG_OP = 'INSERT' THEN
      v_changes := jsonb_build_object('after', v_new);
    ELSE
      v_changes := jsonb_build_object('before', v_old, 'after', v_new);
    END IF;
  ELSE
    v_row_has_disp := (to_jsonb(OLD) ? 'display_id');
    IF v_row_has_disp THEN
      v_entity_disp := to_jsonb(OLD) ->> 'display_id';
      v_entity_id   := v_entity_disp;
    ELSE
      v_entity_disp := NULL;
      v_entity_id   := to_jsonb(OLD) ->> 'id';
    END IF;
    v_changes := jsonb_build_object('before', v_old);
  END IF;

  INSERT INTO audit_logs (
    tenant_id, user_id, action, entity_type, entity_id, entity_display_id,
    branch_id, correlation_id, ip_address, user_agent, changes, "timestamp"
  ) VALUES (
    v_tenant_id,
    v_user_id,
    CASE TG_OP
      WHEN 'INSERT' THEN 'CREATE'::audit_action
      WHEN 'UPDATE' THEN 'UPDATE'::audit_action
      WHEN 'DELETE' THEN 'DELETE'::audit_action
    END,
    TG_TABLE_NAME,
    v_entity_id,
    v_entity_disp,
    v_branch_id,
    NULLIF(current_setting('app.current_correlation_id', true), ''),
    NULLIF(current_setting('app.current_ip_address', true), ''),
    NULLIF(current_setting('app.current_user_agent', true), ''),
    v_changes,
    NOW()
  );

  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- Attach audit trigger to clinical / financial / config tables.
-- Dropped from the prior list (per ID redesign + audit-log handover):
--   notifications, service_eligible_products, service_bundle_items,
--   clinical_order_schedule_changes, patient_tags
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'patients', 'encounters', 'patient_standing_orders', 'clinical_orders',
    'standing_order_template_items',
    'transactions', 'transaction_items', 'transaction_patients', 'payments', 'group_bills',
    'inventory_lots',
    'service_catalog', 'standing_order_templates',
    'users', 'branches',
    'user_branches', 'user_roles',
    'locations', 'cash_drawer_sessions',
    'patient_emergency_contacts', 'patient_allergies', 'patient_conditions',
    'patient_external_immunizations', 'tag_definitions',
    'service_prices', 'payer_contracts', 'payer_profiles',
    'appointments',
    'encounter_vitals', 'encounter_diagnoses',
    'consents', 'adverse_events',
    'inventory_movements', 'product_recalls',
    'claims', 'claim_items',
    'partner_laboratories', 'lab_orders',
    'feature_flags', 'notification_templates',
    'approval_requests', 'approval_decisions',
    'attachments',
    'products', 'service_categories',
    'bite_incidents', 'animal_observation_followups',
    'inventory_transfers',
    'staff_time_logs',
    'cash_deposits', 'payer_price_adjustment_exclusions'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = t
    ) THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_audit ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_audit
       AFTER INSERT OR UPDATE OR DELETE ON %I
       FOR EACH ROW EXECUTE FUNCTION audit_log_changes()',
      t, t
    );
  END LOOP;
END;
$$;

COMMENT ON COLUMN audit_logs.entity_type IS
  'Polymorphic entity reference: any audited table name. By design — audit logs span every entity. No FK by intent.';
COMMENT ON COLUMN audit_logs.entity_id IS
  'Display-ID of the audited row when the table has one; bigint PK::text otherwise.';
COMMENT ON COLUMN audit_logs.entity_display_id IS
  'Denormalized copy of the audited row''s display_id (NULL for bigserial-only tables).';

-- ---------------------------------------------------------------------------
-- provision_tenant_counters(slug)
-- Creates the per-tenant MRN sequence. Called by tenant-onboarding flow
-- whenever a new tenant slug is registered.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION provision_tenant_counters(slug text)
RETURNS void AS $$
BEGIN
  EXECUTE format('CREATE SEQUENCE IF NOT EXISTS mrn_seq_%s OWNED BY NONE', lower(slug));
END;
$$ LANGUAGE plpgsql;

-- ─── Audit-log hash chain (folded from 0009_audit_chain.sql) ─────────────────
-- SHA-256 tamper-evidence chain on audit_logs rows. Each row's chain_hash
-- covers the row's content + the prior row's chain_hash within the partition.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS chain_hash bytea;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS chain_sequence bigint;

-- Preserve the historical timestamp/id order while assigning a durable chain
-- order. New rows receive their value only after taking the partition lock.
WITH ordered AS (
  SELECT id, "timestamp",
         row_number() OVER (
           PARTITION BY date_trunc('month', "timestamp")
           ORDER BY "timestamp" ASC, id ASC
         )::bigint AS sequence_no
    FROM audit_logs
)
UPDATE audit_logs a
   SET chain_sequence = o.sequence_no
  FROM ordered o
 WHERE a.id = o.id
   AND a."timestamp" = o."timestamp"
   AND a.chain_sequence IS NULL;

CREATE TABLE IF NOT EXISTS audit_chain_heads (
  partition_start date PRIMARY KEY,
  last_hash bytea NOT NULL,
  last_sequence bigint NOT NULL CHECK (last_sequence > 0)
);

CREATE OR REPLACE FUNCTION compute_audit_chain_hash(
  prev_hash      bytea,
  p_tenant_id    text,
  p_id           bigint,
  p_timestamp    timestamptz,
  p_action       text,
  p_entity_type  text,
  p_entity_id    text,
  p_changes      jsonb,
  p_metadata     jsonb
) RETURNS bytea
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT digest(
    COALESCE(prev_hash, ''::bytea) ||
    digest(
      p_id::text || '|' ||
      p_tenant_id || '|' ||
      p_timestamp::text || '|' ||
      p_action || '|' ||
      p_entity_type || '|' ||
      COALESCE(p_entity_id, '') || '|' ||
      COALESCE(p_changes::text, '') || '|' ||
      COALESCE(p_metadata::text, ''),
      'sha256'
    ),
    'sha256'
  );
$$;

COMMENT ON FUNCTION compute_audit_chain_hash IS
  'Pure SHA-256 chain step: hash(prev_hash || hash(row_fields)). Inputs in the same order are used by the BEFORE-INSERT trigger and the offline verification walker.';

CREATE OR REPLACE FUNCTION audit_logs_chain_link() RETURNS trigger AS $$
DECLARE
  v_partition_start date;
  v_previous_hash bytea;
  v_previous_sequence bigint;
BEGIN
  IF NEW.chain_hash IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_partition_start := date_trunc('month', NEW."timestamp")::date;

  -- Serialize the entire transaction by month without changing durable head
  -- state yet. A BEFORE trigger also runs for INSERT ... ON CONFLICT DO
  -- NOTHING rows that are later discarded; advancing the head here would
  -- create a phantom predecessor and make the next real row unverifiable.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('surevax:audit-chain:' || v_partition_start::text, 0)
  );

  SELECT last_hash, last_sequence
    INTO v_previous_hash, v_previous_sequence
    FROM audit_chain_heads
   WHERE partition_start = v_partition_start;

  NEW.chain_sequence := COALESCE(v_previous_sequence, 0) + 1;
  NEW.chain_hash := compute_audit_chain_hash(
    v_previous_hash, NEW.tenant_id, NEW.id, NEW."timestamp", NEW.action::text,
    NEW.entity_type, NEW.entity_id, NEW.changes, NEW.metadata
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog;

CREATE OR REPLACE FUNCTION audit_logs_chain_commit_head() RETURNS trigger AS $$
BEGIN
  -- AFTER INSERT fires only when the row survived conflict handling. The
  -- transaction-scoped advisory lock acquired above is still held here.
  INSERT INTO audit_chain_heads (partition_start, last_hash, last_sequence)
  VALUES (date_trunc('month', NEW."timestamp")::date, NEW.chain_hash, NEW.chain_sequence)
  ON CONFLICT (partition_start) DO UPDATE
    SET last_hash = EXCLUDED.last_hash,
        last_sequence = EXCLUDED.last_sequence;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog;

DROP TRIGGER IF EXISTS audit_logs_chain_link_trg ON audit_logs;
CREATE TRIGGER audit_logs_chain_link_trg
  BEFORE INSERT ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION audit_logs_chain_link();

DROP TRIGGER IF EXISTS audit_logs_chain_commit_head_trg ON audit_logs;
CREATE TRIGGER audit_logs_chain_commit_head_trg
  AFTER INSERT ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION audit_logs_chain_commit_head();

-- Backfill existing rows (no-op on fresh DBs).
DO $$
DECLARE
  r               RECORD;
  prev_hash       bytea := NULL;
  prev_partition  date  := NULL;
  cur_partition   date;
BEGIN
  FOR r IN
    SELECT id, "timestamp", tenant_id, action::text AS action, entity_type, entity_id, changes, metadata
    FROM audit_logs
    WHERE chain_hash IS NULL
    ORDER BY "timestamp" ASC, id ASC
  LOOP
    cur_partition := date_trunc('month', r."timestamp")::date;
    IF prev_partition IS NULL OR prev_partition <> cur_partition THEN
      prev_hash := NULL;
    END IF;

    UPDATE audit_logs
       SET chain_hash = compute_audit_chain_hash(
         prev_hash, r.tenant_id, r.id, r."timestamp", r.action,
         r.entity_type, r.entity_id, r.changes, r.metadata
       )
     WHERE id = r.id AND "timestamp" = r."timestamp"
     RETURNING chain_hash INTO prev_hash;

    prev_partition := cur_partition;
  END LOOP;
END $$;

-- Seed/update the append heads from the last stored row in each partition.
INSERT INTO audit_chain_heads (partition_start, last_hash, last_sequence)
SELECT DISTINCT ON (date_trunc('month', "timestamp")::date)
       date_trunc('month', "timestamp")::date,
       chain_hash,
       chain_sequence
  FROM audit_logs
 WHERE chain_hash IS NOT NULL
 ORDER BY date_trunc('month', "timestamp")::date, chain_sequence DESC
ON CONFLICT (partition_start) DO UPDATE
  SET last_hash = EXCLUDED.last_hash,
      last_sequence = EXCLUDED.last_sequence;

REVOKE ALL ON audit_chain_heads FROM PUBLIC;

ALTER TABLE audit_logs ALTER COLUMN chain_hash SET NOT NULL;
ALTER TABLE audit_logs ALTER COLUMN chain_sequence SET NOT NULL;

-- ─── Audit-chain verifier (folded from 0011_audit_chain_verifier.sql) ────────
-- SECURITY DEFINER function that walks an audit_logs partition and returns rows
-- whose stored chain_hash disagrees with the recomputed hash.

CREATE OR REPLACE FUNCTION verify_audit_chain(partition_name text)
RETURNS TABLE (
  id              bigint,
  ts              timestamptz,
  stored_hash     bytea,
  expected_hash   bytea,
  match           boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  qualified text;
BEGIN
  IF partition_name !~ '^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$' THEN
    RAISE EXCEPTION 'invalid partition_name: %', partition_name
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  qualified := partition_name;

  RETURN QUERY EXECUTE format($q$
    WITH ordered AS (
      SELECT
        r.id,
        r."timestamp"   AS ts,
        r.tenant_id,
        r.action::text  AS action,
        r.entity_type,
        r.entity_id,
        r.changes,
        r.metadata,
        r.chain_hash    AS stored_hash,
        LAG(r.chain_hash) OVER (ORDER BY r.chain_sequence ASC) AS prev_hash
      FROM %s r
    )
    SELECT
      o.id,
      o.ts,
      o.stored_hash,
      compute_audit_chain_hash(
        o.prev_hash, o.tenant_id, o.id, o.ts, o.action,
        o.entity_type, o.entity_id, o.changes, o.metadata
      ) AS expected_hash,
      (o.stored_hash = compute_audit_chain_hash(
        o.prev_hash, o.tenant_id, o.id, o.ts, o.action,
        o.entity_type, o.entity_id, o.changes, o.metadata
      )) AS match
    FROM ordered o
    WHERE o.stored_hash IS DISTINCT FROM compute_audit_chain_hash(
      o.prev_hash, o.tenant_id, o.id, o.ts, o.action,
      o.entity_type, o.entity_id, o.changes, o.metadata
    )
    ORDER BY o.ts ASC, o.id ASC
  $q$, qualified);
END;
$$;

COMMENT ON FUNCTION verify_audit_chain(text) IS
  'Walks an audit_logs monthly partition and returns rows whose stored chain_hash disagrees with the recomputed hash. Returns zero rows on an intact chain. Invoked via GET /api/admin/audit/verify-chain.';

REVOKE ALL ON FUNCTION verify_audit_chain(text) FROM PUBLIC;

-- ─── Audit trigger strict-mode v2 (folded from 0024_audit_trigger_strict.sql) ─
-- H6 strict-mode phase 2: adds tenant-match check so a cross-tenant write is
-- rejected at the trigger before the row commits (GUC must equal row.tenant_id).

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION audit_log_changes() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id          bigint;
  v_tenant_id        text;
  v_branch_id        bigint;
  v_row_has_tenant   boolean;
  v_row_tenant       text;
  v_old              jsonb;
  v_new              jsonb;
  v_changes          jsonb;
  v_row_has_disp     boolean;
  v_entity_id        text;
  v_entity_disp      text;
BEGIN
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) = to_jsonb(NEW) THEN
    RETURN NULL;
  END IF;

  v_user_id   := NULLIF(current_setting('app.current_user_id', true), '')::bigint;
  v_tenant_id := NULLIF(current_setting('app.current_tenant_id', true), '');
  v_branch_id := NULLIF(current_setting('app.current_branch_id', true), '')::bigint;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_row_has_tenant := (to_jsonb(NEW) ? 'tenant_id');
  ELSE
    v_row_has_tenant := (to_jsonb(OLD) ? 'tenant_id');
  END IF;

  IF v_row_has_tenant THEN
    IF v_tenant_id IS NULL THEN
      RAISE EXCEPTION 'audit_log: app.current_tenant_id GUC not set — write must be inside withTenantTx with set_config'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      v_row_tenant := to_jsonb(NEW) ->> 'tenant_id';
    ELSE
      v_row_tenant := to_jsonb(OLD) ->> 'tenant_id';
    END IF;

    IF v_row_tenant IS NOT NULL AND v_row_tenant != v_tenant_id THEN
      RAISE EXCEPTION 'audit_log: app.current_tenant_id (%) does not match row tenant_id (%) — cross-tenant write rejected',
        v_tenant_id, v_row_tenant
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_old := to_jsonb(OLD)
      - 'password_hash' - 'token' - 'token_hash' - 'credentials'
      - 'api_key' - 'api_secret' - 'api_config'
      - 'contact_number' - 'email' - 'address'
      - 'barangay' - 'city' - 'province'
      - 'date_of_birth' - 'first_name' - 'last_name' - 'middle_name' - 'suffix'
      - 'preferred_name' - 'full_name' - 'mrn' - 'search_vector'
      - 'civil_status' - 'nationality' - 'region'
      - 'guardian_name' - 'guardian_contact' - 'guardian_relationship'
      - 'insurance_policy_number' - 'insurance_provider'
      - 'allergies' - 'conditions' - 'onboarding_data' - 'details'
      - 'notes' - 'specialty_data' - 'clinical_notes'
      - 'symptoms_coded' - 'result_data';
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_new := to_jsonb(NEW)
      - 'password_hash' - 'token' - 'token_hash' - 'credentials'
      - 'api_key' - 'api_secret' - 'api_config'
      - 'contact_number' - 'email' - 'address'
      - 'barangay' - 'city' - 'province'
      - 'date_of_birth' - 'first_name' - 'last_name' - 'middle_name' - 'suffix'
      - 'preferred_name' - 'full_name' - 'mrn' - 'search_vector'
      - 'civil_status' - 'nationality' - 'region'
      - 'guardian_name' - 'guardian_contact' - 'guardian_relationship'
      - 'insurance_policy_number' - 'insurance_provider'
      - 'allergies' - 'conditions' - 'onboarding_data' - 'details'
      - 'notes' - 'specialty_data' - 'clinical_notes'
      - 'symptoms_coded' - 'result_data';
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_row_has_disp := (to_jsonb(NEW) ? 'display_id');
    IF v_row_has_disp THEN
      v_entity_disp := to_jsonb(NEW) ->> 'display_id';
      v_entity_id   := v_entity_disp;
    ELSE
      v_entity_disp := NULL;
      v_entity_id   := to_jsonb(NEW) ->> 'id';
    END IF;
    IF TG_OP = 'INSERT' THEN
      v_changes := jsonb_build_object('after', v_new);
    ELSE
      v_changes := jsonb_build_object('before', v_old, 'after', v_new);
    END IF;
  ELSE
    v_row_has_disp := (to_jsonb(OLD) ? 'display_id');
    IF v_row_has_disp THEN
      v_entity_disp := to_jsonb(OLD) ->> 'display_id';
      v_entity_id   := v_entity_disp;
    ELSE
      v_entity_disp := NULL;
      v_entity_id   := to_jsonb(OLD) ->> 'id';
    END IF;
    v_changes := jsonb_build_object('before', v_old);
  END IF;

  INSERT INTO audit_logs (
    tenant_id, user_id, action, entity_type, entity_id, entity_display_id,
    branch_id, correlation_id, ip_address, user_agent, changes, "timestamp"
  ) VALUES (
    v_tenant_id,
    v_user_id,
    CASE TG_OP
      WHEN 'INSERT' THEN 'CREATE'::audit_action
      WHEN 'UPDATE' THEN 'UPDATE'::audit_action
      WHEN 'DELETE' THEN 'DELETE'::audit_action
    END,
    TG_TABLE_NAME,
    v_entity_id,
    v_entity_disp,
    v_branch_id,
    NULLIF(current_setting('app.current_correlation_id', true), ''),
    NULLIF(current_setting('app.current_ip_address', true), ''),
    NULLIF(current_setting('app.current_user_agent', true), ''),
    v_changes,
    NOW()
  );

  RETURN NULL;
END
$$;

-- ─── DB-3: Attach audit trigger to previously-omitted tables (from 0028_db_remediation.sql) ─

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cross_branch_access_grants',
    'patient_tags',
    'service_eligible_products',
    'service_bundle_items',
    'tenant_counters'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_audit ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_audit
       AFTER INSERT OR UPDATE OR DELETE ON %I
       FOR EACH ROW EXECUTE FUNCTION audit_log_changes()',
      t, t
    );
  END LOOP;
END;
$$;
