# 04 — Infrastructure & Deployment

> **Last Synthesized**: 2026-04-10 | **Updated**: 2026-08-23 (Runtime Review Center cash-drawer migration deployment gate; PR #616 pending merge) | **Self-contained**

## Live Status (2026-04-11)

| Component            | State         | URL / Note                                             |
| -------------------- | ------------- | ------------------------------------------------------ |
| **Railway API**      | ✅ Running    | `https://surevax-cms-revamp-production.up.railway.app` |
| **Railway PG**       | ✅ Running    | Private network only; G1 schema + RLS applied          |
| **Cloudflare Pages** | ⬜ Not wired  | No frontend URL yet — wire after G3                    |
| **Cloudflare R2**    | ⬜ Not set up | Deferred to G3+                                        |

### Environment variables (Railway `surevax-cms-revamp` service)

| Variable                               | Status                                       | Notes                                                                                                                       |
| -------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                         | ✅ Set (auto)                                | Railway private network — injected by Railway                                                                               |
| `JWT_ACCESS_SECRET`                    | ✅ Set, **required ≥32 chars**               | Access token signing (15 min); env validation refuses to boot if unset/short                                                |
| `JWT_REFRESH_SECRET`                   | ✅ Set, **required ≥32 chars**               | Refresh token signing (7 days) — separate secret; env validation refuses to boot if unset/short                             |
| `COOKIE_SECRET`                        | ✅ Set, **required ≥32 chars** in production | cookie-parser signing                                                                                                       |
| `JWT_SECRET`                           | ✅ Set, **required ≥32 chars** in production | Currently unused at runtime but still env-validated; keep set until removed from `env.ts`                                   |
| `NODE_ENV`                             | ✅ `development` (intentional)               | All deployed envs run `development` so the production `looksDev` guard stays opt-in via `*_SECRET` quality                  |
| `CORS_ORIGIN`                          | ⚠️ `http://localhost:5173`                   | **Must update** to CF Pages URL when wired                                                                                  |
| `EXPOSE_ERRORS`                        | 🛠️ Optional, default off                     | Set to `1` to include `detail` field in 500 responses for debugging — never leave on long-term                              |
| `WORKERS_ENABLED`                      | 🛠️ Optional, default off                     | Set to `true` to enable all background workers (token cleanup, PHI retention, partition rotation, notifications, analytics) |
| `TOKEN_CLEANUP_INTERVAL_MS`            | 🛠️ Optional, default 86400000 (24h)          | How often `tokenCleanup` worker runs; deletes expired `refresh_tokens` + `password_reset_tokens`                            |
| `PHI_ACCESS_LOG_RETENTION_INTERVAL_MS` | 🛠️ Optional, default 604800000 (7d)          | How often `phiAccessLogRetention` worker runs                                                                               |
| `PHI_ACCESS_LOG_RETENTION_DAYS`        | 🛠️ Optional, default 365                     | Rows older than this many days are purged from `phi_access_log`                                                             |
| `AUDIT_PARTITION_ROTATE_INTERVAL_MS`   | 🛠️ Optional, default 2592000000 (30d)        | How often `auditPartitionRotate` worker calls `create_next_audit_partitions(12)`                                            |

**Smoke tests (2026-04-26 post-security-batch)**:

- `GET /health` → `{"status":"ok"}` ✅ (env field removed)
- `POST /api/auth/login` (bad creds) → `401 AUTH_FAILED` ✅
- `GET /api/patients` (no cookie) → `401 AUTH_REQUIRED` ✅

**Scope**: DevOps & infrastructure for SureVax CMS v2.0 — **Railway** for compute and managed database, **Cloudflare** for edge and storage.

---

## Critical Decisions (Non-Negotiable)

| Decision             | Choice                                             | Rejected                                       |
| -------------------- | -------------------------------------------------- | ---------------------------------------------- |
| **API runtime**      | **Railway** (managed containers, Singapore region) | Hetzner VPS, self-managed Docker               |
| **Database**         | **Railway Managed PostgreSQL** (Singapore region)  | Self-hosted DB on raw VPS, Supabase            |
| **Frontend hosting** | **Cloudflare Pages**                               | Vercel (commercial use violation on free tier) |
| **Object storage**   | **Cloudflare R2** (S3-compatible, **zero egress**) | Self-hosted Minio                              |
| **Edge security**    | **Cloudflare WAF** (free tier)                     | Unprotected origin                             |

---

## Architecture Diagram (Text)

```
Internet (HTTPS)
       │
       ▼
┌──────────────────────────────┐
│ Cloudflare Pages (SPA)       │  ← VITE_API_URL → API origin
│ + WAF + CDN                  │
└──────────────────────────────┘
       │ HTTPS
       ▼
┌──────────────────────────────┐
│ Railway (Singapore)          │
│  API service (Node.js)       │
│  Private network             │
│    → Managed PostgreSQL      │
└──────────────────────────────┘
       │ S3 API (HTTPS)
       ▼
┌──────────────────────────────┐
│ Cloudflare R2                │
│ Files / pg_dump offsite      │
└──────────────────────────────┘
```

**Flow**: **Browser (`https://app.surevax.com`) → API (`https://api.surevax.com`) → Railway Managed PG** with Cloudflare at edge; **API → R2** for objects and optional backup dumps.

---

## Component Breakdown

| Component        | Provider                           | Cost (indicative)    | Key Features                                                               |
| ---------------- | ---------------------------------- | -------------------- | -------------------------------------------------------------------------- |
| **Frontend CDN** | **Cloudflare Pages**               | **$0**               | Commercial use OK, global CDN, auto-deploy from GitHub                     |
| **Backend API**  | **Railway** (Singapore)            | **~$10–15/mo**       | Managed containers, no cold starts, GitHub auto-deploy, private networking |
| **Database**     | **Railway Managed PG** (Singapore) | **~$10–15/mo**       | Automated backups, PITR, encryption at rest, private networking to API     |
| **Storage**      | **Cloudflare R2**                  | **$0** (<10 GB free) | S3 API, zero egress, 10 GB free tier                                       |
| **Security**     | **Cloudflare WAF**                 | **$0**               | DDoS, WAF, SSL/TLS                                                         |

**Estimated total**: **~$20–30/month** (Railway API + Railway PG + free edge + free R2 under limits). Set a Railway **spend cap** to prevent billing surprises.

---

## Why Railway

- **Private networking**: API and database communicate over Railway's internal network — DB never exposed to public internet
- **Zero-ops**: No VPS to manage, no Nginx config, no TLS cert renewal
- **GitHub integration**: Push to `main` = deploy; rolling deploys with zero downtime
- **Singapore region**: Data stays close to the Philippines for latency and compliance posture
- **Easy migration**: Railway uses standard Docker containers and standard PostgreSQL — migrating out is a `pg_dump` + Dockerfile pointed at a new provider

---

## Why NOT Supabase (Architecture Lock-In)

- **Auth**: Custom **GoTrue** — password hashes do not port cleanly to bcrypt → mass resets / migration pain
- **RLS**: Tied to **Supabase client** — moving to plain API means rewrite entire security model (every query path)
- **Storage**: Proprietary API; real-time model differs from self-hosted stack
- **Result**: ~6 months of tech debt in one "migration" — avoid for Day 1 if target is hybrid/VPS API

---

## Network Isolation Rules

- **Railway Managed PG** is only reachable from within the same Railway project via private network — no public hostname for Postgres
- **Frontend → API**: HTTPS only (Cloudflare Pages → `https://api...`)
- **CORS (cookie auth)**: API must explicitly allow only the exact SPA origin (e.g., `https://app.surevax.com`), return `Access-Control-Allow-Credentials: true`, and never use wildcard origin `*` for authenticated requests
- **API → DB**: Railway private network (internal hostname, not public internet)
- **R2**: S3 API over HTTPS; keys in env, never in repo

---

## Railway Configuration

**API service**: Deploy from GitHub repository using Railway's Railpack builder. The repo root contains `railpack.json` and `railway.toml` that control the build and deploy.

### railpack.json (canonical)

```json
{
  "$schema": "https://schema.railpack.com",
  "packages": {
    "node": "22",
    "pnpm": "9"
  },
  "steps": {
    "build": {
      "commands": ["pnpm --filter @surevax/shared build", "pnpm --filter @surevax/backend build"]
    }
  },
  "deploy": {
    "startCommand": "node apps/backend/dist/index.js"
  }
}
```

**Auto-detected install step**: Railpack detects pnpm via the lockfile and handles dependency installation automatically, including file-copying layers. Only the `build` step is overridden to control build order. Do **not** override the `install` step — it loses the auto-detected file-copy behavior and fails with "No package.json found".

**Why `packages` for pnpm**: Railpack provisions packages system-wide via the `packages` field. pnpm is available across all build steps without PATH issues.

**Why shared builds first**: `@surevax/shared` exports compiled JS from `dist/` (not raw `.ts`). TypeScript `paths` aliases are compile-time only — the emitted backend JS still contains `import from '@surevax/shared'`, which Node.js resolves via the package's `exports` field at runtime. Shared must be compiled to `dist/` before that import can resolve.

**Native addons** (`bcrypt`, `esbuild`): pnpm 10 requires explicit opt-in for build scripts. The root `package.json` includes:

```json
"pnpm": { "onlyBuiltDependencies": ["bcrypt", "esbuild"] }
```

Without this, `bcrypt` will install but its native `.node` binding won't be built, causing a runtime crash.

### railway.toml (canonical)

```toml
[build]
builder = "RAILPACK"

[deploy]
healthcheckPath = "/health"
healthcheckTimeout = 100
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10
```

**Environment variables** (set in Railway dashboard, never committed):

```
DATABASE_URL=postgresql://...      # Railway injects automatically when services are linked
JWT_ACCESS_SECRET=...              # Access token signing (15 min) — set via railway variables set
JWT_REFRESH_SECRET=...             # Refresh token signing (7 days) — separate secret
COOKIE_SECRET=...                  # Signs HTTP-Only cookies via cookie-parser
CORS_ORIGIN=https://app.surevax.com   # Exact SPA origin — no wildcard; update when CF Pages is wired
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
NODE_ENV=production
```

**Setting variables via CLI:**

```bash
railway variables set JWT_ACCESS_SECRET="..." JWT_REFRESH_SECRET="$(openssl rand -hex 32)" --service surevax-cms-revamp
```

Railway triggers a redeploy automatically on variable changes.

**Linking services**: Connect the API service to the Railway Managed PG instance inside the same project — Railway injects `DATABASE_URL` automatically via private network.

**Custom domain**: Point `api.surevax.com` to the Railway service via Railway's domain settings. Cloudflare proxies the domain (WAF + SSL).

---

## Database: Private vs Public URL

Railway Managed PG exposes **two** URLs with different scopes:

| Variable              | Host                             | Reachable from                            |
| --------------------- | -------------------------------- | ----------------------------------------- |
| `DATABASE_URL`        | `postgres.railway.internal`      | Railway containers only (private network) |
| `DATABASE_PUBLIC_URL` | `mainline.proxy.rlwy.net:<port>` | Anywhere (public internet)                |

**`DATABASE_URL` will fail with `ENOTFOUND` from local machine.** Always use `DATABASE_PUBLIC_URL` for local operations (migrations, debugging, studio).

Retrieve with:

```bash
railway variables --service Postgres --json
```

---

## Database Migrations

The migration setup has two layers:

| File                                                         | What it does                                                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `apps/backend/drizzle/0000_*.sql`                            | All 22 tables + enums + indexes — generated by `drizzle-kit generate`                                   |
| `apps/backend/drizzle/0001_bent_satana.sql`                  | Drizzle-tracked — second iteration of base schema                                                       |
| `apps/backend/drizzle/0001_rls_triggers_extensions.sql`      | Extensions, `updated_at` triggers, `tsvector` triggers, FEFO partial index, audit trigger, RLS policies |
| `apps/backend/drizzle/0002_audit_redaction.sql`              | Audit trigger redacts PII columns from JSONB diff; raises on missing `app.current_tenant_id` GUC        |
| `apps/backend/drizzle/0002_legal_vermin.sql`                 | Drizzle-tracked — adds `refresh_tokens` table                                                           |
| `apps/backend/drizzle/0002_refresh_tokens_rls.sql`           | RLS + self-FK for `refresh_tokens`                                                                      |
| `apps/backend/drizzle/0011_cash_drawer_branch_invariant.sql` | One Open drawer per tenant+branch; fails on existing conflicts instead of rewriting financial history   |

**Migration runner**: `apps/backend/src/shared/db/migrate.ts` — runs Drizzle migrations first, then applies the supplemental SQL files in the order listed in `SUPPLEMENTAL_SQL_FILES`. When adding a new hand-written supplemental file, append it to that array — `migrate.ts` does not auto-discover.

```bash
# After schema changes: regenerate Drizzle migration
npx pnpm --filter @surevax/backend db:generate

# Apply all migrations (run locally against public URL)
DATABASE_URL="<DATABASE_PUBLIC_URL>" npx pnpm --filter @surevax/backend db:deploy

# Drizzle Studio (read-only inspection)
DATABASE_URL="<DATABASE_PUBLIC_URL>" npx pnpm --filter @surevax/backend db:studio
```

- **`db:deploy`** = `tsx src/shared/db/migrate.ts` = Drizzle migrate + supplemental SQL. Use this for full setup.
- **`db:migrate`** (drizzle-kit only) = Drizzle-tracked migrations only. Does **not** apply the supplemental SQL.

### PR #616 cash-drawer deploy gate

Before applying `0011_cash_drawer_branch_invariant.sql`, query for
tenant+branch groups with more than one `Open` drawer. Any result is
an operational financial conflict requiring an accountable, audited correction
before deployment. Do not auto-close rows or edit the migration to choose a
winner. The unique partial index is intentionally the final race backstop.

```sql
SELECT tenant_id, branch_id, COUNT(*) AS open_drawer_count
FROM cash_drawer_sessions
WHERE state = 'Open'
GROUP BY tenant_id, branch_id
HAVING COUNT(*) > 1;
```

After migration, smoke-test the Review Center with an authorized branch
principal, verify a forbidden role receives 403, and confirm `/branch/kiosk`
resolves a prior-day Open drawer instead of offering a second drawer.

---

## Worktree Bootstrap

`pnpm run setup` (wrapping `scripts/setup-worktree.sh`) creates the per-worktree database, writes `.env` files, and runs migrations. As of [#234](https://github.com/njvil/surevax-cms-revamp/pull/234), it also pins the Python interpreter for the `/graphify` skill. If `graphify` is on PATH, the script writes the interpreter path from the binary shebang to `graphify-out/.graphify_python`. If `graphify` is not installed, this step is silently skipped. The rest of the bootstrap proceeds normally, but `graphify query` will not work until `graphify` is installed and `pnpm run setup` is run again.

---

## Cloudflare Pages Pipeline

- **Repo**: Connect GitHub
- **Build**: `cd apps/frontend && pnpm build`
- **Output**: `apps/frontend/dist`
- **Env**: `VITE_API_URL=https://api.surevax.com` (or staging URL)
- **Deploy**: Auto on push to `main` (branch per env as needed)

**Not Vercel** — free tier commercial use conflicts with SureVax production posture.

---

## Backup Strategy

| Layer          | Mechanism                       | Retention               |
| -------------- | ------------------------------- | ----------------------- |
| **Railway PG** | Automatic daily backups         | 7 days + PITR           |
| **Extra**      | `pg_dump` → cron → upload to R2 | ~30 days (policy-tuned) |

**RTO/RPO**: Set explicit targets in ops runbook; test restores on schedule.

---

## Monitoring

- **Railway built-in metrics**: CPU, memory, request volume — available in Railway dashboard at no extra cost
- **Uptime monitoring**: Use a free external service (e.g., Better Uptime, UptimeRobot) for HTTP checks and alerts — set up at Gate 1, not deferred
- Optional later: Sentry/GlitchTip for error tracking (already referenced in `02-BACKEND-API.md`)

---

## CI/CD

- **GitHub Actions merge gate** (`.github/workflows/ci.yml`): every PR runs four jobs — `build` (install + `pnpm agent:check`: format, lint, typecheck, build, and the static prevention gates), then `migrate`, `test`, and `frontend-test` (all `needs: build`). All are required checks.
- **Prevention gates** convert recurring audit bug classes into executable checks so they can't silently recur:
  - Static (in `pnpm agent:check`): `scripts/check-route-authz.sh` (every `/api/admin|/api/audit` mount carries `requireRole`), `scripts/check-modeled-not-wired.sh` (behaviour-flag columns must have a consumer).
  - DB-backed (in the CI `test` job): `scripts/check-seed-runtime.sh` (seed populates the runtime-read tables + `surevax_app` is `NOBYPASSRLS` + consent gate — kills INV-2) and `tests/integration/response-contract.test.ts` (locks each list endpoint's bare-array vs `{data}` shape — kills the FE-ENV class).
- **Worktree/branch teardown**: `pnpm prune:worktrees` (`scripts/prune-stale-worktrees.sh`) removes stale worktrees + merged/stale branches after an `/orchestrate` wave — dry-run by default, never auto-deletes unmerged remote work.
- **Railway native**: push to `main` → Railway detects the change → builds and deploys automatically.
- **Secrets**: Railway environment variables; never in repo.

---

## Scaling Path

| Phase | Users  | API                                        | DB                      | Cost (est.)      |
| ----- | ------ | ------------------------------------------ | ----------------------- | ---------------- |
| **1** | 0–1K   | Railway Starter                            | Railway PG Starter      | **~$20–30/mo**   |
| **2** | 1K–5K  | Railway scaled up                          | Railway PG scaled       | **~$50–80/mo**   |
| **3** | 5K–20K | Railway Pro or migrate to DO App Platform  | Managed PG with replica | **~$100–150/mo** |
| **4** | 20K+   | Re-evaluate: multi-region, dedicated infra | Multi-region PG         | **$300–500/mo**  |

---

## Infrastructure Invariants

1. **No self-hosted Postgres** — Railway Managed PG only for production
2. **Database never on public internet** — Railway private network only
3. **No Vercel** for production frontend — Cloudflare Pages (or other compliant host per policy)
4. **Object storage** — Cloudflare R2 (S3-compatible), not ad-hoc disk for durable blobs
5. **Edge security** — Cloudflare WAF on free tier (or equivalent) — origin not naked
6. **Cross-origin auth** — credentialed API calls must use explicit origin allow-list (e.g., `https://app.surevax.com`) + `Access-Control-Allow-Credentials: true`; no wildcard `*`
7. **Backups** — Railway PITR + `pg_dump` to R2; restore drills required
8. **Spend cap** — Set a Railway monthly spend cap to prevent billing surprises
9. **Ops discipline** — automated deploys via Railway GitHub integration; no manual prod edits without change control
