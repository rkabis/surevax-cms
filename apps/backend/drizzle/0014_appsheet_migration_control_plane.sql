-- 0014_appsheet_migration_control_plane.sql
--
-- Forward migration for the AppSheet rehearsal/import control plane. The
-- Drizzle baseline is intentionally regenerated during the development-only
-- phase, so databases that have already recorded 0000_initial.sql need this
-- supplemental to reach the same shape. Keep this file idempotent: db:deploy
-- applies every supplemental on every deploy.

SET LOCAL lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS migration;

-- Enum additions are separate from the baseline so an existing database does
-- not need a destructive baseline reset.
ALTER TYPE animal_outcome ADD VALUE IF NOT EXISTS 'DiedUnknownCause';
ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'PayMongo';
ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'Other';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'external_immunization_date_precision'
  ) THEN
    CREATE TYPE external_immunization_date_precision AS ENUM ('Exact', 'Estimated', 'Unknown');
  END IF;
END;
$$;

-- Domain rows written by the canonical clinical projector.
ALTER TABLE animal_observation_followups
  ADD COLUMN IF NOT EXISTS outcome_observed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'animal_observation_followups'::regclass
      AND conname = 'animal_followups_status_check'
  ) THEN
    ALTER TABLE animal_observation_followups
      ADD CONSTRAINT animal_followups_status_check
      CHECK (status IN ('Pending', 'Completed', 'Cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'animal_observation_followups'::regclass
      AND conname = 'animal_followups_outcome_state_check'
  ) THEN
    ALTER TABLE animal_observation_followups
      ADD CONSTRAINT animal_followups_outcome_state_check
      CHECK (
        (status = 'Completed' AND outcome IS NOT NULL AND outcome_recorded_at IS NOT NULL)
        OR (status IN ('Pending', 'Cancelled') AND outcome IS NULL)
      );
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS animal_followups_incident_uniq
  ON animal_observation_followups (tenant_id, bite_incident_id);

ALTER TABLE clinical_orders
  ADD COLUMN IF NOT EXISTS completed_at_unknown boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'clinical_orders'::regclass
      AND conname = 'clinical_orders_unknown_completion_check'
  ) THEN
    ALTER TABLE clinical_orders
      ADD CONSTRAINT clinical_orders_unknown_completion_check
      CHECK (
        NOT completed_at_unknown
        OR (
          status = 'Completed'
          AND completed_at IS NULL
          AND administered_at_external_clinic = true
        )
      );
  END IF;
END;
$$;

ALTER TABLE patient_external_immunizations
  ADD COLUMN IF NOT EXISTS patient_standing_order_id bigint,
  ADD COLUMN IF NOT EXISTS service_id text,
  ADD COLUMN IF NOT EXISTS administered_date_precision external_immunization_date_precision
    NOT NULL DEFAULT 'Exact';

ALTER TABLE patient_external_immunizations
  ALTER COLUMN administered_date DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'patient_external_immunizations'::regclass
      AND conname = 'patient_ext_imm_date_precision_check'
  ) THEN
    ALTER TABLE patient_external_immunizations
      ADD CONSTRAINT patient_ext_imm_date_precision_check
      CHECK (administered_date_precision IN ('Exact', 'Estimated', 'Unknown'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'patient_external_immunizations'::regclass
      AND conname = 'patient_ext_imm_date_presence_check'
  ) THEN
    ALTER TABLE patient_external_immunizations
      ADD CONSTRAINT patient_ext_imm_date_presence_check
      CHECK (
        (administered_date_precision = 'Unknown' AND administered_date IS NULL)
        OR (
          administered_date_precision IN ('Exact', 'Estimated')
          AND administered_date IS NOT NULL
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'patient_external_immunizations'::regclass
      AND conname = 'patient_external_immunizations_patient_standing_order_id_patient_standing_orders_id_fk'
  ) THEN
    ALTER TABLE patient_external_immunizations
      ADD CONSTRAINT patient_external_immunizations_patient_standing_order_id_patient_standing_orders_id_fk
      FOREIGN KEY (patient_standing_order_id) REFERENCES patient_standing_orders(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'patient_external_immunizations'::regclass
      AND conname = 'patient_external_immunizations_service_id_service_catalog_id_fk'
  ) THEN
    ALTER TABLE patient_external_immunizations
      ADD CONSTRAINT patient_external_immunizations_service_id_service_catalog_id_fk
      FOREIGN KEY (service_id) REFERENCES service_catalog(id);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS patient_ext_imm_course_idx
  ON patient_external_immunizations (tenant_id, patient_standing_order_id, dose_number_in_series);
CREATE UNIQUE INDEX IF NOT EXISTS patient_ext_imm_course_slot_uniq
  ON patient_external_immunizations
    (tenant_id, patient_standing_order_id, service_id, dose_number_in_series)
  WHERE patient_standing_order_id IS NOT NULL
    AND service_id IS NOT NULL
    AND dose_number_in_series IS NOT NULL
    AND deleted_at IS NULL;

-- Existing D2 trigger calls this function by name. Historical imports retain
-- their source branch only when both transaction-local migration signals are
-- present; regular application writes continue to be rejected.
CREATE OR REPLACE FUNCTION enforce_transaction_branch_invariant()
RETURNS TRIGGER AS $$
DECLARE
  last_branch_id bigint;
BEGIN
  IF current_setting('app.migration_import', true) = 'true'
     AND current_setting('app.is_platform_admin', true) = 'true' THEN
    RETURN NEW;
  END IF;

  SELECT e.branch_id INTO last_branch_id
  FROM clinical_orders co
  JOIN encounters e ON e.id = co.encounter_id
  WHERE co.patient_id = NEW.patient_id
    AND co.tenant_id = NEW.tenant_id
    AND co.status = 'Completed'
    AND co.completed_at IS NOT NULL
    AND co.deleted_at IS NULL
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

-- Append-only migration evidence. Foreign keys follow the table declarations
-- because several links are cyclic or reference composite tenant identities.
CREATE TABLE IF NOT EXISTS migration.runs (
  id text PRIMARY KEY NOT NULL,
  tenant_id text NOT NULL,
  mode text NOT NULL,
  source_pack_hash text NOT NULL,
  cutoff_at timestamptz NOT NULL,
  importer_version text NOT NULL,
  parent_run_id text,
  created_by_id bigint,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT runs_tenant_id_uniq UNIQUE (tenant_id, id),
  CONSTRAINT runs_mode_check CHECK (mode IN ('Rehearsal', 'Baseline', 'CatchUp', 'DeltaAudit')),
  CONSTRAINT runs_source_pack_hash_check CHECK (source_pack_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS migration.run_events (
  id bigserial PRIMARY KEY NOT NULL,
  tenant_id text NOT NULL,
  run_id text NOT NULL,
  status text NOT NULL,
  detail jsonb,
  recorded_by_id bigint,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT run_events_status_check CHECK (status IN ('Started', 'Validated', 'Applying', 'Completed', 'Failed', 'Abandoned'))
);

CREATE TABLE IF NOT EXISTS migration.source_snapshots (
  id bigserial PRIMARY KEY NOT NULL,
  tenant_id text NOT NULL,
  run_id text NOT NULL,
  source_identity text NOT NULL,
  source_kind text NOT NULL,
  drive_file_id text,
  revision_id text,
  drive_modified_at timestamptz,
  capture_started_at timestamptz NOT NULL,
  capture_finished_at timestamptz NOT NULL,
  export_sha256 text NOT NULL,
  selected_ranges jsonb NOT NULL DEFAULT '[]'::jsonb,
  header_fingerprint text,
  workbook_title text,
  workbook_branch_legacy_id text,
  row_count integer,
  secured_artifact_ref text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_snapshots_tenant_id_uniq UNIQUE (tenant_id, id),
  CONSTRAINT source_snapshots_hash_check CHECK (export_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT source_snapshots_row_count_check CHECK (row_count IS NULL OR row_count >= 0),
  CONSTRAINT source_snapshots_capture_order_check CHECK (capture_finished_at >= capture_started_at)
);

CREATE TABLE IF NOT EXISTS migration.observations (
  id bigserial PRIMARY KEY NOT NULL,
  tenant_id text NOT NULL,
  snapshot_id bigint NOT NULL,
  source_kind text NOT NULL,
  sheet_name text,
  row_number integer,
  source_row_id text,
  row_hash text NOT NULL,
  payload_sha256 text NOT NULL,
  secured_payload_ref text NOT NULL,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT observations_tenant_id_uniq UNIQUE (tenant_id, id),
  CONSTRAINT observations_row_number_check CHECK (row_number IS NULL OR row_number > 0),
  CONSTRAINT observations_row_locator_check CHECK (source_row_id IS NOT NULL OR row_number IS NOT NULL),
  CONSTRAINT observations_row_hash_check CHECK (row_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT observations_payload_hash_check CHECK (payload_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS migration.canonical_events (
  id bigserial PRIMARY KEY NOT NULL,
  tenant_id text NOT NULL,
  run_id text NOT NULL,
  canonical_event_key text NOT NULL,
  version_hash text NOT NULL,
  event_type text NOT NULL,
  disposition text NOT NULL,
  facts jsonb NOT NULL,
  supersedes_event_id bigint,
  rule_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT canonical_events_tenant_id_uniq UNIQUE (tenant_id, id),
  CONSTRAINT canonical_events_version_hash_check CHECK (version_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT canonical_events_disposition_check CHECK (disposition IN ('SafeWrite', 'Withhold', 'ManualReview', 'EvidenceOnly'))
);

CREATE TABLE IF NOT EXISTS migration.event_evidence (
  tenant_id text NOT NULL,
  event_id bigint NOT NULL,
  observation_id bigint NOT NULL,
  evidence_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_evidence_tenant_id_event_id_observation_id_evidence_role_pk
    PRIMARY KEY (tenant_id, event_id, observation_id, evidence_role),
  CONSTRAINT event_evidence_role_check CHECK (evidence_role IN ('Assertion', 'Support', 'Contradiction'))
);

CREATE TABLE IF NOT EXISTS migration.decisions (
  id text PRIMARY KEY NOT NULL,
  tenant_id text NOT NULL,
  run_id text NOT NULL,
  disposition text NOT NULL,
  reason_code text NOT NULL,
  rationale text NOT NULL,
  payload_hash text NOT NULL,
  payload jsonb NOT NULL,
  decided_by_id bigint NOT NULL,
  decided_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT decisions_tenant_id_uniq UNIQUE (tenant_id, id),
  CONSTRAINT decisions_disposition_check CHECK (disposition IN ('Approved', 'Excluded', 'Rejected')),
  CONSTRAINT decisions_payload_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS migration.target_links (
  id bigserial PRIMARY KEY NOT NULL,
  tenant_id text NOT NULL,
  event_id bigint NOT NULL,
  target_table text NOT NULL,
  target_display_id text NOT NULL,
  mutation_kind text NOT NULL,
  idempotency_key text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT target_links_mutation_kind_check CHECK (mutation_kind IN ('Insert', 'EvidenceOnly', 'Correction', 'VoidReplacement'))
);

CREATE TABLE IF NOT EXISTS migration.exceptions (
  id text PRIMARY KEY NOT NULL,
  tenant_id text NOT NULL,
  run_id text NOT NULL,
  priority text NOT NULL,
  code text NOT NULL,
  subject_key text NOT NULL,
  summary text NOT NULL,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exceptions_tenant_id_uniq UNIQUE (tenant_id, id),
  CONSTRAINT exceptions_priority_check CHECK (priority IN ('P0', 'P1', 'P2', 'P3'))
);

CREATE TABLE IF NOT EXISTS migration.exception_events (
  id bigserial PRIMARY KEY NOT NULL,
  tenant_id text NOT NULL,
  exception_id text NOT NULL,
  status text NOT NULL,
  decision_id text,
  owner_user_id bigint,
  note text,
  recorded_by_id bigint,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exception_events_status_check CHECK (status IN ('Open', 'Assigned', 'Resolved', 'Excluded', 'Reopened'))
);

CREATE TABLE IF NOT EXISTS migration.sync_checkpoints (
  id bigserial PRIMARY KEY NOT NULL,
  tenant_id text NOT NULL,
  source_identity text NOT NULL,
  run_id text NOT NULL,
  source_pack_hash text NOT NULL,
  last_snapshot_id bigint NOT NULL,
  applicable_event_count integer NOT NULL,
  applied_event_count integer NOT NULL,
  exception_count integer NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sync_checkpoints_hash_check CHECK (source_pack_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT sync_checkpoints_applicable_count_check CHECK (applicable_event_count >= 0),
  CONSTRAINT sync_checkpoints_applied_count_check CHECK (applied_event_count >= 0),
  CONSTRAINT sync_checkpoints_exception_count_check CHECK (exception_count >= 0),
  CONSTRAINT sync_checkpoints_applied_lte_applicable_check CHECK (applied_event_count <= applicable_event_count)
);

-- All control-plane relationships are tenant-qualified where a target table
-- exposes (tenant_id, id), preventing a same-bigint cross-tenant reference.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.runs'::regclass AND conname = 'runs_tenant_id_tenants_id_fk') THEN
    ALTER TABLE migration.runs ADD CONSTRAINT runs_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.runs'::regclass AND conname = 'runs_parent_run_id_runs_id_fk') THEN
    ALTER TABLE migration.runs ADD CONSTRAINT runs_parent_run_id_runs_id_fk FOREIGN KEY (parent_run_id) REFERENCES migration.runs(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.runs'::regclass AND conname = 'runs_created_by_id_users_id_fk') THEN
    ALTER TABLE migration.runs ADD CONSTRAINT runs_created_by_id_users_id_fk FOREIGN KEY (created_by_id) REFERENCES users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.run_events'::regclass AND conname = 'run_events_tenant_id_tenants_id_fk') THEN
    ALTER TABLE migration.run_events ADD CONSTRAINT run_events_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.run_events'::regclass AND conname = 'run_events_recorded_by_id_users_id_fk') THEN
    ALTER TABLE migration.run_events ADD CONSTRAINT run_events_recorded_by_id_users_id_fk FOREIGN KEY (recorded_by_id) REFERENCES users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.run_events'::regclass AND conname = 'run_events_tenant_run_fk') THEN
    ALTER TABLE migration.run_events ADD CONSTRAINT run_events_tenant_run_fk FOREIGN KEY (tenant_id, run_id) REFERENCES migration.runs(tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.source_snapshots'::regclass AND conname = 'source_snapshots_tenant_id_tenants_id_fk') THEN
    ALTER TABLE migration.source_snapshots ADD CONSTRAINT source_snapshots_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.source_snapshots'::regclass AND conname = 'source_snapshots_tenant_run_fk') THEN
    ALTER TABLE migration.source_snapshots ADD CONSTRAINT source_snapshots_tenant_run_fk FOREIGN KEY (tenant_id, run_id) REFERENCES migration.runs(tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.observations'::regclass AND conname = 'observations_tenant_id_tenants_id_fk') THEN
    ALTER TABLE migration.observations ADD CONSTRAINT observations_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.observations'::regclass AND conname = 'observations_tenant_snapshot_fk') THEN
    ALTER TABLE migration.observations ADD CONSTRAINT observations_tenant_snapshot_fk FOREIGN KEY (tenant_id, snapshot_id) REFERENCES migration.source_snapshots(tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.canonical_events'::regclass AND conname = 'canonical_events_tenant_id_tenants_id_fk') THEN
    ALTER TABLE migration.canonical_events ADD CONSTRAINT canonical_events_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.canonical_events'::regclass AND conname = 'canonical_events_supersedes_event_id_canonical_events_id_fk') THEN
    ALTER TABLE migration.canonical_events ADD CONSTRAINT canonical_events_supersedes_event_id_canonical_events_id_fk FOREIGN KEY (supersedes_event_id) REFERENCES migration.canonical_events(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.canonical_events'::regclass AND conname = 'canonical_events_tenant_run_fk') THEN
    ALTER TABLE migration.canonical_events ADD CONSTRAINT canonical_events_tenant_run_fk FOREIGN KEY (tenant_id, run_id) REFERENCES migration.runs(tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.event_evidence'::regclass AND conname = 'event_evidence_tenant_id_tenants_id_fk') THEN
    ALTER TABLE migration.event_evidence ADD CONSTRAINT event_evidence_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.event_evidence'::regclass AND conname = 'event_evidence_tenant_event_fk') THEN
    ALTER TABLE migration.event_evidence ADD CONSTRAINT event_evidence_tenant_event_fk FOREIGN KEY (tenant_id, event_id) REFERENCES migration.canonical_events(tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.event_evidence'::regclass AND conname = 'event_evidence_tenant_observation_fk') THEN
    ALTER TABLE migration.event_evidence ADD CONSTRAINT event_evidence_tenant_observation_fk FOREIGN KEY (tenant_id, observation_id) REFERENCES migration.observations(tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.decisions'::regclass AND conname = 'decisions_tenant_id_tenants_id_fk') THEN
    ALTER TABLE migration.decisions ADD CONSTRAINT decisions_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.decisions'::regclass AND conname = 'decisions_decided_by_id_users_id_fk') THEN
    ALTER TABLE migration.decisions ADD CONSTRAINT decisions_decided_by_id_users_id_fk FOREIGN KEY (decided_by_id) REFERENCES users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.decisions'::regclass AND conname = 'decisions_tenant_run_fk') THEN
    ALTER TABLE migration.decisions ADD CONSTRAINT decisions_tenant_run_fk FOREIGN KEY (tenant_id, run_id) REFERENCES migration.runs(tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.target_links'::regclass AND conname = 'target_links_tenant_id_tenants_id_fk') THEN
    ALTER TABLE migration.target_links ADD CONSTRAINT target_links_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.target_links'::regclass AND conname = 'target_links_tenant_event_fk') THEN
    ALTER TABLE migration.target_links ADD CONSTRAINT target_links_tenant_event_fk FOREIGN KEY (tenant_id, event_id) REFERENCES migration.canonical_events(tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.exceptions'::regclass AND conname = 'exceptions_tenant_id_tenants_id_fk') THEN
    ALTER TABLE migration.exceptions ADD CONSTRAINT exceptions_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.exceptions'::regclass AND conname = 'exceptions_tenant_run_fk') THEN
    ALTER TABLE migration.exceptions ADD CONSTRAINT exceptions_tenant_run_fk FOREIGN KEY (tenant_id, run_id) REFERENCES migration.runs(tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.exception_events'::regclass AND conname = 'exception_events_tenant_id_tenants_id_fk') THEN
    ALTER TABLE migration.exception_events ADD CONSTRAINT exception_events_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.exception_events'::regclass AND conname = 'exception_events_owner_user_id_users_id_fk') THEN
    ALTER TABLE migration.exception_events ADD CONSTRAINT exception_events_owner_user_id_users_id_fk FOREIGN KEY (owner_user_id) REFERENCES users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.exception_events'::regclass AND conname = 'exception_events_recorded_by_id_users_id_fk') THEN
    ALTER TABLE migration.exception_events ADD CONSTRAINT exception_events_recorded_by_id_users_id_fk FOREIGN KEY (recorded_by_id) REFERENCES users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.exception_events'::regclass AND conname = 'exception_events_tenant_exception_fk') THEN
    ALTER TABLE migration.exception_events ADD CONSTRAINT exception_events_tenant_exception_fk FOREIGN KEY (tenant_id, exception_id) REFERENCES migration.exceptions(tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.exception_events'::regclass AND conname = 'exception_events_tenant_decision_fk') THEN
    ALTER TABLE migration.exception_events ADD CONSTRAINT exception_events_tenant_decision_fk FOREIGN KEY (tenant_id, decision_id) REFERENCES migration.decisions(tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.sync_checkpoints'::regclass AND conname = 'sync_checkpoints_tenant_id_tenants_id_fk') THEN
    ALTER TABLE migration.sync_checkpoints ADD CONSTRAINT sync_checkpoints_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.sync_checkpoints'::regclass AND conname = 'sync_checkpoints_tenant_run_fk') THEN
    ALTER TABLE migration.sync_checkpoints ADD CONSTRAINT sync_checkpoints_tenant_run_fk FOREIGN KEY (tenant_id, run_id) REFERENCES migration.runs(tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'migration.sync_checkpoints'::regclass AND conname = 'sync_checkpoints_tenant_snapshot_fk') THEN
    ALTER TABLE migration.sync_checkpoints ADD CONSTRAINT sync_checkpoints_tenant_snapshot_fk FOREIGN KEY (tenant_id, last_snapshot_id) REFERENCES migration.source_snapshots(tenant_id, id);
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS canonical_events_version_hash_uniq ON migration.canonical_events (tenant_id, version_hash);
CREATE INDEX IF NOT EXISTS canonical_events_key_created_idx ON migration.canonical_events (tenant_id, canonical_event_key, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS decisions_payload_hash_uniq ON migration.decisions (tenant_id, payload_hash);
CREATE UNIQUE INDEX IF NOT EXISTS exception_events_tenant_id_uniq ON migration.exception_events (tenant_id, id);
CREATE INDEX IF NOT EXISTS exception_events_latest_idx ON migration.exception_events (tenant_id, exception_id, recorded_at);
CREATE INDEX IF NOT EXISTS exceptions_run_priority_idx ON migration.exceptions (tenant_id, run_id, priority, code);
CREATE INDEX IF NOT EXISTS observations_snapshot_row_idx ON migration.observations (tenant_id, snapshot_id, sheet_name, row_number);
CREATE INDEX IF NOT EXISTS observations_row_hash_idx ON migration.observations (tenant_id, row_hash);
CREATE UNIQUE INDEX IF NOT EXISTS run_events_tenant_id_uniq ON migration.run_events (tenant_id, id);
CREATE INDEX IF NOT EXISTS run_events_run_recorded_idx ON migration.run_events (tenant_id, run_id, recorded_at);
CREATE INDEX IF NOT EXISTS runs_tenant_created_idx ON migration.runs (tenant_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS runs_frozen_pack_identity_uniq ON migration.runs (tenant_id, mode, source_pack_hash, cutoff_at, importer_version);
CREATE UNIQUE INDEX IF NOT EXISTS source_snapshots_run_source_hash_uniq ON migration.source_snapshots (tenant_id, run_id, source_identity, export_sha256);
CREATE INDEX IF NOT EXISTS source_snapshots_source_capture_idx ON migration.source_snapshots (tenant_id, source_identity, capture_finished_at);
CREATE UNIQUE INDEX IF NOT EXISTS sync_checkpoints_tenant_id_uniq ON migration.sync_checkpoints (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS sync_checkpoints_source_pack_uniq ON migration.sync_checkpoints (tenant_id, source_identity, source_pack_hash);
CREATE INDEX IF NOT EXISTS sync_checkpoints_latest_idx ON migration.sync_checkpoints (tenant_id, source_identity, checked_at);
CREATE UNIQUE INDEX IF NOT EXISTS target_links_tenant_id_uniq ON migration.target_links (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS target_links_idempotency_uniq ON migration.target_links (tenant_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS target_links_event_target_uniq ON migration.target_links (tenant_id, event_id, target_table, target_display_id, mutation_kind);
CREATE INDEX IF NOT EXISTS target_links_target_idx ON migration.target_links (tenant_id, target_table, target_display_id);

-- Replace the baseline's NULL-distinct observation key only when necessary.
DO $$
DECLARE
  index_definition text;
BEGIN
  SELECT pg_get_indexdef(c.oid)
    INTO index_definition
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'migration' AND c.relname = 'observations_version_uniq';

  IF index_definition IS NOT NULL
     AND index_definition NOT LIKE '%COALESCE(sheet_name, '''')%'
  THEN
    DROP INDEX migration.observations_version_uniq;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS observations_version_uniq
  ON migration.observations (
    tenant_id,
    snapshot_id,
    source_kind,
    COALESCE(sheet_name, ''),
    COALESCE(source_row_id, ''),
    COALESCE(row_number, 0),
    row_hash
  );

-- Control-plane records may only be superseded by new events; audit-log JSON
-- intentionally does not duplicate their restricted reconciliation payloads.
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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'surevax_app') THEN
    GRANT USAGE ON SCHEMA migration TO surevax_app;
    GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA migration TO surevax_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA migration TO surevax_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA migration FROM surevax_app;
  END IF;
END;
$$;

COMMENT ON SCHEMA migration IS
  'Append-only control plane for legacy snapshots, reconciliation, decisions, target links and bounded catch-up sync.';
