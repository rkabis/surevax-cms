# Phase-1 Pilot Go-Live Operational Checklist

> **Status: PILOT ADMISSION GATE.** Do not place real PHI in the system until
> every blocker row is marked `PASS`, carries dated evidence, and has the named
> owner/reviewer sign-off. A checked box without evidence is not a pass.

## How to use this checklist

Allowed status values are `PASS`, `FAIL`, `BLOCKED`, and `NOT APPLICABLE`.
`NOT APPLICABLE` requires a written scope decision and approver. Evidence must
contain no PHI, credentials, tokens, request bodies, connection strings, or
secret values.

| Pilot | Release commit/deployment | Planned first-PHI date | Checklist owner | DPO/security reviewer | Clinic approver |
| ----- | ------------------------- | ---------------------- | --------------- | --------------------- | --------------- |
|       |                           |                        |                 |                       |                 |

## A. Release and production admission

| Blocker | Control and pass condition                                                                                             | Evidence required                                   | Owner           | Status |
| ------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------- | ------ |
| Yes     | Release commit is reviewed, CI-green, immutable, and tied to a rollback deployment.                                    | Commit, CI run, artifact/deployment ID, rollback ID | Technical owner |        |
| Yes     | No known production-blocking migration drift; migrations complete on a clean database and a representative restore.    | Migration test/drill IDs and exit results           | Database owner  |        |
| Yes     | `NODE_ENV=production`; startup negative tests reject weak/dev secrets, localhost or wildcard CORS, and exposed errors. | Config-test output without values                   | Technical owner |        |
| Yes     | No real PHI exists in development, preview, test, CI artifacts, seed fixtures, or screenshots.                         | Environment/data attestation                        | DPO/security    |        |
| Yes     | Deployment rollback keeps the runtime role least privilege and does not disable RLS.                                   | Rollback procedure/rehearsal ID                     | Technical owner |        |

## B. Secrets, sessions, CORS, and cookies

| Blocker | Control and pass condition                                                                                                                                               | Evidence required                                                 | Owner             | Status |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ----------------- | ------ |
| Yes     | Unique production `COOKIE_SECRET`, `JWT_ACCESS_SECRET`, and `JWT_REFRESH_SECRET` are at least 32 random characters/bytes and stored only in the provider secret manager. | Variable names, creation/rotation references, owner; never values | Security owner    |        |
| Yes     | Legacy `JWT_SECRET` disposition is documented; operators do not rely on it to revoke current tokens.                                                                     | Decision/reference                                                | Technical owner   |        |
| Yes     | Secret rotation procedure identifies session impact, server-side refresh-family revocation, rollback, and emergency contact.                                             | Rehearsal or tabletop ID                                          | Security owner    |        |
| Yes     | `CORS_ORIGIN` is the exact approved HTTPS frontend origin or allowlist; no wildcard, localhost, trailing-slash, preview, or unowned origin remains.                      | Sanitized config and browser preflight result                     | Technical owner   |        |
| Yes     | Login cookies are observed as `HttpOnly`, `Secure`, `SameSite=None`, correct path, and expected lifetime; logout and refresh rotation work.                              | Browser/network check with values redacted                        | Security reviewer |        |
| Yes     | Frontend `VITE_API_URL` targets only the production API and the bundle was rebuilt after the variable change.                                                            | Cloudflare build/deployment ID and sanitized request host         | Frontend owner    |        |

## C. Database roles and tenant isolation

| Blocker | Control and pass condition                                                                                                                             | Evidence required                           | Owner             | Status |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | ----------------- | ------ |
| Yes     | Runtime `DATABASE_URL` uses `surevax_app`; `rolsuper=false`, `rolbypassrls=false`, `rolcreatedb=false`, `rolcreaterole=false`, `rolreplication=false`. | Role query result without connection string | Database owner    |        |
| Yes     | `DATABASE_MIGRATOR_URL` is separate and unavailable to the long-lived runtime except for the bounded migration command.                                | Provider configuration attestation          | Database owner    |        |
| Yes     | Tenant-A session cannot read or write tenant-B rows; branch isolation and cross-branch write denial pass under the real runtime role.                  | RLS/integration probe run ID                | Security reviewer |        |
| Yes     | Production rollback never points runtime `DATABASE_URL` at the master/migrator role.                                                                   | Approved rollback runbook and rehearsal     | Technical owner   |        |

## D. Health, workers, logging, and alerts

| Blocker | Control and pass condition                                                                                                                                          | Evidence required                             | Owner                | Status |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------- | ------ |
| Yes     | `/health` proves process liveness; `/ready` is reachable by the configured probe, checks the database, returns generic 503 on failure, and exposes no error detail. | Success and simulated-failure probe results   | Technical owner      |        |
| Yes     | Railway uses the approved health/readiness strategy and restart policy; an outage does not leave an unready deployment serving traffic.                             | Sanitized Railway settings and drill ID       | Infrastructure owner |        |
| Yes     | Required background workers are enabled, start cleanly, and have validated positive numeric intervals.                                                              | Startup log event IDs/config attestation      | Technical owner      |        |
| Yes     | Logs redact cookies, authorization, passwords, PINs, tokens, MFA secrets, addresses, and contact details; request bodies and PHI are not logged.                    | Synthetic redaction test                      | Security reviewer    |        |
| Yes     | Backend and frontend Sentry DSNs/environments and data scrubbing are configured.                                                                                    | Project/config references; never DSN values   | Security owner       |        |
| Yes     | Synthetic alert reaches the primary on-call destination and is acknowledged within target.                                                                          | Alert event and acknowledgement IDs           | Incident owner       |        |
| Yes     | Alert-delivery failure invokes the out-of-band contact path without exposing PHI or secrets.                                                                        | Failure-drill record                          | Incident owner       |        |
| Yes     | Audit-chain tamper signal reaches the actionable alert path and creates an incident record; verifier/query failure is also alertable.                               | Synthetic negative test and delivery evidence | Security owner       |        |

## E. Backup, restore, and rollback

| Blocker | Control and pass condition                                                                                                                                                   | Evidence required                                                        | Owner                      | Status |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------- | ------ |
| Yes     | Owner-approved RPO, RTO, retention, PITR window, region, and encryption controls are recorded from the live Railway account.                                                 | Signed decision and provider evidence                                    | Infrastructure owner / DPO |        |
| Yes     | Backup policy is enabled and a current recoverable point is visible.                                                                                                         | Snapshot/PITR ID and timestamp                                           | Database owner             |        |
| Yes     | A recent backup is restored to an isolated environment and passes migration, role, RLS, audit-chain, readiness, login, data-integrity, and attachment reconciliation checks. | Completed [`disaster-recovery.md`](disaster-recovery.md) evidence record | Recovery owner             |        |
| Yes     | Measured restore meets approved RPO/RTO or has an explicitly accepted blocker/remediation before PHI.                                                                        | Timed drill result and approval                                          | Clinic owner / DPO         |        |
| Yes     | Exact last-known-good application deployment and database recovery point are recorded immediately before pilot cutover.                                                      | Deployment and backup IDs                                                | Incident Commander         |        |

## F. DPA request and retention drill

| Blocker | Control and pass condition                                                                                                                                                                                                             | Evidence required                                         | Owner                            | Status |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------- | ------ |
| Yes     | Retention schedule, lawful-retention exceptions, DPO decision authority, approver identities, and evidence retention are approved.                                                                                                     | Signed policy/reference                                   | DPO / clinic owner               |        |
| Yes     | The tenant has at least three individually assigned active TenantAdmins: one requester plus two other approvers. Shared/service accounts cannot satisfy quorum.                                                                        | Sanitized role/account attestation                        | Clinic owner / security reviewer |        |
| Yes     | Synthetic DPA request creates a patient-erasure approval for the correct tenant and patient display ID; requester cannot self-approve and two distinct approvals are required.                                                         | Request/approval display IDs and test result              | DPO reviewer                     |        |
| Yes     | Unauthorized, wrong-tenant, expired/rejected approval, duplicate vote, and replayed execution attempts fail without mutation.                                                                                                          | Negative-test run ID                                      | Security reviewer                |        |
| Yes     | Dry-run impact report distinguishes de-identification/deletion actions, retained record classes, and external attachment work.                                                                                                         | Synthetic impact report with no PHI                       | DPO reviewer                     |        |
| Yes     | Live execution is rehearsed only on synthetic data, requires explicit authorization, is one-time, and records impact, completion, rollback/impact limitations, executor, and request/rollback references.                              | Synthetic execution evidence ID                           | DPO / technical owner            |        |
| Yes     | Execution refuses while any associated attachment metadata remains, including soft-deleted rows; R2 cleanup is separately authorized, evidenced, and reconciled.                                                                       | Failure result then external-object evidence, if in scope | Storage owner / DPO              |        |
| Yes     | Completion record states that retained clinical/financial/audit/access records and backup copies remain governed by their retention bases. It does not claim statutory deletion from soft deletion or primary-store de-identification. | Reviewed completion report                                | DPO                              |        |
| Yes     | Backup expiry/recovery implications and the process for preventing unintended reactivation after restore are documented.                                                                                                               | DR/DPA reconciliation record                              | DPO / recovery owner             |        |

## G. Incident access drill

| Blocker | Control and pass condition                                                                                                                                                                                                 | Evidence required                                              | Owner                | Status |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------- | ------ |
| Yes     | Incident roles, contact tree, restricted evidence store, severity model, and notification decision owner are named.                                                                                                        | Completed [`incident-response.md`](incident-response.md) setup | Incident owner / DPO |        |
| Yes     | Emergency grant is bound to one tenant, one existing active TenantAdmin, one incident, purpose `restore_tenant_admin_login`, one approved `APR_` request with two verified current TenantAdmin voters, and a short expiry. | Synthetic approval/grant IDs and sanitized evidence            | Security reviewer    |        |
| Yes     | Execution changes only permitted login state; role, tenant, branch, password, MFA, and permissions remain unchanged.                                                                                                       | Before/after control result without secrets                    | Security reviewer    |        |
| Yes     | Wrong-tenant/target, non-admin target, duplicate approval, expired token, revoked token, and replayed token attempts fail.                                                                                                 | Negative-test run ID                                           | Technical owner      |        |
| Yes     | Plaintext lease token is displayed/transferred once and absent from database, logs, tickets, screenshots, and command history.                                                                                             | Handling attestation and log scan                              | Security reviewer    |        |
| Yes     | Grant/execution/revocation audit evidence reconciles to the incident, and temporary access is closed.                                                                                                                      | Incident drill record                                          | Independent reviewer |        |

## H. External production actions requiring the owner

These cannot be completed or verified by repository code alone:

- [ ] Railway production environment and database segregation.
- [ ] Production secrets, runtime/migrator URLs, worker flags, healthcheck,
      restart policy, backup/PITR, retention, spend cap, and protected access.
- [ ] Cloudflare Pages production variables/build, custom domains, DNS/TLS/WAF,
      and exact-origin configuration.
- [ ] Cloudflare R2 bucket, restricted credentials, CORS, encryption/retention,
      object cleanup evidence, and restore implications, if attachments are enabled.
- [ ] Sentry projects, backend/frontend DSNs, environment labels, data scrubbing,
      alert rules, on-call destinations, retention, and test evidence.
- [ ] DPO/legal approval of retention, erasure exceptions, breach assessment,
      regulator/data-subject contact details, templates, and delivery evidence.
- [ ] Clinic-approved downtime process, minimum safe workflow, training,
      incident contacts, acceptance authority, and first-PHI authorization.

## Final admission decision

| Decision                      | Name | Timestamp | Evidence/signature reference |
| ----------------------------- | ---- | --------- | ---------------------------- |
| Technical owner               |      |           |                              |
| Database/infrastructure owner |      |           |                              |
| Security/DPO reviewer         |      |           |                              |
| Clinic operational owner      |      |           |                              |
| Final `GO` / `NO-GO`          |      |           |                              |

Any remaining `FAIL`, `BLOCKED`, blank blocker status, missing evidence, or
unapproved exception means `NO-GO` for real PHI.
