# Runbook — AUTH-2 RLS Cutover (Railway)

> **Status: ✅ APPLIED + VERIFIED on the `development` env — 2026-05-31.** RLS is
> enforcing in the deployed app (`surevax_app` is `rolsuper=f/rolbypassrls=f`, the
> live pool connects as `surevax_app`, login 200, cross-tenant probe → 0 rows).
> There is no separate `production` env (all deployed envs run `NODE_ENV=development`).
> This runbook is retained as the procedure for any future env.

**Goal:** Flip a Railway environment from the legacy single-role connection
(`BYPASSRLS` master, no separate migrator) to the AUTH-2 two-role split so RLS
is actually enforced at runtime. Until this runs, RLS is enforced **only in
local dev** — every deployed env stays inert (the AUTH-2 root cause).

**Scope:** One-time, **per Railway env** (dev + production). ~10 minutes.
Non-destructive on production (the role and grants are idempotent — only the
connection strings change).

> **Background / role model:** see the `railway-ops` skill
> (`.claude/skills/railway-ops/SKILL.md`) for the full env-var → Postgres-role
> mapping, `DATABASE_URL` vs `DATABASE_PUBLIC_URL`, required `*_SECRET` vars,
> and supplemental-SQL ordering. This runbook is the execution checklist only —
> it does not duplicate that reference.

---

## Pre-flight

- [ ] You are on the env you intend to cut over. Confirm with `railway status`
      (this project: **surevax-cms-revamp** / env **development** /
      app service **surevax-cms-revamp** / DB service **surevax-db**).
- [ ] The AUTH-2 code is already deployed (the `withTenantTx`/`withSystemTx`/
      `withPlatformTx` helpers + the `DATABASE_MIGRATOR_URL` fallback in
      `migrate.ts`). If not, deploy it first — `migrate.ts` falls back to
      `DATABASE_URL` when `DATABASE_MIGRATOR_URL` is unset, so the code rolls
      out safely before the env vars exist.
- [ ] You have the Postgres **master** user + password to hand
      (`railway variables --service surevax-db --json` → `DATABASE_URL` /
      `DATABASE_PUBLIC_URL` carry them).

---

## Step 1 — `surevax_app` role already exists; provision its password

`apps/backend/drizzle/0001_extensions_and_rls.sql` creates `surevax_app`
(`LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`) in an idempotent
`DO` block on every migrate. So the role exists after any deploy that ran
migrations — **the real work is the connection strings, not the role.** The
only role-level action needed is setting its password (the migration creates
it without one):

```bash
railway connect surevax-db        # opens psql as the master role
\password surevax_app           # paste a strong, unique value — record it
\q
```

If you are unsure whether the role exists yet, the Step 4 smoke probe
(`SELECT … FROM pg_roles WHERE rolname='surevax_app'`) will tell you. If it
returns 0 rows, trigger a deploy/migrate first so `0001` runs, then re-do this
step.

---

## Step 2 — Point the service vars at the two roles

`DATABASE_URL` → `surevax_app` (runtime, `NOBYPASSRLS`).
`DATABASE_MIGRATOR_URL` → the master role (`BYPASSRLS` + DDL, used by
`migrate.ts` and `seed/db.ts` only).

```bash
railway variables --service surevax-cms-revamp --set \
  DATABASE_URL='postgresql://surevax_app:<app-pw>@postgres.railway.internal:5432/railway' \
  DATABASE_MIGRATOR_URL='postgresql://<master-user>:<master-pw>@postgres.railway.internal:5432/railway'
```

- Both URLs point at the **same** Postgres service — only the role + password
  differ.
- Use the private `postgres.railway.internal:5432` host (container-internal).
  The public proxy host (`*.proxy.rlwy.net`) is for laptops, not the app
  container.
- Sanity-check both landed: `railway variables --service surevax-cms-revamp --json | jq '{DATABASE_URL, DATABASE_MIGRATOR_URL}'`.

---

## Step 3 — Redeploy

```bash
railway up --detach
```

On boot: `migrate.ts` connects as `DATABASE_MIGRATOR_URL` (master, runs DDL +
the 7 supplemental SQL files); the long-lived app process connects as
`DATABASE_URL` (`surevax_app`, `NOBYPASSRLS`) so RLS is now live.

Watch the boot log — it must NOT contain `permission denied for table`:

```bash
railway logs --service surevax-cms-revamp | tail -50
```

Expect to see `Using DATABASE_MIGRATOR_URL for migration.` (NOT the fallback
warning) and a clean `All migrations complete.` followed by `Applying
supplemental SQL: 0001_extensions_and_rls.sql…` through
`0007_retention_procs.sql`.

> **Supplemental file list (verified against `migrate.ts` 2026-05-31):**
> `0001_extensions_and_rls.sql`, `0002_audit_and_redaction.sql`,
> `0003_invariants.sql`, `0004_immutability_and_generated.sql`,
> `0005_modern_pg.sql`, `0006_fhir_views.sql`, `0007_retention_procs.sql`.
> (The `railway-ops` skill's `0001_rls_triggers_extensions.sql…` list is stale
> relative to the post-#228 consolidated baseline — trust `migrate.ts`.)

---

## Step 4 — Smoke test (all must pass)

**4a — `surevax_app` has no administrative or RLS-bypass capability:**

```bash
railway connect surevax-db
SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication
FROM pg_roles WHERE rolname='surevax_app';
-- Expect exactly one row and all five booleans = f.
\q
```

**4b — App boots clean + login works (the canary):**

```bash
curl -i -X POST https://<host>/api/auth/login \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: fetch' \
  -H 'X-Tenant-Slug: SVX' \
  -d '{"email":"admin@surevax.com","password":"<pw>"}'
# Expect: 200 + Set-Cookie. A 401 means a read path is still using a bare
# db.x outside withTenantTx (RLS now hides the row). Canonical check:
# scripts/check-bare-db-writes.sh (runs in `pnpm agent:check`).
```

**4c — RLS actually enforces cross-tenant isolation (the whole point):**
Using a tenant-A authenticated session (cookies from 4b), hit any detail
endpoint for a row owned by tenant B. It must return **0 rows / 404**, not the
foreign row.

```bash
# psql equivalent — confirm the policy filters by GUC, not app-WHERE alone:
railway connect surevax-db
\c railway surevax_app                       -- connect AS the runtime role
BEGIN;
  SELECT set_config('app.current_tenant_id', 'SVX', true);
  SELECT count(*) FROM patients;             -- rows for SVX only
  SELECT set_config('app.current_tenant_id', 'SOME-OTHER-TENANT', true);
  SELECT count(*) FROM patients;             -- MUST be 0 (no SVX leak)
ROLLBACK;
\q
```

---

## Acceptance criteria

- [ ] `surevax_app` exists with `rolsuper=false`, `rolbypassrls=false`,
      `rolcreatedb=false`, `rolcreaterole=false`, and `rolreplication=false`.
- [ ] `DATABASE_URL` (→ `surevax_app`) and `DATABASE_MIGRATOR_URL` (→ master)
      both set on the `surevax-cms-revamp` service.
- [ ] Latest deploy boots green — no `permission denied for table` in logs.
- [ ] `POST /api/auth/login` returns 200 + cookies.
- [ ] Cross-tenant probe (4c): a tenant-A session returns 0 rows for any
      tenant-B data.

---

## Rollback

> **PROHIBITED ONCE PHI IS IN SCOPE:** Do not point the long-lived runtime
> `DATABASE_URL` at the master/migrator role. That makes RLS inert and removes
> the primary tenant-isolation boundary. The historical development-only
> unblock procedure has been retired.

Production-safe rollback means restoring the last-known-good application
deployment while keeping `DATABASE_URL` on `surevax_app` (or an equivalently
constrained `NOSUPERUSER NOBYPASSRLS` role). If the failure is database or
migration related, isolate the failed environment and follow
[`disaster-recovery.md`](disaster-recovery.md); do not patch around RLS.

Before cutover, record:

- the last-known-good application deployment/commit;
- the protected database snapshot or PITR point;
- the runtime-role query proving `rolsuper=false` and `rolbypassrls=false`;
- the operator and approver authorized to roll back; and
- the decision deadline and minimum verification set.

**Rollback triggers:** login failures attributable to RLS context, permission
errors, cross-tenant/branch probe failure, readiness failure, audit-chain alert,
or an unexplained migration result. After rollback, re-run login, runtime-role,
tenant/branch isolation, readiness, and alert-delivery checks before serving
traffic.

**Do NOT roll back by dropping/recreating the database on production.** The
optional dev-only nuke (`DROP DATABASE railway; CREATE DATABASE railway;
railway up`) is destructive and reseeds from scratch — it is acceptable on a
**dev** env to clear a hand-created stale `surevax_app` row (the 7-file
supplemental chain reapplies role + grants idempotently), but never on
production where data must be preserved.

---

## Related

- INFRA-6 (`migrate.ts` `DRIZZLE_DIR` resolves into the source tree — implicit
  Railpack copy dependency) is a small mechanical fix worth bundling with this
  cutover PR. See `docs/handovers/archive/2026-05-28-post-auth2-pending.md` §3.
- Source for this runbook: `docs/handovers/archive/2026-05-28-post-auth2-pending.md`
  §1. Role/helper model: `.claude/rules/gotchas.md` "AUTH-2: two-role split +
  helper trio" and `.claude/rules/risks.md` #7.
