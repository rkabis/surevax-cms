# Handover — AUTH-2 RLS hardening capstone

**Compacted from**: the 2026-05-27 audit-remediation effort (Waves 1–5 + cleanups all merged, PRs #489–#513).
**This is the single remaining large item from `docs/handovers/archive/2026-05-27-comprehensive-codebase-audit.md`.**
**Status legend in the audit doc applies.** Tracked in `.claude/rules/risks.md` #8.

## Goal

Make Row-Level Security actually enforce tenant + branch isolation at the DB layer (non-negotiable rule #2), instead of relying solely on app-level `WHERE tenant_id`. Today RLS is **inert**.

## Why it's inert (the core problem)

The app connects to Postgres as role **`surevax`**, which is `rolsuper=true, rolbypassrls=true`. So `FORCE ROW LEVEL SECURITY` (drizzle/0001*extensions_and_rls.sql) is a no-op — every policy is bypassed. App-level `WHERE tenant_id = …` is the \_only* live boundary. Any bare query that omits the predicate leaks cross-tenant. (Empirically proven in the audit: `rolsuper=true, rolbypassrls=true`.)

## Why it is NOT a contained change

Demoting the runtime role to a non-`BYPASSRLS` role activates RLS for real — and **most read paths set no tenant GUC**, so they would return 0 rows and break login + every list/detail/dashboard/FHIR view.

These **13 module `db.ts` files use bare `db.select()` reads with no `withTenantTx`** (they work only because RLS is currently bypassed) — each must be wrapped in `withTenantTx` (or set the GUC trio) before the role is demoted:

```
auth/db.ts              ← CRITICAL: findUserByEmail / findUserByDisplayId run pre-tenant-context
                           (authMiddleware calls findUserByDisplayId on EVERY request). They
                           already receive tenantSlug → wrap in
                           withTenantTx({ tenantId: tenantSlug, userId: 0, branchId: null }, …).
                           NOTE: the `tenants` table is NOT RLS-enabled (it's the registry), so
                           slug→id resolution in tenant.ts still works pre-GUC.
branch/db.ts            dashboard/db.ts        inventory/db.ts
inventory_transfers/db.ts  lab_orders/db.ts    partner_laboratories/db.ts (listPartnerLabs)
patients/db.ts          payer_profiles/db.ts   scheduled_orders/db.ts
staff_time_logs/db.ts   standing_orders/db.ts  transactions/db.ts
```

(Generate the live list any time with: `for f in $(find apps/backend/src/modules -name db.ts); do grep -lE "await db$|await db\." "$f"; done`. Many of these mix already-wrapped writes with bare reads — only the bare reads need wrapping.)

`fhir/db.ts` is the exception — it already sets GUCs manually via its own `setGUCs` (made branch-aware by INT-2, PR #505) and the FHIR views got `security_invoker=true` (INT-1, migration 0029). Verify it works under real RLS.

### Workers + middleware also bypass GUCs (no HTTP request context)

A second class of bare-`db` callers has no request context to pull `tenantId` from. Each must either accept a `tenantId` argument and loop per-tenant, or move to `withPlatformTx({ targetTenantId })`. Counts from a 2026-05-28 probe:

- `workers/analyticsRefresh.ts` (11 bare `db.transaction` calls), `workers/notificationsDispatcher.ts` (5), `workers/domainEventsPublisher.ts` (4), `workers/tokenCleanup.ts` (2), `workers/phiAccessLogRetention.ts` (2), `workers/auditPartitionRotate.ts` (2; DDL — stays on the migrator role, see below), `workers/verifyAuditChain.ts` (1), `workers/domainEventConsumers/*.ts` (2)
- `shared/middleware/phiAccessLog.ts` (10 — hot path, fires on every PHI GET; consider collapsing into one tx per request), `shared/middleware/idempotency.ts` (1), `shared/utils/auditLog.ts` (1), `shared/lib/pricing.ts` (1)

Proposal: add a small `withSystemTx({ tenantId }, fn)` helper alongside `withTenantTx` / `withPlatformTx` in `shared/db/withTenantTx.ts`. Semantics: same GUC trio as `withTenantTx` but with a sentinel `user_id = -1` (audit trigger needs a non-null value) and an extra `app.is_system = 'true'` GUC so future policies can distinguish system-initiated rows. Workers acting on multiple tenants loop over them and call `withSystemTx` per iteration — the audit trigger's strict-mode `tenant_id` check (0024) makes cross-tenant inside one tx unsafe anyway.

## Plan (do as ONE careful PR / coordinator-inline — do NOT parallelize: it touches the shared read surface)

1. **Two new roles, not one**:
   - `surevax_app` — `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE` with `GRANT SELECT,INSERT,UPDATE,DELETE` on all `public` tables, `USAGE,SELECT,UPDATE` on sequences, `EXECUTE` on functions, plus `ALTER DEFAULT PRIVILEGES` so future objects are reachable. This is what the running app connects as.
   - `surevax_migrator` — inherits from the current `surevax` superuser; used by `migrate.ts` for DDL and by DDL-class workers (`auditPartitionRotate.ts`, materialised-view refresh in `analyticsRefresh.ts`).
     Wire both into `scripts/setup-worktree.sh` (create roles + grants AFTER migrate, BEFORE the app starts).
2. **Dual connection-string**: introduce `DATABASE_MIGRATOR_URL` alongside `DATABASE_URL`. Runtime (`apps/backend/src/shared/db/index.ts`) reads `DATABASE_URL` (now points at `surevax_app` → RLS enforces). `migrate.ts` and `seed/db.ts` read `DATABASE_MIGRATOR_URL` (points at `surevax_migrator`) — they need DDL + must bypass RLS during bootstrap. `setup-worktree.sh` writes both into `apps/backend/.env`; the Railway service variables need the same split (add to the `railway-ops` skill).
3. **Wrap the 13 files'** bare reads in `withTenantTx({ tenantId, userId, branchId }, async tx => …)` (see `shared/db/withTenantTx.ts` + the canonical pattern in `.claude/rules/patterns.md`). Read functions take `tenantId` from `req.tenant.id` (routes already have it) and `branchId` from `req.user.branchId`. Wrap the worker + middleware sites listed above in `withSystemTx({ tenantId })` (helper lands in step 0).
4. **INFRA-1**: seed sets `user_branches.branch_id=''` which fails the `branch_isolation` RLS WITH CHECK after 0022 inverted the policy — currently masked because seed runs as the BYPASSRLS superuser. Either keep seed on the owner role (simplest — it stays masked and harmless) OR fix the seed to set a real branch_id / set `app.cross_branch_read='true'`.
5. **AUTH-3**: `branch_isolation` policy (drizzle/0022_rls_hardening.sql ~line 78) treats `branch_id IS NULL` as visible-to-all-branches. Decide the intended semantics once RLS is live (NULL-branch rows = tenant-wide reference data vs. leak). Adjust the policy if needed.
6. **Lock the contract — CI grep gate**: add `scripts/check-bare-db-writes.sh` (invoked from `pnpm agent:check`) that blocks new bare `db.(insert|update|delete|execute|transaction)` calls outside the canonical helpers in changed files. Read-only `db.select` is allowed (PG RLS scopes it) but discouraged outside `withTenantTx`. Without this gate, the wrappers added in step 3 decay back to bare calls over the next few months.

   ```bash
   git diff --name-only origin/main...HEAD | grep -E 'apps/backend/src/(modules|workers|shared)/' \
     | xargs -I{} grep -Hn '\bdb\.(insert|update|delete|execute|transaction)\b' {} 2>/dev/null \
     | grep -v 'withTenantTx\|withPlatformTx\|withSystemTx\|seed/db.ts\|migrate.ts' \
     | tee /tmp/bare_db_diff.txt
   test ! -s /tmp/bare_db_diff.txt || { echo "Bare db write detected — wrap in a transaction helper"; exit 1; }
   ```

## Verification (mandatory — this is where the risk lives)

- `pnpm setup` clean (role created, grants applied, app connects as demoted role).
- **Probe**: `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='surevax_app'` → both false.
- **Login smoke** must pass (admin@surevax.com) — this is the canary; if findUserBy\* isn't wrapped, login returns 0 rows → 401.
- Hit EVERY list + detail + dashboard + FHIR endpoint as a branch-scoped user and confirm rows still return (a missed GUC = silent empty list).
- `pnpm --filter @surevax/backend test` (98 integration tests; `rls-multi-tenant.test.ts` is the key one — it may need to flip from "RLS inert" assumptions to real enforcement).
- Cross-tenant probe: a tenant-A session must get 0 rows for tenant-B data even with the `WHERE` removed.

## Also deferred (small, fold in or do separately)

- **INFRA-6**: Railpack runs `dist/migrate.js` which resolves `DRIZZLE_DIR` to the source `drizzle/` (`migrate.ts`: `path.resolve(__dirname, '../../../drizzle')`). Works today because the source tree is present at runtime, but it's an implicit uncopied build dependency — make it explicit. Can't verify locally without a Railway build.
- **DB-6**: dead `users_tenant_email_idx` citext-recreate block in `0005_modern_pg.sql` — a harmless idempotent no-op (gated on `email <> citext`, always false on fresh DBs). Intentionally left; not worth a historical-migration edit.

## What's already DONE (don't redo)

Everything else from the ~80-finding audit is merged (PRs #489–#513): all SEC/CONC/INV/CLIN/MONEY/CASH/API/MOD/WORK/NOTIF/APPR/RECALL/INT/DB/FE/SHIFT/VER findings, the CLIN-1 dose-calc backend + endpoint (#510; the **frontend UI** is the only CLIN-1 piece possibly still in-flight — check `gh pr list` for `dosecalc-ui`), INFRA-2/3/7, and MONEY-6 (citations only, no math change, per decision).
