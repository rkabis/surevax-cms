# Runtime Review Center Phase 1 — implementation handover

## Publication state

- **Implementation commit:** `6ed047fc403ed2cdc33e87bd9c5612f443b445dc`
- **Pull request:** [#616](https://github.com/njvil/surevax-cms-revamp/pull/616)
- **State at handover:** open, mergeable, all required GitHub checks green; not
  merged to `main` and not deployed.
- **Living backlog:** [`../STATUS.md`](../STATUS.md). This handover is the dated
  implementation record, not a second backlog.

## What changed

Phase 1 adds one branch-scoped `/review-center` worklist with two complete
runtime queues:

1. **Missing guardian information for minors.** Active, non-merged minor
   patients in the authenticated home branch are reviewable in a `DetailSheet`.
   The sheet previews commit effects, requires guardian name, relationship, and
   contact, then performs one optimistic and audited transaction.
2. **Yesterday's loose ends.** The worklist identifies stale Open/InProgress
   encounters, unsettled non-prepayment transactions, prior open cash drawers,
   and Completed clinical orders without `documented_by_id`, using
   `Asia/Manila` clinic-day boundaries. Rows link to the existing record owner;
   the center does not mutate those records.

The center also links authorized administrators to existing Approvals and
Cross-Branch Access surfaces. It does not copy their queues or state machines.
AppSheet importer exceptions and migration-review artifacts are outside the
runtime contract and are never queried.

Implementation touched the shared Zod contract, backend feature module and
contract generator, frontend worklist and navigation, cash-drawer ownership
resolution, a forward database invariant, integration/component/E2E tests, and
the canonical product/API/requirements documentation. The full file list is
preserved by the implementation commit; the durable behavior contract is
[`../specs/review-center-phase-1.md`](../specs/review-center-phase-1.md).

## Decisions and safety boundaries

| Decision                                                | Operational effect                                                                                                                                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime review is separate from migration review        | Only current tenant/branch runtime tables can produce worklist rows. Legacy profiling counts remain planning evidence, not live tasks.                                                                             |
| Two complete queues beat five partial tabs              | Duplicate-patient merge and external-immunization reconciliation remain explicit later slices until their write contracts are safe.                                                                                |
| Existing day-open summary keeps its narrow owner        | `/api/day-summary/loose-ends` continues to feed the Branch opening banner; `/api/review-center` is the comprehensive row-level staff worklist, not a replacement endpoint or a copied UI.                          |
| No silent clinical or financial mutation                | The center never merges patients, infers a guardian, marks a dose administered, completes/closes an encounter, settles a transaction, or closes a drawer.                                                          |
| Guardian correction is one accountable write            | All three fields, commit-effects preview, `row_version` check, same-branch ownership check, update, and audit event are one database transaction.                                                                  |
| Operational date means Manila date                      | Timestamp predicates use `AT TIME ZONE 'Asia/Manila'`; the PostgreSQL UTC session date is not clinic-day truth.                                                                                                    |
| Role and branch boundaries are server/database concerns | Review roles are `TenantAdmin`, `BranchAdmin`, `Physician`, `Nurse`, and `Branch`; a concrete authenticated branch is required; Cashier/platform principals are rejected. RLS remains the primary tenant boundary. |
| Drawer operation remains financial                      | Only `TenantAdmin`, `BranchAdmin`, `Cashier`, and `Branch` can operate drawers. Clinical reviewers may see the exception but get no financial write action.                                                        |
| One physical Open drawer per branch                     | A partial unique PostgreSQL index enforces one Open session per tenant+branch. Resolver, payments, and deposits target the deterministic oldest Open session across day rollover.                                  |
| Migration fails closed on conflicting history           | `0011_cash_drawer_branch_invariant.sql` never auto-closes duplicate Open drawers. Deployment stops for an accountable operator to correct the conflict first.                                                      |
| Public contracts use display IDs                        | Internal bigint keys do not cross the API boundary. Shared Zod remains the contract source.                                                                                                                        |

## Adversarial review record

A bounded GPT-5.6 Terra adversarial review ran three passes. All reported P0–P2
issues were resolved before the PR was opened:

- corrected UTC-versus-Manila loose-end classification;
- made prior-day drawer exceptions resolve to a real owner workflow;
- rejected calendar-invalid dates, not only malformed strings;
- restored canonical documentation coverage;
- removed drawer writes from clinician roles;
- aligned prior-day deposits and payment linkage to the same Open drawer;
- replaced the raceable per-user Open-drawer invariant with a branch-wide one;
- prevented the day-open prompt from offering a second drawer;
- isolated the review test fixture from the seeded HST patient row.

Final adversarial result: no remaining P0, P1, or P2 finding.

## Verification evidence

| Layer                             | Result                                                           |
| --------------------------------- | ---------------------------------------------------------------- |
| Review Center backend integration | 10 passed                                                        |
| Cash drawer integration           | 7 passed                                                         |
| Frontend component tests          | 6 passed                                                         |
| Local Review Center E2E           | 3 passed                                                         |
| Forward migration                 | Applied twice successfully; idempotent on a clean database       |
| Repository gate                   | `pnpm agent:check` passed                                        |
| GitHub CI on PR #616              | Install/typecheck/build, backend integration, and E2E all passed |

Coverage includes forbidden roles, tenant/branch isolation, Manila-midnight
boundaries, invalid dates, stale writes, audit attribution, transaction
rollback, prior-day drawer resolution/deposits, concurrent Open-drawer
rejection, commit preview, owner routing, and truthful empty/error states.

## Next slices

The ordered live backlog remains in [`../STATUS.md`](../STATUS.md). The feature
contract records the acceptance boundary for each slice:

1. Patient duplicate review and audited merge planning: enumerate every
   clinical/financial FK owner, preview the move plan, commit atomically,
   preserve both identities and immutable history, define conflict behavior,
   and provide an explicit audited correction strategy before exposing Merge.
2. External/prior immunization reconciliation: add a durable runtime “requires
   review” fact and explicit reconciliation outcome; do not derive runtime work
   from migration remarks.
3. Undocumented-administration correction: define who may attest a historical
   documenting actor and how the correction is audited; never manufacture an
   administration event.
4. Pagination, assignment, SLA, and bulk mechanics only after real queue volume
   demonstrates the need; no bulk clinical closure is implied.

## Deployment gate

Before merging/deploying the migration, inspect each tenant/branch for more
than one `Open` cash drawer. Resolve any conflict through an accountable,
audited financial correction. Do not edit the migration to choose a winner or
auto-close history. After deployment, smoke-test both Review Center counts with
an authorized branch principal, confirm a forbidden role receives 403, and
confirm the branch kiosk resolves any prior-day Open drawer.
