# Trials V/W — Restart-Safe Full Defensible Local Migration

Date: 2026-08-18 (Asia/Manila)

## Executive result

The frozen AppSheet/tracker pack now migrates into disposable local PostgreSQL
with durable run/event/target links. Trial V proved staged resume and clean
reruns. Trial W proved a fresh seed-only database can reach the same final
state, survive a real mid-run invariant stop, resume safely, and then rerun with
zero additional domain rows.

This is not a production or Railway cutover. Both databases are disposable
local evidence.

## Frozen source and targets

| Control                   | Value                                                              |
| ------------------------- | ------------------------------------------------------------------ |
| Source pack hash          | `f98e9ad1afa76bc13b9d2f9fad8560a0143c31b152154ea67d9e705b03c2b202` |
| AppSheet snapshot SHA-256 | `204319813d9d393db0cb604b4912bc4fab3b4505378a3881b2d169d60b1d1340` |
| Cutoff                    | 2026-08-16                                                         |
| Trial V                   | `surevax_migration_trial_20260818_v`                               |
| Trial W                   | `surevax_migration_trial_20260818_w`                               |
| Trial W fingerprint       | `dd42ba4a6485a7f08a50b806c5e73d56ae077a3e64f408876a0a0867530f7b18` |
| Trial W app role          | `surevax_app`, neither superuser nor `BYPASSRLS`                   |
| Final linked targets      | 265,106                                                            |

## Final migrated domain facts

| Domain class                      | Linked migrated rows | Meaning                                                       |
| --------------------------------- | -------------------: | ------------------------------------------------------------- |
| Branch identities                 |                   16 | Seed rows reused; no duplicate branch rows                    |
| Disabled legacy staff identities  |                  116 | Identity/history only; no imported account may log in         |
| Products / services / eligibility |         32 / 51 / 75 | Seed-compatible deterministic resolution                      |
| Patients                          |               15,736 | 13 implausible DOB fields withheld as null                    |
| Migration consents                |               15,736 | Owner-approved `legacy-import`, not historic consent evidence |
| Encounters                        |               56,078 | 55,789 AppSheet + 289 deterministic tracker-backed encounters |
| Rabies courses                    |               12,684 | Canonical standing orders, not the unsafe legacy transform    |
| Clinical orders                   |               71,417 | 60,968 Completed; 6,684 Scheduled; 3,765 Missed               |
| Unknown-date external completions |                1,883 | Truthful `completed_at_unknown`; no fabricated date           |
| Transaction headers               |               41,332 | Transaction sheet is financial authority                      |
| Payment legs                      |               41,786 | PHP 56,368,563.20; exactly equals imported `amount_paid`      |
| Exact invoice lines               |               51,706 | 39,113 itemized transactions; each exactly equals gross       |
| Patient tags                      |                  127 | Migration-owned definitions resolved                          |

The exact-item aggregate is PHP 51,387,000.00 on both sides of the
item-subtotal-versus-transaction-gross check. All 39,113 itemized transactions
match; zero differ.

## Clinical projection rules actually applied

- Regimen/route/course membership comes from reconciled source observations,
  not purchases.
- Local and uniquely matched tracker-only administrations are completed facts.
- Approved E33 external dose 1 may be completed with its date explicitly
  unknown after remarks review.
- Only unique explicit plans and safe trailing template slots are created.
  Interior gaps are never synthesized.
- A slot becomes `Missed` at Manila Day 31 only when E43 finds no attributable
  remark, reschedule, cancellation, refusal, deferral, duplicate/recreated-row
  conflict, or later-dose ambiguity.
- `Missed` never means treatment is cancelled or proves no outside-clinic care.
- One legacy intradermal row remains one two-site visit; it is not doubled into
  two administered facts to match site-level target template items.

## Clinical evidence retained but not coerced

| Exception class                                 |                          Count | Treatment                                                              |
| ----------------------------------------------- | -----------------------------: | ---------------------------------------------------------------------- |
| Interior dose positions absent                  | 3,312 positions / 2,292 blocks | Observed doses migrate; missing interior rows are not invented         |
| Duplicate slot observations                     |          646 rows / 317 blocks | Conflicting slot withheld; independent facts may remain ad hoc history |
| Unplaceable/non-numeric dose rows               |        1,844 rows / 999 blocks | No guessed position                                                    |
| Dose beyond selected regimen                    |                             42 | Manual clinical review                                                 |
| Administered source row missing canonical event |                             44 | Evidence retained; no unsupported completion                           |
| E43 guard blocked auto-missed                   |                          5,172 | Remains Scheduled/overdue                                              |
| Invalid/out-of-cutoff clinical event dates      |                             71 | Evidence retained; target date withheld                                |
| Conflicting canonical event IDs                 |                              2 | Both versions withheld                                                 |
| External D1 not assigned to one course          |                             19 | Evidence retained; no orphan completion                                |

## Invoice-detail boundary

Legacy `i_DosageCount` is a dose-in-series number, not invoice quantity. Each
transaction-linked immunization is one purchased unit. A grouped service item
set is admitted only when it exactly equals transaction gross.

| Item disposition                                 |  Count |
| ------------------------------------------------ | -----: |
| Source item observations considered              | 56,527 |
| Exact target item rows                           | 51,706 |
| Transactions with exact itemization              | 39,113 |
| Transactions with no source item link            |    431 |
| Transactions with mismatched detail withheld     |  1,788 |
| Source observations in those mismatches          |  4,063 |
| Mixed-price groups admitted by weighted snapshot |      1 |

No proportional scaling, balancing `Other` service, or invented quantity is
used. Mismatches retain their authoritative header/payment facts.

## Real breaks found and corrected

1. Different stable facts could collide in a 40-bit public ID. Allocation now
   uses a reproducible nonce; duplicate stable keys still fail.
2. Repeated canonical tracker event IDs merge only byte-equivalent facts and
   evidence. Differing clinical facts are withheld.
3. A source year `22025` is blocked by the 1900-to-cutoff date boundary.
4. Clinical-order provenance now uses the safe JSONB serializer.
5. Historical D2 branch invariant: live logic rejected a transaction whose own
   branch differed from the patient's latest administration branch. A
   transaction-local bypass now requires both `app.migration_import=true` and
   platform-admin context. Normal application writes remain blocked by D2.

## Restart and rerun proof

- Trial V completed separate base, clinical, item and attendance-ready scopes;
  every immediate scope rerun inserted zero rows.
- Trial W began from a freshly deployed/seeded database. It stopped at D2 after
  prior batches committed, resumed the same frozen run through target links,
  completed, and reran the full scope.
- Trial W's final rerun inserted zero rows in every domain class and skipped
  the exact planned counts: 15,736 patients, 56,078 encounters, 12,684 courses,
  71,417 clinical orders, 41,332 transactions, 51,706 items, and 41,786 payments.

## Intentionally not written

| Data                                  | Reason                                                                                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 140 source service prices             | Go-live configuration conflicts with seeded/cleaned price evidence; historical prices live on exact items                                                      |
| 10 cash-balance rows                  | No trustworthy cashier/session owner                                                                                                                           |
| Attendance                            | Frozen Drive snapshot contains zero TimeLog/NurseShift rows. Union/dedupe code exists; the secondary XLSX did not complete in the approved spreadsheet runtime |
| Bite incident/follow-up domain rows   | Raw animal status and human first-ARV date are preserved, but mandatory species, vaccination status, exposure category and bite site are absent                |
| Inventory history                     | Owner-approved D1 exclusion; use a controlled opening physical count                                                                                           |
| Branch reports / immunization bundles | Derived or already fanned-out evidence, not independent target facts                                                                                           |
| Salcedo copied/hidden tracker tabs    | Ownership is not approved; quarantined without blocking other branches                                                                                         |

## Remaining production gates

1. Protect/rematerialize the temporary chunks as a signed production source
   pack and implement bounded catch-up sync.
2. Approve legacy staff roles and branch memberships before enabling login.
3. Reconcile current price configuration from the cleaned price list.
4. Resolve the old `surevax_db` patient/history dedupe queue.
5. Review the clinical and 1,788 invoice-detail exception queues.
6. Establish opening inventory and cashier-owned drawer balances.
7. Provision isolated production and prove backup/restore, rollback, RLS,
   audit, and acceptance checks. No Railway write occurred here.
