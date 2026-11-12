# Disaster Recovery and Backup-Restore Runbook

> **Status: MAINTAINED PROCEDURE; EXTERNAL RESTORE EVIDENCE REQUIRED.** The
> repository supplies migration, role, RLS, health, audit, and smoke-test
> checks. Railway backup availability, retention, encryption, and restore
> behavior are external controls and are not proven by this file. A completed,
> timed restore drill is a hard gate before real PHI.

## Recovery objectives

The clinic owner, technical owner, and DPO must approve the targets below before
pilot admission. Do not substitute provider marketing or an untested backup for
an approved objective.

| Objective                                                                          | Approved target                                                          | Owner | Approval reference | Last verified |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----- | ------------------ | ------------- |
| RPO: maximum acceptable data loss measured from the restored recovery point        | **UNSET — PILOT BLOCKER**                                                |       |                    |               |
| RTO: maximum acceptable time from incident declaration to safe service restoration | **UNSET — PILOT BLOCKER**                                                |       |                    |               |
| Backup retention and PITR window                                                   | **UNVERIFIED EXTERNAL CONTROL**                                          |       |                    |               |
| Restore-drill cadence                                                              | Quarterly and before first PHI, unless owner approves a stricter cadence |       |                    |               |

## Scope and safety rules

- Restore first into a new, isolated recovery environment. Never overwrite the
  only production database during a drill.
- Treat restored data as PHI. Use the same access controls, encryption, log
  restrictions, and deletion handling as production.
- Do not print rows, request bodies, credentials, tokens, connection strings,
  or free-text clinical data into terminals, tickets, CI logs, or evidence.
- Keep the runtime pool on `surevax_app` or an equivalently constrained
  `NOSUPERUSER NOBYPASSRLS` role. The migrator credential is for the bounded
  migration process only.
- Do not disable RLS to make a restore pass.
- Stop on migration drift, missing relations, failed integrity checks, audit
  verification failure, or an unexplained recovery-point mismatch.
- A soft-deleted or de-identified row reappearing from backup must be handled
  under the retention/erasure record. Backup expiry is not instantaneous
  statutory deletion.

## Roles

| Role                       | Responsibility                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| Incident Commander         | Declares recovery, controls the timeline, and makes the cutover recommendation.             |
| Database recovery operator | Selects and restores the approved recovery point without exposing credentials or data.      |
| Application verifier       | Deploys the pinned application version and runs repository checks.                          |
| Security/DPO reviewer      | Verifies isolation, RLS, audit integrity, PHI handling, and erasure/retention implications. |
| Clinic acceptance owner    | Confirms minimum clinical and financial workflows before traffic resumes.                   |
| Final approver             | Authorizes cutover or abort; must be named in the evidence record.                          |

## Preconditions

- [ ] Incident or drill ID, start time, scope, roles, and communication channel recorded.
- [ ] Approved RPO/RTO and recovery-point selection rule available.
- [ ] Backup snapshot/PITR identifier, creation time, retention expiry, region,
      and provider status recorded without credentials.
- [ ] Last known-good application commit/image and prior deployment reference recorded.
- [ ] Last known-good database migration state recorded.
- [ ] Isolated recovery database and application environment available.
- [ ] Runtime and migrator credentials are separate.
- [ ] No DNS, custom domain, production queue, webhook, notification, or worker
      traffic points at the recovery environment.
- [ ] A rollback/abort authority and decision deadline are named.

If an older recovery point predates a schema consolidation, explicitly test its
forward-migration path. Do not assume a current fresh-database build proves that
an older snapshot can migrate.

## Procedure

### 1. Select and restore the recovery point

1. Record the incident/drill start in UTC and PHT.
2. Select the newest eligible recovery point that meets the approved RPO and
   predates the corrupting event, if any.
3. Record its immutable provider identifier and timestamp.
4. Restore it to a new isolated Railway database/environment. This is an
   external owner action; capture the provider operation ID and outcome.
5. Do not repoint production DNS or application variables.

### 2. Establish least-privilege database access

Using an approved administrative connection, verify the runtime role without
printing connection strings:

```sql
SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication
FROM pg_roles
WHERE rolname = 'surevax_app';
-- Expect one row and all five privilege booleans = false.
```

Provision or rotate the restored environment's runtime password through the
secret manager. Configure:

- `DATABASE_URL` for the `surevax_app` runtime role; and
- `DATABASE_MIGRATOR_URL` for the bounded migration role.

Never point long-lived runtime traffic at the migrator/master URL.

### 3. Deploy the pinned application and migrate

1. Deploy the recorded last-known-good release to the isolated environment.
2. Run the repository migration command using the migrator URL:

   ```bash
   pnpm --filter @surevax/backend db:deploy
   ```

3. Capture only exit status, migration filenames, application commit, and
   timestamps. Stop if a migration fails; do not patch the restored database by
   hand during the drill.
4. Confirm the application process connects through the runtime role.

### 4. Verify database structure and isolation

Run aggregate or catalog-only checks and record results:

```sql
SELECT current_database(), current_user;

SELECT count(*) AS missing_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity = false
  AND c.relname IN ('patients', 'encounters', 'clinical_orders', 'transactions');
-- Expect 0.
```

Then execute the maintained seed/runtime or equivalent RLS probe against the
recovery environment. A tenant-A context must return no tenant-B rows. Do not
capture row contents.

Verify audit-chain integrity for the current and prior partitions. Any mismatch
is a security incident and blocks cutover.

### 5. Verify application behavior

All checks must target the isolated recovery application:

- `GET /health` returns liveness success.
- `GET /ready` reaches its database check and returns readiness success.
- Normal TenantAdmin login works through HTTP-only secure cookies.
- A permitted tenant-scoped list and detail request succeeds.
- A cross-tenant probe is rejected or returns no row.
- One non-PHI synthetic write and readback succeeds and remains tenant scoped.
- Background workers remain disabled until queues and outbound integrations are
  deliberately released.
- Attachment metadata counts reconcile. If R2 objects are in scope, verify a
  non-PHI synthetic object through the normal signed path; do not download or
  ticket real patient content.

### 6. Measure recovery

Record:

- backup timestamp and restore completion timestamp;
- latest committed transaction timestamp using an aggregate-safe query;
- measured data-loss interval against RPO;
- incident declaration to application acceptance time against RTO;
- migration, role, RLS, audit, application, and attachment results; and
- every exception or manual intervention.

### 7. Decide cutover or abort

Cutover requires written approval from the Incident Commander, DPO/security
reviewer, clinic acceptance owner, and final approver. Before traffic moves:

- take a final protected snapshot of the failed/original environment when safe;
- freeze writes or account for the delta explicitly;
- configure production-only secrets and exact CORS origin;
- enable workers and outbound integrations in a controlled order;
- change application/database routing through the provider's approved method;
- verify `/ready`, login, tenant isolation, audit alert delivery, and a minimum
  clinical workflow; and
- record the exact rollback point and decision deadline.

Abort if any gate fails. Preserve the original environment read-only where
possible and return traffic to the last-known-good application/database pair.
Rollback must retain the least-privilege runtime role; switching runtime to the
master role is prohibited once PHI is in scope.

## Restore evidence record

| Field                                 | Value |
| ------------------------------------- | ----- |
| Incident/drill ID                     |       |
| Started / completed UTC and PHT       |       |
| Operators and approvers               |       |
| Source backup/PITR ID and timestamp   |       |
| Provider restore operation ID         |       |
| Application commit/deployment         |       |
| Database migration state before/after |       |
| Runtime-role check                    |       |
| RLS probe                             |       |
| Audit-chain verification              |       |
| Health/readiness and login smoke      |       |
| Attachment reconciliation             |       |
| Measured RPO / approved target        |       |
| Measured RTO / approved target        |       |
| Exceptions/manual interventions       |       |
| Cutover or abort decision             |       |
| Rollback point                        |       |
| Follow-up owner and due date          |       |

## Required external owner actions

- Confirm the Railway plan's backup, PITR, retention, region, and encryption
  characteristics from the live account.
- Enable the selected backup policy and capture account evidence.
- Create the isolated recovery environment and perform the restore.
- Approve RPO/RTO and drill cadence.
- Maintain protected recovery credentials and provider access.
- Complete the pre-PHI drill and attach its evidence to the pilot checklist.

## Related controls

- [`pilot-go-live.md`](pilot-go-live.md)
- [`incident-response.md`](incident-response.md)
- [`auth2-rls-cutover.md`](auth2-rls-cutover.md)
- [`../compliance/dpa-controls.md`](../compliance/dpa-controls.md)
