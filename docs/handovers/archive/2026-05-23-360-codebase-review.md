# 360 Codebase Review — 2026-05-23

> Comprehensive eight-aspect audit (monorepo/build, backend, database/multi-tenancy,
> security/auth, frontend, testing/CI, infra/deploy, observability/compliance) with
> every finding cross-referenced against 2025/2026 best-practice web sources.
>
> Snapshot taken at commit on branch `nathan/cool-kirch-f21086`. Severity reflects
> exploitability / production-readiness gap, not effort to fix. File paths are
> repo-relative. Most fixes are <100 LoC.

---

## TL;DR

- **Foundation is genuinely strong.** RLS + FORCE-RLS + transaction-local GUC + DB-trigger audit chain (SHA-256, partition-scoped) + RESTRICTIVE no-update policies + immutability triggers on paid/completed records are above the bar for clinic SaaS. CI mirrors Railway's `startCommand` exactly. Strict TS, no state-management sprawl, design-system gates, format/lint pre-PR hooks all enforce themselves.
- **Gaps cluster around production plumbing**, not architecture. Pool sizing, request correlation, observability stack, graceful shutdown, in-memory rate-limit, no frontend tests, no E2E.
- **Two integration foot-guns** (PayMongo stub returns `true`, supplemental SQL runs without tx wrapper) are CRITICAL — both already documented as known risks, both surfaceable in a quiet failure mode.
- **Three DPA/PHI gaps** (consent revocation not enforced at write time, PHI access log covers 3 routes only, audit-trigger redaction empties clinical-edit diffs) need closure before any real patient data lands.
- **35 findings total** — 2 CRITICAL, 14 HIGH, 17 MEDIUM, plus a LOW/NIT batch.

### Wave 1 + Wave 2 ship status (2026-05-23)

11 of 16 high-priority audit findings landed across two orchestration waves on the same day. Each is annotated inline below; this is the running rollup:

| Finding                            | Status                                | PR                                                           |
| ---------------------------------- | ------------------------------------- | ------------------------------------------------------------ |
| C1 PayMongo stub gate              | ✅ shipped                            | [#449](https://github.com/njvil/surevax-cms-revamp/pull/449) |
| C2 SQL tx wrapper                  | ✅ shipped                            | [#449](https://github.com/njvil/surevax-cms-revamp/pull/449) |
| H1 postgres-js pool config         | ✅ shipped                            | [#447](https://github.com/njvil/surevax-cms-revamp/pull/447) |
| H2 pino-http correlation           | ✅ shipped (pre-wave, #441)           | [#441](https://github.com/njvil/surevax-cms-revamp/pull/441) |
| H3 PIN DB lockout                  | ✅ shipped                            | [#448](https://github.com/njvil/surevax-cms-revamp/pull/448) |
| H3 Redis rate-limit                | ⚠️ deferred                           | —                                                            |
| H4 SPA CSP `_headers`              | ✅ shipped                            | [#447](https://github.com/njvil/surevax-cms-revamp/pull/447) |
| H4 Helmet hardening                | ⚠️ deferred                           | —                                                            |
| H5 JWT iss/aud claims              | ✅ shipped                            | [#448](https://github.com/njvil/surevax-cms-revamp/pull/448) |
| H5 distinct secrets + RS256        | ⚠️ deferred to pre-prod               | —                                                            |
| H6 audit trigger EXCEPTION cleanup | ✅ shipped                            | [#449](https://github.com/njvil/surevax-cms-revamp/pull/449) |
| H6 strict tenant-match             | ⚠️ deferred (worker `WORKER` literal) | —                                                            |
| H7 consent revocation gate         | ❌ open                               | —                                                            |
| H8 PHI access log coverage         | ❌ open                               | —                                                            |
| H9 CONCURRENTLY future-proofing    | ✅ shipped (rule + runner carve-out)  | [#449](https://github.com/njvil/surevax-cms-revamp/pull/449) |
| H9 retrofit existing 18 files      | ⚠️ deferred to pre-prod               | —                                                            |
| H10 junction FK CASCADE            | ✅ shipped                            | [#445](https://github.com/njvil/surevax-cms-revamp/pull/445) |
| H11 frontend test scaffold         | ❌ open                               | —                                                            |
| H12 query-key drift                | ✅ shipped                            | [#447](https://github.com/njvil/surevax-cms-revamp/pull/447) |
| H13 apiFetch refresh dedup         | ✅ shipped                            | [#449](https://github.com/njvil/surevax-cms-revamp/pull/449) |
| H14 integration test cross-talk    | ❌ open                               | —                                                            |

Plus 1 cross-cutting frontend win: **B40 backend resolution** of `createdBy` ([#446](https://github.com/njvil/surevax-cms-revamp/pull/446)) + **`<UserLabel>` primitive** consumed across 10 detail drawers ([#450](https://github.com/njvil/surevax-cms-revamp/pull/450)).

---

## CRITICAL (must address before any real-data cutover)

### C1. PayMongo webhook signature verification is a no-op ✅ shipped

[`apps/backend/src/modules/payments_verifier/stub.ts:15`](../../apps/backend/src/modules/payments_verifier/stub.ts) returns `true` for any signature; wired as the active verifier in [`index.ts:25`](../../apps/backend/src/modules/payments_verifier/index.ts). Route is mounted **before** CSRF + auth ([`app.ts:114`](../../apps/backend/src/app.ts)) and writes to `payments` via `withPlatformTx` (RLS-bypass cross-tenant write). Today the stub returns `null` so the UPDATE block is unreachable, but the moment the real adapter is wired with a bug, this is exploitable.

**OWASP:** A07:2025 Authentication Failures, A01:2025 Broken Access Control.

**Fix:** refuse to load the stub when `NODE_ENV=production` or `PAYMENT_VERIFIER` is unset; return 503 from the route until the real verifier is wired. Document the gate in `risks.md`.

**Shipped 2026-05-23** ([#449](https://github.com/njvil/surevax-cms-revamp/pull/449)): `getVerifier()` throws `PAYMENT_VERIFIER_NOT_CONFIGURED` when `NODE_ENV=production` and `PAYMENT_VERIFIER` is unset (or set to `'stub'`). The webhook route catches and replies `503`. Stub remains the default in dev.

### C2. Supplemental SQL migrations run without a transaction wrapper ✅ shipped

[`migrate.ts:99-105`](../../apps/backend/src/shared/db/migrate.ts) loads each of 16 supplemental SQL files via `client.unsafe(sql)` with no enclosing `BEGIN/COMMIT`. Partial application is possible mid-file (dependency races, mid-file syntax error). Combined with `restartPolicyMaxRetries=10` ([`railway.toml:7-8`](../../railway.toml)), a failure crash-loops on a half-applied schema and the next 10 boots replay the same partially-applied file. [`gotchas.md`](../../.claude/rules/gotchas.md) records a real incident (PR #316: 4 consecutive deploy failures from this exact pattern).

**Fix:** wrap each file in `await client.begin(async sql => { await sql.unsafe(fileContents) })`.

**Shipped 2026-05-23** ([#449](https://github.com/njvil/surevax-cms-revamp/pull/449)): each file in `SUPPLEMENTAL_SQL_FILES` now runs inside `client.begin(async tx => { await tx.unsafe(sql) })`. Carve-out detects `CREATE INDEX CONCURRENTLY` (cannot run inside a tx) and applies those files via `client.unsafe()` directly. Files that ship their own `BEGIN/COMMIT` (e.g. `0019_junction_fk_cascades.sql`) keep working — Postgres tolerates the nested `BEGIN` as a no-op.

---

## HIGH (production-readiness blockers)

### H1. postgres-js client runs with defaults — no pool sizing, no idle timeout, no max lifetime ✅ shipped

[`db/index.ts:9-18`](../../apps/backend/src/shared/db/index.ts) sets only `types.int8`. Defaults are `max:10`, no `idle_timeout`, no `max_lifetime`. Under Railway's default `max_connections=100`, stale connections survive SIGTERM cycles and stack against the cap. Migration runner correctly sets `max:1` ([`migrate.ts:79`](../../apps/backend/src/shared/db/migrate.ts)) — the runtime client needs analogous explicit config.

**Fix:** `{ max: 10, idle_timeout: 30, max_lifetime: 1800, connect_timeout: 10 }`.

**Shipped 2026-05-23** ([#447](https://github.com/njvil/surevax-cms-revamp/pull/447)): `db/index.ts` now passes `{ max: 10, idle_timeout: 30, max_lifetime: 1800, connect_timeout: 10 }` (along with the existing `types.int8` coercion).

### H2. No request-ID correlation; pino is detached from HTTP ✅ shipped

No `pino-http` mounted in [`app.ts`](../../apps/backend/src/app.ts). `audit_logs.correlation_id` and `ip_address` columns exist ([`0001_extensions_and_rls.sql:38-59`](../../apps/backend/drizzle/0001_extensions_and_rls.sql)) but the trigger ([`0002_audit_and_redaction.sql:124-141`](../../apps/backend/drizzle/0002_audit_and_redaction.sql)) never populates them — no `app.current_correlation_id` GUC is ever set. Debugging a prod 500 requires guessing which log line belongs to which request; the tamper-evident audit chain cannot answer "from what IP did user X UPDATE this row." Forensic gap.

**Fix:** mount `pino-http` + a request-ID middleware writing to both `req.log` and new GUCs. Extend `withTenantTx({ ipAddress, correlationId })`; trigger reads them via `current_setting('app.current_ip_address', true)`.

**Shipped 2026-05-23:** `pino-http` is mounted at the top of the Express stack, preserves or mints `X-Request-Id`, and stores correlation/IP/user-agent in an `AsyncLocalStorage` request context. `withTenantTx` / `withPlatformTx` set `app.current_correlation_id`, `app.current_ip_address`, and `app.current_user_agent`; the audit trigger now inserts those values into `audit_logs`.

### H3. Rate-limiter and PIN-attempt lockout are in-memory; bypassable across replicas and restarts ⚠️ partial

[`app.ts:87-94`](../../apps/backend/src/app.ts) (global 100/min) and [`auth/routes.ts:29-34`](../../apps/backend/src/modules/auth/routes.ts) (auth 10/min) use the default memory store. PIN-attempt lockout has the same problem: [`auth/routes.ts:215`](../../apps/backend/src/modules/auth/routes.ts) is `const pinAttempts = new Map<string, PinAttemptRecord>()` — per-process state, zero persistence. Railway restart wipes lockout state; >1 replica multiplies the attempt budget. Password login already does this correctly via [`auth/db.ts:45-72`](../../apps/backend/src/modules/auth/db.ts).

**OWASP ASVS 5.0 §2.2.1:** anti-automation enforced server-side across instances.

**Fix:** add Redis-backed `rate-limit-redis`; move PIN attempts into a DB table mirroring the existing `users.failed_login_count` / `locked_until` pattern.

**Shipped 2026-05-23** ([#448](https://github.com/njvil/surevax-cms-revamp/pull/448)): **PIN lockout** is now DB-backed via the new `pin_attempts` table (migration `0021_pin_attempts.sql`, tenant-scoped, FK-cascaded on user delete). The `pinAttempts` Map in `auth/routes.ts` was deleted. **Still open**: global + auth rate-limiters remain `express-rate-limit` default-memory-store; Redis migration deferred.

### H4. Helmet runs with defaults + no CSP on the SPA host ⚠️ partial

[`app.ts:74`](../../apps/backend/src/app.ts) is `app.use(helmet())` with no options. More importantly, **no `apps/frontend/public/_headers` file exists** — Cloudflare Pages serves the SPA with no CSP, no `X-Frame-Options`, no aggressive cache headers. Combined with cross-site cookies and presigned R2 URLs, this is the realistic exposure.

**OWASP A02:2025 Security Misconfiguration.**

**Fix:** add `apps/frontend/public/_headers` with explicit CSP including `connect-src` to Railway, `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`. Tighten Helmet HSTS to ≥1y with preload.

**Shipped 2026-05-23** ([#447](https://github.com/njvil/surevax-cms-revamp/pull/447)): `apps/frontend/public/_headers` added with explicit CSP (`script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `connect-src 'self' https://*.up.railway.app https://api.surevax.com`), `X-Frame-Options: DENY`, HSTS 1y + preload, hashed-asset immutable cache + no-cache on `/index.html`. **Still open**: Helmet `app.use(helmet())` defaults still need tightening on the backend side (HSTS / CSP injection points).

### H5. JWT uses HS256 with no `issuer`/`audience` claims; operator + tenant tokens share trust boundary ⚠️ partial

[`auth/service.ts:19`](../../apps/backend/src/modules/auth/service.ts) sets `JWT_ALG='HS256'`. `signAccess` and `signOperatorAccess` both use `ACCESS_SECRET`; tenant-admin vs platform-operator is distinguished only by `isPlatformAdmin: true` in the payload, checked at [`shared/middleware/auth.ts:36`](../../apps/backend/src/shared/middleware/auth.ts). Anyone who can mint a token with that claim (via secret leak or a future signing bug) gets cross-tenant admin.

**RFC 8725 §2.1, §3.1; [Curity JWT best practices](https://curity.io/resources/learn/jwt-best-practices/):** require explicit `aud`, distinct secrets per audience, asymmetric algorithms for PHI systems.

**Fix (immediate):** add `issuer: 'surevax-cms'`, `audience: 'surevax-tenant' | 'surevax-operator'`; use distinct secrets. **Fix (planned before prod data):** migrate to RS256/EdDSA with JWKS rotation.

**Shipped 2026-05-23** ([#448](https://github.com/njvil/surevax-cms-revamp/pull/448)): all access tokens carry `iss: 'surevax-cms'`. Tenant tokens carry `aud: 'surevax-tenant'`; operator tokens carry `aud: 'surevax-operator'`. `verifyAccess` checks the issuer; `verifyOperatorAccess` checks issuer + operator audience (second-pass in auth middleware after `isPlatformAdmin` discrimination). Cross-audience minting closed via the audience check. **Still open**: distinct secrets per audience + RS256/EdDSA migration deferred to pre-prod.

### H6. Audit trigger silently allows GUC/row tenant mismatch + swallows GUC cast failures ⚠️ partial

[`0002_audit_and_redaction.sql:55-66`](../../apps/backend/drizzle/0002_audit_and_redaction.sql) checks that `app.current_tenant_id` is _set_, not that it _matches_ `NEW.tenant_id`. RLS+FORCE blocks the actual write today, but the audit row is the forensic primary witness — it should fail-closed on mismatch. Lines 45-53: `EXCEPTION WHEN others THEN v_user_id := NULL` swallows GUC cast failures, writing audit rows with `user_id=NULL` instead of refusing.

**Fix:** compare GUC to `NEW.tenant_id`; remove the catch-all exception handler around the cast.

**Shipped 2026-05-23 (partial)** ([#449](https://github.com/njvil/surevax-cms-revamp/pull/449)): new supplemental `0020_audit_trigger_strict.sql` `CREATE OR REPLACE`s `audit_log_changes()`. Removes the `EXCEPTION WHEN others` catch-all on GUC casts so malformed values now raise instead of silently writing `user_id=NULL`. **Still deferred**: strict `GUC = NEW.tenant_id` match. `domainEventsPublisher.ts:96` literally sets `app.current_tenant_id = 'WORKER'` for system-originated writes; a strict-match check would crash the worker. Resolve real tenant IDs in the worker first.

### H7. Consent revocation has no enforcement gate

[`scheduled_orders/db.ts:345-437`](../../apps/backend/src/modules/scheduled_orders/db.ts) reads `consents.revokedAt` only to _report_ `consentObtained` — no INSERT/UPDATE path on `clinical_orders`, `lab_orders`, `transactions`, or `encounters` checks revocation before proceeding. Comment at line 345 explicitly tags this as a deviation.

**DPA §19 + §34(b):** withdrawal of consent is a substantive right; processing after withdrawal is non-compliant.

**Fix:** service-layer `assertActiveConsent(tenantId, patientId, scope)` in the same `withTenantTx` as the clinical write; ideally also a DB CHECK function for defense-in-depth.

### H8. PHI access log covers 3 URL patterns; every other PHI endpoint is silent

[`phiAccessLog.ts:18-22`](../../apps/backend/src/shared/middleware/phiAccessLog.ts) matches only `/api/patients/:id`, `/api/encounters/:id`, `/api/clinical-orders/:id`. Missed: `/api/patients` list (returns names, MRNs), `/api/patients/:id/consents`, all FHIR endpoints (`/Patient`, `/Encounter`, `/Immunization`), `/api/lab-orders`, `/api/adverse-events`, `/api/bite-incidents`, `/api/admin/audit`. **DPA §20(c)(4) + HIPAA §164.312(b):** log all PHI views.

**Fix:** invert the gate — log all `/api/*` GETs that touch PHI tables, with an explicit non-PHI allowlist. Or annotate routers with `phiResource: 'patient' | ...` and have the middleware key off the annotation.

### H9. Indexes not created CONCURRENTLY ⚠️ partial

Every `CREATE INDEX` across [`0001_extensions_and_rls.sql`](../../apps/backend/drizzle/0001_extensions_and_rls.sql), [`0005_modern_pg.sql`](../../apps/backend/drizzle/0005_modern_pg.sql), [`0009_audit_chain.sql`](../../apps/backend/drizzle/0009_audit_chain.sql) — zero `CONCURRENTLY` in 17 files, despite [`patterns.md`](../../.claude/rules/patterns.md) mandating it. Phase 1 always runs destructive reset so it's dormant — the moment tenant #2 onboards with live data, the next index addition takes an `ACCESS EXCLUSIVE`-equivalent lock on every table. [`0008_session_timeouts.sql`](../../apps/backend/drizzle/0008_session_timeouts.sql) sets statement/idle timeouts but not `lock_timeout`.

**Fix:** future index DDL outside the wrapped tx + `CREATE INDEX CONCURRENTLY`; `SET lock_timeout='5s'` at the top of risky migration sessions.

**Shipped 2026-05-23 (partial)** ([#449](https://github.com/njvil/surevax-cms-revamp/pull/449)): rule strengthened in [`patterns.md`](../../.claude/rules/patterns.md) with explicit audit-finding note; the migration runner C2 wrapper now detects `CREATE INDEX CONCURRENTLY` and applies such files via `client.unsafe()` (outside the tx) so future index DDL can land cleanly. **Retrofit of the existing 18 supplemental files deferred until pre-prod** (Phase 1 destructive reset masks the gap).

### H10. Junction-table FKs miss `ON DELETE CASCADE` (convention violation) ✅ shipped

[`schema.ts:1447-1452, 1466-1488, 1509-1511`](../../apps/backend/src/shared/db/schema.ts) — `user_branches.user_id/branch_id`, `user_roles.user_id/branch_id`, `user_sessions.user_id`, `password_reset_tokens.user_id` all default to `NO ACTION`. Only `refresh_tokens.user_id` correctly cascades (line 373). [`patterns.md`](../../.claude/rules/patterns.md) FK matrix says junction → entity = cascade. Deleting a user currently fails with FK violation, blocking GDPR/DPA erasure. Same drift on `encounter_vitals.encounter_id`, `encounter_diagnoses.encounter_id` (sub-records, should cascade per the matrix).

**Fix:** add `onDelete: 'cascade'` to all six FKs.

**Shipped 2026-05-23** ([#445](https://github.com/njvil/surevax-cms-revamp/pull/445)): 7 FKs flipped to `ON DELETE CASCADE` — `user_branches.user_id` + `.branch_id`, `user_roles.user_id`, `user_sessions.user_id`, `password_reset_tokens.user_id`, `encounter_vitals.encounter_id`, `encounter_diagnoses.encounter_id`. `schema.ts` updated for fresh DBs; new supplemental `0019_junction_fk_cascades.sql` retrofits existing Phase 1 DBs via `pg_constraint` lookup + replacement.

### H11. Frontend has one test file covering one utility module

[`sensitive.test.ts`](../../apps/frontend/src/shared/lib/sensitive.test.ts) is the only frontend test (33 `it()` blocks on a pure util). `apps/frontend/vitest.config.ts:6` sets `environment: 'node'`; no `@testing-library/react`, no MSW, no Playwright/Cypress. TransactionsCreatePage, ArrivalsPage, scheduled-orders flow — all untested.

**Fix:** add MSW v2 + `vitest-environment-jsdom` + RTL for component tests of the three critical flows; ≤10 Playwright tests for end-to-end coverage of login → patient → encounter → transaction.

### H12. Query-key drift on `scheduledOrders` vs `scheduled-orders` silently breaks invalidation ✅ shipped

[`patients/api.ts:519`](../../apps/frontend/src/features/patients/api.ts) and [`arrivals/api.ts:98`](../../apps/frontend/src/features/arrivals/api.ts) invalidate `['scheduled-orders']`; canonical key at [`scheduled-orders/api.ts:142`](../../apps/frontend/src/features/scheduled-orders/api.ts) is `['scheduledOrders']`. TanStack v5 keys are JSON-serialized exactly — these never match. Cancelling pending orders from PatientDetail and Day-0 intake do not refresh the Scheduled Orders worklist.

**Fix:** four single-line edits, then centralize via a `scheduledOrderKeys = { all: ['scheduledOrders'] as const, list: …, detail: … }` factory in `features/scheduled-orders/keys.ts`.

**Shipped 2026-05-23 (immediate fix)** ([#447](https://github.com/njvil/surevax-cms-revamp/pull/447)): both call sites flipped to `['scheduledOrders']`. The query-key factory consolidation is deferred — single-line fix sufficient for now.

### H13. `apiFetch` 401-refresh path can thundering-herd on parallel queries ✅ shipped

[`apiFetch.ts:47-67`](../../apps/frontend/src/lib/apiFetch.ts) issues `/api/auth/refresh` inline per call. PatientDetail fires 5 concurrent queries; if access token expired, every 401 fires its own refresh — server-side rotation means one wins, others get `SESSION_EXPIRED` and force a redirect.

**Fix:** single in-flight `refreshPromise` that all 401s await; clear on settle.

**Shipped 2026-05-23** ([#449](https://github.com/njvil/surevax-cms-revamp/pull/449)): module-level `refreshPromise` singleton in `apiFetch.ts`. All concurrent 401s `await getRefresh()`; the promise clears on settle so the next 401 cycle can refresh again.

### H14. Integration tests share post-seed state with `fileParallelism: false`

[`vitest.config.ts:26`](../../apps/backend/vitest.config.ts) sets `fileParallelism: false`; comment at lines 4-7 acknowledges cross-talk risk. [`rls-multi-tenant.test.ts:33`](../../apps/backend/tests/integration/rls-multi-tenant.test.ts) uses `Date.now()` as a suffix to dodge collisions — exactly the smell that confirms cross-talk is already real.

**Fix:** wrap each test in `BEGIN ... ROLLBACK` (per `pgsql-test` pattern), or per-test sub-tenant fixtures.

---

## MEDIUM (should-fix soon; most <50 LoC each)

| #   | Finding                                                                    | Evidence                                                            | Fix                                                                                          |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| M1  | `CORS_ORIGIN` is a single string; needs array for preview/custom-domain    | `env.ts:31`, `app.ts:79`                                            | Parse as comma-separated list; pass array to `cors()`; reject `*` in prod                    |
| M2  | `EXPOSE_ERRORS` has no production hard-stop                                | `error.ts:18`, `env.ts:67-95`                                       | Push error in production-only env block if flag true                                         |
| M3  | No shared `ApiError` class; every route hand-rolls `res.status().json()`   | `shared/middleware/error.ts` + many routes                          | Single class thrown from services, caught in global handler; leans on Express 5 async bubble |
| M4  | `requireRole` has stale local `AuthUser` typedef                           | `requireRole.ts:3-9` vs `auth.ts:92-110`                            | Export `AuthUser` from `auth.ts`; delete local copy                                          |
| M5  | PIN values are 4 digits + bcrypt; brute-force only blocked by in-memory H3 | `auth/db.ts:263`, `routes.ts:242`                                   | Persistent lockout (depends on H3); permanent lock after 20 fails, admin unlock              |
| M6  | Refresh-token DB lookup doesn't bind `jti` to `userId`                     | `auth/db.ts:205-213`                                                | Add `AND user_id = ${ctx.userId}` predicate                                                  |
| M7  | `useForm` defaults to `mode: 'onSubmit'` everywhere                        | All forms                                                           | Shared form-factory hook sets `mode: 'onTouched'`                                            |
| M8  | DirtyFormGuard SPA-navigation blocker is disabled                          | `DirtyFormGuard.tsx:35-47`; `main.tsx:21`                           | Migrate to `createBrowserRouter` + `<RouterProvider>`; re-enable `useBlocker`                |
| M9  | Hand-rolled `<h1>` in PatientList bypasses design-system gate              | `PatientList.tsx:188,295`                                           | Add `// why:` comment for allowlist entries; codemod when convenient                         |
| M10 | Pino redact list incomplete vs audit-trigger deny-list                     | `logger.ts:9-19`                                                    | Add `req.body.pin`, `req.body.token`, `req.body.mfaSecret`, `*.contactNumber`, `*.address`   |
| M11 | `tenants` table has NO RLS                                                 | `0001_extensions_and_rls.sql:396-451`                               | RLS policy limiting SELECT to caller's own tenant row + platform-admin bypass                |
| M12 | `branch_isolation` policy default-opens on empty GUC                       | `0001_extensions_and_rls.sql:495-507`, `withTenantTx.ts:32`         | Invert: explicit `app.cross_branch_read='true'` for cross-branch ops                         |
| M13 | Retention worker exists but `retain_audit_partitions(10)` has no runner    | `0010_audit_retention.sql:78-82`, `workers/auditPartitionRotate.ts` | Add `retain_audit_partitions` call, gated on `WORKERS_ENABLED=true`                          |
| M14 | No error tracking, no metrics, no tracing                                  | zero hits for `sentry`/`@opentelemetry`/`prom-client`               | `@opentelemetry/sdk-node` + `@opentelemetry/instrumentation-express` + Sentry                |
| M15 | No coverage thresholds enforced                                            | `vitest.config.ts:32-42`; CI never runs `test:coverage`             | Set `lines: 60` / `functions: 50` baseline                                                   |
| M16 | No re-migrate idempotency smoke                                            | CI applies once                                                     | Run `db:deploy` twice in CI; optionally `pg_dump --schema-only` diff vs `schema.ts`          |
| M17 | Audit trigger redacts clinical-notes JSONB, leaving audit content-empty    | `0002_audit_and_redaction.sql:69-94`                                | Encrypt-at-rest via pgcrypto rather than drop content-bearing keys                           |

---

## LOW / NIT

- No project references / `composite: true` despite a 3-package monorepo. Borderline; ties into the `@surevax/shared` runtime gap.
- **`@surevax/shared` runtime import gap** — backend can't value-import; documented in [`gotchas.md`](../../.claude/rules/gotchas.md), but the inline-Zod workaround is a long-running tax on every new route. Fix: add `"source"` / `"development"` export condition or drop the `paths` alias and rely on workspace symlink + built `dist/`.
- Vite 6 → 8 (Vite 8 stable, Rolldown-based). LOW.
- No commit-message enforcement — ~6% drift in last 50 commits (`gh pr` merge titles, branch-name commits). Add commitlint GitHub Action.
- `lucide-react@1.8.0` is 8 minors behind. NIT.
- `express-rate-limit` v7 → v8 (IPv6/trust-proxy improvements). NIT.
- `audit_log_changes()` is `SECURITY DEFINER` without `SET search_path` — `0011_audit_chain_verifier.sql` correctly sets it but `0002` doesn't. NIT.
- `/health` doesn't hit the DB; `/ready` does but is auth-gated and unused by Railway. Documented intentional gap; flag in [`docs/ENVIRONMENTS.md`](../ENVIRONMENTS.md).
- `window.location.href` redirect in `apiFetch:59` races React state cleanup (matches global memory `feedback_browser_auth_no_full_reload`).
- Sequential `branch_seq` + `MRN-NNNNNN` leak business volume on receipts. Random Crockford display_id elsewhere is great — these two are inconsistent. Mitigation deferred; flag for prod-data readiness.
- `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` not set — SIGTERM is followed immediately by SIGKILL. Graceful-shutdown handler at [`index.ts:47-65`](../../apps/backend/src/index.ts) is good but never has time to run. Set service var to ≥15s.
- `Branch` service-account role uses long-lived bcrypt password — should be mTLS or signed kiosk token before prod.
- Domain events worker uses literal `'WORKER'` as tenant GUC ([`domainEventsPublisher.ts:96-98`](../../apps/backend/src/workers/domainEventsPublisher.ts)) — fragile vs. real tenant validation in audit trigger.
- `signed: true` cookie option never used; `COOKIE_SECRET` is dead code. Either remove or actually sign critical cookies.
- `console.log`/`console.error` in `migrate.ts`, `seed/*.ts`, `idempotency.ts:161` — bypasses Pino redaction.

---

## What this codebase does materially well

1. **Audit-trigger architecture is exemplary.** RLS+GUC tenant isolation, BEFORE-INSERT SHA-256 chain ([`0009_audit_chain.sql`](../../apps/backend/drizzle/0009_audit_chain.sql)), RESTRICTIVE no-update policies on `audit_logs`/`phi_access_log`, `verify_audit_chain(partition)` walker run daily, 10-year partition retention target. Better than HIPAA's floor, exceeds DPA §20.
2. **`FORCE ROW LEVEL SECURITY` + transaction-local `set_config(..., true)`** closes the owner-bypass gap that is the biggest RLS-in-production pitfall (AWS, Nile, Crunchy Data 2025).
3. **GENERATED columns + immutability triggers with `pg_trigger_depth() > 1` exemption** — `transactions.amount_outstanding` and paid-txn/completed-order immutability are correct-by-construction patterns very few teams get right.
4. **Refresh-token rotation with family revocation** ([`auth/routes.ts:149-156`](../../apps/backend/src/modules/auth/routes.ts)) — RFC 9700 / OAuth-WG recommended pattern, with `markReplaced` linkage so audit trail can rebuild the family graph.
5. **Timing-equalized login** ([`auth/service.ts:26,116`](../../apps/backend/src/modules/auth/service.ts)) — pre-computed `DUMMY_HASH` prevents user-enumeration-by-timing. Above-bar for Phase 1.
6. **Production fail-closed env validation** ([`env.ts:67-95`](../../apps/backend/src/shared/config/env.ts)) — checks dev-secret markers, secret length ≥32, `localhost` in CORS. Catches realistic mistakes.
7. **Strict middleware ordering** — helmet → cors → rate-limit → body → CSRF → auth → tenant → PHI logging → routes → error handler. `/health` carve-out before CSRF/auth is right; `payment_webhooks` before CSRF for signed callbacks is canonical (modulo C1's stub).
8. **CI mirrors Railway's `startCommand` exactly** — `.github/workflows/ci.yml:120-124` runs the same migrate script against a real Postgres in PR CI. Single most valuable infra invariant in the repo.
9. **No state-management sprawl** — zero `redux`/`zustand`/`jotai`/`axios`. TanStack Query + RHF + Context only.
10. **`apiFetch` discipline** — one canonical fetch util; all 25 feature `api.ts` files import from `@/lib/apiFetch`; CSRF + credentials survive the 401-retry path.
11. **`useFormField` a11y wiring** — [`components/ui/form.tsx:101-102`](../../apps/frontend/src/components/ui/form.tsx) injects `aria-describedby` + `aria-invalid` automatically. Above-bar.
12. **`onlyBuiltDependencies` allowlist** + pinned `packageManager` + `--frozen-lockfile` in CI — model pnpm-9.5+ supply-chain posture.
13. **Strict TS baseline** — `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride`. Few monorepos opt into `noUncheckedIndexedAccess`.
14. **Drizzle `sql.raw()` discipline** — every use is constant or `/^[a-zA-Z_][a-zA-Z0-9_]*$/`-validated. No CVE-2026-39356 exposure.

---

## Recommended priority order

| Order | Items             | Why now                                                                                          | Approx LoC           |
| ----- | ----------------- | ------------------------------------------------------------------------------------------------ | -------------------- |
| 1     | **C1, C2**        | Deploy-killers; both already documented as known foot-guns                                       | <50 each             |
| 2     | **H1, H3, H4**    | postgres-js pool / Redis rate-limit / SPA `_headers` — unblock prod scale; H2 shipped 2026-05-23 | ~150 remaining       |
| 3     | **H7, H8**        | Biggest DPA exposures (consent gate, PHI access log breadth)                                     | ~150                 |
| 4     | **H9, H10**       | CONCURRENTLY indexes + junction FK cascades — cheap and prevents Phase-2 pain                    | ~80                  |
| 5     | **H11, H12, H13** | MSW+RTL frontend tests for three critical flows; query-key typo; single-flight 401               | ~400 + test scaffold |
| 6     | **H5, H6**        | JWT `aud`/`iss` + distinct operator secret; audit trigger GUC/row equality                       | ~60                  |
| 7     | **MEDIUM batch**  | Most <20 LoC each; prioritize M1, M2, M13 (retention worker), M14 (OTel + Sentry)                | varies               |

The codebase is in better shape than the project-status notes suggest. Most gaps are "documented as known but unscheduled" rather than missing-architecture — meaning the fixes are scoped, not exploratory.

---

## Methodology

Eight parallel audit agents, each scoped to one aspect with no overlap:

1. Monorepo / build / TypeScript / deps
2. Backend (Express + Drizzle + Pino)
3. Database + multi-tenancy (RLS, audit, schema)
4. Authentication + security (OWASP 2025, JWT, cookies)
5. Frontend (React, TanStack Query, RHF, Shadcn)
6. Testing + CI
7. Infra + deployment (Cloudflare Pages, Railway)
8. Observability + compliance (DPA, audit, retention)

Each agent: (a) audited the actual code, (b) ran 5-10 web searches against current 2025/2026 best-practice sources, (c) returned 3-10 findings with severity + file:line evidence + source citation. Findings deduplicated and re-ranked into this document.

### Primary sources cited across the eight reports

- [OWASP Top 10:2025](https://owasp.org/Top10/2025/en/)
- [RFC 8725 — JWT Best Current Practices](https://datatracker.ietf.org/doc/html/rfc8725) + [Curity JWT guide](https://curity.io/resources/learn/jwt-best-practices/)
- [RFC 9700 / OAuth refresh token rotation](https://www.obsidiansecurity.com/blog/refresh-token-security-best-practices)
- [OWASP Session Management cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [AWS — Multi-tenant data isolation with PostgreSQL RLS](https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/)
- [Nile — Shipping multi-tenant SaaS using Postgres RLS](https://www.thenile.dev/blog/multi-tenant-rls)
- [Bytebase — Postgres schema migration without downtime](https://www.bytebase.com/blog/postgres-schema-migration-without-downtime/) + [shayon.dev on CONCURRENTLY](https://www.shayon.dev/post/2024/225/stop-relying-on-if-not-exists-for-concurrent-index-creation-in-postgresql/)
- [Drizzle ORM RLS docs](https://orm.drizzle.team/docs/rls) + [GHSA-gpj5-g38j-94v9 advisory](https://github.com/drizzle-team/drizzle-orm/security/advisories/GHSA-gpj5-g38j-94v9)
- [Node.js Structured Logging in Production — Pino + Correlation IDs](https://dev.to/axiom_agent/nodejs-structured-logging-in-production-pino-correlation-ids-and-log-aggregation-262m) + [pino-http](https://github.com/pinojs/pino-http)
- [Connection pooling in Node.js — OneUptime](https://oneuptime.com/blog/post/2026-01-06-nodejs-connection-pooling-postgresql-mysql/view) + [postgres-js docs](https://github.com/porsager/postgres)
- [rate-limit-redis](https://github.com/express-rate-limit/rate-limit-redis)
- [TanStack Query v5 Query Keys](https://tanstack.com/query/v5/docs/framework/react/guides/query-keys) + [discussion #3362](https://github.com/TanStack/query/discussions/3362)
- [RHF useForm modes](https://react-hook-form.com/docs/useform)
- [React 19 release notes](https://react.dev/blog/2024/12/05/react-19)
- [Vitest projects + fileParallelism](https://vitest.dev/config/fileparallelism) + [MSW v2 quick start](https://mswjs.io/docs/quick-start/)
- [Playwright best practices 2026 — BrowserStack](https://www.browserstack.com/guide/playwright-best-practices)
- [Testing PostgreSQL RLS with Atlas](https://atlasgo.io/faq/testing-rls) + [pgsql-test](https://www.npmjs.com/package/pgsql-test)
- [Railway healthchecks + draining](https://docs.railway.com/reference/healthchecks)
- [Express healthcheck + graceful shutdown](https://expressjs.com/en/advanced/healthcheck-graceful-shutdown.html)
- [Summary: Philippines Data Privacy Act — IAPP](https://iapp.org/news/a/summary-philippines-data-protection-act-and-implementing-regulations)
- [Breach Notification in the Philippines — BCCS Law](https://bccslaw.com/breach-notification-in-the-philippines/)
- [OpenTelemetry stability — Feb 2026](https://oneuptime.com/blog/post/2026-02-06-opentelemetry-stability-levels-stable-beta-alpha/view)
- [Transactional Outbox Pattern](https://www.npiontko.pro/2025/05/19/outbox-pattern) + [pg-boss](https://github.com/timgit/pg-boss)
- [tsx vs ts-node vs Bun — PkgPulse 2026](https://www.pkgpulse.com/guides/tsx-vs-ts-node-vs-bun-running-typescript-directly-2026)
- [Managing TS Packages in Monorepos — Nx Blog](https://nx.dev/blog/managing-ts-packages-in-monorepos) + [Live types in a TS monorepo — Colin McDonnell](https://colinhacks.com/essays/live-types-typescript-monorepo)
- [Vite 8 release](https://vite.dev/blog/announcing-vite8)

---

## Cross-references

- [`risks.md`](../../.claude/rules/risks.md) — items 3 (testing) + 5 (Express 5) updated 2026-05-23 to reflect verified state
- [`docs/handovers/2026-05-19-remaining-todos.md`](2026-05-19-remaining-todos.md) — §5 (compliance prep) overlaps with H7/H8/M13; this review extends with concrete file:line evidence
- [`docs/compliance/dpa-controls.md`](../compliance/dpa-controls.md) — at-rest encryption decision register (does not yet cover access-log breadth gap H8)
- [`.claude/rules/patterns.md`](../../.claude/rules/patterns.md) — FK cascade matrix (H10 is the convention being violated) and "Migration safety" (H9 is the convention being violated)
- [`.claude/rules/gotchas.md`](../../.claude/rules/gotchas.md) — already covers audit trigger GUC requirement, CSRF X-Requested-With contract, `@surevax/shared` runtime gap. C2 incident is recorded there (PR #316).
