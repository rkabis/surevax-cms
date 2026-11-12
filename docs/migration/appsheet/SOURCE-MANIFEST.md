# AppSheet Migration Source Manifest

> **Observed:** 2026-08-16, Asia/Manila
> **Machine-readable index:** [`SOURCE-MANIFEST.json`](SOURCE-MANIFEST.json)
> **Classification:** restricted source locations; this document contains no
> patient rows.

This is the canonical locator for the live AppSheet database, historical
database candidates, local immutable exports, and clinic sales trackers used by
the migration. It records where evidence is stored; it does not make every
located file authoritative.

## Handling rules

1. Never commit the workbooks or extracts containing patient data.
2. Record a SHA-256 hash for every local cutover input.
3. Re-read Drive metadata at the freeze; live Sheets are mutable.
4. Preserve the raw source row and locator before normalising it.
5. Quarantine copied sheets until branch and date-range ownership are proven.
6. Do not restore an older Google Sheet version into the live AppSheet source.
   Use **Version history → Make a copy**.

## AppSheet database

| Field                       | Value                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Live file                   | [`surevax_gsheet_db`](https://docs.google.com/spreadsheets/d/18D6KXggNxmAliJwtDGcIDyKxWCDGuOkL4rKa3FQoI64/edit) |
| Drive file ID               | `18D6KXggNxmAliJwtDGcIDyKxWCDGuOkL4rKa3FQoI64`                                                                  |
| Local export                | `/Users/njvil/Downloads/surevax_gsheet_db (2).xlsx`                                                             |
| Local SHA-256               | `00d002b0d2da31832e6832fdd51a5260b099555287cb4f1437d2925d16af072e`                                              |
| Local export timestamp      | 2026-08-15 21:37:43 PHT                                                                                         |
| Primary financial sheet     | `Transactions`                                                                                                  |
| Mutable clinical sheet      | `Immunization`                                                                                                  |
| Other reconciliation sheets | `Patient`, `Remarks`, `ImmunizationBundle`, `ChargeAccounts`, `Vaccine`, `Branch`, `Nurse`                      |

The connector observed these checkpoints across the 2026-08-15 and 2026-08-16
revision reads. The latest listing returned only the final three, confirming
that the API-visible window is not stable:

| Revision |   Modified (PHT) | State                                                |
| -------- | ---------------: | ---------------------------------------------------- |
| `443648` | 2026-08-14 21:05 | historical API-visible revision                      |
| `443696` | 2026-08-15 08:04 | content successfully retrieved through the connector |
| `444783` | 2026-08-15 21:08 | historical API-visible revision                      |
| `445029` | 2026-08-16 11:34 | historical API-visible revision                      |
| `445124` | 2026-08-16 13:24 | source advanced during the Cubao reconciliation      |
| `445181` | 2026-08-16 13:41 | latest during the cross-branch pre-cutover run       |

The source advanced from the metadata state observed at the start of the Cubao
reconciliation to revision `445124`, then again to `445181` during the
cross-branch profiling run while connector reads were still running.
The reconstruction is therefore a moving-source diagnostic, not an atomic
snapshot. A production run must freeze AppSheet writes, drain bots/sync, and
then export every source before reading rows.

Google can merge native-Sheet revisions and return an incomplete revision list.
The Sheets version-history UI is therefore the source for older checkpoints.
Make timestamped copies and add them to `historicalDatabaseCandidates` in the
JSON manifest.

### Historical candidates already found

| Candidate                                                                                                                        | Assessment                                                              |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [`Copy of surevax_gsheet_db - sept 9`](https://docs.google.com/spreadsheets/d/1X7hTgAdJXSL5A2MIY5axOGC5pAgV-D3FNtpuFLM1vWo/edit) | strongest visible long-range snapshot; verify sheet coverage and hashes |
| [`surevax_gsheet_db_copy`](https://docs.google.com/spreadsheets/d/18I1TrjxT1BPTbNF0N7kpgoVUF0yb0XFhRBTCB2UCv3o/edit)             | unusually small; likely partial                                         |
| [`surevax_gsheet_db for ateneo`](https://docs.google.com/spreadsheets/d/1_FZfkbZ8vN-5EKU1HsyWWu53DcQd3oY3SoSa5004H2I/edit)       | likely subset or sanitised copy                                         |

## Clinic sales trackers

All live trackers are in the
[`Manual Sales Tracker` Drive folder](https://drive.google.com/drive/folders/1mbIxnMpoDC_L1EWRLvnMrJtHojYH2QVE).
The local exports were downloaded on 2026-08-01; every live tracker was modified
after that date, so the local files are profiling inputs, **not final cutover
inputs**.

| Branch      | Live Drive source                                                                                   | Candidate patient-level sheet                  | Local export                                                     |
| ----------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| Aguirre     | [tracker](https://docs.google.com/spreadsheets/d/1eJU8xi4OYsWtBWMSM-i6PPctAsKDP4C4F2rI_OoXdlc/edit) | `Manual Sales`                                 | `/Users/njvil/Downloads/Manual Sales Tracker - Aguirre.xlsx`     |
| Alabang     | [tracker](https://docs.google.com/spreadsheets/d/1AYO484U1Ypp9cex81Xnavk04nvX8dNTvIWSnVg3m-Ss/edit) | `Manual Sales Tracker`                         | `/Users/njvil/Downloads/Manual Sales Tracker - Alabang.xlsx`     |
| Cainta      | [tracker](https://docs.google.com/spreadsheets/d/1xai-9RclG_OMiA4brcRXsdE_hPAdovPKQ0i73thWEkk/edit) | `Manual Sales Tracker`                         | `/Users/njvil/Downloads/Manual Sales Tracker - Cainta.xlsx`      |
| **Cubao**   | [tracker](https://docs.google.com/spreadsheets/d/1S-CRkWAD2is8nhGvMUNTc69FxYQAS7Y1qnaw_ShBUqA/edit) | `Manual Sales 2026!A1:I19`                     | connector-exported; no materialized local hash                   |
| Holy Spirit | [tracker](https://docs.google.com/spreadsheets/d/1RX_TNXGmK69cXtWmV8dDcSYeXMwYANl_zWhh0Cs1E_g/edit) | `Manual Sales`                                 | `/Users/njvil/Downloads/Manual Sales Tracker - Holy Spirit.xlsx` |
| Marikina    | [tracker](https://docs.google.com/spreadsheets/d/17K_SABdNm-FHkODx184YULL3-CnCVsUJtfsAYZuat4U/edit) | `January - March Manual Sales`                 | `/Users/njvil/Downloads/Manual Sales Tracker - Marikina.xlsx`    |
| Maysilo     | [tracker](https://docs.google.com/spreadsheets/d/1cNroKY1f8p8NsMl1aOZmEdQgR1kcCkGtJlQ58BZ2tVE/edit) | `Manual Sales`                                 | `/Users/njvil/Downloads/Manual Sales Tracker - Maysilo.xlsx`     |
| Novaliches  | [tracker](https://docs.google.com/spreadsheets/d/1HgkkDmfbADgWj6q5493Mwy30YDI_vR1v3yDDfYJ9npk/edit) | `Manual Sales Nova`                            | `/Users/njvil/Downloads/Manual Sales Tracker - Novaliches.xlsx`  |
| Pasig       | [tracker](https://docs.google.com/spreadsheets/d/1jBeZC70LVxT21FjsLti7Tn6smm4VJIiVrCN1nPffMXM/edit) | `Daily Manual Sales`                           | `/Users/njvil/Downloads/Manual Sales Tracker - Pasig.xlsx`       |
| Salcedo     | [tracker](https://docs.google.com/spreadsheets/d/1n2EOX0gB9TLqWX9EXLLimSsMV-W4FwNC2a1KgQ1Mg8c/edit) | monthly Manual Sales sheets                    | `/Users/njvil/Downloads/Manual Sales Tracker Salcedo.xlsx`       |
| San Juan    | [tracker](https://docs.google.com/spreadsheets/d/18eyrI2cLr_ao8U0j8mgkfJ1xLVLY94HSN87yHiUT4yw/edit) | `Manual Sales`                                 | `/Users/njvil/Downloads/Manual Sales Tracker - San Juan.xlsx`    |
| Sta Mesa    | [tracker](https://docs.google.com/spreadsheets/d/1JitUwlj1Y6uoxAofThkiCDzk3rV0IdSUn2UTFllL8NY/edit) | ` Manual Sales`; disputed `March Manual Sales` | `/Users/njvil/Downloads/Manual Sales Tracker - Sta Mesa.xlsx`    |
| Taguig      | [tracker](https://docs.google.com/spreadsheets/d/1wBtr9PenK65OacPD-1c6_KFjvcsGTM-R7VCsPZtN-sg/edit) | `Manual Sales`                                 | `/Users/njvil/Downloads/Manual Sales Tracker - Taguig.xlsx`      |
| Timog       | [tracker](https://docs.google.com/spreadsheets/d/13MTeIuz2czxUxt1m0X2mrUaUWDM6om5x5kqZSsq1c-E/edit) | `August - Manual Sales`                        | `/Users/njvil/Downloads/Manual Sales Tracker - Timog.xlsx`       |

`Manual Sales Tracker - Template` is excluded. Cubao is a fourteenth live
clinic tracker discovered in Drive after the 13 local workbooks were profiled.
It was subsequently profiled live through the connector: the patient-level
range currently contains 18 visit rows covering 2026-08-06 through 2026-08-16.
See [`CUBAO-LIVE-RECONSTRUCTION-2026-08-16.md`](CUBAO-LIVE-RECONSTRUCTION-2026-08-16.md).

A later read-only pass profiled the selected live ledger for every branch:
26,407 candidate tracker rows and ₱36,662,058.38 in parseable tracker-row
amounts. These are source-row controls, not patient, administration or revenue
totals. Exact ranges and branch readiness are in
[`PRE-CUTOVER-READINESS-2026-08-16.md`](PRE-CUTOVER-READINESS-2026-08-16.md)
and the machine-readable `liveBranchProfile20260816` object in
`SOURCE-MANIFEST.json`.

### 2026-08-16 connector exports

All 14 live tracker Drive IDs were successfully exported to authenticated XLSX
file references through the Drive connector. Those references are not a final
cutover snapshot: the workbooks remained mutable and the connector artifacts
were not materialized into the access-controlled, hashed evidence directory.
The observed modified times and export sizes are recorded in the Cubao live
reconstruction report and `SOURCE-MANIFEST.json`.

## Quarantined copied sheets

| Sheet                   | Files carrying identical content            | Disposition                                         |
| ----------------------- | ------------------------------------------- | --------------------------------------------------- |
| `Manual Sales`          | Alabang, Marikina, Novaliches, Pasig, Timog | quarantine until branch/period owner is established |
| `November Manual Sales` | same five files                             | quarantine                                          |
| `March Manual Sales`    | Sta Mesa and Timog                          | quarantine                                          |

The containing workbook name does not establish ownership of a copied sheet.
These rows must not be multiplied across branches.

## Refresh procedure

At every dry run and final freeze:

1. Export the live AppSheet database and all 14 trackers.
2. Record Drive file ID, modified time, export time, byte size and SHA-256.
3. Record the exact sheet/range selected for each branch.
4. Compare against the prior manifest and classify changes.
5. Stop if a file changed after the declared freeze time.
6. Store outputs outside Git in an access-controlled evidence directory.
