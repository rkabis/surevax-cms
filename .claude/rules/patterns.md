# Key Implementation Patterns

## Tenant-scoped DB access (required for all tenant queries)

```typescript
await db.transaction(async (tx) => {
  await tx.execute(sql`select set_config('app.current_tenant_id', ${tenantId}, true)`)
  await tx.execute(sql`select set_config('app.current_user_id', ${userId}, true)`)
  await tx.execute(sql`select set_config('app.current_branch_id', ${branchId}, true)`)
  // All tenant-scoped queries go through tx here
})
```

Never run `SET LOCAL` in Express middleware on a pooled connection.

The audit trigger (`0002_audit_redaction.sql`) raises an exception when
`app.current_tenant_id` is unset on tenant-scoped writes, so this pattern
is enforced — not optional. Pre-auth-middleware writes that touch
audited tables (e.g. `updateLastLogin` on `users`) must still wrap in
`db.transaction(...)` and resolve the tenant from the row being acted
on. Canonical: `apps/backend/src/modules/auth/db.ts`.

**Reads need the GUC too.** Under FORCE ROW LEVEL SECURITY (the app connects as
the non-superuser `surevax_app` role), a bare `db.select(...)` outside a
`withTenantTx`/`withSystemTx` has no `app.current_tenant_id` set, so
`tenant_isolation` filters **every** row → the query returns nothing. This reads
as a spurious "not found", not an error. Resolve display_id → bigint lookups
(patient, provider, etc.) INSIDE the request's tenant transaction, not before
it. Real bug (2026-06-04): `/api/arrivals/atomic` did its patient + provider
existence checks with bare `db` reads pre-transaction → 404 on every commit once
RLS was enforced.

## Admin authorization

Routers under `/api/admin/*` must mount with `requireRole(...)` from
`apps/backend/src/shared/middleware/requireRole.ts`. Without it, any
authenticated user reaches the admin endpoints. The current allow-list
for admin routes is `requireRole('TenantAdmin','BranchAdmin')`.
`TenantAdmin` is the canonical name (Wave 2.2); `SuperAdmin` is kept in the
enum for backward-compat only.

```typescript
import { requireRole } from './shared/middleware/requireRole.js'
app.use('/api/admin/users', requireRole('TenantAdmin', 'BranchAdmin'), adminUsersRouter)
```

`requireRole` is a coarse gate — it does NOT compare caller vs target
privilege. Handlers that assign roles or mutate another user's credentials
need an explicit in-handler check (F1, 2026-06-12 review): in
`admin/users.ts`, only a TenantAdmin caller may assign an admin-level role
(`TenantAdmin`/`SuperAdmin`/`BranchAdmin`) or change the password/roles/PIN
of a user holding one — otherwise 403 `ROLE_ESCALATION_FORBIDDEN`. Apply the
same caller-vs-target pattern to any new admin endpoint that mutates users.
Tests: `apps/backend/tests/integration/admin-users-privilege.test.ts`.

### Admin writes on an all-roles router: gate per-route, not at the mount

Not every admin-only endpoint lives under `/api/admin/*`. When a router mixes
reads every clinical role needs with admin-only writes, `requireRole` goes on
the individual write routes in `routes.ts`; on the `app.ts` mount it would 403
the reads. Canonical `/api/services` (2026-08-03); same shape in `patients`,
`bite_incidents`, `inventory_transfers`, `audit`, `product_recalls`. Three
things it needs beyond the middleware:

- A comment at the `app.ts` mount saying the bare mount is deliberate, so the
  next reader does not "fix" it by gating the router and breaking the pickers.
- A frontend mirror, so the affordance hides instead of 403ing. Role sets live
  in `apps/frontend/src/lib/roles.ts` (`CATALOG_WRITE_ROLES` is the exact
  mirror of this gate) and must match the backend list exactly: a wider
  frontend set is how you ship a button that always fails.
- A test proving BOTH allowed roles still get through, not just one.

Never widen a catalog or config write to `Branch`: it is a shared, day-scoped
account on an unattended front desk. Tests:
`apps/backend/tests/integration/services-write-guard.test.ts`.

## Cross-branch visibility via user_branches (no allowAccess flag)

Branch-scoped access is controlled by the `branch_isolation` RLS policy
(Wave 2.1, defined in `0001_extensions_and_rls.sql` § 8b). There is **no
`allowAccess` flag** — access is presence in `user_branches`.

- `withTenantTx({ tenantId, userId, branchId: BRANCH_ID }, ...)` restricts
  reads/writes to that branch via the RLS `app.current_branch_id` GUC.
- `withTenantTx({ tenantId, userId, branchId: null }, ...)` (or `branchId: ''`)
  leaves `app.current_branch_id` empty, which the RLS policy interprets as
  "no branch filter" → cross-branch reads for the tenant. This is the
  established convention for admin/system operational reads (login lookup,
  FHIR export, getPatientDemographicProjection). Do NOT add a throw here.
- Users that appear in multiple `user_branches` rows can access those branches.
  Query `user_branches` for the list; do not assume `primary_branch_id` is
  the only accessible branch.
- Platform admins (`withPlatformTx`) bypass both `tenant_isolation` AND
  `branch_isolation` via the `app.is_platform_admin = 'true'` GUC.
- Canonical: `apps/backend/src/shared/db/withTenantTx.ts` (`withTenantTx` +
  `withPlatformTx`).

## Break-glass cross-branch PHI reveal

When a clinical user opens a patient whose `home_branch_id` differs from the
caller's branch, the frontend shows a cross-branch banner. The full chart
(Tier-2 encounters + transactions at the home branch) is gated behind the
`BreakGlassReveal` modal, which requires a typed reason before calling
`POST /api/patients/:id/break-glass`.

**`app.cross_branch_read` GUC:**

- Set `'true'` when `branchId: null` (tenant-wide operational reads) OR when
  `crossBranchRead` is present on `TenantCtx`.
- The `branch_isolation` USING clause honors `cross_branch_read='true'` for
  SELECT. The WITH CHECK clause does NOT — writes are always branch-scoped.
- This means break-glass is **read-only by design at the DB layer**. A
  cross-branch write attempt (INSERT/UPDATE with a different branch_id) will
  be rejected by the WITH CHECK even with `cross_branch_read='true'`.

**`crossBranchRead` option on `withTenantTx`:**

```typescript
await withTenantTx(
  {
    tenantId,
    userId,
    branchId: callerBranchId, // the SOURCE branch (where user is clocked in)
    crossBranchRead: {
      reason: 'Continuity_of_care',
      reasonDetail: 'Patient mid-PEP series at other branch',
      patientId: 42, // bigint
      targetBranchId: 7, // bigint
      correlationId: 'req-uuid',
    },
  },
  async (tx) => {
    /* cross-branch reads here */
  },
)
```

When `crossBranchRead` is present: sets `cross_branch_read='true'`, then
emits `audit_logs` row (`action='CROSS_BRANCH_ACCESS'`) AND inserts a
`cross_branch_access_grants` row `ON CONFLICT DO NOTHING` (D1 persistent
model — no re-prompt at the same branch for the same patient).

**Admin operational cross-branch (NOT break-glass):** Admin endpoints reading
tenant-wide data (audit.ts, branches.ts, users.ts) use `branchId: null` and
do NOT emit grant rows. Grants are reserved for genuine PHI chart reveal.

**Quarterly review:** `/admin/cross-branch-access` lists all grants for
retrospective audit. `docs/specs/cross-branch-phi-access.md` checks off a
"Quarterly review SOP at `docs/runbooks/cross-branch-access-review.md`" item,
but that runbook was never actually written: the path does not exist in
`docs/runbooks/`. Until it is authored, use the spec's DPA §20 security-measures
section (near the end of the doc) as the interim reference.

## Platform admin (cross-tenant) DB access

```typescript
import { withPlatformTx } from './shared/db/withTenantTx.js'

// Cross-tenant read — no targetTenantId needed
await withPlatformTx({ platformUserId }, async (tx) => {
  return tx.select().from(tenants)
})

// Write to audited table — targetTenantId required (audit trigger guard)
await withPlatformTx({ platformUserId, targetTenantId: 'SVX' }, async (tx) => {
  await tx.insert(auditLogs).values({ ... })
})
```

Never write to audited tenant-scoped tables inside `withPlatformTx` without
supplying `targetTenantId` — the audit trigger raises if `app.current_tenant_id`
is unset.

## CSRF defense

Backend rejects state-changing requests (`POST/PUT/PATCH/DELETE`) that
lack `X-Requested-With: fetch`. The custom header forces a CORS preflight
which the strict origin allow-list blocks from non-allowed origins.

Every frontend `apiFetch` (one per `features/*/api.ts`) sends the header
on every request, including the 401-then-refresh-retry path. New `api.ts`
files copied from the canonical `patients/api.ts` already include it —
keep it that way. Direct `fetch(...)` calls (login pages, logout) need
the header too.

GET requests do not need the header. The middleware only checks
state-changing methods.

## JWT issuer + audience claims (H5, landed 2026-05-23)

All access tokens carry `iss: 'surevax-cms'`. Tenant tokens carry `aud: 'surevax-tenant'`;
operator tokens carry `aud: 'surevax-operator'`. Defined as constants in
`apps/backend/src/modules/auth/service.ts`:

```typescript
const ISSUER = 'surevax-cms'
const TENANT_AUD = 'surevax-tenant'
const OPERATOR_AUD = 'surevax-operator'
```

`verifyAccess` checks `issuer` only (entry point for both types). `verifyOperatorAccess`
additionally checks `audience: OPERATOR_AUD` — the middleware calls it as a second pass
after discriminating via `isOperatorPayload()`. This closes cross-audience minting: a
tenant token presented to an operator-guarded path is rejected because its
`aud: surevax-tenant` doesn't match. A future follow-up should split `ACCESS_SECRET`
into `ACCESS_SECRET_TENANT` / `ACCESS_SECRET_OPERATOR` for full isolation.

## Backend module structure

```
apps/backend/src/modules/{feature}/
├── contract.ts  # Zod request schemas (runtime validators) + response schemas
│                # (wire truth) + defineContract manifest — codegen source
├── routes.ts    # Express routes (imports schemas from ./contract.js;
│                # every success res.json carries `satisfies <X>Response`)
├── service.ts   # Business logic + DB transactions
└── db.ts        # Drizzle queries
```

Contract conventions + the `pnpm gen:contracts` / drift-gate workflow:
`gotchas.md` "Schema ↔ Zod ↔ frontend field parity". Canonical module:
`apps/backend/src/modules/scheduled_orders/`. Not all modules are converted
yet — unconverted ones keep inline Zod in routes.ts; convert on next touch.

## List + detail endpoint convention

Every domain exposes `GET /api/<resource>` (list) and `GET /api/<resource>/:id` (detail).

- Detail endpoints return the row joined with related entities so the frontend
  detail drawer renders every DB column without N+1 calls.
- All queries inside `db.transaction(async (tx) => { ... })` with RLS context.
- Use `Promise.all` for parallel relation fetches (e.g. transactions: header,
  items, payments fetched concurrently).
- Return 404 if `(tenant_id, id)` lookup misses; 400 on bad UUID via inline Zod.

Canonical: `apps/backend/src/modules/transactions/db.ts` (`getTransaction`).

### List response envelope — bare array, not `{data: [...]}`

Backend list endpoints return the rows as a **bare JSON array**:
`res.json(rows)`. Frontend consumers read `await res.json()` directly,
not `(await res.json()).data`. This is the convention across every
`features/*/api.ts` file — see `apps/frontend/src/features/patients/api.ts`
and `apps/backend/src/modules/patients/routes.ts` for the canonical pair.

Mismatch is a silent renderer-empty bug: `data?.data ?? []` against a
bare-array response always yields `[]`, the list page renders empty,
typecheck doesn't catch it. Real instance: PR #241 (2026-05-09).

When porting a frontend caller from another codebase, strip any
`.data` unwrap. When adding a new backend list endpoint, return the
array directly — don't wrap it in `{data, total}` or `{items}`. If
pagination metadata is genuinely needed, surface it via response
headers (`X-Total-Count`) rather than reshaping the body.

### Backend ↔ Zod ↔ frontend field parity

Every nullable/optional column added to a route's request body must
exist in three places, with matching names:

1. **DB schema** — `apps/backend/src/shared/db/schema.ts`
2. **Backend Zod** — inline in the route or service file
3. **Frontend type** — in `apps/frontend/src/features/<feature>/api.ts`

Drift between these layers is the dominant silent-bug class in this
codebase. The 2026-05-09 review batch found 4 such bugs in 10 PRs:

- a `name` field collected by the frontend, validated by Zod, but
  with no DB column → silent insert drop, PATCH error at DB layer
- a `serviceType` field PATCHable from the UI, missing from the route
  Zod and the `UpdateServiceInput` type → silent drop on save
- worker code referencing `subject_template`/`body_template` columns
  that don't exist in `notification_templates` → MAX_ATTEMPTS loop on
  first event
- Zod requiring a `patientId` that the producer always passed empty →
  every event downstream silently broken

When reviewing or writing a backend module, build a 4-column field
table (DB / Zod-in / Zod-out / frontend type) and eyeball each row.
The `pr-review` skill bakes this into the worker template.

## Frontend detail drawer

Right-side Shadcn `Sheet` (not modal — list stays visible). Renders every DB
column grouped into sections (Identity / Contact / Audit / etc.). Conventions:

- Null fields render as em dash (`—`).
- JSONB fields pretty-printed in `<pre>` via `JSON.stringify(v, null, 2)`.
- Sensitive JSONB keys (`api_key`, `secret`, `token`, `password`, `auth`,
  `credential`) masked before display.
- Drawer hosted by the list page; row is a `<button>` that sets `selectedId`.

Canonical: `apps/frontend/src/features/patients/components/PatientDetail.tsx`.

## Middleware ordering

helmet → cors → rate-limit → auth → tenant → validate

CORS: `credentials: true` + strict origin array (never `*` with cookies).

## Money

- Currency columns: `NUMERIC(12,2)` — never REAL/FLOAT/DOUBLE
- App-level: decimal string or branded decimal type
- Prices snapshot at sale time in `transaction_items.unit_price`
- BIR SC/PWD discount: `(base_price / 1.12) * 0.20` — VAT strip first
- `payments.received_by_id` is the PIN-attested human who took the money;
  `payments.created_by_id` stays the session that typed it. Mirrors
  `administered_by_id` vs `documented_by_id` on `clinical_orders`. See
  `gotchas.md` "Money attestation: who took a payment" for the resolver, the
  role-set difference (Cashier included, Branch excluded), and why
  resolution must happen before the money-moving transaction opens.

### Revenue + AR aggregates exclude Voided / Refunded / Prepayment deposits

When aggregating `SUM(net_amount)` for dashboard cards or day-summary
totals, FILTER out `Voided` and `Refunded` rows **AND** `is_prepayment`
deposits. A voided txn collected nothing; refunds double-deduct if both
the original and the negative refund line count. Outstanding
(`amount_outstanding`) gets the same filter so the AR widget doesn't show
a fake balance for nulled-out txns.

A **prepayment deposit** (`is_prepayment = true`, see "Patient credit" in
`gotchas.md`) is **deferred revenue** — a liability, not income. Its
funding cash is recognized later as a `Credit` payment on the real
consuming transaction. Counting the deposit's `net_amount` AND the
consuming txn's would double-count, so every revenue/AR aggregate (and the
`byMethod` payment breakdown) excludes `is_prepayment = true`.

Canonical (post-#433, prepayment exclusion 2026-06-04):

```sql
COALESCE(SUM(net_amount) FILTER (
  WHERE status NOT IN ('Voided', 'Refunded') AND is_prepayment = false
), 0)::numeric(12,2)::text AS "totalRevenue"
```

Three sites carry the filter: `getTransactionStats` (`todayRevenue`),
`getTransactionDayStats` (`totalRevenue`/`totalUnsettled`/`byMethod`) in
`apps/backend/src/modules/transactions/db.ts`, and `getTransactionSummary`
in `apps/backend/src/modules/day_summary/db.ts`. The list-row totals
(`net_amount` per row) do NOT filter — they show what was on the receipt;
the AGGREGATE is what filters.

**A voided PAYMENT is excluded too** (`payments.voided_at IS NULL`, added
2026-08-02 with payment-method correction). Different axis from the
transaction-level filter above: the bill is untouched and still counts, but
one of its payment ROWS was superseded by a corrected replacement. Anything
that sums or groups `payments` must exclude voided rows, or a corrected
payment counts twice, once as the dead row and once as its replacement.
Fourteen sites carry it: credit derivation and the AR worklist
(`patient_accounts/db.ts`), the cash/non-cash dashboard split, the
day-summary `byMethod` breakdown, the cashier's own collected figure
(`shifts`), drawer reconciliation (`cash_drawer`) and close-out
(`staff_time_logs`), and the analytics revenue fact.

Two surfaces deliberately KEEP voided payment rows visible, and both must
mark them: the patient ledger (projects `paymentVoidedAt`, sets
`affectsBalance: false`) and the transaction detail (projects `voidedAt` +
`voidReason`). A corrected bill rendering two live-looking payments for one
amount reads as a double charge. That is how the missing marker was caught:
by a curl smoke, not by typecheck and not by the test suite.

**A downpayment never moves revenue** (pay-on-account, 2026-07-25). Revenue is
recognised on the bill date (accrual), so `totalRevenue` is invariant to how
many installments settle a bill; only `amount_paid`/`amount_outstanding` move
as legs land. Do not "fix" the revenue aggregates to follow collections.

Internal `Credit` payments (a patient-credit draw, see `gotchas.md` "Patient
credit / prepayment") must also be excluded from CASH/collected aggregates:
they reallocate money already collected on a deposit, not new cash in the
door. Two real bugs fixed alongside pay-on-account (2026-07-25):
`getDashboardStats`'s `cashSplit.nonCash` filtered `method <> 'Cash'`, so a
`Credit` draw counted as a non-cash collection; `shifts.getCurrentShift`'s
`collected` summed every payment method with no `Voided`/`Refunded`/
`deleted_at` filter, so a cashier's own figure inflated on any of those. Both
now exclude `Credit` explicitly; `shifts` also joins `transactions` for the
status/deleted-at filter.

### BIR receipt_no allocation on Paid transition

`addPaymentTx` in `apps/backend/src/modules/transactions/db.ts` calls
`allocateCounter({ counterKind: 'BIR_RECEIPT', branchId: null })` when
the payment pushes status to `Paid` AND `receipt_no` is still null.
Allocation is per-tenant (NOT per-branch — BIR ORs are tenant-issued).
Format: 8-digit zero-padded counter value. The column type is `text`,
so a future BIR-registration migration can rewrite the format
(`YYYY-NNNNNNNN`, OR-series prefix, etc.) without a schema change.

### Per-branch transaction sequence (branch_seq)

`createTransaction` allocates from `counter_kind='TXN'` per branch
inside the existing `withTenantTx`. The value stores in
`transactions.branch_seq` and surfaces in `TransactionDetail` +
`AcknowledgementReceipt` ("Branch Txn #" line). Distinct from
`display_id` (random `TXN_xxx`); reads as "Nth transaction at this
branch" for reporting. Legacy / seeded rows stay `branch_seq=NULL`.

## Development sequence

1. Zod schemas in the module's `contract.ts` (+ `@surevax/shared` for frontend-shared validation)
2. Drizzle migrations
3. Express routes + Zod validation middleware + `satisfies` response assertions
4. `pnpm gen:contracts` → commit the regenerated `apps/frontend/src/api/contracts/*.gen.ts`
5. TanStack Query hooks (typing from the generated contract types)
6. Feature-based UI components

> **Moved to the `db-migrations` skill** (load on demand): online-safe DDL, FK cascade conventions, negative-inventory CHECK and 23514 to 409.

## Drizzle ORM — known gaps + workarounds

Drizzle's DSL doesn't express several Postgres features. Workers keep
rediscovering these — handle them once via supplemental SQL.

| Feature                                   | Workaround                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GENERATED ALWAYS AS … STORED`            | Declare column as plain typed in `schema.ts`; emit the GENERATED clause in baseline SQL. App code treats it read-only. Canonical: `transactions.amount_outstanding`.                                                                                                                                                                                                                              |
| `EXCLUDE` constraints (GIST + btree_gist) | Hand-written in baseline SQL (`0001_extensions_and_rls.sql` enables the extension; the constraint lives near the table DDL).                                                                                                                                                                                                                                                                      |
| Table partitioning                        | Hand-written DDL in baseline SQL. Drizzle has no `PARTITION BY` builder.                                                                                                                                                                                                                                                                                                                          |
| RLS policies                              | Hand-written in `0001_extensions_and_rls.sql`. Drizzle won't generate `ALTER TABLE … ENABLE ROW LEVEL SECURITY` or `CREATE POLICY`.                                                                                                                                                                                                                                                               |
| Trigger functions                         | Hand-written (audit trigger lives in `0002_audit_and_redaction.sql`).                                                                                                                                                                                                                                                                                                                             |
| `bigint` typing                           | Always declare with explicit `mode: 'number'` or `mode: 'bigint'`. Default is string, which silently breaks bigint FK joins. The postgres-js driver is configured to coerce OID 20 → JS Number (`apps/backend/src/shared/db/index.ts`).                                                                                                                                                           |
| `.for('update', { skipLocked: true })`    | Not supported by Drizzle's `.select()` chain. Fall back to raw `sql` for `FOR UPDATE SKIP LOCKED`. Canonical: `apps/backend/src/modules/inventory/fefo.ts`.                                                                                                                                                                                                                                       |
| Composite primary keys                    | Use the table-level `primaryKey({ columns: [...] })` builder, NOT `.primaryKey()` on individual columns. Canonical: `feature_flags`.                                                                                                                                                                                                                                                              |
| Correlated subqueries in `sql` templates  | `${table.col}` renders as the UNQUALIFIED column name inside a raw `sql` template; a nested subquery re-binds it to its own scope (e.g. `co.patient_id = "id"` → `co.id`), silently destroying the correlation — every outer row gets the same result. Write the outer reference as a qualified literal (`"patients"."id"`). Caught live 2026-06-12 in the patients-list `doseStates` projection. |
| Chaining `.insert()` → bigint FK          | Always `.returning({ id: x.id })` so the bigint round-trips. Without `.returning()`, the driver returns nothing and the downstream FK insert dies with `null`.                                                                                                                                                                                                                                    |

## Bundle fan-out vs. Standing-Order (SOT) flow

These are two distinct creation paths for `clinical_orders`; don't conflate them.

| Path           | Trigger                                                                    | Helper                                             | Work-order type                       |
| -------------- | -------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------- |
| Standing-Order | arrivals Day-0 intake, `POST /api/arrivals/…`                              | `standing_orders/db.ts`                            | `Standing_Order` — multi-day schedule |
| Bundle fan-out | `POST /api/transactions` when `service_bundle_items` exist for the service | `clinical_orders/bundleFanOut.ts` (`fanOutBundle`) | `Ad_Hoc` — single point-of-sale event |

**Stock deduction differs by path.** The dose path deducts the lot the NURSE
picked (`deductLot`, required `administerBody.lotId`); bundle fan-out has no
clinician in the loop and keeps the automatic earliest-expiry pick
(`pickEarliestExpiringLot`). Both live in `modules/inventory/fefo.ts` and share
one write half; eligibility for both comes from `eligibleProductIdsSql`
(`modules/inventory/eligibility.ts`). See `gotchas.md` "Brand selection is manual
at administer time".

**Bundle detection**: `isBundleService(tenantId, serviceId, tx)` — returns true if any `service_bundle_items` row exists for the service.

**Fail-whole-bundle atomicity**: `fanOutBundle` runs inside the SAME `withTenantTx` as the transaction header insert. If any constituent fails stock (`pickEarliestExpiringLot` throws) or is inactive, `BundleFanOutError` propagates and Postgres rolls back the entire transaction.

**Panel constituents are intentionally `isActive = false`**: The 32 hidden lab-test rows in `service_catalog` (category `Diagnostics — Panel Constituents (hidden)`) carry `isActive = false` to hide them from orderable-service lists. They are still orderable through the bundle — `fanOutBundle` skips the `isActive` check for Lab-type constituents.

**The bundle stays the single billable line in `transaction_items`**: fan-out creates `clinical_orders` + `lab_orders` only; pricing and `transaction_items` writes are untouched.

> **Moved to the `db-migrations` skill** (load on demand): online-safe DDL, FK cascade conventions, negative-inventory CHECK and 23514 to 409.

## DPA right-to-erasure (purge_patient) — dry-run only

`apps/backend/drizzle/0007_retention_procs.sql` defines
`purge_patient(p_patient_display_id text, p_dry_run boolean DEFAULT true)`
(folded in from the pre-consolidation `0018_dpa_purge_function.sql`, which no
longer exists as a separate file post-2026-05-07 baseline consolidation).

Two-layer gate:

1. **SQL layer**: `p_dry_run = true` returns cascade counts per
   child table. `p_dry_run = false` raises Postgres error 0A000
   (`feature_not_supported`) with code `DPA_PURGE_NOT_ENABLED`.
2. **Express layer**: `POST /api/admin/dpa/purge` requires
   `acknowledgeDryRun: true` literal in the body (Zod
   `z.literal(true)`). This is defense-in-depth above the SQL gate so
   a downstream mis-edit can't accidentally enable a live purge without
   removing both guards.

Endpoint mount: `app.use('/api/admin/dpa', requireRole('TenantAdmin'),
adminDpaRouter)`. Platform admins are explicitly rejected (their
`user.id` is null).

To unblock live purge, all of the following must land in one PR:

- Nightly worker (`apps/backend/src/workers/dpaPurger/`) that processes
  `patients.scheduled_purge_at < now()` rows
- Multi-approver workflow via the existing `approval_requests` infra
- R2 attachment cleanup with audit row insertion (`action='DELETE'`,
  `metadata.reason='dpa_erasure'`)
- BIR retention exemption logic (anonymize transactions / payments /
  claims; honor 10-year clinical retention)

See `docs/handovers/archive/2026-05-19-remaining-todos.md` §5 B2 (consolidated into `docs/STATUS.md`).

## Consent revocation enforcement gate (`assertActiveConsent`) — H7 (DPA §19 + §34(b))

`apps/backend/src/shared/utils/consent.ts` exports `assertActiveConsent(tx, tenantId, patientId)`. It runs inside the CALLER's existing `withTenantTx` (no new tx opened) and throws `LifecycleError('Active patient consent required', 'CONSENT_REVOKED', 403)` when no active (`revokedAt IS NULL AND deletedAt IS NULL`) consent row exists for the patient. Phase 1 semantics: any non-revoked consent satisfies the gate (type/scope discrimination is a follow-up). The gate is called at the START of every clinical-write path: `administerOrderTx` (scheduled_orders/db.ts), the `withTenantTx` callback in `createLabOrder` (lab_orders/db.ts), `createEncounter` (encounters/db.ts), and `fanOutBundle` (clinical_orders/bundleFanOut.ts). Seeded patients always have one active consent row so fresh-seed smoke tests pass.

## PHI access logging (H8 — default-on approach)

`apps/backend/src/shared/middleware/phiAccessLog.ts` logs all `/api/*` GETs **by default**
except paths in the `NON_PHI_PREFIXES` constant at the top of the file.

**When adding a new router:**

- If it serves PHI (patient records, clinical data, transactions): no action needed — it
  is automatically logged.
- If it is NOT PHI (config, HR data, aggregate stats, webhooks, auth flows): add its
  prefix to `NON_PHI_PREFIXES` in the middleware file.

**Patient ID resolution:** `phi_access_log.patient_id` is nullable. It is declared that
way in the consolidated baseline (`0000_initial.sql`, `"patient_id" bigint` with no NOT
NULL) and carries no `.notNull()` in `schema.ts`; there is no separate migration for it.
An earlier version of this section claimed NOT NULL and that list endpoints could not be
logged until a follow-up migration landed. Both were wrong: `phiAccessLog.ts` already
writes bulk rows with `patientId: null`. The middleware resolves
the patient FK for known detail-endpoint patterns (patient, encounter, clinical-order,
lab-order, adverse-event, bite-incident, scheduled-order, transaction, appointment); list
endpoints without a single identified patient log via the bulk branch with `patientId: null`.
Per-patient audit queries must filter `WHERE patient_id IS NOT NULL` explicitly.

**Why a bulk-access worklist can't live under `/api/patients`**: the `PATIENT_DETAIL` regex
(`phiAccessLog.ts`) matches any `/api/patients/...` path and tries to resolve `displayId` as
a patient row. A clinic-wide list mounted there (e.g. `displayId='accounts-receivable'`)
would miss that lookup, and `writePhiLogWithSelect` returns early WITHOUT inserting a row
when the select misses, so a bulk PHI read of every debtor would go silently unlogged
(DPA §20(c)(4)). Mount bulk-read worklists under their own prefix instead, so they fall
through to the bulk branch and log with `patientId: null`. Canonical:
`/api/accounts-receivable` (`patient_accounts/routes.ts`), added to `RESOURCE_TYPE_MAP` and
deliberately absent from `NON_PHI_PREFIXES`.

**Known non-PHI paths** (currently in allowlist): `/api/auth/*`, `/api/operator/*`,
`/api/payments/webhooks`, `/api/csrf-token`, `/api/feature-flags`, `/api/health`,
`/api/ready`, `/api/services`, `/api/payer-profiles`, `/api/partner-labs`, `/api/places`,
`/api/standing-order-templates`, `/api/dashboard`, `/api/day-summary`, `/api/shifts`,
`/api/staff-time-logs`, `/api/cash-drawer`, `/api/inventory`, `/api/inventory-transfers`,
`/api/attachments`, `/api/branch`, `/api/admin/users`, `/api/admin/attendance`,
`/api/admin/approvals`, `/api/admin/branches`, `/api/admin/notifications`,
`/api/admin/product-recalls`, `/api/admin/standing-orders`,
`/api/admin/patient-standing-orders`, `/api/admin/patients`, `/api/admin/dpa`.

> **Moved to the `testing` skill** (load on demand): frontend jsdom/MSW component layer, BEGIN/ROLLBACK integration-test isolation.
