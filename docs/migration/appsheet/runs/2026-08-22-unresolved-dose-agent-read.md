# Unresolved Later-Dose Agent Read — 2026-08-22

## Purpose

Three independent read-only Terra investigations tested whether missing rabies
dose positions 2 or later can be inferred from the mutable AppSheet
`Immunization` sheet, clinic Manual Sales trackers, current transactions, or an
accessible historical database copy.

The reports and restricted worklists used during analysis remained under
`/private/tmp`. This committed note contains no patient names, source patient
IDs, raw remarks, transaction IDs, or source row IDs.

## Source-state warning

The live AppSheet database changed during the investigation. The three agents
also applied slightly different preprocessing boundaries, so their raw D2+
structural-gap counts were 1,086, 1,103, and 1,119. These are diagnostic counts,
not a final cutover queue. The final count must be recomputed once from one
frozen AppSheet-plus-trackers pack using the unified resolver.

## Consolidated result

There is no defensible bulk rule that a later numbered dose proves an absent
earlier dose was administered or that nurses merely renumbered/deleted it.

| Finding                                                                                                  | Count | Disposition                                                                           |
| -------------------------------------------------------------------------------------------------------- | ----: | ------------------------------------------------------------------------------------- |
| Strict net-new tracker-backed local PEP D2 administrations                                               |     5 | Create append-only local administration events after frozen-run deduplication         |
| Later administered row dated exactly on the reconstructed missing-slot date                              |     2 | Owner-review as a possible source-label repair; do not create a second administration |
| Exact historical rows for a current structural gap                                                       |     4 | All were unadministered planned rows; schedule provenance only                        |
| Historical administered rows proving a deleted/recreated D2+ administration                              |     0 | No broad historical-row completion rule                                               |
| Strict transaction case with an additional stale historical pointer and matching historical listed price |     1 | Eligible under E44 after deduplication; the historical row adds provenance            |
| Similar stale-pointer transaction with a price conflict                                                  |     1 | Manual financial/clinical allocation review                                           |
| Current transaction forward references to absent Immunization IDs                                        |   122 | Dangling reference alone is not administration evidence                               |
| Current Immunization references to absent transaction IDs                                                |    72 | Data-integrity exception, not a missing-dose proof                                    |

The clinical read found that 1,005 of its residual positions had a later row
marked administered, but only two later rows landed exactly on the missing
slot's reconstructed date and none landed within one calendar day. The dominant
pattern is therefore later-dose evidence without independent proof of the
missing administration.

## Tracker findings

The five accepted tracker rows were all PEP dose 2 and came from five different
approved workbook-title branches. Each met the existing E28/E29/E31 rules:

- unique patient/course match;
- exact expected date;
- compatible ARV route and printed dose;
- approved workbook-title branch;
- normal administration-shaped tracker row; and
- no attributable contrary remark.

They did not overlap a clean standalone transaction proof in the tracker
agent's run. No fuzzy or name-only match was accepted.

Coverage gaps remain material: 264 raw positions fell outside their origin
tracker's selected coverage window; Sta Mesa's selected live tab returned no
usable rows; and Salcedo history remains quarantined outside the approved
August tab. Absence from these trackers is not negative evidence.

## Historical and revision findings

The September 2025 database copy was the only usable long-range historical
clinical snapshot. Four disappeared rows matched a current structural gap on
patient, indication, route, dose, and expected date, but all four were planned
and unadministered with no actual administration date.

The Drive revision API exposed only the current revision during this read. The
September copy predates much of the live database, so failure to find an older
row cannot prove non-administration. It only prevents a broad deletion rule.

## Approved and recommended rules

1. Apply E44 only when the transaction is unique for the patient and expected
   day, fully paid, equal to the established per-dose series price, not an
   advance/package/deposit/refund/mixed-service sale, and not already allocated
   to another immunization.
2. A selected clinic tracker may establish local administration only through
   E28/E29/E31's unique multi-field rule and contradiction check.
3. An older unadministered row may establish that a schedule slot existed, but
   never that the dose was completed.
4. A dangling current or historical ID alone proves only a source reference
   existed.
5. A later administered label alone proves course continuation, not the missing
   earlier administration.
6. The two exact-date relabel candidates require owner review. If approved,
   move the existing canonical event to the corrected slot while retaining the
   original label and repair provenance; never create an additional dose.
7. Every remaining position keeps its inferred schedule date and an explicit
   unresolved/completion-unknown disposition. It is not automatically
   Completed or Missed.

## Cutover action

Re-run this analysis against the final frozen pack, merge the tracker,
transaction, remark, alternate-route, unnumbered-row, and historical evidence
into one canonical event ledger, and deduplicate by patient/course/dose/date
before generating augmentations or the manual queue.
