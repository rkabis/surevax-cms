# Dose-Label Repair Check — 2026-08-23

## Purpose

Test whether some pending rabies dose gaps are not missing administrations at
all, but existing administered and paid rows carrying the wrong dose number.
This is a label-repair investigation, not authority to create another dose or
mutate the AppSheet source.

## Sources and freshness

- Broad pattern scan: the 2026-08-15 local AppSheet export with 15,697 patient,
  76,344 immunization, 41,274 transaction and 7,776 remark rows.
- Current-live verification: native `surevax_gsheet_db` on 2026-08-23 with
  15,983 patient, 77,899 immunization, 41,942 transaction and 7,983 remark grid
  rows.
- The source continued to grow after the local export. Counts below are a
  diagnostic candidate set, not a final frozen-cutover count.

The current-live pass re-read complete patient immunization histories for the
selected cases, both halves of the Immunization patient-reference column,
their candidate rows, linked transactions and relevant remarks. It did not
write to the Sheet.

## Result

The broad scan found 15 cases where an administered, paid row lands exactly on
the reconstructed next-slot date but repeats the preceding dose label. Eight
of the strongest cases were then re-read against the current live Sheet.

| Current-live result                                                            | Count | Disposition                                 |
| ------------------------------------------------------------------------------ | ----: | ------------------------------------------- |
| Clean direct transaction-backed label repair                                   |     5 | Owner-review for existing-event re-slotting |
| Clean label repair with an exact mixed-bill decomposition                      |     1 | Owner-review for existing-event re-slotting |
| Likely repair, but the course also has stale planned duplicates                |     1 | Manual course review before repair          |
| Likely repair, but the course has another administered duplicate               |     1 | Manual course review before repair          |
| Remaining broad-export duplicate-label candidates not yet current-live re-read |     7 | Do not approve yet                          |

The six clean cases consist of:

- two PEP-ID rows labelled dose 2 on the exact dose-3 day, with the expected
  earlier dose and later dose 4 in sequence; and
- four PEP-IM rows labelled dose 4 on the exact dose-5 day, after the expected
  earlier sequence.

Five have a unique fully paid transaction equal to the established dose price.
The sixth has a fully paid mixed bill whose two already-linked administered
rows decompose exactly into ARV plus tetanus with zero residual. Because the
administrations already exist, this supports correcting the ARV row's slot; it
does not invoke E44 to manufacture another administration from a mixed bill.

## Safe repair rule proposed for owner approval

A row may enter the high-priority label-repair queue only when all of these are
true:

1. the source row itself is administered and has an actual date;
2. it is marked paid and has an attributable transaction pointer;
3. its actual date equals the reconstructed date of the missing slot;
4. it repeats the preceding dose label, or otherwise forms one unambiguous
   one-slot numbering error;
5. course kind, route, price and surrounding chronology are compatible;
6. a fully paid transaction corroborates the row, either as a unique exact
   per-dose bill or an exact decomposition across existing linked services;
7. no attributable remark or row establishes a new exposure, restart,
   refusal, missed administration or other contradictory course boundary; and
8. the current live ledger contains no already-administered event in the
   proposed target slot.

Applying this rule moves the existing canonical administration to the correct
slot. It never creates a second administration. Preserve the original source
label, row ID, proposed corrected slot, rule version, approver and approval
time in the migration ledger.

## Important false-positive boundary

The broad date scan produced hundreds of weak signals. Most are not repair
candidates: an earlier label can coincide with a reconstructed date because
the anchor is incomplete, a course changed, or a terminal dose has no later
continuity. Do not place all exact-date coincidences into the nurse queue.

One live PrEP-labelled course has administered and paid dates following a
0/3/7 pattern. The patient record itself says `Prevention (PREP)`, so this
cannot be silently relabelled as PEP. It may represent an actual scheduling
deviation rather than a data-label error and belongs in a clinical-protocol
review queue.

## Cutover handling

- Put the six clean cases at the top of the owner label-repair queue.
- Keep the two complex cases immediately below them with their whole-course
  timeline visible.
- Current-live re-read the remaining seven duplicate-label candidates before
  approval.
- Recompute every count from the final frozen pack and deduplicate by
  patient/course/route/slot/date before loading.
- Do not edit the legacy Sheet. Record the correction as a provenance-bearing
  canonical migration disposition.
