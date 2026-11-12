# Runtime Review Center — Phase 1

- **Status:** implemented in [PR #616](https://github.com/njvil/surevax-cms-revamp/pull/616); pending merge to `main` as of 2026-08-23
- **Route:** `/review-center`
- **API:** `GET /api/review-center`, `PATCH /api/review-center/missing-guardians/:patientId`

## Outcome

The Review Center is the branch worklist for “what needs attention now?”. It is
not a general reporting page and it does not expose AppSheet migration exception
artifacts. Every row comes from current runtime tables under the signed-in
tenant and branch context.

## Phase-1 queues

| Queue                  | Runtime predicate                                                                                                                                                                                                     | Resolution path                                                                                                                                                                                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing guardians      | Active, non-merged patient in the current home branch; known DOB; under 18 on the selected Manila clinic date; any of guardian name, relationship, or contact is blank                                                | A `DetailSheet` shows the patient and commit effects. Staff must enter all three fields and confirm. One server transaction checks branch ownership and `row_version`, updates the patient, and writes the normal accountable audit event. It does not create or close a clinical or financial record.                  |
| Yesterday's loose ends | Current-branch stale Open/InProgress encounters, unsettled non-prepayment transactions, prior open drawers, and Completed clinical orders without `documented_by_id`, all before the selected Asia/Manila clinic date | Row-level display IDs deep-link to the existing encounter, transaction, and scheduled-order owners. Drawer operators link to the branch kiosk; clinical-only reviewers see that a financial role is required. The center does not complete encounters, settle money, close drawers, or fabricate administration actors. |

Counts are server-owned. Successful zero responses, filtered zero responses,
loading, and API failures render as different states; an error is never shown as
“nothing needs attention.” Lists are capped at 200 rows while counts remain
complete.

## Authorization and isolation

- Server allow-list: `TenantAdmin`, `BranchAdmin`, `Physician`, `Nurse`, and
  the clinic `Branch` account. `Cashier` and platform accounts are rejected.
- A branch assignment is mandatory. The API never accepts a branch ID from the
  browser.
- Timestamp predicates convert `timestamptz` values to `Asia/Manila` before
  comparing them with the selected clinic date; a post-midnight Manila event is
  never mislabeled as a prior-day loose end because PostgreSQL runs in UTC.
- Queries and guardian writes execute inside `withTenantTx`, which sets tenant,
  user, and branch GUCs for PostgreSQL RLS and audit triggers.
- Guardian writes additionally require `patients.home_branch_id` to match the
  signed-in branch. A cross-branch target is not disclosed as writable.
- Only public display IDs cross the wire.
- Cash-drawer operations have their own server allow-list: `TenantAdmin`,
  `BranchAdmin`, `Cashier`, and `Branch`. A `Nurse` or `Physician` can see the
  exception but cannot open, close, deposit from, or void against a drawer.
- PostgreSQL enforces at most one Open drawer per tenant and branch. The
  forward migration never auto-closes conflicting financial history: an
  existing duplicate makes deployment stop for accountable correction.
- The current-drawer resolver, payment linkage, and deposits deterministically
  target that same branch session even after Manila-day rollover. A prior-day
  drawer must be closed before another can open.

## Linked, not duplicated

Authorized administrators get links to the existing Approvals and Cross-Branch
Access surfaces. Their state machines, votes, correction semantics, and
compliance evidence remain owned there.

## Explicit next slices

1. **Patient duplicate review and merge.** A safe implementation needs a
   previewed FK-ownership plan for every clinical and financial table, one
   atomic audited commit, preserved source identity/history, conflict handling,
   and an explicit audited correction strategy. The existing
   `potential_duplicate_of_id` / `merged_into_id` fields are not that workflow;
   Phase 1 does not auto-merge or expose a misleading merge button.
2. **External/prior immunization reconciliation queue.** Capture and display
   already exist on the patient record, with explicit source values. A runtime
   queue still needs a durable “fact requires reconciliation” signal. Migration
   remarks and importer exception files are not used to manufacture live work.
3. **Undocumented-administration correction.** Phase 1 surfaces the affected
   order and opens its owner page. A later slice must define who may attest a
   historical documenting actor and how that correction is audited; it must
   never mark a dose administered.
4. **Large-queue pagination/assignment.** The current 200-row operational cap
   is sufficient for Phase 1. Cursor pagination, ownership, SLA, and bulk
   actions require separate requirements; no bulk clinical closure is implied.

## Verification contract

- Backend integration: forbidden roles, branch isolation, Manila-midnight
  predicates, calendar-invalid date rejection, stale-write conflict, audit
  attribution, patient/audit rollback, prior-day drawer resolution/deposits,
  and the branch-wide concurrent-open invariant.
- Frontend: counts/rows, severity stripes, commit preview before PATCH,
  prior-drawer owner routing, no second-drawer prompt, and distinct
  success-empty versus error states.
- E2E: the real Branch session reaches the navigation item and loads both queue
  counts from the branch-scoped API.

Implementation narrative, adversarial findings, exact checks, and the deploy
gate are indexed in
[`../handovers/2026-08-23-review-center-phase-1.md`](../handovers/2026-08-23-review-center-phase-1.md).
