# Production Cutover and Legacy Catch-up Bridge

> **Status:** implementation guide; production writes remain disabled
> **Observed:** 2026-08-17, Asia/Manila
> **Scope:** AppSheet database + 14 clinic trackers -> SureVax v2

## Executive decision

Use a bounded, one-way catch-up bridge. Do not attempt permanent two-way sync.

```text
AppSheet + clinic trackers
        ↓ frozen snapshots, hashes and row observations
canonical append-only migration ledger + prioritized exception queue
        ↓ idempotent, approved target actions
SureVax v2
```

Before go-live, AppSheet remains the operational system. After go-live, v2 is
the only write system. AppSheet and trackers become read-only evidence, except
for a short, explicitly approved late-entry window.

## Current Railway reality

The Railway CLI was used read-only on 2026-08-17. The project currently has
one environment named `development`, not an isolated production tier.

| Item              | Observed state                                              | Cutover implication                                                                      |
| ----------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| API service       | `surevax-cms-revamp`, healthy, one Singapore replica        | Development deployment only; do not import clinic PHI here.                              |
| Database          | `surevax-db`, PostgreSQL 18, healthy                        | Shared development database, not a clean production target.                              |
| Volume            | 197.009 MB used of 500 MB                                   | About 39% used before clinic import; increase capacity and test audit-log growth.        |
| Environments      | `development` only                                          | Create an isolated staging rehearsal and production database before data writes.         |
| App startup       | `migrate.js && index.js`                                    | Import must be a separate one-shot worker/job, never an app-start side effect.           |
| Runtime variables | Both `DATABASE_URL` and `DATABASE_MIGRATOR_URL` names exist | Verify the app URL uses the non-bypass `surevax_app` role; reserve migrator URL for DDL. |

Railway environments can isolate services and variables and stage changes for
review before deployment. Duplicating an environment copies configuration,
not a safe clinical-data acceptance decision, and sealed variables may need to
be re-entered. See the official [Railway environments](https://docs.railway.com/environments)
and [variables](https://docs.railway.com/variables) documentation.

## `Pending` animal follow-ups

`Pending` means the nurse did not record the Day-14 animal outcome. It does not
mean alive, dead, healthy, rabies-negative or treatment completed.

| Condition at migration cutoff                                                      | Migration treatment                                     | Queue                            | Vaccine-course effect                  |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------- | -------------------------------------- |
| First human ARV date + 14 days is still in the future; incident resolves uniquely  | Retain a pending follow-up candidate                    | None                             | Continue the PEP schedule.             |
| First human ARV date + 14 days is today or in the past; incident resolves uniquely | Retain Pending and create an overdue callback task      | P3 operational follow-up         | Continue the PEP schedule.             |
| More than one compatible bite/PEP episode                                          | Preserve the raw Pending fact; do not choose an episode | P1, affected patient/course only | Continue all unresolved PEP schedules. |
| No targetable incident or first ARV date missing/invalid                           | Preserve raw Pending in migration provenance            | P3 data completion               | Continue the PEP schedule.             |

The due date is calculated from the full date, not the legacy day-of-month
subtraction that broke across month boundaries. This rule is implemented and
tested by `classifyPendingAnimalFollowup()`.

The current legacy patient row does not contain all mandatory target bite
incident facts (species, animal vaccination status, exposure category and bite
site). Do not manufacture placeholders just to create a follow-up row. Safe
patient, transaction and administration facts may still migrate.

## Sync design

### Source watermark

Drive revision numbers and modified times are advisory. The authoritative
watermark is a materialized export hash plus the exact selected tabs/ranges:

```text
source pack hash = SHA-256(sorted(
  Drive file ID,
  export SHA-256,
  selected sheet/range,
  header fingerprint,
  workbook-title branch,
  extractor version
))
```

For each export:

1. Read Drive metadata.
2. Export the file.
3. Read metadata again.
4. Discard the export if the file changed during capture.
5. Materialize and hash all 15 files into one access-controlled source pack.
6. Periodically perform a complete 15-file hash comparison even when Drive
   reports no modification.

### Change handling

| Source observation                                                  | Safe behavior                                                                       |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Same row locator and same row hash                                  | No target action.                                                                   |
| Same AppSheet row ID with changed content                           | Append a new source version and reconcile the semantic change.                      |
| AppSheet immunization disappears                                    | Record disappearance; never delete a completed target administration automatically. |
| New row with uniquely matching patient/service/dose/date facts      | Treat as a recreated-row candidate and preserve both source records.                |
| New row conflicts on patient, date, service, route, brand or amount | P1; do not mutate the target fact.                                                  |
| Tracker row reorders but content is an exact one-to-one match       | Preserve event continuity and update only source-location evidence.                 |
| Source correction agrees with the existing target fact              | Add evidence only; do not duplicate the target row.                                 |

Use a canonical event-version hash for idempotency, not an AppSheet row ID:

```text
legacy-sync:v1:<tenant>:<canonical-event-version-hash>
```

The target needs durable, tenant-scoped migration run, snapshot, observation,
event, decision, target-link, cursor and exception records. These are append
only. A later correction supersedes an earlier event; it does not erase it.

### Frequency and transport

Railway cron can run a one-shot worker no more frequently than every five
minutes; schedules are UTC and overlapping executions are skipped. See
[Railway cron jobs](https://docs.railway.com/cron-jobs).

The current Codex Google Drive connector cannot be used by an unattended
Railway worker. The bridge therefore needs its own Google OAuth refresh-token
or service-account authorization with the minimum Drive/Sheets scopes.

Recommended hybrid during the bounded bridge:

- AppSheet automation posts signed change notifications to an ingestion
  endpoint for low latency;
- a 5-15 minute Railway worker exports/checks changed sources;
- a nightly full 15-file hash audit catches deletes, offline sync and missed
  notifications;
- the target cursor advances only after target writes and post-write checks
  succeed.

## Migration queue priorities

| Priority | Meaning                                                             | Examples                                                                                                                                                            | Effect on cutover                                                   |
| -------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **P0**   | The run or a whole source slice is unsafe                           | Mutable/unhashed source pack; no isolated target DB; stubbed adapter; incomplete Salcedo month ownership; missing idempotency/atomicity                             | Stops all writes.                                                   |
| **P1**   | A specific patient/course/financial group cannot be resolved safely | Identity collision; ambiguous PEP episode; Timog amount/tender conflict; unknown-date external dose with ambiguous course/slot linkage; contradictory recreated row | Exclude only the affected group and migrate safe records.           |
| **P2**   | Strong inference needs visible audit or reviewer confirmation       | Unique date repair; unique spelling match; copied-row continuity                                                                                                    | Can be inferred under the approved rule and retained in provenance. |
| **P3**   | Operational follow-up or missing optional detail                    | Overdue animal callback; missing external facility/brand; raw Pending with no targetable incident                                                                   | Does not block migration; remains on an operational queue.          |

## Production-readiness gates

### Gate 1 — isolated targets

1. Create a clean staging rehearsal environment and fresh PostgreSQL service.
2. Create a separate production environment/database; do not reuse the current
   development database.
3. Set `NODE_ENV=production`, strong secrets and the exact HTTPS CORS origin.
4. Make `DATABASE_URL` the RLS-constrained app role and
   `DATABASE_MIGRATOR_URL` DDL-only.
5. Enable backups/PITR and rehearse restoration before the baseline load.
   Railway PostgreSQL is private by default; use private networking for
   deployed services. See [Railway PostgreSQL](https://docs.railway.com/databases/postgresql)
   and [point-in-time recovery](https://docs.railway.com/volumes/point-in-time-recovery).

### Gate 2 — target schema and writer

- **Completed locally:** the Drizzle adapter writes accepted target rows and
  atomic transaction graphs.
- **Completed locally:** clinical-order fields are aligned with the physical
  schema and canonical course/slot projection.
- **Completed locally:** one active owner-approved `legacy-import` consent is
  inserted per migrated patient.
- **Completed locally:** durable run/event/target links and deterministic
  public IDs make the same frozen pack resumable and idempotent.
- **Completed locally:** target DML runs under platform transaction context;
  the historical D2 bypass is restricted to explicit migration-import plus
  platform-admin context.
- **Completed locally:** generic confirmed death uses `DiedUnknownCause`, and
  unknown-date external administrations are admitted only after unique
  patient/course/service/slot resolution.
- **Still required for production:** repeat these controls against the final
  frozen pack in isolated Railway staging and production roles; do not treat a
  disposable local pass as target-environment approval.

### Local full migration rehearsal (completed 2026-08-18)

- regenerated the single disposable-development Drizzle baseline;
- created the isolated local `surevax_surevax_cms_revamp` database;
- migrated all baseline and supplemental SQL, then seeded successfully;
- verified `surevax_app` is neither superuser nor `BYPASSRLS`;
- verified all required migration relations and `DiedUnknownCause` exist;
- proved app-role UPDATE permission is denied and the owner-level immutability
  trigger rejects mutation; both probes rolled back to zero residue;
- verified seeded tenant controls: 34 patients, 29 transactions, 64 clinical
  orders and 28 consents under tenant-wide read scope.
- completed Trials V/W with 265,106 durable target links, a real staged failure
  and resume, and zero additional domain rows on a full rerun;
- loaded 15,736 patients, 56,078 encounters, 12,684 rabies courses, 71,417
  clinical orders, 41,332 transaction headers, 51,706 exact invoice lines and
  41,786 payment legs; and
- reconciled all payment legs to PHP 56,368,563.20 and all admitted invoice
  lines to PHP 51,387,000.00 gross.

This local success does not authorize production writes. Final source capture,
current-live unified recomputation, isolated Railway targets, restore proof,
staff/configuration approval and the bounded catch-up freeze remain open.

### Gate 3 — frozen source and reconciliation

- freeze AppSheet, bots/offline sync and all trackers;
- export/hash AppSheet plus all 14 trackers in one declared window;
- finish Salcedo and other hidden-tab ownership;
- run full patient/transaction/administration/schedule reconciliation;
- resolve or explicitly exclude every P1 group;
- obtain owner sign-off on financial totals, administrations and overdue dose
  schedules.

### Gate 4 — clean-room rehearsal

1. Run the read-only target probe:

   ```bash
   MIGRATION_PREFLIGHT_TENANT_ID=<tenant> \
     pnpm --filter @surevax/backend migration:preflight
   ```

2. Load a clean disposable database from the frozen pack.
3. Run the exact same pack again; target counts and links must not increase.
4. Inject a failure inside a multi-item sale; no partial header/item/payment
   rows may remain.
5. Verify RLS, audit triggers, consents, schedules and financial controls.
6. Restore the pre-load backup into a sibling database and compare controls.

`railway run` can inject a selected environment's variables into a local
one-shot command, but it must be used only after the target is explicitly
selected and verified. See [Railway CLI run](https://docs.railway.com/cli/run).

## Cutover sequence

| Phase             | Legacy writes                          | v2 writes             | Sync behavior                                              |
| ----------------- | -------------------------------------- | --------------------- | ---------------------------------------------------------- |
| Rehearsal         | Open                                   | Disabled              | Read-only snapshots and dry runs.                          |
| Freeze            | Stopped                                | Disabled              | Final all-source export/hash and reconciliation.           |
| Baseline load     | Stopped                                | Migration worker only | Idempotent target inserts from the signed source pack.     |
| Validation        | Stopped                                | Disabled for clinics  | Compare all control totals and queues.                     |
| Go-live           | Read-only                              | Enabled               | v2 becomes the sole operational system.                    |
| Bounded catch-up  | Exceptional approved late entries only | Enabled               | One-way legacy delta ingestion; no reverse sync.           |
| Bridge retirement | Permanently read-only                  | Enabled               | Final two zero-delta comparisons, then disable the bridge. |

After clinic use begins in v2, do not roll back by replacing the whole database.
Use auditable domain corrections and compensating transactions. A full database
restore is safe only before v2-originated clinical or financial work begins.
