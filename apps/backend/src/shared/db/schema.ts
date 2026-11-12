// Drizzle schema — SureVax CMS v2.0
// All tenant-scoped tables carry tenant_id. Phase 1 = single tenant (hardcoded).
// Phase 2 = dynamic resolution. RLS policies enforced in supplemental SQL.

import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgSchema,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Custom types
// ---------------------------------------------------------------------------

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector'
  },
})

const jsonb = customType<{ data: unknown }>({
  dataType() {
    return 'jsonb'
  },
})

// CITEXT: case-insensitive text type (installed via 0025_modern_pg_features.sql).
// Use for email columns so uniqueness checks are case-insensitive at the DB level.
// Drizzle treats it as a plain string at the application layer — no cast needed in queries.
const citext = customType<{ data: string }>({
  dataType() {
    return 'citext'
  },
})

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

// NOTE: 'TenantAdmin' added via supplemental SQL (ALTER TYPE user_role ADD VALUE 'TenantAdmin').
// 'SuperAdmin' kept for back-compat — Postgres cannot remove enum values without recreating the type.
// New code should use 'TenantAdmin' instead of 'SuperAdmin'.
export const userRoleEnum = pgEnum('user_role', [
  'SuperAdmin',
  'TenantAdmin',
  'BranchAdmin',
  'Physician',
  'Nurse',
  'Cashier',
  'Branch',
])

export const sexEnum = pgEnum('sex', ['Male', 'Female', 'Other'])

export const serviceTypeEnum = pgEnum('service_type', [
  'Vaccine',
  'Consultation',
  'Lab',
  'Procedure',
  'Product',
])

export const encounterSpecialtyEnum = pgEnum('encounter_specialty', [
  'Rabies',
  'Flu',
  'Vaccination',
  'General',
])

// NOTE: additional values 'CheckedIn', 'Triage', 'OnHold', 'NoShow' added via supplemental SQL ALTER TYPE — keep in sync if generating fresh.
export const encounterStatusEnum = pgEnum('encounter_status', [
  'Open',
  'InProgress',
  'Completed',
  'Cancelled',
])

export const standingOrderStatusEnum = pgEnum('standing_order_status', [
  'Active',
  'Completed',
  'Discontinued',
  'Suspended',
])

export const clinicalOrderTypeEnum = pgEnum('clinical_order_type', [
  'Standing_Order',
  'Ad_Hoc',
  'STAT',
])

// NOTE: additional values 'Deferred', 'Refused' added via supplemental SQL ALTER TYPE — keep in sync if generating fresh.
export const clinicalOrderStatusEnum = pgEnum('clinical_order_status', [
  'Scheduled',
  'Pending',
  'Completed',
  'Missed',
  'Cancelled',
])

// NOTE: additional value 'PartiallyPaid' added via supplemental SQL ALTER TYPE — keep in sync if generating fresh.
export const transactionStatusEnum = pgEnum('transaction_status', [
  'Draft',
  'Pending',
  'Paid',
  'Voided',
  'Refunded',
])

export const paymentMethodEnum = pgEnum('payment_method', [
  'Cash',
  'GCash',
  'Maya',
  'BankTransfer',
  'Card',
  'PayMongo',
  'HMO',
  'Corporate',
  'Other',
  // Internal: a draw-down against a patient's prepaid credit/deposit. Carries
  // no external cash; the funding cash was collected on the source deposit
  // transaction (see payments.funded_by_transaction_id). Excluded from cash
  // drawer reconciliation; settled immediately (reconciliation_status='Cleared').
  'Credit',
])

export const payerTypeEnum = pgEnum('payer_type', ['HMO', 'Corporate', 'Government', 'Promo'])

export const discountIdTypeEnum = pgEnum('discount_id_type', ['OSCA', 'PWD', 'Other'])

export const movementTypeEnum = pgEnum('movement_type', [
  'In',
  'Out',
  'Adjustment',
  'Transfer',
  'Expire',
])

export const labOrderStatusEnum = pgEnum('lab_order_status', [
  'Pending',
  'Sent',
  'ResultReceived',
  'Cancelled',
])

export const notificationChannelEnum = pgEnum('notification_channel', ['SMS', 'Email', 'Push'])

export const notificationStatusEnum = pgEnum('notification_status', [
  'Queued',
  'Sent',
  'Failed',
  'Cancelled',
])

// audit_action: trimmed/extended for ID redesign (W1.B). Keep in sync with
// the enum baked into `0000_initial.sql`. `READ` dropped (phi_access_log handles
// reads); LOGIN_FAILED + BREAK_GLASS added for security ops; EXPORT/PRINT/
// AUDIT_ACCESS added for PHI provenance; PERMISSION_CHANGE/CONFIG_CHANGE added
// for admin ops.
export const auditActionEnum = pgEnum('audit_action', [
  'CREATE',
  'UPDATE',
  'DELETE',
  'LOGIN',
  'LOGOUT',
  'LOGIN_FAILED',
  'BREAK_GLASS',
  'CROSS_BRANCH_ACCESS',
  'TRANSACTION_MODIFY',
  'SCHEDULE_CHANGE',
  'PERMISSION_CHANGE',
  'CONFIG_CHANGE',
  'EXPORT',
  'PRINT',
  'AUDIT_ACCESS',
])

export const approvalRequestTypeEnum = pgEnum('approval_request_type', [
  'void_transaction',
  'inventory_adjustment',
  'schedule_change',
  'discount_override',
  'patient_erasure',
  'emergency_access',
])

export const approvalStatusEnum = pgEnum('approval_status', ['Pending', 'Approved', 'Rejected'])

export const userStatusEnum = pgEnum('user_status', [
  'Active',
  'Inactive',
  'Locked',
  'PendingActivation',
])

// NOTE: 'INF' (wound infiltration, for ERIG/HRIG) added via ALTER TYPE in
// 0010_products_categories_bundles.sql — keep in sync if regenerating fresh.
export const administrationRouteEnum = pgEnum('administration_route', [
  'IM',
  'SC',
  'ID',
  'IV',
  'PO',
  'IN',
  'Topical',
  'INF',
])

export const externalImmunizationDatePrecisionEnum = pgEnum(
  'external_immunization_date_precision',
  ['Exact', 'Estimated', 'Unknown'],
)

export const consenterRelationEnum = pgEnum('consenter_relation', [
  'Patient',
  'Parent',
  'Guardian',
  'Spouse',
  'Caregiver',
  'Other',
])

export const claimStatusEnum = pgEnum('claim_status', [
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
  'Open',
  'Closed',
  'Reconciled',
  'Discrepancy',
])

// ---------------------------------------------------------------------------
// Domain 0 — Tenants (root; Phase 1 = single row)
// ---------------------------------------------------------------------------

export const tenants = pgTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  timezone: text('timezone').notNull().default('Asia/Manila'),
  countryCode: text('country_code').notNull().default('PH'),
  retentionPolicy: jsonb('retention_policy'),
  settings: jsonb('settings'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// tenant_counters — gapless monotonic sequence allocator.
// Each row holds the current value for one counter scoped to
// (tenant_id, branch_id, counter_kind). branch_id is nullable for
// tenant-wide counters (e.g. BIR_RECEIPT issued centrally) and set
// for per-branch counters (e.g. TXN sequence by branch). Allocate via
// SELECT … FOR UPDATE inside withTenantTx — see
// apps/backend/src/shared/db/counters.ts.
export const tenantCounters = pgTable(
  'tenant_counters',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: bigint('branch_id', { mode: 'number' }),
    counterKind: text('counter_kind').notNull(),
    currentValue: bigint('current_value', { mode: 'number' }).notNull().default(0),
    rowVersion: integer('row_version').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // PK enforced in 0012_tenant_counters.sql via partial unique indexes
    // (branch_id can be NULL — composite PK with NULL is allowed but
    // Postgres treats NULL as not-equal, so we use two partial uniques).
    index('tenant_counters_tenant_kind_idx').on(t.tenantId, t.counterKind),
    index('tenant_counters_tenant_branch_kind_idx').on(t.tenantId, t.branchId, t.counterKind),
  ],
)

// ---------------------------------------------------------------------------
// Domain 1 — Multi-Tenancy & Access
// ---------------------------------------------------------------------------

// 1. branches
export const branches = pgTable(
  'branches',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    address: text('address'),
    city: text('city'),
    province: text('province'),
    contactNumber: text('contact_number'),
    email: text('email'),
    isActive: boolean('is_active').notNull().default(true),
    timezone: text('timezone'),
    settings: jsonb('settings'),
    rowVersion: integer('row_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // Self-referential via users (circular): FK added in 0000_initial.sql
    createdById: bigint('created_by_id', { mode: 'number' }),
  },
  (t) => [
    uniqueIndex('branches_tenant_code_idx').on(t.tenantId, t.code),
    uniqueIndex('branches_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

// 2. users
export const users = pgTable(
  'users',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    // citext: case-insensitive (uniqueness enforced case-insensitively at DB level via 0025)
    email: citext('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    pinHash: text('pin_hash'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    licenseNumber: text('license_number'),
    licenseType: text('license_type'),
    licenseExpiresAt: date('license_expires_at'),
    isActive: boolean('is_active').notNull().default(true),
    canLogin: boolean('can_login').notNull().default(true),
    preferredName: text('preferred_name'),
    status: userStatusEnum('status').notNull().default('Active'),
    // primaryBranchId: FK added in 0000_initial.sql (forward ref to branches)
    primaryBranchId: bigint('primary_branch_id', { mode: 'number' }),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    mfaSecretEncrypted: text('mfa_secret_encrypted'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    rowVersion: integer('row_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // Self-reference: FK added in 0000_initial.sql
    createdById: bigint('created_by_id', { mode: 'number' }),
  },
  (t) => [
    uniqueIndex('users_tenant_email_idx').on(t.tenantId, t.email),
    index('users_tenant_primary_branch_idx').on(t.tenantId, t.primaryBranchId),
    uniqueIndex('users_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

// 2b. refresh_tokens — server-side refresh-token rotation w/ family revocation
// No display_id: opaque token table; `jti` is the natural lookup key.
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jti: text('jti').notNull().unique(),
    familyId: text('family_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    // Self-reference: FK added in 0000_initial.sql
    replacedById: bigint('replaced_by_id', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('refresh_tokens_user_jti_idx').on(t.userId, t.jti),
    index('refresh_tokens_family_idx').on(t.familyId),
  ],
)

// 3. staff_time_logs
export const staffTimeLogs = pgTable(
  'staff_time_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // TLG_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branches.id),
    clockInAt: timestamp('clock_in_at', { withTimezone: true }).notNull(),
    clockOutAt: timestamp('clock_out_at', { withTimezone: true }),
    totalHours: numeric('total_hours', { precision: 6, scale: 2 }),
    notes: text('notes'),
    rowVersion: integer('row_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id),
  },
  (t) => [
    index('staff_time_logs_user_idx').on(t.tenantId, t.userId, t.clockInAt),
    uniqueIndex('staff_time_logs_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

// ---------------------------------------------------------------------------
// Domain 2 — Patient Registry
// ---------------------------------------------------------------------------

// 4. patients
export const patients = pgTable(
  'patients',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // PAT_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    // mrn: per-tenant sequential, allocated via nextval('mrn_seq_<slug>').
    // Format MRN-NNNNNN; unique per (tenant_id, mrn).
    mrn: text('mrn').notNull(),
    homeBranchId: bigint('home_branch_id', { mode: 'number' }).references(() => branches.id),
    // Demographics
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    middleName: text('middle_name'),
    suffix: text('suffix'),
    dateOfBirth: date('date_of_birth'),
    sex: sexEnum('sex'),
    civilStatus: text('civil_status'),
    nationality: text('nationality'),
    address: text('address'),
    region: text('region'),
    province: text('province'),
    city: text('city'),
    barangay: text('barangay'),
    contactNumber: text('contact_number'),
    // citext: case-insensitive (type changed via 0025_modern_pg_features.sql)
    email: citext('email'),
    preferredLanguage: text('preferred_language').notNull().default('en'),
    smsOptIn: boolean('sms_opt_in').notNull().default(false),
    emailOptIn: boolean('email_opt_in').notNull().default(false),
    // Guardian (for minors)
    guardianName: text('guardian_name'),
    guardianRelationship: text('guardian_relationship'),
    guardianContact: text('guardian_contact'),
    // Medical — see patient_allergies / patient_conditions tables (Phase 4: dropped JSONB columns)
    // Insurance
    insuranceProvider: text('insurance_provider'),
    insurancePolicyNumber: text('insurance_policy_number'),
    // Onboarding
    onboardingData: jsonb('onboarding_data'),
    // Onboarding channel — how the patient was acquired ("lead source"), single-valued.
    // The allowed value set is validated by Zod (ONBOARDING_CHANNELS) at the API
    // boundary — the single source of truth — rather than a DB enum, so the list can
    // grow/retire without the append-only-forever pgEnum ratchet. See patients/routes.ts.
    onboardingChannel: text('onboarding_channel'),
    // When onboardingChannel is 'Partner' or 'HMO', which payer profile referred the
    // patient (Hati Health, an HMO, etc.). NULL for all other channels.
    onboardingChannelPayerId: bigint('onboarding_channel_payer_id', { mode: 'number' }).references(
      () => payerProfiles.id,
      { onDelete: 'set null' },
    ),
    // Health card — nullable FK to attachments populated when health-card PDF
    // is exported to cloud storage. NULL until cloud uploader is wired
    // (Phase 2). Added 0013_health_card_attachment.sql.
    healthCardAttachmentId: bigint('health_card_attachment_id', { mode: 'number' }),
    // Duplicate handling — self-FKs added in 0000_initial.sql
    potentialDuplicateOfId: bigint('potential_duplicate_of_id', { mode: 'number' }),
    mergedIntoId: bigint('merged_into_id', { mode: 'number' }),
    mergedAt: timestamp('merged_at', { withTimezone: true }),
    // Retention (DPA)
    deletionRequestedAt: timestamp('deletion_requested_at', { withTimezone: true }),
    scheduledPurgeAt: timestamp('scheduled_purge_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    rowVersion: integer('row_version').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    searchVector: tsvector('search_vector'),
    // full_name: GENERATED ALWAYS AS (first_name + middle_name + last_name) STORED.
    // Added via 0025_modern_pg_features.sql. Used by pg_trgm fuzzy search index.
    // Drizzle does not support GENERATED columns natively — declare as plain text
    // so queries can read it; the DB enforces immutability (no app writes).
    fullName: text('full_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id),
  },
  (t) => [
    index('patients_tenant_idx').on(t.tenantId),
    index('patients_search_idx').using('gin', t.searchVector),
    index('patients_tenant_lastname_idx').on(t.tenantId, t.lastName),
    uniqueIndex('patients_tenant_id_uniq').on(t.tenantId, t.id),
    uniqueIndex('patients_tenant_mrn_uniq').on(t.tenantId, t.mrn),
  ],
)

// ---------------------------------------------------------------------------
// Domain 3 — Catalog & Pricing
// ---------------------------------------------------------------------------

// 4a. products — physical SKUs (Abhayrab, Speeda, Vaxigrip Tetra, …).
// Decouples inventory from service_catalog variants so one Abhayrab vial
// batch can be referenced by multiple service entries (IM + ID) without
// artificial split at receipt time. Added 0010; FEFO cutover follows.
export const products = pgTable(
  'products',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // PRD_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    manufacturer: text('manufacturer'),
    ndcCode: text('ndc_code'),
    defaultRoute: administrationRouteEnum('default_route'),
    vialVolumeMl: numeric('vial_volume_ml', { precision: 6, scale: 2 }),
    notes: text('notes'),
    rowVersion: integer('row_version').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }),
  },
  (t) => [
    uniqueIndex('products_tenant_id_uniq').on(t.tenantId, t.id),
    // Active-name uniqueness enforced by partial unique index in
    // 0010_products_categories_bundles.sql (WHERE deleted_at IS NULL).
  ],
)

// 4b. service_categories — hierarchical grouping (Vaccines → Anti-Rabies → PEP).
// Replaces freeform service_catalog.category text over time; that column
// stays for backward compat until rows are backfilled.
export const serviceCategories = pgTable(
  'service_categories',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // CAT_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    // Self-reference: FK added in 0000_initial.sql.
    parentId: bigint('parent_id', { mode: 'number' }),
    name: text('name').notNull(),
    displayOrder: integer('display_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }),
  },
  (t) => [
    uniqueIndex('service_categories_tenant_id_uniq').on(t.tenantId, t.id),
    // COALESCE-based uniqueness enforced in 0010_products_categories_bundles.sql.
  ],
)

// 5. service_catalog — PK is the raw code (e.g. ARVPEP_IM). Stays text; no display_id.
export const serviceCatalog = pgTable(
  'service_catalog',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    sku: text('sku'),
    name: text('name').notNull(),
    serviceType: serviceTypeEnum('service_type').notNull(),
    // Structured grouping (Vaccines → Anti-Rabies → PEP, …). Replaced the
    // freeform `category` text column in 0011.
    categoryId: bigint('category_id', { mode: 'number' }).references(() => serviceCategories.id),
    // Physical SKU this orderable variant draws inventory from. Nullable
    // until products are backfilled + FEFO cuts over. Added 0010.
    productId: bigint('product_id', { mode: 'number' }).references(() => products.id),
    // base_price moved to service_prices table (Phase 4: dropped column)
    cvxCode: text('cvx_code'),
    ndcCode: text('ndc_code'),
    cptCode: text('cpt_code'),
    loincCode: text('loinc_code'),
    defaultRoute: administrationRouteEnum('default_route'),
    defaultDoseVolumeMl: numeric('default_dose_volume_ml', { precision: 6, scale: 2 }),
    defaultManufacturer: text('default_manufacturer'),
    isVatExempt: boolean('is_vat_exempt').notNull().default(false),
    requiresStock: boolean('requires_stock').notNull().default(false),
    requiresRx: boolean('requires_rx').notNull().default(false),
    requiresConsent: boolean('requires_consent').notNull().default(false),
    requiresVis: boolean('requires_vis').notNull().default(false),
    // Weight-based dosing (ERIG / HRIG / HTIG / ATS). UI prompts a calculator
    // instead of accepting defaultDoseVolumeMl. Added 0010.
    requiresDoseCalculation: boolean('requires_dose_calculation').notNull().default(false),
    rowVersion: integer('row_version').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    searchVector: tsvector('search_vector'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id),
  },
  (t) => [
    uniqueIndex('service_catalog_tenant_code_idx').on(t.tenantId, t.code),
    index('service_catalog_search_idx').using('gin', t.searchVector),
    uniqueIndex('service_catalog_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

// 5b. service_bundle_items — composition of bundle catalog entries (lab panels
// SV01–SV23, …). Bundle row remains the billable unit; this enumerates the
// constituent services. Added 0010.
// Junction: composite PK on (tenant_id, bundle_service_id, item_service_id).
// No surrogate id, no display_id. FKs to service_catalog stay text.
export const serviceBundleItems = pgTable(
  'service_bundle_items',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    bundleServiceId: text('bundle_service_id')
      .notNull()
      .references(() => serviceCatalog.id),
    itemServiceId: text('item_service_id')
      .notNull()
      .references(() => serviceCatalog.id),
    quantity: integer('quantity').notNull().default(1),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.bundleServiceId, t.itemServiceId] }),
    index('service_bundle_items_bundle_idx').on(t.tenantId, t.bundleServiceId, t.displayOrder),
    // No-self-ref + quantity > 0 CHECK constraints in
    // 0010_products_categories_bundles.sql.
  ],
)

// 5c. service_eligible_products — junction allowing one abstract service to
// draw inventory from multiple eligible products (e.g. ARV PEP IM ← Abhayrab
// OR Speeda). FEFO joins through this table at administer time. Added 0016.
// Junction: composite PK on (tenant_id, service_id, product_id). No surrogate id, no display_id.
export const serviceEligibleProducts = pgTable(
  'service_eligible_products',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    serviceId: text('service_id')
      .notNull()
      .references(() => serviceCatalog.id, { onDelete: 'restrict' }),
    productId: bigint('product_id', { mode: 'number' })
      .notNull()
      .references(() => products.id),
    isDefault: boolean('is_default').notNull().default(false),
    ranking: integer('ranking').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.serviceId, t.productId] }),
    index('service_eligible_products_service_idx').on(t.tenantId, t.serviceId, t.ranking),
    index('service_eligible_products_product_idx').on(t.tenantId, t.productId),
  ],
)

// 13. payer_profiles (defined early; referenced by transactions + payments)
export const payerProfiles = pgTable(
  'payer_profiles',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // PYR_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    payerType: payerTypeEnum('payer_type').notNull(),
    contactName: text('contact_name'),
    contactNumber: text('contact_number'),
    email: text('email'),
    address: text('address'),
    paymentTermsDays: integer('payment_terms_days'),
    notes: text('notes'),
    isActive: boolean('is_active').notNull().default(true),
    // A blanket "N% off/markup everything" rule for this payer. NULL = no
    // adjustment. Positive = markup, negative = discount. Applies only when
    // no explicit (payer_id, service_id) service_prices row already won the
    // price lookup for that service — see resolveServicePrice in
    // shared/lib/pricing.ts — and the service isn't listed in
    // payer_price_adjustment_exclusions below.
    priceAdjustmentPercent: numeric('price_adjustment_percent', { precision: 5, scale: 2 }),
    rowVersion: integer('row_version').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id),
  },
  (t) => [
    index('payer_profiles_tenant_idx').on(t.tenantId),
    uniqueIndex('payer_profiles_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

// ---------------------------------------------------------------------------
// Domain 4 — Clinical Operations
// ---------------------------------------------------------------------------

// 6. standing_order_templates — PK is the raw template code. Stays text; no display_id.
// Self-FKs (supersedes_id, superseded_by_id) added in 0000_initial.sql.
export const standingOrderTemplates = pgTable(
  'standing_order_templates',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    requiresPhysicianAuth: boolean('requires_physician_auth').notNull().default(false),
    version: integer('version').notNull().default(1),
    supersedesId: text('supersedes_id'),
    supersededById: text('superseded_by_id'),
    isLocked: boolean('is_locked').notNull().default(false),
    rowVersion: integer('row_version').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    /** NULL = applies to all specialties; non-null = arrivals wizard filter key */
    specialty: text('specialty'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id),
  },
  (t) => [
    uniqueIndex('sot_tenant_code_idx').on(t.tenantId, t.code),
    uniqueIndex('sot_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

// 6b. standing_order_template_items — bigserial PK + display_id (STI_…).
export const standingOrderTemplateItems = pgTable(
  'standing_order_template_items',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // STI_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    templateId: text('template_id')
      .notNull()
      .references(() => standingOrderTemplates.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => serviceCatalog.id),
    dayOffset: integer('day_offset').notNull(),
    sequence: integer('sequence').notNull(),
    quantity: numeric('quantity', { precision: 8, scale: 2 }).notNull().default('1'),
    instructions: text('instructions'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('soti_template_day_seq_idx').on(t.templateId, t.dayOffset, t.sequence),
    index('soti_service_idx').on(t.serviceId),
  ],
)

// 8. encounters (defined before patient_standing_orders which references it)
export const encounters = pgTable(
  'encounters',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // ENC_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    patientId: bigint('patient_id', { mode: 'number' })
      .notNull()
      .references(() => patients.id),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branches.id),
    // FK to appointments added in 0000_initial.sql (forward ref).
    appointmentId: bigint('appointment_id', { mode: 'number' }),
    providerId: bigint('provider_id', { mode: 'number' }).references(() => users.id),
    closedById: bigint('closed_by_id', { mode: 'number' }),
    specialty: encounterSpecialtyEnum('specialty').notNull(),
    status: encounterStatusEnum('status').notNull().default('Open'),
    chiefComplaint: text('chief_complaint'),
    // visit_no: per-patient sequential visit number. Populated by app code.
    visitNo: integer('visit_no'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    dispositionCode: text('disposition_code'),
    specialtyData: jsonb('specialty_data'), // rabies/flu/vaccination specific
    clinicalNotes: jsonb('clinical_notes'), // vitals + SOAP
    rowVersion: integer('row_version').notNull().default(0),
    // WHO triage category — valid Phase-1 values: CAT-1 | CAT-2 | CAT-3
    // Not a Postgres enum; validated at the app layer to keep migrations lightweight.
    triageCategory: text('triage_category'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id),
  },
  (t) => [
    index('encounters_tenant_patient_idx').on(t.tenantId, t.patientId),
    index('encounters_tenant_branch_idx').on(t.tenantId, t.branchId, t.startedAt),
    uniqueIndex('encounters_tenant_id_uniq').on(t.tenantId, t.id),
    // Partial hot-status index: filter open/in-progress encounters quickly.
    index('encounters_tenant_status_active_idx')
      .on(t.tenantId, t.status, t.startedAt)
      .where(sql`deleted_at IS NULL`),
  ],
)

// 7. patient_standing_orders
export const patientStandingOrders = pgTable(
  'patient_standing_orders',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // PSO_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    patientId: bigint('patient_id', { mode: 'number' })
      .notNull()
      .references(() => patients.id),
    templateId: text('template_id')
      .notNull()
      .references(() => standingOrderTemplates.id),
    initiatingEncounterId: bigint('initiating_encounter_id', { mode: 'number' }).references(
      () => encounters.id,
    ),
    authorizingProviderId: bigint('authorizing_provider_id', { mode: 'number' }).references(
      () => users.id,
    ),
    status: standingOrderStatusEnum('status').notNull().default('Active'),
    startDate: timestamp('start_date', { withTimezone: true }).notNull(),
    endDate: timestamp('end_date', { withTimezone: true }),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspendedById: bigint('suspended_by_id', { mode: 'number' }),
    suspensionReason: text('suspension_reason'),
    resumedAt: timestamp('resumed_at', { withTimezone: true }),
    discontinuedAt: timestamp('discontinued_at', { withTimezone: true }),
    discontinuedById: bigint('discontinued_by_id', { mode: 'number' }).references(() => users.id),
    discontinuationReason: text('discontinuation_reason'),
    notes: text('notes'),
    rowVersion: integer('row_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id),
  },
  (t) => [
    index('pso_tenant_patient_idx').on(t.tenantId, t.patientId, t.status),
    uniqueIndex('pso_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

// 9. clinical_orders
export const clinicalOrders = pgTable(
  'clinical_orders',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // ORD_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    patientStandingOrderId: bigint('patient_standing_order_id', { mode: 'number' }).references(
      () => patientStandingOrders.id,
    ),
    // The point-of-sale transaction whose bundle fan-out created this order
    // (Ad_Hoc orders only). Lets voiding a transaction find and unwind the
    // clinical_orders it fanned out. 'no action' on delete: transactions are
    // soft-deleted, and the link should outlive edits (audit-style, same
    // convention as payments.fundedByTransactionId elsewhere in this file).
    fanOutTransactionId: bigint('fan_out_transaction_id', { mode: 'number' }).references(
      () => transactions.id,
    ),
    serviceId: text('service_id')
      .notNull()
      .references(() => serviceCatalog.id),
    encounterId: bigint('encounter_id', { mode: 'number' }).references(() => encounters.id),
    patientId: bigint('patient_id', { mode: 'number' })
      .notNull()
      .references(() => patients.id),
    orderType: clinicalOrderTypeEnum('order_type').notNull(),
    status: clinicalOrderStatusEnum('status').notNull().default('Scheduled'),
    originalScheduledDate: timestamp('original_scheduled_date', { withTimezone: true }),
    currentScheduledDate: timestamp('current_scheduled_date', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    // Legacy external dose evidence may prove completion without preserving an
    // exact date. This flag is allowed only for externally administered,
    // Completed rows whose completed_at remains NULL.
    completedAtUnknown: boolean('completed_at_unknown').notNull().default(false),
    // completed_by_id replaced by administered_by_id + documented_by_id (Phase 4: dropped column)
    administeringEncounterId: bigint('administering_encounter_id', { mode: 'number' }),
    administeredById: bigint('administered_by_id', { mode: 'number' }),
    documentedById: bigint('documented_by_id', { mode: 'number' }),
    lotId: bigint('lot_id', { mode: 'number' }),
    manufacturerSnapshot: text('manufacturer_snapshot'),
    expiryDateSnapshot: date('expiry_date_snapshot'),
    doseVolumeMlActual: numeric('dose_volume_ml_actual', { precision: 6, scale: 2 }),
    needleGauge: text('needle_gauge'),
    refusalReason: text('refusal_reason'),
    deferralReason: text('deferral_reason'),
    idempotencyKey: text('idempotency_key'),
    // Surfaced from JSONB — frequently queried / reported
    quantity: numeric('quantity', { precision: 8, scale: 2 }).notNull().default('1'),
    doseNumber: integer('dose_number'),
    administrationRoute: administrationRouteEnum('administration_route'),
    administrationSite: text('administration_site'), // Left deltoid, etc.
    indication: text('indication'), // Post-Exposure Prophylaxis, etc.
    // Remaining administration context (needle gauge, volume, etc.)
    notes: jsonb('notes'),
    // Continuity-of-care: external-clinic provenance (migration 0018)
    administeredAtExternalClinic: boolean('administered_at_external_clinic')
      .notNull()
      .default(false),
    externalClinicianName: text('external_clinician_name'),
    externalClinicName: text('external_clinic_name'),
    externalNotes: text('external_notes'),
    rowVersion: integer('row_version').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id),
  },
  (t) => [
    index('clinical_orders_scheduled_idx').on(
      t.tenantId,
      t.patientStandingOrderId,
      t.status,
      t.currentScheduledDate,
    ),
    index('clinical_orders_tenant_so_idx').on(t.tenantId, t.patientStandingOrderId),
    index('clinical_orders_tenant_encounter_idx').on(t.tenantId, t.encounterId),
    uniqueIndex('clinical_orders_tenant_id_uniq').on(t.tenantId, t.id),
    // Partial hot-status index: active scheduled/pending orders.
    index('clinical_orders_tenant_status_active_idx')
      .on(t.tenantId, t.status, t.currentScheduledDate)
      .where(sql`deleted_at IS NULL`),
    // Partial index: only bundle-fanned-out orders carry this FK, and the
    // only query shape is "find every order this transaction fanned out".
    index('clinical_orders_fan_out_txn_idx')
      .on(t.fanOutTransactionId)
      .where(sql`fan_out_transaction_id IS NOT NULL`),
    check(
      'clinical_orders_unknown_completion_check',
      sql`NOT ${t.completedAtUnknown} OR (${t.status} = 'Completed' AND ${t.completedAt} IS NULL AND ${t.administeredAtExternalClinic} = true)`,
    ),
  ],
)

// 9a. post_administration_observations
//
// Kept separate from clinical_orders because a Completed order is immutable.
// The observation record is opened atomically with administration, then owns
// the explicit outcome and discharge acknowledgements that happen afterward.
export const postAdministrationObservations = pgTable(
  'post_administration_observations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // OBS_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    clinicalOrderId: bigint('clinical_order_id', { mode: 'number' })
      .notNull()
      .references(() => clinicalOrders.id),
    patientId: bigint('patient_id', { mode: 'number' })
      .notNull()
      .references(() => patients.id),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branches.id),
    durationMinutes: integer('duration_minutes').notNull().default(15),
    observeUntil: timestamp('observe_until', { withTimezone: true }).notNull(),
    outcome: text('outcome'), // NoReaction | Reaction | Escalated
    outcomeNotes: text('outcome_notes'),
    outcomeRecordedAt: timestamp('outcome_recorded_at', { withTimezone: true }),
    outcomeRecordedById: bigint('outcome_recorded_by_id', { mode: 'number' }).references(
      () => users.id,
    ),
    dischargedAt: timestamp('discharged_at', { withTimezone: true }),
    dischargedById: bigint('discharged_by_id', { mode: 'number' }).references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id),
  },
  (t) => [
    uniqueIndex('post_admin_observations_tenant_order_uniq').on(t.tenantId, t.clinicalOrderId),
    index('post_admin_observations_today_idx').on(
      t.tenantId,
      t.branchId,
      t.dischargedAt,
      t.observeUntil,
    ),
    check('post_admin_observations_duration_check', sql`${t.durationMinutes} BETWEEN 1 AND 240`),
    check(
      'post_admin_observations_outcome_check',
      sql`${t.outcome} IS NULL OR ${t.outcome} IN ('NoReaction', 'Reaction', 'Escalated')`,
    ),
    check(
      'post_admin_observations_outcome_state_check',
      sql`(${t.outcome} IS NULL AND ${t.outcomeRecordedAt} IS NULL AND ${t.outcomeRecordedById} IS NULL) OR (${t.outcome} IS NOT NULL AND ${t.outcomeRecordedAt} IS NOT NULL AND ${t.outcomeRecordedById} IS NOT NULL)`,
    ),
    check(
      'post_admin_observations_reaction_notes_check',
      sql`${t.outcome} NOT IN ('Reaction', 'Escalated') OR length(trim(${t.outcomeNotes})) >= 5`,
    ),
    check(
      'post_admin_observations_discharge_state_check',
      sql`(${t.dischargedAt} IS NULL AND ${t.dischargedById} IS NULL) OR (${t.dischargedAt} IS NOT NULL AND ${t.dischargedById} IS NOT NULL AND ${t.outcome} IS NOT NULL)`,
    ),
  ],
)

// 9b. consent_records — DROPPED Phase 4. Use `consents` table instead.

// ---------------------------------------------------------------------------
// Domain 5 — Inventory Traceability
// ---------------------------------------------------------------------------

// 14. inventory_lots
export const inventoryLots = pgTable(
  'inventory_lots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // LOT_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branches.id),
    // Physical SKU this lot is of. Multiple service variants (e.g.
    // Abhayrab-IM, Abhayrab-ID) can share one lot. Added 0010, made NOT NULL +
    // service_id dropped in 0011.
    productId: bigint('product_id', { mode: 'number' })
      .notNull()
      .references(() => products.id),
    batchNumber: text('batch_number').notNull(),
    manufacturer: text('manufacturer').notNull(),
    ndcCodeSnapshot: text('ndc_code_snapshot'),
    expiryDate: date('expiry_date').notNull(),
    quantityOnHand: numeric('quantity_on_hand', { precision: 12, scale: 4 }).notNull(),
    quantityReceived: numeric('quantity_received', { precision: 12, scale: 4 }).notNull(),
    // Fractional dose tracking (e.g. ID-route rabies vials shared across patients).
    // NULL when unit-of-issue is whole vials.
    remainingVolumeMl: numeric('remaining_volume_ml', { precision: 6, scale: 2 }),
    unitCost: numeric('unit_cost', { precision: 12, scale: 4 }).notNull(),
    costCurrency: text('cost_currency').notNull().default('PHP'),
    isQuarantined: boolean('is_quarantined').notNull().default(false),
    quarantineReason: text('quarantine_reason'),
    locationId: bigint('location_id', { mode: 'number' }),
    recallId: bigint('recall_id', { mode: 'number' }),
    supplierName: text('supplier_name'),
    supplierInvoiceNumber: text('supplier_invoice_number'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    rowVersion: integer('row_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id),
  },
  (t) => [
    // FEFO: product + branch ordered by expiry ASC — partial index in supplemental SQL
    index('idx_inventory_lots_fefo').on(t.productId, t.branchId, t.expiryDate, t.quantityOnHand),
    index('inventory_lots_tenant_branch_idx').on(t.tenantId, t.branchId),
    uniqueIndex('inventory_lots_batch_idx').on(t.tenantId, t.branchId, t.productId, t.batchNumber),
    uniqueIndex('inventory_lots_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

// 15. inventory_transactions — DROPPED Phase 4. Use `inventory_movements` instead.

// ---------------------------------------------------------------------------
// Domain 6 — Billing & AR
// ---------------------------------------------------------------------------

// 10. transactions
export const transactions = pgTable(
  'transactions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // TXN_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branches.id),
    patientId: bigint('patient_id', { mode: 'number' })
      .notNull()
      .references(() => patients.id),
    encounterId: bigint('encounter_id', { mode: 'number' }).references(() => encounters.id),
    cashierId: bigint('cashier_id', { mode: 'number' }).references(() => users.id),
    cashDrawerSessionId: bigint('cash_drawer_session_id', { mode: 'number' }),
    payerId: bigint('payer_id', { mode: 'number' }).references(() => payerProfiles.id),
    payerContractId: bigint('payer_contract_id', { mode: 'number' }),
    status: transactionStatusEnum('status').notNull().default('Draft'),
    // BIR Official Receipt number — NULL until BIR registration completes (spec #6).
    // Not auto-generated; a future tenant_counters table will issue gapless sequential
    // numbers for transactions that need one.
    receiptNo: text('receipt_no'),
    orSeriesId: text('or_series_id'),
    // Gapless per-branch transaction sequence, allocated from
    // tenant_counters (counter_kind='TXN') inside the createTransaction
    // tx. Distinct from `display_id` (random TXN_xxx); reads as "Nth
    // transaction at this branch" for receipt UI / reporting. Nullable
    // on legacy rows that pre-date the wiring (2026-05-21).
    branchSeq: integer('branch_seq'),
    // BIR discount fields
    discountIdType: discountIdTypeEnum('discount_id_type'),
    discountIdNumber: text('discount_id_number'),
    // Financials — all NUMERIC(12,2)
    grossAmount: numeric('gross_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    discountAmount: numeric('discount_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    vatAmount: numeric('vat_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    vatRate: numeric('vat_rate', { precision: 5, scale: 4 }).notNull().default('0.12'),
    netAmount: numeric('net_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    amountPaid: numeric('amount_paid', { precision: 12, scale: 2 }).notNull().default('0'),
    // GENERATED ALWAYS AS (GREATEST(net_amount - amount_paid, 0)) STORED.
    // The column is rebuilt as a Postgres GENERATED column in baseline SQL.
    // Drizzle declares it as a regular column here so SELECTs project it;
    // writes at the DB layer would error on the GENERATED column — no app code writes it.
    amountOutstanding: numeric('amount_outstanding', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    // Prepayment
    isPrepayment: boolean('is_prepayment').notNull().default(false),
    appliedToTransactionId: bigint('applied_to_transaction_id', { mode: 'number' }),
    prepaymentAppliedAt: timestamp('prepayment_applied_at', { withTimezone: true }),
    // Void / refund
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedById: bigint('voided_by_id', { mode: 'number' }).references(() => users.id),
    voidReason: text('void_reason'),
    replacementTransactionId: bigint('replacement_transaction_id', { mode: 'number' }),
    refundedFromTransactionId: bigint('refunded_from_transaction_id', { mode: 'number' }),
    idempotencyKey: text('idempotency_key'),
    transactedAt: timestamp('transacted_at', { withTimezone: true }).notNull().defaultNow(),
    rowVersion: integer('row_version').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id),
  },
  (t) => [
    index('transactions_tenant_patient_idx').on(t.tenantId, t.patientId),
    index('transactions_tenant_branch_date_idx').on(t.tenantId, t.branchId, t.transactedAt),
    index('transactions_tenant_status_idx').on(t.tenantId, t.status),
    uniqueIndex('transactions_tenant_receipt_no_idx').on(t.tenantId, t.receiptNo),
    uniqueIndex('transactions_tenant_id_uniq').on(t.tenantId, t.id),
    // Partial hot-status index: open/pending transactions.
    index('transactions_tenant_status_active_idx')
      .on(t.tenantId, t.status, t.transactedAt)
      .where(sql`deleted_at IS NULL`),
  ],
)

// 11. transaction_items
export const transactionItems = pgTable(
  'transaction_items',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // TXI_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    transactionId: bigint('transaction_id', { mode: 'number' })
      .notNull()
      .references(() => transactions.id),
    serviceId: text('service_id')
      .notNull()
      .references(() => serviceCatalog.id),
    clinicalOrderId: bigint('clinical_order_id', { mode: 'number' }).references(
      () => clinicalOrders.id,
    ),
    // Per-line patient attribution for multi-patient (family/group) transactions.
    // NULL ⇒ inherit the header/primary patient (transactions.patient_id). Reads
    // COALESCE(transaction_items.patient_id, transactions.patient_id). The
    // composite tenant-FK (tenant_id, patient_id) is added in 0003_invariants.sql.
    patientId: bigint('patient_id', { mode: 'number' }).references(() => patients.id),
    lotId: bigint('lot_id', { mode: 'number' }),
    quantity: numeric('quantity', { precision: 8, scale: 2 }).notNull(),
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(), // sale-time snapshot
    unitCostSnapshot: numeric('unit_cost_snapshot', { precision: 12, scale: 4 }),
    servicePriceId: bigint('service_price_id', { mode: 'number' }),
    discountAmount: numeric('discount_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    isVatExempt: boolean('is_vat_exempt').notNull().default(false),
    vatAmount: numeric('vat_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    subtotal: numeric('subtotal', { precision: 12, scale: 2 }).notNull(),
    isPrepaid: boolean('is_prepaid').notNull().default(false),
    prepaidTransactionId: bigint('prepaid_transaction_id', { mode: 'number' }).references(
      () => transactions.id,
    ),
    // Attending clinician for this line — used for per-physician consultation /
    // medcert revenue attribution. Replaces the per-physician catalog rows
    // (SERVICE_CONSULTATION_LACUARIN etc.). Added 0016.
    performedById: bigint('performed_by_id', { mode: 'number' }).references(() => users.id),
    rowVersion: integer('row_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id),
  },
  (t) => [
    index('tx_items_transaction_idx').on(t.transactionId),
    index('tx_items_clinical_order_idx').on(t.clinicalOrderId),
    index('tx_items_performed_by_idx').on(t.performedById),
    index('tx_items_patient_idx').on(t.tenantId, t.patientId),
    uniqueIndex('transaction_items_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

// 12. payments
export const payments = pgTable(
  'payments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // PMT_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    transactionId: bigint('transaction_id', { mode: 'number' })
      .notNull()
      .references(() => transactions.id),
    cashDrawerSessionId: bigint('cash_drawer_session_id', { mode: 'number' }),
    // When method='Credit', the source prepayment/deposit transaction whose
    // balance funded this draw. NULL for ordinary (cash/card/etc.) payments.
    // A deposit's remaining balance is derived as:
    //   deposit.net_amount - SUM(payments.amount WHERE funded_by_transaction_id = deposit.id)
    // 'no action' on delete: the funding deposit outlives the draw (audit-style).
    fundedByTransactionId: bigint('funded_by_transaction_id', { mode: 'number' }).references(
      () => transactions.id,
    ),
    method: paymentMethodEnum('method').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    payerId: bigint('payer_id', { mode: 'number' }).references(() => payerProfiles.id),
    referenceNumber: text('reference_number'), // GCash ref, bank ref, etc.
    externalProcessorFee: numeric('external_processor_fee', { precision: 12, scale: 2 }),
    reconciliationStatus: text('reconciliation_status').notNull().default('Pending'),
    clearedAt: timestamp('cleared_at', { withTimezone: true }),
    idempotencyKey: text('idempotency_key'),
    receivedById: bigint('received_by_id', { mode: 'number' }).references(() => users.id),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
    // Correcting a posted payment's method is void-the-row + insert-replacement,
    // never an in-place UPDATE of `method`. A voided row's `amount` is left
    // untouched (chk_payment_amount_positive still holds): voidedAt is what
    // excludes it. voided_at IS NOT NULL rows are excluded from
    // sync_transaction_amounts' amount_paid recompute and from every
    // money aggregate (see patterns.md "Revenue + AR aggregates").
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedById: bigint('voided_by_id', { mode: 'number' }).references(() => users.id),
    voidReason: text('void_reason'),
    // Self-FK walking a voided row to the replacement payment that corrected
    // it. NULL until/unless this row is voided-and-replaced.
    replacedByPaymentId: bigint('replaced_by_payment_id', { mode: 'number' }).references(
      (): AnyPgColumn => payments.id,
    ),
    rowVersion: integer('row_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id),
  },
  (t) => [
    index('payments_transaction_idx').on(t.tenantId, t.transactionId),
    // Every credit-balance derivation filters by the funding deposit.
    index('payments_funded_by_idx')
      .on(t.tenantId, t.fundedByTransactionId)
      .where(sql`${t.fundedByTransactionId} IS NOT NULL`),
    uniqueIndex('payments_tenant_id_uniq').on(t.tenantId, t.id),
    // Fast lookup of a transaction's live (non-voided) payments: the shape
    // every money aggregate and the correction flow actually wants.
    index('payments_active_idx')
      .on(t.tenantId, t.transactionId)
      .where(sql`voided_at IS NULL`),
  ],
)

// 12a. group_bills — corporate / group AR wrapper around the existing money
// engine. Financial amounts, items, payments, voids and inventory fan-out stay
// on transactions; this row identifies the payer-owned receivable and ensures
// patient AR queries can explicitly exclude it.
export const groupBills = pgTable(
  'group_bills',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // GBL_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branches.id),
    transactionId: bigint('transaction_id', { mode: 'number' })
      .notNull()
      .references(() => transactions.id),
    payerId: bigint('payer_id', { mode: 'number' })
      .notNull()
      .references(() => payerProfiles.id),
    referenceNumber: text('reference_number'),
    idempotencyKey: text('idempotency_key'),
    rowVersion: integer('row_version').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id),
  },
  (t) => [
    uniqueIndex('group_bills_transaction_uniq').on(t.transactionId),
    index('group_bills_tenant_payer_idx').on(t.tenantId, t.payerId, t.createdAt),
    index('group_bills_tenant_branch_idx').on(t.tenantId, t.branchId, t.createdAt),
    uniqueIndex('group_bills_tenant_id_uniq').on(t.tenantId, t.id),
    uniqueIndex('group_bills_tenant_idempotency_uniq')
      .on(t.tenantId, t.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
  ],
)

// 12b. transaction_patients — per-patient sub-header for multi-patient (family /
// group) transactions. One row per (transaction, patient): holds that patient's
// BIR SC/PWD discount and optional encounter link. The header transactions.patient_id
// remains the primary / bill-to patient; createTransaction always writes ≥1 row
// (the primary). Legacy/seed transactions without rows fall back to the header
// patient + header discount on read. bigserial-only (no display_id), like the
// other sub-record tables. No branch_id — the RLS branch_isolation loop auto-skips
// tables without it; branch is inherited via the parent transaction.
export const transactionPatients = pgTable(
  'transaction_patients',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    transactionId: bigint('transaction_id', { mode: 'number' })
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    patientId: bigint('patient_id', { mode: 'number' })
      .notNull()
      .references(() => patients.id),
    encounterId: bigint('encounter_id', { mode: 'number' }).references(() => encounters.id, {
      onDelete: 'set null',
    }),
    // Reuses the transactions header enum. NULL ⇒ no SC/PWD discount for this patient.
    discountIdType: discountIdTypeEnum('discount_id_type'),
    discountIdNumber: text('discount_id_number'),
    rowVersion: integer('row_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id),
  },
  (t) => [
    index('transaction_patients_transaction_idx').on(t.tenantId, t.transactionId),
    uniqueIndex('transaction_patients_txn_patient_uniq').on(t.transactionId, t.patientId),
    uniqueIndex('transaction_patients_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

// ---------------------------------------------------------------------------
// Domain 7 — Laboratory
// ---------------------------------------------------------------------------

// 16. partner_laboratories
export const partnerLaboratories = pgTable(
  'partner_laboratories',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // LAB_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    contactName: text('contact_name'),
    contactNumber: text('contact_number'),
    email: text('email'),
    address: text('address'),
    apiConfig: jsonb('api_config'), // integration config
    isActive: boolean('is_active').notNull().default(true),
    rowVersion: integer('row_version').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id),
  },
  (t) => [
    index('partner_labs_tenant_idx').on(t.tenantId),
    uniqueIndex('partner_labs_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

// 17. lab_orders
export const labOrders = pgTable(
  'lab_orders',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // LBO_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    clinicalOrderId: bigint('clinical_order_id', { mode: 'number' })
      .notNull()
      .references(() => clinicalOrders.id),
    // Denormalized from clinical_orders.branch_id — populated at insert.
    // HIGH audit finding: branch-level lab reports otherwise need a 2-table join.
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branches.id),
    laboratoryId: bigint('laboratory_id', { mode: 'number' }).references(
      () => partnerLaboratories.id,
    ),
    status: labOrderStatusEnum('status').notNull().default('Pending'),
    externalOrderId: text('external_order_id'),
    collectedAt: timestamp('collected_at', { withTimezone: true }),
    collectedById: bigint('collected_by_id', { mode: 'number' }),
    rejectionReason: text('rejection_reason'),
    hasCriticalValue: boolean('has_critical_value').notNull().default(false),
    criticalValueAcknowledgedAt: timestamp('critical_value_acknowledged_at', {
      withTimezone: true,
    }),
    criticalValueAcknowledgedById: bigint('critical_value_acknowledged_by_id', { mode: 'number' }),
    resultData: jsonb('result_data'),
    // result_file_url replaced by result_file_attachment_id FK → attachments (Phase 4: dropped column)
    resultFileAttachmentId: bigint('result_file_attachment_id', { mode: 'number' }).references(
      () => attachments.id,
    ),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    resultReceivedAt: timestamp('result_received_at', { withTimezone: true }),
    notes: text('notes'),
    rowVersion: integer('row_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id),
  },
  (t) => [
    index('lab_orders_clinical_order_idx').on(t.clinicalOrderId),
    index('lab_orders_tenant_status_idx').on(t.tenantId, t.status),
    index('lab_orders_tenant_branch_idx').on(t.tenantId, t.branchId, t.status),
    uniqueIndex('lab_orders_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

// ---------------------------------------------------------------------------
// Domain 8 — System
// ---------------------------------------------------------------------------

// 18. audit_logs
// No display_id: append-only event log; queried by (entity_type, entity_id, timestamp).
// Drizzle defines structure; supplemental SQL recreates as PARTITION BY RANGE (timestamp).
// Polymorphic entity_id stays TEXT (stores display_id of the audited row per spec #9).
// `entity_display_id` is a denormalized copy (populated by the audit trigger) so reports
// never need a join.
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id').notNull(),
    userId: bigint('user_id', { mode: 'number' }),
    sessionId: bigint('session_id', { mode: 'number' }),
    correlationId: text('correlation_id'),
    action: auditActionEnum('action').notNull(),
    entityType: text('entity_type').notNull(),
    // Stores the display_id text (per spec #9). Null when the audited table has no display_id.
    entityId: text('entity_id'),
    // Denormalized copy of the audited row's display_id — populated by the audit trigger.
    entityDisplayId: text('entity_display_id'),
    branchId: bigint('branch_id', { mode: 'number' }),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    changes: jsonb('changes'), // { before, after } or event-specific structure
    metadata: jsonb('metadata'),
    // Assigned under a per-partition advisory lock. Verification follows this
    // serialized order rather than transaction timestamps or preallocated IDs.
    // Nullable in the ORM insert model because the BEFORE INSERT trigger fills
    // it; supplemental SQL enforces NOT NULL on the stored relation.
    chainSequence: bigint('chain_sequence', { mode: 'number' }),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_tenant_entity_idx').on(t.tenantId, t.entityType, t.entityId),
    index('audit_logs_tenant_user_idx').on(t.tenantId, t.userId, t.timestamp),
    index('audit_logs_timestamp_idx').on(t.timestamp),
  ],
)

// 19. feature_flags — PK is `key text` (e.g. 'stockout_alerts'); no bigserial, no display_id.
// Composite uniqueness still on (tenant_id, branch_id, key) since the same flag key
// can exist tenant-wide and per-branch with different states.
export const featureFlags = pgTable(
  'feature_flags',
  {
    // Natural-key PK: the flag name itself. Per-row uniqueness is via
    // (tenant_id, branch_id, key) composite — duplicate `key` text rows
    // are allowed across tenant/branch scopes.
    key: text('key').notNull(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: bigint('branch_id', { mode: 'number' }).references(() => branches.id), // NULL = tenant-wide
    isEnabled: boolean('is_enabled').notNull().default(false),
    metadata: jsonb('metadata'),
    rowVersion: integer('row_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.branchId, t.key] })],
)

// 20. notifications
// 20. notifications — bigserial-only (no display_id; scoped to recipient+template).
// Polymorphic entity_id stored as bigint (purely internal — see spec #9).
export const notifications = pgTable(
  'notifications',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    templateId: bigint('template_id', { mode: 'number' }),
    patientId: bigint('patient_id', { mode: 'number' }).references(() => patients.id),
    userId: bigint('user_id', { mode: 'number' }).references(() => users.id),
    channel: notificationChannelEnum('channel').notNull(),
    recipientAddress: text('recipient_address').notNull(),
    subject: text('subject'),
    body: text('body').notNull(),
    status: notificationStatusEnum('status').notNull().default('Queued'),
    // Polymorphic entity ref (bigint PK of related entity, purely internal).
    entityType: text('entity_type'),
    entityId: bigint('entity_id', { mode: 'number' }),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    externalMessageId: text('external_message_id'),
    retryCount: integer('retry_count').notNull().default(0),
    failureReason: text('failure_reason'),
    consentVerifiedAt: timestamp('consent_verified_at', { withTimezone: true }),
    metadata: jsonb('metadata'), // provider-specific delivery metadata
    rowVersion: integer('row_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id),
  },
  (t) => [
    index('notifications_tenant_status_idx').on(t.tenantId, t.status, t.scheduledAt),
    index('notifications_patient_idx').on(t.tenantId, t.patientId),
    uniqueIndex('notifications_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

// 21. patient_tags — Phase 4: tag text column dropped, replaced by tagDefinitionId FK → tag_definitions.
// No display_id: scoped to patient via FK.
export const patientTags = pgTable(
  'patient_tags',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    patientId: bigint('patient_id', { mode: 'number' })
      .notNull()
      .references(() => patients.id),
    tagDefinitionId: bigint('tag_definition_id', { mode: 'number' })
      .notNull()
      .references(() => tagDefinitions.id),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
    appliedById: bigint('applied_by_id', { mode: 'number' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id),
  },
  (t) => [
    uniqueIndex('patient_tags_patient_def_idx').on(t.patientId, t.tagDefinitionId),
    index('patient_tags_tenant_def_idx').on(t.tenantId, t.tagDefinitionId),
    uniqueIndex('patient_tags_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

// 22. approval_requests
// Polymorphic: entity_id stays TEXT (stores display_id per spec #9).
export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // APR_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branches.id),
    requestType: approvalRequestTypeEnum('request_type').notNull(),
    description: text('description').notNull(),
    details: text('details'),
    status: approvalStatusEnum('status').notNull().default('Pending'),
    // Polymorphic reference: stores display_id string of the entity being approved.
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    requestedById: bigint('requested_by_id', { mode: 'number' })
      .notNull()
      .references(() => users.id),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    requiredApprovers: integer('required_approvers').notNull().default(1),
    approverRole: userRoleEnum('approver_role'),
    reviewedById: bigint('reviewed_by_id', { mode: 'number' }).references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNotes: text('review_notes'),
    rowVersion: integer('row_version').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('approval_requests_tenant_status_idx').on(t.tenantId, t.status),
    index('approval_requests_tenant_branch_idx').on(t.tenantId, t.branchId),
    uniqueIndex('approval_requests_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

// ---------------------------------------------------------------------------
// Domain 1 (new tables) — Tenancy & Access
// ---------------------------------------------------------------------------

// locations are a per-branch addressable resource (ExamRoom, Fridge, Safe, Counter).
// Spec doesn't list a 3-letter prefix; bigserial + natural-key (branch_id, code) lookup suffices.
export const locations = pgTable(
  'locations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branches.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    locationType: text('location_type').notNull(), // ExamRoom, Fridge, Safe, Counter
    metadata: jsonb('metadata'),
    rowVersion: integer('row_version').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }),
  },
  (t) => [
    uniqueIndex('locations_branch_code_uniq').on(t.branchId, t.code),
    uniqueIndex('locations_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

// Junction table: composite PK, no surrogate id, no display_id.
export const userBranches = pgTable(
  'user_branches',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    assignedById: bigint('assigned_by_id', { mode: 'number' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.branchId] })],
)

// Junction table: composite PK on (user_id, role), no surrogate id, no display_id.
export const userRoles = pgTable(
  'user_roles',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: userRoleEnum('role').notNull(),
    branchId: bigint('branch_id', { mode: 'number' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    assignedById: bigint('assigned_by_id', { mode: 'number' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
)

// No display_id: opaque session token table.
export const userSessions = pgTable(
  'user_sessions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceFingerprint: text('device_fingerprint'),
    deviceLabel: text('device_label'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endReason: text('end_reason'),
  },
  (t) => [index('user_sessions_user_idx').on(t.tenantId, t.userId, t.startedAt)],
)

// No display_id: opaque token table.
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    requestedFromIp: text('requested_from_ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('password_reset_tokens_hash_uniq').on(t.tokenHash)],
)

// H3: persistent PIN-attempt lockout — replaces the process-local Map in auth/routes.ts.
// Tenant-scoped; one row per (tenant_id, user_id). FK-cascades on user delete.
export const pinAttempts = pgTable(
  'pin_attempts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    failedCount: integer('failed_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastFailedAt: timestamp('last_failed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('pin_attempts_user_uniq').on(t.tenantId, t.userId)],
)

export const cashDrawerSessions = pgTable(
  'cash_drawer_sessions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // CSH_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branches.id),
    locationId: bigint('location_id', { mode: 'number' }),
    state: drawerStateEnum('state').notNull().default('Open'),
    openingFloat: numeric('opening_float', { precision: 12, scale: 2 }).notNull(),
    openingDenominations: jsonb('opening_denominations'),
    closingTotalDeclared: numeric('closing_total_declared', { precision: 12, scale: 2 }),
    closingDenominations: jsonb('closing_denominations'),
    expectedTotal: numeric('expected_total', { precision: 12, scale: 2 }),
    variance: numeric('variance', { precision: 12, scale: 2 }),
    varianceReason: text('variance_reason'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
    reconciledById: bigint('reconciled_by_id', { mode: 'number' }),
    rowVersion: integer('row_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }),
  },
  (t) => [
    index('cash_drawer_sessions_tenant_branch_idx').on(t.tenantId, t.branchId, t.openedAt),
    uniqueIndex('cash_drawer_sessions_tenant_id_uniq').on(t.tenantId, t.id),
    uniqueIndex('cash_drawer_sessions_one_open_per_branch')
      .on(t.tenantId, t.branchId)
      .where(sql`${t.state} = 'Open'`),
  ],
)

// A physical cash-out-to-the-bank event: money leaving the drawer, the
// counterpart to a cash payment landing IN it. Grain: one row per deposit,
// scoped to the drawer session it was taken from (cash is banked at
// intervals that don't line up with drawer open/close, but it always comes
// out of whichever session is currently open). `depositSlipNumber` is the
// bank's own reference for the physical event.
//
// Immutable once recorded except for the one-way void (voidedAt NULL ->
// timestamp), the same "correct via a marked reversal, never mutate the
// settled row" shape as transactions/payments. Voiding is inline + logged
// via the audit trigger, not an approval queue (see cash_drawer/db.ts).
export const cashDeposits = pgTable(
  'cash_deposits',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // DEP_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branches.id),
    cashDrawerSessionId: bigint('cash_drawer_session_id', { mode: 'number' })
      .notNull()
      .references(() => cashDrawerSessions.id),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    depositSlipNumber: text('deposit_slip_number'),
    depositedAt: timestamp('deposited_at', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedById: bigint('voided_by_id', { mode: 'number' }).references(() => users.id),
    voidReason: text('void_reason'),
    rowVersion: integer('row_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id),
  },
  (t) => [
    index('cash_deposits_session_idx').on(t.tenantId, t.cashDrawerSessionId),
    index('cash_deposits_branch_idx').on(t.tenantId, t.branchId, t.depositedAt),
    uniqueIndex('cash_deposits_tenant_id_uniq').on(t.tenantId, t.id),
    check('cash_deposits_amount_positive_check', sql`${t.amount} > 0`),
  ],
)

// ---------------------------------------------------------------------------
// Domain 2 (new tables) — Patient Registry
// ---------------------------------------------------------------------------

// No display_id: scoped to patient via FK.
export const patientEmergencyContacts = pgTable(
  'patient_emergency_contacts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    patientId: bigint('patient_id', { mode: 'number' })
      .notNull()
      .references(() => patients.id),
    name: text('name').notNull(),
    relationship: text('relationship').notNull(),
    phoneNumber: text('phone_number').notNull(),
    email: text('email'),
    isPrimary: boolean('is_primary').notNull().default(false),
    rowVersion: integer('row_version').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }),
  },
  (t) => [
    index('patient_emergency_contacts_patient_idx').on(t.tenantId, t.patientId),
    index('patient_emergency_contacts_tenant_created_idx').on(t.tenantId, t.createdAt),
    uniqueIndex('patient_emergency_contacts_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

// No display_id: scoped to patient via FK.
export const patientAllergies = pgTable(
  'patient_allergies',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    patientId: bigint('patient_id', { mode: 'number' })
      .notNull()
      .references(() => patients.id),
    allergen: text('allergen').notNull(),
    allergenCode: text('allergen_code'),
    reaction: text('reaction'),
    severity: text('severity'),
    onsetDate: date('onset_date'),
    source: text('source').notNull(), // PatientReported, Confirmed, External
    recordedById: bigint('recorded_by_id', { mode: 'number' }),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    notes: text('notes'),
    rowVersion: integer('row_version').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }),
  },
  (t) => [
    index('patient_allergies_patient_idx').on(t.tenantId, t.patientId),
    index('patient_allergies_tenant_created_idx').on(t.tenantId, t.createdAt),
    uniqueIndex('patient_allergies_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

// No display_id: scoped to patient via FK.
export const patientConditions = pgTable(
  'patient_conditions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    patientId: bigint('patient_id', { mode: 'number' })
      .notNull()
      .references(() => patients.id),
    conditionName: text('condition_name').notNull(),
    icd10Code: text('icd10_code'),
    status: text('status').notNull(), // Active, Resolved, InRemission
    onsetDate: date('onset_date'),
    resolvedDate: date('resolved_date'),
    recordedById: bigint('recorded_by_id', { mode: 'number' }),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
    rowVersion: integer('row_version').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }),
  },
  (t) => [
    index('patient_conditions_patient_idx').on(t.tenantId, t.patientId),
    index('patient_conditions_tenant_created_idx').on(t.tenantId, t.createdAt),
    uniqueIndex('patient_conditions_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

// No display_id: scoped to patient via FK.
export const patientExternalImmunizations = pgTable(
  'patient_external_immunizations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    patientId: bigint('patient_id', { mode: 'number' })
      .notNull()
      .references(() => patients.id),
    patientStandingOrderId: bigint('patient_standing_order_id', { mode: 'number' }).references(
      () => patientStandingOrders.id,
    ),
    serviceId: text('service_id').references(() => serviceCatalog.id),
    vaccineName: text('vaccine_name').notNull(),
    cvxCode: text('cvx_code'),
    manufacturer: text('manufacturer'),
    lotNumber: text('lot_number'),
    administeredDate: date('administered_date'),
    administeredDatePrecision: externalImmunizationDatePrecisionEnum('administered_date_precision')
      .notNull()
      .default('Exact'),
    administeredAtFacility: text('administered_at_facility'),
    doseNumberInSeries: integer('dose_number_in_series'),
    source: text('source').notNull(), // PatientReported, RecordsTransfer, IIS
    verifiedById: bigint('verified_by_id', { mode: 'number' }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    rowVersion: integer('row_version').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }),
  },
  (t) => [
    index('patient_ext_imm_patient_idx').on(t.tenantId, t.patientId),
    index('patient_ext_imm_course_idx').on(
      t.tenantId,
      t.patientStandingOrderId,
      t.doseNumberInSeries,
    ),
    index('patient_ext_imm_tenant_created_idx').on(t.tenantId, t.createdAt),
    uniqueIndex('patient_ext_imm_tenant_id_uniq').on(t.tenantId, t.id),
    uniqueIndex('patient_ext_imm_course_slot_uniq')
      .on(t.tenantId, t.patientStandingOrderId, t.serviceId, t.doseNumberInSeries)
      .where(
        sql`${t.patientStandingOrderId} IS NOT NULL AND ${t.serviceId} IS NOT NULL AND ${t.doseNumberInSeries} IS NOT NULL AND ${t.deletedAt} IS NULL`,
      ),
    check(
      'patient_ext_imm_date_precision_check',
      sql`${t.administeredDatePrecision} IN ('Exact', 'Estimated', 'Unknown')`,
    ),
    check(
      'patient_ext_imm_date_presence_check',
      sql`(${t.administeredDatePrecision} = 'Unknown' AND ${t.administeredDate} IS NULL) OR (${t.administeredDatePrecision} IN ('Exact', 'Estimated') AND ${t.administeredDate} IS NOT NULL)`,
    ),
  ],
)

export const tagDefinitions = pgTable(
  'tag_definitions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // TGD_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    tag: text('tag').notNull(),
    description: text('description'),
    color: text('color'),
    category: text('category'), // Clinical, Administrative, Marketing
    isActive: boolean('is_active').notNull().default(true),
    // Effective-dated lineage — mirrors service_prices pattern. effective_from
    // is required so historical reconstruction has an anchor; effective_to is
    // null while the definition is current. Soft-delete (deleted_at) and
    // "retired" (effective_to <= CURRENT_DATE) are independent — a retired
    // tag stays queryable for historical reports without being a deletion.
    effectiveFrom: date('effective_from')
      .notNull()
      .default(sql`CURRENT_DATE`),
    effectiveTo: date('effective_to'),
    rowVersion: integer('row_version').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }),
  },
  (t) => [
    uniqueIndex('tag_definitions_tenant_tag_uniq').on(t.tenantId, t.tag),
    uniqueIndex('tag_definitions_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

// ---------------------------------------------------------------------------
// Domain 3 (new tables) — Catalog & Pricing
// ---------------------------------------------------------------------------

export const servicePrices = pgTable(
  'service_prices',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // SVP_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    serviceId: text('service_id')
      .notNull()
      .references(() => serviceCatalog.id),
    branchId: bigint('branch_id', { mode: 'number' }), // null = all branches
    payerId: bigint('payer_id', { mode: 'number' }), // null = retail / cash
    // Brand dimension: a specific product (brand) may carry its own price when
    // it costs more than the abstract service's base rate (e.g. Speeda above
    // Abhayrab for ARVPEP_IM). null = any brand / base price. Resolution
    // precedence lives in shared/lib/pricing.ts — payer outranks brand.
    productId: bigint('product_id', { mode: 'number' }).references(() => products.id),
    patientSegment: text('patient_segment'),
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('PHP'),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    notes: text('notes'),
    rowVersion: integer('row_version').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }),
  },
  (t) => [
    index('service_prices_lookup_idx').on(
      t.tenantId,
      t.serviceId,
      t.branchId,
      t.payerId,
      t.productId,
      t.effectiveFrom,
    ),
    uniqueIndex('service_prices_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

export const payerContracts = pgTable(
  'payer_contracts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // PCT_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    payerId: bigint('payer_id', { mode: 'number' })
      .notNull()
      .references(() => payerProfiles.id),
    contractNumber: text('contract_number').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    paymentTermsDays: integer('payment_terms_days'),
    claimSubmissionFormat: text('claim_submission_format'),
    requiresPriorAuth: boolean('requires_prior_auth').notNull().default(false),
    feeScheduleNotes: text('fee_schedule_notes'),
    contactName: text('contact_name'),
    contactNumber: text('contact_number'),
    contactEmail: text('contact_email'),
    rowVersion: integer('row_version').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }),
  },
  (t) => [
    index('payer_contracts_payer_idx').on(t.tenantId, t.payerId),
    uniqueIndex('payer_contracts_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

// Opt-out list for payerProfiles.priceAdjustmentPercent — services listed
// here stay at their normal (unadjusted) resolved price for this payer.
// Pure junction table, no display_id, mirrors service_eligible_products.
export const payerPriceAdjustmentExclusions = pgTable(
  'payer_price_adjustment_exclusions',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    payerId: bigint('payer_id', { mode: 'number' })
      .notNull()
      .references(() => payerProfiles.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => serviceCatalog.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.payerId, t.serviceId] }),
    index('payer_price_adjustment_exclusions_payer_idx').on(t.tenantId, t.payerId),
  ],
)

// ---------------------------------------------------------------------------
// Domain 4 (new tables) — Clinical Operations
// ---------------------------------------------------------------------------

export const appointments = pgTable(
  'appointments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // APT_<8 base32>
    // Phone-readable booking handle (e.g. "ABCDEF") — populated by app code.
    bookingRef: text('booking_ref'),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    patientId: bigint('patient_id', { mode: 'number' })
      .notNull()
      .references(() => patients.id),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branches.id),
    providerId: bigint('provider_id', { mode: 'number' }),
    locationId: bigint('location_id', { mode: 'number' }),
    scheduledStartAt: timestamp('scheduled_start_at', { withTimezone: true }).notNull(),
    scheduledEndAt: timestamp('scheduled_end_at', { withTimezone: true }).notNull(),
    appointmentType: text('appointment_type').notNull(),
    status: text('status').notNull().default('Scheduled'),
    reason: text('reason'),
    notes: text('notes'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledById: bigint('cancelled_by_id', { mode: 'number' }),
    cancellationReason: text('cancellation_reason'),
    encounterId: bigint('encounter_id', { mode: 'number' }),
    // during: GENERATED ALWAYS AS tstzrange(scheduled_start_at, scheduled_end_at, '[)') STORED.
    // Backs the EXCLUDE USING gist constraint that prevents double-booking of providers.
    // Do not write from application code.
    during: text('during'), // declared as text; real type is tstzrange — Drizzle reads it as string
    rowVersion: integer('row_version').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }),
  },
  (t) => [
    index('appointments_branch_time_idx').on(t.tenantId, t.branchId, t.scheduledStartAt),
    index('appointments_patient_idx').on(t.tenantId, t.patientId, t.scheduledStartAt),
    uniqueIndex('appointments_tenant_id_uniq').on(t.tenantId, t.id),
    // Partial hot-status index: active future appointments.
    index('appointments_tenant_status_active_idx')
      .on(t.tenantId, t.status, t.scheduledStartAt)
      .where(sql`deleted_at IS NULL`),
  ],
)

// No display_id: scoped to encounter via FK.
export const encounterVitals = pgTable(
  'encounter_vitals',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    encounterId: bigint('encounter_id', { mode: 'number' })
      .notNull()
      .references(() => encounters.id, { onDelete: 'cascade' }),
    patientId: bigint('patient_id', { mode: 'number' })
      .notNull()
      .references(() => patients.id),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    recordedById: bigint('recorded_by_id', { mode: 'number' }),
    temperatureC: numeric('temperature_c', { precision: 4, scale: 1 }),
    heartRateBpm: integer('heart_rate_bpm'),
    respiratoryRateBpm: integer('respiratory_rate_bpm'),
    systolicBp: integer('systolic_bp'),
    diastolicBp: integer('diastolic_bp'),
    spo2Percent: numeric('spo2_percent', { precision: 5, scale: 2 }),
    weightKg: numeric('weight_kg', { precision: 6, scale: 2 }),
    heightCm: numeric('height_cm', { precision: 5, scale: 1 }),
    bmi: numeric('bmi', { precision: 5, scale: 2 }),
    painScore: integer('pain_score'),
    extra: jsonb('extra'),
    rowVersion: integer('row_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }),
  },
  (t) => [
    index('encounter_vitals_patient_time_idx').on(t.tenantId, t.patientId, t.recordedAt),
    uniqueIndex('encounter_vitals_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

// No display_id: scoped to encounter via FK.
export const encounterDiagnoses = pgTable(
  'encounter_diagnoses',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    encounterId: bigint('encounter_id', { mode: 'number' })
      .notNull()
      .references(() => encounters.id, { onDelete: 'cascade' }),
    patientId: bigint('patient_id', { mode: 'number' })
      .notNull()
      .references(() => patients.id),
    icd10Code: text('icd10_code').notNull(),
    description: text('description'),
    isPrimary: boolean('is_primary').notNull().default(false),
    diagnosisType: text('diagnosis_type'),
    recordedById: bigint('recorded_by_id', { mode: 'number' }),
    notes: text('notes'),
    rowVersion: integer('row_version').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }),
  },
  (t) => [
    index('encounter_diagnoses_encounter_idx').on(t.encounterId),
    index('encounter_diagnoses_icd10_idx').on(t.tenantId, t.icd10Code),
    uniqueIndex('encounter_diagnoses_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

// Generalized consent table — distinct from existing consent_records (which stays in Phase 1).
// Polymorphic: scope_ref_id stays TEXT (stores display_id of the referenced entity).
export const consents = pgTable(
  'consents',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // CNS_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    patientId: bigint('patient_id', { mode: 'number' })
      .notNull()
      .references(() => patients.id),
    encounterId: bigint('encounter_id', { mode: 'number' }),
    consentType: text('consent_type').notNull(),
    scope: text('scope').notNull(),
    scopeRefType: text('scope_ref_type'),
    // Polymorphic: stores display_id string of the referenced entity (per spec #9).
    scopeRefId: text('scope_ref_id'),
    consenterRelation: consenterRelationEnum('consenter_relation').notNull(),
    consenterName: text('consenter_name'),
    visProvided: boolean('vis_provided'),
    visVersion: text('vis_version'),
    visDate: date('vis_date'),
    visLanguage: text('vis_language'),
    obtainedAt: timestamp('obtained_at', { withTimezone: true }).notNull(),
    obtainedById: bigint('obtained_by_id', { mode: 'number' }),
    consentLanguage: text('consent_language'),
    signatureAttachmentId: bigint('signature_attachment_id', { mode: 'number' }),
    witnessId: bigint('witness_id', { mode: 'number' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revocationReason: text('revocation_reason'),
    notes: text('notes'),
    rowVersion: integer('row_version').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }),
  },
  (t) => [
    index('consents_patient_idx').on(t.tenantId, t.patientId),
    index('consents_scope_ref_idx').on(t.scopeRefType, t.scopeRefId),
    uniqueIndex('consents_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

export const adverseEvents = pgTable(
  'adverse_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // AVE_<8 base32>
    // DOH/FDA case reporting reference.
    caseNo: text('case_no'),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    patientId: bigint('patient_id', { mode: 'number' })
      .notNull()
      .references(() => patients.id),
    clinicalOrderId: bigint('clinical_order_id', { mode: 'number' }),
    encounterId: bigint('encounter_id', { mode: 'number' }),
    // Phase 4: explicit FK to inventory_lots for surveillance/recall queries.
    lotId: bigint('lot_id', { mode: 'number' }).references(() => inventoryLots.id),
    reportedAt: timestamp('reported_at', { withTimezone: true }).notNull().defaultNow(),
    reportedById: bigint('reported_by_id', { mode: 'number' }),
    onsetAt: timestamp('onset_at', { withTimezone: true }),
    severity: text('severity').notNull(),
    outcome: text('outcome'),
    description: text('description').notNull(),
    symptomsCoded: jsonb('symptoms_coded'),
    treatmentGiven: text('treatment_given'),
    reportedToAuthorityAt: timestamp('reported_to_authority_at', { withTimezone: true }),
    authorityReferenceNumber: text('authority_reference_number'),
    rowVersion: integer('row_version').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }),
  },
  (t) => [
    index('adverse_events_patient_idx').on(t.tenantId, t.patientId),
    index('adverse_events_tenant_created_idx').on(t.tenantId, t.createdAt),
    uniqueIndex('adverse_events_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

// No display_id: scoped to clinical_order via FK.
export const clinicalOrderScheduleChanges = pgTable(
  'clinical_order_schedule_changes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    clinicalOrderId: bigint('clinical_order_id', { mode: 'number' })
      .notNull()
      .references(() => clinicalOrders.id),
    oldDate: date('old_date'),
    newDate: date('new_date').notNull(),
    reason: text('reason'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
    changedById: bigint('changed_by_id', { mode: 'number' }),
  },
  (t) => [index('co_schedule_changes_order_idx').on(t.clinicalOrderId, t.changedAt)],
)

// ---------------------------------------------------------------------------
// Domain 5 (new tables) — Inventory & Traceability
// ---------------------------------------------------------------------------

// New journal table — distinct from existing inventory_transactions (Phase 4: dropped).
// Source of a movement is expressed via typed FKs (clinical_order_id,
// inventory_adjustment_id, inventory_transfer_id) — no polymorphic entity_id.
export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // MVT_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    lotId: bigint('lot_id', { mode: 'number' })
      .notNull()
      .references(() => inventoryLots.id),
    // Denormalized from lot.branch_id — populated at insert. HIGH audit finding.
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branches.id),
    movementType: movementTypeEnum('movement_type').notNull(),
    quantityDelta: numeric('quantity_delta', { precision: 12, scale: 4 }).notNull(),
    unitCostSnapshot: numeric('unit_cost_snapshot', { precision: 12, scale: 4 }),
    // Typed FK refs (bigint). Forward refs to inventory_transfers added in 0000_initial.sql.
    clinicalOrderId: bigint('clinical_order_id', { mode: 'number' }),
    inventoryAdjustmentId: bigint('inventory_adjustment_id', { mode: 'number' }),
    inventoryTransferId: bigint('inventory_transfer_id', { mode: 'number' }),
    notes: text('notes'),
    performedById: bigint('performed_by_id', { mode: 'number' }).notNull(),
    performedAt: timestamp('performed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }),
  },
  (t) => [
    index('inventory_movements_lot_time_idx').on(t.tenantId, t.lotId, t.performedAt),
    index('inventory_movements_clinical_idx').on(t.clinicalOrderId),
    index('inventory_movements_tenant_branch_idx').on(t.tenantId, t.branchId, t.performedAt),
  ],
)

// 1:1 with inventory_lots. PK = lot_id (no surrogate id, no display_id).
export const inventoryLotBalances = pgTable('inventory_lot_balances', {
  lotId: bigint('lot_id', { mode: 'number' })
    .primaryKey()
    .references(() => inventoryLots.id),
  tenantId: text('tenant_id').notNull(),
  branchId: bigint('branch_id', { mode: 'number' }).notNull(),
  productId: bigint('product_id', { mode: 'number' })
    .notNull()
    .references(() => products.id),
  quantityOnHand: numeric('quantity_on_hand', { precision: 12, scale: 4 }).notNull(),
  quantityReserved: numeric('quantity_reserved', { precision: 12, scale: 4 })
    .notNull()
    .default('0'),
  quantityAvailable: numeric('quantity_available', { precision: 12, scale: 4 }).notNull(),
  lastMovementAt: timestamp('last_movement_at', { withTimezone: true }),
  weightedAverageCost: numeric('weighted_average_cost', { precision: 12, scale: 4 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const productRecalls = pgTable(
  'product_recalls',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // RCL_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    // Recall scope: NULL = any product (batch_number pattern only),
    // non-NULL = restrict to matching product. Replaced service_id in 0011.
    productId: bigint('product_id', { mode: 'number' }).references(() => products.id),
    // External recall reference (FDA, manufacturer, etc.)
    recallNo: text('recall_no'),
    manufacturer: text('manufacturer'),
    affectedLotsPattern: text('affected_lots_pattern'),
    recallReason: text('recall_reason').notNull(),
    recallSeverity: text('recall_severity').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    patientNotificationRequired: boolean('patient_notification_required').notNull().default(true),
    rowVersion: integer('row_version').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }),
  },
  (t) => [
    index('product_recalls_tenant_idx').on(t.tenantId),
    uniqueIndex('product_recalls_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

// ---------------------------------------------------------------------------
// Domain 6 (new tables) — Billing, AR & Claims
// ---------------------------------------------------------------------------

export const claims = pgTable(
  'claims',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // CLM_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    payerId: bigint('payer_id', { mode: 'number' })
      .notNull()
      .references(() => payerProfiles.id),
    payerContractId: bigint('payer_contract_id', { mode: 'number' }),
    patientId: bigint('patient_id', { mode: 'number' })
      .notNull()
      .references(() => patients.id),
    encounterId: bigint('encounter_id', { mode: 'number' }),
    transactionId: bigint('transaction_id', { mode: 'number' }),
    // claim_no: payer-facing reference number.
    claimNo: text('claim_no').notNull(),
    externalClaimNumber: text('external_claim_number'),
    status: claimStatusEnum('status').notNull().default('Draft'),
    loaNumber: text('loa_number'),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }),
  },
  (t) => [
    uniqueIndex('claims_tenant_claim_no_uniq').on(t.tenantId, t.claimNo),
    index('claims_payer_status_idx').on(t.tenantId, t.payerId, t.status),
    uniqueIndex('claims_tenant_id_uniq').on(t.tenantId, t.id),
    // Partial hot-status index: active claims (not finalized).
    index('claims_tenant_status_active_idx')
      .on(t.tenantId, t.status, t.submittedAt)
      .where(sql`deleted_at IS NULL`),
  ],
)

export const claimItems = pgTable(
  'claim_items',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // CLI_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    claimId: bigint('claim_id', { mode: 'number' })
      .notNull()
      .references(() => claims.id),
    transactionItemId: bigint('transaction_item_id', { mode: 'number' })
      .notNull()
      .references(() => transactionItems.id),
    serviceCode: text('service_code'),
    diagnosisLinkPositions: jsonb('diagnosis_link_positions'),
    quantity: numeric('quantity', { precision: 8, scale: 2 }).notNull(),
    billedAmount: numeric('billed_amount', { precision: 12, scale: 2 }).notNull(),
    approvedAmount: numeric('approved_amount', { precision: 12, scale: 2 }),
    deniedAmount: numeric('denied_amount', { precision: 12, scale: 2 }),
    denialCode: text('denial_code'),
    rowVersion: integer('row_version').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }),
  },
  (t) => [
    index('claim_items_claim_idx').on(t.claimId),
    uniqueIndex('claim_items_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

// ---------------------------------------------------------------------------
// Domain 8 (new tables) — System, Security & Audit
// ---------------------------------------------------------------------------

// Polymorphic: owner_id stays TEXT (stores display_id of the referenced entity, per spec #9).
export const attachments = pgTable(
  'attachments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // ATT_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    ownerType: text('owner_type').notNull(),
    // Polymorphic: stores display_id string of the owner entity (per spec #9).
    ownerId: text('owner_id').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageBackend: text('storage_backend').notNull(),
    storageKey: text('storage_key').notNull(),
    contentHashSha256: text('content_hash_sha256').notNull(),
    isEncrypted: boolean('is_encrypted').notNull().default(true),
    category: text('category'),
    metadata: jsonb('metadata'),
    uploadedById: bigint('uploaded_by_id', { mode: 'number' }),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('attachments_owner_idx').on(t.tenantId, t.ownerType, t.ownerId),
    uniqueIndex('attachments_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

// No display_id: HIPAA/DPA access log queried by (user, patient, timestamp).
// Polymorphic context_entity_id stays TEXT (stores display_id per spec #9).
export const phiAccessLog = pgTable(
  'phi_access_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id').notNull(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    sessionId: bigint('session_id', { mode: 'number' }),
    // H8 follow-up: nullable so list-endpoint access events (bulk PHI reads,
    // no single patient identified at the URL) can be logged. Per-patient
    // audit queries must filter `WHERE patient_id IS NOT NULL` explicitly.
    patientId: bigint('patient_id', { mode: 'number' }),
    accessType: text('access_type').notNull(),
    accessReason: text('access_reason'),
    isBreakGlass: boolean('is_break_glass').notNull().default(false),
    contextEntityType: text('context_entity_type'),
    // Polymorphic: stores display_id string of the context entity.
    contextEntityId: text('context_entity_id'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('phi_access_user_time_idx').on(t.tenantId, t.userId, t.timestamp),
    index('phi_access_patient_idx').on(t.tenantId, t.patientId, t.timestamp),
  ],
)

// No display_id: outbox-pattern event source consumed by workers.
// `aggregate_id` stays TEXT — domain events serialize display_id strings per spec #11.
export const domainEvents = pgTable(
  'domain_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    eventType: text('event_type').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    // Stores the aggregate's display_id (per spec #11: payloads carry display_ids).
    aggregateId: text('aggregate_id').notNull(),
    payload: jsonb('payload').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishAttempts: integer('publish_attempts').notNull().default(0),
    lastPublishError: text('last_publish_error'),
  },
  (t) => [
    index('domain_events_unpublished_idx').on(t.tenantId, t.occurredAt),
    index('domain_events_aggregate_idx').on(t.aggregateType, t.aggregateId),
  ],
)

export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // NTP_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    channel: notificationChannelEnum('channel').notNull(),
    language: text('language').notNull().default('en'),
    subject: text('subject'),
    body: text('body').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    rowVersion: integer('row_version').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }),
  },
  (t) => [
    uniqueIndex('notification_templates_tenant_code_lang_uniq').on(
      t.tenantId,
      t.code,
      t.channel,
      t.language,
    ),
    uniqueIndex('notification_templates_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

export const approvalDecisions = pgTable(
  'approval_decisions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // APD_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    approvalRequestId: bigint('approval_request_id', { mode: 'number' })
      .notNull()
      .references(() => approvalRequests.id),
    decision: text('decision').notNull(),
    decidedById: bigint('decided_by_id', { mode: 'number' }).notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('approval_decisions_request_idx').on(t.approvalRequestId),
    uniqueIndex('approval_decisions_request_decider_uniq').on(t.approvalRequestId, t.decidedById),
  ],
)

// Phase-1 DPA execution evidence. One approved request can be consumed once;
// the reports deliberately distinguish primary-store de-identification from
// statutory completion (attachments/backups may remain owner actions).
export const dpaErasureExecutions = pgTable(
  'dpa_erasure_executions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // DER_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    approvalRequestId: bigint('approval_request_id', { mode: 'number' })
      .notNull()
      .references(() => approvalRequests.id),
    patientDisplayId: text('patient_display_id').notNull(),
    executedById: bigint('executed_by_id', { mode: 'number' })
      .notNull()
      .references(() => users.id),
    requestReference: text('request_reference').notNull(),
    rollbackReference: text('rollback_reference').notNull(),
    impactReport: jsonb('impact_report').notNull(),
    completionReport: jsonb('completion_report').notNull(),
    rollbackReport: jsonb('rollback_report').notNull(),
    executedAt: timestamp('executed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('dpa_erasure_executions_approval_uniq').on(t.approvalRequestId),
    index('dpa_erasure_executions_tenant_patient_idx').on(t.tenantId, t.patientDisplayId),
  ],
)

// One-time emergency lease for the repository-native account-recovery tool.
// It never creates credentials or roles; execution can only unlock one
// existing active TenantAdmin in the named tenant.
export const emergencyAccessGrants = pgTable(
  'emergency_access_grants',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // EAG_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    incidentId: text('incident_id').notNull(),
    targetUserId: bigint('target_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id),
    purpose: text('purpose').notNull(),
    approvalRequestId: bigint('approval_request_id', { mode: 'number' })
      .notNull()
      .references(() => approvalRequests.id),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('emergency_access_grants_tenant_incident_idx').on(t.tenantId, t.incidentId),
    uniqueIndex('emergency_access_grants_approval_uniq').on(t.approvalRequestId),
    index('emergency_access_grants_expiry_idx').on(t.expiresAt),
  ],
)

// ---------------------------------------------------------------------------
// Status history tables (one per status-bearing entity)
// ---------------------------------------------------------------------------

// All *_status_history tables: bigserial-only (no display_id; queried by parent entity_id).
// `entity_id` stores the parent row's bigint PK as text — kept text to remain compatible
// with the existing audit trigger pattern that writes the polymorphic ref as text.
// Tables now use bigint refs throughout for `changed_by_id`.

export const patientStandingOrdersStatusHistory = pgTable(
  'patient_standing_orders_status_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id').notNull(),
    entityId: bigint('entity_id', { mode: 'number' }).notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    reason: text('reason'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
    changedById: bigint('changed_by_id', { mode: 'number' }),
    metadata: jsonb('metadata'),
  },
  (t) => [index('pso_status_history_entity_idx').on(t.tenantId, t.entityId, t.changedAt)],
)

export const clinicalOrdersStatusHistory = pgTable(
  'clinical_orders_status_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id').notNull(),
    entityId: bigint('entity_id', { mode: 'number' }).notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    reason: text('reason'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
    changedById: bigint('changed_by_id', { mode: 'number' }),
    metadata: jsonb('metadata'),
  },
  (t) => [index('co_status_history_entity_idx').on(t.tenantId, t.entityId, t.changedAt)],
)

export const encountersStatusHistory = pgTable(
  'encounters_status_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id').notNull(),
    entityId: bigint('entity_id', { mode: 'number' }).notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    reason: text('reason'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
    changedById: bigint('changed_by_id', { mode: 'number' }),
    metadata: jsonb('metadata'),
  },
  (t) => [index('encounters_status_history_entity_idx').on(t.tenantId, t.entityId, t.changedAt)],
)

export const transactionsStatusHistory = pgTable(
  'transactions_status_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id').notNull(),
    entityId: bigint('entity_id', { mode: 'number' }).notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    reason: text('reason'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
    changedById: bigint('changed_by_id', { mode: 'number' }),
    metadata: jsonb('metadata'),
  },
  (t) => [index('txn_status_history_entity_idx').on(t.tenantId, t.entityId, t.changedAt)],
)

export const claimsStatusHistory = pgTable(
  'claims_status_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id').notNull(),
    entityId: bigint('entity_id', { mode: 'number' }).notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    reason: text('reason'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
    changedById: bigint('changed_by_id', { mode: 'number' }),
    metadata: jsonb('metadata'),
  },
  (t) => [index('claims_status_history_entity_idx').on(t.tenantId, t.entityId, t.changedAt)],
)

export const labOrdersStatusHistory = pgTable(
  'lab_orders_status_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id').notNull(),
    entityId: bigint('entity_id', { mode: 'number' }).notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    reason: text('reason'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
    changedById: bigint('changed_by_id', { mode: 'number' }),
    metadata: jsonb('metadata'),
  },
  (t) => [index('lab_orders_status_history_entity_idx').on(t.tenantId, t.entityId, t.changedAt)],
)

export const appointmentsStatusHistory = pgTable(
  'appointments_status_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id').notNull(),
    entityId: bigint('entity_id', { mode: 'number' }).notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    reason: text('reason'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
    changedById: bigint('changed_by_id', { mode: 'number' }),
    metadata: jsonb('metadata'),
  },
  (t) => [index('appt_status_history_entity_idx').on(t.tenantId, t.entityId, t.changedAt)],
)

// ---------------------------------------------------------------------------
// Day summary snapshots — archival capture of the EOD Day Summary aggregate
// ---------------------------------------------------------------------------

export const daySummarySnapshots = pgTable(
  'day_summary_snapshots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // DSS_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    snapshotDate: date('snapshot_date').notNull(),
    payload: jsonb('payload').notNull(),
    createdById: bigint('created_by_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('day_summary_snapshots_tenant_branch_date_idx').on(
      t.tenantId,
      t.branchId,
      t.snapshotDate,
    ),
  ],
)

// Analytics tables (analytics.fact_*, analytics.dim_*, analytics.rollup_*) live in supplemental SQL — not Drizzle-managed in Phase 1.

// ---------------------------------------------------------------------------
// Domain X — Biting-animal observation (rabies PEP correctness)
// DOH/WHO SOP: Day-14 followup auto-created at intake; AliveHealthy or
// DiedNaturally+FAT=Negative outcome triggers Day-28 ARV PEP cancellation.
// ---------------------------------------------------------------------------

export const biteSpeciesEnum = pgEnum('bite_species', ['Dog', 'Cat', 'Bat', 'Monkey', 'Other'])

export const animalVaccinationStatusEnum = pgEnum('animal_vaccination_status', [
  'Vaccinated',
  'NotVaccinated',
  'Unknown',
])

export const exposureCategoryEnum = pgEnum('exposure_category', ['I', 'II', 'III'])

export const animalOutcomeEnum = pgEnum('animal_outcome', [
  'AliveHealthy', // Day-14 healthy → cancel Day 28
  'AliveSick',
  'DiedNaturally', // pair with FAT result
  'DiedUnknownCause', // confirmed dead; cause/FAT unknown; never cancel Day 28
  'KilledForTesting',
  'LostToFollowup', // do NOT cancel Day 28
])

export const fatTestResultEnum = pgEnum('fat_test_result', [
  'Positive',
  'Negative',
  'Pending',
  'NotTested',
])

export const biteIncidents = pgTable(
  'bite_incidents',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // BIT_<8 base32>
    // Clinical case file reference (external; printed on case folder).
    incidentNo: text('incident_no'),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    patientId: bigint('patient_id', { mode: 'number' })
      .notNull()
      .references(() => patients.id),
    patientStandingOrderId: bigint('patient_standing_order_id', { mode: 'number' }).references(
      () => patientStandingOrders.id,
    ),
    incidentDate: date('incident_date').notNull(),
    species: biteSpeciesEnum('species').notNull(),
    animalVaccinationStatus: animalVaccinationStatusEnum('animal_vaccination_status').notNull(),
    animalVaccinationDocDate: date('animal_vaccination_doc_date'), // proof from vet
    animalAgeMonths: integer('animal_age_months'),
    exposureCategory: exposureCategoryEnum('exposure_category').notNull(),
    biteSite: text('bite_site').notNull(), // free-text or enum'd later
    requiresObservation: boolean('requires_observation').notNull().default(true),
    metadata: jsonb('metadata'), // free JSONB for SOP-driven facts
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    rowVersion: integer('row_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id),
  },
  (t) => [
    index('bite_incidents_tenant_patient_idx').on(t.tenantId, t.patientId),
    index('bite_incidents_tenant_created_idx').on(t.tenantId, t.createdAt),
    uniqueIndex('bite_incidents_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

export const animalObservationFollowups = pgTable(
  'animal_observation_followups',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // AOF_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    biteIncidentId: bigint('bite_incident_id', { mode: 'number' })
      .notNull()
      .references(() => biteIncidents.id),
    dueDate: date('due_date').notNull(), // incidentDate + 14d
    status: text('status').notNull().default('Pending'), // 'Pending' | 'Completed' | 'Cancelled'
    outcome: animalOutcomeEnum('outcome'), // NULL until completed
    fatTestResult: fatTestResultEnum('fat_test_result'), // only if died/killed
    outcomeObservedAt: timestamp('outcome_observed_at', { withTimezone: true }),
    outcomeRecordedAt: timestamp('outcome_recorded_at', { withTimezone: true }),
    outcomeRecordedById: bigint('outcome_recorded_by_id', { mode: 'number' }).references(
      () => users.id,
    ),
    notes: text('notes'),
    rowVersion: integer('row_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('animal_followups_tenant_due_idx').on(t.tenantId, t.status, t.dueDate),
    uniqueIndex('animal_followups_tenant_id_uniq').on(t.tenantId, t.id),
    uniqueIndex('animal_followups_incident_uniq').on(t.tenantId, t.biteIncidentId),
    check(
      'animal_followups_status_check',
      sql`${t.status} IN ('Pending', 'Completed', 'Cancelled')`,
    ),
    check(
      'animal_followups_outcome_state_check',
      sql`(${t.status} = 'Completed' AND ${t.outcome} IS NOT NULL AND ${t.outcomeRecordedAt} IS NOT NULL) OR (${t.status} IN ('Pending', 'Cancelled') AND ${t.outcome} IS NULL)`,
    ),
  ],
)

// ---------------------------------------------------------------------------
// Wave 2.3 — Inventory Transfers
// ---------------------------------------------------------------------------

export const inventoryTransferStatusEnum = pgEnum('inventory_transfer_status', [
  'PendingReceipt',
  'Received',
  'Cancelled',
])

export const inventoryTransfers = pgTable(
  'inventory_transfers',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // TRF_<8 base32>
    // Staff-facing reference (printed on transfer slip).
    transferRef: text('transfer_ref'),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    sourceBranchId: bigint('source_branch_id', { mode: 'number' })
      .notNull()
      .references(() => branches.id),
    destinationBranchId: bigint('destination_branch_id', { mode: 'number' })
      .notNull()
      .references(() => branches.id),
    lotId: bigint('lot_id', { mode: 'number' })
      .notNull()
      .references(() => inventoryLots.id),
    destinationLotId: bigint('destination_lot_id', { mode: 'number' }).references(
      () => inventoryLots.id,
    ),
    quantity: numeric('quantity', { precision: 12, scale: 4 }).notNull(),
    status: inventoryTransferStatusEnum('status').notNull().default('PendingReceipt'),
    shippedAt: timestamp('shipped_at', { withTimezone: true }).notNull().defaultNow(),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    shippedById: bigint('shipped_by_id', { mode: 'number' })
      .notNull()
      .references(() => users.id),
    receivedById: bigint('received_by_id', { mode: 'number' }).references(() => users.id),
    cancelledById: bigint('cancelled_by_id', { mode: 'number' }).references(() => users.id),
    notes: text('notes'),
    rowVersion: integer('row_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('inv_transfers_tenant_status_idx').on(t.tenantId, t.status),
    index('inv_transfers_destination_idx').on(t.tenantId, t.destinationBranchId, t.status),
    uniqueIndex('inv_transfers_tenant_id_uniq').on(t.tenantId, t.id),
  ],
)

// ---------------------------------------------------------------------------
// Platform-level users (NOT tenant-scoped)
// ---------------------------------------------------------------------------
// platform_users are infrastructure operators that can access all tenants.
// Intentionally NOT tenant-scoped: no tenant_id, no RLS tenant_isolation policy,
// no audit trigger. Platform admin writes that touch audited tables MUST still
// set app.current_tenant_id to the target tenant inside withPlatformTx.
// Authentication: POST /api/operator/login → JWT with isPlatformAdmin:true.
export const platformUsers = pgTable(
  'platform_users',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // PLU_<8 base32>
    email: citext('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    canLogin: boolean('can_login').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    // TOTP MFA — added 0014_platform_users_mfa.sql. mfa_secret is dev-plaintext
    // today; production deployments MUST encrypt it (see migration COMMENT).
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    mfaSecret: text('mfa_secret'),
    mfaEnrolledAt: timestamp('mfa_enrolled_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    rowVersion: integer('row_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('platform_users_email_uniq').on(t.email)],
)

// ---------------------------------------------------------------------------
// Cross-Branch PHI Access — RFC Steps 2+3 (0026_cross_branch_phi.sql)
// ---------------------------------------------------------------------------

// cross_branch_access_grants — tracks every break-glass access for quarterly
// compliance audit (DPA §20, HIPAA §164.312(b)).
//
// D1 LOCKED DECISION (2026-05-24): persistent per (tenant_id, target_branch_id,
// patient_id). Once a branch breaks glass for a patient, no re-prompting.
// The UNIQUE constraint enforces single-row-per-(tenant+branch+patient).
// No expires_at — D1 overrides the RFC §4.5 "5-minute expiry" narrative.
export const crossBranchAccessGrants = pgTable(
  'cross_branch_access_grants',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    displayId: text('display_id').notNull().unique(), // CBA_<8 base32>
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id),
    // where the user was clocked in (null if system/worker)
    sourceBranchId: bigint('source_branch_id', { mode: 'number' }).references(() => branches.id),
    // the branch whose data was read
    targetBranchId: bigint('target_branch_id', { mode: 'number' })
      .notNull()
      .references(() => branches.id),
    // the patient (required per D1 — every grant is patient-scoped)
    patientId: bigint('patient_id', { mode: 'number' })
      .notNull()
      .references(() => patients.id),
    reasonCategory: text('reason_category').notNull(),
    reasonDetail: text('reason_detail').notNull(),
    // pino-http request correlation id — links to audit_logs rows
    correlationId: text('correlation_id'),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    rowVersion: integer('row_version').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('cba_grants_patient_idx').on(t.patientId, t.grantedAt),
    index('cba_grants_user_idx').on(t.userId, t.grantedAt),
    index('cba_grants_tenant_idx').on(t.tenantId, t.grantedAt),
    // D1 persistent-grant uniqueness: one row per (tenant, target_branch, patient)
    uniqueIndex('cba_grants_tenant_branch_patient_uniq').on(
      t.tenantId,
      t.targetBranchId,
      t.patientId,
    ),
  ],
)

// ---------------------------------------------------------------------------
// Migration control plane — isolated, tenant-scoped, append-only evidence
// ---------------------------------------------------------------------------

export const migrationSchema = pgSchema('migration')

export const migrationRuns = migrationSchema.table(
  'runs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    mode: text('mode').notNull(),
    sourcePackHash: text('source_pack_hash').notNull(),
    cutoffAt: timestamp('cutoff_at', { withTimezone: true }).notNull(),
    importerVersion: text('importer_version').notNull(),
    parentRunId: text('parent_run_id').references((): AnyPgColumn => migrationRuns.id),
    createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('runs_tenant_id_uniq').on(t.tenantId, t.id),
    // A frozen pack is one resumable run for a given migration mode/cutoff and
    // importer build. Retries must resume it rather than create a competing
    // run whose target links cannot be reconciled deterministically.
    uniqueIndex('runs_frozen_pack_identity_uniq').on(
      t.tenantId,
      t.mode,
      t.sourcePackHash,
      t.cutoffAt,
      t.importerVersion,
    ),
    index('runs_tenant_created_idx').on(t.tenantId, t.createdAt),
    check('runs_mode_check', sql`${t.mode} IN ('Rehearsal', 'Baseline', 'CatchUp', 'DeltaAudit')`),
    check('runs_source_pack_hash_check', sql`${t.sourcePackHash} ~ '^[0-9a-f]{64}$'`),
  ],
)

export const migrationRunEvents = migrationSchema.table(
  'run_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    runId: text('run_id').notNull(),
    status: text('status').notNull(),
    detail: jsonb('detail'),
    recordedById: bigint('recorded_by_id', { mode: 'number' }).references(() => users.id),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('run_events_tenant_id_uniq').on(t.tenantId, t.id),
    index('run_events_run_recorded_idx').on(t.tenantId, t.runId, t.recordedAt),
    check(
      'run_events_status_check',
      sql`${t.status} IN ('Started', 'Validated', 'Applying', 'Completed', 'Failed', 'Abandoned')`,
    ),
    foreignKey({
      columns: [t.tenantId, t.runId],
      foreignColumns: [migrationRuns.tenantId, migrationRuns.id],
      name: 'run_events_tenant_run_fk',
    }),
  ],
)

export const migrationSourceSnapshots = migrationSchema.table(
  'source_snapshots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    runId: text('run_id').notNull(),
    sourceIdentity: text('source_identity').notNull(),
    sourceKind: text('source_kind').notNull(),
    driveFileId: text('drive_file_id'),
    revisionId: text('revision_id'),
    driveModifiedAt: timestamp('drive_modified_at', { withTimezone: true }),
    captureStartedAt: timestamp('capture_started_at', { withTimezone: true }).notNull(),
    captureFinishedAt: timestamp('capture_finished_at', { withTimezone: true }).notNull(),
    exportSha256: text('export_sha256').notNull(),
    selectedRanges: jsonb('selected_ranges')
      .notNull()
      .default(sql`'[]'::jsonb`),
    headerFingerprint: text('header_fingerprint'),
    workbookTitle: text('workbook_title'),
    workbookBranchLegacyId: text('workbook_branch_legacy_id'),
    rowCount: integer('row_count'),
    securedArtifactRef: text('secured_artifact_ref').notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('source_snapshots_tenant_id_uniq').on(t.tenantId, t.id),
    uniqueIndex('source_snapshots_run_source_hash_uniq').on(
      t.tenantId,
      t.runId,
      t.sourceIdentity,
      t.exportSha256,
    ),
    index('source_snapshots_source_capture_idx').on(
      t.tenantId,
      t.sourceIdentity,
      t.captureFinishedAt,
    ),
    check('source_snapshots_hash_check', sql`${t.exportSha256} ~ '^[0-9a-f]{64}$'`),
    check('source_snapshots_row_count_check', sql`${t.rowCount} IS NULL OR ${t.rowCount} >= 0`),
    check(
      'source_snapshots_capture_order_check',
      sql`${t.captureFinishedAt} >= ${t.captureStartedAt}`,
    ),
    foreignKey({
      columns: [t.tenantId, t.runId],
      foreignColumns: [migrationRuns.tenantId, migrationRuns.id],
      name: 'source_snapshots_tenant_run_fk',
    }),
  ],
)

export const migrationObservations = migrationSchema.table(
  'observations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    snapshotId: bigint('snapshot_id', { mode: 'number' }).notNull(),
    sourceKind: text('source_kind').notNull(),
    sheetName: text('sheet_name'),
    rowNumber: integer('row_number'),
    sourceRowId: text('source_row_id'),
    rowHash: text('row_hash').notNull(),
    payloadSha256: text('payload_sha256').notNull(),
    securedPayloadRef: text('secured_payload_ref').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('observations_tenant_id_uniq').on(t.tenantId, t.id),
    uniqueIndex('observations_version_uniq').on(
      t.tenantId,
      t.snapshotId,
      t.sourceKind,
      t.sheetName,
      t.sourceRowId,
      t.rowNumber,
      t.rowHash,
    ),
    index('observations_snapshot_row_idx').on(t.tenantId, t.snapshotId, t.sheetName, t.rowNumber),
    index('observations_row_hash_idx').on(t.tenantId, t.rowHash),
    check('observations_row_number_check', sql`${t.rowNumber} IS NULL OR ${t.rowNumber} > 0`),
    check(
      'observations_row_locator_check',
      sql`${t.sourceRowId} IS NOT NULL OR ${t.rowNumber} IS NOT NULL`,
    ),
    check('observations_row_hash_check', sql`${t.rowHash} ~ '^[0-9a-f]{64}$'`),
    check('observations_payload_hash_check', sql`${t.payloadSha256} ~ '^[0-9a-f]{64}$'`),
    foreignKey({
      columns: [t.tenantId, t.snapshotId],
      foreignColumns: [migrationSourceSnapshots.tenantId, migrationSourceSnapshots.id],
      name: 'observations_tenant_snapshot_fk',
    }),
  ],
)

export const migrationCanonicalEvents = migrationSchema.table(
  'canonical_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    runId: text('run_id').notNull(),
    canonicalEventKey: text('canonical_event_key').notNull(),
    versionHash: text('version_hash').notNull(),
    eventType: text('event_type').notNull(),
    disposition: text('disposition').notNull(),
    facts: jsonb('facts').notNull(),
    supersedesEventId: bigint('supersedes_event_id', { mode: 'number' }).references(
      (): AnyPgColumn => migrationCanonicalEvents.id,
    ),
    ruleVersion: text('rule_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('canonical_events_tenant_id_uniq').on(t.tenantId, t.id),
    uniqueIndex('canonical_events_version_hash_uniq').on(t.tenantId, t.versionHash),
    index('canonical_events_key_created_idx').on(t.tenantId, t.canonicalEventKey, t.createdAt),
    check('canonical_events_version_hash_check', sql`${t.versionHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'canonical_events_disposition_check',
      sql`${t.disposition} IN ('SafeWrite', 'Withhold', 'ManualReview', 'EvidenceOnly')`,
    ),
    foreignKey({
      columns: [t.tenantId, t.runId],
      foreignColumns: [migrationRuns.tenantId, migrationRuns.id],
      name: 'canonical_events_tenant_run_fk',
    }),
  ],
)

export const migrationEventEvidence = migrationSchema.table(
  'event_evidence',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    eventId: bigint('event_id', { mode: 'number' }).notNull(),
    observationId: bigint('observation_id', { mode: 'number' }).notNull(),
    evidenceRole: text('evidence_role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.eventId, t.observationId, t.evidenceRole] }),
    check(
      'event_evidence_role_check',
      sql`${t.evidenceRole} IN ('Assertion', 'Support', 'Contradiction')`,
    ),
    foreignKey({
      columns: [t.tenantId, t.eventId],
      foreignColumns: [migrationCanonicalEvents.tenantId, migrationCanonicalEvents.id],
      name: 'event_evidence_tenant_event_fk',
    }),
    foreignKey({
      columns: [t.tenantId, t.observationId],
      foreignColumns: [migrationObservations.tenantId, migrationObservations.id],
      name: 'event_evidence_tenant_observation_fk',
    }),
  ],
)

export const migrationDecisions = migrationSchema.table(
  'decisions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    runId: text('run_id').notNull(),
    disposition: text('disposition').notNull(),
    reasonCode: text('reason_code').notNull(),
    rationale: text('rationale').notNull(),
    payloadHash: text('payload_hash').notNull(),
    payload: jsonb('payload').notNull(),
    decidedById: bigint('decided_by_id', { mode: 'number' })
      .notNull()
      .references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('decisions_tenant_id_uniq').on(t.tenantId, t.id),
    uniqueIndex('decisions_payload_hash_uniq').on(t.tenantId, t.payloadHash),
    check(
      'decisions_disposition_check',
      sql`${t.disposition} IN ('Approved', 'Excluded', 'Rejected')`,
    ),
    check('decisions_payload_hash_check', sql`${t.payloadHash} ~ '^[0-9a-f]{64}$'`),
    foreignKey({
      columns: [t.tenantId, t.runId],
      foreignColumns: [migrationRuns.tenantId, migrationRuns.id],
      name: 'decisions_tenant_run_fk',
    }),
  ],
)

export const migrationTargetLinks = migrationSchema.table(
  'target_links',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    eventId: bigint('event_id', { mode: 'number' }).notNull(),
    targetTable: text('target_table').notNull(),
    targetDisplayId: text('target_display_id').notNull(),
    mutationKind: text('mutation_kind').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('target_links_tenant_id_uniq').on(t.tenantId, t.id),
    uniqueIndex('target_links_idempotency_uniq').on(t.tenantId, t.idempotencyKey),
    uniqueIndex('target_links_event_target_uniq').on(
      t.tenantId,
      t.eventId,
      t.targetTable,
      t.targetDisplayId,
      t.mutationKind,
    ),
    index('target_links_target_idx').on(t.tenantId, t.targetTable, t.targetDisplayId),
    check(
      'target_links_mutation_kind_check',
      sql`${t.mutationKind} IN ('Insert', 'EvidenceOnly', 'Correction', 'VoidReplacement')`,
    ),
    foreignKey({
      columns: [t.tenantId, t.eventId],
      foreignColumns: [migrationCanonicalEvents.tenantId, migrationCanonicalEvents.id],
      name: 'target_links_tenant_event_fk',
    }),
  ],
)

export const migrationExceptions = migrationSchema.table(
  'exceptions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    runId: text('run_id').notNull(),
    priority: text('priority').notNull(),
    code: text('code').notNull(),
    subjectKey: text('subject_key').notNull(),
    summary: text('summary').notNull(),
    detail: jsonb('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('exceptions_tenant_id_uniq').on(t.tenantId, t.id),
    index('exceptions_run_priority_idx').on(t.tenantId, t.runId, t.priority, t.code),
    check('exceptions_priority_check', sql`${t.priority} IN ('P0', 'P1', 'P2', 'P3')`),
    foreignKey({
      columns: [t.tenantId, t.runId],
      foreignColumns: [migrationRuns.tenantId, migrationRuns.id],
      name: 'exceptions_tenant_run_fk',
    }),
  ],
)

export const migrationExceptionEvents = migrationSchema.table(
  'exception_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    exceptionId: text('exception_id').notNull(),
    status: text('status').notNull(),
    decisionId: text('decision_id'),
    ownerUserId: bigint('owner_user_id', { mode: 'number' }).references(() => users.id),
    note: text('note'),
    recordedById: bigint('recorded_by_id', { mode: 'number' }).references(() => users.id),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('exception_events_tenant_id_uniq').on(t.tenantId, t.id),
    index('exception_events_latest_idx').on(t.tenantId, t.exceptionId, t.recordedAt),
    check(
      'exception_events_status_check',
      sql`${t.status} IN ('Open', 'Assigned', 'Resolved', 'Excluded', 'Reopened')`,
    ),
    foreignKey({
      columns: [t.tenantId, t.exceptionId],
      foreignColumns: [migrationExceptions.tenantId, migrationExceptions.id],
      name: 'exception_events_tenant_exception_fk',
    }),
    foreignKey({
      columns: [t.tenantId, t.decisionId],
      foreignColumns: [migrationDecisions.tenantId, migrationDecisions.id],
      name: 'exception_events_tenant_decision_fk',
    }),
  ],
)

export const migrationSyncCheckpoints = migrationSchema.table(
  'sync_checkpoints',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    sourceIdentity: text('source_identity').notNull(),
    runId: text('run_id').notNull(),
    sourcePackHash: text('source_pack_hash').notNull(),
    lastSnapshotId: bigint('last_snapshot_id', { mode: 'number' }).notNull(),
    applicableEventCount: integer('applicable_event_count').notNull(),
    appliedEventCount: integer('applied_event_count').notNull(),
    exceptionCount: integer('exception_count').notNull(),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sync_checkpoints_tenant_id_uniq').on(t.tenantId, t.id),
    uniqueIndex('sync_checkpoints_source_pack_uniq').on(
      t.tenantId,
      t.sourceIdentity,
      t.sourcePackHash,
    ),
    index('sync_checkpoints_latest_idx').on(t.tenantId, t.sourceIdentity, t.checkedAt),
    check('sync_checkpoints_hash_check', sql`${t.sourcePackHash} ~ '^[0-9a-f]{64}$'`),
    check('sync_checkpoints_applicable_count_check', sql`${t.applicableEventCount} >= 0`),
    check('sync_checkpoints_applied_count_check', sql`${t.appliedEventCount} >= 0`),
    check('sync_checkpoints_exception_count_check', sql`${t.exceptionCount} >= 0`),
    check(
      'sync_checkpoints_applied_lte_applicable_check',
      sql`${t.appliedEventCount} <= ${t.applicableEventCount}`,
    ),
    foreignKey({
      columns: [t.tenantId, t.runId],
      foreignColumns: [migrationRuns.tenantId, migrationRuns.id],
      name: 'sync_checkpoints_tenant_run_fk',
    }),
    foreignKey({
      columns: [t.tenantId, t.lastSnapshotId],
      foreignColumns: [migrationSourceSnapshots.tenantId, migrationSourceSnapshots.id],
      name: 'sync_checkpoints_tenant_snapshot_fk',
    }),
  ],
)
