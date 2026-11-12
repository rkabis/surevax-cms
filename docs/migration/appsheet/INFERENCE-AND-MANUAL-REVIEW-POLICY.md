# Inference and Manual Review Policy

> **Effective:** 2026-08-16
> **Purpose:** make migration assumptions understandable, repeatable and safe;
> keep the manual queue limited to decisions that evidence and deterministic
> rules cannot resolve.

## Executive rule

**Do not ask a person to decide what a deterministic rule can decide. Do not
let a deterministic rule invent a clinical or financial fact.**

Each anomaly is assigned one resolution mode. Priority and resolution mode are
separate: a high-priority item may be an engineering control, while a
low-priority item may be a patient follow-up that remains clinically useful.

| Resolution mode       | Plain-English meaning                                                                    | Human action before load                                               |
| --------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `CUTOVER_BLOCKER`     | The source snapshot or loader is not safe enough to run.                                 | Fix for the whole migration before any production load.                |
| `RECORD_BLOCKER`      | The affected patient's identity, money or administration cannot be chosen safely.        | Resolve or exclude only the affected record and preserve the evidence. |
| `REVIEW_CONFIRMATION` | The evidence points strongly to one answer, but a human-owned fact still needs sign-off. | Confirm, reject or correct the proposed answer.                        |
| `AUTO_INFER`          | A named, deterministic rule produces one non-conflicting answer.                         | No row-by-row decision; review the rule and sample its output.         |
| `FOLLOW_UP`           | The migration can preserve the uncertainty without falsifying history.                   | Continue as an operational/clinical follow-up after load.              |

## Priority order

The queue is sorted in this order:

1. **P0 — stop the cutover:** an unsafe snapshot, an incomplete production
   adapter, or a control failure that could corrupt many records.
2. **P1 — stop the affected record:** ambiguous patient identity, conflicting
   money, or mutually incompatible administration evidence.
3. **P2 — confirm a strong inference:** evidence has one likely answer but the
   remaining fact belongs to clinic, finance or clinical staff.
4. **P3 — follow up without blocking migration:** unknown external facility,
   unknown historical date, overdue outreach, or another gap that can be
   represented honestly in v2.

`AUTO_INFER` rows are reported separately and are not counted as manual queue
work. They are still auditable and require rule-level QA.

## Evidence and inference ladder

Use the highest applicable rung. A lower rung cannot override a conflicting
higher rung.

| Rank | Evidence pattern                                                                                  | Allowed action                                                                                                                                     | Never infer                                                          |
| ---: | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
|    1 | Exact stable source IDs or cross-references with no conflict                                      | Link observations deterministically. A one-way transaction reference is sufficient when the referenced row exists and patient/service facts agree. | That purchase proves administration.                                 |
|    2 | Unique same-visit agreement: stable patient, branch, date, amount, tender and compatible services | Group split clinic rows and AppSheet transactions into one visit.                                                                                  | Extra doses from repeated text or injection sites.                   |
|    3 | Explicit attributable remark or card/facility statement                                           | Record the stated external administration or contextual fact, including unknown fields.                                                            | A date, facility, brand or route the remark does not state.          |
|    4 | Canonical regimen plus a confirmed anchor and sequence                                            | Create expected dose slots and derive due/overdue state.                                                                                           | Payment, administration, cancellation or a historical dose.          |
|    5 | Unique normalized name plus several exact visit facts                                             | Propose a match for `REVIEW_CONFIRMATION`.                                                                                                         | Automatic identity merge when DOB/contact is missing or conflicting. |
|    6 | Name alone, copied-tab location, mutable status text or an AppSheet `Migration` marker            | Keep unresolved or quarantine.                                                                                                                     | Patient identity, branch ownership or outside-clinic administration. |

## Branch attribution ladder

The app owner confirmed that the **containing clinic workbook title is the
semi-authoritative branch source** for patient-level rows selected from that
workbook. Branch attribution therefore follows this order:

1. containing clinic workbook title / Drive file identity;
2. AppSheet `Transactions.t_BranchRef` for the matched visit;
3. patient onboarding branch as historical context only.

For a row from an approved patient-level tab, use the workbook's clinic as the
proposed encounter branch. A compatible transaction branch corroborates it. A
different transaction branch is retained as a conflict and does not silently
override the workbook branch.

The branch-title presumption applies to the selected active ledger and
branch-specific month tabs. Byte-identical tabs found in more than one workbook
remain quarantined: a copied row can sit inside a branch-titled workbook without
proving that the event happened there.

## Approved event and financial authority

For rows from the approved branch ledgers:

1. A normal Manual Sales vaccine row proves the branch visit, listed service
   and administration.
2. An attributable deposit, future-dose, not-yet-administered, refused,
   cancelled or equivalent remark overrides the default administration
   interpretation.
3. AppSheet `Transactions` supplies authoritative amount, discount, tender and
   payer facts. Tracker financial values corroborate and expose exceptions.
4. A unique normalized-name + workbook-branch + date + service + amount + tender
   match may link a tracker visit to one AppSheet patient/event. It does not
   rewrite patient demographics.
5. A transaction may purchase several dose entitlements. Purchase and
   administration remain separate for every dose item.

## Missing first-dose rule

When the first local/system ARV event is dose 2 or later:

1. Search attributable AppSheet `Remarks`, immunization remarks and tracker
   notes for prior-dose, external-clinic, refusal, restart or contrary evidence.
2. If dose 1 is absent from the system and nothing contradicts prior
   administration, create an external dose-1 administration with unknown date,
   facility, brand and route unless explicitly stated.
3. Record `ASSUMED_EXTERNAL_MISSING_DOSE_1`, the triggering later dose, every
   searched source locator and the unresolved fields.
4. Never mark the inferred dose purchased, internally administered or missed.

## Missing later-dose rule

For a missing dose position 2 or later:

1. Resolve the complete canonical patient/course ledger before creating a
   queue item: explicit remarks, unnumbered and alternate-route administered
   rows, selected tracker evidence, strict transaction evidence and historical
   observations all participate.
2. A unique transaction proves the missing administration only under E44:
   exact patient and expected day, fully paid amount equal to the established
   series price, no deposit/package/advance/refund/mixed-service indicator and
   no allocation to another immunization.
3. A selected Manual Sales row proves local administration only under
   E28/E29/E31's unique multi-field and contradiction checks.
4. A later numbered dose, dangling reference or older unadministered planned
   row does not prove completion. Preserve the inferred schedule slot/date and
   keep completion unknown.
5. If an existing administered row falls exactly on the missing slot date, it
   may enter an owner-reviewed label-repair queue. Repair the existing event;
   never create a second administration from the same evidence.

## Approved manual augmentations

Additional immunizations and scheduled doses may be supplied after the frozen
source extraction. They are append-only observations, not edits to source rows.
Every augmentation must include:

- a unique augmentation/source row ID that does not collide with AppSheet IDs;
- patient and workbook/branch identity;
- service/vaccine and dose position;
- `administered` or `scheduled` fact type;
- actual date for a known administration, or ideal date for a scheduled dose;
- explicit external/unknown-date flags where applicable;
- reason, evidence locator, approver and approval timestamp;
- immutable run/file hash and disposition in the reconciliation report.

An augmentation cannot delete, overwrite or silently supersede an AppSheet or
tracker observation. A contradiction creates a record blocker or an explicitly
approved supersession link.

The first executable boundary lives in
`apps/backend/src/modules/data_migration/manualAugmentations.ts`. It accepts
approved local administrations, external administrations and scheduled doses,
checks the frozen-source hash, and appends canonical events without mutating
source data. Unknown-date external events now have a truthful target shape;
they remain record-blocked only when patient, course, service or dose-slot
linkage is ambiguous.

## Human-readable assumption record

Every inferred or unresolved item must answer the same five questions:

| Field                     | Required wording                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| **What we see**           | The source observations, with file, tab, row and source ID.                                             |
| **What we infer**         | One concise proposed meaning and the named rule that permits it.                                        |
| **What we do not infer**  | Facts deliberately left unknown.                                                                        |
| **Why this is safe**      | Corroborators, uniqueness check and any contradiction check.                                            |
| **What a person must do** | `None`, rule-level sample QA, confirm one fact, resolve/exclude the record, or fix the cutover control. |

Confidence is descriptive, not a substitute for the resolution mode:

- `DETERMINISTIC`: the rule has one answer and no contradiction;
- `STRONG`: several independent facts agree uniquely;
- `PARTIAL`: some facts are supported and others remain unknown;
- `CONFLICTING`: credible observations cannot all be true;
- `INSUFFICIENT`: the available evidence cannot identify an answer.

## Automatic decisions

The following do **not** belong in the row-by-row manual queue when their
preconditions are satisfied:

| Situation                                                                                                         | Automatic disposition                                                                                                                 | Audit requirement                                                                                    |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Patient onboarding branch differs from the clinic-workbook branch                                                 | Keep onboarding branch as source history; use the approved workbook's branch for the encounter.                                       | Record workbook/file branch, transaction branch and onboarding branch.                               |
| Transaction branch differs from the approved clinic-workbook branch                                               | Keep the workbook branch as the proposed encounter branch and emit a branch conflict.                                                 | Never rewrite the transaction's raw branch; apply the owner-approved conflict rule before load.      |
| Transaction points to an existing immunization whose reverse reference is blank                                   | Link purchase to the row when patient/service evidence is compatible and unique.                                                      | Preserve the asymmetric raw references.                                                              |
| `i_IsAdministered=FALSE` but an actual-date field is populated                                                    | Do not create an internal administration from that row. Preserve the contradictory raw value.                                         | Emit a contradiction observation; escalate only if other credible evidence says it was administered. |
| Regimen requires a future slot absent from the current sheet                                                      | Create a synthetic **planned** slot from the confirmed anchor.                                                                        | Store regimen/version, anchor and formula; never label it paid or administered.                      |
| Expected slot is before the cutoff with no supported administration                                               | Derive `overdue/unresolved`, never `Cancelled`.                                                                                       | Recompute at the frozen cutoff; place outreach in `FOLLOW_UP`.                                       |
| Source time zones have the same UTC offset for the observed local timestamps                                      | Normalize to Asia/Manila without shifting wall-clock time.                                                                            | Preserve original zone and parsed local value; reject DST/offset disagreement.                       |
| An explicit remark says prior doses occurred elsewhere but omits date/facility                                    | Record only the stated external dose count/positions; leave date and facility unknown.                                                | Keep the verbatim attributable remark in restricted provenance.                                      |
| First local/system ARV record is dose 2+ and dose 1 is absent                                                     | After the remarks-first check, create external dose 1 with unknown date/facility.                                                     | Never infer local administration, payment, brand, route or an exact date.                            |
| One fully paid transaction uniquely matches a missing dose 2+ patient, expected date and established series price | Create the Completed historical administration under E44 after the advance/package/mixed-service and existing-allocation guards pass. | Retain transaction and course evidence, rule version and unknown nurse/brand/lot fields.             |
| A selected clinic tracker row uniquely matches a missing administration under E28/E29/E31                         | Create the local administration unless an attributable contrary remark exists.                                                        | Retain workbook-title branch, tab/row locator, patient-match dimensions and contradiction check.     |

## Items that genuinely require people

### Cutover-wide blockers

- AppSheet or any branch tracker changed after the declared cutoff;
- the AppSheet database plus all 14 trackers were not materialized and hashed
  from the same frozen window;
- the production Drizzle adapter, consent creation, provenance or rollback
  controls are incomplete;
- financial or dose reconciliation invariants fail after deterministic rules.

### Record blockers

- one source patient ID appears to refer to different people;
- more than one patient is compatible with a tracker row;
- two credible records claim incompatible administered dates, brands, routes or
  facilities for the same dose slot;
- financial evidence leaves more than one possible allocation or produces a
  non-zero unexplained residual.

### Reviewer confirmations

- a spelling variant is uniquely supported by visit facts but lacks DOB/contact;
- duplicate schedule groups have one coherent candidate but deletion/recreation
  history could change which source row survives;
- a branch or payer fact is only available in a clinic-owned source whose
  ownership still needs sign-off.

## Non-blocking clinical follow-up

These are important but do not justify falsifying or delaying otherwise safe
records:

- unknown outside-clinic facility or date;
- booster course with only a coarse statement of prior vaccination;
- overdue dose requiring contact or vaccination-card checking;
- missing historical guardian or discount-identification details already
  accepted by the migration policy.

Represent each gap explicitly in v2 or the immutable migration artifacts. Never
turn `unknown` into `no`, `missed`, `cancelled` or a guessed date.

## Queue schema

The restricted manual queue must contain:

| Field                                                     | Meaning                                              |
| --------------------------------------------------------- | ---------------------------------------------------- |
| `queue_id`                                                | Stable run-local identifier.                         |
| `priority`                                                | `P0` through `P3`.                                   |
| `resolution_mode`                                         | One of the five modes above.                         |
| `blocks_cutover` / `blocks_record`                        | Explicit Boolean gates.                              |
| `confidence`                                              | Evidence confidence label.                           |
| `patient_ref`                                             | Restricted source reference; never committed to Git. |
| `source_locator`                                          | File ID/hash, tab, physical row and source ID.       |
| `what_we_see`                                             | Human-readable evidence summary.                     |
| `what_we_infer`                                           | Proposed disposition and named rule.                 |
| `what_we_do_not_infer`                                    | Unknown facts preserved as unknown.                  |
| `why_safe_or_blocked`                                     | Uniqueness/corroboration/conflict explanation.       |
| `human_action`                                            | Exact decision or follow-up required.                |
| `owner`                                                   | Engineering, clinic, finance or clinical role.       |
| `status`, `resolved_by`, `resolved_at`, `resolution_note` | Review audit fields.                                 |

## Cutover acceptance

A production load may start only when:

1. every `CUTOVER_BLOCKER` is closed;
2. every `RECORD_BLOCKER` is resolved or explicitly excluded with source-row
   coverage preserved;
3. `REVIEW_CONFIRMATION` items are either signed off or safely downgraded to an
   explicit unknown state;
4. every `AUTO_INFER` rule passes deterministic tests, contradiction checks and
   branch-level sample QA;
5. `FOLLOW_UP` rows are loadable as honest unknown/overdue states and have an
   owner after cutover.

The queue is an exception workflow, not a substitute for source coverage. Every
source row must still end as linked, duplicate, superseded, quarantined,
excluded-with-reason or unresolved.
