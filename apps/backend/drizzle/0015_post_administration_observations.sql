-- =============================================================================
-- 0015_post_administration_observations.sql
-- Durable post-dose observation and explicit discharge acknowledgement.
-- =============================================================================

CREATE TABLE IF NOT EXISTS post_administration_observations (
  id                      bigserial PRIMARY KEY,
  display_id              text NOT NULL UNIQUE,
  tenant_id               text NOT NULL REFERENCES tenants(id),
  clinical_order_id       bigint NOT NULL REFERENCES clinical_orders(id),
  patient_id              bigint NOT NULL REFERENCES patients(id),
  branch_id               bigint NOT NULL REFERENCES branches(id),
  duration_minutes        integer NOT NULL DEFAULT 15,
  observe_until           timestamptz NOT NULL,
  outcome                 text,
  outcome_notes           text,
  outcome_recorded_at     timestamptz,
  outcome_recorded_by_id  bigint REFERENCES users(id),
  discharged_at           timestamptz,
  discharged_by_id        bigint REFERENCES users(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_by_id           bigint REFERENCES users(id),
  CONSTRAINT post_admin_observations_tenant_order_uniq
    UNIQUE (tenant_id, clinical_order_id),
  CONSTRAINT post_admin_observations_duration_check
    CHECK (duration_minutes BETWEEN 1 AND 240),
  CONSTRAINT post_admin_observations_outcome_check
    CHECK (outcome IS NULL OR outcome IN ('NoReaction', 'Reaction', 'Escalated')),
  CONSTRAINT post_admin_observations_outcome_state_check CHECK (
    (outcome IS NULL AND outcome_recorded_at IS NULL AND outcome_recorded_by_id IS NULL)
    OR
    (outcome IS NOT NULL AND outcome_recorded_at IS NOT NULL AND outcome_recorded_by_id IS NOT NULL)
  ),
  CONSTRAINT post_admin_observations_reaction_notes_check CHECK (
    outcome NOT IN ('Reaction', 'Escalated') OR length(trim(outcome_notes)) >= 5
  ),
  CONSTRAINT post_admin_observations_discharge_state_check CHECK (
    (discharged_at IS NULL AND discharged_by_id IS NULL)
    OR
    (discharged_at IS NOT NULL AND discharged_by_id IS NOT NULL AND outcome IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS post_admin_observations_today_idx
  ON post_administration_observations
    (tenant_id, branch_id, discharged_at, observe_until);

DROP TRIGGER IF EXISTS trg_post_administration_observations_updated_at
  ON post_administration_observations;
CREATE TRIGGER trg_post_administration_observations_updated_at
  BEFORE UPDATE ON post_administration_observations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_post_administration_observations_audit
  ON post_administration_observations;
CREATE TRIGGER trg_post_administration_observations_audit
  AFTER INSERT OR UPDATE OR DELETE ON post_administration_observations
  FOR EACH ROW EXECUTE FUNCTION audit_log_changes();

ALTER TABLE post_administration_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_administration_observations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON post_administration_observations;
CREATE POLICY tenant_isolation ON post_administration_observations
  USING (
    current_setting('app.is_platform_admin', true) = 'true'
    OR tenant_id = current_setting('app.current_tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.is_platform_admin', true) = 'true'
    OR tenant_id = current_setting('app.current_tenant_id', true)
  );

DROP POLICY IF EXISTS branch_isolation ON post_administration_observations;
CREATE POLICY branch_isolation ON post_administration_observations
  AS RESTRICTIVE
  USING (
    current_setting('app.is_platform_admin', true) = 'true'
    OR current_setting('app.cross_branch_read', true) = 'true'
    OR branch_id = NULLIF(current_setting('app.current_branch_id', true), '')::bigint
  )
  WITH CHECK (
    current_setting('app.is_platform_admin', true) = 'true'
    OR branch_id = NULLIF(current_setting('app.current_branch_id', true), '')::bigint
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'surevax_app') THEN
    GRANT SELECT, INSERT, UPDATE ON post_administration_observations TO surevax_app;
    GRANT USAGE, SELECT ON SEQUENCE post_administration_observations_id_seq TO surevax_app;
  END IF;
END $$;
