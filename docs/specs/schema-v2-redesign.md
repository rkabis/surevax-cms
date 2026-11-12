# SureVax CMS — Schema Assessment & Ideal Design

> A comprehensive review of the current schema with a recommended target design,
> rooted in the principle: **invest in structure where the shape is known and the
> migration is painful; defer where the shape is uncertain and the migration is
> cheap. Always capture information you cannot reconstruct, even if you have
> nowhere to display it yet.**

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Design Principles](#2-design-principles)
3. [Cross-Cutting Patterns](#3-cross-cutting-patterns)
4. [Ideal Schema by Domain](#4-ideal-schema-by-domain)
   - [4.0 Shared Types & Enums](#40-shared-types--enums)
   - [4.1 Tenancy & Access](#41-tenancy--access)
   - [4.2 Patient Registry](#42-patient-registry)
   - [4.3 Catalog & Pricing](#43-catalog--pricing)
   - [4.4 Clinical Operations](#44-clinical-operations)
   - [4.5 Inventory & Traceability](#45-inventory--traceability)
   - [4.6 Billing, AR & Claims](#46-billing-ar--claims)
   - [4.7 Laboratory](#47-laboratory)
   - [4.8 System, Security & Audit](#48-system-security--audit)
   - [4.9 Analytics & Reporting Layer](#49-analytics--reporting-layer)
5. [Migration Path from Current Schema](#5-migration-path-from-current-schema)
6. [Open Questions for Future Consideration](#6-open-questions-for-future-consideration)

---

## 1. Executive Summary

The current schema is a credible foundation for a multi-tenant Philippine clinic
management system. It correctly models BIR compliance (OR numbers, OSCA/PWD
discounts, VAT decomposition), uses appropriate Postgres idioms (`tsvector`,
partitioned audit logs, FEFO indexes), and separates legally sensitive records
like `consent_records` from operational tables.

The proposed ideal schema below preserves these strengths and addresses three
classes of issue:

**Structural decisions that are expensive to defer.** Single-role/single-branch
user model, single-column pricing, polymorphic references without integrity,
missing composite tenant foreign keys, and inconsistent soft-delete strategies.
These are well-understood patterns where the right shape is knowable today and
the migration cost grows roughly linearly with rows and call sites.

**Information capture gaps that cannot be reconstructed.** Lot identity at
administration time, price at time of sale (already captured), status
transitions over time, and idempotency keys for retried operations. These
columns must exist _before_ the events occur or the data is lost forever.

**Compliance and operational requirements that come due at first audit.** PHI
read access logging, data retention metadata, immutability of finalized
financial records, and a claims subsystem for HMO payers. These are deferrable
in development but become blocking at certification or at first regulator
inquiry.

The document specifies ~38 tables versus the current 22, organized into nine
domains with explicit cross-cutting patterns. A migration path is provided for
moving from the current schema without breaking existing flows. Open questions
at the end track decisions that depend on business context — these should not
be schema'd speculatively.

---

## 2. Design Principles

The following principles govern every modeling decision in this document.
Where two principles conflict, the earlier one wins.

**P1. Tenant isolation is enforced in the schema, not just in application
code.** Every cross-table foreign key includes `tenant_id` as part of a
composite reference. Row-Level Security policies are a defense in depth, not
the primary boundary. The application can have a bug and the database still
refuses to leak data across tenants.

**P2. Information capture beats display readiness.** Columns that record
irreversible facts — lot numbers consumed, prices charged, identities of
administering clinicians — exist on day one even if no UI surfaces them. A
column with mostly null values is reversible; missing data from past events is
not.

**P3. Structural decisions are made up front; behavioral details are
deferred.** Join tables for many-to-many relationships, history tables for
mutable state, and polymorphic-to-explicit FK conversions are done while the
codebase is small. Domain-specific subsystems (loyalty programs, complex claims
adjudication) wait until business requirements are concrete.

**P4. One pattern per concern, applied consistently.** Soft delete uses
`deleted_at` everywhere. Mutable state has a corresponding history table.
Created/updated timestamps follow one convention. Inconsistency multiplies
cognitive load and causes bugs at the seams.

**P5. Finalized financial and clinical records are immutable.** Once a
transaction is `Paid` or a clinical order is `Completed`, the row is no longer
updatable except through explicit reversal flows (void, refund, amendment).
Enforced via triggers, not application code.

**P6. Every mutable row carries a version for optimistic concurrency.**
`row_version int not null default 0`, bumped on every UPDATE. Two clinicians
editing the same encounter cannot both win silently.

**P7. Identifiers are human-readable and structurally enforced.** `text`
primary keys with prefixes (`PSO-…`, `SOT-…`) are constrained by `CHECK` rules.
This trades clustering performance for operational legibility, which is the
right trade-off for a clinical system whose IDs appear on receipts and audit
reports.

**P8. Analytics is a separate concern with its own schema.** Reporting tables
are denormalized views over the operational schema, refreshed on a schedule.
OLTP workloads are not slowed by ad-hoc analytical queries.

---

## 3. Cross-Cutting Patterns

These patterns appear on most or all tables and are documented once here
rather than repeated in every definition below.

### 3.1 Standard Columns

Every domain table includes:

```ts
id: text('id').primaryKey(),                                    // prefixed, CHECK-constrained
tenantId: text('tenant_id').notNull(),                          // composite FK to tenants
deletedAt: timestamp('deleted_at', { withTimezone: true }),     // soft delete
rowVersion: integer('row_version').notNull().default(0),        // optimistic concurrency
createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
createdById: text('created_by_id').references(() => users.id),
updatedById: text('updated_by_id').references(() => users.id),
```

Tables exempted: `audit_logs` (append-only, no updates), `tenants` (root),
junction/history tables (no soft delete; deletion handled via parent).

### 3.2 Composite Tenant Foreign Keys

Every cross-table FK includes tenant_id. Drizzle expression:

```ts
foreignKey({
  columns: [t.tenantId, t.patientId],
  foreignColumns: [patients.tenantId, patients.id],
}),
```

This requires the referenced table to have a unique index on `(tenant_id, id)`,
which is added to every domain table.

### 3.3 Updated_at Trigger

Drizzle's `defaultNow()` only fires at INSERT. A database trigger maintains
`updated_at` on UPDATE:

```sql
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  NEW.row_version = OLD.row_version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Applied to every domain table via migration
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON {table}
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

### 3.4 Idempotency

Mutating endpoints accept an `Idempotency-Key` header. The key is stored on
`transactions`, `payments`, `clinical_orders`, and any other table whose
creation must not be duplicated under retry. Schema:

```ts
idempotencyKey: text('idempotency_key'),
// Unique index on (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
```

### 3.5 Status History

Any table with a meaningful status enum has a corresponding `*_status_history`
table written via trigger:

```ts
{table}_status_history {
  id, tenantId, entityId, fromStatus, toStatus, reason,
  changedAt, changedById, metadata jsonb
}
```

This is automatic — application code never writes to history tables directly.

### 3.6 Polymorphic References

Where polymorphism is unavoidable (audit logs, attachments, approvals),
`(reference_type, reference_id)` is paired with a CHECK constraint enumerating
allowed types and a partial index per type for query performance. Where the
universe of references is small and stable, prefer explicit nullable FKs over
polymorphism.

### 3.7 Naming Conventions

- Tables: `snake_case`, plural (`clinical_orders`, not `clinical_order`).
- Columns: `snake_case`. Booleans: `is_*` or `has_*` or `requires_*`.
- Timestamps: `*_at` for points in time, `*_date` for calendar dates.
- Foreign keys: `{singular_table}_id`.
- Indexes: `{table}_{purpose}_idx`. Unique: `{table}_{purpose}_uniq`.
- Enums: `{noun}_{descriptor}_enum`.

### 3.8 ID Format Enforcement

Every ID column has a CHECK constraint enforcing its prefix:

```sql
ALTER TABLE patient_standing_orders
  ADD CONSTRAINT pso_id_format CHECK (id ~ '^PSO-[A-Z0-9]+$');
```

This prevents an entire class of bugs where the wrong ID is passed to the wrong
table at the API layer.

---

## 4. Ideal Schema by Domain

### 4.0 Shared Types & Enums

Enums consolidated and renamed for consistency. Additions noted with `// NEW`
or `// EXPANDED`.

```ts
export const userStatusEnum = pgEnum('user_status', [
  'Active',
  'Inactive',
  'Locked',
  'PendingActivation', // EXPANDED
])

export const sexEnum = pgEnum('sex', ['Male', 'Female', 'Other'])

export const serviceTypeEnum = pgEnum('service_type', [
  'Vaccine',
  'Consultation',
  'Lab',
  'Procedure',
  'Product',
])

export const encounterStatusEnum = pgEnum('encounter_status', [
  'Scheduled',
  'CheckedIn',
  'Triage',
  'InProgress', // EXPANDED
  'OnHold',
  'Completed',
  'Cancelled',
  'NoShow',
])

export const standingOrderStatusEnum = pgEnum('standing_order_status', [
  'Active',
  'Suspended',
  'Completed',
  'Discontinued',
])

export const clinicalOrderStatusEnum = pgEnum('clinical_order_status', [
  'Scheduled',
  'Pending',
  'Deferred',
  'Refused', // EXPANDED
  'Completed',
  'Missed',
  'Cancelled',
])

export const administrationRouteEnum = pgEnum('administration_route', [
  // NEW
  'IM',
  'SC',
  'ID',
  'IV',
  'PO',
  'IN',
  'Topical',
])

export const consenterRelationEnum = pgEnum('consenter_relation', [
  // NEW
  'Patient',
  'Parent',
  'Guardian',
  'Spouse',
  'Caregiver',
  'Other',
])

export const transactionStatusEnum = pgEnum('transaction_status', [
  'Draft',
  'Pending',
  'PartiallyPaid',
  'Paid', // EXPANDED
  'Voided',
  'Refunded',
])

export const claimStatusEnum = pgEnum('claim_status', [
  // NEW
  'Draft',
  'Submitted',
  'Acknowledged',
  'InReview',
  'Approved',
  'PartiallyApproved',
  'Denied',
  'Paid',
  'Appealed',
])

export const drawerStateEnum = pgEnum('drawer_state', [
  // NEW
  'Open',
  'Closed',
  'Reconciled',
  'Discrepancy',
])

// ... existing enums for movement_type, payment_method, payer_type,
// notification_channel, audit_action, etc. retained.
```

---

### 4.1 Tenancy & Access

Most significant changes here: users decoupled from a single branch and a
single role; sessions tracked separately from refresh tokens; cash drawer
sessions split out from time logs.

#### `tenants`

```ts
export const tenants = pgTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  timezone: text('timezone').notNull().default('Asia/Manila'), // NEW — for date math
  countryCode: text('country_code').notNull().default('PH'), // NEW
  retentionPolicy: jsonb('retention_policy'), // NEW — DPA categories
  settings: jsonb('settings'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

The `timezone` column is essential. Day-offset computation for protocols like
the Zagreb rabies regimen depends on a clinic-local calendar day, not a server
UTC instant. Storing it on the tenant (or on `branches` if a chain spans
timezones) makes that explicit.

#### `branches` and `locations`

`branches` carries the basics. A new `locations` table represents physical
sub-locations within a branch — exam rooms, fridges, drug safes — used by
inventory tracking and patient flow.

```ts
export const branches = pgTable(
  'branches',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    timezone: text('timezone'), // NEW — overrides tenant.timezone if set
    address: text('address'),
    city: text('city'),
    province: text('province'),
    contactNumber: text('contact_number'),
    email: text('email'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }), // CHANGED from is_active
    rowVersion: integer('row_version').notNull().default(0),
    // ... standard timestamps + audit fields
  },
  (t) => [
    uniqueIndex('branches_tenant_code_uniq').on(t.tenantId, t.code),
    uniqueIndex('branches_tenant_id_uniq').on(t.tenantId, t.id), // for composite FKs
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }),
  ],
)

export const locations = pgTable(
  'locations',
  {
    // NEW
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    branchId: text('branch_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    locationType: text('location_type').notNull(), // ExamRoom, Fridge, Safe, Counter
    metadata: jsonb('metadata'), // temp range for fridges, etc.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // ... standard
  },
  (t) => [uniqueIndex('locations_branch_code_uniq').on(t.branchId, t.code)],
)
```

#### `users`, `user_branches`, `user_roles`

The core change: a user can belong to multiple branches and hold multiple
roles. The single `branch_id` and `role` columns are gone.

```ts
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    primaryBranchId: text('primary_branch_id'), // CHANGED — nullable, default for new encounters
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }), // NEW
    failedLoginCount: integer('failed_login_count').notNull().default(0), // NEW
    lockedUntil: timestamp('locked_until', { withTimezone: true }), // NEW
    mfaEnabled: boolean('mfa_enabled').notNull().default(false), // NEW
    mfaSecretEncrypted: text('mfa_secret_encrypted'), // NEW
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    preferredName: text('preferred_name'), // NEW
    status: userStatusEnum('status').notNull().default('Active'), // CHANGED
    licenseNumber: text('license_number'),
    licenseType: text('license_type'), // NEW
    licenseExpiresAt: date('license_expires_at'), // NEW
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // ... standard
  },
  (t) => [
    uniqueIndex('users_tenant_email_uniq').on(t.tenantId, t.email),
    uniqueIndex('users_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

export const userBranches = pgTable(
  'user_branches',
  {
    // NEW
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    branchId: text('branch_id').notNull(),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    assignedById: text('assigned_by_id'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.branchId] })],
)

export const userRoles = pgTable(
  'user_roles',
  {
    // NEW
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    role: userRoleEnum('role').notNull(),
    branchId: text('branch_id'), // nullable — role can be tenant-wide or branch-scoped
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    assignedById: text('assigned_by_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }), // for temporary elevations
  },
  (t) => [uniqueIndex('user_roles_uniq').on(t.userId, t.role, t.branchId)],
)
```

The temporary elevation pattern (`expiresAt`) covers break-glass scenarios
where a Nurse is granted Physician-level authority for a shift.

#### `user_sessions`, `refresh_tokens`, `password_reset_tokens`

`refresh_tokens` is retained as-is (it was well-designed). Two siblings are
added.

```ts
export const userSessions = pgTable(
  'user_sessions',
  {
    // NEW
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    deviceFingerprint: text('device_fingerprint'),
    deviceLabel: text('device_label'), // "Chrome on MacBook Pro"
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endReason: text('end_reason'), // logout, timeout, revoked, expired
  },
  (t) => [index('user_sessions_user_idx').on(t.tenantId, t.userId, t.startedAt)],
)

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    // NEW
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    tokenHash: text('token_hash').notNull(), // never store raw token
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    requestedFromIp: text('requested_from_ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('password_reset_tokens_hash_uniq').on(t.tokenHash)],
)
```

#### `staff_time_logs` and `cash_drawer_sessions`

The conflated time-log + drawer concerns are now two tables.

```ts
export const staffTimeLogs = pgTable('staff_time_logs', {
  // CHANGED — drawer fields removed
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  userId: text('user_id').notNull(),
  branchId: text('branch_id').notNull(),
  clockInAt: timestamp('clock_in_at', { withTimezone: true }).notNull(),
  clockOutAt: timestamp('clock_out_at', { withTimezone: true }),
  totalMinutes: integer('total_minutes'), // CHANGED — integer minutes is more precise
  notes: text('notes'),
  // ... standard
})

export const cashDrawerSessions = pgTable('cash_drawer_sessions', {
  // NEW
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  userId: text('user_id').notNull(),
  branchId: text('branch_id').notNull(),
  locationId: text('location_id'), // which counter/till
  state: drawerStateEnum('state').notNull().default('Open'),
  openingFloat: numeric('opening_float', { precision: 12, scale: 2 }).notNull(),
  openingDenominations: jsonb('opening_denominations'), // { "1000": 5, "500": 10, ... }
  closingTotalDeclared: numeric('closing_total_declared', { precision: 12, scale: 2 }),
  closingDenominations: jsonb('closing_denominations'),
  expectedTotal: numeric('expected_total', { precision: 12, scale: 2 }), // computed from txns
  variance: numeric('variance', { precision: 12, scale: 2 }),
  varianceReason: text('variance_reason'),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
  reconciledById: text('reconciled_by_id'),
  // ... standard
})
```

---

### 4.2 Patient Registry

Three big changes: MRN separated from system ID, allergies/conditions
normalized, and explicit duplicate-handling fields.

```ts
export const patients = pgTable(
  'patients',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    mrn: text('mrn').notNull(), // NEW — human-readable medical record number
    homeBranchId: text('home_branch_id'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    middleName: text('middle_name'),
    suffix: text('suffix'), // NEW — Jr., III, etc.
    dateOfBirth: date('date_of_birth'),
    sex: sexEnum('sex'),
    preferredLanguage: text('preferred_language').notNull().default('en'), // NEW
    civilStatus: text('civil_status'),
    nationality: text('nationality'),
    address: text('address'),
    city: text('city'),
    province: text('province'),
    barangay: text('barangay'),
    contactNumber: text('contact_number'),
    email: text('email'),
    smsOptIn: boolean('sms_opt_in').notNull().default(false), // NEW — explicit consent
    emailOptIn: boolean('email_opt_in').notNull().default(false), // NEW
    // Guardian (for minors) — kept inline; emergency contact split out below
    guardianName: text('guardian_name'),
    guardianRelationship: text('guardian_relationship'),
    guardianContact: text('guardian_contact'),
    // Insurance
    insuranceProvider: text('insurance_provider'),
    insurancePolicyNumber: text('insurance_policy_number'),
    // Duplicate handling
    potentialDuplicateOfId: text('potential_duplicate_of_id'), // NEW — flagged for review
    mergedIntoId: text('merged_into_id'), // NEW — merged record points here
    mergedAt: timestamp('merged_at', { withTimezone: true }), // NEW
    // Retention
    deletionRequestedAt: timestamp('deletion_requested_at', { withTimezone: true }), // NEW DPA
    scheduledPurgeAt: timestamp('scheduled_purge_at', { withTimezone: true }), // NEW DPA
    searchVector: tsvector('search_vector'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // ... standard
  },
  (t) => [
    uniqueIndex('patients_tenant_mrn_uniq').on(t.tenantId, t.mrn),
    index('patients_dedup_idx').on(t.tenantId, t.lastName, t.firstName, t.dateOfBirth),
    index('patients_search_idx').using('gin', t.searchVector),
  ],
)
```

#### `patient_emergency_contacts`

Emergency contact is distinct from guardian (a 35-year-old patient has no
guardian but does have an emergency contact).

```ts
export const patientEmergencyContacts = pgTable('patient_emergency_contacts', {
  // NEW
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  patientId: text('patient_id').notNull(),
  name: text('name').notNull(),
  relationship: text('relationship').notNull(),
  phoneNumber: text('phone_number').notNull(),
  email: text('email'),
  isPrimary: boolean('is_primary').notNull().default(false),
  // ... standard
})
```

#### `patient_allergies` and `patient_conditions`

Normalized from JSONB arrays. This enables clinical decision support, allergy
checking at order time, and analytics.

```ts
export const patientAllergies = pgTable(
  'patient_allergies',
  {
    // NEW
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    patientId: text('patient_id').notNull(),
    allergen: text('allergen').notNull(), // free text or coded
    allergenCode: text('allergen_code'), // SNOMED CT or RxNorm if coded
    reaction: text('reaction'),
    severity: text('severity'), // Mild, Moderate, Severe, Anaphylaxis
    onsetDate: date('onset_date'),
    source: text('source').notNull(), // PatientReported, Confirmed, External
    recordedById: text('recorded_by_id'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    notes: text('notes'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // ... standard
  },
  (t) => [
    index('patient_allergies_patient_idx')
      .on(t.tenantId, t.patientId)
      .where(sql`deleted_at IS NULL AND resolved_at IS NULL`),
  ],
)

export const patientConditions = pgTable('patient_conditions', {
  // NEW
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  patientId: text('patient_id').notNull(),
  conditionName: text('condition_name').notNull(),
  icd10Code: text('icd10_code'),
  status: text('status').notNull(), // Active, Resolved, InRemission
  onsetDate: date('onset_date'),
  resolvedDate: date('resolved_date'),
  recordedById: text('recorded_by_id'),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  notes: text('notes'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  // ... standard
})
```

#### `patient_external_immunizations`

Doses given outside the clinic — necessary for completing protocols started
elsewhere and for compliance reporting.

```ts
export const patientExternalImmunizations = pgTable('patient_external_immunizations', {
  // NEW
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  patientId: text('patient_id').notNull(),
  vaccineName: text('vaccine_name').notNull(),
  cvxCode: text('cvx_code'),
  manufacturer: text('manufacturer'),
  lotNumber: text('lot_number'),
  administeredDate: date('administered_date').notNull(),
  administeredAtFacility: text('administered_at_facility'),
  doseNumberInSeries: integer('dose_number_in_series'),
  source: text('source').notNull(), // PatientReported, RecordsTransfer, IIS
  verifiedById: text('verified_by_id'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  // ... standard
})
```

#### `patient_tags` and `tag_definitions`

Tag dictionary prevents the "VIP" / "vip" / "V.I.P." sprawl problem.

```ts
export const tagDefinitions = pgTable(
  'tag_definitions',
  {
    // NEW
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    tag: text('tag').notNull(),
    description: text('description'),
    color: text('color'),
    category: text('category'), // Clinical, Administrative, Marketing
    isActive: boolean('is_active').notNull().default(true),
    // ... standard
  },
  (t) => [uniqueIndex('tag_definitions_tenant_tag_uniq').on(t.tenantId, t.tag)],
)

export const patientTags = pgTable(
  'patient_tags',
  {
    // CHANGED — references tag_definitions
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    patientId: text('patient_id').notNull(),
    tagDefinitionId: text('tag_definition_id').notNull(),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
    appliedById: text('applied_by_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('patient_tags_uniq').on(t.patientId, t.tagDefinitionId)],
)
```

---

### 4.3 Catalog & Pricing

The single biggest structural change: pricing moves out of `service_catalog`
into a dedicated `service_prices` table keyed by branch, payer, and effective
date. This is the change that will hurt most to defer.

#### `service_catalog`

The catalog now describes what a service _is_, not what it costs.

```ts
export const serviceCatalog = pgTable(
  'service_catalog',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    serviceType: serviceTypeEnum('service_type').notNull(),
    category: text('category'),
    description: text('description'),
    // External coding systems
    cvxCode: text('cvx_code'), // NEW — vaccines (CDC)
    ndcCode: text('ndc_code'), // NEW — drugs
    cptCode: text('cpt_code'), // NEW — procedures
    loincCode: text('loinc_code'), // NEW — labs
    // Defaults for vaccines
    defaultRoute: administrationRouteEnum('default_route'), // NEW
    defaultDoseVolumeMl: numeric('default_dose_volume_ml', { precision: 6, scale: 2 }), // NEW
    defaultManufacturer: text('default_manufacturer'), // NEW
    // Operational
    isVatExempt: boolean('is_vat_exempt').notNull().default(false),
    requiresStock: boolean('requires_stock').notNull().default(false),
    requiresRx: boolean('requires_rx').notNull().default(false),
    requiresConsent: boolean('requires_consent').notNull().default(false), // NEW
    requiresVis: boolean('requires_vis').notNull().default(false), // NEW (vaccines)
    // basePrice REMOVED — now in service_prices
    searchVector: tsvector('search_vector'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // ... standard
  },
  (t) => [
    uniqueIndex('service_catalog_tenant_code_uniq').on(t.tenantId, t.code),
    uniqueIndex('service_catalog_tenant_id_uniq').on(t.tenantId, t.id),
    index('service_catalog_search_idx').using('gin', t.searchVector),
  ],
)
```

#### `service_prices`

The new pricing table. Every priced service has at least one row here. The
resolution algorithm at sale time looks up the most specific match — by
(branch, payer, effective_date) — falling back through layers.

```ts
export const servicePrices = pgTable(
  'service_prices',
  {
    // NEW
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    serviceId: text('service_id').notNull(),
    branchId: text('branch_id'), // null = all branches
    payerId: text('payer_id'), // null = all payers (retail / cash)
    patientSegment: text('patient_segment'), // optional dimension: VIP, Senior, etc.
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('PHP'),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    notes: text('notes'),
    // ... standard
  },
  (t) => [
    index('service_prices_lookup_idx').on(
      t.tenantId,
      t.serviceId,
      t.branchId,
      t.payerId,
      t.effectiveFrom,
    ),
    // Constraint: at most one active price per (service, branch, payer, segment) at a given moment.
    // Enforced via exclusion constraint in supplemental SQL using daterange.
  ],
)
```

The exclusion constraint preventing overlapping ranges is added in raw SQL:

```sql
ALTER TABLE service_prices ADD CONSTRAINT service_prices_no_overlap
EXCLUDE USING gist (
  tenant_id WITH =, service_id WITH =,
  COALESCE(branch_id, '*') WITH =, COALESCE(payer_id, '*') WITH =,
  COALESCE(patient_segment, '*') WITH =,
  daterange(effective_from, effective_to, '[)') WITH &&
);
```

#### `payer_profiles` and `payer_contracts`

Payer profiles retained. A new `payer_contracts` table holds contract-specific
terms (claim submission format, payment SLA, fee schedules at the contract
level rather than per-service).

```ts
export const payerContracts = pgTable('payer_contracts', {
  // NEW
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  payerId: text('payer_id').notNull(),
  contractNumber: text('contract_number').notNull(),
  effectiveFrom: date('effective_from').notNull(),
  effectiveTo: date('effective_to'),
  paymentTermsDays: integer('payment_terms_days'),
  claimSubmissionFormat: text('claim_submission_format'), // EDI837, manual, web portal
  requiresPriorAuth: boolean('requires_prior_auth').notNull().default(false),
  feeScheduleNotes: text('fee_schedule_notes'),
  contactName: text('contact_name'),
  contactNumber: text('contact_number'),
  contactEmail: text('contact_email'),
  // ... standard
})
```

---

### 4.4 Clinical Operations

The most heavily revised domain. Changes: appointments split from encounters,
template versioning is now immutable post-use, vitals are normalized,
diagnoses are coded, and clinical orders capture lot identity at administration
time.

#### `appointments`

A patient-initiated time slot, distinct from the encounter that may follow.

```ts
export const appointments = pgTable(
  'appointments',
  {
    // NEW
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    patientId: text('patient_id').notNull(),
    branchId: text('branch_id').notNull(),
    providerId: text('provider_id'),
    locationId: text('location_id'), // exam room
    scheduledStartAt: timestamp('scheduled_start_at', { withTimezone: true }).notNull(),
    scheduledEndAt: timestamp('scheduled_end_at', { withTimezone: true }).notNull(),
    appointmentType: text('appointment_type').notNull(), // Consultation, FollowUp, Vaccination
    status: text('status').notNull().default('Scheduled'), // Scheduled, Confirmed, CheckedIn,
    // Completed, Cancelled, NoShow
    reason: text('reason'),
    notes: text('notes'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledById: text('cancelled_by_id'),
    cancellationReason: text('cancellation_reason'),
    encounterId: text('encounter_id'), // populated when appointment becomes a visit
    // ... standard
  },
  (t) => [
    index('appointments_branch_time_idx').on(t.tenantId, t.branchId, t.scheduledStartAt),
    index('appointments_patient_idx').on(t.tenantId, t.patientId, t.scheduledStartAt),
    // Exclusion constraint to prevent provider double-booking — supplemental SQL
  ],
)
```

#### `encounters`

```ts
export const encounters = pgTable('encounters', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  patientId: text('patient_id').notNull(),
  branchId: text('branch_id').notNull(),
  appointmentId: text('appointment_id'), // CHANGED — links to scheduled slot if any
  providerId: text('provider_id'),
  closedById: text('closed_by_id'), // NEW — who closed (vs who attended)
  specialty: encounterSpecialtyEnum('specialty').notNull(),
  status: encounterStatusEnum('status').notNull().default('Scheduled'),
  chiefComplaint: text('chief_complaint'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  dispositionCode: text('disposition_code'), // NEW — Admitted, DischargedHome, Referred, etc.
  specialtyData: jsonb('specialty_data'), // RETAINED — intake forms, screening checklists
  clinicalNotes: jsonb('clinical_notes'), // RETAINED — SOAP, free-form prose
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  // ... standard
})
```

The `clinicalNotes` JSONB stays — free-form physician narrative doesn't
benefit from normalization. But vitals and diagnoses come out.

#### `encounter_vitals`

Vitals as a normalized time-series, allowing trending across encounters.

```ts
export const encounterVitals = pgTable(
  'encounter_vitals',
  {
    // NEW
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    encounterId: text('encounter_id').notNull(),
    patientId: text('patient_id').notNull(), // denormalized for cross-encounter trending
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    recordedById: text('recorded_by_id'),
    // Common vitals as columns; uncommon ones in `extra` jsonb
    temperatureC: numeric('temperature_c', { precision: 4, scale: 1 }),
    heartRateBpm: integer('heart_rate_bpm'),
    respiratoryRateBpm: integer('respiratory_rate_bpm'),
    systolicBp: integer('systolic_bp'),
    diastolicBp: integer('diastolic_bp'),
    spo2Percent: numeric('spo2_percent', { precision: 5, scale: 2 }),
    weightKg: numeric('weight_kg', { precision: 6, scale: 2 }),
    heightCm: numeric('height_cm', { precision: 5, scale: 1 }),
    bmi: numeric('bmi', { precision: 5, scale: 2 }), // computed; persisted for indexing
    painScore: integer('pain_score'), // 0–10
    extra: jsonb('extra'),
    // ... standard
  },
  (t) => [index('encounter_vitals_patient_time_idx').on(t.tenantId, t.patientId, t.recordedAt)],
)
```

#### `encounter_diagnoses`

Coded diagnoses are mandatory for analytics, HMO claims, and any clinical
reporting.

```ts
export const encounterDiagnoses = pgTable(
  'encounter_diagnoses',
  {
    // NEW
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    encounterId: text('encounter_id').notNull(),
    patientId: text('patient_id').notNull(),
    icd10Code: text('icd10_code').notNull(),
    description: text('description'), // snapshot from code dictionary
    isPrimary: boolean('is_primary').notNull().default(false),
    diagnosisType: text('diagnosis_type'), // Working, Confirmed, Differential, RuleOut
    recordedById: text('recorded_by_id'),
    notes: text('notes'),
    // ... standard
  },
  (t) => [
    index('encounter_diagnoses_encounter_idx').on(t.encounterId),
    index('encounter_diagnoses_icd10_idx').on(t.tenantId, t.icd10Code),
  ],
)
```

#### `standing_order_templates` and `standing_order_template_items`

Templates become immutable post-use through a copy-on-write versioning
pattern. Editing a template that has any active PSO creates a new version row;
the original stays for the patients already on it.

```ts
export const standingOrderTemplates = pgTable(
  'standing_order_templates',
  {
    id: text('id').primaryKey(), // SOT-RABIES-ESSEN-V2
    tenantId: text('tenant_id').notNull(),
    code: text('code').notNull(), // RABIES-ESSEN
    name: text('name').notNull(),
    description: text('description'),
    requiresPhysicianAuth: boolean('requires_physician_auth').notNull().default(false),
    version: integer('version').notNull().default(1),
    supersedesId: text('supersedes_id'), // NEW — previous version
    supersededById: text('superseded_by_id'), // NEW — newer version, if any
    isLocked: boolean('is_locked').notNull().default(false), // NEW — true once first PSO created
    isActive: boolean('is_active').notNull().default(true),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // ... standard
  },
  (t) => [uniqueIndex('sot_tenant_code_version_uniq').on(t.tenantId, t.code, t.version)],
)
```

The application logic is: any UPDATE to a locked template instead inserts a
new row with `version = old.version + 1`, `supersedes_id = old.id`, and
updates the old row's `superseded_by_id`. PSOs created against the old version
continue to use it.

`standing_order_template_items` is unchanged structurally; cascade delete
remains on template_id but the immutability pattern above means deletions are
rare.

#### `patient_standing_orders`

```ts
export const patientStandingOrders = pgTable('patient_standing_orders', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  patientId: text('patient_id').notNull(),
  templateId: text('template_id').notNull(),
  initiatingEncounterId: text('initiating_encounter_id'),
  authorizingProviderId: text('authorizing_provider_id'),
  status: standingOrderStatusEnum('status').notNull().default('Active'),
  startDate: date('start_date').notNull(), // CHANGED — date, not timestamptz
  endDate: date('end_date'), // CHANGED
  // Suspension/discontinuation symmetry
  suspendedAt: timestamp('suspended_at', { withTimezone: true }), // NEW
  suspendedById: text('suspended_by_id'), // NEW
  suspensionReason: text('suspension_reason'), // NEW
  resumedAt: timestamp('resumed_at', { withTimezone: true }), // NEW
  discontinuedAt: timestamp('discontinued_at', { withTimezone: true }),
  discontinuedById: text('discontinued_by_id'),
  discontinuationReason: text('discontinuation_reason'),
  notes: text('notes'),
  rowVersion: integer('row_version').notNull().default(0),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  // ... standard
})
```

Status changes flow into `patient_standing_orders_status_history` via trigger.

#### `clinical_orders`

The administration record. Lot identity, manufacturer, and dose volume at
administration time are now first-class fields.

```ts
export const clinicalOrders = pgTable(
  'clinical_orders',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    patientId: text('patient_id').notNull(), // NEW — denormalized for queries
    patientStandingOrderId: text('patient_standing_order_id'),
    serviceId: text('service_id').notNull(),
    encounterId: text('encounter_id'), // ordering encounter
    administeringEncounterId: text('administering_encounter_id'), // NEW — may differ
    orderType: clinicalOrderTypeEnum('order_type').notNull(),
    status: clinicalOrderStatusEnum('status').notNull().default('Scheduled'),
    // Scheduling
    originalScheduledDate: date('original_scheduled_date'), // CHANGED — date
    currentScheduledDate: date('current_scheduled_date'), // CHANGED — date
    // Order details
    doseNumberInSeries: integer('dose_number_in_series'), // RENAMED for clarity
    quantity: numeric('quantity', { precision: 6, scale: 2 }).notNull().default('1'),
    // Administration snapshots — populated when status -> Completed
    completedAt: timestamp('completed_at', { withTimezone: true }),
    administeredById: text('administered_by_id'), // NEW — who gave the dose
    documentedById: text('documented_by_id'), // RENAMED from completed_by_id
    lotId: text('lot_id'), // NEW — FK to inventory_lots
    manufacturerSnapshot: text('manufacturer_snapshot'), // NEW
    expiryDateSnapshot: date('expiry_date_snapshot'), // NEW
    doseVolumeMlActual: numeric('dose_volume_ml_actual', { precision: 6, scale: 2 }), // NEW
    administrationRoute: administrationRouteEnum('administration_route'),
    administrationSite: text('administration_site'),
    needleGauge: text('needle_gauge'), // NEW
    indication: text('indication'),
    // Reasons for non-completion
    refusalReason: text('refusal_reason'), // NEW
    deferralReason: text('deferral_reason'), // NEW
    // Idempotency
    idempotencyKey: text('idempotency_key'), // NEW
    notes: jsonb('notes'),
    rowVersion: integer('row_version').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // ... standard
  },
  (t) => [
    index('clinical_orders_scheduled_idx').on(t.tenantId, t.currentScheduledDate, t.status), // CHANGED ordering — date-first for "what's today"
    index('clinical_orders_pso_idx').on(t.patientStandingOrderId),
    index('clinical_orders_patient_idx').on(t.tenantId, t.patientId, t.completedAt),
    index('clinical_orders_lot_idx').on(t.tenantId, t.lotId), // for recalls
    uniqueIndex('clinical_orders_idem_uniq')
      .on(t.tenantId, t.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
  ],
)
```

The CHECK constraint enforcing P5 (immutability of completed orders) is added
via trigger:

```sql
CREATE TRIGGER trg_clinical_orders_immutable BEFORE UPDATE ON clinical_orders
FOR EACH ROW WHEN (OLD.status = 'Completed' AND OLD.deleted_at IS NULL)
EXECUTE FUNCTION reject_immutable_update();
```

#### `clinical_order_schedule_changes`

Captures the history of reschedules — every change to `current_scheduled_date`
appends a row.

```ts
export const clinicalOrderScheduleChanges = pgTable('clinical_order_schedule_changes', {
  // NEW
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  clinicalOrderId: text('clinical_order_id').notNull(),
  oldDate: date('old_date'),
  newDate: date('new_date').notNull(),
  reason: text('reason'),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  changedById: text('changed_by_id'),
})
```

Written by trigger on `clinical_orders` UPDATE when `current_scheduled_date`
changes.

#### `consents`

Generalized from the previous `consent_records` (which was 1:1 with clinical
orders only). The new model supports per-order consent, blanket consent (whole
protocol), and other consent types (telehealth, photography, research).

```ts
export const consents = pgTable(
  'consents',
  {
    // RENAMED + GENERALIZED
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    patientId: text('patient_id').notNull(),
    encounterId: text('encounter_id'),
    consentType: text('consent_type').notNull(), // Vaccination, Treatment, Telehealth,
    // Photography, Research, RecordsRelease
    scope: text('scope').notNull(), // SingleOrder, Protocol, Encounter, Standing
    // Polymorphic linkage to what's being consented to (clinical_order, PSO, encounter, ...)
    scopeRefType: text('scope_ref_type'),
    scopeRefId: text('scope_ref_id'),
    // Consenter
    consenterRelation: consenterRelationEnum('consenter_relation').notNull(),
    consenterName: text('consenter_name'), // when not the patient
    // Vaccine Information Statement (if applicable)
    visProvided: boolean('vis_provided'),
    visVersion: text('vis_version'),
    visDate: date('vis_date'),
    visLanguage: text('vis_language'),
    // Consent itself
    obtainedAt: timestamp('obtained_at', { withTimezone: true }).notNull(),
    obtainedById: text('obtained_by_id'), // staff who obtained
    consentLanguage: text('consent_language'),
    signatureAttachmentId: text('signature_attachment_id'), // FK to attachments
    witnessId: text('witness_id'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revocationReason: text('revocation_reason'),
    notes: text('notes'),
    // ... standard
  },
  (t) => [
    index('consents_patient_idx').on(t.tenantId, t.patientId),
    index('consents_scope_ref_idx').on(t.scopeRefType, t.scopeRefId),
  ],
)
```

#### `adverse_events`

Even a stub table is essential — VAERS-style reporting in PH is regulated.

```ts
export const adverseEvents = pgTable('adverse_events', {
  // NEW
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  patientId: text('patient_id').notNull(),
  clinicalOrderId: text('clinical_order_id'), // dose that caused it, if known
  encounterId: text('encounter_id'),
  reportedAt: timestamp('reported_at', { withTimezone: true }).notNull().defaultNow(),
  reportedById: text('reported_by_id'),
  onsetAt: timestamp('onset_at', { withTimezone: true }),
  severity: text('severity').notNull(), // Mild, Moderate, Severe, LifeThreatening, Fatal
  outcome: text('outcome'), // Recovered, Recovering, NotRecovered, Death, Unknown
  description: text('description').notNull(),
  symptomsCoded: jsonb('symptoms_coded'), // array of MedDRA codes if available
  treatmentGiven: text('treatment_given'),
  reportedToAuthorityAt: timestamp('reported_to_authority_at', { withTimezone: true }),
  authorityReferenceNumber: text('authority_reference_number'),
  // ... standard
})
```

---

### 4.5 Inventory & Traceability

Major additions: manufacturer at lot level, unit cost for COGS, NDC/CVX
linkage, and a separation of `inventory_movements` (the journal) from
`inventory_lot_balances` (the running totals) for performance.

```ts
export const inventoryLots = pgTable(
  'inventory_lots',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    branchId: text('branch_id').notNull(),
    locationId: text('location_id'), // NEW — which fridge/safe
    serviceId: text('service_id').notNull(),
    batchNumber: text('batch_number').notNull(),
    manufacturer: text('manufacturer').notNull(), // NEW — required for vaccines
    ndcCodeSnapshot: text('ndc_code_snapshot'), // NEW
    expiryDate: date('expiry_date').notNull(),
    receivedQuantity: numeric('received_quantity', { precision: 12, scale: 4 }).notNull(),
    unitCost: numeric('unit_cost', { precision: 12, scale: 4 }).notNull(), // NEW — for COGS
    costCurrency: text('cost_currency').notNull().default('PHP'), // NEW
    isQuarantined: boolean('is_quarantined').notNull().default(false),
    quarantineReason: text('quarantine_reason'),
    recallId: text('recall_id'), // NEW — FK to product_recalls if recalled
    supplierName: text('supplier_name'),
    supplierInvoiceNumber: text('supplier_invoice_number'), // NEW
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    receivedById: text('received_by_id'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // ... standard
  },
  (t) => [
    uniqueIndex('inventory_lots_batch_uniq').on(
      t.tenantId,
      t.branchId,
      t.serviceId,
      t.batchNumber,
      t.manufacturer,
    ),
    index('inventory_lots_fefo_idx').on(t.serviceId, t.branchId, t.expiryDate),
  ],
)
```

#### `inventory_movements`

Renamed from `inventory_transactions` (the word "transaction" is overloaded
with billing). Polymorphic reference is replaced with explicit nullable FKs to
the small set of legitimate referencers.

```ts
export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    // RENAMED
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    lotId: text('lot_id').notNull(),
    branchId: text('branch_id').notNull(),
    movementType: movementTypeEnum('movement_type').notNull(),
    quantityDelta: numeric('quantity_delta', { precision: 12, scale: 4 }).notNull(),
    // ^ signed: positive for In/Receive, negative for Out/Consume.
    // Convention enforced by CHECK: (movementType IN ('In','Adjustment') AND delta >= 0) OR
    //                                (movementType IN ('Out','Expire') AND delta <= 0)
    unitCostSnapshot: numeric('unit_cost_snapshot', { precision: 12, scale: 4 }), // NEW
    // Explicit references (one of these populated based on movementType)
    clinicalOrderId: text('clinical_order_id'), // CHANGED from polymorphic
    inventoryAdjustmentId: text('inventory_adjustment_id'),
    inventoryTransferId: text('inventory_transfer_id'),
    notes: text('notes'),
    performedById: text('performed_by_id').notNull(),
    performedAt: timestamp('performed_at', { withTimezone: true }).notNull().defaultNow(),
    // ... standard (note: movements are never updated, only inserted)
  },
  (t) => [
    index('inventory_movements_lot_time_idx').on(t.tenantId, t.lotId, t.performedAt),
    index('inventory_movements_clinical_idx')
      .on(t.clinicalOrderId)
      .where(sql`clinical_order_id IS NOT NULL`),
  ],
)
```

`inventory_lot_balances` is a materialized read model — running totals updated
by trigger on movement inserts. Discussed in §4.9.

#### `product_recalls`

```ts
export const productRecalls = pgTable('product_recalls', {
  // NEW
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  serviceId: text('service_id'),
  manufacturer: text('manufacturer'),
  affectedLotsPattern: text('affected_lots_pattern'), // regex or enumerated list
  recallReason: text('recall_reason').notNull(),
  recallSeverity: text('recall_severity').notNull(), // ClassI, ClassII, ClassIII
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  patientNotificationRequired: boolean('patient_notification_required').notNull().default(true),
  // ... standard
})
```

---

### 4.6 Billing, AR & Claims

Significant additions: a claims subsystem for HMO/Corporate payers, idempotency
on transactions, and stronger linkage between transaction items and inventory
lots for COGS tracking.

#### `transactions`

```ts
export const transactions = pgTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    branchId: text('branch_id').notNull(),
    patientId: text('patient_id').notNull(),
    encounterId: text('encounter_id'),
    cashierId: text('cashier_id'),
    cashDrawerSessionId: text('cash_drawer_session_id'), // NEW — links to drawer
    payerId: text('payer_id'),
    payerContractId: text('payer_contract_id'), // NEW
    status: transactionStatusEnum('status').notNull().default('Draft'),
    orNumber: text('or_number'),
    orSeriesId: text('or_series_id'), // NEW — which BIR receipt series
    // BIR discount fields
    discountIdType: discountIdTypeEnum('discount_id_type'),
    discountIdNumber: text('discount_id_number'),
    // Financials
    grossAmount: numeric('gross_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    discountAmount: numeric('discount_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    vatAmount: numeric('vat_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    vatRate: numeric('vat_rate', { precision: 5, scale: 4 }).notNull().default('0.12'), // NEW
    netAmount: numeric('net_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    amountPaid: numeric('amount_paid', { precision: 12, scale: 2 }).notNull().default('0'), // NEW
    amountOutstanding: numeric('amount_outstanding', { precision: 12, scale: 2 }) // NEW
      .notNull()
      .default('0'),
    // Prepayment
    isPrepayment: boolean('is_prepayment').notNull().default(false),
    appliedToTransactionId: text('applied_to_transaction_id'), // NEW — when applied
    prepaymentAppliedAt: timestamp('prepayment_applied_at', { withTimezone: true }),
    // Void / refund
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedById: text('voided_by_id'),
    voidReason: text('void_reason'),
    replacementTransactionId: text('replacement_transaction_id'), // NEW — void-and-rebill
    refundedFromTransactionId: text('refunded_from_transaction_id'), // NEW
    // Idempotency
    idempotencyKey: text('idempotency_key'), // NEW
    transactedAt: timestamp('transacted_at', { withTimezone: true }).notNull().defaultNow(),
    rowVersion: integer('row_version').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // ... standard
  },
  (t) => [
    uniqueIndex('transactions_tenant_or_uniq').on(t.tenantId, t.orNumber),
    uniqueIndex('transactions_idem_uniq')
      .on(t.tenantId, t.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
    index('transactions_branch_date_idx').on(t.tenantId, t.branchId, t.transactedAt),
  ],
)
```

Immutability trigger: once `status = 'Paid'`, the only allowed updates are
voiding (which sets `voided_at`), refund linkage, or marking `deleted_at`.

#### `transaction_items`

```ts
export const transactionItems = pgTable('transaction_items', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  transactionId: text('transaction_id').notNull(),
  serviceId: text('service_id').notNull(),
  clinicalOrderId: text('clinical_order_id'),
  lotId: text('lot_id'), // NEW — what was actually consumed
  quantity: numeric('quantity', { precision: 8, scale: 2 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
  unitCostSnapshot: numeric('unit_cost_snapshot', { precision: 12, scale: 4 }), // NEW — for COGS
  servicePriceId: text('service_price_id'), // NEW — which price row was used
  discountAmount: numeric('discount_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  isVatExempt: boolean('is_vat_exempt').notNull().default(false),
  vatAmount: numeric('vat_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  subtotal: numeric('subtotal', { precision: 12, scale: 2 }).notNull(),
  isPrepaid: boolean('is_prepaid').notNull().default(false),
  prepaidTransactionId: text('prepaid_transaction_id'),
  // ... standard
})
```

#### `payments`

Largely unchanged. Adds reconciliation status and external clearing time for
non-cash methods.

```ts
export const payments = pgTable('payments', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  transactionId: text('transaction_id').notNull(),
  cashDrawerSessionId: text('cash_drawer_session_id'), // NEW — for cash payments
  method: paymentMethodEnum('method').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  payerId: text('payer_id'),
  referenceNumber: text('reference_number'),
  externalProcessorFee: numeric('external_processor_fee', { precision: 12, scale: 2 }), // NEW
  reconciliationStatus: text('reconciliation_status').notNull().default('Pending'), // NEW
  clearedAt: timestamp('cleared_at', { withTimezone: true }), // NEW — when bank confirmed
  receivedById: text('received_by_id'),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  idempotencyKey: text('idempotency_key'), // NEW
  notes: text('notes'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  // ... standard
})
```

#### `claims`, `claim_items`, `claim_status_history`

The HMO/Corporate claims subsystem.

```ts
export const claims = pgTable(
  'claims',
  {
    // NEW
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    payerId: text('payer_id').notNull(),
    payerContractId: text('payer_contract_id'),
    patientId: text('patient_id').notNull(),
    encounterId: text('encounter_id'),
    transactionId: text('transaction_id'),
    claimNumber: text('claim_number').notNull(), // internal
    externalClaimNumber: text('external_claim_number'), // assigned by payer
    status: claimStatusEnum('status').notNull().default('Draft'),
    loaNumber: text('loa_number'), // Letter of Authorization
    loaIssuedAt: timestamp('loa_issued_at', { withTimezone: true }),
    loaExpiresAt: timestamp('loa_expires_at', { withTimezone: true }),
    diagnosesSnapshot: jsonb('diagnoses_snapshot'),
    totalBilled: numeric('total_billed', { precision: 12, scale: 2 }).notNull(),
    totalApproved: numeric('total_approved', { precision: 12, scale: 2 }),
    totalDenied: numeric('total_denied', { precision: 12, scale: 2 }),
    totalPaid: numeric('total_paid', { precision: 12, scale: 2 }),
    patientResponsibility: numeric('patient_responsibility', { precision: 12, scale: 2 }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    decisionAt: timestamp('decision_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    denialCode: text('denial_code'),
    denialReason: text('denial_reason'),
    appealNotes: text('appeal_notes'),
    rowVersion: integer('row_version').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // ... standard
  },
  (t) => [
    uniqueIndex('claims_tenant_number_uniq').on(t.tenantId, t.claimNumber),
    index('claims_payer_status_idx').on(t.tenantId, t.payerId, t.status),
  ],
)

export const claimItems = pgTable('claim_items', {
  // NEW
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  claimId: text('claim_id').notNull(),
  transactionItemId: text('transaction_item_id').notNull(),
  serviceCode: text('service_code'), // CPT or other
  diagnosisLinkPositions: jsonb('diagnosis_link_positions'), // [1,2] -> primary, secondary
  quantity: numeric('quantity', { precision: 8, scale: 2 }).notNull(),
  billedAmount: numeric('billed_amount', { precision: 12, scale: 2 }).notNull(),
  approvedAmount: numeric('approved_amount', { precision: 12, scale: 2 }),
  deniedAmount: numeric('denied_amount', { precision: 12, scale: 2 }),
  denialCode: text('denial_code'),
  // ... standard
})
```

---

### 4.7 Laboratory

Mostly unchanged from the current schema. Three additions: a specimen rejection
status, reference ranges as structured data, and critical-value flagging.

```ts
export const labOrders = pgTable('lab_orders', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  clinicalOrderId: text('clinical_order_id').notNull(),
  laboratoryId: text('laboratory_id'),
  status: labOrderStatusEnum('status').notNull().default('Pending'),
  // ^ enum extended: 'Rejected' added
  externalOrderId: text('external_order_id'), // NEW
  collectedAt: timestamp('collected_at', { withTimezone: true }), // NEW
  collectedById: text('collected_by_id'), // NEW
  sentAt: timestamp('sent_at', { withTimezone: true }),
  resultReceivedAt: timestamp('result_received_at', { withTimezone: true }),
  rejectionReason: text('rejection_reason'), // NEW
  hasCriticalValue: boolean('has_critical_value').notNull().default(false), // NEW
  criticalValueAcknowledgedAt: timestamp('critical_value_acknowledged_at', { withTimezone: true }),
  criticalValueAcknowledgedById: text('critical_value_acknowledged_by_id'),
  resultData: jsonb('result_data'), // structured: array of { code, value, unit, refRange, flag }
  resultFileAttachmentId: text('result_file_attachment_id'), // CHANGED — FK to attachments
  notes: text('notes'),
  // ... standard
})
```

---

### 4.8 System, Security & Audit

This domain gains the most net-new tables: a generic attachments store, PHI
read-access logging, a domain events outbox, and notification templating.

#### `attachments`

Generic file storage referenced by anything (consent signatures, lab results,
ID photos, prescription images, insurance cards). Polymorphic owner with
type whitelist enforced by CHECK.

```ts
export const attachments = pgTable(
  'attachments',
  {
    // NEW
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    ownerType: text('owner_type').notNull(),
    // CHECK: owner_type IN ('patient','encounter','clinical_order','consent','lab_order','claim',...)
    ownerId: text('owner_id').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageBackend: text('storage_backend').notNull(), // s3, azure_blob, local
    storageKey: text('storage_key').notNull(),
    contentHashSha256: text('content_hash_sha256').notNull(),
    isEncrypted: boolean('is_encrypted').notNull().default(true),
    category: text('category'), // ConsentSignature, LabResult, PatientId, ...
    metadata: jsonb('metadata'),
    uploadedById: text('uploaded_by_id'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('attachments_owner_idx').on(t.tenantId, t.ownerType, t.ownerId)],
)
```

#### `audit_logs`

Retained, partitioned by month, with action enum extended.

```ts
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id'),
    sessionId: text('session_id'), // NEW — links to user_sessions
    correlationId: text('correlation_id'), // NEW — request/operation correlation
    action: auditActionEnum('action').notNull(), // EXPANDED
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    branchId: text('branch_id'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    changes: jsonb('changes'),
    metadata: jsonb('metadata'), // NEW — beyond before/after
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_entity_idx').on(t.tenantId, t.entityType, t.entityId),
    index('audit_logs_user_time_idx').on(t.tenantId, t.userId, t.timestamp),
    index('audit_logs_correlation_idx')
      .on(t.correlationId)
      .where(sql`correlation_id IS NOT NULL`),
  ],
)
```

Partitioning: `PARTITION BY RANGE (timestamp)`, monthly partitions created
ahead of time by maintenance job.

#### `phi_access_log`

Distinct from `audit_logs` because read access to patient records is too
high-volume to mix with mutation logs and has different retention rules.

```ts
export const phiAccessLog = pgTable(
  'phi_access_log',
  {
    // NEW
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    sessionId: text('session_id'),
    patientId: text('patient_id').notNull(),
    accessType: text('access_type').notNull(), // View, Search, Export, Print
    accessReason: text('access_reason'), // For break-glass scenarios
    isBreakGlass: boolean('is_break_glass').notNull().default(false),
    contextEntityType: text('context_entity_type'), // viewing patient via what entity
    contextEntityId: text('context_entity_id'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('phi_access_user_time_idx').on(t.tenantId, t.userId, t.timestamp),
    index('phi_access_patient_idx').on(t.tenantId, t.patientId, t.timestamp),
    index('phi_access_breakglass_idx')
      .on(t.tenantId, t.timestamp)
      .where(sql`is_break_glass = true`),
  ],
)
```

Also partitioned by month.

#### `domain_events` (outbox)

Decouples writes from downstream effects (notifications, integrations,
analytics ingestion).

```ts
export const domainEvents = pgTable(
  'domain_events',
  {
    // NEW
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    eventType: text('event_type').notNull(), // ClinicalOrderCompleted, TransactionPaid, ...
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    payload: jsonb('payload').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishAttempts: integer('publish_attempts').notNull().default(0),
    lastPublishError: text('last_publish_error'),
  },
  (t) => [
    index('domain_events_unpublished_idx')
      .on(t.tenantId, t.occurredAt)
      .where(sql`published_at IS NULL`),
  ],
)
```

Inserted in the same transaction as the state change. A separate worker reads
unpublished rows and dispatches them.

#### `notifications` and `notification_templates`

```ts
export const notificationTemplates = pgTable(
  'notification_templates',
  {
    // NEW
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    code: text('code').notNull(), // DoseReminder24h, AppointmentConfirmation, etc.
    channel: notificationChannelEnum('channel').notNull(),
    language: text('language').notNull().default('en'),
    subject: text('subject'),
    body: text('body').notNull(), // with {{placeholders}}
    isActive: boolean('is_active').notNull().default(true),
    // ... standard
  },
  (t) => [
    uniqueIndex('notification_templates_tenant_code_lang_uniq').on(
      t.tenantId,
      t.code,
      t.channel,
      t.language,
    ),
  ],
)

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  templateId: text('template_id'), // NEW
  patientId: text('patient_id'),
  userId: text('user_id'),
  channel: notificationChannelEnum('channel').notNull(),
  recipientAddress: text('recipient_address').notNull(), // NEW — phone or email actually used
  subject: text('subject'),
  body: text('body').notNull(),
  status: notificationStatusEnum('status').notNull().default('Queued'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }), // NEW
  readAt: timestamp('read_at', { withTimezone: true }), // NEW (push channels)
  externalMessageId: text('external_message_id'), // NEW
  retryCount: integer('retry_count').notNull().default(0), // NEW
  failureReason: text('failure_reason'),
  consentVerifiedAt: timestamp('consent_verified_at', { withTimezone: true }), // NEW
  metadata: jsonb('metadata'),
  // ... standard
})
```

#### `feature_flags`

Unique-index NULL handling fixed.

```ts
export const featureFlags = pgTable(
  'feature_flags',
  {
    // ... unchanged columns
  },
  (t) => [
    uniqueIndex('feature_flags_uniq').on(
      t.tenantId,
      sql`COALESCE(${t.branchId}, '__TENANT_WIDE__')`,
      t.featureName,
    ),
  ],
)
```

#### `approval_requests`

Adds expiration and multi-step support.

```ts
export const approvalRequests = pgTable('approval_requests', {
  // ... existing columns
  expiresAt: timestamp('expires_at', { withTimezone: true }), // NEW
  requiredApprovers: integer('required_approvers').notNull().default(1), // NEW
  approverRole: userRoleEnum('approver_role'), // NEW — who's allowed to approve
})

export const approvalDecisions = pgTable('approval_decisions', {
  // NEW
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  approvalRequestId: text('approval_request_id').notNull(),
  decision: text('decision').notNull(), // Approved, Rejected
  decidedById: text('decided_by_id').notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  notes: text('notes'),
})
```

#### Status history tables

Created via migration for each table with a status enum:

- `patient_standing_orders_status_history`
- `clinical_orders_status_history`
- `encounters_status_history`
- `transactions_status_history`
- `claims_status_history`
- `lab_orders_status_history`
- `appointments_status_history`

All follow the same shape:

```ts
{
  id, tenantId, entityId, fromStatus, toStatus, reason,
  changedAt, changedById, metadata jsonb
}
```

Maintained automatically via trigger on the source table.

---

### 4.9 Analytics & Reporting Layer

Analytics is its own concern with its own schema (`analytics` Postgres
schema, separate from `public`). Two strategies coexist: materialized views
for queries with predictable shapes, and aggregate tables for rollups that
need to be updated incrementally.

#### Why separate

Running `SELECT branch_id, date_trunc('day', transacted_at), SUM(net_amount)
FROM transactions GROUP BY 1, 2` against the OLTP table works fine for the
first six months and becomes a production incident around month nine. The
analytics layer protects OLTP queries from analytical workloads, lets you
denormalize aggressively without polluting the operational schema, and gives
you a stable contract for BI tools.

#### Read models (running balances)

Some "analytics" are actually operational and need to be up-to-the-second.
These are kept as triggered tables in the operational schema:

```ts
export const inventoryLotBalances = pgTable('inventory_lot_balances', {
  // NEW
  lotId: text('lot_id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  branchId: text('branch_id').notNull(),
  serviceId: text('service_id').notNull(),
  quantityOnHand: numeric('quantity_on_hand', { precision: 12, scale: 4 }).notNull(),
  quantityReserved: numeric('quantity_reserved', { precision: 12, scale: 4 })
    .notNull()
    .default('0'),
  quantityAvailable: numeric('quantity_available', { precision: 12, scale: 4 }).notNull(),
  lastMovementAt: timestamp('last_movement_at', { withTimezone: true }),
  weightedAverageCost: numeric('weighted_average_cost', { precision: 12, scale: 4 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

Updated by trigger on `inventory_movements`.

#### Fact tables (in `analytics` schema)

Refreshed by a scheduled job (every N minutes for hot data, nightly for cold).
Conventionally append-only with a refresh timestamp.

```ts
// analytics.fact_doses_administered
{
  id, tenantId, branchId, providerId, patientId, serviceId, lotId,
  cvxCode, manufacturer, doseNumberInSeries,
  scheduledDate, administeredDate, administeredAt,
  isOnTime,                  // computed: administered_date <= scheduled_date + grace
  isFromStandingOrder,
  encounterId, claimId,
  createdAt, refreshedAt,
}

// analytics.fact_revenue
{
  id, tenantId, branchId, transactionId, transactionItemId, encounterId,
  patientId, serviceId, payerId, payerType, cashierId, cashDrawerSessionId,
  transactedDate, transactedAt,
  quantity, unitPrice, unitCost, grossAmount, discountAmount, vatAmount,
  netAmount, cogsAmount, marginAmount,
  isVoided, isRefunded,
  refreshedAt,
}

// analytics.fact_inventory_movements (mirrors operational table, denormalized)
{
  id, tenantId, branchId, lotId, serviceId, manufacturer,
  movementType, movementDate, quantityDelta,
  unitCostSnapshot, costImpact,
  expiryDate, daysToExpiryAtMovement,
  refreshedAt,
}

// analytics.fact_appointment_outcomes
{
  id, tenantId, branchId, providerId, patientId,
  scheduledDate, appointmentType,
  status, // Completed, NoShow, Cancelled, ...
  waitMinutes, durationMinutes, // computed from check-in/out events
  refreshedAt,
}
```

#### Dimension tables

```ts
// analytics.dim_date — populated for ~10 years
{
  ;(date, year, quarter, month, monthName, dayOfWeek, isWeekend, isHoliday, fiscalPeriod)
}

// analytics.dim_service — slowly-changing snapshot of service_catalog
{
  ;(serviceId, code, name, serviceType, cvxCode, validFrom, validTo, isCurrent)
}

// analytics.dim_user — slowly-changing snapshot
// analytics.dim_patient — slowly-changing snapshot (with PHI minimization)
```

#### Daily rollup tables

For fast dashboards, pre-aggregated rollups are maintained:

```ts
// analytics.rollup_daily_branch_revenue
{
  tenantId, branchId, transactedDate,
  transactionCount, grossAmount, discountAmount, vatAmount, netAmount,
  cashAmount, gcashAmount, mayaAmount, cardAmount, hmoAmount,  // by method
  newPatientCount, returningPatientCount,
  refreshedAt,
}
PRIMARY KEY (tenantId, branchId, transactedDate);

// analytics.rollup_daily_doses_by_service
{ tenantId, branchId, serviceId, administeredDate, doseCount, refreshedAt }
PRIMARY KEY (tenantId, branchId, serviceId, administeredDate);

// analytics.rollup_monthly_provider_productivity
{ tenantId, providerId, monthStart,
  encounterCount, completedDoseCount, averageEncounterMinutes, refreshedAt }
```

Refresh strategy: incremental upserts driven by `domain_events` rather than
full recomputes. The events table is the source of truth for "what changed
since the last refresh."

#### Materialized views for ad-hoc analysis

Where the query shape is unstable (early product, exploratory dashboards),
materialized views are cheaper than maintained rollups:

```sql
CREATE MATERIALIZED VIEW analytics.mv_patient_protocol_completion AS
SELECT
  pso.tenant_id, pso.patient_id, pso.template_id,
  pso.start_date, pso.status,
  COUNT(co.id) FILTER (WHERE co.status = 'Completed') AS doses_completed,
  COUNT(co.id) AS doses_scheduled,
  ...
FROM patient_standing_orders pso
LEFT JOIN clinical_orders co ON co.patient_standing_order_id = pso.id
GROUP BY pso.id;

CREATE UNIQUE INDEX ON analytics.mv_patient_protocol_completion (tenant_id, patient_id, template_id);
-- Refresh: REFRESH MATERIALIZED VIEW CONCURRENTLY ... on schedule.
```

#### Display layer

The application has dedicated query modules per dashboard, hitting analytics
tables exclusively. They never join to OLTP. This makes it possible to scale
analytics independently (read replica, dedicated instance) without
restructuring application code.

---

## 5. Migration Path from Current Schema

A complete migration would touch nearly every table. The approach below
sequences changes to minimize risk and avoid long-running locks.

**Phase 1: Additive, no behavior change.** Add the new columns with
nullable/default values. Add new tables empty. Add composite tenant FKs (these
require new unique indexes first). No code changes required; existing queries
keep working.

- New columns: `row_version`, `idempotency_key`, `mrn`, `lot_id` on
  clinical_orders, manufacturer/cost on inventory_lots, etc.
- New tables: `appointments`, `attachments`, `claims`, `claim_items`,
  `phi_access_log`, `domain_events`, `service_prices`, `user_branches`,
  `user_roles`, `patient_allergies`, `patient_conditions`, status history
  tables, analytics schema.
- Backfill: copy `branch_id`/`role` from `users` into `user_branches`/
  `user_roles`. Copy `service_catalog.basePrice` into a default
  `service_prices` row per service (no branch, no payer, effective from
  -infinity). Copy patient `allergies` JSONB into `patient_allergies` rows.

**Phase 2: Triggers and read-side switchover.** Install triggers for
`updated_at`, status history, schedule changes, and inventory balance
maintenance. Switch read paths to use the new tables (still also writing to
old). Application reads from `service_prices` instead of
`service_catalog.basePrice`; reads roles from `user_roles`.

**Phase 3: Write-side switchover.** Stop writing to the old columns. The
`service_catalog.basePrice` becomes informational only. The single `branch_id`
on `users` becomes the _primary_ branch hint for UI, while authorization uses
`user_branches`.

**Phase 4: Cleanup.** Drop deprecated columns. Apply CHECK constraints for ID
formats. Apply immutability triggers on completed transactions and clinical
orders. Apply exclusion constraints on `service_prices` ranges and
`appointments` provider scheduling.

**Phase 5: Operational hardening.** Stand up partitioning maintenance for
audit and PHI access logs. Configure analytics refresh schedule. Document
break-glass procedures. Run RLS policy review with composite FKs in place.

Each phase can ship independently with feature flags gating new behavior.

---

## 6. Open Questions for Future Consideration

These are decisions that depend on business context and should not be
schema'd speculatively. Track them; revisit when the corresponding business
question becomes concrete.

### Multi-tenancy & scaling

- **Multi-tenant deployment model.** Single Postgres database with RLS
  (current design) versus database-per-tenant for largest customers. The
  schema as-designed supports either, but operational tooling differs.
- **Cross-tenant data sharing.** Will you ever need to share reference data
  (e.g., a national vaccine catalog, drug interactions database) across
  tenants? If yes, a `global` schema may be warranted.
- **Region-aware deployment.** If serving multiple Southeast Asian markets,
  data residency requirements may force tenant pinning to specific
  regions/databases. Schema is unaffected; deployment topology is.

### Clinical depth

- **Drug interaction and allergy decision support.** Will the system warn
  clinicians about contraindications at order time? If yes, you need a
  `drug_interactions` reference table (likely licensed from a third party)
  and integration into the order-creation flow.
- **Clinical pathways beyond standing orders.** Standing orders cover
  protocol-driven sequences. Care plans (multi-week, multi-modal) need a
  more flexible structure (`care_plans` with phases and conditional
  branches).
- **Telehealth.** Does an encounter need a `modality` (in_person, video,
  phone)? Does it need links to recording artifacts? Does consent need a
  separate type for telehealth?
- **Imaging and DICOM.** If radiology is in scope, you need a parallel
  subsystem for imaging studies, separate from `lab_orders`.

### Patient experience

- **Patient portal accounts.** Are patients themselves users of the system?
  If yes, `patients` and `users` need linking, and a new permission model
  governs what patients can see/do (typically read-only on their own data).
- **Family/household grouping.** Is there a `households` table for
  parent-child relationships, shared insurance, billing-to-guardian flows?
- **Communication preferences beyond opt-in flags.** Quiet hours, preferred
  contact times, preferred language per channel — all defer.
- **Loyalty / membership programs.** Points, tiers, recurring billing for
  membership plans — entirely deferred until business model is clear.

### Inventory & supply chain

- **Multi-location inventory transfers in transit.** When a lot moves from
  Branch A to Branch B, is there a window where it's "in transit" with its
  own balance? Likely yes for a chain of any size.
- **Supplier/vendor master.** A normalized `suppliers` table with terms,
  contacts, and payable invoicing — deferred but easy to add.
- **Expiry alerting and forecasting.** Beyond passive expiry tracking,
  predictive alerts ("at current usage, this lot will expire with 200 doses
  remaining"). Reporting query, not schema.
- **Cold-chain monitoring.** If integrating with fridge sensors,
  `cold_chain_readings` linked to `locations` of type `Fridge`. Will need
  high-volume time-series storage; consider TimescaleDB or external store.

### Billing & payments

- **Double-entry general ledger.** For real accounting integration, a
  `journal_entries` + `journal_lines` model rather than the current
  transactions/payments view. Likely needed at the third or fourth branch.
- **Recurring billing / subscriptions.** Membership plans, payment plans for
  expensive treatments. Schema additions: `billing_schedules`,
  `scheduled_charges`.
- **Refunds with method-specific flows.** Cash refunds vs reverse-card vs
  HMO chargebacks have different operational shapes. Currently all flow
  through `transactions` with `refundedFromTransactionId`, which works but
  may need specialization.
- **Multi-currency.** All amounts are PHP-implied. If serving multiple
  countries, every monetary column needs an explicit `currency` and you need
  exchange rate tables.

### HMO & claims

- **Prior authorization workflow.** Pre-encounter benefit verification with
  the payer. Adds `prior_authorizations` table and links into appointments.
- **Capitation contracts.** Some PH HMOs pay per-member-per-month rather
  than per-claim. Capitation requires an entirely different revenue model
  (subscription-style).
- **Claim attachment requirements.** Payers often require specific
  documentation (lab results, imaging) attached to claims. The
  `attachments` table covers storage; the workflow of "this claim needs
  these attachment types" is a per-payer rule that defers.
- **Electronic claim submission.** EDI 837 generation, X12 acknowledgments,
  ERA (835) parsing for payment posting. Schema is fine; this is integration
  work.

### Reporting & compliance

- **PIDSR / IIS reporting.** Philippine PIDSR (Philippine Integrated Disease
  Surveillance and Response) reporting may be required. Format and triggers
  differ by disease. Can be implemented as scheduled exports from analytics
  fact tables; no schema changes needed if vaccine and adverse event data
  are captured well.
- **DOH / FDA regulatory reports.** Periodic reporting of inventory,
  controlled substances, vaccine usage. Driven by analytics layer.
- **Quality metrics.** HEDIS-style or local equivalent measures. Aggregate
  metrics layer is the right home; the source data is already captured.
- **Patient consent for research / data use.** Distinct from clinical
  consent. May need a separate `research_consents` table if the clinic
  participates in studies.

### Operational

- **Appointment booking via patient portal or marketplace integration.**
  External booking systems writing to `appointments` need a clear contract
  (idempotency, slot reservation atomicity). Schema-ready.
- **Wait time tracking.** Check-in to seen-by-provider duration. Could be
  inferred from `appointments.status` transitions if those carry timestamps.
- **Provider productivity and compensation.** RVU-style metrics, commission
  rules, payroll integration. Almost entirely a reporting concern.
- **Quality improvement workflows.** Incident reporting, root cause
  analyses, corrective action tracking. Probably its own subsystem (3-5
  tables) when needed.

### Security & privacy

- **End-to-end encryption of specific PHI fields.** Field-level encryption
  (e.g., on diagnoses, conditions) for stronger DPA posture. Adds complexity
  to indexing and search. Defer until risk assessment requires it.
- **Patient access requests (DSAR).** Tooling for fulfilling DPA "right to
  access" and "right to deletion" requests. Schema-ready (deletion fields
  exist on patients); workflow tooling deferred.
- **Audit log immutability via hash chaining.** For tamper-evident audit
  logs, each row hashes the prior row. Adds write complexity; defer until
  certification or regulator asks.
- **Anomaly detection on PHI access.** Detecting unusual access patterns
  (one user looking up too many patients in too short a time). Analytics
  layer over `phi_access_log`; not a schema change.

### Internationalization

- **Multilingual content.** Service names, notification templates, consent
  forms in multiple languages. The notification template model already
  supports `language`; service names would need a translations side-table.
- **Locale-specific clinical coding.** ICD-10-PH variants, local drug
  formularies. Reference data, not schema.

### Integration

- **HL7 FHIR interoperability.** If exchanging records with other systems,
  a FHIR mapping layer is needed. Doesn't change the schema; adds a
  serialization concern.
- **Lab integrations beyond manual entry.** HL7 ORU/ORM messaging for
  bidirectional lab orders. Already supported structurally; integration
  work.
- **Wearable / IoT vitals ingestion.** If patients submit home BP readings,
  `encounter_vitals` may need an `is_self_reported` flag and a separate
  ingestion path.
