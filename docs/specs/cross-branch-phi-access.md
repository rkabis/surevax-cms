# RFC: Cross-Branch PHI Access (Pattern B)

> **Status:** Implemented — Steps 2–10 landed as of 2026-06-03
> **Original author:** 2026-05-23 session, building on the UI audit deep-dive
> **Replaces:** ambiguous default-open `branch_isolation` RLS behaviour
> documented as finding M12 in the 360 codebase review
> **Related:** [`docs/handovers/2026-05-23-cross-branch-phi-rfc.md`](../handovers/archive/2026-05-23-cross-branch-phi-rfc.md),
> [`.claude/rules/patterns.md`](../../.claude/rules/patterns.md),
> [`apps/backend/drizzle/0001_extensions_and_rls.sql`](../../apps/backend/drizzle/0001_extensions_and_rls.sql)

---

## Implementation Status (2026-06-03)

| Step        | Description                                                                                     | Status                                                             |
| ----------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 2           | `patients_demographic_v` Tier-1 view (demographics + allergies + conditions + DPA)              | ✅ Landed                                                          |
| 3           | `cross_branch_access_grants` table (schema.ts)                                                  | ✅ Landed                                                          |
| 2/3 backend | `GET /api/patients/:id/demographic` route + `getPatientDemographicProjection`                   | ✅ Landed                                                          |
| 4a          | `crossBranchRead` optional ctx on `withTenantTx`                                                | ✅ Landed                                                          |
| 4b          | `emitCrossBranchAccessAudit` helper (audit_logs + grants INSERT)                                | ✅ Landed                                                          |
| 4c          | `POST /api/patients/:id/break-glass` route + `breakGlassPatientChart`                           | ✅ Landed                                                          |
| 5           | Worker audit (withSystemTx already adopted by all 4 workers)                                    | ✅ No-op verified                                                  |
| 6           | Admin cross-branch read audit (branchId:null pattern, no synthetic grants)                      | ✅ Documented in audit.ts                                          |
| 7a          | `branch_isolation` WITH CHECK — remove `cross_branch_read` disjunct (writes never cross-branch) | ✅ Landed (0001_extensions_and_rls.sql:894-899)                    |
| 7b          | RLS integration tests — 4 §6.5 scenarios                                                        | 🔲 Pending (cross-branch-phi-step23.test.ts needs rls_tester role) |
| 8a          | Extend `patients_demographic_v` with RFC §4.2 + D5 aggregates + security_invoker                | ✅ Landed (this PR)                                                |
| 8b          | Extend `PatientDemographicRow` + frontend `PatientDemographic` type                             | ✅ Landed (this PR)                                                |
| 8c          | `BreakGlassReveal` modal + `PatientDetail` Tier-1/Tier-2 split                                  | ✅ Landed (this PR)                                                |
| 9a          | `GET /api/admin/cross-branch-access` list endpoint                                              | ✅ Landed (this PR)                                                |
| 9b          | `/admin/cross-branch-access` frontend page + route                                              | ✅ Landed (this PR)                                                |
| 10          | Docs update (this file, gotchas.md, patterns.md, dpa-controls.md, runbook)                      | ✅ Landed (this PR)                                                |

### Key design deviations from original RFC

**D1 — Persistent grant model (not 5-minute expiry):** The D1 decision
overrides §4.5 "5-minute expiry". One `cross_branch_access_grants` row per
`(tenant_id, target_branch_id, patient_id)`. No re-prompting once access is
granted at a branch; the modal fires once per patient-branch pair. The audit
log still records every access event.

**No `withTenantTx` throw on `branchId: null`:** The RFC §4.4 proposed making
`withTenantTx` throw when `branchId: null` without `crossBranchRead`. This
was NOT adopted — `branchId: null` is the established tenant-wide-read
convention used by auth/db.ts (login lookup), fhir/db.ts, seed/db.ts, and
`getPatientDemographicProjection`. The throw would crash login and FHIR
export. `crossBranchRead` is the OPTIONAL audited break-glass path; `branchId:
null` retains its tenant-wide read meaning for operational paths.
See `gotchas.md` for the canonical statement.

**No synthetic Quality_review grants for admin reads:** RFC §4.4/§6.1-Step6
proposed emitting grant rows for admin cross-branch reads. Rejected — grants
are reserved for genuine PHI break-glass (clinical chart reveal). Admin
operational reads (audit.ts, branches.ts, users.ts) use `branchId: null` and
do not create grant rows. This keeps the compliance review surface clean.

---

## 1. Summary

Multi-branch tenants today have ambiguous PHI access: the `branch_isolation`
RLS policy default-opens to cross-branch reads when the branch GUC is empty,
and many backend routes pass `branchId: null` or rely on it being null. This
RFC defines a **Pattern B** access model — cross-branch demographic search,
branch-scoped clinical chart, one-click "Break the Glass" for cross-branch
full-chart access with mandatory reason + audit.

This is the industry-default model used by Epic, Cerner, Athenahealth,
CommonWell, and most multi-site chains. It maps cleanly onto Philippine
DPA §19/§20 ("proportionate to declared purpose") and HIPAA's "minimum
necessary" rule while not breaking clinical continuity for patients who
move between branches mid-treatment (e.g. rabies PEP series spanning
days 0/3/7/14/28 across two branches).

---

## 2. Motivation

### 2.1 Why not stricter (Pattern A — strict branch isolation)

A patient who receives Day-0 ARV at Branch HST then walks into Branch
QCN on Day 3 must be visible to Branch QCN, or:

- the nurse re-enrols them, creating a duplicate MRN and fragmenting
  the clinical record
- the nurse cannot confirm what brand/lot was given on Day 0, risking
  inconsistent ARV brand across the series
- the recall scenario fires (e.g. if a lot used at Branch HST is
  recalled, Branch QCN has no signal when administering the next dose)
- the series-completion KPI silently undercounts

For a vaccination chain this is a clinical safety hazard, not just
inconvenience.

### 2.2 Why not looser (Pattern C — tenant-wide open with audit)

- Doesn't scale to Phase 2 multi-tenant
- DPA §20 ("proportionate processing") is not satisfied if every branch
  can read every patient's full chart by default
- Audit-only access controls fail in practice: nobody reviews the log,
  insider risk goes undetected
- Once a tenant has 3+ branches the access surface is broad enough that
  a single staff exfiltration is catastrophic

### 2.3 What Pattern B unlocks

| Requirement                                 | Pattern A               | Pattern B                               | Pattern C              |
| ------------------------------------------- | ----------------------- | --------------------------------------- | ---------------------- |
| Patient identity continuity across branches | break-glass every visit | always works                            | always works           |
| Duplicate-MRN prevention                    | manual reconciliation   | automatic via search                    | automatic              |
| Series continuity (rabies PEP, hep B, HPV)  | break-glass every visit | demographic projection shows last doses | always works           |
| Allergy / recall warnings across branches   | break-glass every visit | always visible                          | always visible         |
| Full clinical chart cross-branch            | break-glass             | break-glass                             | always visible         |
| Free-text SOAP note privacy                 | enforced                | enforced                                | not enforced           |
| DPA "proportionate purpose" defensible      | yes                     | yes                                     | weak                   |
| HIPAA "minimum necessary" defensible        | yes                     | yes                                     | weak                   |
| Enterprise compliance review-friendly       | yes                     | yes                                     | no                     |
| Implementation cost on current codebase     | high (rework search)    | medium (~1 wk)                          | low (just disable RLS) |

---

## 3. Current state

### 3.1 RLS policy as-is

[`0001_extensions_and_rls.sql:495-507`](../../apps/backend/drizzle/0001_extensions_and_rls.sql):

```sql
CREATE POLICY branch_isolation ON <table>
USING (
  current_setting('app.is_platform_admin', true) = 'true'
  OR NULLIF(current_setting('app.current_branch_id', true), '') IS NULL
  OR branch_id = NULLIF(current_setting('app.current_branch_id', true), '')::bigint
);
```

**Problem:** the middle clause — `app.current_branch_id IS NULL → row visible`
— means any caller that forgets to set the GUC reads cross-branch by default.
[`withTenantTx({ branchId: null })`](../../apps/backend/src/shared/db/withTenantTx.ts)
is currently used in several places (notifications worker, audit chain
verifier, retention worker) to deliberately bypass branch filtering. That
makes the RLS policy mostly advisory rather than enforced.

### 3.2 Junction model

`user_branches` exists and is correctly populated; users with rows in it
can be authorized to multiple branches. [`patterns.md`](../../.claude/rules/patterns.md)
documents this. What's missing is a _runtime mechanism_ to opt into
cross-branch for a specific request rather than for the whole session.

### 3.3 Branch login posture

Per [`2026-05-23-ui-audit-deep-dive.md`](../handovers/archive/2026-05-23-ui-audit-deep-dive.md),
`Branch` is the comprehensive single-login-per-physical-location account.
Per the 2026-05-24 role-posture clarification ([`STATUS.md`](../STATUS.md)),
Multiple nurses/physicians work behind it; the kiosk's `cash_drawer_sessions`
and `staff_time_logs` are the per-staff attribution layer. There is no
expectation today that a Branch login traverses to another branch — it's
location-bound by definition.

---

## 4. Target design

### 4.1 Three access tiers

```
┌───────────────────────────────────────────────────────────────────────┐
│ Tier 1: TENANT-WIDE — Patient Identity Layer                          │
│  always readable from any branch within the tenant                    │
│  - first/last/middle name, suffix                                     │
│  - DOB, age, sex                                                      │
│  - MRN, display_id                                                    │
│  - primary phone                                                      │
│  - primary_branch_id (the patient's home branch)                      │
│  - safety flags: allergies (name + severity, NOT free-text notes)     │
│  - active conditions (ICD-10 code + label, NOT clinical notes)        │
│  - active courses: template name, current dose # of N, next due date  │
│  - recent doses last 90 days: vaccine + brand + lot + date + branch   │
│  - active recalls affecting this patient's lots                       │
│  - DPA consent status: granted / revoked / never-given                │
│  - photo URL (if `patient_photo_attachment_id` set)                   │
└───────────────────────────────────────────────────────────────────────┘
┌───────────────────────────────────────────────────────────────────────┐
│ Tier 2: BRANCH-SCOPED — Full Clinical Chart                           │
│  filtered to encounters / orders / records WHERE branch_id = caller's │
│  - encounter detail (chief complaint, SOAP notes, vitals series)      │
│  - clinical_orders & administration history                           │
│  - lab_orders & lab_results (incl. result_data JSONB)                 │
│  - transactions, transaction_items, payments                          │
│  - bite_incidents detail (Day-14 observation, animal owner data)      │
│  - adverse_events detail (symptoms_coded, treatment_given)            │
│  - attachments (PDFs, photos linked to records)                       │
│  - free-text patient notes (`patients.notes`)                         │
│  - audit_logs scoped to records at this branch                        │
└───────────────────────────────────────────────────────────────────────┘
┌───────────────────────────────────────────────────────────────────────┐
│ Tier 3: BREAK-THE-GLASS — Cross-Branch Full Chart                     │
│  one-click reveal with mandatory reason + audit emission              │
│  - same content as Tier 2 but for records at OTHER branches           │
│  - access duration: the current request only (NOT session-wide)       │
│  - mandatory reason field + reason category enum                      │
│  - emits CROSS_BRANCH_ACCESS audit row with correlation_id            │
│  - audit row links to a `cross_branch_access_grants` row tracking the │
│    grant for retrospective review                                     │
└───────────────────────────────────────────────────────────────────────┘
```

### 4.2 Tier-1 demographic projection

A new database view materializing the safe cross-branch projection:

```sql
CREATE OR REPLACE VIEW patients_demographic_v AS
SELECT
  p.id,
  p.display_id,
  p.tenant_id,
  p.primary_branch_id,
  p.first_name,
  p.middle_name,
  p.last_name,
  p.name_suffix,
  p.date_of_birth,
  p.sex,
  p.mrn,
  p.contact_number      AS primary_phone,
  p.patient_photo_attachment_id,
  -- safety flags
  (SELECT json_agg(
      json_build_object('label', a.label, 'severity', a.severity, 'reaction', a.reaction_summary)
    )
   FROM patient_allergies a
   WHERE a.patient_id = p.id AND a.deleted_at IS NULL
  )                     AS allergies,
  (SELECT json_agg(
      json_build_object('icd10', c.icd10_code, 'label', c.label, 'status', c.status)
    )
   FROM patient_conditions c
   WHERE c.patient_id = p.id AND c.status = 'Active' AND c.deleted_at IS NULL
  )                     AS active_conditions,
  -- active courses
  (SELECT json_agg(
      json_build_object(
        'course_id',         pso.display_id,
        'template',          pso.template_name_snapshot,
        'doses_completed',   pso.doses_completed,
        'total_doses',       pso.total_doses,
        'next_due_date',     pso.next_due_date,
        'branch_id',         pso.branch_id
      )
    )
   FROM patient_standing_orders pso
   WHERE pso.patient_id = p.id
     AND pso.status = 'Active'
     AND pso.deleted_at IS NULL
  )                     AS active_courses,
  -- recent doses (90 days, all branches)
  (SELECT json_agg(
      json_build_object(
        'service_code',    co.service_code,
        'service_name',    co.service_name_snapshot,
        'lot_id',          co.lot_id,
        'batch_number',    co.batch_number_snapshot,
        'brand',           co.brand_snapshot,
        'administered_at', co.completed_at,
        'branch_id',       co.branch_id
      )
      ORDER BY co.completed_at DESC
    )
   FROM clinical_orders co
   WHERE co.patient_id = p.id
     AND co.status = 'Completed'
     AND co.completed_at >= now() - interval '90 days'
     AND co.deleted_at IS NULL
   LIMIT 20
  )                     AS recent_doses,
  -- active recalls affecting this patient's lots
  (SELECT json_agg(
      json_build_object(
        'recall_id',        r.display_id,
        'severity',         r.recall_severity,
        'reason',           r.reason_summary
      )
    )
   FROM product_recalls r
   JOIN clinical_orders co ON co.lot_id = ANY(r.affected_lot_ids)
   WHERE co.patient_id = p.id
     AND r.resolved_at IS NULL
     AND r.deleted_at IS NULL
  )                     AS active_recalls,
  -- consent status
  EXISTS (
    SELECT 1 FROM consents c
    WHERE c.scope_ref_type = 'patient'
      AND c.scope_ref_id = p.id
      AND c.consent_type = 'DPA_DATA_PROCESSING'
      AND c.revoked_at IS NULL
      AND c.deleted_at IS NULL
  )                     AS dpa_consent_active
FROM patients p
WHERE p.deleted_at IS NULL;
```

**Key properties:**

- Same tenant_id RLS as base table (cross-branch within tenant is the
  point, but never cross-tenant)
- Aggregated JSON columns — frontend renders as structured display, not
  raw JSON dump (see UI audit finding #9)
- `recent_doses` capped at 20 to avoid runaway aggregation cost on
  long-running PEP/HPV patients
- Brand / lot / batch number snapshotted on the `clinical_orders` row
  so the demographic projection works even if the lot is later deleted

### 4.3 Tier-2 branch-scoped RLS — fix the default-open

Replace the current policy with one that **fails closed** when no GUC is
set, but accepts an explicit `app.cross_branch_read = 'true'` for
break-glass:

```sql
CREATE POLICY branch_isolation ON <table>
USING (
  current_setting('app.is_platform_admin', true) = 'true'
  OR current_setting('app.cross_branch_read', true) = 'true'
  OR branch_id = NULLIF(current_setting('app.current_branch_id', true), '')::bigint
)
WITH CHECK (
  current_setting('app.is_platform_admin', true) = 'true'
  OR branch_id = NULLIF(current_setting('app.current_branch_id', true), '')::bigint
);
```

**Differences from current:**

- The `NULLIF(...) IS NULL` clause is **removed** — empty GUC no longer
  means "open". Callers must either:
  1. Set `app.current_branch_id` (normal branch-scoped read)
  2. Set `app.cross_branch_read = 'true'` (break-glass, must emit
     `CROSS_BRANCH_ACCESS` audit)
  3. Set `app.is_platform_admin = 'true'` (operator console)
- **Writes are never cross-branch.** The `WITH CHECK` clause does NOT
  honor `app.cross_branch_read` — break-glass is read-only. To write
  to another branch's data, you change branches (clock in there) or use
  the approval flow (§5.6).

### 4.4 `withTenantTx` updates

Update [`apps/backend/src/shared/db/withTenantTx.ts`](../../apps/backend/src/shared/db/withTenantTx.ts):

```ts
export interface TxOptions {
  tenantId: string
  userId: number
  branchId: number | null
  crossBranchRead?: {
    reason: 'Continuity_of_care' | 'Emergency' | 'Patient_request' | 'Quality_review' | 'Other'
    reasonDetail: string // required free-text, min 10 chars
    patientId?: number // optional scope-narrowing
    correlationId: string
  }
}

export async function withTenantTx<T>(opts: TxOptions, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_tenant_id', ${opts.tenantId}, true)`)
    await tx.execute(sql`select set_config('app.current_user_id', ${opts.userId.toString()}, true)`)

    if (opts.crossBranchRead) {
      await tx.execute(sql`select set_config('app.cross_branch_read', 'true', true)`)
      // emit audit BEFORE the actual read so we capture intent even if read errors
      await emitCrossBranchAccessAudit(tx, opts)
    } else if (opts.branchId !== null) {
      await tx.execute(
        sql`select set_config('app.current_branch_id', ${opts.branchId.toString()}, true)`,
      )
    } else {
      throw new Error(
        'withTenantTx: must specify branchId or crossBranchRead. ' +
          'Set branchId=null was previously valid; that loophole is now closed.',
      )
    }

    return fn(tx)
  })
}
```

**Breaking change:** existing call sites that pass `branchId: null`
without `crossBranchRead` will throw. Migration is per-call-site:

- **Workers** (notifications, audit chain verifier, retention): these
  are system-level and should use a new `withPlatformTx` or
  `withWorkerTx` that explicitly bypasses branch isolation — they're
  not user PHI reads. ~6 sites.
- **Admin endpoints that legitimately need cross-branch**
  (`/admin/audit`, `/admin/branches`, `/admin/users`): pass
  `crossBranchRead` with a synthetic "Quality_review" reason +
  request correlation_id. ~10 sites.
- **Patient search and demographic projection**: query the new view,
  which RLS-filters on `tenant_id` but is intentionally cross-branch by
  design.

### 4.5 `cross_branch_access_grants` table

> **D1 LOCKED DECISION (2026-05-24):** The grants model is **persistent
> per-(target_branch_id, patient_id)** — once a branch breaks glass for a
> patient, no re-prompting is required for subsequent visits. The modal fires
> once per (branch, patient) pair. An audit row still fires on every access.
> This overrides the original "per-request" narrative below.
>
> Practical implication: the table has a `UNIQUE(tenant_id, target_branch_id,
patient_id)` constraint; `expires_at` is dropped entirely (not informational,
> not present). App code uses `INSERT … ON CONFLICT DO NOTHING` to re-use the
> existing grant row without re-prompting. See `0026_cross_branch_phi.sql`.

Track every break-glass for retrospective review and quarterly
compliance audit:

```sql
CREATE TABLE cross_branch_access_grants (
  id               bigserial PRIMARY KEY,
  display_id       text NOT NULL UNIQUE,          -- CBA_<8 base32>, set by app layer
  tenant_id        text NOT NULL REFERENCES tenants(id),
  user_id          bigint NOT NULL REFERENCES users(id),
  source_branch_id bigint REFERENCES branches(id),   -- where the user is clocked in
  target_branch_id bigint NOT NULL REFERENCES branches(id), -- branch whose data was read
  patient_id       bigint NOT NULL REFERENCES patients(id), -- required (D1: always patient-scoped)
  reason_category  text NOT NULL CHECK (reason_category IN
    ('Continuity_of_care','Emergency','Patient_request','Quality_review','Other')),
  reason_detail    text NOT NULL,
  correlation_id   text,                          -- pino-http request id, joins audit_logs
  granted_at       timestamptz NOT NULL DEFAULT now(),
  row_version      integer NOT NULL DEFAULT 0,
  deleted_at       timestamptz,
  -- D1: persistent grant — one row per (tenant, branch, patient)
  UNIQUE (tenant_id, target_branch_id, patient_id)
);

CREATE INDEX cba_grants_patient_idx ON cross_branch_access_grants(patient_id, granted_at DESC);
CREATE INDEX cba_grants_user_idx    ON cross_branch_access_grants(user_id, granted_at DESC);
CREATE INDEX cba_grants_tenant_idx  ON cross_branch_access_grants(tenant_id, granted_at DESC);
```

RLS: `tenant_isolation` policy (same pattern as sibling tables). No
`branch_isolation` because this table has two branch columns and cross-branch
visibility is its purpose.

### 4.6 Audit-row shape

`CROSS_BRANCH_ACCESS` is already an audit action enum value used by
[`AuditPage.tsx:195`](../../apps/frontend/src/features/admin/AuditPage.tsx).
Wire the actual emission:

```ts
async function emitCrossBranchAccessAudit(tx: Tx, opts: TxOptions) {
  await tx.execute(sql`
    INSERT INTO audit_logs (
      tenant_id, user_id, action, entity_type, entity_id,
      correlation_id, metadata, ip_address, user_agent
    )
    VALUES (
      ${opts.tenantId},
      ${opts.userId},
      'CROSS_BRANCH_ACCESS',
      ${opts.crossBranchRead.patientId ? 'patients' : 'cross_branch'},
      ${opts.crossBranchRead.patientId ?? null},
      ${opts.crossBranchRead.correlationId},
      ${JSON.stringify({
        reason_category: opts.crossBranchRead.reason,
        reason_detail: opts.crossBranchRead.reasonDetail,
        source_branch_id: opts.branchId,
      })}::jsonb,
      current_setting('app.current_ip_address', true),
      current_setting('app.current_user_agent', true)
    )
  `)

  await tx.execute(sql`
    INSERT INTO cross_branch_access_grants (
      tenant_id, user_id, source_branch_id, target_branch_id,
      patient_id, reason_category, reason_detail, correlation_id
    )
    VALUES (...)
  `)
}
```

Note: `app.current_ip_address` and `app.current_user_agent` GUCs require
the H2 fix from the 360 codebase review (pino-http correlation
middleware not yet mounted). This RFC depends on H2 landing first, or
defaults those columns to NULL.

---

## 5. Frontend UX

### 5.1 Patient search → demographic projection

`/patients` list page already supports tenant-wide search via the
backend `/api/patients` endpoint. Change the backend to read from
`patients_demographic_v` instead of `patients` directly. List rows show:

- Name, age, sex, MRN
- Primary phone
- **Primary branch badge** ("HST" / "QCN")
- Active-course badge if any (`Rabies · Dose 3 of 5 · next May 26`)
- Allergy badge if any (`Allergies: penicillin · latex`)
- Active-recall warning if any
- Photo thumbnail

Branch staff at HST searching for a patient registered at QCN sees
them with a "QCN" badge and the same identity + safety projection.

### 5.2 Patient detail — two-pane

Open the same `PatientDetail` drawer/sheet pattern, but split the
content into:

**Top pane: identity + safety (Tier 1 — always visible)**

- Demographics card (name, DOB, sex, phone, photo, MRN, primary
  branch)
- Allergies section (label + severity, no free-text reaction details)
- Active conditions (ICD-10 code + label, no notes)
- Active courses with dose progression + next due date
- Recent doses (last 90d, all branches) — table with branch column
- Active recalls — banner with severity
- DPA consent badge

**Bottom pane: clinical chart (Tier 2)**

For a patient whose `primary_branch_id == caller's branch`:

- Full tabs render normally (Timeline, Contacts, Immunizations, PEP
  Schedule, Consents, Billing)
- All data is for the caller's branch (filtered by RLS automatically)

For a patient whose `primary_branch_id != caller's branch`:

- Same tabs render but show only encounters/orders/transactions at the
  caller's branch (which may be empty)
- A banner appears: "This patient is registered at [QCN]. Showing only
  records from [HST, your branch]. To see their full chart at [QCN],
  reveal their cross-branch record."
- "Reveal cross-branch record" button → opens the break-glass modal
  (§5.3)

### 5.3 Break-the-glass modal

Triggered by:

- "Reveal cross-branch record" button on PatientDetail
- "View at all branches" toggle on EncounterList / ScheduledOrders /
  Lab Orders / Transactions when searching

```
┌─────────────────────────────────────────────────────────────┐
│  Reveal cross-branch record                                 │
│                                                             │
│  You are about to view [Patient X]'s full clinical record   │
│  including data from other branches in this network.        │
│                                                             │
│  Why do you need this access?                               │
│  ◯  Continuity of care — patient under treatment            │
│  ◯  Emergency — clinical situation requires immediate info  │
│  ◯  Patient request — patient explicitly asked              │
│  ◯  Quality review — clinical audit / case review           │
│  ◯  Other (specify below)                                   │
│                                                             │
│  Additional detail (required):                              │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ Patient brought ARV record from QCN, continuing PEP   │ │
│  │ Day 3 here at HST due to relocation                   │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  This access will be logged and reviewable by               │
│  compliance staff. The grant lasts for this request only.   │
│                                                             │
│              [ Cancel ]  [ Reveal record ]                  │
└─────────────────────────────────────────────────────────────┘
```

After confirming, the next backend call passes `X-Cross-Branch-Read`
header with the grant token; the API includes `crossBranchRead` in its
`withTenantTx` call. The reveal lasts for that page-load — navigating
away and back triggers the modal again.

### 5.4 Toast on grant

After break-glass fires, a sticky toast confirms:

> Cross-branch record revealed for [Patient Name] — logged as
> [CBA_XXXXXXXX]. This grant lasts for this view only.

Toast is dismissible but doesn't auto-hide. Click → opens the audit
detail for that `cross_branch_access_grants` row.

### 5.5 Admin → cross-branch audit page

New admin route: `/admin/cross-branch-access`

Lists all `cross_branch_access_grants` with filters: by user, by
patient, by source/target branch, by reason category, by date range.
Clicking a grant opens the linked `audit_logs` row and shows the
correlation_id chain.

Quarterly compliance ritual: tenant admin reviews this page, spot-checks
~5% of grants by clicking through to the reason_detail and verifying it
aligns with the patient's actual care history.

### 5.6 Optional: approval-queue path

For tenants that want pre-authorized cross-branch access instead of
break-glass, the existing `approval_requests` infra can be reused:

- The `<BreakGlassReveal>` button instead opens an "Approval request"
  dialog
- Reason + detail submitted as an `approval_request` row with
  `entity_type = 'cross_branch_access'`
- A senior staff member (BranchAdmin or TenantAdmin) reviews + grants
- Grant becomes a `cross_branch_access_grants` row with longer
  `expires_at` (e.g. 24h)
- Subsequent fetches by the original requester within the window are
  pre-authorized

This is a tenant-level config flag, not a global switch. Phase 1 ships
with break-glass mode; the approval-queue mode can be flipped on per
tenant in Phase 2.

---

## 6. Migration plan

### 6.1 Order of operations

```
Step 1: Land H2 (pino-http + correlation_id) from 360 codebase review
        — without this, audit rows can't carry IP/user-agent

Step 2: Create patients_demographic_v view + add backend route
        GET /api/patients (returns demographic projection)
        — non-breaking, adds new endpoint

Step 3: Create cross_branch_access_grants table
        — non-breaking, additive

Step 4: Update withTenantTx + add emitCrossBranchAccessAudit helper
        — non-breaking until callers migrate

Step 5: Migrate workers (notifications, retention, audit chain verifier)
        from withTenantTx({ branchId: null }) to withWorkerTx
        — non-breaking, same behavior, cleaner intent

Step 6: Migrate admin endpoints that need cross-branch reads
        to pass crossBranchRead with synthetic "Quality_review" reason
        — non-breaking, audit rows start populating

Step 7: Flip the RLS policy from "default-open on empty GUC" to
        "default-closed; require app.cross_branch_read for cross-branch"
        — BREAKING for any remaining caller that passes branchId=null
        Test with `pnpm test:integration` then ship with feature flag

Step 8: Frontend: split PatientDetail into Tier-1 + Tier-2 panes,
        add BreakGlassReveal modal, wire X-Cross-Branch-Read header

Step 9: Add /admin/cross-branch-access page for quarterly review

Step 10: Documentation update — patterns.md, gotchas.md,
         dpa-controls.md
```

Steps 1-9 are ~1 person-week. Step 10 is half a day.

### 6.2 Backwards compatibility during migration

Between Step 6 and Step 7, callers can be migrated incrementally
because the old policy still accepts `branchId: null`. Step 7 is the
breaking change — gate it on `pnpm test:integration` passing fully.

### 6.3 Data migration

No data migration needed. The `patients_demographic_v` is a view, not
a materialized view. All existing rows stay where they are.

### 6.4 Performance considerations

- The view's correlated subqueries (allergies, conditions, courses,
  doses, recalls) all already have indexes per `schema.ts`:
  `patient_allergies(patient_id)`, `patient_conditions(patient_id,
status)`, `patient_standing_orders(patient_id, status)`,
  `clinical_orders(patient_id, completed_at)`. No new indexes needed.
- For high-traffic patient search, evaluate making this a
  `MATERIALIZED VIEW` refreshed every 5 min after Phase 1.
- The `LIMIT 20` on recent_doses caps the worst case.

### 6.5 Test plan

- Unit: `withTenantTx` throws when given `branchId: null` without
  `crossBranchRead`
- Integration: `branch_isolation` policy
  - branch A user reads only their own rows by default
  - branch A user with `cross_branch_read=true` reads branch B rows
  - writes never succeed cross-branch (CHECK policy)
  - `cross_branch_access_grants` row created + audit log row created
    with matching correlation_id
- Integration: `patients_demographic_v`
  - Returns aggregated allergies, conditions, courses, doses for a
    patient across branches
  - Excludes deleted_at IS NOT NULL rows
  - Recent doses limited to 90 days and capped at 20
  - Respects tenant_id RLS (no cross-tenant leakage)
- E2E (Playwright):
  - Branch staff searches for a patient from another branch — sees
    them in the list with the secondary-branch badge
  - Opens patient detail — sees Tier 1 only, banner prompts for
    break-glass on Tier 2
  - Clicks reveal, fills reason, sees full chart
  - Closes drawer, reopens — banner prompts again (grant doesn't
    persist across navigations)
  - Admin opens `/admin/cross-branch-access` — sees the grant row

---

## 7. Open questions for sign-off

### 7.1 Financial data scope

Should branch staff see consolidated financials across branches, or
only their own?

- **Branch-scoped:** matches the clinical-chart model. Cleaner from a
  per-branch accountability standpoint.
- **Tenant-wide (for TenantAdmin role):** common for clinic chains;
  tenant owners want to see consolidated revenue.

**Recommendation:** branch-scoped by default, with `TenantAdmin` role
bypassing the policy (one of the few legitimate role-gated reads).
Branch role break-glasses for cross-branch transactions if a patient
paid at one branch for a service delivered at another.

**Decision needed from:** finance / operations team

### 7.2 AEFI cross-branch visibility

Adverse events are reported to DOH centrally and the "active recall"
projection in Tier 1 should include AEFI severity for patient safety.
But the AEFI _report detail_ (symptoms_coded, free-text) is sensitive.

- **Tier 1:** include severity-only (matches recall handling)
- **Tier 2:** branch-scoped detail, break-glass for cross-branch

**Recommendation:** as proposed — severity in Tier 1, detail in
Tier 2. Confirms with clinical-ops.

### 7.3 Lab result cross-branch visibility for series safety

A nurse administering Day 3 ARV may want to see the Day 0 admin lot
(in Tier 1 already) but also confirm there was no critical-value lab
result between visits. Should lab results be in Tier 1?

**Recommendation:** add a `recent_critical_lab_results` aggregate to
Tier 1 (last 90d, only `ResultReceived` status, only those flagged
critical). Full lab result data stays Tier 2.

### 7.4 Break-glass duration

This RFC specifies "per request only" — grant doesn't persist beyond
the page-load. Alternative: "per shift" (8h) — fewer modal interruptions
for legitimate continuity-of-care users.

**Recommendation:** per-request for Phase 1 (safer). If clinical-ops
report excessive friction in operation, shorten the modal to one click
(no reason field, just confirmation) for `Continuity_of_care`
specifically, while keeping audit emission. Reason field stays for the
other categories.

### 7.5 Approval-queue mode

Should the optional approval-queue path (§5.6) ship in Phase 1 or
defer to Phase 2?

**Recommendation:** defer to Phase 2 — the infra exists but isn't
needed until a tenant with a strict-compliance posture signs on.
Break-glass mode handles current Philippine clinic chain operations
fine.

---

## 8. DPA / HIPAA compliance mapping

| Control / Principle                                               | How Pattern B satisfies                                                                                                                            |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| DPA §11(c) "lawful, fair, proportional"                           | Tier 1 = identity safety (proportional to treatment relationship); Tier 2 = branch-scoped (minimal necessary); Tier 3 = explicit reason recorded   |
| DPA §19 / NPC IRR §29 "data subject rights"                       | Patient access via `/api/patients/:id/access-log` (future) lists all who viewed their chart                                                        |
| DPA §20 "security measures — organizational, physical, technical" | RLS at DB layer (technical), break-glass audit (organizational), cross_branch_access_grants quarterly review (organizational)                      |
| DPA §34(b) "withdrawal of consent"                                | `dpa_consent_active` flag in Tier 1 makes consent status visible at every chart access; tied to existing `consents` table (H7 fix from 360 review) |
| HIPAA §164.502(b) "minimum necessary"                             | Tier 1 = minimum necessary for identity; Tier 2 = minimum necessary for treatment at this facility; Tier 3 = documented business justification     |
| HIPAA §164.508(a)(2) "Break the Glass"                            | The `cross_branch_access_grants` + reason_category + reason_detail = formal authorization with documentation                                       |
| HIPAA §164.312(b) "audit controls"                                | All Tier 3 reads logged in `audit_logs` with action=`CROSS_BRANCH_ACCESS`; existing audit chain SHA-256 hashes ensure tamper evidence              |
| HITECH §13405(c) "accounting of disclosures"                      | `cross_branch_access_grants` queried for "all cross-branch reads of patient X" → produces the accounting on demand                                 |
| Epic / Cerner "Care Everywhere" parallel                          | Same shape — identity always shared, clinical content per-facility, break-glass with reason for cross-facility                                     |

---

## 9. Out of scope

- **Patient consent for cross-branch sharing.** The current `consents`
  table tracks DPA consent for the tenant (clinic chain) as a whole.
  Per-branch consent scoping is a possible future extension but not
  required for HIPAA/DPA compliance under the "treatment relationship"
  exception (DPA §13(b), HIPAA §164.506).
- **Patient-portal cross-branch visibility.** Patients today don't have
  a portal. When they do, the same Tier 1/2/3 model can apply, with
  patient = role that always sees Tier 2 for their own record.
- **Tenant-to-tenant data sharing.** Different tenants are different
  clinic chains; cross-tenant sharing requires separate consent (out of
  Phase 2 scope).
- **Real-time alerts on break-glass.** Future: notify a privacy officer
  when break-glass fires for sensitive patients (VIPs, employees,
  minors). Not required for Phase 1.
- **De-identified analytics across branches.** Different mechanism (no
  PHI involved); doesn't need this access tier.

---

## 10. Acceptance criteria

- [x] `patients_demographic_v` view exists with RFC §4.2 + D5 aggregates + security_invoker
- [x] `cross_branch_access_grants` table exists (schema.ts)
- [x] `withTenantTx` has optional `crossBranchRead` field (deviation: no throw on branchId:null — see above)
- [x] `branch_isolation` policy fails closed on empty GUC (M12 already landed)
- [x] All worker code paths use `withSystemTx` (withWorkerTx == withSystemTx — no-op)
- [x] Admin cross-branch reads use `branchId: null` (no synthetic grants per D1)
- [x] Frontend PatientDetail shows Tier-1 safety banners (recalls, critical labs, cross-branch banner)
- [x] BreakGlassReveal modal implemented + wired with audit emission
- [x] `/admin/cross-branch-access` page renders grant history
- [ ] Integration tests for all 4 §6.5 RLS scenarios (pending — needs rls_tester non-superuser role)
- [ ] E2E test for full break-glass flow (pending)
- [x] `patterns.md` updated with cross_branch_read GUC + break-glass pattern
- [x] `gotchas.md` updated with withTenantTx deviation (no throw on branchId:null)
- [x] `docs/compliance/dpa-controls.md` updated with access-tier §8 mapping
- [x] Quarterly review SOP at `docs/runbooks/cross-branch-access-review.md`
