# Trial T — Fresh Local Base-Facts Load — 2026-08-18

> **Scope:** one disposable local PostgreSQL rehearsal only. No Railway or
> production database was contacted. This note contains no patient names,
> source identifiers, contact details, free-text remarks, or raw rows.

## Outcome

The strict base-facts boundary completed successfully against a new local
database. It proves that the frozen pack can load source-authoritative
references, patient identities, migration consents, encounters, transaction
headers, payment legs, and patient tags in one pass.

It does **not** make the import restart-safe or production-ready. The target
`migration.runs` and `migration.target_links` tables remained empty because the
current loader has not yet been wired to the migration control plane. Do not
rerun this database; a second load could duplicate records.

## Controlled target and source

| Control                     | Result                                                                  |
| --------------------------- | ----------------------------------------------------------------------- |
| Effective database          | `surevax_migration_trial_20260818_t`                                    |
| Database class              | Fresh, disposable localhost PostgreSQL database                         |
| Database fingerprint        | `fd0cc4610199d91f1ca0cb26204d74f66fefe391afc581557ec81a2399936230`      |
| Runtime role                | RLS-constrained application role; not superuser and does not bypass RLS |
| Source capture              | Existing 43-chunk Drive snapshot, hash-checked before load              |
| AppSheet snapshot hash      | `204319813d9d393db0cb604b4912bc4fab3b4505378a3881b2d169d60b1d1340`      |
| Rehearsal source-pack hash  | `f98e9ad1afa76bc13b9d2f9fad8560a0143c31b152154ea67d9e705b03c2b202`      |
| Cutoff                      | 2026-08-16, Asia/Manila                                                 |
| Railway / production access | None                                                                    |

The run used the repository migration deployment and seed baseline, then the
read-only preflight. The preflight confirmed all required migration-control
relations, the Drizzle journal, and support for `DiedUnknownCause` animal
outcomes before the import started.

## Imported and intentionally withheld rows

| Target group            |                                                   Inserted | Treatment                                                                                        |
| ----------------------- | ---------------------------------------------------------: | ------------------------------------------------------------------------------------------------ |
| Branch/reference rows   | 16 branches; 32 products; 51 services; 75 eligibility rows | Loaded for the base-facts target graph.                                                          |
| Legacy staff identities |                                                  116 users | Loaded with `canLogin=false`; access approval remains separate.                                  |
| Patients                |                                                     15,736 | Loaded; 13 implausible DOB fields were set to `null`, never guessed.                             |
| Migration consents      |                                                     15,736 | Loaded using the approved legacy-import consent shape.                                           |
| Encounters              |                                                     55,789 | Loaded.                                                                                          |
| Transaction headers     |                                                     41,332 | Loaded from the safe financial graph.                                                            |
| Payment legs            |                                                     41,786 | Loaded.                                                                                          |
| Patient tags            |                                                        127 | Loaded.                                                                                          |
| Service prices          |                                                          0 | Withheld; 140 proposed rows remain a go-live pricing/configuration issue.                        |
| Transaction items       |                                                          0 | Withheld; 55,545 projected items remain unsafe until transaction-constrained itemization exists. |
| Patient standing orders |                                                          0 | Withheld; 11,026 legacy projections are not the canonical schedule writer.                       |
| Clinical orders         |                                                          0 | Withheld; 72,729 legacy projections are not the canonical schedule writer.                       |
| Staff time logs         |                                                          0 | Withheld; attendance is out of this cutover slice.                                               |
| Cash-drawer sessions    |                                                          0 | Withheld; 10 historical balance rows lack safe cashier/session attribution.                      |

## Post-load invariants

| Check                                                          | Result                                                               |
| -------------------------------------------------------------- | -------------------------------------------------------------------- |
| Imported payment legs equal imported transaction `amount_paid` | Pass — PHP 56,368,563.20 on each side; delta PHP 0.00.               |
| Unsafe invoice items written                                   | Pass — zero migration-created item rows.                             |
| Unsafe schedule/clinical rows written                          | Pass — zero migration-created standing-order or clinical-order rows. |
| Attendance written                                             | Pass — zero migration-created staff time logs.                       |
| Current price configuration written                            | Pass — zero migration-created service-price rows.                    |
| Durable migration run recorded                                 | **Fail / not yet implemented** — zero `migration.runs` rows.         |
| Durable source-to-target links recorded                        | **Fail / not yet implemented** — zero `migration.target_links` rows. |

The first remaining invariant is therefore not a malformed source record: it
is the known restart-safety P0. The clean completed pass must be treated as
disposable evidence only. It cannot be used for a retry, production cutover,
or catch-up sync until the migration ledger and stable crosswalk/target-link
writer are connected and a clean double-run proves zero net duplicates.

## Execution note

An earlier database named `surevax_migration_trial_20260818_s` was invalidated
before this result because overlapping local runner attempts were discovered
during tool-session diagnostics. Its active session was terminated and it was
not resumed. That attempt is not used as migration evidence. Trial T above ran
as one controlled process from a fresh seeded baseline.

No importer code was changed for this trial. The failed package-script form
included an extra argument separator before any database write; the successful
run invoked the existing runner directly with the project Node 22 runtime.

## Next safe action

Wire `migration.runs`, source observations/canonical events, and
`migration.target_links` into the loader; persist deterministic staff and
patient crosswalks; then use a new clean database for a two-pass retry test.
Keep the current invoice, price, attendance, cash, and clinical-schedule
withholds in place until their respective writers and reconciliation gates are
ready.
