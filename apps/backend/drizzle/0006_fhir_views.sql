-- =============================================================================
-- 0006_fhir_views.sql — FHIR R4 projection views
-- =============================================================================
-- Read-only views over patients / encounters / clinical_orders → FHIR R4 JSON.
-- All views inherit RLS from underlying tables (non-superuser sessions only
-- see rows in the current tenant). No write triggers; no audit-log interaction.
--
-- Status mapping:
--   Encounter:   Open→planned, InProgress→in-progress, Completed→finished,
--                Cancelled→cancelled, otherwise unknown.
--   Immunization (clinical_order):
--                Completed→completed; Scheduled/Pending/Missed/Cancelled/
--                Deferred/Refused→not-done.
-- ── Patient view ─────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS fhir_patient_view;
CREATE VIEW fhir_patient_view AS
SELECT
  p.display_id AS id,
  p.tenant_id,
  jsonb_build_object(
    'resourceType', 'Patient',
    'id', p.display_id,
    'identifier', jsonb_build_array(
      jsonb_build_object(
        'use', 'official',
        'system', 'urn:surevax:mrn',
        'value', p.mrn
      )
    ),
    'name', jsonb_build_array(
      jsonb_build_object(
        'use', 'official',
        'text', TRIM(CONCAT_WS(' ', p.first_name, p.middle_name, p.last_name, p.suffix)),
        'family', p.last_name,
        'given', jsonb_build_array(p.first_name)
      )
    ),
    'birthDate', TO_CHAR(p.date_of_birth, 'YYYY-MM-DD'),
    'gender', CASE p.sex
      WHEN 'Male'   THEN 'male'
      WHEN 'Female' THEN 'female'
      ELSE 'unknown'
    END,
    'telecom', (
      SELECT jsonb_agg(t ORDER BY t->>'rank')
      FROM (
        SELECT jsonb_build_object('system','phone','value', p.contact_number,'use','mobile','rank',1) AS t
          WHERE p.contact_number IS NOT NULL
        UNION ALL
        SELECT jsonb_build_object('system','email','value', p.email,'use','home','rank',2) AS t
          WHERE p.email IS NOT NULL
      ) sub
    ),
    'address', CASE
      WHEN p.address IS NOT NULL OR p.city IS NOT NULL OR p.province IS NOT NULL THEN
        jsonb_build_array(
          jsonb_build_object(
            'use', 'home',
            'type', 'physical',
            'text', TRIM(CONCAT_WS(', ', p.address, p.barangay, p.city, p.province)),
            'city', p.city,
            'district', p.barangay,
            'state', p.province,
            'country', 'PH'
          )
        )
      ELSE NULL
    END,
    'meta', jsonb_build_object(
      'lastUpdated', TO_CHAR(p.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
  ) AS resource
FROM patients p
WHERE p.deleted_at IS NULL;

-- ── Encounter view ───────────────────────────────────────────────────────────
DROP VIEW IF EXISTS fhir_encounter_view;
CREATE VIEW fhir_encounter_view AS
SELECT
  e.display_id AS id,
  e.tenant_id,
  jsonb_build_object(
    'resourceType', 'Encounter',
    'id', e.display_id,
    'status', CASE e.status
      WHEN 'Open'       THEN 'planned'
      WHEN 'InProgress' THEN 'in-progress'
      WHEN 'Completed'  THEN 'finished'
      WHEN 'Cancelled'  THEN 'cancelled'
      ELSE 'unknown'
    END,
    'class', jsonb_build_object(
      'system', 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
      'code', 'AMB',
      'display', 'ambulatory'
    ),
    'subject', jsonb_build_object(
      'reference', CONCAT('Patient/', pat.display_id),
      'type', 'Patient'
    ),
    'period', jsonb_build_object(
      'start', TO_CHAR(e.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'end', CASE WHEN e.completed_at IS NOT NULL
        THEN TO_CHAR(e.completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        ELSE NULL
      END
    ),
    'serviceProvider', jsonb_build_object(
      'reference', CONCAT('Organization/', e.tenant_id)
    ),
    'meta', jsonb_build_object(
      'lastUpdated', TO_CHAR(e.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
  ) AS resource
FROM encounters e
JOIN patients pat ON pat.id = e.patient_id
WHERE e.deleted_at IS NULL;

-- ── Immunization view ────────────────────────────────────────────────────────
-- Predicate: clinical_orders joined to service_catalog where cvx_code IS NOT NULL
-- (indicates this order is for a vaccine service).
DROP VIEW IF EXISTS fhir_immunization_view;
CREATE VIEW fhir_immunization_view AS
SELECT
  co.display_id AS id,
  co.tenant_id,
  jsonb_build_object(
    'resourceType', 'Immunization',
    'id', co.display_id,
    'status', CASE co.status
      WHEN 'Completed' THEN 'completed'
      ELSE 'not-done'
    END,
    'vaccineCode', jsonb_build_object(
      'coding', jsonb_build_array(
        jsonb_build_object(
          'system', 'http://hl7.org/fhir/sid/cvx',
          'code', sc.cvx_code,
          'display', sc.name
        )
      ),
      'text', sc.name
    ),
    'patient', jsonb_build_object(
      'reference', CONCAT('Patient/', pat.display_id),
      'type', 'Patient'
    ),
    'encounter', CASE WHEN enc.display_id IS NOT NULL
      THEN jsonb_build_object(
        'reference', CONCAT('Encounter/', enc.display_id),
        'type', 'Encounter'
      )
      ELSE NULL
    END,
    'occurrenceDateTime', CASE WHEN co.completed_at IS NOT NULL
      THEN TO_CHAR(co.completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      ELSE NULL
    END,
    'lotNumber', il.batch_number,
    'expirationDate', TO_CHAR(il.expiry_date, 'YYYY-MM-DD'),
    'manufacturer', CASE WHEN il.manufacturer IS NOT NULL
      THEN jsonb_build_object('display', il.manufacturer)
      ELSE NULL
    END,
    'route', CASE WHEN co.administration_route IS NOT NULL
      THEN jsonb_build_object(
        'coding', jsonb_build_array(
          jsonb_build_object(
            'system', 'http://terminology.hl7.org/CodeSystem/v3-RouteOfAdministration',
            'code', co.administration_route,
            'display', co.administration_route
          )
        )
      )
      ELSE NULL
    END,
    'doseQuantity', CASE WHEN co.dose_volume_ml_actual IS NOT NULL
      THEN jsonb_build_object(
        'value', co.dose_volume_ml_actual::numeric,
        'unit', 'mL',
        'system', 'http://unitsofmeasure.org',
        'code', 'mL'
      )
      ELSE NULL
    END,
    'protocolApplied', CASE WHEN co.dose_number IS NOT NULL
      THEN jsonb_build_array(
        jsonb_build_object(
          'doseNumberPositiveInt', co.dose_number
        )
      )
      ELSE NULL
    END,
    'meta', jsonb_build_object(
      'lastUpdated', TO_CHAR(co.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
  ) AS resource
FROM clinical_orders co
JOIN service_catalog sc ON sc.id = co.service_id
JOIN patients pat ON pat.id = co.patient_id
LEFT JOIN encounters enc ON enc.id = co.encounter_id
LEFT JOIN inventory_lots il ON il.id = co.lot_id
WHERE sc.cvx_code IS NOT NULL
  AND co.deleted_at IS NULL;

-- ─── patients_demographic_v (folded from 0026_cross_branch_phi.sql) ──────────
-- Tier-1 cross-branch demographic projection. The cross_branch_access_grants
-- table is in 0000_initial.sql; only the view is folded here.
--
-- RFC §4.2 + D5 aggregates added (step 8a):
--   active_courses   — patient_standing_orders WHERE status='Active'
--   recent_doses     — clinical_orders Completed in last 90 days (LIMIT 20)
--                      with brand/lot/batch snapshots + branch_id
--   active_recalls   — product_recalls joined through lots administered to patient
--   recent_critical_lab_results — lab_orders with has_critical_value=true
--                      updated within last 90 days (D5)
--
-- security_invoker=true ensures the view runs with the querying surevax_app
-- role so RLS (tenant_isolation + branch_isolation) is enforced on every
-- underlying table access. Consistent with the FHIR views below.

CREATE OR REPLACE VIEW patients_demographic_v
  WITH (security_invoker = true)
AS
SELECT
  p.id,
  p.display_id,
  p.tenant_id,
  p.home_branch_id,
  p.mrn,
  p.first_name,
  p.middle_name,
  p.last_name,
  p.suffix,
  p.date_of_birth,
  p.sex,
  p.contact_number      AS primary_phone,
  p.is_active,
  COALESCE(
    (
      SELECT json_agg(
        json_build_object(
          'allergen',  a.allergen,
          'severity',  a.severity,
          'reaction',  a.reaction
        )
      )
      FROM patient_allergies a
      WHERE a.patient_id = p.id
        AND a.deleted_at IS NULL
    ),
    '[]'::json
  )                     AS allergies,
  COALESCE(
    (
      SELECT json_agg(
        json_build_object(
          'icd10',   c.icd10_code,
          'name',    c.condition_name,
          'status',  c.status
        )
      )
      FROM patient_conditions c
      WHERE c.patient_id = p.id
        AND c.status = 'Active'
        AND c.deleted_at IS NULL
    ),
    '[]'::json
  )                     AS active_conditions,
  EXISTS (
    SELECT 1
    FROM consents cons
    WHERE cons.patient_id = p.id
      AND cons.consent_type = 'DPA_DATA_PROCESSING'
      AND cons.revoked_at IS NULL
      AND cons.deleted_at IS NULL
  )                     AS dpa_consent_active,
  -- RFC §4.2: active standing-order courses (continuity-of-care signal)
  COALESCE(
    (
      SELECT json_agg(
        json_build_object(
          'displayId',   pso.display_id,
          'templateId',  pso.template_id,
          'status',      pso.status,
          'startDate',   pso.start_date
        )
        ORDER BY pso.start_date DESC
      )
      FROM patient_standing_orders pso
      WHERE pso.patient_id = p.id
        AND pso.status = 'Active'
    ),
    '[]'::json
  )                     AS active_courses,
  -- RFC §4.2: recent administered doses (last 90 days, max 20)
  -- brand/lot/batch snapshots + branch_id for cross-branch series continuity
  COALESCE(
    (
      SELECT json_agg(sub ORDER BY sub."completedAt" DESC)
      FROM (
        SELECT
          co.display_id                  AS "displayId",
          co.service_id                  AS "serviceId",
          co.dose_number                 AS "doseNumber",
          co.completed_at                AS "completedAt",
          co.manufacturer_snapshot       AS "manufacturerSnapshot",
          co.expiry_date_snapshot        AS "expiryDateSnapshot",
          il.batch_number                AS "batchNumber",
          co.lot_id                      AS "lotId",
          il.branch_id                   AS "branchId"
        FROM clinical_orders co
        LEFT JOIN inventory_lots il ON il.id = co.lot_id
        WHERE co.patient_id = p.id
          AND co.status = 'Completed'
          AND co.completed_at >= now() - INTERVAL '90 days'
          AND co.deleted_at IS NULL
        ORDER BY co.completed_at DESC
        LIMIT 20
      ) sub
    ),
    '[]'::json
  )                     AS recent_doses,
  -- RFC §4.2: active product recalls that affect lots administered to this patient
  COALESCE(
    (
      SELECT jsonb_agg(DISTINCT
        jsonb_build_object(
          'displayId',      pr.display_id,
          'recallNo',       pr.recall_no,
          'recallReason',   pr.recall_reason,
          'recallSeverity', pr.recall_severity,
          'issuedAt',       pr.issued_at
        )
      )::json
      FROM product_recalls pr
      JOIN inventory_lots il2 ON (
        (pr.product_id IS NULL OR pr.product_id = il2.product_id)
        AND (pr.affected_lots_pattern IS NULL
             OR il2.batch_number ILIKE pr.affected_lots_pattern)
      )
      JOIN clinical_orders co2 ON co2.lot_id = il2.id
      WHERE co2.patient_id = p.id
        AND co2.status = 'Completed'
        AND co2.deleted_at IS NULL
        AND pr.resolved_at IS NULL
        AND pr.deleted_at IS NULL
        AND pr.tenant_id = p.tenant_id
    ),
    '[]'::json
  )                     AS active_recalls,
  -- D5: critical lab results updated in last 90 days (unacknowledged or recent)
  COALESCE(
    (
      SELECT json_agg(
        json_build_object(
          'displayId',          lo.display_id,
          'status',             lo.status,
          'hasCriticalValue',   lo.has_critical_value,
          'criticalAcknowledgedAt', lo.critical_value_acknowledged_at,
          'updatedAt',          lo.updated_at,
          'branchId',           lo.branch_id
        )
        ORDER BY lo.updated_at DESC
      )
      FROM lab_orders lo
      JOIN clinical_orders co3 ON co3.id = lo.clinical_order_id
      WHERE co3.patient_id = p.id
        AND lo.has_critical_value = true
        AND lo.updated_at >= now() - INTERVAL '90 days'
        AND co3.deleted_at IS NULL
    ),
    '[]'::json
  )                     AS recent_critical_lab_results,
  p.created_at,
  p.updated_at
FROM patients p
WHERE p.deleted_at IS NULL;

-- ─── FHIR views with security_invoker (folded from 0029_fhir_views_security_invoker.sql) ─
-- INT-1: add security_invoker=true so RLS of the querying role applies.
-- INT-3: fhir_patient_view address CASE includes barangay-only patients.

DROP VIEW IF EXISTS fhir_immunization_view;
DROP VIEW IF EXISTS fhir_encounter_view;
DROP VIEW IF EXISTS fhir_patient_view;

CREATE VIEW fhir_patient_view
  WITH (security_invoker = true)
AS
SELECT
  p.display_id AS id,
  p.tenant_id,
  jsonb_build_object(
    'resourceType', 'Patient',
    'id', p.display_id,
    'identifier', jsonb_build_array(
      jsonb_build_object(
        'use', 'official',
        'system', 'urn:surevax:mrn',
        'value', p.mrn
      )
    ),
    'name', jsonb_build_array(
      jsonb_build_object(
        'use', 'official',
        'text', TRIM(CONCAT_WS(' ', p.first_name, p.middle_name, p.last_name, p.suffix)),
        'family', p.last_name,
        'given', jsonb_build_array(p.first_name)
      )
    ),
    'birthDate', TO_CHAR(p.date_of_birth, 'YYYY-MM-DD'),
    'gender', CASE p.sex
      WHEN 'Male'   THEN 'male'
      WHEN 'Female' THEN 'female'
      ELSE 'unknown'
    END,
    'telecom', (
      SELECT jsonb_agg(t ORDER BY t->>'rank')
      FROM (
        SELECT jsonb_build_object('system','phone','value', p.contact_number,'use','mobile','rank',1) AS t
          WHERE p.contact_number IS NOT NULL
        UNION ALL
        SELECT jsonb_build_object('system','email','value', p.email,'use','home','rank',2) AS t
          WHERE p.email IS NOT NULL
      ) sub
    ),
    'address', CASE
      WHEN p.address IS NOT NULL
        OR p.barangay IS NOT NULL
        OR p.city IS NOT NULL
        OR p.province IS NOT NULL THEN
        jsonb_build_array(
          jsonb_build_object(
            'use', 'home',
            'type', 'physical',
            'text', TRIM(CONCAT_WS(', ', p.address, p.barangay, p.city, p.province)),
            'city', p.city,
            'district', p.barangay,
            'state', p.province,
            'country', 'PH'
          )
        )
      ELSE NULL
    END,
    'meta', jsonb_build_object(
      'lastUpdated', TO_CHAR(p.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
  ) AS resource
FROM patients p
WHERE p.deleted_at IS NULL;

CREATE VIEW fhir_encounter_view
  WITH (security_invoker = true)
AS
SELECT
  e.display_id AS id,
  e.tenant_id,
  jsonb_build_object(
    'resourceType', 'Encounter',
    'id', e.display_id,
    'status', CASE e.status
      WHEN 'Open'       THEN 'planned'
      WHEN 'InProgress' THEN 'in-progress'
      WHEN 'Completed'  THEN 'finished'
      WHEN 'Cancelled'  THEN 'cancelled'
      ELSE 'unknown'
    END,
    'class', jsonb_build_object(
      'system', 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
      'code', 'AMB',
      'display', 'ambulatory'
    ),
    'subject', jsonb_build_object(
      'reference', CONCAT('Patient/', pat.display_id),
      'type', 'Patient'
    ),
    'period', jsonb_build_object(
      'start', TO_CHAR(e.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'end', CASE WHEN e.completed_at IS NOT NULL
        THEN TO_CHAR(e.completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        ELSE NULL
      END
    ),
    'serviceProvider', jsonb_build_object(
      'reference', CONCAT('Organization/', e.tenant_id)
    ),
    'meta', jsonb_build_object(
      'lastUpdated', TO_CHAR(e.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
  ) AS resource
FROM encounters e
JOIN patients pat ON pat.id = e.patient_id
WHERE e.deleted_at IS NULL;

CREATE VIEW fhir_immunization_view
  WITH (security_invoker = true)
AS
SELECT
  co.display_id AS id,
  co.tenant_id,
  jsonb_build_object(
    'resourceType', 'Immunization',
    'id', co.display_id,
    'status', CASE co.status
      WHEN 'Completed' THEN 'completed'
      ELSE 'not-done'
    END,
    'vaccineCode', jsonb_build_object(
      'coding', jsonb_build_array(
        jsonb_build_object(
          'system', 'http://hl7.org/fhir/sid/cvx',
          'code', sc.cvx_code,
          'display', sc.name
        )
      ),
      'text', sc.name
    ),
    'patient', jsonb_build_object(
      'reference', CONCAT('Patient/', pat.display_id),
      'type', 'Patient'
    ),
    'encounter', CASE WHEN enc.display_id IS NOT NULL
      THEN jsonb_build_object(
        'reference', CONCAT('Encounter/', enc.display_id),
        'type', 'Encounter'
      )
      ELSE NULL
    END,
    'occurrenceDateTime', CASE WHEN co.completed_at IS NOT NULL
      THEN TO_CHAR(co.completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      ELSE NULL
    END,
    'lotNumber', il.batch_number,
    'expirationDate', TO_CHAR(il.expiry_date, 'YYYY-MM-DD'),
    'manufacturer', CASE WHEN il.manufacturer IS NOT NULL
      THEN jsonb_build_object('display', il.manufacturer)
      ELSE NULL
    END,
    'route', CASE WHEN co.administration_route IS NOT NULL
      THEN jsonb_build_object(
        'coding', jsonb_build_array(
          jsonb_build_object(
            'system', 'http://terminology.hl7.org/CodeSystem/v3-RouteOfAdministration',
            'code', co.administration_route,
            'display', co.administration_route
          )
        )
      )
      ELSE NULL
    END,
    'doseQuantity', CASE WHEN co.dose_volume_ml_actual IS NOT NULL
      THEN jsonb_build_object(
        'value', co.dose_volume_ml_actual::numeric,
        'unit', 'mL',
        'system', 'http://unitsofmeasure.org',
        'code', 'mL'
      )
      ELSE NULL
    END,
    'protocolApplied', CASE WHEN co.dose_number IS NOT NULL
      THEN jsonb_build_array(
        jsonb_build_object(
          'doseNumberPositiveInt', co.dose_number
        )
      )
      ELSE NULL
    END,
    'meta', jsonb_build_object(
      'lastUpdated', TO_CHAR(co.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
  ) AS resource
FROM clinical_orders co
JOIN service_catalog sc ON sc.id = co.service_id
JOIN patients pat ON pat.id = co.patient_id
LEFT JOIN encounters enc ON enc.id = co.encounter_id
LEFT JOIN inventory_lots il ON il.id = co.lot_id
WHERE sc.cvx_code IS NOT NULL
  AND co.deleted_at IS NULL;
