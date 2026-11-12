-- =============================================================================
-- 0013_compliance_incident_response.sql
-- Phase-1 DPA execution evidence + one-time emergency account recovery.
-- =============================================================================

ALTER TYPE approval_request_type ADD VALUE IF NOT EXISTS 'patient_erasure';
ALTER TYPE approval_request_type ADD VALUE IF NOT EXISTS 'emergency_access';

-- Compliance approvals have a database backstop in addition to the API row
-- lock: one vote per identity, same-tenant request binding, no requester vote,
-- and active TenantAdmin membership for either high-risk request type.
CREATE UNIQUE INDEX IF NOT EXISTS approval_decisions_request_decider_uniq
  ON approval_decisions (approval_request_id, decided_by_id);

CREATE OR REPLACE FUNCTION validate_compliance_approval_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_request approval_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request
    FROM approval_requests
   WHERE id = NEW.approval_request_id
     AND tenant_id = NEW.tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APPROVAL_REQUEST_TENANT_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  IF v_request.request_type IN ('patient_erasure', 'emergency_access') THEN
    IF NEW.decided_by_id = v_request.requested_by_id THEN
      RAISE EXCEPTION 'COMPLIANCE_SELF_APPROVAL_FORBIDDEN'
        USING ERRCODE = '23514';
    END IF;

    IF v_request.request_type = 'emergency_access' AND EXISTS (
      SELECT 1 FROM users u
       WHERE u.id = NEW.decided_by_id
         AND u.tenant_id = NEW.tenant_id
         AND u.display_id = v_request.entity_id
    ) THEN
      RAISE EXCEPTION 'EMERGENCY_ACCESS_TARGET_APPROVAL_FORBIDDEN'
        USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM users u
        JOIN user_roles ur
         ON ur.user_id = u.id
         AND ur.tenant_id = NEW.tenant_id
         AND ur.role = 'TenantAdmin'
         AND (ur.expires_at IS NULL OR ur.expires_at > now())
       WHERE u.id = NEW.decided_by_id
         AND u.tenant_id = NEW.tenant_id
         AND u.is_active = true
         AND u.can_login = true
         AND u.status = 'Active'
    ) THEN
      RAISE EXCEPTION 'COMPLIANCE_APPROVER_NOT_ACTIVE_TENANT_ADMIN'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_compliance_approval_decision ON approval_decisions;
CREATE TRIGGER trg_validate_compliance_approval_decision
  BEFORE INSERT OR UPDATE ON approval_decisions
  FOR EACH ROW EXECUTE FUNCTION validate_compliance_approval_decision();

CREATE TABLE IF NOT EXISTS dpa_erasure_executions (
  id                    bigserial PRIMARY KEY,
  display_id            text NOT NULL UNIQUE,
  tenant_id             text NOT NULL REFERENCES tenants(id),
  approval_request_id   bigint NOT NULL REFERENCES approval_requests(id),
  patient_display_id    text NOT NULL,
  executed_by_id        bigint NOT NULL REFERENCES users(id),
  request_reference     text NOT NULL,
  rollback_reference    text NOT NULL,
  impact_report         jsonb NOT NULL,
  completion_report     jsonb NOT NULL,
  rollback_report       jsonb NOT NULL,
  executed_at           timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dpa_erasure_executions_approval_uniq UNIQUE (approval_request_id)
);

CREATE INDEX IF NOT EXISTS dpa_erasure_executions_tenant_patient_idx
  ON dpa_erasure_executions (tenant_id, patient_display_id);

CREATE TABLE IF NOT EXISTS emergency_access_grants (
  id                    bigserial PRIMARY KEY,
  display_id            text NOT NULL UNIQUE,
  tenant_id             text NOT NULL REFERENCES tenants(id),
  incident_id           text NOT NULL,
  target_user_id        bigint NOT NULL REFERENCES users(id),
  purpose               text NOT NULL,
  approval_request_id   bigint NOT NULL REFERENCES approval_requests(id),
  token_hash            text NOT NULL UNIQUE,
  expires_at            timestamptz NOT NULL,
  used_at               timestamptz,
  revoked_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT emergency_access_purpose_check CHECK (purpose = 'restore_tenant_admin_login'),
  CONSTRAINT emergency_access_grants_approval_uniq UNIQUE (approval_request_id),
  CONSTRAINT emergency_access_expiry_check CHECK (expires_at > created_at)
);

-- Forward-safe replacement for the pre-review evidence-only design. An
-- environment that applied an earlier draft may still have two unverified
-- text references. Add the repository approval binding and deliberately fail
-- the NOT NULL transition if any such grant survives; an unverifiable grant
-- must never be silently grandfathered into the stronger control.
ALTER TABLE emergency_access_grants
  ADD COLUMN IF NOT EXISTS approval_request_id bigint;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'emergency_access_grants'::regclass
       AND conname = 'emergency_access_grants_approval_request_id_fkey'
  ) THEN
    ALTER TABLE emergency_access_grants
      ADD CONSTRAINT emergency_access_grants_approval_request_id_fkey
      FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id);
  END IF;
END $$;
ALTER TABLE emergency_access_grants
  ALTER COLUMN approval_request_id SET NOT NULL;
ALTER TABLE emergency_access_grants
  DROP CONSTRAINT IF EXISTS emergency_access_approvers_distinct_check,
  DROP COLUMN IF EXISTS approval_one_ref,
  DROP COLUMN IF EXISTS approval_two_ref;
CREATE UNIQUE INDEX IF NOT EXISTS emergency_access_grants_approval_uniq
  ON emergency_access_grants (approval_request_id);

CREATE INDEX IF NOT EXISTS emergency_access_grants_tenant_incident_idx
  ON emergency_access_grants (tenant_id, incident_id);
CREATE INDEX IF NOT EXISTS emergency_access_grants_expiry_idx
  ON emergency_access_grants (expires_at);

ALTER TABLE dpa_erasure_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dpa_erasure_executions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dpa_erasure_executions;
CREATE POLICY tenant_isolation ON dpa_erasure_executions
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

ALTER TABLE emergency_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_access_grants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON emergency_access_grants;
CREATE POLICY tenant_isolation ON emergency_access_grants
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

DROP TRIGGER IF EXISTS trg_dpa_erasure_executions_audit ON dpa_erasure_executions;
CREATE TRIGGER trg_dpa_erasure_executions_audit
  AFTER INSERT OR UPDATE OR DELETE ON dpa_erasure_executions
  FOR EACH ROW EXECUTE FUNCTION audit_log_changes();

DROP TRIGGER IF EXISTS trg_emergency_access_grants_audit ON emergency_access_grants;
CREATE TRIGGER trg_emergency_access_grants_audit
  AFTER INSERT OR UPDATE OR DELETE ON emergency_access_grants
  FOR EACH ROW EXECUTE FUNCTION audit_log_changes();

-- Runtime access is deliberately table-specific. Do not extend the existing
-- broad ALL TABLES / ALL ROUTINES grant here.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'surevax_app') THEN
    GRANT SELECT, INSERT, UPDATE ON dpa_erasure_executions TO surevax_app;
    GRANT SELECT, INSERT, UPDATE ON emergency_access_grants TO surevax_app;
    GRANT USAGE, SELECT ON SEQUENCE dpa_erasure_executions_id_seq TO surevax_app;
    GRANT USAGE, SELECT ON SEQUENCE emergency_access_grants_id_seq TO surevax_app;
  END IF;
END $$;

-- Returns a complete primary-store impact inventory. Live mode performs an
-- irreversible de-identification of the patient identity row and removes
-- directly identifying operational rows. Every associated attachment metadata
-- row, including soft-deleted metadata, blocks execution because the repository
-- cannot prove the corresponding object was deleted. Clinical, financial,
-- audit, and access records remain under their retention bases and are reported.
CREATE OR REPLACE FUNCTION purge_patient(
  p_patient_display_id text,
  p_dry_run            boolean DEFAULT true
)
RETURNS TABLE (entity text, affected_count integer)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_patient_id bigint;
  v_tenant_id text;
  v_attachment_count integer;
BEGIN
  SELECT id, tenant_id INTO v_patient_id, v_tenant_id
    FROM patients
   WHERE display_id = p_patient_display_id
     AND tenant_id = current_setting('app.current_tenant_id', true)
   FOR UPDATE;

  IF v_patient_id IS NULL THEN
    RAISE EXCEPTION 'DPA_PURGE_PATIENT_NOT_FOUND'
      USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)::int INTO v_attachment_count
    FROM attachments a
   WHERE a.tenant_id = v_tenant_id
     AND (
       (a.owner_type = 'patient' AND a.owner_id = p_patient_display_id)
       OR (a.owner_type = 'encounter' AND a.owner_id IN
         (SELECT display_id FROM encounters WHERE patient_id = v_patient_id))
       OR (a.owner_type = 'clinical_order' AND a.owner_id IN
         (SELECT display_id FROM clinical_orders WHERE patient_id = v_patient_id))
       OR (a.owner_type = 'lab_order' AND a.owner_id IN
         (SELECT lo.display_id FROM lab_orders lo JOIN clinical_orders co ON co.id = lo.clinical_order_id
           WHERE co.patient_id = v_patient_id))
       OR (a.owner_type = 'claim' AND a.owner_id IN
         (SELECT display_id FROM claims WHERE patient_id = v_patient_id))
       OR (a.owner_type = 'adverse_event' AND a.owner_id IN
         (SELECT display_id FROM adverse_events WHERE patient_id = v_patient_id))
     );

  RETURN QUERY SELECT 'patient_identity_deidentify'::text, 1;
  RETURN QUERY SELECT 'patient_emergency_contacts_delete'::text, COUNT(*)::int FROM patient_emergency_contacts WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'notifications_delete'::text, COUNT(*)::int FROM notifications WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'cross_branch_access_grants_delete'::text, COUNT(*)::int FROM cross_branch_access_grants WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'attachments_external_reconciliation_required'::text, v_attachment_count;
  RETURN QUERY SELECT 'encounters_retained'::text, COUNT(*)::int FROM encounters WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'patient_standing_orders_retained'::text, COUNT(*)::int FROM patient_standing_orders WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'clinical_orders_retained'::text, COUNT(*)::int FROM clinical_orders WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'appointments_retained'::text, COUNT(*)::int FROM appointments WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'consents_retained'::text, COUNT(*)::int FROM consents WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'allergies_retained'::text, COUNT(*)::int FROM patient_allergies WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'conditions_retained'::text, COUNT(*)::int FROM patient_conditions WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'external_immunizations_retained'::text, COUNT(*)::int FROM patient_external_immunizations WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'adverse_events_retained'::text, COUNT(*)::int FROM adverse_events WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'bite_incidents_retained'::text, COUNT(*)::int FROM bite_incidents WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'transactions_retained'::text, COUNT(*)::int FROM transactions WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'transaction_items_retained'::text, COUNT(*)::int FROM transaction_items WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'transaction_patients_retained'::text, COUNT(*)::int FROM transaction_patients WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'claims_retained'::text, COUNT(*)::int FROM claims WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'phi_access_log_retained'::text, COUNT(*)::int FROM phi_access_log WHERE patient_id = v_patient_id;
  RETURN QUERY SELECT 'audit_logs_retained'::text, COUNT(*)::int FROM audit_logs
    WHERE tenant_id = v_tenant_id AND entity_type = 'patients' AND entity_display_id = p_patient_display_id;

  IF p_dry_run THEN
    RETURN;
  END IF;

  IF v_attachment_count > 0 THEN
    RAISE EXCEPTION 'DPA_EXTERNAL_OBJECTS_PENDING'
      USING ERRCODE = '55000';
  END IF;

  DELETE FROM notifications WHERE patient_id = v_patient_id;
  DELETE FROM patient_emergency_contacts WHERE patient_id = v_patient_id;
  DELETE FROM cross_branch_access_grants WHERE patient_id = v_patient_id;

  UPDATE patients SET
    mrn = 'ERASED-' || display_id,
    first_name = 'Erased',
    last_name = right(display_id, 8),
    middle_name = NULL,
    suffix = NULL,
    date_of_birth = NULL,
    sex = NULL,
    civil_status = NULL,
    nationality = NULL,
    address = NULL,
    region = NULL,
    province = NULL,
    city = NULL,
    barangay = NULL,
    contact_number = NULL,
    email = NULL,
    sms_opt_in = false,
    email_opt_in = false,
    guardian_name = NULL,
    guardian_relationship = NULL,
    guardian_contact = NULL,
    insurance_provider = NULL,
    insurance_policy_number = NULL,
    onboarding_data = NULL,
    onboarding_channel = NULL,
    onboarding_channel_payer_id = NULL,
    health_card_attachment_id = NULL,
    is_active = false,
    deleted_at = now(),
    scheduled_purge_at = NULL,
    updated_at = now(),
    row_version = row_version + 1
  WHERE id = v_patient_id AND tenant_id = v_tenant_id;
END;
$$;

COMMENT ON FUNCTION purge_patient(text, boolean) IS
  'DPA primary-store impact/de-identification. Live mode requires explicit repository quorum and refuses every associated attachment metadata row, including soft-deleted rows. It does not claim statutory deletion of retained clinical, financial, audit, access-log, object, or backup copies.';

REVOKE ALL ON FUNCTION purge_patient(text, boolean) FROM PUBLIC;
DO $$
DECLARE
  routine record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'surevax_app') THEN
    -- Remove the historical blanket privilege, including the default that
    -- would silently expose every future SECURITY DEFINER routine.
    -- Existing extension-owned routines (for example unaccent) retain their
    -- extension-managed PUBLIC grants; application-owned routines do not.
    FOR routine IN
      SELECT p.oid::regprocedure::text AS signature, p.prokind
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND NOT EXISTS (
           SELECT 1
             FROM pg_depend d
            WHERE d.classid = 'pg_proc'::regclass
              AND d.objid = p.oid
              AND d.deptype = 'e'
         )
    LOOP
      EXECUTE format(
        'REVOKE EXECUTE ON %s %s FROM PUBLIC',
        CASE WHEN routine.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
        routine.signature
      );
    END LOOP;
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM surevax_app;
    REVOKE EXECUTE ON ALL PROCEDURES IN SCHEMA public FROM surevax_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      REVOKE EXECUTE ON ROUTINES FROM PUBLIC;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      REVOKE EXECUTE ON FUNCTIONS FROM surevax_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      REVOKE EXECUTE ON ROUTINES FROM surevax_app;

    -- Explicit runtime/worker allowlist. Trigger functions execute through
    -- their trigger bindings and do not need caller EXECUTE privileges.
    GRANT EXECUTE ON FUNCTION purge_patient(text, boolean) TO surevax_app;
    GRANT EXECUTE ON FUNCTION verify_audit_chain(text) TO surevax_app;
    GRANT EXECUTE ON FUNCTION unaccent(text) TO surevax_app;
    GRANT EXECUTE ON FUNCTION unaccent(regdictionary, text) TO surevax_app;
    GRANT EXECUTE ON PROCEDURE create_next_audit_partitions(integer) TO surevax_app;
    GRANT EXECUTE ON PROCEDURE retain_audit_partitions(integer) TO surevax_app;
    GRANT EXECUTE ON PROCEDURE purge_phi_access_log(text, integer, bigint) TO surevax_app;
  END IF;
END $$;
