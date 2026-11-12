# Live Freeze and Local Load Trials — 2026-08-17

> **Scope:** evidence-led local development migration only. No Railway or
> production database was contacted. This log contains no patient names,
> source identifiers, or free-text remarks.

## Outcome

The live AppSheet source is now captured as a stable, chunk-hashed Drive
freeze and its parser/reconciliation path has been proven end to end. It is
suitable for disposable-local-database trials. The first eighteen real local
write trials stopped before durable clinical schedule writes; none is a
clinical-data loss event.

| Control                         | Result                                                                                                                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source stability during capture | Pass — unchanged before and after capture                                                                                                                              |
| Capture method                  | Drive range export, stored as 43 immutable chunks                                                                                                                      |
| Captured source areas           | Patient, clinical administration, transaction, remarks, and required reference/support tables                                                                          |
| Current parser/rehearsal        | Pass — all 15 expected sources usable, with zero missing sources or hash mismatches                                                                                    |
| Current reconciliation queue    | 2 P0s remain; neither is a stale/missing-source P0                                                                                                                     |
| Previous rehearsal source       | Superseded for live-write testing; it remains useful only as an older dry-run baseline                                                                                 |
| Local trial A                   | Stopped and rolled back at duplicate branch reference data                                                                                                             |
| Local trial B                   | Stopped at duplicate service-catalog reference data                                                                                                                    |
| Local trial C                   | Stopped at semantic catalog route resolution for a source-null route versus a seeded target route                                                                      |
| Local trial D                   | Superseded pre-alias run; stopped at duplicate service-catalog primary key after passing exact-code semantic checks                                                    |
| Local trial E                   | Passed branch/catalog primary-key and semantic resolution; stopped at an unresolved payer profile while preparing service prices                                       |
| Local trial F                   | Passed payer-profile resolution; stopped at a same-date service-price conflict before any patient, clinical, or financial import                                       |
| Local trial G                   | With prices and clinical schedules withheld, reached patient loading and stopped on JSON serialization; diagnostic rerun exposed non-idempotent synthetic-user mapping |
| Local trial H                   | JSONB binding passed; stopped at seeded-tenant MRN uniqueness during patient loading                                                                                   |
| Local trial I                   | Tenant MRN allocation passed; stopped on 13 implausible patient birth-date values in a rolled-back patient batch                                                       |
| Local trial J                   | All 15,736 patients committed in a disposable database; consent stage then stopped on an invalid scope-reference shape                                                 |
| Local trial K                   | Committed patients, consents, and encounters; began finance and stopped after 89 transactions on duplicate transaction-service-performer lines                         |
| Local trial L                   | Passed duplicate-line aggregation and reached payment validation; stopped where recorded paid amount disagreed with payment legs                                       |
| Local trial M                   | Passed corrected transaction-total mapping and reached financial insertion; stopped because a source payment method is absent from the target enum                     |
| Local trial N                   | Fresh schema with payment-method coverage passed prior stop; first payer-specific transaction exposed an adapter payer-reference wiring defect                         |
| Local trial O                   | Payer resolver passed; finance isolated one internally consistent negative bank-transfer sale that requires a refund link                                              |
| Local trial P                   | Standalone refund was quarantined; finance later isolated one mixed-tender overpayment with a negative cash-refund leg                                                 |
| Local trial Q                   | Completed the corrected financial stage with matching imported transaction count; stopped at a missing migration-owned tag definition                                  |
| Local trial R                   | One-pass base load completed with header/payment reconciliation; post-load analysis found transaction-item subtotals materially unsafe                                 |
| Production/Railway writes       | None                                                                                                                                                                   |

## Frozen-source evidence

The capture began and ended with the same Drive modification timestamp, so it
is a coherent source freeze rather than a mixture of edits from different
moments. Each of the 43 chunks has a recorded SHA-256 digest. The private,
PHI-bearing freeze manifest is retained outside the repository at:

`/private/tmp/surevax-live-freeze-2026-08-17/manifest.json`

Its corresponding chunk directory is also private and must never be committed.
The freeze covers the operational inputs needed for the first local load,
including patient, immunization, transaction, remarks, branch, nurse, vaccine,
bundle, charge-account, discount, cash-balance, and administrator-reference
areas. Timekeeping and inventory history remain out of the initial load scope
under the approved decisions.

The Drive-snapshot parser was then run through the normal 15-source
rehearsal. All expected snapshots were usable; none was missing and none
failed its recorded hash. The rehearsal produced 2 P0s (rather than the
older baseline's 3). This closes the former “current-freeze parser is not
proven” P0. The PHI-safe current report remains private at:

`/private/tmp/surevax-live-freeze-2026-08-17/rehearsal-report.json`

## Local database trial history

| Trial | What happened                                                                                                                                                                                                                                                                                                               | Meaning                                                                                                                                                                                                                                                                                                                      | Correct treatment                                                                                                                                                                                                                                                                                                   |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | Insert of branch reference data encountered the existing unique display identifier constraint. The branch batch rolled back.                                                                                                                                                                                                | The local database already contains authoritative seeded branch rows; the loader must not recreate them.                                                                                                                                                                                                                     | Reuse/resolve seeded branch rows by stable business key before dependent records load.                                                                                                                                                                                                                              |
| B     | After the branch-resolution change, insert of service-catalog reference data encountered the existing tenant-and-code unique constraint.                                                                                                                                                                                    | The same issue exists for seeded catalog rows. The clinical/financial event payload has not yet reached a durable target write.                                                                                                                                                                                              | Reuse/resolve seeded service-catalog rows by tenant + code, then validate the resolved IDs before prices, encounters, and financial items load.                                                                                                                                                                     |
| C     | The semantic catalog resolver reached an anti-tetanus-serum service whose source route is blank while the seeded catalog's known route is intramuscular.                                                                                                                                                                    | This is an incomplete enrichment rule, not conflicting clinical history and not a human review case. The source's null route must remain raw provenance.                                                                                                                                                                     | Patch the resolver to use the uniquely seeded target route as an inferred target enrichment when the source route is null; retain the source-null fact and record the inference.                                                                                                                                    |
| D     | The pre-alias process image advanced through exact-code semantic checks, then encountered the existing service-catalog primary key.                                                                                                                                                                                         | Its consultation and medical-certificate transforms used canonical seed codes but did not preserve the seed's physical primary-key aliases. No imported clinical or financial facts became durable.                                                                                                                          | **Superseded.** The applied catalog correction now emits the canonical seed codes while preserving the physical seed IDs for references. Judge the next trial against the patched image, not this pre-alias failure.                                                                                                |
| E     | The patched process image passed branch and catalog primary-key reuse plus semantic catalog resolution, then stopped during the service-price stage because a payer profile could not be resolved.                                                                                                                          | This is a payer/reference mapping gap before patient, clinical, or financial-import stages. It does not identify an uncertain patient record and it did not create durable imported clinical or financial facts.                                                                                                             | Investigate the legacy payer-to-target payer-profile map and seed/alias policy. Resolve it as a catalog/reference rule or withhold only the affected price entries; do not create a patient manual-reconciliation queue.                                                                                            |
| F     | After payer-profile resolution, the price writer found a genuine same-effective-date conflict for the ARV PEP HMO price: legacy source 2,200 versus seeded target 1,150.                                                                                                                                                    | This is a current/future pricing-configuration conflict, not a disputed historical transaction. The run stopped before any patient, clinical, or financial fact import.                                                                                                                                                      | Treat it as a production price-config P0. Withhold all `servicePrices` from the base-facts trial; retain transaction-item unit prices, which are historical facts. Reconcile go-live prices against the cleaned price-list source at route, brand, and payer-tier dimensions.                                       |
| G     | With service prices and clinical schedules withheld, the run passed reference/user stages and stopped in patient loading on a JSONB serialization type error. A diagnostic rerun against the same disposable database then encountered the tenant-email uniqueness constraint during user loading.                          | No imported patient, encounter, clinical, or financial fact became durable. The diagnostic failure shows earlier stages committed independently, while the user transform generated new random display IDs for the same synthetic emails. This is an importer idempotency/atomicity defect, not a source-record discrepancy. | Use a fresh disposable database for further trials. Before any production or durable import, persist migration target links and introduce a stable user crosswalk keyed by source identity/synthetic-email rule; make stage handling atomic or safely resumable.                                                    |
| H     | After the JSONB binding correction, the run reached patient loading and collided with the tenant's seeded MRN uniqueness constraint because the importer generated its own `MRN-…` sequence.                                                                                                                                | This is an implementation defect in target identifier allocation, not duplicate/ambiguous patient source history. No imported patient, encounter, or financial fact became durable.                                                                                                                                          | **Corrected.** The adapter now allocates patient MRNs from the tenant-specific database sequence. Continue fresh-database trials; do not add this to the manual patient queue. Imported legacy staff users are also forced to `canLogin=false` until an owner reviews roles and branch assignments.                 |
| I     | The corrected MRN allocation passed. Patient loading then hit the database birth-date sanity constraint on 13 implausible values; the active 500-row patient batch rolled back.                                                                                                                                             | No imported patient, encounter, or financial fact became durable. This is a bounded record-field quality issue, not a whole-patient or source-freeze failure.                                                                                                                                                                | Treat the 13 birth-date fields as P1: import each affected patient with DOB `null`, retain source provenance, and create a manual-review item. Never infer a corrected date from the malformed value.                                                                                                               |
| J     | All 15,736 imported patients committed successfully in disposable database J, with the 13 implausible DOB values withheld as `null`. The following consent stage stopped on the scope-reference-pair constraint before imported consent, encounter, or financial facts were written.                                        | Patient loading is now proven through the full frozen population. The consent payload incorrectly used a disallowed patient reference type without a reference ID. The patient rows are durable **only in disposable J**.                                                                                                    | Correct the owner-approved `legacy-import` consent to `scope='patient'`, `scopeRefType=null`, and `scopeRefId=null`. **Do not resume database J:** target links and deterministic patient IDs are not yet wired, so a resumed/repeated run is unsafe. Use a fresh database after the crosswalk/link gate is closed. |
| K     | Committed all 15,736 patients, 15,736 `legacy-import` consents, and 55,789 encounters. Finance then began: 89 imported transactions committed before one transaction graph rolled back on the transaction-item uniqueness rule for the same transaction, service, and performer.                                            | This is a target-line cardinality mismatch, not evidence that any historical financial amount is invalid. Database K is useful evidence of stage reachability only; it is not resumable.                                                                                                                                     | Aggregate duplicate transaction/service/performer lines before write, preserving the group subtotal. Mark the two mixed-unit-price groups as audit flags for later target-link review. **Do not resume database K.**                                                                                                |
| L     | After patients, consents, and encounters, duplicate-line aggregation passed far enough for the financial writer to validate payment legs. It then stopped where a recorded paid amount did not equal the sum of its payment legs.                                                                                           | This is a financial-source semantic gate: the source's transaction header and tender detail disagree. It is not a patient, clinical, or identity blocker.                                                                                                                                                                    | Preserve both raw financial observations, define an approved reconciliation/withhold rule, and retest on a fresh database. **Database L is evidence only; do not resume it.**                                                                                                                                       |
| M     | The corrected transaction-total mapping passed and financial insertion began. It then stopped because the source `PayMongo` payment method is not represented in the target payment-method enum.                                                                                                                            | This is a production schema/reference requirement, not a bad row or a manual record exception. The corrected plan already separates 41,334 safe transaction graphs from 28 quarantined graphs before load.                                                                                                                   | Add an approved target representation/mapping for the source payment method, with validation and reporting. **Database M is evidence only; do not resume it.**                                                                                                                                                      |
| N     | A fresh schema with `PayMongo`/`Other` payment-method coverage passed the prior enum stop. The first payer-specific transaction then failed because the financial writer passed its semantic payer reference instead of the seeded payer display identifier.                                                                | This is deterministic adapter wiring, not a payer ambiguity or manual transaction queue.                                                                                                                                                                                                                                     | **Corrected.** Transaction payer references now pass through `migrationPayerDisplayId`, matching service-price resolution. **Database N is evidence only; do not resume it.**                                                                                                                                       |
| O     | Payer resolution passed. Finance then isolated one internally consistent negative PHP 600 bank-transfer sale whose redacted semantics indicate a fourth-dose ARV refund.                                                                                                                                                    | The target correctly rejects a negative sale net. This is one refund-link record needing its original transaction/payment, not a global financial or patient blocker.                                                                                                                                                        | Withhold the record as P1 with code `TRANSACTION_REFUND_LINK_UNRESOLVED` until the original transaction/payment can be identified; then represent it as a linked refund rather than a negative sale. **Database O is evidence only; do not resume it.**                                                             |
| P     | The standalone negative refund was quarantined. Finance later found one sale with a positive PayMongo payment of PHP 1,700 and a negative cash leg of PHP 100 against a PHP 1,600 bill; the source remark confirms this is a cash refund of an overpayment.                                                                 | This is a one-record payment-plus-refund graph requirement, not a global financial or patient blocker. Netting down the processor payment would corrupt processor reconciliation.                                                                                                                                            | Withhold as P1 with code `TRANSACTION_NEGATIVE_PAYMENT_LEG_UNRESOLVED` until the target can represent the original payment and linked cash refund separately. **Database P is evidence only; do not resume it.**                                                                                                    |
| Q     | The corrected financial stage completed. Read-only count showed 41,361 total transactions, including 29 seed transactions, leaving 41,332 imported transactions — matching the corrected plan after quarantines. The next patient-tag stage stopped because the required tag definition was absent.                         | Financial base-fact loading is now proven at its corrected aggregate count. The remaining stop is deterministic reference data, not a patient, clinical, or financial exception.                                                                                                                                             | Seed the three migration-owned tag definitions before patient-tag load: `FULLY_PAID_PEP_COURSE`, `POTENTIAL_DUPLICATE`, and `LEGACY_NOTE_NEEDS_CLINICAL_REVIEW`. **Database Q is evidence only; do not resume it.**                                                                                                 |
| R     | The one-pass base load completed: 15,736 patients and consents, 55,789 encounters, 41,332 transactions, 55,545 items, 41,786 payments, and 127 tags. Payment legs exactly reconciled to transaction `amount_paid` (PHP 56,368,563.20). Post-load analysis then found item subtotal totals far above transaction net totals. | The trial proves header, payment, and reference-load mechanics — **not** production-safe invoice lines. Current item projection must not be promoted merely because transaction/payment totals reconcile.                                                                                                                    | Treat the transaction-item projector as a global financial P0. Withhold/rebuild items from transaction-authoritative semantics before production. **Database R is disposable evidence only.**                                                                                                                       |

Neither failure should be “fixed” by deleting seeded reference data or relaxing
database uniqueness. Those constraints are correctly exposing a source-to-
target ownership rule that the adapter must implement.

## P0s, expressed for operations

### Current report P0s — stop the affected class of write until closed

| P0                                        | Why it matters                                                                                                                                            | Closure test                                                                                                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Schedule projection is not reconciled** | The legacy plan would write 11,026 standing orders and 72,729 clinical orders from mutable current rows, which can falsely cancel or invent care history. | Do not write either schedule-derived table until the canonical ledger-to-course/slot writer is implemented and tested. A base-facts-only disposable trial is permitted. |

The two current report P0s are the schedule-write boundary above and the
Salcedo ownership slice below. The source-freeze/parser P0 is **closed**: the
current Drive rehearsal used 15 of 15 sources with zero missing snapshots and
zero hash mismatches. Seeded branch and catalog row reuse has advanced past
the unique-key stops in trials A and B. Trial C exposes the next, narrower
resolver patch: source-null route plus a uniquely known seeded route is
inferable target enrichment, not a manual clinical blocker.

The separate catalog scan also distinguishes safe aliases from entries that
must be withheld because they omit or contradict a clinically material route
or dose distinction. It is the authority for the next catalog-reuse trial.

### Global / production P0s — required before production or any resumable run, not a manual queue

| Gate                                               | Why it matters                                                                                                                                                                                                                                         | Closure test                                                                                                                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Durable target links and stable user crosswalk** | Trial G proved stage-level partial commits and a non-idempotent user transform: the same source-derived synthetic emails receive new random display IDs on retry. Without stable target links/crosswalks, a resumed or repeated run cannot be trusted. | Serialize JSONB payloads safely; persist a source-identity/synthetic-email → target-user crosswalk and target links; then prove a clean double-run creates zero net duplicate users, patients, clinical facts, or financial facts. |
| **Tenant-owned identifiers and access safety**     | Trial H showed that target-owned MRNs must come from the database's tenant sequence. Legacy staff identity is insufficient proof of an appropriate v2 login role or branch scope.                                                                      | Verify the MRN allocator uses `mrn_seq_<tenant>` in a fresh run; keep every imported legacy staff account unable to log in until owner-reviewed role/branch assignment is complete.                                                |
| **Payer-profile mapping for service prices**       | Trial E cannot safely create a price row without a target payer/profile owner. This is reference data, not patient history.                                                                                                                            | Publish a legacy-payer → target-profile mapping/alias decision; the next run resolves it or explicitly withholds only the affected service-price rows.                                                                             |
| **Payer-reference adapter consistency**            | Trial N proved that the financial writer and service-price writer must use the same seeded payer display-ID mapping.                                                                                                                                   | Verify every payer-bearing writer resolves through `migrationPayerDisplayId`; this is deterministic adapter behavior, not a manual source-data queue.                                                                              |
| **Production price configuration**                 | Trial F found a genuine same-date disagreement between a legacy HMO price and an already seeded target price. Automatically overwriting either could alter future billing behavior.                                                                    | Reconcile go-live price configuration against `Pricelist Cleaned 1Gh...`, using route, brand, and payer-tier dimensions. This is not required to import historical transaction-item unit prices in the base-facts trial.           |
| **Financial payment-leg semantics**                | Trial L found a transaction whose recorded paid amount and payment-leg total disagree. Choosing one silently would falsify historical financial evidence.                                                                                              | Define and test a reconciliation/withhold rule that preserves both source observations and isolates only affected financial groups. This is not a patient migration blocker.                                                       |
| **Payment-method reference/schema coverage**       | Trial M found a valid source payment method that has no target enum representation. Coercing it to a different tender would distort financial history and future reporting.                                                                            | Add and test an approved target payment-method representation or explicit mapping before any production financial import. This is a schema/reference requirement, not a manual row exception.                                      |
| **Migration-owned tag definitions**                | Trial Q completed corrected finance but cannot attach deterministic migration tags until their definitions exist.                                                                                                                                      | Seed `FULLY_PAID_PEP_COURSE`, `POTENTIAL_DUPLICATE`, and `LEGACY_NOTE_NEEDS_CLINICAL_REVIEW` before patient-tag load; this is reference data, not a patient queue.                                                                 |
| **Transaction-item projector**                     | Trial R proved headers and payment legs can reconcile while item subtotals materially disagree with transaction net/gross. Invoice lines would be misleading if promoted as-is.                                                                        | Withhold and rebuild transaction items from transaction-authoritative semantics; pass post-load net/gross itemization invariants before production.                                                                                |

### Quarantinable P0s — exclude the unsafe slice; continue the rest

| Slice                                                                         | Why it is not safe to infer                                                                                           | Initial-load treatment                                                                                                                                        |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Salcedo tracker months with unresolved tab ownership                          | The workbook title is only semi-authoritative; the relevant month/tab cannot yet be confidently assigned to a branch. | Exclude that tracker slice, retain its source observation, and make it a named reconciliation queue. Do not block all other branches.                         |
| Record groups with an unresolved patient reference                            | A transaction can represent multiple people or lack a resolvable patient key.                                         | Withhold only that financial group as P1; migrate independent, unambiguous records.                                                                           |
| Regimen-specific dose schedules whose clinical anchor cannot be reconstructed | Synthesizing a schedule from an ambiguous history could mark a dose as missed incorrectly.                            | Load the underlying observed administrations and external-dose facts with provenance; defer only the uncertain standing-order/schedule projection.            |
| Source-null route with exactly one seeded catalog route                       | The source omits a target enrichment rather than contradicting it.                                                    | Infer the unique seeded route, retain the null source value in provenance, and log the inference. This is a resolver patch, not a clinical manual queue item. |

### P1 record-field queue — preserve the patient, withhold only the unsafe field

| Field issue                     |              Scope | Treatment                                                                                                                                                                           |
| ------------------------------- | -----------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implausible date of birth       |  13 patient fields | Import patient with DOB `null`, retain provenance and queue review. Do not guess or normalize the date.                                                                             |
| Refund link unresolved          | 1 financial record | Withhold the negative sale and queue `TRANSACTION_REFUND_LINK_UNRESOLVED` until its original transaction/payment is identified. Do not coerce it into a negative sale.              |
| Negative payment leg unresolved | 1 financial record | Preserve the positive processor payment and withhold the linked negative cash-refund leg under `TRANSACTION_NEGATIVE_PAYMENT_LEG_UNRESOLVED`. Never net down the processor payment. |

The frozen-source aggregate has 10 DOB years at or before 1900 and 3 after the
cutoff. The year-only outliers are: 0963, 0971, 0975, 0976, 0989, 1074,
1111 (three values), 1667, 2026, 2993, and 2995. This listing intentionally
contains no patient identifiers or other row content.

### Financial-line aggregation — deterministic load rule with audit flags

The target permits one line per transaction, service, and performer. The
frozen base plan contains 375 duplicate groups spanning 1,357 legacy lines
(up to 76 lines in one group). For the base-facts trial, aggregate those to
375 target lines: 982 source lines are collapsed, quantity/subtotal are
summed, and the financial subtotal is preserved.

| Group type       | Groups | Load treatment                                                                                                               |
| ---------------- | -----: | ---------------------------------------------------------------------------------------------------------------------------- |
| Same unit price  |    373 | Sum quantity and subtotal; retain the shared unit price.                                                                     |
| Mixed unit price |      2 | Preserve subtotal; calculate a weighted unit price for target storage and attach an audit flag for later target-link review. |

This is not a manual historical-transaction queue. The two mixed-price groups
need post-load traceability/audit attention, not guessed replacement amounts.

### Trial R post-load financial caveat — items are not production-safe

The completed trial deliberately withheld 140 service prices, 11,026 standing
orders, 72,729 clinical orders, and 10 cash-balance rows. It also preserved
the 13 invalid DOBs as `null` and aggregated 982 duplicate item rows. Its
transaction headers and payment legs are internally reconciled: payment sum is
exactly PHP 56,368,563.20, equal to the imported transaction `amount_paid`.

That success does **not** validate invoice items. The current item projector
produced PHP 100,900,230 in item subtotals against PHP 56,304,865.02 in
transaction net. The following post-load distributions require a projector
rebuild before any production use:

| Comparison                             |           Exact | Item total over | Item total under | No items |
| -------------------------------------- | --------------: | --------------: | ---------------: | -------: |
| Item subtotal versus transaction net   | 12,295 / 41,332 |          27,123 |            1,914 |      432 |
| Item subtotal versus transaction gross | 13,539 / 41,332 |          25,831 |            1,962 |      432 |

The trial therefore proves base references, headers, and payments only. It
does not prove production-safe invoice lines.

**Code boundary tightened after Trial R:** future base-facts trials set
`transactionItems=[]` and report all 55,545 projected/aggregated item lines as
withheld until a transaction-authoritative item projector exists. Transaction
headers and payment legs remain loadable. This prevents the current inflated
service-line revenue from being published as invoice detail.

### Production-only P0s — not required to diagnose a local trial

| P0                                            | Required before production, not before the next disposable local trial                                               |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Clean-room rehearsal                          | Fresh target, one complete load, rollback/reset, then an identical second load with reconciled totals.               |
| Isolated Railway staging and recovery plan    | Separate database, backup/restore proof, access controls, and a written rollback decision point.                     |
| Cutover window and bounded catch-up sync      | Freeze/lock rules, source delta capture, and a stop condition for new AppSheet edits.                                |
| Clinical/finance approval of exception queues | Explicit sign-off for the remaining record-level P1/P2/P3 handling, rather than silently coercing uncertain history. |

## Next safe trial

1. Patch the semantic catalog resolver for a null source route where a single
   seeded route is known, retaining the inference/provenance boundary. Apply
   the already-completed consultation/medical-certificate physical-ID alias
   correction in the fresh process image.
2. Investigate and implement the payer-profile mapping/withhold rule exposed
   by Trial E before retrying the service-price stage.
3. Repair the JSONB serialization boundary and implement the stable user
   crosswalk/target-link path exposed by Trial G. Do not reuse its disposable
   database.
4. Verify the tenant-sequence MRN allocator and the `canLogin=false` imported
   staff boundary in the next fresh trial.
5. Patch patient loading to turn only the 13 implausible DOBs into `null` plus
   provenance/manual P1 records; do not infer corrected dates.
6. Correct the `legacy-import` consent scope reference to the owner-approved
   patient-scoped, null-reference shape; do not resume disposable database J.
7. Apply the duplicate transaction/service/performer aggregation before the
   financial writer; preserve subtotals and attach audit flags to the two
   mixed-price groups. Do not resume disposable database K.
8. Define the payment-header versus payment-leg reconciliation/withhold rule
   exposed by Trial L, preserving both raw observations. Do not resume
   database L.
9. Add the approved target representation/mapping for the source payment
   method exposed by Trial M; validate it against the payment-leg semantics.
   Do not resume database M.
10. Verify the corrected transaction payer-reference path uses
    `migrationPayerDisplayId`, consistent with service prices; do not resume
    database N.
11. Reconcile the one P1 refund against its original transaction/payment; keep
    it withheld as `TRANSACTION_REFUND_LINK_UNRESOLVED` until linked. Do not
    resume database O.
12. Design/approve the linked payment-plus-refund graph for the one negative
    payment leg; preserve the processor payment and do not resume database P.
13. Seed the three migration-owned tag definitions exposed by Trial Q; do not
    resume database Q.
14. Withhold and rebuild the transaction-item projector from transaction-
    authoritative semantics, then require post-load item/net/gross invariants
    to pass. Database R is evidence only.
15. Run the next fresh base-facts-only trial with `servicePrices` entirely
    withheld. Keep historical transaction-item unit prices loadable.
16. Persist the run ledger and target links, then immediately rerun against the
    same database to expose duplicate/atomicity defects.
17. Keep Salcedo-ownership and schedule-projection exceptions quarantined; they
    are not a reason to stall the rest of the exploratory local load.
18. Before go-live, reconcile the current service-price configuration with
    `Pricelist Cleaned 1Gh...` at route, brand, and payer-tier level.

## Related evidence

- Earlier all-source dry-run baseline:
  [`2026-08-17-local-rehearsal-start.md`](2026-08-17-local-rehearsal-start.md)
- Current source roster and authority rules:
  [`../SOURCE-MANIFEST.md`](../SOURCE-MANIFEST.md)
- Exception handling and inference ladder:
  [`../INFERENCE-AND-MANUAL-REVIEW-POLICY.md`](../INFERENCE-AND-MANUAL-REVIEW-POLICY.md)
- Live-freeze schedule boundary and base-facts-only rule:
  [`../SCHEDULE-SEMANTICS-2026-08-17.md`](../SCHEDULE-SEMANTICS-2026-08-17.md)
- Payment-header/leg reconciliation and safe-graph boundary:
  [`../PAYMENT-LEG-SEMANTICS-2026-08-17.md`](../PAYMENT-LEG-SEMANTICS-2026-08-17.md)
- Catalog alias, safe-enrichment, and withhold scan:
  [`2026-08-17-catalog-semantic-scan.md`](2026-08-17-catalog-semantic-scan.md)
