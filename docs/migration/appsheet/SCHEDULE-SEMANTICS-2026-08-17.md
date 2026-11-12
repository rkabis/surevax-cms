# Schedule Semantics — Live Freeze Assessment (2026-08-17)

> **Scope:** PHI-safe semantic assessment of the Drive-materialized AppSheet
> freeze at `/private/tmp/surevax-live-freeze-2026-08-17`. Counts are derived
> from the `Immunization` and `Patient` source tabs; no patient names, remarks,
> or raw clinical content are recorded here.
>
> **Conclusion:** `LOAD_PLAN_SCHEDULES_NOT_RECONCILED` remains a **clinical
> schedule-write P0**, but it need not block a **disposable base-facts trial**
> that deliberately excludes `patient_standing_orders` and schedule-derived
> `clinical_orders`. It must not be bypassed by writing the legacy
> `transformClinicalOrders` output as live care state.

## Why the current target plan is unsafe

`transformClinicalOrders.ts` still treats each current Immunization row as a
target clinical order. It uses a fixed `2025-05-21` export date, marks a past
unadministered row `Cancelled`, clusters courses directly from current rows,
and creates standing orders without the canonical event ledger. These behaviours
conflict with E4, E6, E19, E20, E32, E33 and E39:

- a purchase does not prove an administration;
- an unadministered past planned dose is scheduled/overdue, not cancelled;
- a false `i_IsAdministered?` with an actual date is a contradiction, not an
  administration;
- missing dose 1 can be an external administration with an unknown date;
- deleted/recreated rows and multi-dose purchases require event/slot
  reconciliation first.

The existing dry-run plan contains **11,026** standing orders and **72,729**
clinical orders. It is useful for referential-load testing, but it is not a
truthful clinical schedule migration.

## Source population and deterministic reconstruction profile

| Measure                                                                    |                Count | Interpretation                                                                               |
| -------------------------------------------------------------------------- | -------------------: | -------------------------------------------------------------------------------------------- |
| Rabies PEP/PrEP/Booster source observations                                |               45,371 | Current AppSheet observations, not a complete event history                                  |
| Valid source-patient links                                                 |               45,371 | No orphan patient link in this current freeze                                                |
| Observations with no actual or ideal date                                  |                    1 | Withhold from schedule construction                                                          |
| Explicit unadministered observations                                       |                9,061 | Raw planned/missed candidates                                                                |
| Explicit unadministered with an ideal date                                 |                9,050 | Schedule observation candidates only                                                         |
| False-administered rows that also contain an actual date                   |                  847 | E19 contradiction: do not create an administration or final schedule slot from the row alone |
| Administered rows without an actual date                                   |                   49 | Do not mark completed without corroborating evidence                                         |
| Non-standard route labels                                                  | 25 rows / 9 episodes | Labels retain an ID/IM prefix plus payer text; normalize only with raw value retained        |
| Candidate dose episodes under the existing 60-day/30-day segmentation rule |               13,627 | Rule-level reconstruction input, not yet canonical ledger output                             |

The historical reconstruction rule, executed against the live freeze without
printing PHI, produced the following **provisional** classification:

| Provisional class                         |  Count | Meaning                                                                                              |
| ----------------------------------------- | -----: | ---------------------------------------------------------------------------------------------------- |
| Confirmed source administrations          | 36,069 | Still require canonical-event and transaction/tracker reconciliation before target completion writes |
| Source explicit scheduled slots           |  8,817 | Includes conflicting and duplicated episode contexts                                                 |
| Trailing template slots                   |  3,655 | Potential planned-only slots, never payment or administration facts                                  |
| Interior missing slots                    |  3,163 | Must not be synthesized; record/episode reconciliation needed                                        |
| Duplicate dose-position observations      |    359 | Do not auto-select a target slot                                                                     |
| Dose position beyond regimen              |     44 | Hold for regimen/clinical review                                                                     |
| Unplaceable non-numeric dose observations |     67 | Hold for review                                                                                      |
| Migration-site shadow duplicates          |     14 | Can be retained as provenance and excluded from logical-slot duplication when the sibling is unique  |

## What can be loaded, staged, or withheld

| Fact class                                                                                                   |                                    Count currently measurable | Initial local migration disposition                                                            | Why                                                                                                              |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------: | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Patient, branch, catalog, encounter, transaction, item and payment base facts                                | Existing plan, subject to their independent record exceptions | **Load into disposable DB**                                                                    | These facts do not require a regimen episode to be truthful. Withhold the existing P1 financial/identity groups. |
| Confirmed local administrations                                                                              |                          59,158 canonical events in rehearsal | **Load only through canonical-event writer once target-link/provenance wiring is active**      | A completed order is defensible only from administration evidence, not a paid immunization row.                  |
| E33 external dose-1 facts                                                                                    |                           1,902 canonical events in rehearsal | **Stage as external evidence; do not fabricate a completed target order when date is unknown** | E37 permits unknown date but the current target transform does not represent it correctly.                       |
| Explicit schedule observations with ideal date, no actual date, unique slot and a clean exact-ID/IM episode  |                                                         7,451 | **Stage now; target-load after the ledger-to-standing-order writer exists**                    | They are trustworthy planned observations, but the target PSO/course link must come from canonical sequencing.   |
| Same as above, allowing the raw `ID - ...`/`IM - ...` labels to normalize to ID/IM while retaining raw value |                                                         7,455 | **Reviewer-sample normalization**                                                              | Only 4 additional slots; this is not a material blocker.                                                         |
| Deterministic trailing template slots in clean exact-ID/IM episodes                                          |                                                         2,214 | **Stage as template-derived planned facts; target-load after course writer**                   | E20/E26 permit planned-only synthesis with rule/anchor provenance.                                               |
| Explicit planned rows not in a clean episode                                                                 |                                                           582 | **Withhold target write; retain source evidence**                                              | Duplicates, interior gaps, extra positions, or unplaceable sequence prevent a safe course/slot choice.           |
| False-administered row with populated actual date                                                            |                                                           847 | **Withhold target schedule/admission write**                                                   | E19/E24 contradiction.                                                                                           |
| Interior missing slots                                                                                       |                                                         3,163 | **Withhold; never synthesize**                                                                 | A later dose exists, so auto-fill would create a false history.                                                  |
| Extra position, duplicate, or unplaceable dose                                                               |                                                           470 | **Withhold per affected slot/episode**                                                         | Clinical/reconciliation decision required.                                                                       |
| No-date row or administered-without-actual-date                                                              |                                                            50 | **Withhold from completed/scheduled target state**                                             | Preserve as provenance and seek corroboration.                                                                   |

The clean-episode figures are intentionally conservative. They are source-only
counts, not the final canonical-ledger count: tracker evidence, E33 external
dose-1 inference, purchase entitlements, deletion/recreation comparison and
remarks can change the episode evidence but must not silently change the raw
source observation.

## Agreed overdue-to-missed rule

E43 adds an operational state transition without changing the underlying
clinical evidence:

- through 30 full Asia/Manila calendar days after `currentScheduledDate`, an
  unresolved slot remains `Scheduled`/`Pending` and is displayed as overdue;
- at the start of Day 31, it may become `Missed` only when there is no local or
  external administration evidence and no attributable reschedule,
  cancellation, refusal, deferral, duplicate/recreated-row conflict or later
  dose evidence that makes the sequence ambiguous;
- the transition records reason `AUTO_MISSED_30_DAYS_NO_EVIDENCE`, evaluation
  time, original and current scheduled dates, source/run provenance and the
  checks performed;
- `Missed` means the patient still needs catch-up follow-up. It does not prove
  the dose was never received at another clinic, cancel later doses, or restart
  the course; and
- later credible local or external evidence supersedes the operational state
  and recomputes the remaining schedule while preserving the audit trail.

For the 2026-08-17 freeze, the threshold is evaluated from each slot's current
scheduled date. This rule may classify clean reconciled slots automatically;
it must not be applied directly to the 582 non-clean planned observations or
the other withheld/conflicting evidence classes above.

## Gate classification

| Proposed operation                                                                                                                 | Schedule blocker classification                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Load the present legacy `patient_standing_orders` and `clinical_orders` plan                                                       | **P0 — block**                                                                             |
| Load only base entities to a database named `surevax_migration_trial_*`, excluding standing orders and all schedule-derived orders | **Not a P0**; record blockers remain excluded and the database is explicitly exploratory   |
| Write completed administration target orders from canonical local-administration events, with provenance/target links              | **Implementation P0 until the canonical writer is wired and clean-room tested**            |
| Write scheduled target orders / standing orders from the 7,451 explicit and 2,214 template-derived candidates                      | **P0 until ledger-to-course/slot writer exists and is tested**                             |
| Production or staged production migration                                                                                          | **P0** until full reconciliation, source freeze, idempotency and post-load invariants pass |

## Required implementation boundary

Before the first clinical schedule target write, replace the legacy
`transformClinicalOrders` output with a canonical-ledger projection that:

1. segments courses after canonical administration/external evidence is formed;
2. creates one standing order per resolved regimen episode;
3. writes source-explicit and template-derived planned slots separately;
4. derives due/overdue and E43's guarded Day-31 `Missed` state from the freeze
   cutoff without writing `Cancelled`;
5. attaches transaction items to dose entitlements without marking them
   administered; and
6. writes a durable migration target link and source provenance for every
   target row.

Until then, the allowed disposable trial should use a `base-facts-only` plan
filter rather than permitting the unsafe clinical portions of the current plan.
