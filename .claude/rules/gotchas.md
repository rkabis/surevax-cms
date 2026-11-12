# Known Gotchas — core (always loaded)

High-frequency gotchas that touch most code paths. Low-frequency / single-module
gotchas live in the `gotchas` skill (load on demand by reading
`.claude/skills/gotchas/SKILL.md` when touching that module). Skill index:

- Cross-site cookies (Cloudflare Pages → Railway)
- `Date` in Drizzle `sql` template literals
- Shadcn/ui CLI workaround
- Deterministic display IDs in seed
- JWT secret validation (≥32 chars, looksDev)
- `EXPOSE_ERRORS` debug knob
- Pino logger redact paths
- Refresh-token persistence + rotation
- Test credentials table
- Branch role + `can_login`
- `audit_logs.entityType` / `entityId` column naming
- Inventory deduction helpers (`deductLot` for the nurse-picked dose lot, `pickEarliestExpiringLot` for POS bundle fan-out) + brand-specific pricing (`service_prices.product_id`)
- PSO date-math sibling-by-index pairing
- `consent_records.encounterId` silent-skip
- Drizzle migration marker survives `DROP SCHEMA public`

Newly added (2026-05-09 review batch lessons): tenant in WHERE, schema↔Zod↔frontend parity, bare-array list envelope, format:check before commit. See sections below.

Newly added (2026-07-30): administering-clinician PIN attestation, payer-profile
pricing of vaccines, branch codes now match the clinic's own initials (`TMG`, not
`TIM`). See sections below.

Newly added (2026-08-02): correcting a posted payment's method is void +
reissue, never an in-place UPDATE; a voided payment is excluded from every
money aggregate but stays VISIBLE (and marked) on the ledger and the
transaction detail. See section below.

Newly added (2026-06-03 cross-branch PHI step 10): `withTenantTx` deviation — do NOT throw on `branchId: null`; `crossBranchRead` break-glass pattern; `emitCrossBranchAccessAudit` canonical files. See section below.

## Display IDs — two-tier model (landed 2026-05-19)

Every entity table has `id bigserial PRIMARY KEY` (internal) + `display_id text NOT NULL UNIQUE`.
FKs are `bigint`. The public handle for clients is `display_id`; API responses
alias bigint id → display_id in `.select()` projections so the bigint never
leaks. The frontend types all IDs as `string` end-to-end.

**Helper API** (`apps/backend/src/shared/utils/displayId.ts` and the shared mirror):

- `displayId('PAT')` → `'PAT_K9MX3VQ2'` (random 8-char Crockford base32)
- `branchDisplayId('SVX', 'HST')` → `'SVX.HST'`
- `formatMrn(seq)` → `'MRN-000042'`
- `displayIdSchema` / `prefixedDisplayIdSchema('PAT')` — Zod schemas

**Tenant slug:** `SVX` (formerly `TEN-SUREVAX`). It IS the `tenants.id` PK (text).
**Branch code:** 3 uppercase letters (e.g. `HST`); branch display*id = `{slug}.{code}` e.g. `SVX.HST`.
**Patient MRN:** `nextval('mrn_seq*<slug>')`per-tenant, formatted`MRN-NNNNNN`.

**JWT payload** carries display*ids: `{ userId: 'USR*…', tenantSlug: 'SVX', branchCode: 'HST' }`.
Auth middleware resolves to bigint at request time.

**Tables WITHOUT display_id** (bigserial-only): all `*_status_history`, `audit_logs`,
`domain_events`, `phi_access_log`, `encounter_vitals`/`encounter_diagnoses`,
`patient_allergies`/`patient_conditions`/`patient_emergency_contacts`/`patient_external_immunizations`/`patient_tags`,
`clinical_order_schedule_changes`, `notifications`, `refresh_tokens`,
`user_sessions`, `password_reset_tokens`.

**Tables with TEXT PKs (no bigserial)**: `tenants.id` = slug; `service_catalog.id` = raw catalog code
(e.g. `ARVPEP_IM`); `standing_order_templates.id` = template code; `feature_flags` composite PK
`(tenant_id, branch_id, key)`.

**postgres-js bigint coercion** (`apps/backend/src/shared/db/index.ts`): OID 20 returns JS Number.
All bigint columns declared with `mode: 'number'`. Safe to 2^53 ≈ 9 quadrillion.

The legacy helpers `randomId`, `yearId`, `childId`, `codeId`, `tenantScopedCodeId`, `idSchema`,
`prefixedIdSchema` are **gone**. Stale references to legacy formats (`PAT-K9MX3VQ2P5`, `TXN-2026-…`,
`TEN-SUREVAX`, `PAT-….ENC-2026-…`) anywhere in code/docs should be updated. See
[`docs/handovers/archive/2026-05-18-id-redesign.md`](../../docs/handovers/archive/2026-05-18-id-redesign.md)
for the full table-by-table mapping.

## Catalog/inventory product abstraction (2026-05-17 cleanup, migration 0016)

`products`, `service_categories`, `service_bundle_items`, and **`service_eligible_products`** (new in 0016) form the catalog. Each abstract service can draw from many products at administer-time.

- **products** = physical SKU (one Abhayrab batch). **service_catalog** = abstract orderable entity (`ARVPEP_IM` is one row, NOT eight `ARVPEP_ABHAYRABIM`/`SPEEDAIM`/partner variants). The nurse picks the brand at administer-time.
- **service_eligible_products** = junction (tenant-scoped, RLS) listing which products satisfy each abstract service. `ARVPEP_IM ← Abhayrab (default, ranking 0) + Speeda (ranking 1)`. `is_default`/`ranking` order the administer picker (house brand first, then earliest expiry within the brand). Eligibility is the UNION of legacy `service_catalog.product_id` and this junction — always via `eligibleProductIdsSql` (`modules/inventory/eligibility.ts`), never re-inlined.
- **service_categories** is the structured replacement for `service_catalog.category` text. Both coexist; the text column lingers for back-compat.
- **service_bundle_items** lists constituents of a bundle catalog row (diagnostic panels SV01–SV23, TFT1, CA125). The bundle stays the billable unit in `service_catalog` + `service_prices`; constituents expand to `lab_orders` at order time.
- 32 panel-only lab tests (Sodium, AMH, FSH, Iron, CRP-HS, Troponin-I HS, etc.) exist in `service_catalog` purely to satisfy the `service_bundle_items.item_service_id` FK. They carry `isActive = false` and category `Diagnostics — Panel Constituents (hidden)`. **List endpoints that show "orderable services" must filter `isActive = true`.**
- New `administration_route` enum values: `INF` (wound infiltration, for ERIG/HRIG), `PO` (per-os/oral, for Cholera). Full set: `IM | SC | ID | IV | PO | IN | Topical | INF`. Don't use `'Oral'` — not a valid enum value.
- `service_catalog.requires_dose_calculation = true` → UI must show a weight-based dose calculator (ERIG, HRIG, HTIG, ATS) instead of accepting `defaultDoseVolumeMl`.

## Partner-rate pricing via service_prices (not catalog rows)

Partner / corporate-wellness pricing (Hati Health, Forticare, MedAsia, Philbritish) is **driven by `service_prices.payer_id`**, not by `_HH` / `_FC` / `_MEDASIA` / `_PB` catalog suffix variants. Those duplicate catalog rows were dropped in PR #351/#354. The same abstract service has multiple `service_prices` rows; `resolveServicePrice` selects by payer at sale time. New payer profiles seeded:

| Constant            | Display ID       | Use                                        |
| ------------------- | ---------------- | ------------------------------------------ |
| `PAYER_HATI_HEALTH` | `PYR-AAAAAAAAA5` | Hati Health corporate wellness             |
| `PAYER_FORTICARE`   | `PYR-AAAAAAAAA6` | Forticare uplift pricing                   |
| `PAYER_MEDASIA`     | `PYR-AAAAAAAAA7` | MedAsia / Forticare / LLBI partner network |
| `PAYER_PHILBRITISH` | `PYR-AAAAAAAAA8` | Philbritish discount for consultation      |

## Doctor attribution via transaction_items.performed_by_id

Per-physician revenue attribution (consultation by Lacuarin vs Lintag vs Tecson vs Uy) is **driven by `transaction_items.performed_by_id`** FK to `users`, not by per-physician catalog rows. The `SERVICE_CONSULTATION_LACUARIN` etc. variants were dropped in PR #351/#354. Single `SVC_CONSULTATION` + single `SVC_MEDCERT` services; attending physician recorded on the txn item at sale time. Added in migration 0016 alongside `service_eligible_products`.

## Schema v2 cutover complete (Phase 4 — 2026-05-07)

Dual-write pairs collapsed; only the new shape exists. If code still references the dropped objects below it is stale — replace with the new shape.

| Dropped (no longer in DB)                  | Use instead                                                  |
| ------------------------------------------ | ------------------------------------------------------------ |
| `inventory_transactions` table             | `inventory_movements` + `inventory_lot_balances`             |
| `consent_records` table                    | `consents` (polymorphic via `scope_ref_type`/`scope_ref_id`) |
| `users.role` column                        | `user_roles` junction + `userPrimaryRoleSql()` helper        |
| `users.branch_id` column                   | `user_branches` junction + `users.primary_branch_id`         |
| `service_catalog.base_price` column        | `service_prices` (via `resolveServicePrice` helper)          |
| `staff_time_logs.float_amount`             | `cash_drawer_sessions.opening_float`                         |
| `staff_time_logs.drawer_state`             | `cash_drawer_sessions.state`                                 |
| `clinical_orders.completed_by_id`          | `administered_by_id` + `documented_by_id`                    |
| `patients.allergies` / `.conditions` JSONB | `patient_allergies` / `patient_conditions` rows              |
| `patient_tags.tag` (text)                  | `patient_tags.tag_definition_id` → `tag_definitions.tag`     |
| `lab_orders.result_file_url`               | `lab_orders.result_file_attachment_id` → `attachments`       |

`apps/backend/src/shared/db/userViews.ts` exports `userPrimaryRoleSql(usersIdColumn)` — drop into a Drizzle `.select(...)` projection where the legacy `users.role` column would have gone. Auth's role precedence matches the SQL CASE order.

The transitional dual-write migrations were collapsed into a clean baseline in [#228](https://github.com/njvil/surevax-cms-revamp/pull/228) (2026-05-07): the 32-file sequence (`0000_handy_galactus.sql` … `0028_retention_jobs.sql`) is now `0000_initial.sql` plus seven supplemental files (`0001_extensions_and_rls.sql`, `0002_audit_and_redaction.sql`, `0003_invariants.sql`, `0004_immutability_and_generated.sql`, `0005_modern_pg.sql`, `0006_fhir_views.sql`, `0007_retention_procs.sql`). See [`docs/handovers/archive/2026-05-01-schema-v2-phase1.md`](../../docs/handovers/archive/2026-05-01-schema-v2-phase1.md) for the original migration history.

> **Moved to the `gotchas` skill** (load on demand) — see its description for the topic list.

## Tenant resolution — Phase 2 dynamic (no silent fallback)

`apps/backend/src/shared/middleware/tenant.ts` resolves the tenant in this priority: JWT claim → `X-Tenant-Slug` header (or subdomain) → `X-Dev-Tenant-Id` header (dev only) → 400 `TENANT_REQUIRED`. There is **no silent fallback** (production or test). The `NODE_ENV=test` + `PHASE_1_TENANT_ID` env fallback that existed until the rewritten integration suite landed was removed alongside the suite cutover.

Implications:

- Production deploys must serve clinics on a subdomain (e.g. `clinicname.surevax.com`) or callers must send `X-Tenant-Slug`. The `tenants.slug` column is the lookup key.
- Local dev: set `X-Tenant-Slug: SVX` (the seeded slug — `tenants.id` and `tenants.slug` carry the same value) on every pre-auth request, OR set `X-Dev-Tenant-Id: SVX`.
- Integration tests: pass `X-Tenant-Slug: SVX` explicitly or set a JWT — no env fallback covers you.
- DB helpers in modules **never read tenant IDs from `process.env`** — accept `tenantId` from the route (`req.tenant.id`) and pass into `withTenantTx({ tenantId, userId, branchId }, async tx => ...)`.

## JSONB columns require `JSON.stringify`

Postgres `jsonb` via postgres.js / Drizzle requires a JSON string, not a JS object. Passing a raw object fails:

```
TypeError [ERR_INVALID_ARG_TYPE]: The "string" argument must be of type string
```

`JSON.stringify(...)` every value bound to a `jsonb` column — including arrays (`allergies`, `conditions`, `tags`) and structured payloads (`api_config`, `result_data`, `changes`). Canonical: `apps/backend/src/shared/db/seed.ts`.

**The raw `postgres` npm client is the opposite.** Integration tests that talk
to Postgres directly via `postgres(...)` (not the app's Drizzle client) use a
tagged-template query, and casting a bound parameter with `::jsonb` there
double-encodes an already-`JSON.stringify`'d value (the result is a jsonb
value holding a JSON string, not the object). Pass the plain JS object in the
raw-client tagged template and let the driver serialize it once:

```ts
// Drizzle (app code): stringify first.
await db.insert(table).values({ notes: JSON.stringify({ foo: 'bar' }) })

// Raw postgres client (tests): pass the object, no JSON.stringify.
await sql`INSERT INTO some_table (payload) VALUES (${{ foo: 'bar' }}::jsonb)`
```

Getting this backwards on the raw client silently stores a JSON string
instead of a JSON object, so a later `payload ->> 'foo'` read returns `null`
instead of the value. Surfaced while writing a raw-client fixture insert for
`apps/backend/tests/integration/void-side-effects.test.ts` (the fixture no
longer casts a JSONB column directly, but the distinction still applies to
any future raw-client test that does). `withGucs` in that file is the
canonical example of the raw-client transaction-scoped GUC pattern in
general.

## `numeric` columns serialize as string

`numeric(12,2)` arrives as a JSON string ("2500.00"), not a number. Frontend types must declare `string`; currency display parses explicitly. Never assume a numeric column is a number.

## `transactions.amount_outstanding` is a GENERATED column

`amount_outstanding` is rebuilt as `GENERATED ALWAYS AS
(GREATEST(net_amount - amount_paid, 0)) STORED` by
`0004_immutability_and_generated.sql`. Direct UPDATE on this column raises a
Postgres error. Drizzle still declares it as a regular column (no
`.generatedAlwaysAs(...)`) for SELECT projection — read-only at runtime.
The `sync_transaction_amounts` trigger on payments updates `amount_paid`;
`amount_outstanding` recomputes automatically. If you ever need to write
it, you're holding it wrong — mutate `amount_paid` (or `net_amount`)
instead.

> **Moved to the `gotchas` skill** (load on demand) — see its description for the topic list.

## Correcting a payment's method is void + reissue, never an UPDATE (2026-08-02)

A nurse who picks the wrong tender (Cash instead of GCash) corrects it via
`POST /api/transactions/:id/payments/:paymentId/correct-method`, which voids
the original `payments` row and inserts a replacement inside one
`withTenantTx`. **Never `UPDATE payments SET method`**: the row is already
bound to a `cash_drawer_session_id` and already consumed by the `byMethod` /
`cashSplit` aggregates, so mutating it in place retroactively falsifies a
drawer count that may already be closed and signed off.

Voiding the WHOLE transaction is the wrong tool and the API refuses it
anyway: `voidTransaction` throws `REFUND_REQUIRED` on a `Paid` transaction
that has payments. The bill, its items, its `branch_seq` and its BIR receipt
must all survive; only the money leg moves.

Why the mechanism works, and what breaks if you change a piece:

- Voiding drops `amount_paid` via `sync_transaction_amounts` (which filters
  `voided_at IS NULL`), reopening the GENERATED `amount_outstanding` by
  exactly the amount being reissued. That is what lets the replacement pass
  `addPaymentTx`'s MONEY-5 cap. Remove the trigger's filter and the voided
  row keeps counting, so the reissue double-counts.
- `status` stays `Paid` throughout: the `0004` immutability trigger forbids
  `Paid` to anything but Voided/Refunded, and the trigger's recompute rides
  `pg_trigger_depth() > 1` so it bypasses that check. Consequently
  `addPaymentTx`'s `ALREADY_PAID` guard tests `status === 'Paid' &&
outstandingCents <= 0`, NOT status alone. Reverting it to status alone
  refuses every correction of a fully-paid bill.
- `receipt_no` survives because `addPaymentTx` only mints when it is NULL.
- The replacement is attributed to the CORRECTING user's currently-open
  drawer session (resolved inside `addPaymentTx`), never the original's. A
  closed session's `expected_total` is a stored snapshot and
  `computeCashFigures` is only ever called on `state = 'Open'`, so a
  correction can never rewrite a signed-off count.
- `payments_tenant_txn_method_ref_uniq` also excludes voided rows, otherwise
  correcting away and back with the same reference number is permanently
  blocked by the row just voided.

**The superseded row stays visible and MUST be marked.** `GET
/api/transactions/:id` projects `voidedAt` + `voidReason` per payment; the
patient ledger projects `paymentVoidedAt` with `affectsBalance: false`.
Without the marker a corrected PHP 250 bill renders two live payments
totalling PHP 500, which reads as a double charge. `replacedByPaymentId`
exists on the table but is deliberately NOT exposed (bigint leak).

**The approval gate was REMOVED from correction (2026-08-02), kept for void
and refund.** Until then, `Cash` to non-Cash above
`MANAGER_APPROVAL_THRESHOLD_CENTS` used to file an approval request
(`operation: 'payment_correction'`). The owner's standing decision
(2026-07-06) is that record corrections are inline, warned and logged, NOT an
approval queue: `approval_requests` is reserved for the void/refund money
thresholds only, unchanged below. The gate also routed to a `BranchAdmin`
approver role no real user holds on the shared `Branch` login, making it an
unresolvable dead end there. `MoneyApprovalOperation` is now `'void' |
'refund'` only; `enforceMoneyApprovalGate` no longer has a
`payment_correction` case. See "Money attestation" below for what replaced
it: PIN-attested identity of who performed the correction, plus a
`touchesClosedPeriod` flag recorded for reporting, never blocking.

**`Credit` is refused in both directions** (`CREDIT_NOT_CORRECTABLE`): a
Credit row is a draw against a patient deposit whose remaining balance is
DERIVED by summing live draws, so reissuing one outside `applyPrepayment`
desyncs it.

Grep markers + files: `correctPaymentMethod`, `CREDIT_NOT_CORRECTABLE`,
`ALREADY_VOIDED`, `voided_at IS NULL`:
`apps/backend/src/modules/transactions/{db,contract,routes}.ts`,
`apps/backend/drizzle/0009_payment_void.sql`,
`apps/frontend/src/features/transactions/components/CorrectPaymentMethodDialog.tsx`,
`apps/backend/tests/integration/payment-method-correction.test.ts`. The
aggregate exclusion list is in `patterns.md` "Revenue + AR aggregates".

## Money attestation: who took a payment (2026-08-02)

`payments.received_by_id` used to be the shared `Branch` service account for
every payment taken at the front desk (across 108 nurses on one kiosk), so
per-cashier collection figures and any money audit trail were unattributable
to a human. This mirrors the dose-administration gap fixed 2026-07-30 (see
"Who administered the dose is PIN-attested, not the login" above) and reuses
the exact same mechanism: `resolveMoneyHandler` in
`apps/backend/src/shared/utils/clinicianAttestation.ts` shares one core
resolver (`resolveAttestedUser`) with `resolveAdministeringClinician`, just a
different role set and copy.

The rule (identical to the dose path):

- A caller who is a real person logged in as themselves (Nurse, Physician,
  BranchAdmin, TenantAdmin, or Cashier) attests implicitly. No named-user
  field, no PIN.
- A caller on the shared `Branch` login MUST name the person and prove it
  with that person's 4-digit kiosk PIN: the same PIN, lockout counters, and
  `pin_attempts` table the clock-in kiosk and dose attestation use.

**Role set differs from the dose path in exactly one place: Cashier is
included, Branch is excluded from both.** `MONEY_HANDLER_ROLES = ['Nurse',
'Physician', 'BranchAdmin', 'TenantAdmin', 'Cashier']` vs
`ADMINISTERING_ROLES` (no `Cashier`). A cashier takes payments but never
administers a dose; `Branch` stays excluded from both because it is the
shared service account both resolvers exist to stop attributing acts to.

**Resolution happens BEFORE the money-moving transaction opens, same rule
as the dose path and for the same reason**: verifying a PIN performs its own
writes (the `pin_attempts` lockout counters via `recordPinFailure` /
`clearPinAttempt`), which must not ride on, or roll back with, a failed
payment. If resolution moved inside the transaction, a wrong PIN's failed
attempt would roll back along with the rejected payment and could be retried
without limit: the lockout would never actually engage. Every money-moving
call site (`addPayment`, `createTransaction`'s inline payment leg(s),
`payOnAccount`, the actor on `correctPaymentMethod`) resolves via
`resolveReceivedById` (`apps/backend/src/modules/transactions/db.ts`) ABOVE
its own `withTenantTx` call. Verified by the integration test asserting
`pin_attempts.failed_count` is non-zero after a payment that itself failed
whole (no payment row written).

**Not attested: `applyPrepayment`.** A Credit draw reallocates money already
collected on an existing deposit; nobody hands anything over at that moment,
so there is nothing to attest.

**`payments.received_by_id` is the attested human, `payments.created_by_id`
stays the session**, mirroring `administered_by_id` vs `documented_by_id` on
`clinical_orders`. On `correctPaymentMethod`, the attested identity is NOT
written to the replacement payment's `received_by_id`: that field
deliberately keeps carrying the ORIGINAL payment's receiver (only the method
was mis-recorded, the money still arrived from whoever took it). The
corrector is recorded as `created_by_id` on the replacement row and as
`correctedByUserId`/`correctedByDisplayId` on the audit metadata instead.

Refusal codes (identical set to the dose path, same copy reusable):
`ATTESTATION_REQUIRED`, `ATTESTATION_PIN_REQUIRED`, `ATTESTATION_PIN_INVALID`,
`ATTESTATION_LOCKED_OUT`, `ATTESTATION_NO_PIN_SET`,
`ATTESTATION_USER_UNKNOWN`, `ATTESTATION_ROLE_INVALID`,
`ATTESTATION_WRONG_BRANCH`.

Grep markers + files: `resolveMoneyHandler`, `resolveReceivedById`,
`MoneyAttestationFields`, `MONEY_HANDLER_ROLES`, `touchesClosedPeriod`:
`apps/backend/src/shared/utils/clinicianAttestation.ts`,
`apps/backend/src/modules/transactions/db.ts`,
`apps/backend/tests/integration/money-attestation.test.ts`.

> **Moved to the `gotchas` skill** (load on demand) — see its description for the topic list.

## Paid transactions / Completed clinical_orders are immutable at the DB layer

BEFORE-UPDATE triggers attached in `0004_immutability_and_generated.sql`
reject most modifications:

- `transactions` rows with `status IN ('Paid','Voided')` — only
  `status → Voided/Refunded`, `deleted_at` change, and the prepayment
  `prepayment_applied_at NULL → timestamp` exemption are allowed.
- `clinical_orders` rows with `status = 'Completed'` — only `deleted_at`
  change is allowed (the prior `patient_id NULL → non-NULL` exemption was
  retired when `clinical_orders.patient_id` became NOT NULL on cutover).

Cascaded UPDATEs from sibling triggers (`pg_trigger_depth() > 1`) bypass
the check, so the `sync_transaction_amounts` payment-recompute path keeps
working. App code that legitimately needs to amend a completed order must
create an amendment row, not mutate the original.

## Audit trigger raises on missing tenant GUC

`audit_log_changes()` (per `0002_audit_and_redaction.sql`) `RAISE EXCEPTION` when `current_setting('app.current_tenant_id', true)` is NULL on a tenant-scoped table. Any write outside `db.transaction(async (tx) => { ... set_config(...) ... })` errors at write time.

Even pre-auth-middleware writes (e.g. `updateLastLogin` in `auth/db.ts`) must wrap in a tenant-scoped transaction — see `auth/db.ts` for the canonical pattern that resolves the tenant from the matched user row.

**Supplemental SQL migrations with UPDATE/INSERT/DELETE hit the same trigger.** The migration runner applies each file in `SUPPLEMENTAL_SQL_FILES` (`apps/backend/src/shared/db/migrate.ts`) via `client.unsafe(sql)` — there is **no app-level transaction wrapper**, so the GUC is unset. Any backfill UPDATE on an audited table will RAISE and crash the boot. The Railway healthcheck then times out and the deploy rolls back.

Wrap row-mutating supplemental SQL in a `DO` block that sets the GUC:

```sql
DO $$
BEGIN
  PERFORM set_config(
    'app.current_tenant_id',
    COALESCE((SELECT tenant_id FROM <target_table> LIMIT 1), 'SVX'),
    true   -- transaction-local; auto-discarded when the DO block ends
  );
  UPDATE <target_table> SET ... WHERE ...;
END $$;
```

**Strict-mode (0024_audit_trigger_strict.sql, landed 2026-05-24):** The trigger now ALSO raises when `app.current_tenant_id` is set but does NOT match the row's `tenant_id` column:

```
audit_log: app.current_tenant_id (%) does not match row tenant_id (%) — cross-tenant write rejected
ERRCODE = insufficient_privilege
```

This means a supplemental SQL `DO $$ set_config $$` wrapper must set `app.current_tenant_id` to the ACTUAL tenant of the rows being mutated — the `COALESCE((SELECT tenant_id FROM <target_table> LIMIT 1), 'SVX')` trick still works for single-tenant tables, but would break on cross-tenant backfill. For multi-tenant backfills, loop per-tenant or accept that strict-mode is the correct guardrail. New code that uses `withTenantTx` is already safe (it sets the GUC to the request's tenant, matching any row it writes).

Previously the GUC only needed to be non-empty. Real incident averted: before strict-mode, a misrouted write (e.g. tenant-A session accidentally INSERTing a row with `tenant_id='tenant-B'`) would succeed — RLS caught the read leak afterward, but the `audit_logs` row was attributed to tenant-A. Strict-mode fails the write at the trigger instead.

Tables NOT audited (safe to UPDATE without the wrapper): `audit_logs` itself, plain junction tables without `tenant_id`. Verify by searching for the table name in the trigger attachment list in `0002_audit_and_redaction.sql` before deciding.

> **Moved to the `gotchas` skill** (load on demand) — see its description for the topic list.

## CSRF: every state-changing fetch needs `X-Requested-With: fetch`

Backend middleware at `apps/backend/src/shared/middleware/csrf.ts` rejects `POST/PUT/PATCH/DELETE` without `X-Requested-With: fetch` (case-insensitive). Returns 403 with `code: 'CSRF_REQUIRED'`. GET requests don't need it.

The canonical `apiFetch` already sends the header on every request including the 401-then-refresh-retry path. When you copy `apiFetch` into a new feature, double-check the header is in the merged `headers` block. Same for direct `fetch(...)` calls (login, logout, debug tooling).

## Admin routes require `requireRole`

Every router under `/api/admin/*` must mount with `requireRole(...)` from `apps/backend/src/shared/middleware/requireRole.ts`. Without it, any authenticated user reaches admin endpoints (security finding #1).

```ts
import { requireRole } from './shared/middleware/requireRole.js'
app.use('/api/admin/users', requireRole('TenantAdmin', 'BranchAdmin'), adminUsersRouter)
```

Roles live in the `user_roles` junction (one row per user-role pair); the legacy `users.role` enum column was dropped in [#217](https://github.com/njvil/surevax-cms-revamp/pull/217). Use `userPrimaryRoleSql(users.id)` from `apps/backend/src/shared/db/userViews.ts` to project the highest-precedence role into a SELECT. Allowed values: `TenantAdmin | BranchAdmin | Physician | Nurse | Cashier | Branch` (Branch is a service-account role, not a human role).

**SuperAdmin → TenantAdmin rename (Wave 2.2, 2026-05-18)**: `SuperAdmin` is kept in the `user_role` enum for back-compat (Postgres cannot remove enum values), but `TenantAdmin` is now baked into the regenerated baseline as a peer enum value. New code must use `TenantAdmin`. The historical SuperAdmin→TenantAdmin data UPDATE was dropped in the 2026-05-18 consolidation — fresh DBs never have SuperAdmin rows. If you see `SuperAdmin` in requireRole calls or ROLE_PRECEDENCE arrays, it is a stale reference — update it.

## Test credentials

| User              | Email                     | Password       | Role          | Notes                                |
| ----------------- | ------------------------- | -------------- | ------------- | ------------------------------------ |
| Tenant Admin      | `admin@surevax.com`       | `TestPass123!` | TenantAdmin   | Login via `POST /api/auth/login`     |
| Platform Operator | `platform@surevax.com`    | `TestPass123!` | PlatformAdmin | Login via `POST /api/operator/login` |
| Branch Account    | `branch-main@surevax.com` | `TestPass123!` | Branch        | Service account for branch kiosk     |

Platform admin JWT payload: `{ isPlatformAdmin: true, sub: 'PLT-AAAAAAAAA1', email: 'platform@surevax.com' }` — no tenantId/branchId.

## `apiFetch` pattern (frontend)

Shared utility at `apps/frontend/src/lib/apiFetch.ts`. All 13 feature `api.ts` files import from it:

```ts
import { apiFetch } from '@/lib/apiFetch'
// or, for features that expose ApiError to callers:
import { apiFetch, ApiError } from '@/lib/apiFetch'
export { ApiError }
```

Key behaviors: `credentials: 'include'`, `X-Requested-With: fetch` on every request (CSRF requirement), 401 → `/api/auth/refresh` retry once, throws `ApiError` (with `statusCode` + optional `code`) on non-2xx. When creating new features, import from `@/lib/apiFetch` — do not write a local copy. The single-flight refresh helper is exported as `getRefresh` (shared with the auth-context bootstrap below).

## Auth bootstrap must not treat transient failures as logout (2026-07-06)

`AuthProvider`'s `/api/auth/me` probe (`apps/frontend/src/features/auth/context.tsx`) resolves the current user on load. It must NOT do the naive `r.ok ? r.json() : null` — that logs the operator out on ANY non-OK response. Two failure modes that are NOT "logged out":

- **`401` with a valid refresh token** — the 15-minute access token merely lapsed (idle tab). Call the shared `getRefresh()` (single-flight, from `apiFetch.ts`) then retry `/me`; only fall through to `null` if refresh also fails. Skip the refresh on `/login` / `/operator/login` (a 401 there is expected and burns the tight credential limiter).
- **`429` / `5xx`** — transient (a request burst tripping the per-IP rate limiter, or a server hiccup). Back off + retry; do NOT drop the session. Retrying is bounded (2 attempts) so it can't amplify a rate-limit storm.

Reverting to "non-OK → `setUser(null)`" reintroduces spurious `/login` bounces (the E2E suite's shared-IP serial run made this reproducible).

## Global rate limit is `600/min` per IP, env-tunable — sized for one clinic behind NAT

`apps/backend/src/app.ts` reads `env.RATE_LIMIT_MAX` (default 600) / `env.RATE_LIMIT_WINDOW_MS` (default 60s). Do NOT hard-code it back to `100`: a whole clinic of staff + dashboard polling shares ONE NAT IP, so 100/min (~1.6 req/s for the entire clinic) starves legit traffic and bounces users to `/login`. This is SEPARATE from the per-route credential limiter in `apps/backend/src/modules/auth/routes.ts` (`authLimiter`, `10/min` on login/refresh/verify-pin) — that one stays tight (brute-force guard).

## `@surevax/shared` imports (backend)

**tsx v4 does NOT resolve `tsconfig.json` paths at runtime.** Named value imports from `@surevax/shared` fail:

```
SyntaxError: The requested module '@surevax/shared' does not provide an export named 'clockInSchema'
```

Define Zod schemas **inline** in each backend module. `@surevax/shared` is for **frontend** and **type-only** imports only — never as values in backend runtime code.

## Tenant in WHERE — defense-in-depth, not optional

PATCH/DELETE/single-row SELECT must include `tenant_id = ${tenantId}` in the WHERE clause even though `db.transaction(...)` already sets `app.current_tenant_id` and RLS would catch the leak. The convention is both layers, always — RLS is the bottom guard, app-level WHERE is the top guard. Real bug: PR #236's PATCH/DELETE matched on `id` only (2026-05-09). Single-row SELECT scope: `WHERE tenant_id = ${tenantId} AND id = ${id}`.

## Schema ↔ Zod ↔ frontend field parity — now enforced by contract codegen

The parity rule (every body field in DB schema **and** route Zod **and** the
feature's `api.ts`, identical names) is **machine-enforced since 2026-06-13**
for the 15 converted modules. How it works
(design: [`docs/specs/api-contract-codegen.md`](../../docs/specs/api-contract-codegen.md)):

- Each module's schemas live in `apps/backend/src/modules/<m>/contract.ts`
  (request Zod = the runtime validators, imported by routes.ts; response Zod =
  authored wire truth). Manifest via `defineContract`; registered in
  `apps/backend/src/contracts/registry.ts`.
- Every success `res.json` carries `satisfies <X>Response` — usually wrapped in
  `wire(...)` (`src/contracts/wire.ts`), which type-maps Date→string the way
  res.json actually serializes. Backend `tsc` fails when implementation and
  contract diverge.
- `pnpm gen:contracts` emits `apps/frontend/src/api/contracts/<feature>.gen.ts`
  (checked in); feature `api.ts` files alias those types. CI drift gate:
  `scripts/check-contract-drift.sh` (in `agent:check`) regenerates and fails on
  diff. Generated files are never hand-edited.
- **When adding/changing an endpoint in a converted module**: edit contract.ts,
  keep the `satisfies` assertion, run `pnpm gen:contracts`, commit the regenerated
  output. New module: create contract.ts (copy `modules/scheduled_orders/contract.ts`),
  add to the registry, regenerate.
- Response-schema rules: bare array stays `z.array(row)`, envelopes stay
  envelopes; `numeric` → `z.string()`; no `.transform()` in responses (generator
  throws); LEFT-joined columns widen to `.nullable()`; bigint-id leaks are
  modeled as `z.number()` with a NOTE comment (capture truth, fix separately).
- `satisfies` cannot catch a payload field MISSING from the contract (structural
  subtyping allows excess) — when authoring a response schema, diff against the
  db.ts projection, not the old frontend type (which may lie).

Historical instances that motivated this (2026-05-09): phantom `name` field (#236, #241), missing `serviceType` in route Zod (#237), worker code referencing non-existent `subject_template`/`body_template` columns (#241), Zod requiring an empty `patientId` (#235). The conversion itself surfaced ~10 more live drift bugs (e.g. appointment cancel sent DELETE to a POST-only route, the bite-incident list never carried the followup it renders, `branchSeq` was dropped from the transaction-detail mapping). Unconverted modules (admin sub-routers, fhir, attachments, branch, shifts, etc.) still rely on the 4-column field-table discipline — convert them on next touch.

## List response is a bare array, not `{data: [...]}`

Backend list endpoints return `res.json(rows)` — a bare JSON array. Frontend reads `await res.json()` directly, NOT `(await res.json()).data`. Mismatch silently renders empty (PR #241, 2026-05-09). When porting from a codebase that uses `{data, total}` envelopes, strip the unwrap. If pagination metadata is needed, surface via response headers (`X-Total-Count`).

Two more instances surfaced via the 2026-05-21 preview-MCP audit and were fixed in [#430](https://github.com/njvil/surevax-cms-revamp/pull/430):

- `features/lab-orders/api.ts` typed `useLabOrders` response as `{ data: LabOrderRow[] }` and `LabOrdersPage` did `data?.data ?? []`. Page rendered "No lab orders yet." for the seeded 5-row fixture.
- `features/appointments/api.ts` had the same shape (`AppointmentsListResponse = { data: Appointment[] }`).

Both unwrapped now. When auditing a list page, run `curl http://localhost:<port>/api/<resource> | jq 'type'` — if it returns `"array"`, the frontend must consume it bare.

A few backends DO return envelopes when sidecars travel with the rows: `/api/patients` (`{ data, nextCursor }`), `/api/inventory` (`{ data, summary }`), `/api/transactions` (`{ data, stats, dayStats }`), `/api/services` (`{ data }`), `/api/scheduled-orders` (`{ data, stats }`), `/api/encounters` (`{ data }`), `/api/accounts-receivable` (`{ data, totals, asOf, scope }`). The shape is whatever the backend actually returns, don't assume.

> **Moved to the `gotchas` skill** (load on demand) — see its description for the topic list.

## `format:check` fails CI before `typecheck` even runs

CI's `Install, typecheck, build` job runs `prettier --check .` as the FIRST step. A green typecheck is not a green CI. Every edit batch must end with:

```
pnpm prettier --write <files-you-touched>
pnpm format:check
```

If `format:check` fails after a localized `--write`, run `pnpm prettier --write .` (whole repo). The PreToolUse hook `.claude/hooks/pr-format-gate.sh` enforces this before `gh pr create`, but amendments to existing PRs bypass that gate — discipline is on you. Lesson: 6 of 10 PRs in the 2026-05-09 review batch needed prettier follow-ups because typecheck was treated as sufficient verification.

## `req.user` typing (backend)

`req.user` is set by `authMiddleware` as `(req as any).user` — no global TS augmentation (unlike `req.tenant`). Import the type from the middleware instead of redeclaring:

```typescript
import type { AuthUser } from '../../shared/middleware/auth.js'
const user = (req as Request & { user: AuthUser }).user
```

The canonical `AuthUser` shape (post-#426):

```typescript
type AuthUser = {
  id: number | null //  bigint; null for platform admins
  displayId: string //  USR_… (or PLU_… for platform)
  email: string
  firstName: string //  empty string for platform admins (no DB row)
  lastName: string //  same
  role: string //  TenantAdmin | BranchAdmin | Physician | Nurse | Cashier | Branch
  tenantId: string | null //  null for platform admins
  branchId: number | null //  bigint, null when no primary branch
  branchCode: string | null //  3-letter text, null when no primary branch
  isPlatformAdmin: boolean
}
```

`firstName` / `lastName` were added in #426 because `AppShell.tsx` reads `user.firstName[0]` for the avatar initials. Without them in the JWT-derived payload, every reload crashed the shell.

Canonical consumer: `apps/backend/src/modules/staff_time_logs/routes.ts`. Don't add a global augmentation without also removing the `(req as any)` cast in `authMiddleware`.
