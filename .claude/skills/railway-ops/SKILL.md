---
name: railway-ops
description: Railway deployment, env vars, database URLs, migrations, and CLI commands for SureVax CMS. Use when configuring `apps/backend/.env`, adding/changing Railway service variables, running migrations against Railway Postgres, debugging deploy failures, or pulling values via `railway variables`. Covers DATABASE_URL vs DATABASE_PUBLIC_URL, required `*_SECRET` env vars (≥32 chars), supplemental SQL ordering, and the Railpack build config.
---

# Railway Operations

## Project

Linked: project **surevax-cms-revamp** / env: **development** / app service: **surevax-cms-revamp** / DB service: **surevax-db**. (All deployed envs run `NODE_ENV=development` — there is no separate production env.)

## Deployment

Build system: **Railpack**. Config files: `railpack.json` (build steps + start command) and `railway.toml` (builder + healthcheck).

- Railpack auto-detects pnpm via lockfile — do **not** override the `install` step (loses file-copy behavior).
- Only the `build` step is overridden to enforce `@surevax/shared` before `@surevax/backend`.
- `pnpm.onlyBuiltDependencies` in root `package.json` must list `bcrypt` and `esbuild` or native addons break at runtime.

Push to `main` = auto-deploy. `railway up --detach` for manual trigger.

## Database URLs

| Variable                                   | Role connected as              | Reachable from          | Use for                               |
| ------------------------------------------ | ------------------------------ | ----------------------- | ------------------------------------- |
| `DATABASE_URL` (post AUTH-2)               | `surevax_app` (NOBYPASSRLS)    | Railway containers only | Production app runtime (RLS enforced) |
| `DATABASE_MIGRATOR_URL`                    | `postgres` (master, BYPASSRLS) | Railway containers only | `migrate.ts` + `seed/db.ts` only      |
| `DATABASE_PUBLIC_URL` (`*.proxy.rlwy.net`) | `postgres` (master)            | Anywhere                | Local dev, manual migrations, studio  |

**Local always uses `DATABASE_PUBLIC_URL`** — the private URL fails with `ECONNREFUSED`.

### AUTH-2 two-role provisioning (one-time per Railway env)

The 0001 migration creates a `surevax_app` role with no password. Each Railway env must set its password ONCE, then update the service vars:

```bash
# 1. Connect as master and rotate the surevax_app password.
railway connect surevax-db
\password surevax_app   # paste a strong unique value
\q

# 2. Add it to the surevax-cms-revamp service vars.
railway variables --service surevax-cms-revamp --set \
  DATABASE_URL='postgresql://surevax_app:<paste>@postgres.railway.internal:5432/railway' \
  DATABASE_MIGRATOR_URL='postgresql://<master-user>:<master-pw>@postgres.railway.internal:5432/railway'
```

If a Railway deploy boots before the role + password exist, the app login fails 0 rows on `findUserByEmail` → 401. To unblock quickly, point `DATABASE_URL` back at the master role temporarily (no RLS) while you set the password.

## Local .env

The default local-dev flow is `pnpm run setup` (per-worktree Docker Postgres). See `.claude/rules/worktree.md`. Use the Railway URL only when you explicitly want to test against the shared dev DB.

`apps/backend/.env` is **required** (gitignored). For Railway, all values come from the service:

```bash
railway variables --service surevax-db --json          # DATABASE_PUBLIC_URL
railway variables --service surevax-cms-revamp --json  # all other vars
```

Required keys:

```
DATABASE_URL=<DATABASE_PUBLIC_URL>
NODE_ENV=development
COOKIE_SECRET=<from service, ≥32 chars>
JWT_SECRET=<from service, ≥32 chars>
JWT_ACCESS_SECRET=<from service, ≥32 chars>
JWT_REFRESH_SECRET=<from service, ≥32 chars>
CORS_ORIGIN=http://localhost:5173
```

Optional: `EXPOSE_ERRORS=1` opts into 500-response `detail` field for debugging.

All four `*_SECRET` vars are validated on boot — `min(32)` plus a `looksDev` check (`dev_`, `change_in_production`, `changeme`, `example` markers). Backend exits with status 1 in production if any fail. No fallbacks: missing or short = no boot. See `.claude/rules/gotchas.md` under "JWT secrets" (or the gotchas skill encyclopedia).

**Tenant resolution**: the legacy `PHASE_1_TENANT_ID` env fallback was removed once Phase 2 dynamic tenant resolution landed. Production callers must serve clinics on a subdomain (`clinicname.surevax.com`) or send `X-Tenant-Slug`; the JWT carries the tenant slug for authenticated paths. See `.claude/rules/gotchas.md` § "Tenant resolution — Phase 2 dynamic".

To find tenant IDs in any DB:

```bash
railway connect surevax-db
SELECT id, slug FROM tenants;
```

## Migrations

```bash
# Generate after schema changes
npx pnpm --filter @surevax/backend db:generate

# Apply (Drizzle + supplemental SQL)
DATABASE_URL="<DATABASE_PUBLIC_URL>" npx pnpm --filter @surevax/backend db:deploy
```

`db:deploy` = `tsx src/shared/db/migrate.ts` = Drizzle migrations followed by an ordered list of supplemental SQL files (`SUPPLEMENTAL_SQL_FILES` in `migrate.ts`):

1. `0001_extensions_and_rls.sql` — extensions, `audit_logs` partitioning, RLS (tenant + branch isolation, platform-admin bypass), utility triggers, analytics schema, session timeouts, RLS hardening
2. `0002_audit_and_redaction.sql` — `audit_log_changes()` strict-mode trigger + per-table redaction list, audit-log `chain_hash` tamper-evidence, `verify_audit_chain()` walker
3. `0003_invariants.sql` — display-ID format CHECKs, polymorphic FK guards, composite tenant FKs, status-history coupling, negative-inventory CHECKs, D2 branch-isolation trigger
4. `0004_immutability_and_generated.sql` — immutability triggers (`transactions` / `clinical_orders`) + GENERATED `amount_outstanding` column
5. `0005_modern_pg.sql` — CITEXT emails, GENERATED `full_name` + pg_trgm, partial uniques (idempotency, MRN, physician, cash-drawer, payments), EXCLUDE constraints, table COMMENTs
6. `0006_fhir_views.sql` — FHIR R4 projection views (`security_invoker=true`) + `patients_demographic_v` cross-branch demographic view
7. `0007_retention_procs.sql` — SECURITY DEFINER retention procedures + audit-partition rotation, `tenant_counters` RLS/triggers, `purge_patient()` DPA dry-run function

> The post-#228 accretion `0008`–`0029` was folded back into these 7 themed files
> in the 2026-05-28 AUTH-2 consolidation. `migrate.ts` (`SUPPLEMENTAL_SQL_FILES`)
> is authoritative — regenerate this list from there if it drifts.

When adding a new supplemental SQL, append the filename to that array — `migrate.ts` will not pick it up automatically.

## Useful commands

```bash
railway variables --service <name> --json   # get env vars
railway status                              # linked project info
railway logs --service <name> | tail -50    # tail logs (always pipe)
railway connect surevax-db                    # psql shell
```
