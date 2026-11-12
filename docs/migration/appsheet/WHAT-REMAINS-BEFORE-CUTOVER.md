# What Still Needs To Be Done Before Cutover

Last updated: 2026-08-23 (Asia/Manila)

This is the canonical plain-language status for the AppSheet migration. It
separates what the disposable local rehearsals proved from the work still
required before any production write.

## Executive status

The migration now works end to end in a disposable local PostgreSQL database.
It can import the frozen source pack, stop after a real database invariant,
resume without duplicating completed work, and rerun the same pack without
adding another domain row.

That is strong migration-engine evidence, but it is not production approval.
The remaining P0 work is mainly operational: freeze the final current source,
provision and restore-test isolated Railway targets, approve staff access and
configuration, finish the bounded exception dispositions, and prove the final
catch-up/cutover run.

## What is done and locally proven

[Trials V/W](runs/2026-08-18-trials-v-w-full-defensible-migration.md) are the
current baseline. Trial T is retained as historical evidence of the earlier
base-facts boundary, but no longer describes current capability.

| Capability                     | Current result                                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Restart-safe migration         | Durable run, event and target links are connected to accepted writes. A staged failure resumed safely.                                                                                |
| Clean rerun                    | Re-running the same frozen pack inserted zero additional domain rows.                                                                                                                 |
| Patients and consent           | 15,736 patients and one approved migration consent per patient loaded; 13 implausible DOB values were withheld as null.                                                               |
| Encounters                     | 56,078 loaded, including 289 deterministic tracker-backed encounters.                                                                                                                 |
| Clinical history and schedules | 12,684 rabies courses and 71,417 clinical orders loaded: 60,968 Completed, 6,684 Scheduled and 3,765 Missed.                                                                          |
| External dose 1                | 1,883 approved external completions are represented with an explicitly unknown completion date, never a fabricated date.                                                              |
| Financial headers and tenders  | 41,332 transaction headers and 41,786 payment legs loaded. Both reconcile to PHP 56,368,563.20.                                                                                       |
| Exact invoice detail           | 51,706 invoice lines across 39,113 transactions reconcile exactly to PHP 51,387,000.00 gross. Mismatching detail is withheld, not balanced with an invented item.                     |
| Staff identity history         | 116 deterministic legacy staff identities loaded disabled. No imported account can log in until access is approved.                                                                   |
| Attendance                     | TimeLog and NurseShift union/deduplication is implemented and tested. The frozen pack had no admitted attendance rows, and attendance is not a clinical/financial cutover dependency. |
| Branch/reference reuse         | 16 branch identities plus deterministic product, service, eligibility and patient-tag resolution are proven without duplicating seed rows.                                            |

### Implementation and test map

| Area                                      | Implementation                                                  | Focused evidence                                                                 |
| ----------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Target writer and atomic financial graphs | `apps/backend/src/modules/data_migration/adapter.ts`, `load.ts` | `load.test.ts`, `pipeline.test.ts`                                               |
| Restart ledger and deterministic links    | `migrationLedger.ts`, `deterministicTargets.ts`                 | `deterministic-targets.test.ts`, `load.test.ts`                                  |
| Rabies courses and safe dose slots        | `resolveRabiesClinicalCourses.ts`, `clinicalMigrationPlan.ts`   | `rabies-course-resolution.test.ts`                                               |
| Transaction-constrained invoice lines     | `transactionItemProjection.ts`                                  | `transaction-item-projection.test.ts`                                            |
| TimeLog plus NurseShift normalization     | `attendanceProjection.ts`                                       | `attendance-projection.test.ts`                                                  |
| Disposable full rehearsal runner          | `apps/backend/src/scripts/runLocalMigrationTrial.ts`            | [Trials V/W run record](runs/2026-08-18-trials-v-w-full-defensible-migration.md) |

The 2026-08-23 branch validation ran all data-migration unit tests: 26 test
files and 142 tests passed, followed by a clean backend TypeScript check.

## Clinical reconstruction boundary

The vaccine histories and schedules have been rebuilt and written locally.
The loader uses observed administrations, uniquely corroborated tracker facts,
approved unknown-date external dose 1 facts, explicit plans, and safe trailing
template slots. It does not invent an interior dose merely because a later
dose exists.

The operational `Missed` rule is implemented: at the start of Manila Day 31,
a still-unadministered scheduled slot may become `Missed` only after checking
administrations, attributable remarks, rescheduling, cancellation,
refusal/deferral, duplicate or recreated rows, and later-dose ambiguity.
`Missed` means follow-up is still required; it neither cancels the course nor
proves that outside-clinic care did not occur.

The follow-up investigation found more evidence that can reduce the manual
queue, but it must be incorporated from one final frozen pack:

- five strict tracker-backed PEP dose-2 administrations;
- strict exact-day transactions that satisfy E44;
- six clean existing-event label repairs, two more complex course reviews, and
  seven duplicate-label candidates still awaiting a current-live re-read; and
- one PrEP-labelled 0/3/7 course that belongs in clinical-protocol review, not
  silent PEP relabelling.

See [the unresolved-dose investigation](runs/2026-08-22-unresolved-dose-agent-read.md)
and [the label-repair check](runs/2026-08-23-dose-label-repair-check.md).

## Remaining work, in priority order

### P0 — required before any production import

| Work                                            | Why it still matters                                                                                                             | Done when                                                                                                                                                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Final frozen source pack                        | The successful rehearsal used a stable temporary pack, while the live sheets have continued changing.                            | Export AppSheet and all approved branch trackers in one declared window; record file IDs, ranges, modified/revision markers, hashes, cutoff and exclusions in protected storage. |
| Final unified recomputation                     | Investigation counts came from different live moments and preprocessing boundaries.                                              | Run one resolver against the final pack, incorporating approved tracker, transaction, remark, historical and label-repair evidence before generating the queue and target plan.  |
| Isolated Railway staging and production targets | The observed Railway project still had development only; no production write or restore proof exists.                            | Create separate clean targets, configure least-privilege app and migration roles, enable backup/PITR, restore to a sibling target, and pass RLS/audit/rollback checks.           |
| Staff access approval                           | A legacy nurse row proves historical identity, not permission to log in or see every branch.                                     | Approve one target identity, role, primary branch and optional additional branches for each enabled user; leave all others disabled.                                             |
| Current configuration approval                  | Historical prices and seed reuse do not decide tomorrow's catalog.                                                               | Approve branch activation, payer/service configuration and current route/brand/tier prices, including the known ARV/HMO conflict.                                                |
| Old database reconciliation                     | The older `surevax_db` may contain facts missing from the current sheet, but it can also duplicate patients.                     | Apply the 399 high-confidence patient links and resolve, exclude or manually link the remaining 242 without creating duplicate people or clinical events.                        |
| Persisted review dispositions                   | The owner-only review visualization is useful for reading timelines, but its current reviewer choices stay in that browser only. | Store approve/reject/needs-more-evidence decisions with reviewer, timestamp, rule version and evidence; feed only approved dispositions into the final canonical ledger.         |
| Bounded catch-up sync and clinic freeze         | A baseline import alone misses rows added while clinics keep using AppSheet.                                                     | Use durable source checkpoints and target links for one-way catch-up, drain offline/bot changes, then make AppSheet and trackers read-only before final reconciliation.          |
| Acceptance and rollback authority               | Local proof does not identify who may accept totals or order a rollback.                                                         | Named owners sign the patient, financial, clinical, branch and exception controls and agree the rollback threshold before cutover.                                               |

### P1 — bounded records that can be quarantined

These queues overlap and must not be added together as a unique-patient count.
They should block only the affected record graph, not every safe patient.

| Queue                                          |                                                   Known rehearsal result | Treatment                                                                                              |
| ---------------------------------------------- | -----------------------------------------------------------------------: | ------------------------------------------------------------------------------------------------------ |
| Invoice detail without an exact reconstruction | 431 transactions with no source item link; 1,788 with mismatching detail | Keep authoritative header and payments; withhold uncertain item rows.                                  |
| Interior clinical positions absent             |                                      3,312 positions across 2,292 blocks | Keep the scheduled position/completion unknown unless independent evidence satisfies an approved rule. |
| Duplicate slot observations                    |                                               646 rows across 317 blocks | Withhold the conflicting slot; preserve independent evidence for review.                               |
| Unplaceable/non-numeric dose rows              |                                             1,844 rows across 999 blocks | Do not guess a dose position.                                                                          |
| Beyond-regimen doses                           |                                                                       42 | Clinical review.                                                                                       |
| Administered row missing a canonical event     |                                                                       44 | Preserve evidence; do not manufacture a completion.                                                    |
| External dose 1 not assignable to one course   |                                                                       19 | Preserve evidence; do not create an orphan completion.                                                 |
| Invalid/out-of-cutoff clinical dates           |                                                                       71 | Preserve source evidence and withhold the target date.                                                 |
| Conflicting canonical event IDs                |                                                                        2 | Withhold both versions until resolved.                                                                 |
| Implausible birth dates                        |                                                                       13 | Import patient with DOB blank and retain a review item.                                                |
| Historical patient links not deterministic     |                                                                      242 | Review in priority order; never merge on name alone.                                                   |
| Label-repair candidates                        |                              6 clean, 2 complex, 7 awaiting live re-read | Move the existing administration to an approved slot; never create a duplicate dose.                   |
| Selected tracker additions                     |                                               5 strict PEP dose-2 events | Add only after final-pack deduplication and contradiction checks.                                      |
| Salcedo copied/hidden tabs                     |                                                     Ownership unresolved | Keep unapproved tabs quarantined.                                                                      |

The large `E43 guard blocked auto-missed` count of 5,172 is not automatically
a nurse-review queue. Those slots stayed Scheduled/overdue because the evidence
guard prevented a bulk `Missed` conclusion. The final resolver should first
apply deterministic remarks, tracker, transaction, duplicate/recreated-row and
label-repair logic; only the irreducible patient/course conflicts become human
work.

### P2 — opening operational state

These do not change historical patient truth, but clinics need them for go-live:

- physical opening inventory count and timestamp per branch;
- responsible cashier and opening drawer balance per branch;
- notification credentials and templates;
- approved branch and payer master data;
- explicit classification of Virtual Branch and Test Branch;
- read-only retention period for AppSheet and trackers; and
- named approvers for the final exception report and rollback decision.

## Source and authority index

| Source                     | Locator                                                                                | Authority/use                                                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Current AppSheet database  | Google Drive ID `18D6KXggNxmAliJwtDGcIDyKxWCDGuOkL4rKa3FQoI64`                         | Primary current patient, transaction, remark and state source. Transactions are the financial authority.                                     |
| Rehearsal frozen pack      | `/private/tmp/surevax-live-freeze-2026-08-17/`                                         | Disposable local evidence only; rematerialize in protected storage for cutover.                                                              |
| Source manifests           | [SOURCE-MANIFEST.md](SOURCE-MANIFEST.md), [SOURCE-MANIFEST.json](SOURCE-MANIFEST.json) | File IDs, hashes, selected tabs/ranges, cutoffs and quarantines.                                                                             |
| Historical `surevax_db`    | Google Drive ID `149JYFvU6bT8R8aoCxnQtsK7UQxKusUqKwMSs3iKMtJQ`                         | Older history, admitted only after patient/event deduplication.                                                                              |
| Auxiliary nurse roster     | Google Drive ID `17PtId6Z2FPP6aaV-JPkNuVe7sZM26hzC0F2AeUbsHEA`                         | Nickname/reconciliation evidence; not access authorization.                                                                                  |
| Cleaned price list         | Google Drive ID `1GhRX1SujQqK363eGbFH1xIcaxwoGMXqiNmh1LVYXND8`                         | Proposed go-live configuration, not historical transaction truth.                                                                            |
| Clinic sales workbooks     | Per-branch IDs and local exports in [SOURCE-MANIFEST.md](SOURCE-MANIFEST.md)           | Workbook title is semi-authoritative for branch; corroborates administration and transaction facts.                                          |
| Cubao tracker              | Google Drive ID `1S-CRkWAD2is8nhGvMUNTc69FxYQAS7Y1qnaw_ShBUqA`                         | Sparse branch ledger used with AppSheet, never alone for completeness.                                                                       |
| Owner review visualization | Owner-only hosted review surface; source artifact remains outside Git                  | Displays representative patient, immunization, transaction and remark timelines. Current choices are local-only and not migration decisions. |

## Source rules that must not regress

- Transaction headers and tender columns are financial truth.
- Immunization rows are mutable clinical observations, not invoice truth by
  themselves.
- A tracker workbook title is semi-authoritative for the branch where the
  recorded administration happened.
- Exact evidence may repair an existing wrongly labelled dose; it must not
  create an additional administration from the same row/payment.
- A later dose, dangling source ID, or old unadministered plan does not prove a
  missing interior administration.
- After remarks review, a first local ARV dose 2+ may support an external dose
  1 with an unknown date; never fabricate its facility, date, brand or payment.
- `Pending` animal status means not recorded. Bare `Dead` means confirmed death
  with unknown cause/testing. Neither automatically stops treatment.
- TimeLog and NurseShift are parallel attendance sources; attendance is
  optional for clinical/financial cutover.

## Execution order

1. Freeze and hash the final current source pack.
2. Run the unified resolver and produce target plans plus priority queues.
3. Persist and apply approved staff, price, historical-link and clinical
   dispositions; quarantine unresolved record graphs.
4. Rehearse twice on clean isolated Railway staging, including injected
   failure, backup restore, RLS, audit and rollback checks.
5. Record the source checkpoint, run bounded catch-up, drain AppSheet/offline
   changes and freeze legacy writes.
6. Import production once, rerun idempotently, reconcile controls, obtain named
   acceptance, and cut branches over.

## Detailed evidence index

- [Inference and manual review policy](INFERENCE-AND-MANUAL-REVIEW-POLICY.md)
- [Production cutover and sync](PRODUCTION-CUTOVER-AND-SYNC.md)
- [Evidence and reconciliation model](EVIDENCE-AND-RECONCILIATION.md)
- [Manual augmentations](MANUAL-AUGMENTATIONS.md)
- [Decision register](DECISIONS.md)
- [Implementation plan](IMPLEMENTATION-PLAN.md)
- [Open questions](OPEN-QUESTIONS.md)
- [Trials V/W](runs/2026-08-18-trials-v-w-full-defensible-migration.md)
- [Unresolved-dose investigation](runs/2026-08-22-unresolved-dose-agent-read.md)
- [Dose-label repair check](runs/2026-08-23-dose-label-repair-check.md)
