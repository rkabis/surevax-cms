# Environments and Production Admission

> **Repository status, 2026-08-22:** the codebase contains production guards,
> least-privilege/RLS patterns, health endpoints, audit/retention workers, and
> operational runbooks. It does not prove that Railway, Cloudflare, R2, Sentry,
> DNS, backups, or paging are configured. Historical repository evidence says
> deployed environments were development-only; that external state was not
> re-verified for this update. No real PHI may be admitted until
> [`runbooks/pilot-go-live.md`](runbooks/pilot-go-live.md) passes with owner
> evidence.

## Control-status vocabulary

| Status                    | Meaning                                                                |
| ------------------------- | ---------------------------------------------------------------------- |
| Implemented in repository | Code, migration, test, or maintained runbook exists in this checkout.  |
| External/unverified       | Requires live provider/account evidence; repository text is not proof. |
| Pilot blocker             | Must pass with dated evidence before real PHI.                         |
| Development-only          | Acceptable only in an environment guaranteed to contain no real PHI.   |

## Environment separation

Production must have its own Railway environment, Postgres database, secrets,
deployment policy, Cloudflare production build, domains, R2 bucket/credentials
when attachments are enabled, and Sentry environment/alerts. Development,
preview, CI, and restore-drill resources must not share production data or
credentials.

| Concern       | Development / CI           | Production requirement                                                   |
| ------------- | -------------------------- | ------------------------------------------------------------------------ |
| Data          | Synthetic only             | Real PHI only after pilot admission                                      |
| `NODE_ENV`    | `development` or `test`    | Exactly `production`                                                     |
| Database      | Per-worktree/test database | Dedicated managed Postgres with backup/PITR evidence                     |
| Runtime role  | `surevax_app` preferred    | `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION` required |
| Migrator role | Local owner/migrator       | Separate bounded DDL credential; never long-lived runtime                |
| Secrets       | Disposable, non-production | Unique provider-managed production secrets                               |
| CORS/API      | Localhost permitted        | Exact owned HTTPS origins only                                           |
| Alerts        | Optional/no-op             | Configured, tested primary and fallback path                             |
| Attachments   | R2 may be absent           | R2 controls/evidence required if feature is admitted                     |
| Backups       | Disposable                 | Approved RPO/RTO plus successful isolated restore drill                  |

## Production admission order

1. Approve pilot scope, owners, RPO/RTO, retention decisions, incident contacts,
   and first-PHI date.
2. Create isolated Railway and Cloudflare production resources.
3. Provision the runtime/migrator database-role split.
4. Configure production secrets and exact CORS/API origins.
5. Deploy the pinned release and apply migrations with the migrator role.
6. Verify runtime role, RLS, startup guards, `/health`, `/ready`, login, cookies,
   workers, logging, and alert delivery.
7. Enable backup/PITR and complete the isolated restore drill.
8. Complete DPA request and emergency account-recovery drills on synthetic data.
9. Record the rollback deployment and database recovery point.
10. Obtain all sign-offs in [`runbooks/pilot-go-live.md`](runbooks/pilot-go-live.md).

Order matters. A green deployment is not production admission.

## Backend configuration

All values belong in Railway variables or another approved secret manager, not
in Git, tickets, screenshots, or command output.

| Variable                            | Repository behavior                                                                                       | Production admission                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `NODE_ENV`                          | Validated enum                                                                                            | Required as `production`                                                             |
| `DATABASE_URL`                      | Required URL; used by runtime pool; production readiness rejects any privileged current role              | Must identify `surevax_app` or an equivalently constrained role, not master/migrator |
| `DATABASE_MIGRATOR_URL`             | Migration command prefers it; otherwise falls back in non-production                                      | Required by the production guard and must differ from runtime                        |
| `COOKIE_SECRET`                     | Required; production rejects short/dev-marked values                                                      | Unique random production value, minimum 32 characters; owner rotation record         |
| `JWT_ACCESS_SECRET`                 | Required, minimum 32 characters; signs access/operator tokens                                             | Unique random production value and rotation procedure                                |
| `JWT_REFRESH_SECRET`                | Required, minimum 32 characters; signs refresh tokens                                                     | Different production value plus refresh-family revocation procedure                  |
| `JWT_SECRET`                        | Required by current schema but not used for current token signing                                         | Do not rely on it for session revocation; remove only through a reviewed code change |
| `CORS_ORIGIN`                       | Required; comma-separated; production rejects localhost and `*`                                           | Exact approved HTTPS origin(s); verify no trailing-slash or preview drift            |
| `EXPOSE_ERRORS`                     | Defaults false; production rejects true                                                                   | Must remain false                                                                    |
| `WORKERS_ENABLED`                   | Typed `true`/`false`; workers start only when exactly `true`                                              | Production guard requires `true`; verify startup logs                                |
| `ANALYTICS_REFRESH_ENABLED`         | Additional analytics opt-in                                                                               | Enable only if analytics schema/workflow is admitted                                 |
| Worker interval variables           | Read by individual workers                                                                                | Use validated positive values/defaults; capture sanitized config evidence            |
| `SENTRY_DSN` / `SENTRY_ENVIRONMENT` | Optional/no-op outside production; production guard requires a DSN                                        | External project/scrubbing/routing evidence still needed                             |
| `SENTRY_TRACES_SAMPLE_RATE`         | Validated 0–1, default 0                                                                                  | Owner-approved value; avoid PHI-bearing telemetry                                    |
| R2 variables                        | Optional outside production; production guard requires the complete set and rejects partial configuration | Restricted production bucket credentials and external control evidence               |
| `PAYMONGO_WEBHOOK_SECRET`           | Optional outside production                                                                               | Production guard requires a production-strength value                                |

The current startup guards reject missing required variables, weak/dev-marked
production secrets, non-HTTPS/localhost/wildcard/path-bearing CORS, identical or
missing migrator URL, disabled workers, missing Sentry/PayMongo/R2 settings, and
`EXPOSE_ERRORS=true`. Before listening in production, the backend also queries
the current database role and refuses `SUPERUSER`, `BYPASSRLS`, `CREATEDB`,
`CREATEROLE`, or `REPLICATION` capabilities. Exact role grants, provider
configuration, alert delivery, and backup state still require the pilot
admission checks; do not infer them from successful boot alone.

## Database role split

`DATABASE_URL` and `DATABASE_MIGRATOR_URL` may point to the same database but
must use different roles:

- runtime: `surevax_app`,
  `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`;
- migrator: bounded DDL/ownership role used only by migration and controlled
  seed/recovery operations.

Before traffic, verify:

```sql
SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication
FROM pg_roles
WHERE rolname = 'surevax_app';
-- Expect one row; all privilege booleans false.
```

Then run tenant and branch isolation probes under the actual runtime role.
Never solve a production permission failure by pointing runtime at the master
role. See [`runbooks/auth2-rls-cutover.md`](runbooks/auth2-rls-cutover.md).

## CORS and cookies

The frontend and Railway API may be on different registrable domains. Current
authentication cookies are always `HttpOnly`, `Secure`, `SameSite=None`, and
path `/`. Production must therefore use HTTPS and credentialed requests.

- `CORS_ORIGIN` must match the browser `Origin` exactly: scheme and host, no
  trailing slash.
- Do not include unowned preview deployments in the production allowlist.
- Confirm `Access-Control-Allow-Credentials: true` and a specific allowed
  origin; wildcard credentials-mode CORS is prohibited.
- Verify login, refresh rotation, logout, expiry, and cookie flags in a real
  browser against the production domains without recording cookie values.

`VITE_API_URL` is compiled into the frontend. After changing it in Cloudflare,
trigger a new build and verify the resulting request host. Saving the variable
does not change an already-built bundle.

## Health and readiness

- `GET /health` is public, dependency-free process liveness. It does not prove
  database availability or migration correctness.
- `GET /ready` performs a database query and must return a generic 503 without
  internal error details when the database is unavailable.
- `/ready` is mounted before authentication and tenant resolution so Railway
  and external probes can reach it without a user cookie or tenant context.
- `railway.toml` selects `/ready` as the deployment healthcheck. Test both
  success and database/privileged-role failure behavior, and keep an independent
  external alert so a provider-wide outage is visible even during restart loops.

Record the final strategy and synthetic failure result in the pilot checklist.

## Workers, logging, and alerting

`WORKERS_ENABLED=true` activates domain-event publishing, notifications,
token cleanup, PHI-access-log retention, audit partition rotation, and audit
chain verification. Analytics has its own additional gate. Confirm each
required worker emits a startup event and completes a synthetic cycle.

Pino removes configured credential/PII fields and the application must not log
request bodies or PHI. Sentry backend/frontend initialization is a no-op when
the corresponding DSN is absent outside production; backend production startup
requires its DSN. Before PHI:

- provision distinct production Sentry projects/environments as approved;
- configure data scrubbing and retention;
- route audit tamper and delivery failures to an acknowledged on-call path;
- test a synthetic non-PHI alert; and
- test the out-of-band fallback without disabling live production paging.

Repository wiring is not proof of Sentry delivery.

## Migrations and rollback

Railpack builds shared before backend and starts by running migration then the
API. Destructive schema changes require an explicit expand/backfill/contract
plan, pre-change recovery point, review, and recovery rehearsal.

Production rollback must keep the least-privilege runtime role. Roll back the
application to a pinned release or restore through
[`runbooks/disaster-recovery.md`](runbooks/disaster-recovery.md). Disabling RLS
or using the master role for runtime is prohibited once PHI is in scope.

## Backup and recovery

The repository does not verify Railway backup/PITR availability, retention,
encryption, or recoverability. Owner evidence must record those controls from
the live account. Before PHI:

- approve RPO and RTO;
- enable the selected backup/PITR policy;
- record a current recovery point;
- restore it into an isolated environment;
- run migration, runtime-role, RLS, audit-chain, readiness, login, integrity,
  and attachment checks; and
- record measured RPO/RTO and exceptions.

Follow [`runbooks/disaster-recovery.md`](runbooks/disaster-recovery.md).

## Exact external production actions

### Railway

- Create/separate production service and Postgres resources.
- Configure production deployment source and protected rollback release.
- Set production variables and separate runtime/migrator URLs.
- Provision/verify the `surevax_app` role.
- Set worker gates/intervals and health/restart policy.
- Enable backup/PITR, confirm retention/region/encryption, and run the restore drill.
- Configure spend cap, protected operator access, and log retention/export as approved.

### Cloudflare

- Configure production Pages build variables and rebuild.
- Configure owned custom domains, DNS, TLS, and WAF controls.
- Provision R2 bucket, restricted API credentials, encryption/retention, and
  exact-origin PUT CORS if attachments are admitted.

### Sentry/on-call

- Provision backend/frontend DSNs and environment labels.
- Configure scrubbing, retention, alert rules, paging destinations, and escalation contacts.
- Complete primary-delivery and failure-fallback drills.

### Governance/clinic

- Approve RPO/RTO, retention/erasure policy, DPA approval roles, incident roles,
  notification contacts/templates, downtime workflow, and first-PHI authorization.
- Complete DPA request, account-recovery, incident, and restore drills.

## Quick reference

| File                                                             | Purpose                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------- |
| `apps/backend/src/shared/config/env.ts`                          | Typed required variables and production startup guards        |
| `apps/backend/src/app.ts`                                        | CORS middleware, health, readiness, and Sentry initialization |
| `apps/backend/src/modules/auth/routes.ts`                        | HTTP-only access/refresh cookie settings and rotation         |
| `apps/backend/src/index.ts`                                      | Worker start/stop gates                                       |
| `apps/backend/src/shared/db/migrate.ts`                          | Migrator URL selection and migration order                    |
| `railpack.json`                                                  | Build and migrate-then-start command                          |
| `railway.toml`                                                   | Repository-declared Railway health/restart settings           |
| [`runbooks/pilot-go-live.md`](runbooks/pilot-go-live.md)         | Final first-PHI admission evidence                            |
| [`runbooks/disaster-recovery.md`](runbooks/disaster-recovery.md) | Isolated restore and cutover/abort procedure                  |
| [`runbooks/incident-response.md`](runbooks/incident-response.md) | Incident lifecycle and alert fallback                         |
| [`runbooks/break-glass.md`](runbooks/break-glass.md)             | One-time tenant-admin account recovery                        |
