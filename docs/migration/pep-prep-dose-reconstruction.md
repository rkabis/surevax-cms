# PEP/PrEP Dose-Schedule Reconstruction (legacy → SureVax CMS v2)

**Date:** 2026-06-07 · **Status:** algorithm retained, evidence input superseded 2026-08-16
**Source system:** AppSheet `SureVaxCMS-270623905` Google-Sheets export (`surevax_gsheet_db.xlsx`)
**Source code:** [`scripts/migration/reconstruct_pep_doses.py`](../../scripts/migration/reconstruct_pep_doses.py)
**Advances:** [`risks.md`](../../.claude/rules/risks.md) #4 (AppSheet migration plan) ·
[`docs/audits/2026-05-17-appsheet-conformance/`](../audits/2026-05-17-appsheet-conformance/) (legacy schema reference)

> The export contains **real patient PII** (names, DOB, contacts). It is **never
> committed** — the script reads it from an external path (default
> `~/Downloads/surevax_gsheet_db.xlsx`). No real patient names appear in this doc.

> **2026-08-16 evidence correction:** run this reconstruction only after the
> multi-source canonicalisation in
> [`appsheet/EVIDENCE-AND-RECONCILIATION.md`](appsheet/EVIDENCE-AND-RECONCILIATION.md).
> Nurses can delete/recreate immunizations, transactions can purchase multiple
> future doses, and patients may begin locally at ARV 2+ after a prior external
> dose. The current `Immunization` sheet is therefore an observation source, not
> the complete event history. Missing slots and `Migration` markers cannot, by
> themselves, prove missed, cancelled, external, or administered status.

## The problem

"Ensure each patient's PEP/PrEP rabies doses are all accounted for" during
migration. The legacy `Immunization` sheet is one row per dose event (≈60K rows;
≈38.8K rabies-related across ≈10.2K patients), but its per-row schedule fields
are unreliable, so doses cannot be migrated by trusting them row-for-row.

### Legacy data model

`Immunization` — one row per dose. Relevant columns:

| Column                                     | Role                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| `i_PatientRef`                             | FK → `Patient.Row ID`                                                            |
| `i_VaccineType`                            | `Anti Rabies - PEP` / `- PrEP` / `- Booster` (+ ERIG/HRIG/Tetanus, out of scope) |
| `i_VaccineRoute`                           | `ID` / `IM` — selects the regimen                                                |
| `i_DosageCount`                            | dose-in-series number (`1`–`5`, `Booster`, `N/A`)                                |
| `i_Timestamp_Ideal` / `i_Timestamp_Actual` | scheduled / administered date                                                    |
| `i_IsAdministered?`                        | `True` = given · `False` = scheduled/missed                                      |
| `i_SiteAdministered`                       | injection site (a 2-site ID visit is `Left and Right Deltoid` in ONE row)        |

## Findings that shaped the approach

1. **No episode/series key exists.** A re-bitten patient starts a fresh Day-0
   course; `i_DosageCount` resets to 1. ~607 patients have ≥2 episodes.
   Episodes must be **inferred** (dose# reset OR >60-day gap).
2. **49% of rabies rows have a NULL `i_Timestamp_Ideal`** (pre-2025 records).
   Any ordering/anchoring must `COALESCE(actual, ideal)`.
3. **The dose-SEQUENCE number is the correct matching key — not nearest-date.**
   Date-nearest matching collides legitimately-delayed series (e.g. doses at
   day 0/42/46/69 labelled 1st–4th are a _complete, late_ course, but a wide
   date window merges them and flags false "off-protocol" collisions). Keyed on
   `i_DosageCount`, **80% of PEP/PrEP episodes are CLEAN contiguous `1..n`**.
   The actual date is demoted to a drift/adherence metric.
4. **`Migration`-site rows are provenance observations, not automatic duplicates
   or external-clinic proof.** Of 1,794
   `Migration`-site rabies rows, only ~8–14 have a real same-day/same-dose#
   sibling (true shadow dupes). **Keep the observations**, but require supporting
   administration/external-source evidence before asserting the final clinical
   event or facility.
5. **A 2-site intradermal visit is encoded in a single row** (`Left and Right
Deltoid`), so one row = one visit. No site-level fan-in needed.
6. **21 orphan `i_PatientRef`** point to no patient; 19 (the PEP/PrEP/Booster
   ones) **relink cleanly via the patient name embedded in `i_Label`**.

## Deterministic ruleset

Discard the per-row schedule; rebuild from two reliable facts — the **Day-0
date** (date of dose #1, else earliest dose) and the **regimen** (type × route).

### Regimen catalog (empirically validated against the clinic's own ideal-date generator)

| Regimen         | Day-offsets from Day 0      | Doses |
| --------------- | --------------------------- | ----- |
| PEP · ID        | `0, 3, 7, 28` (Updated TRC) | 4     |
| PEP · IM        | `0, 3, 7, 14, 28` (Essen)   | 5     |
| PrEP · ID/IM    | `0, 7, 28`                  | 3     |
| Booster · ID/IM | `0, 3`                      | 2     |

### Algorithm

1. **Relink orphans** by the name in `i_Label`.
2. **Segment episodes** — new episode on dose#=1 reset OR >60-day gap;
   `Booster`-tagged rows form their own `0,3` episodes.
3. **Pick regimen** from modal type × modal route.
4. **Drop `Migration` shadow dupes** — a `Migration`-site row whose
   (patient, day, dose#) already has a real sibling.
5. **Assign by dose-sequence number** (#1→slot 0, #2→slot 1, …); the date only
   validates and yields `drift_days`. Non-numeric (`N/A`) dose# rows fall back
   to the nearest empty slot within ±14 days.
6. **Classify** every slot / leftover dose (see taxonomy below).

### Status taxonomy (CSV `status` column)

| Status          | Meaning                                                        | Disposition                                                |
| --------------- | -------------------------------------------------------------- | ---------------------------------------------------------- |
| `ADMINISTERED`  | real given dose mapped to its slot                             | migrate, keep actual date                                  |
| `SCHEDULED`     | real not-yet-given row (`adm=False`)                           | migrate as-is                                              |
| `GAP_FILL`      | **trailing** empty slot                                        | auto synthetic placeholder at ideal date, status Scheduled |
| `GAP_FLAG_MID`  | **interior** empty slot (a later dose exists)                  | 🚩 flag — do NOT fill                                      |
| `EXTRA_5TH`     | dose# beyond regimen length (optional 5th ID dose, pending A2) | 🚩 flag                                                    |
| `DUP`           | duplicate dose# within an episode                              | 🚩 flag                                                    |
| `NA`            | non-numeric dose# with no date-slot fit                        | 🚩 flag                                                    |
| `MIGRATION_DUP` | shadow dupe removed in step 4                                  | auto-dropped                                               |

**Fill rule (locked):** create a placeholder only for a _trailing_ gap (the
series progressed then stopped); never auto-fill a _mid-schedule_ gap — flag it,
because a missing middle dose with a later dose present is anomalous.

## Results (run 2026-06-07)

| Disposition                  |      Count |
| ---------------------------- | ---------: |
| ADMINISTERED                 |     29,385 |
| SCHEDULED                    |      7,001 |
| GAP_FILL (auto placeholder)  |      2,972 |
| GAP_FLAG_MID 🚩              |      2,409 |
| EXTRA_5TH 🚩                 |         41 |
| DUP 🚩                       |        315 |
| NA 🚩                        |         59 |
| MIGRATION_DUP (auto-dropped) |         14 |
| **AUTO (no human needed)**   | **39,372** |
| **MANUAL REVIEW queue**      |  **2,824** |

Orphan relink: 19/19 in-scope matched · 10,147 patients with rabies doses.

## Decisions locked (2026-06-07) & deferred

**Locked:** A1 PEP-ID = 4-dose · A3 PEP-IM = Essen 5-dose · matching key =
dose-sequence number (supersedes the Day-28 tolerance sweep) · #7 trailing-fill /
interior-flag · #9 relink orphans by label name · #10 boosters as own `0,3`
episodes · #12 fill abandoned old episodes too.

**Deferred (still gate full closure):**

- **A2** — the 4→5 dose transition (5th ID dose optional on pet-status
  confirmation). Until dated, legitimate 5th doses sit in `EXTRA_5TH` (41 rows).
- **Q4** episode-gap threshold (using 60 days) · **Q5** max doses per episode.
- **Q8** distinguish "patient defaulted (no-show)" vs "record lost".
- **Q11** ERIG/HRIG (Day-0 immunoglobulin) and Tetanus co-administration
  reconciliation into the same episode — currently ARV doses only (2 IG orphans
  out of scope).

## Cutover reconciliation invariants

After import, assert: (1) `COUNT(legacy rabies rows) == COUNT(clinical_orders
migrated)`, partitioned by administered/scheduled status; (2) per-patient dose
sums match (zero-diff report); (3) every orphan resolved or quarantined — none
silently dropped; (4) per-episode completeness flag emitted (incomplete series
stay visibly incomplete — placeholders are never marked Completed).

## How to run

```bash
python3 scripts/migration/reconstruct_pep_doses.py \
    --xlsx ~/Downloads/surevax_gsheet_db.xlsx \
    --out  /tmp/pep_dose_remediation.csv
```

One CSV row per schedule slot + every flagged anomaly. Filter to
`GAP_FLAG_MID / EXTRA_5TH / DUP / NA` for the human-review worklist;
`GAP_FILL` rows are deterministic auto-placeholders for spot-checking.
