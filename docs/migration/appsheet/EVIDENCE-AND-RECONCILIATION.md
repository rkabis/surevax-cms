# AppSheet Migration Evidence and Reconciliation Model

> **Effective:** 2026-08-16
> **Supersedes:** any design assumption that the latest `Immunization` sheet is
> an immutable clinical history or that a past planned row is automatically a
> cancellation.

## Executive rule

**Purchase, payment, schedule, and administration are separate facts.** No
single source is authoritative for all four.

The migration must first preserve immutable source observations, then reconcile
them into canonical events, and only then write v2 transactions, items,
payments, standing orders, and clinical orders.

```text
AppSheet Transactions ─┐
Manual Sales Trackers ─┼─> source observations ─> canonical event ledger
Immunization rows ─────┤                              │
Remarks / HMO / CA ────┘                              ├─> deterministic links
                                                     ├─> review exceptions
                                                     └─> v2 load plan
```

## Evidence authority by fact

| Fact                    | Strongest source                                                                      | Corroboration                           | Prohibited inference               |
| ----------------------- | ------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------- |
| Sale header and tender  | AppSheet `Transactions`                                                               | clinic sales row, invoice/money tracker | paid flag on an immunization alone |
| Purchased service/dose  | explicit transaction references, including dangling IDs                               | tracker service bundle                  | administration means payment       |
| Internal administration | selected clinic-ledger row or credible administered state plus actual date/source row | clinical remark, invoice/HMO evidence   | payment alone                      |
| External administration | explicit facility/card/transfer/prior-dose note, or E33 after remarks-first check     | first local row being ARV 2+            | AppSheet `Migration` marker alone  |
| Payer and settlement    | transaction payer/tender plus ChargeAccounts/HMO evidence                             | tracker payment field                   | dose status                        |
| Regimen schedule        | canonical regimen plus confirmed sequence/anchor                                      | current planned rows                    | payment date alone                 |

`Transactions` is the ideal financial source, not a complete clinical source.
`Immunization` is a mutable current-state source, not a deletion-proof event
log. Under E29, a normal row from the selected clinic ledger proves the branch
visit, listed service and administration unless an attributable remark says it
was a deposit, future/not-yet-administered dose, refusal or cancellation. Its
patient must still resolve uniquely; copied/ownerless tabs remain quarantined.

## Canonical event types

| Event                                   | Meaning                                                      |
| --------------------------------------- | ------------------------------------------------------------ |
| `TRANSACTION_SALE`                      | bill/receipt header                                          |
| `DOSE_PURCHASE`                         | purchased service entitlement, one per billable dose/service |
| `PAYMENT`                               | tender leg and amount                                        |
| `PAYER_OBLIGATION` / `PAYER_SETTLEMENT` | HMO/corporate obligation and settlement evidence             |
| `DOSE_SLOT`                             | expected regimen position, independent of purchase/admin     |
| `DOSE_ADMINISTRATION`                   | confirmed internal administration                            |
| `EXTERNAL_DOSE_ADMINISTRATION`          | explicitly supported prior/external administration           |
| `NOTE`                                  | context that must remain attributable to a source row        |
| `SOURCE_ROW_DISAPPEARED`                | row present in an older snapshot but absent later            |
| `SOURCE_ROW_RECREATED_CANDIDATE`        | new source ID may represent the same logical event           |

Every event-evidence link must record the named matching rule and disposition:
`asserts`, `supports`, `contradicts`, `supersedes`, or `derived_from`.

## Multi-dose payment semantics

A paid four-dose PEP course is not an itemless patient-credit deposit:

1. Create one normal transaction header (`is_prepayment=false`).
2. Create one transaction item for each purchased dose/service.
3. Link each item to a canonical dose slot when determinable.
4. Mark only supported administrations `Completed`.
5. Keep remaining dose slots `Scheduled`; due/overdue is derived.

`transactions.is_prepayment=true` is reserved for an **unallocated, itemless
patient-credit deposit**. This supersedes the older R11 wording that set the
header flag for a course already allocated to future services. Historical
course items may still carry their explicit dose-slot and purchase lineage.

## Deleted and recreated immunizations

Nurses can delete an immunization and create another with the same visible
details. Therefore:

1. A transaction reference to an absent immunization ID is positive evidence
   that a referenced row existed; never silently discard the purchased item.
2. A row missing from the latest export is not, by itself, a cancellation,
   non-administration, or deletion tombstone.
3. Across snapshots, present-before/absent-after creates
   `SOURCE_ROW_DISAPPEARED`.
4. A new ID with compatible patient, branch, service, route, dose position and
   date creates `SOURCE_ROW_RECREATED_CANDIDATE`.
5. Preserve both source observations. Merge them only when the evidence is
   unique and non-conflicting.
6. Conflicting actual date, brand, route, site, facility, or payment lineage
   creates `SAME_SLOT_CONFLICT` rather than an automatic merge.

## Matching policy

The priority, resolution modes, human-readable assumption format and explicit
boundary between automatic decisions and genuine manual work are defined in
[`INFERENCE-AND-MANUAL-REVIEW-POLICY.md`](INFERENCE-AND-MANUAL-REVIEW-POLICY.md).

### Automatic links, in priority order

1. Exact AppSheet row/cross-reference IDs.
2. Forward `t_ImmunizationRef` and inverse `i_TransactionRef`, unioned.
3. Exact stable patient source ID.
4. Exact unique payment/reference number with compatible branch.
5. Exact patient + branch + service + date + amount, only when unique on both
   sides.

### Candidate-only links

- name + date + amount without stable patient identity;
- fuzzy spelling/suffix matches;
- tracker rows whose patient/event identity is not uniquely resolved;
- same dose position with conflicting clinical facts;
- recreated IDs matched only by visible details;
- same patient/date/service rows that may be duplicates or separately billed
  components.

Manual tracker names must first resolve to a unique AppSheet patient using
available DOB/contact evidence. Ambiguous people remain unresolved.

## Tracker normalisation

1. Parse by normalised header names, not fixed column positions. Aguirre has a
   shifted schema with a separate medical-service column.
2. Preserve raw text before tokenisation.
3. Group same-patient/date rows into a visit candidate.
4. Explode bundled values such as `ARV 1, TT, ERIG, CONSULTATION` into atomic
   service candidates while creating no more than one ARV dose event for that
   visit.
5. Treat exact duplicate ARV rows as duplicate candidates, never as two ID
   administration sites.
6. Quarantine malformed years/serials rather than guessing corrections.
7. Exclude copied sheets listed in [`SOURCE-MANIFEST.md`](SOURCE-MANIFEST.md)
   until ownership is adjudicated.

## External starts and missed doses

A first internal record of ARV 2, ARV 3, or later does not establish that the
earlier dose was missed.

| Evidence state                                                     | Canonical interpretation                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------- |
| explicit outside facility/card/date                                | external administration                                  |
| prior dose/date known, facility unknown                            | external administration with unresolved facility         |
| local sequence starts at ARV 2+; remarks checked; no contradiction | owner-approved external dose 1; clinical details unknown |
| local sequence starts at ARV 2+ with a contrary/competing remark   | P1 same-slot/course conflict; no inferred dose           |
| earlier dose purchased but no administration evidence              | purchased, not confirmed administered                    |
| expected internal slot passed its due date without administration  | overdue/missed candidate                                 |
| planned row disappeared                                            | unresolved; not cancelled or completed automatically     |

Past planned/unadministered rows remain scheduled canonical slots. “Due” and
“overdue/missed” are derived relative to the manifest cutoff. `Cancelled`
requires explicit cancellation evidence.

## Exception taxonomy

| Code                               | Meaning                                                   |
| ---------------------------------- | --------------------------------------------------------- |
| `MISSING_REFERENCED_IMMUNIZATION`  | transaction references no current row                     |
| `SOURCE_ROW_DISAPPEARED`           | older snapshot row absent later                           |
| `RECREATED_IMMUNIZATION_CANDIDATE` | new ID may replace deleted row                            |
| `PURCHASE_WITHOUT_ADMINISTRATION`  | paid item has no supported administration                 |
| `ADMINISTRATION_WITHOUT_PURCHASE`  | administration has no identified financial source         |
| `TRACKER_ONLY_SALE`                | clinic tracker row has no deterministic AppSheet match    |
| `SAME_SLOT_CONFLICT`               | conflicting facts for one regimen slot                    |
| `POSSIBLE_DUPLICATE_PURCHASE`      | two bill lines may buy the same entitlement               |
| `UNALLOCATED_COURSE_PAYMENT`       | money cannot yet be allocated to dose items               |
| `AMBIGUOUS_PATIENT_MATCH`          | source name resolves to multiple/no patients              |
| `EXTERNAL_DOSE_NEEDS_VERIFICATION` | prior/external claim conflicts with attributable evidence |
| `ASSUMED_EXTERNAL_MISSING_DOSE_1`  | owner-rule external dose 1 after remarks-first check      |
| `MALFORMED_SERVICE_DATE`           | tracker date cannot be accepted automatically             |
| `COPIED_SHEET_BRANCH_UNKNOWN`      | copied tab has no established branch owner                |

No exception is silently dropped. Every source row must end as linked,
duplicate, superseded, quarantined, or unresolved.

## Provenance requirements

At minimum, the staging/reconciliation output must retain:

- migration run ID and importer commit/version;
- source kind, Drive file ID, export SHA-256 and cutoff;
- sheet name, physical row number, source row ID and content hash;
- canonical event ID and named match rule;
- target entity/display ID after load;
- exception and resolution state, resolver and timestamp.

Whether these are permanent tenant-scoped migration tables or immutable
external run artifacts remains an implementation decision. The evidence itself
is non-optional.

## Required reports before cutover

1. **Source coverage:** disposition for every source row.
2. **Financial reconciliation:** header, item, tender and payer residuals.
3. **Purchase/admin matrix:** purchased, scheduled, internal administration,
   external administration and unresolved state per dose slot.
4. **Disappearance/recreation report:** old/new source IDs and conflicts.
5. **Duplicate/conflict report:** exact and candidate duplicates.
6. **Dose schedule:** expected slots with completed/due/overdue disposition.
7. **Manifest report:** all file IDs, hashes, cutoffs and importer version.
8. **Post-load invariants:** no silent drops; tenant/RLS/audit/soft-delete
   requirements verified.

## Code deltas already confirmed

| Current behavior                                                          | Required change                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| missing referenced immunization is skipped in `transform/transactions.ts` | emit unresolved purchased item + exception                                      |
| `clinicalOrders.ts` builds directly from current immunization rows        | build from canonical dose slots and evidence                                    |
| past unadministered row becomes `Cancelled`                               | retain scheduled slot; derive due/overdue                                       |
| AppSheet `Migration` marker implies outside clinic                        | ignore marker alone; use explicit evidence or E33's remarks-checked dose-1 rule |
| `i_DosageCount` used as quantity and sequence                             | separate quantity from dose position; parse sequence from label/evidence        |
| tracker files unsupported                                                 | add source-manifest driven tracker extraction                                   |
| only first ChargeAccounts row retained                                    | preserve all observations and reconcile                                         |
| warnings use row `0`                                                      | preserve true file/sheet/row provenance                                         |

## Cutover gate

Production loading is blocked until:

- the 14-branch source manifest is signed off;
- copied-sheet ownership is resolved or those rows are excluded;
- no referenced purchase item is silently discarded;
- completed doses have administration evidence;
- overdue is distinguishable from cancelled;
- every ambiguous patient/date/duplicate is resolved or explicitly accepted;
- financial and per-dose reconciliation reports are signed off;
- a dry run against the target schema passes RLS, audit and idempotency checks.
