# Pre-Cutover Readiness — 2026-08-16

> **Status:** read-only cross-branch diagnostic complete; production load not
> started. The live AppSheet database advanced to revision `445181` during the
> run, so all counts and matches must be rerun from a frozen source pack.

## Executive summary

Terra agents profiled the selected live sales ledger for all 14 branches and
performed bounded transaction corroboration. The provisional control
population is **26,407 candidate tracker rows** with **₱36,662,058.38 in
parseable tracker-row amounts**.

That amount is **not revenue, cash collected or confirmed administration**. It
includes deposits, already-paid and zero-price service rows, HMO and split
tenders, unresolved duplicates, and tracker-only evidence.

The migration queue now separates genuine decisions from deterministic work:

| Work class                        | Current count | Meaning                                                                                                |
| --------------------------------- | ------------: | ------------------------------------------------------------------------------------------------------ |
| P0 cutover gates                  |            10 | Whole-run controls that must close before any production load.                                         |
| P1 record blockers                |             4 | The affected record cannot be loaded safely until resolved or excluded.                                |
| P2 reviewer confirmations         |             3 | Strong proposed answers; a reviewer confirms only if the frozen join does not make them deterministic. |
| Automatic inference rules         |             9 | Rule-level QA and branch samples; no row-by-row nurse decision.                                        |
| Non-blocking follow-up categories |             5 | Load honest unknown/overdue states and continue operational follow-up.                                 |
| Copied/hidden quarantine groups   |             7 | Contribute zero rows until branch/period ownership is proven.                                          |

## Branch coverage

| Branch      | Selected live tab/range                 | Candidate rows | Tracker-row amount | Current readiness                                                                         |
| ----------- | --------------------------------------- | -------------: | -----------------: | ----------------------------------------------------------------------------------------- |
| Aguirre     | `Manual Sales!A1:J4038`                 |          4,037 |      ₱5,570,332.25 | Profiled; one ambiguous date and duplicate/missing-field candidates need the frozen join. |
| Alabang     | `Manual Sales Tracker!A1:I412`          |            411 |        ₱763,339.07 | Historical hidden-tab ownership unresolved.                                               |
| Cainta      | `Manual Sales Tracker!A1:J561`          |            558 |        ₱714,836.15 | Historical hidden-tab year/overlap unresolved.                                            |
| Cubao       | `Manual Sales 2026!A1:I19`              |             18 |         ₱21,688.58 | Provisional patient-level two-source join complete.                                       |
| Holy Spirit | `Manual Sales!A1:I9028`                 |          9,027 |     ₱10,866,172.79 | Profiled; one non-date value and duplicate/missing-field candidates remain.               |
| Marikina    | `January - March Manual Sales!A1:I1079` |          1,075 |      ₱1,891,405.33 | Selected tab profiled; title is stale and frozen join remains.                            |
| Maysilo     | `Manual Sales!A1:K2499`                 |          2,498 |      ₱3,413,877.31 | Profiled; one duplicate pair and missing-field candidates remain.                         |
| Novaliches  | `Manual Sales Nova!A1:I336`             |            329 |        ₱472,164.30 | Selected tab profiled; one missing-tender candidate remains.                              |
| Pasig       | `Daily Manual Sales!A1:I1796`           |          1,215 |      ₱1,940,577.49 | Financial linkage pending for deposit/already-paid/zero-price rows.                       |
| Salcedo     | `Manual Sales - Aug 2026!A2:H182`       |            178 |        ₱219,474.72 | **Branch-history blocker:** 40 month/tab candidates require an ownership roster.          |
| San Juan    | `Manual Sales!A1:I1527`                 |          1,523 |      ₱1,907,167.03 | Date/amount exceptions need the frozen AppSheet match.                                    |
| Sta Mesa    | `' Manual Sales'!A1:I10031`             |             34 |         ₱39,557.16 | Selected tab profiled; hidden March copy quarantined.                                     |
| Taguig      | `Manual Sales!A1:I3149`                 |          2,966 |      ₱4,504,829.08 | Structurally clean; full frozen join pending.                                             |
| Timog       | `August - Manual Sales!A1:I10031`       |          2,538 |      ₱4,336,637.12 | One financial conflict and one 21-row inferred-date block remain.                         |

Counts describe source rows, not unique patients, visits, payments or clinical
administrations. Every selected range remains live and mutable.

## Genuine manual decisions

### P1 — block only the affected record

1. **Cubao identity collision:** one patient reference conflicts with an
   earlier person label. Resolve from identity/audit/receipt evidence or
   exclude only that transaction.
2. **Aguirre ambiguous date:** `7/18/1905` cannot be changed to 2025 or 2026
   without a unique AppSheet match or clinic evidence.
3. **Holy Spirit non-date:** one date cell contains `Y`; workbook position alone
   is insufficient.
4. **Timog financial conflict:** tracker records ₱800 PayMongo while the bounded
   same-event AppSheet match records ₱300 cash. Receipt/payment evidence must
   decide whether one source is wrong or these are separate events.

### P2 — confirm only if the frozen join remains non-deterministic

1. Cubao spelling variant supported by unique date/amount/tender/service facts.
2. Cubao duplicate schedule group with one coherent dose-1-anchored schedule,
   pending deletion/recreation history.
3. Timog rows 966–986: 21 blank dates physically between 2026-05-16 and
   2026-05-17; accept 2026-05-16 only where one compatible frozen AppSheet event
   confirms it.

Missing tracker fields and exact duplicates do not automatically enter the
manual queue. The frozen AppSheet join first tries a unique deterministic
match. Only unmatched or conflicting residuals become P1 record blockers.

## Automatic inference examples

- Normalize 44 Group-A date cells only where adjacent sequence or an exact
  transaction establishes the date; retain raw values and rule provenance.
- Fill 18 Marikina blank dates and 18 San Juan yearless dates only while the
  frozen event match remains compatible.
- Exclude Aguirre's 19 month labels, residual headers, date-only stubs and
  empty grid capacity as non-patient source rows with rejection reasons.
- Collapse an exact tracker duplicate only when both observations point to one
  unique AppSheet event. Multiple compatible transactions remain unresolved
  because patients can pay for more than one dose.
- Use the containing clinic workbook as the proposed encounter branch, then use
  the matched transaction branch as corroboration; preserve a different
  onboarding branch as patient history and retain branch conflicts.
- Treat `i_IsAdministered=FALSE` as not administered by that row, even when the
  mutable actual-date field is populated; retain the contradiction.
- Build missing regimen slots as planned schedule facts only; payment,
  administration and cancellation remain separate.

## Remarks and external/prior courses

At least 602 non-unique Group-A remark clues refer to outside-clinic follow-up,
continuation, booster/restart, completed course or refused components. Remarks
are useful, but they establish only what they explicitly say:

- `ARV 2/3/4` is a sequence clue, not proof that preceding doses occurred
  locally; after the remarks-first check, E33 now treats a missing dose 1 as an
  owner-approved external dose-1 fact with unknown clinical details;
- hospital/outside-clinic/follow-up remarks create a provisional external or
  prior-dose context, not a guessed date/facility/product;
- booster, completed ARV or back-to-zero wording establishes coarse prior-course
  or restart context, not reconstructable historical doses;
- a refused component is removed from the proposed administration set unless a
  stronger source confirms it;
- financial remarks never prove clinical administration.

These items are deduplicated after the frozen patient join. Missing historical
detail becomes P3 follow-up when v2 can preserve the unknown safely.

## Copied and hidden tabs

The following contribute zero rows until ownership is proven:

- Alabang hidden `Manual Sales` and `November Manual Sales`;
- Cainta hidden historical `Manual Sales`;
- Salcedo's unrostered historical month/Tracker tabs;
- Sta Mesa/Timog hidden `March Manual Sales` copies;
- Cubao/Timog hidden `Manual Sales` copies;
- Cubao/Timog hidden `November Manual Sales` copies;
- Aguirre cash/shift reconciliation tabs as clinical-event sources.

Matching sheet IDs, grid sizes and sampled rows are sufficient to quarantine a
copy, not sufficient to assign the whole sheet to a branch.

## P0 gates before production

1. Freeze AppSheet and all 14 trackers, drain bots/offline sync, then export
   and SHA-256 hash all 15 live sources in one declared Asia/Manila window.
2. Complete the hidden-tab branch/month ownership roster.
3. Run the full patient, transaction, item, payment, remark, immunization and
   schedule join across every frozen branch row.
4. Compare frozen current data with usable historical snapshots/revisions to
   identify deleted/recreated immunizations.
5. Implement the production Drizzle adapter, active `legacy-import` consent,
   an honest unknown-date external-history representation, immutable row
   provenance and rollback.
6. Obtain zero unexplained financial residuals and sign off the purchase/admin
   and due/overdue schedule reports.
7. Pass a target-schema dry run, repeat/idempotency run, RLS/audit/soft-delete
   checks and rollback rehearsal.

## Restricted output

The patient-reference queue and operational workbook are outside Git at:

`/private/tmp/surevax-full-precutover-2026-08-16/outputs/surevax-full-precutover-readiness-2026-08-16.xlsx`

It contains Cutover Readiness, Cutover Gates, Branch Coverage, Manual Decisions,
Auto Inferences, Clinical Follow-up and Copy Quarantine tabs. Regenerate it from
the frozen source pack for the actual cutover; `/private/tmp` is ephemeral.
