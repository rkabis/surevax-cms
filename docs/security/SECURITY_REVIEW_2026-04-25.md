# Security Review — SureVax CMS

**Date:** 2026-04-25
**Branch:** `claude/flamboyant-burnell-8982be` (worktree)
**Reviewer:** Claude Opus 4.7
**Scope:** Full repository — backend, frontend, shared package, infra config, CI
**Remediation status:** All 15 findings remediated 2026-04-26 across PRs [#45](https://github.com/njvil/surevax-cms-revamp/pull/45), [#46](https://github.com/njvil/surevax-cms-revamp/pull/46), [#47](https://github.com/njvil/surevax-cms-revamp/pull/47), [#48](https://github.com/njvil/surevax-cms-revamp/pull/48), [#49](https://github.com/njvil/surevax-cms-revamp/pull/49), [#50](https://github.com/njvil/surevax-cms-revamp/pull/50). See per-finding "Remediation" notes below and the summary table.

> **Posture context.** Every deployed environment runs `NODE_ENV=development`
> with seeded data only (no real PHI yet). However, the deployed surface is
> internet-reachable: Cloudflare Pages frontend ↔ Railway backend on different
> eTLD+1s, with `SameSite=None`+`Secure` cookies. From a browser's
> perspective the system already behaves like production, so the findings
> below are scored against an internet-reachable threat model, not a
> localhost one.

## Severity rubric

| Severity     | Definition                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| **Critical** | Auth bypass, RCE, or mass data exfiltration possible _today_ with low-priv or no auth.                           |
| **High**     | Privilege escalation requiring active exploitation; secret material reachable; CSRF on state-changing endpoints. |
| **Medium**   | Defense-in-depth gaps that compound a Critical/High; information disclosure; weak rate limiting.                 |
| **Low**      | Hardening / hygiene.                                                                                             |
| **Info**     | Confirmed clean — recorded so future audits skip these.                                                          |

## Findings summary

| #   | Severity | Finding                                                                           | Status   | PR                                                                                                                      |
| --- | -------- | --------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | Critical | No role-based authorization on `/api/admin/*`                                     | ✅ Fixed | [#45](https://github.com/njvil/surevax-cms-revamp/pull/45)                                                              |
| 2   | Critical | Hardcoded JWT secret fallbacks bypass env validation                              | ✅ Fixed | [#47](https://github.com/njvil/surevax-cms-revamp/pull/47)                                                              |
| 3   | High     | No CSRF mitigation despite `SameSite=None` cookies                                | ✅ Fixed | [#48](https://github.com/njvil/surevax-cms-revamp/pull/48)                                                              |
| 4   | High     | Error handler leaks stack traces in every deployed environment                    | ✅ Fixed | [#46](https://github.com/njvil/surevax-cms-revamp/pull/46)                                                              |
| 5   | Medium   | Refresh tokens have no server-side state, rotation, or revocation                 | ✅ Fixed | [#50](https://github.com/njvil/surevax-cms-revamp/pull/50)                                                              |
| 6   | Medium   | No brute-force or login-specific rate limit; missing `trust proxy`                | ✅ Fixed | [#46](https://github.com/njvil/surevax-cms-revamp/pull/46) + [#47](https://github.com/njvil/surevax-cms-revamp/pull/47) |
| 7   | Medium   | Pino logger has no redaction config                                               | ✅ Fixed | [#46](https://github.com/njvil/surevax-cms-revamp/pull/46)                                                              |
| 8   | Medium   | Audit-log `changes` JSONB is fully searchable and contains sensitive prior values | ✅ Fixed | [#49](https://github.com/njvil/surevax-cms-revamp/pull/49)                                                              |
| 9   | Medium   | Audit trigger silently records `tenant_id=NULL` when GUC unset                    | ✅ Fixed | [#49](https://github.com/njvil/surevax-cms-revamp/pull/49)                                                              |
| 10  | Medium   | JWT verification swallows all errors as "Token expired"                           | ✅ Fixed | [#47](https://github.com/njvil/surevax-cms-revamp/pull/47)                                                              |
| 11  | Low      | bcrypt rounds = 10 (OWASP 2023 recommends 12)                                     | ✅ Fixed | [#47](https://github.com/njvil/surevax-cms-revamp/pull/47)                                                              |
| 12  | Low      | `/health` returns `NODE_ENV` (fingerprinting)                                     | ✅ Fixed | [#46](https://github.com/njvil/surevax-cms-revamp/pull/46)                                                              |
| 13  | Low      | `express.json()` has no explicit `limit`                                          | ✅ Fixed | [#46](https://github.com/njvil/surevax-cms-revamp/pull/46)                                                              |
| 14  | Low      | No `app.set('trust proxy', 1)`                                                    | ✅ Fixed | [#46](https://github.com/njvil/surevax-cms-revamp/pull/46)                                                              |
| 15  | Low      | Login flow has user-enumeration timing side-channel                               | ✅ Fixed | [#47](https://github.com/njvil/surevax-cms-revamp/pull/47)                                                              |

---

## Critical

### 1. No role-based authorization on `/api/admin/*` routes

- **Location:** [apps/backend/src/index.ts:109-112](apps/backend/src/index.ts:109)
- **What:** All four admin routers (`adminUsersRouter`, `adminAttendanceRouter`,
  `adminApprovalsRouter`, `adminAuditRouter`) are mounted after `authMiddleware`
  only. There is no `requireRole(...)` middleware in the codebase, and none of
  the admin routers check `req.user.role`. Verified by grep across
  `apps/backend/src/modules/admin/*` and `apps/backend/src/shared/middleware/`.
- **Impact:** Any authenticated user — Cashier, Nurse, Physician — can:
  - `GET /api/admin/users` → list every staff member with email, role,
    branch, license number ([apps/backend/src/modules/admin/users.ts:45-67](apps/backend/src/modules/admin/users.ts:45))
  - `GET /api/admin/users/:id` → full user detail
    ([apps/backend/src/modules/admin/users.ts:70](apps/backend/src/modules/admin/users.ts:70))
  - `GET /api/admin/audit` → search the full audit log (see #8 — the diffs
    contain PII)
  - `GET /api/admin/approvals` / `GET /api/admin/attendance` → workflow + time data
- **Reproducer (post-fix should 403):**
  ```bash
  # Log in as a Cashier
  curl -c /tmp/c.txt -X POST $API/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"jose.santos@surevax.com","password":"TestPass123!"}'
  # Hit admin endpoint — currently 200 with full user list
  curl -b /tmp/c.txt $API/api/admin/users
  ```
- **Suggested fix:** Add `requireRole('SuperAdmin','BranchAdmin')` middleware
  in `apps/backend/src/shared/middleware/`, apply at router-mount level in
  `index.ts`. Do this _before_ introducing real PHI.

### 2. Hardcoded JWT secret fallbacks bypass env validation

- **Location:** [apps/backend/src/modules/auth/service.ts:5-6](apps/backend/src/modules/auth/service.ts:5)
  ```ts
  const ACCESS_SECRET = process.env['JWT_ACCESS_SECRET'] ?? 'dev-access-secret'
  const REFRESH_SECRET = process.env['JWT_REFRESH_SECRET'] ?? 'dev-refresh-secret'
  ```
- **What:** [env.ts:27-28](apps/backend/src/shared/config/env.ts:27) marks both
  vars `.optional()`. The production guard at
  [env.ts:54-76](apps/backend/src/shared/config/env.ts:54) only checks
  `COOKIE_SECRET` and `JWT_SECRET`, not `JWT_ACCESS_SECRET` /
  `JWT_REFRESH_SECRET`. Additionally, `service.ts` reads `process.env`
  directly instead of importing the validated `env` object, defeating the
  centralized-validation contract documented in env.ts's own file header.
- **Impact:** If either Railway service variable is unset, the deploy starts
  and signs every token with the publicly-known string `dev-access-secret`
  (or `dev-refresh-secret`). Any attacker can forge a valid JWT for any
  user/role/tenant — full auth bypass, full PHI access, full admin (combined
  with #1).
- **Suggested fix:**
  1. In [env.ts](apps/backend/src/shared/config/env.ts): make both
     `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` required, `min(32)`.
  2. Add them to the production-guard `looksDev` check.
  3. In [service.ts](apps/backend/src/modules/auth/service.ts): `import { env }`
     and drop the `??` fallbacks.
  4. Also pin the JWT algorithm explicitly: `jwt.sign(..., { algorithm: 'HS256' })`
     and `jwt.verify(..., { algorithms: ['HS256'] })` to prevent algorithm-confusion
     attacks if the lib's defaults ever shift.

---

## High

### 3. No CSRF mitigation despite cross-site cookies

- **Location:** Cookies set at
  [apps/backend/src/modules/auth/routes.ts:8-13](apps/backend/src/modules/auth/routes.ts:8);
  middleware stack at [apps/backend/src/index.ts:42-69](apps/backend/src/index.ts:42).
- **What:** Cookies are `SameSite=None` + `Secure` (intentional, per
  [.claude/rules/gotchas.md](.claude/rules/gotchas.md) — Cloudflare Pages and
  Railway are different eTLD+1s). Frontend `apiFetch` uses
  `credentials: 'include'`. There is no CSRF token, no `X-CSRF-Token` header
  check, no Origin/Referer validation. CORS allows a single origin, but CORS
  only blocks the attacker from _reading_ responses — it does not block the
  request from being _sent_ with cookies attached.
- **Impact:** A user logged into SureVax who visits `evil.com` can have a
  hidden `<form>` or `fetch` send authenticated `POST` / `PATCH` / `DELETE`
  to the API. "Simple" form-encoded POSTs don't even trigger a preflight, so
  the request goes through and the browser attaches the cookies. An attacker
  can create encounters, mutate transactions, dispatch lab orders, etc.
  (mass-assignment is blocked — see Info — but state mutation is not).
- **Suggested fix:** One-line middleware that requires a custom header
  (e.g., `X-Requested-With: fetch`) on all non-GET routes. The custom header
  forces a preflight, which CORS will block from `evil.com`. Have `apiFetch`
  send the header. Alternative: double-submit CSRF token cookie.

### 4. Error handler leaks stack traces in every deployed environment

- **Location:** [apps/backend/src/shared/middleware/error.ts:11-17](apps/backend/src/shared/middleware/error.ts:11)
  ```ts
  const isProd = process.env['NODE_ENV'] === 'production'
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    ...(isProd ? {} : { detail: String(err) }),
  })
  ```
- **What:** Per [CLAUDE.md](CLAUDE.md), every deployed environment runs
  `NODE_ENV=development` (intentional — only `production` is fail-closed by
  env.ts). So `isProd` is always `false`, and `detail: String(err)` is
  _always_ included. The rest of the codebase has already moved off of
  keying production behavior on `NODE_ENV` (see env.ts's posture).
- **Impact:** Any unauthenticated caller who can trigger an exception (bad
  UUID format, invalid Zod input that bubbles, DB constraint violation) gets
  back the raw error string — SQL column hints, file paths, library internals.
  Useful as a recon primitive for chained attacks; also a privacy issue if
  an exception ever surfaces row data.
- **Suggested fix:** Gate the `detail` field on an explicit `EXPOSE_ERRORS=1`
  env flag (default off) instead of `NODE_ENV`. Keep stack traces in the
  pino log line for ops, never in the HTTP response.

---

## Medium

### 5. Refresh tokens have no server-side state, rotation, or revocation

- **Location:** [apps/backend/src/modules/auth/service.ts](apps/backend/src/modules/auth/service.ts);
  [apps/backend/src/modules/auth/routes.ts](apps/backend/src/modules/auth/routes.ts)
- **What:** 7-day refresh tokens are pure JWTs with no `jti`, no DB row, no
  rotation-on-use, no logout-everywhere mechanism, no reuse detection. The
  refresh route mints new access tokens for any signature-valid refresh
  cookie. The `users.isActive` flag is not consulted on refresh.
- **Impact:** A stolen refresh token (XSS chain, device theft, leaky log)
  is valid for the full 7-day window and survives a password reset. There is
  no way for ops or the user to invalidate a session.
- **Suggested fix:** Persist `refresh_tokens(id, user_id, jti, family_id,
expires_at, revoked_at)`. Rotate on each use; on detected reuse of a
  revoked token, revoke the entire family. Check `isActive` at refresh time.

### 6. No brute-force / login-specific rate limit; `trust proxy` missing

- **Location:** [apps/backend/src/index.ts:54-59](apps/backend/src/index.ts:54)
- **What:** Global limit is 100 req/min/IP across all routes. `/api/auth/login`
  is bound by the same limit, so 100 password guesses/minute/IP are allowed.
  No account lockout, no CAPTCHA, no per-email throttle. Compounds with #15
  (timing-based user enumeration).
  Separately, `app.set('trust proxy', ...)` is never called. Behind Railway's
  proxy, all requests will appear to come from the proxy IP, which means
  the per-IP limit effectively becomes a single global bucket — defeating
  per-client throttling entirely.
- **Suggested fix:** Add a dedicated limiter on `/api/auth/login` and
  `/api/auth/refresh` (e.g., 5/min per IP plus 10/hour per email).
  Set `app.set('trust proxy', 1)` and configure the rate-limiter's `keyGenerator`
  to use the leftmost `X-Forwarded-For` value.

### 7. Pino logger has no redaction config

- **Location:** [apps/backend/src/shared/utils/logger.ts](apps/backend/src/shared/utils/logger.ts)
  (entire file — bare `pino()`)
- **What:** Default pino has no `redact` paths. The error handler at
  [error.ts:9](apps/backend/src/shared/middleware/error.ts:9) currently logs
  only `{ err, path, method }` — safe today — but the moment any future
  code logs `req`, `req.body`, or `req.headers`, cookies (= access + refresh
  tokens) and login passwords land in stdout. On Railway, that pipeline is
  retained.
- **Suggested fix:** Centralized redact config:
  ```ts
  pino({
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'req.body.password',
        'req.body.passwordHash',
        '*.passwordHash',
        'res.headers["set-cookie"]',
      ],
      remove: true,
    },
  })
  ```

### 8. Audit-log `changes` JSONB is fully searchable and contains sensitive prior values

- **Location:** Search exposed at
  [apps/backend/src/modules/admin/audit.ts:27](apps/backend/src/modules/admin/audit.ts:27)
  via `${auditLogs.changes}::text ILIKE ${pattern}`. Trigger that fills the
  column: [apps/backend/drizzle/0001_rls_triggers_extensions.sql](apps/backend/drizzle/0001_rls_triggers_extensions.sql)
  (audit trigger ~lines 299-363).
- **What:** Every UPDATE writes the full row diff into `audit_logs.changes`
  including patient PII (name, DOB, phone, address), allergies/conditions,
  and — if any code path ever updates the `password_hash` column directly —
  the hash. Compounds with #1 (this endpoint is reachable by any
  authenticated user today).
- **Suggested fix:** At trigger time, redact known-sensitive columns from
  the diff before insertion. Maintain an explicit allow-list of column names
  per table that are eligible for the diff payload, OR a deny-list of names
  that always get scrubbed (`password_hash`, `allergies`, `conditions`,
  contact fields). Also drop the `ILIKE ... ::text` search path until the
  payload is sanitized.

### 9. Audit trigger silently records `tenant_id=NULL` when GUC unset

- **Location:** [apps/backend/drizzle/0001_rls_triggers_extensions.sql](apps/backend/drizzle/0001_rls_triggers_extensions.sql)
  (audit function, ~lines 299-340).
- **What:** The audit function is `SECURITY DEFINER` and reads
  `current_setting('app.current_tenant_id', true)` (the `true` makes it
  return NULL instead of erroring). When the GUC is not set, it falls back
  to extracting tenant_id from the row itself. If a future code path ever
  writes outside a `db.transaction(...)` wrapper that runs `set_config`,
  the audit row succeeds silently — the tenant-boundary breach is invisible
  in logs.
- **Suggested fix:** Make the trigger raise an exception when the GUC is
  null, converting the audit pipeline into a positive integrity check that
  enforces the "every write must have RLS context" rule.

### 10. JWT verification swallows all errors as "Token expired"

- **Location:** [apps/backend/src/shared/middleware/auth.ts:30](apps/backend/src/shared/middleware/auth.ts:30)
  ```ts
  } catch {
    res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' })
  }
  ```
- **What:** Catches `TokenExpiredError`, `JsonWebTokenError`, malformed,
  signature-mismatch — all reported identically. Forgery attempts are
  indistinguishable from normal session expiry in the logs.
- **Suggested fix:** Distinguish via `instanceof jwt.TokenExpiredError` vs
  `jwt.JsonWebTokenError`; log the latter at WARN with the (partial) token,
  remote IP, and route — feeds an alert when forgery attempts spike.

---

## Low

### 11. bcrypt rounds = 10

- **Location:** [apps/backend/src/shared/db/seed.ts](apps/backend/src/shared/db/seed.ts)
  (bcrypt.hash calls). Confirm the same factor is used in any future
  registration / password-set path.
- **Fix:** Bump to 12 (≈ 250 ms on modern hardware — still acceptable login latency).

### 12. `/health` exposes `NODE_ENV`

- **Location:** [apps/backend/src/index.ts:74](apps/backend/src/index.ts:74)
  returns `{ status: 'ok', env: env.NODE_ENV }`.
- **Fix:** Drop the `env` field — minor fingerprinting, no operational
  benefit (the dashboards already know).

### 13. `express.json()` has no explicit `limit`

- **Location:** [apps/backend/src/index.ts:62](apps/backend/src/index.ts:62)
- **Fix:** Pin `express.json({ limit: '100kb' })` to make the contract
  explicit and to provide a single knob to bump if a future endpoint needs
  larger payloads.

### 14. No `app.set('trust proxy', 1)`

- See #6 — without this, `req.ip` is the Railway proxy IP, and rate limiting
  (and any future per-client logic) collapses into a single global bucket.

### 15. Login user-enumeration timing side-channel

- **Location:** [apps/backend/src/modules/auth/service.ts:36-37](apps/backend/src/modules/auth/service.ts:36)
  ```ts
  const user = await findUserByEmail(email)
  if (!user) return null
  ```
  Returns immediately when the user is missing, skipping `bcrypt.compare`.
  Wrong-password path is ~250 ms slower than unknown-email path.
- **Fix:** On the no-user branch, run a dummy `bcrypt.compare(password, DUMMY_HASH)`
  before returning null, so both paths take comparable wall-clock time.

---

## Info — confirmed clean

These were checked and are correct as of this review. Future audits can skip
them unless the underlying code is restructured.

- **SQL injection.** All Drizzle queries use parameterized `sql\`...\``templates. No`sql.raw(...)`against user-controlled input.`set_config`
  calls correctly parameterize the value
  ([patients/db.ts:26](apps/backend/src/modules/patients/db.ts:26),
  [staff_time_logs/service.ts](apps/backend/src/modules/staff_time_logs/service.ts),
  [standing_orders/service.ts](apps/backend/src/modules/standing_orders/service.ts),
  [lab_orders/db.ts](apps/backend/src/modules/lab_orders/db.ts) — all checked).
- **Frontend XSS.** Zero uses of `dangerouslySetInnerHTML`, `innerHTML`,
  `outerHTML`, `eval`, or `new Function` in `apps/frontend/src/`. JSONB
  pretty-print blocks render through React text nodes only.
- **Frontend secret exposure.** Only `VITE_API_URL` is exposed (correct).
  `sessionStorage` is used only in
  [features/arrivals/context.tsx](apps/frontend/src/features/arrivals/context.tsx)
  for non-sensitive UI state. No JWTs in any client storage.
- **Mass assignment.** Tenant/user/branch context is injected from
  `req.tenant` (set by middleware), never read from request bodies. Zod
  schemas drop unknown keys.
- **RLS.** `FORCE ROW LEVEL SECURITY` enabled on 21 tables in
  [drizzle/0001_rls_triggers_extensions.sql](apps/backend/drizzle/0001_rls_triggers_extensions.sql).
  Both USING and WITH CHECK clauses present.
- **`SET LOCAL` placement.** Verified inside `db.transaction(...)` wrappers
  consistently — never on pooled middleware connections.
- **CORS.** `credentials: true` with single-origin allow-list (validated by
  env.ts to reject `localhost` in production). No wildcard.
- **Cookie attributes.** `HttpOnly` + `Secure` + `SameSite=None` + `path=/`
  is the correct (and only viable) shape for the Cloudflare Pages ↔ Railway
  cross-eTLD+1 deployment.
- **Helmet.** Default config applied — CSP, HSTS, X-Content-Type-Options,
  frame options, referrer policy all on.
- **CI workflow.** [.github/workflows/ci.yml](.github/workflows/ci.yml) uses
  no secrets, no `pull_request_target` checkout footgun, default minimal
  permissions. Frozen lockfile install. Typecheck + build only.
- **Repo hygiene.** `.gitignore` covers `.env*`, `*.key`, `*.pem`, `dist`,
  `node_modules`. No committed secrets (verified via grep). `.env.example`
  files are templates only.
- **Dependencies.** express 5.1, helmet 7, jsonwebtoken 9, bcrypt 5,
  postgres 3, drizzle 0.40, react 19, vite 6 — all current as of review
  date, no known CVE windows. `pnpm-lock.yaml` checked in.
- **Migrations.** `db:deploy` and `db:seed` are CLI-only — never wired into
  the runtime start path or any HTTP route. Seed is idempotent
  (`onConflictDoNothing`).

---

## Remediation history

All 15 findings remediated in a parallel batch on 2026-04-26. Six PRs,
grouped by codebase area:

| PR                                                         | Unit                                                                                                                        | Findings              |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| [#45](https://github.com/njvil/surevax-cms-revamp/pull/45) | `admin-authz` — `requireRole` middleware on `/api/admin/*`                                                                  | #1                    |
| [#47](https://github.com/njvil/surevax-cms-revamp/pull/47) | `auth-tokens` — required JWT secrets, HS256 pinning, login limiter, timing-safe login, bcrypt 12, JWT error differentiation | #2, #6, #10, #11, #15 |
| [#46](https://github.com/njvil/surevax-cms-revamp/pull/46) | `bootstrap-hardening` — `EXPOSE_ERRORS` gate, pino redact, `/health` cleanup, json body limit, `trust proxy`                | #4, #7, #12, #13, #14 |
| [#48](https://github.com/njvil/surevax-cms-revamp/pull/48) | `csrf` — `X-Requested-With` middleware + frontend header                                                                    | #3                    |
| [#49](https://github.com/njvil/surevax-cms-revamp/pull/49) | `audit-log` — trigger redacts PII, raises on missing GUC; API search hardened                                               | #8, #9                |
| [#50](https://github.com/njvil/surevax-cms-revamp/pull/50) | `refresh-rotation` — persisted `refresh_tokens` with rotation + family revocation                                           | #5                    |

## Per-fix verification recipe

For each remediation PR:

1. **Reproducer** — a `curl` (or Vitest integration test) that exercises the
   bug _before_ the fix. E.g., for #1: log in as `jose.santos@surevax.com`
   (Cashier), `GET /api/admin/users` returns 200 with a full list — should
   be 403 after.
2. **Regression test** — assertion that the fix holds. E.g., for #1, a
   middleware test that 403s any token whose `role` isn't in the allow-list.
3. **Manual smoke** — full login → access affected endpoints as each role
   (SuperAdmin, Cashier, Nurse, Physician — all four seeded credentials are
   listed in [.claude/rules/gotchas.md](.claude/rules/gotchas.md)).

## Out of scope (worth doing later)

- Wire `pnpm audit` and a `gitleaks` step into
  [.github/workflows/ci.yml](.github/workflows/ci.yml) so future dep CVEs and
  accidental secret commits get caught at PR time.
- Threat-model the Phase 2 multi-tenant transition before tenant resolution
  moves from `PHASE_1_TENANT_ID` env to JWT claims / subdomain — that pivot
  is the single highest-risk change on the roadmap.
- HIPAA/DPA gap analysis once real PHI ingestion is on the calendar
  (encryption-at-rest verification, BAAs with Railway/Cloudflare/R2, audit
  retention period, breach-notification process).
