# Backend, Data, and Architecture Audit

**Audit date:** 2026-08-02
**Initial baseline:** `03fb4e500367854241bff9192d447e2d5f010c3a`
**Current-main reconciliation:** product code at `f743239`, reviewed from audit integration commit `58592303bac8e2ef4184bb2ac0e13d9838d4ad51`
**Scope:** Express APIs, tenant and branch isolation, database invariants and migrations, shared contracts, clinical and financial workflows, workers, import tooling, performance, and test coverage.

## Executive assessment

The codebase has a strong intended data-security design: tenant context is transaction-scoped, current RLS migrations are restrictive for branch-scoped data, audit triggers guard tenant context, and inventory allocation uses a sound locked FEFO pattern. The 158-commit product delta fixed important parts of the initial assessment: ordinary scheduled-order list reads now receive the session branch, normal payments lock the transaction header, patient-account credit draws lock the patient account and source rows, a runtime `surevax_app` role is provisioned, and contract generation has a CI drift gate.

The release gate should remain closed for sensitive multi-branch use until scheduled-order detail, timeline, and preview reads stop opening unaudited cross-branch context, and the still-mounted legacy prepayment endpoint receives the same locking as the newer patient-account flow. AppSheet migration and real notification delivery are also incomplete requirements, not merely operational configuration work.

## Method and limitations

- Read the active requirements baseline and the canonical data, backend API, and workflow context. Historical archive material was excluded.
- Used the current `graphify-out` graph for initial discovery. Its prior extraction was stale relative to the current product commit; `graphify update .` re-extracted code but correctly refused to replace an incomplete graph, so direct-source verification is the evidence used below.
- Reconciled the initial report against the 158-commit `03fb4e5..f743239` product delta. Historical archives and archived handovers were excluded.
- Focused static checks are recorded below. No database integration run was performed from this isolated worktree because it has no provisioned `apps/backend/.env`. This is material because the current test setup substitutes a migration connection that bypasses runtime RLS, as described in BD-07.

## Current-main reconciliation

This section supersedes stale implementation claims in the initial findings below. Status means: **Confirmed** remains materially true, **Changed** has a meaningful partial remediation or materially different evidence, **Resolved** has no remaining reported condition, and **Unable to verify** lacks the required live-environment evidence.

| Initial finding | Status at `f743239` | Current evidence and disposition |
| --- | --- | --- |
| BD-01 scheduled-order cross-branch PHI | **Changed** | The list and administered-log routes now pass `req.user.branchId`, and list queries apply branch predicates. Detail, timeline, and recompute-preview routes still pass only tenant and ID into helpers that call `withTenantTx(... branchId: null)`. That sets `app.cross_branch_read=true` without a break-glass record. The remaining direct-detail paths still expose PHI to an authenticated same-tenant user. |
| BD-02 concurrent payment and prepayment balance | **Changed** | `addPaymentTx` now locks the transaction header before calculating payment totals, and the newer patient-account credit flow locks the patient account, open bills, and credit sources. The active legacy `POST /api/transactions/:id/apply-prepayment` route still calls `applyPrepayment`, whose source and consuming header reads have no `FOR UPDATE`; concurrent draws can still overconsume a deposit. |
| BD-03 public bigint leakage | **Changed** | Scheduled-order user references now join to display IDs, and transaction mappings have been substantially improved. Inventory transfers still return branch, lot, and actor bigint FKs. Notifications still use bigint IDs in route parameters and return raw notification, patient, template, user, and creator IDs. The notifications contract explicitly documents this leak. |
| BD-04 AppSheet writer | **Confirmed** | `drizzleAdapter()` still throws for `resolvePlatformUserId` and `insertBatch`; `runMigration({ dryRun: false })` selects it by default. |
| BD-05 notification delivery | **Confirmed** | The dispatcher only marks a row Sent after `defaultSender.send`, but the installed `LoggingSender` logs and unconditionally returns success. No provider or provider idempotency callback exists. |
| BD-06 shared validation contracts | **Changed** | Sixteen feature contracts now feed generated frontend types and `scripts/check-contract-drift.sh` runs in `agent:check`. Eighteen route modules still import Zod directly, so contracts are not yet the universal API contract source. |
| BD-07 endpoint tests under runtime RLS role | **Confirmed** | Runtime configuration documents `DATABASE_URL` as `surevax_app` with `NOBYPASSRLS`, but global test setup replaces it with `DATABASE_MIGRATOR_URL`. Dedicated policy tests demote to temporary tester roles; the ordinary endpoint suite does not exercise the deployed role. |
| BD-08 unbounded list and recall fan-out | **Confirmed** | Scheduled-order listing still has no cursor or maximum limit. Product recall still selects patients then runs consent lookup, duplicate lookup, and insert serially per patient in one transaction. |
| BD-09 large persistence modules | **Confirmed** | The concentration increased: transactions is 3,236 lines, patients 2,007 lines, and scheduled orders 2,074 lines. The patient-account module adds another 840 lines of financial logic. |

### Current risks requiring follow-up

1. **BD-01 remainder, Critical:** Pass authenticated user and branch context through scheduled-order detail, timeline, and preview helpers. A null branch must not mean unaudited cross-branch access. Keep the explicit `crossBranchRead` object as the only break-glass entry point and verify the grant plus audit row.
2. **BD-02 remainder, Critical:** Retire or repair the legacy apply-prepayment route. Lock source and destination transaction headers in canonical order before reading payment totals, and add two-client contention coverage. The newer patient-account flow is the safer reference implementation.
3. **BD-03 remainder, High:** Treat internal-ID notification and inventory-transfer shapes as public-contract violations. Add display IDs to notifications or replace the API handle with an opaque public ID, resolve related FK display IDs, and reject raw numeric entity IDs in contract tests.
4. **BD-04 and BD-05, High:** A production import still cannot write, and a queued notification can still be marked Sent without leaving the process. Do not describe FR-26 or FR-27 as complete until a transactional importer and real provider/outbox delivery path exist.
5. **BD-07, Medium:** The source provisions a NOBYPASSRLS runtime role, but deployment configuration and endpoint behavior under that role were not verifiable from this worktree. Add a dedicated app-role API integration project and validate Railway environment role assignment separately.
6. **BD-08, Medium:** Add indexed pagination to scheduled orders and replace recall fan-out with a set-based, uniqueness-backed insert. The current `sql.raw(lotIdList)` is built from database-returned numeric IDs, not request text, but it is unnecessary and should be replaced by a bound array when refactoring the fan-out.
7. **Migration and seed state, Medium:** The migration runner intentionally combines a squashed fresh baseline with one live forward supplemental migration. Source comments give a considered upgrade path, but this audit could not run a clean database and an already-deployed upgrade database. The recent seed repair makes repeated seeds more deterministic, but it remains an environment-dependent claim until `db:deploy` plus two `db:seed` runs are exercised.

### Focused verification

- `pnpm --filter @surevax/backend typecheck`: passed.
- `bash scripts/check-contract-drift.sh`: passed. It regenerated the registered frontend contract shapes and found no tracked or untracked drift.
- `pnpm --filter @surevax/backend test:unit`: passed.
- Database-backed concurrency, RLS-role, migration, and seed checks were not run because `apps/backend/.env` is absent. The status above is source-verified, not a live deployment assertion.

Severity reflects impact if the affected path is deployed. Confidence reflects directness of the implementation evidence.

## Initial baseline findings

The findings below preserve the initial `03fb4e5` evidence. Read them with the current-main reconciliation above; where they conflict, the reconciliation is authoritative for current product code.

### BD-01: Scheduled-order APIs create unaudited cross-branch clinical access

**Severity:** Critical
**Confidence:** Confirmed, high

The scheduled-order router is mounted without a role gate at [app.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/app.ts#L245). Its list route passes only tenant, query, and filter to its database helper at [scheduled_orders/routes.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/modules/scheduled_orders/routes.ts#L65), and the detail route does the same at [scheduled_orders/routes.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/modules/scheduled_orders/routes.ts#L104). Neither authenticated user nor branch is included.

Both helpers explicitly invoke `withTenantTx` with `branchId: null`: list at [scheduled_orders/db.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/modules/scheduled_orders/db.ts#L149) and detail at [scheduled_orders/db.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/modules/scheduled_orders/db.ts#L305). `withTenantTx` turns a null branch into `app.cross_branch_read = true` at [withTenantTx.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/shared/db/withTenantTx.ts#L92). The active RLS policy admits those reads when that setting is true at [0001_extensions_and_rls.sql](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/drizzle/0001_extensions_and_rls.sql#L928). The resulting list includes patient contact information at [scheduled_orders/db.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/modules/scheduled_orders/db.ts#L158), while detail returns date of birth, consent, and clinical administration information at [scheduled_orders/db.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/modules/scheduled_orders/db.ts#L422).

This contradicts the branch-isolation requirement in [requirements.md](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/docs/specs/surevax-cms-v2/requirements.md#L20) and the documented break-glass purpose of cross-branch access in [0001_extensions_and_rls.sql](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/drizzle/0001_extensions_and_rls.sql#L910). Any authenticated role able to reach these routes can receive same-tenant, cross-branch PHI without an explicit privilege decision or access audit.

**Remediation:** Thread authenticated `userId` and `branchId` into all scheduled-order service and database calls. Make normal reads branch-scoped. For explicitly authorized cross-branch workflows, require an authorization decision, a reason, and an audit event before setting cross-branch context. Add route-level clinical role middleware.

**Verification:** Seed two branches and call list and detail as an ordinary user from branch A. Confirm branch B records are invisible. Exercise the explicit cross-branch permission path separately and assert an audit record with actor, reason, and target.

### BD-02: Concurrent payments and prepayment application can violate transaction balance

**Severity:** Critical
**Confidence:** Confirmed, high

`addPaymentTx` reads the parent transaction and the current payment sum without locking at [transactions/db.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/modules/transactions/db.ts#L1128), computes outstanding balance in application code, and inserts the payment later at [transactions/db.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/modules/transactions/db.ts#L1227). There is no parent `FOR UPDATE`, serializable retry, or database constraint that caps the aggregate payment amount. The existing migration checks only that each individual payment amount is positive at [0003_invariants.sql](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/drizzle/0003_invariants.sql#L51).

Prepayment application has the same time-of-check to time-of-use race. It reads the source and destination transactions without locks at [transactions/db.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/modules/transactions/db.ts#L1528), totals previous draws at [transactions/db.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/modules/transactions/db.ts#L1569), then delegates to the payment insert at [transactions/db.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/modules/transactions/db.ts#L1598). Its terminal update is not a compare-and-swap at [transactions/db.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/modules/transactions/db.ts#L1615). Sequential overpayment tests exist at [transactions.test.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/tests/transactions.test.ts#L189), but no concurrent contention case protects this behavior.

Two requests with different references can both observe the same outstanding balance or prepayment balance, pass validation, and commit. This breaks FR10's exact financial balance requirement at [requirements.md](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/docs/specs/surevax-cms-v2/requirements.md#L43) and the documented duplicate-payment correctness property at [requirements.md](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/docs/specs/surevax-cms-v2/requirements.md#L100).

**Remediation:** In one database transaction, lock the transaction parent before calculating payment totals. For a prepayment, lock source and destination in canonical ID order before reading either balance. Consider a ledger design or deferred constraint that makes aggregate overpayment impossible even if a future call site bypasses service validation. Require and enforce a durable idempotency key for payment creation, with retries for serialization and uniqueness conflicts.

**Verification:** Use two independent database clients and start two payments against the last outstanding amount at the same time. Assert exactly one succeeds and stored payments equal the transaction net amount. Repeat with two concurrent prepayment draws against a single source credit.

### BD-03: Public responses expose internal bigint identifiers

**Severity:** High
**Confidence:** Confirmed, high

The project contract requires public display ID strings and prohibits leaking internal bigint IDs, but several core DTO mappers return database identifiers directly:

- Scheduled-order detail returns `documentedById`, `administeredById`, and `createdById` at [scheduled_orders/db.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/modules/scheduled_orders/db.ts#L437).
- Transaction detail returns branch, contract, drawer, OR series, linked transaction, and actor internal IDs at [transactions/db.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/modules/transactions/db.ts#L565), as well as lot, service-price, and performed-by IDs at [transactions/db.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/modules/transactions/db.ts#L628).
- The inventory-transfer route returns a type whose public fields are bigint IDs at [inventory_transfers/db.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/modules/inventory_transfers/db.ts#L18) and [inventory_transfers/routes.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/modules/inventory_transfers/routes.ts#L42).
- Notifications have no public display ID in schema at [schema.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/shared/db/schema.ts#L1320), then serialize the internal primary key as a string and return several internal foreign keys at [notifications/db.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/modules/notifications/db.ts#L16).

This exposes database implementation handles and contradicts the documented ID boundary. It also encourages frontend dependencies on values the API should keep private.

**Remediation:** Define explicit public response DTOs for each endpoint. Convert externally addressable resources to display IDs, resolve related entities to public IDs, and omit internals that have no frontend use. Add a public opaque identifier for notifications if clients must address them. Establish contract tests that reject unapproved entity-ID fields from API responses.

**Verification:** Contract-test representative transaction, scheduled-order, inventory-transfer, and notification responses. Assert every public entity reference is a display ID string and no raw numeric primary key is present.

### BD-04: AppSheet migration has no non-dry-run writer

**Severity:** High
**Confidence:** Confirmed, high

The migration entry point selects `drizzleAdapter` by default at [data_migration/index.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/modules/data_migration/index.ts#L24). The adapter explicitly labels itself a production stub and throws for every write at [data_migration/adapter.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/modules/data_migration/adapter.ts#L1). The load layer acknowledges intended atomic grouping but only works once an adapter is implemented at [data_migration/load.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/modules/data_migration/load.ts#L1).

Therefore a real non-dry-run migration cannot complete, despite FR27 requiring AppSheet migration tooling and error reporting at [requirements.md](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/docs/specs/surevax-cms-v2/requirements.md#L58).

**Remediation:** Implement a real adapter using tenant and branch-scoped transactions, validation before write, transaction-level atomicity for each business record, and structured row error output. Add a resumable manifest with source fingerprinting and operator-visible dry-run versus commit summaries.

**Verification:** Run a Postgres integration fixture through dry run and real import. Confirm valid records commit, an invalid record reports its source row and does not leave partial business transactions, and re-running the same manifest is idempotent or safely resumes.

### BD-05: Notification worker records delivery without a delivery provider

**Severity:** High
**Confidence:** Confirmed, high

The default notification sender only logs attempted sends and returns success at [sender.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/modules/notifications/sender.ts#L1). The dispatcher treats that result as successful delivery before persisting the message state at [notificationsDispatcher.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/workers/notificationsDispatcher.ts#L187). The code comments confirm that no provider is currently used.

This means reminder and overdue notices can be recorded as sent without an SMS, email, or push message actually being delivered. It fails the notification integration requirement in FR26 at [requirements.md](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/docs/specs/surevax-cms-v2/requirements.md#L56) and creates a misleading operational audit trail.

**Remediation:** Implement a configured provider adapter with a provider idempotency key, delivery status callback handling, explicit unavailable or failed state, and secrets loaded only from environment configuration. Do not mark a message sent based on logging. Place network dispatch in an outbox pattern so a database commit failure after provider acceptance does not cause an untracked duplicate retry.

**Verification:** Use a provider fake that returns accepted, transient failure, and permanent failure. Assert the durable state and retry behavior for each, including an idempotency test across worker crashes.

### BD-06: Route validation is split between shared contracts and local Zod schemas

**Severity:** Medium
**Confidence:** Confirmed, high

The project makes `@surevax/shared` the validation contract source, yet 26 backend route modules import `zod` directly while only 8 import `@surevax/shared`. Scheduled orders describe and use inline request schemas at [scheduled_orders/routes.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/modules/scheduled_orders/routes.ts#L34). This pattern makes contract changes likely to drift across backend and frontend even where runtime behavior currently works.

**Remediation:** Move request and response schemas that are API contracts into `packages/shared`, including composable feature schemas. Allow backend-only operational parsing only where it cannot cross the API boundary. Add CI linting or an AST rule to prevent new route-level Zod schemas without an explicit exemption.

**Verification:** Migrate one feature end to end, then build frontend and backend from the same schema exports. Add the lint rule and ensure it reports a deliberately introduced local route schema.

### BD-07: Application endpoint tests do not run under the runtime RLS role

**Severity:** Medium
**Confidence:** Confirmed, high

Global test setup overwrites `DATABASE_URL` with `DATABASE_MIGRATOR_URL`, a connection whose comments identify it as bypassing RLS, at [global-setup.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/tests/setup/global-setup.ts#L5). Dedicated policy tests do use `SET LOCAL ROLE rls_tester` at [cross-branch-phi-step23.test.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/tests/integration/cross-branch-phi-step23.test.ts#L590), but the normal endpoint suite does not prove that routes operate correctly with the deployed application role.

This blind spot is especially relevant to BD-01: policy tests can pass while an application helper deliberately sets cross-branch context. It also means successful tests provide limited evidence that all tenant-scoped queries use the expected GUC transaction envelope.

**Remediation:** Keep a privileged migrator only for schema and fixture setup. Run API integration tests through a separate non-BYPASSRLS application pool with actual role grants and request context. Retain explicit policy tests as a second layer, rather than substituting them for endpoint coverage.

**Verification:** Add a test database role matching runtime permissions. Run branch-isolation and a representative route from every sensitive module through the actual Express application and assert both allowed and denied behavior.

### BD-08: Scheduled-order listing and recall fan-out have unbounded query work

**Severity:** Medium
**Confidence:** Confirmed, high

The scheduled-order list accepts no cursor or limit at [scheduled_orders/routes.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/modules/scheduled_orders/routes.ts#L65), and its database query does not apply a limit at [scheduled_orders/db.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/modules/scheduled_orders/db.ts#L93). In contrast, the appointment list applies bounded limits at [appointments/db.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/modules/appointments/db.ts#L151). A branch with accumulated orders can therefore cause an unbounded response and query cost.

The product-recall notification flow iterates affected patients and performs consent lookup, duplicate lookup, and insert per patient inside one transaction at [product_recalls/db.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/modules/product_recalls/db.ts#L621). This creates serial N+1 query work while transaction locks are held.

Both paths conflict with the performance requirement in FR28 at [requirements.md](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/docs/specs/surevax-cms-v2/requirements.md#L60).

**Remediation:** Implement an indexed cursor and maximum page size for scheduled orders. Replace recall fan-out with a set-based `INSERT ... SELECT` that joins consent and excludes existing notifications using a unique idempotency key. Return inserted counts and dispatch through the existing outbox workflow.

**Verification:** Benchmark scheduled-order retrieval at 100, 1,000, and 10,000 rows. Use `EXPLAIN ANALYZE` to verify its index plan. For recall, measure query count and transaction duration for a large affected cohort, then assert one set-based insert is used.

### BD-09: Large persistence modules concentrate sensitive lifecycle logic

**Severity:** Low
**Confidence:** Confirmed, high

Several persistence modules are large enough to make access-control and financial changes difficult to review: transactions database logic is 1,718 lines, patient database logic is 1,597 lines, and scheduling database logic is 1,352 lines. The issue is maintainability rather than a demonstrated defect.

**Remediation:** Split by aggregate and lifecycle action, retaining one typed public DTO mapper per resource. Extract lock acquisition and authorization-context helpers into small, reviewable modules. Do this incrementally while adding tests around current behavior, not as a broad untested rewrite.

**Verification:** Require changed feature modules to keep transaction, authorization, mapping, and SQL responsibilities separately testable. Track file size only as a supporting signal, not a hard target.

## Positive controls observed

- Tenant settings are set with `set_config` inside `db.transaction()` in [withTenantTx.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/shared/db/withTenantTx.ts#L75), which is the intended foundation for transaction-scoped RLS.
- Active RLS uses forced policies for tenant-scoped tables at [0001_extensions_and_rls.sql](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/drizzle/0001_extensions_and_rls.sql#L465), and current branch policies are restrictive at [0001_extensions_and_rls.sql](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/drizzle/0001_extensions_and_rls.sql#L928).
- The audit trigger validates tenant context before recording sensitive table changes at [0002_audit_and_redaction.sql](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/drizzle/0002_audit_and_redaction.sql#L44) and redacts protected fields at [0002_audit_and_redaction.sql](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/drizzle/0002_audit_and_redaction.sql#L68).
- FEFO issue allocation filters quarantined and expired lots, orders by expiry, locks candidates with `SKIP LOCKED`, and rejects a negative decrement at [fefo.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/modules/inventory/fefo.ts#L66). This is a good concurrency pattern to reuse for financial locks.
- Worker startup and shutdown are explicitly managed at [index.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/index.ts#L30), and the domain-event worker uses locked claiming and retry mechanics in [domainEventsPublisher.ts](https://github.com/njvil/surevax-cms-revamp/blob/03fb4e500367854241bff9192d447e2d5f010c3a/apps/backend/src/workers/domainEventsPublisher.ts#L106).

## Recommended delivery plan

1. **Contain sensitive access:** fix scheduled-order branch and role enforcement, then add runtime-role API integration coverage before permitting multi-branch clinical usage.
2. **Protect financial integrity:** introduce locked or serializable payment flows, durable idempotency, and concurrent integration tests before accepting live payment workflows.
3. **Complete required operational paths:** implement a real migration adapter and provider-backed notification outbox before declaring FR26 and FR27 complete.
4. **Normalize API and performance discipline:** remove raw ID leakage, centralize shared schemas, paginate every collection, and convert recall fan-out to set-based insertion.
5. **Improve auditability over time:** incrementally separate high-risk persistence modules while preserving existing test coverage.
