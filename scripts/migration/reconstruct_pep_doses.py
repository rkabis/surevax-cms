#!/usr/bin/env python3
"""Reconstruct a deterministic PEP/PrEP rabies dose schedule from the legacy
AppSheet/Google-Sheets export, so every patient's doses are provably accounted
for during migration into SureVax CMS v2.

WHY THIS EXISTS
---------------
The legacy `Immunization` sheet is one row per dose event, but its per-row
schedule fields (`i_Timestamp_Ideal`, `i_DosageCount`) are unreliable:
  - 49% of rabies rows have a NULL ideal date (pre-2025 records).
  - dose-count contains 'N/A', 'Booster', and resets across re-exposures.
  - there is NO episode/series key, so a re-bitten patient's second course is
    interleaved with the first.
We therefore DISCARD the per-row schedule as a source of truth and rebuild it
deterministically from two reliable facts: the Day-0 date (earliest dose) and
the regimen (encoded in vaccine type x route). The dose-SEQUENCE number is the
matching key (not nearest-date — that collides legitimately-delayed series).

DETERMINISTIC RULESET (locked with the clinic 2026-06-07)
---------------------------------------------------------
1. Segment each patient's rabies rows into episodes:
     new episode when dose# resets to 1 OR the gap exceeds EPISODE_GAP_DAYS.
   'Booster'-tagged rows are pulled into their own 2-dose (0,3) episodes (#10).
2. Pick the regimen by (modal vaccine type x modal route) -> REGIMENS.
     PEP-ID = 0,3,7,28 (4-dose Updated TRC, the clinic standard, A1).
     PEP-IM = 0,3,7,14,28 (Essen, A3).
     PrEP   = 0,7,28.   Booster = 0,3.
3. Anchor Day 0 = date of dose#1 (else earliest dose). Slot ideal dates =
   Day0 + offset.
4. Drop 'Migration'-site SHADOW DUPLICATES: a row whose (patient, day, dose#)
   already has a non-Migration sibling (#9 confirmed only ~8 of these).
5. Assign each remaining dose to a slot by its dose-SEQUENCE number
   (#1 -> slot 0, #2 -> slot 1, ...). The actual date is kept only as a drift
   / adherence metric, never as the matching key.
6. Classify every slot / leftover dose:
     ADMINISTERED   - real given dose mapped to its slot (keep actual date)
     SCHEDULED      - real not-yet-given row (i_IsAdministered? = False)
     GAP_FILL       - TRAILING empty slot -> synthetic placeholder at ideal
                      date, status Scheduled. Created ONLY past the last real
                      dose (#7: never fill a mid-schedule gap).
     GAP_FLAG_MID   - INTERIOR empty slot (a later dose exists) -> flag, do NOT
                      fill (#7).
     EXTRA_5TH      - dose# beyond the regimen length (the optional 5th ID dose
                      pending the A2 ruling) -> flag.
     DUP            - duplicate dose# within an episode -> flag.
     NA             - non-numeric dose# that could not be ordinally placed.
     MIGRATION_DUP  - shadow duplicate removed in step 4.

DEFERRED (not yet encoded — see docs/migration/pep-prep-dose-reconstruction.md):
  A2 4->5 dose transition date; Q4 episode-gap threshold; Q5 max-doses;
  Q8 no-show vs record-lost; Q11 ERIG/HRIG/TT co-administration reconciliation.

OUTPUT
------
A per-slot remediation CSV (one row per schedule slot + every flagged anomaly)
plus a summary table on stdout. The CSV is the manual-review worklist: filter
to GAP_FLAG_MID / EXTRA_5TH / DUP / NA for the rows that need human eyes.

USAGE
-----
  python3 scripts/migration/reconstruct_pep_doses.py \
      --xlsx ~/Downloads/surevax_gsheet_db.xlsx \
      --out  /tmp/pep_dose_remediation.csv

The source xlsx contains real patient PII and MUST NOT be committed.
"""
from __future__ import annotations

import argparse
import csv
import os
from collections import Counter, defaultdict
from datetime import datetime, timedelta

import openpyxl

# --- tunable constants (locked 2026-06-07) ---------------------------------
EPISODE_GAP_DAYS = 60          # gap that starts a new PEP/PrEP course (Q4 deferred default)
BOOSTER_GAP_DAYS = 30          # gap that starts a new booster event
NA_DATE_TOL_DAYS = 14          # date-fallback window for non-numeric dose# rows
RABIES_TYPES = {"Anti Rabies - PEP", "Anti Rabies - PrEP", "Anti Rabies - Booster"}

# regimen catalog: ordered day-offsets from Day 0
REGIMENS = {
    ("PEP", "ID"): [0, 3, 7, 28],
    ("PEP", "IM"): [0, 3, 7, 14, 28],
    ("PrEP", "ID"): [0, 7, 28],
    ("PrEP", "IM"): [0, 7, 28],
    ("Booster", "ID"): [0, 3],
    ("Booster", "IM"): [0, 3],
}


def as_dt(v):
    return v if isinstance(v, datetime) else None


def slot_label(offset: int) -> str:
    return f"Day {offset}"


def load(xlsx_path: str):
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    # patient name index (for orphan relink, #9)
    pat = wb["Patient"]
    phdr = [c.value for c in pat[1]]
    pix = {h: i for i, h in enumerate(phdr)}
    pid_set: set = set()
    name2ids: dict[str, list] = defaultdict(list)
    for r in pat.iter_rows(min_row=2, values_only=True):
        pid = r[pix["Row ID"]]
        pid_set.add(pid)
        fn = (r[pix["p_FullName"]] or "").strip().lower()
        if fn:
            name2ids[fn].append(pid)

    ws = wb["Immunization"]
    hdr = [c.value for c in ws[1]]
    ix = {h: i for i, h in enumerate(hdr)}
    by_patient: dict = defaultdict(list)
    relinked = unmatched = 0
    for r in ws.iter_rows(min_row=2, values_only=True):
        vt = r[ix["i_VaccineType"]]
        if vt not in RABIES_TYPES:
            continue
        pref = r[ix["i_PatientRef"]]
        if pref not in pid_set:  # orphan -> relink by the name embedded in i_Label
            nm = (r[ix["i_Label"]] or "").split(" - ")[-1].strip().lower()
            cand = name2ids.get(nm, [])
            if len(cand) == 1:
                pref = cand[0]
                relinked += 1
            else:
                unmatched += 1
                continue
        by_patient[pref].append(
            {
                "row_id": r[ix["Row ID"]],
                "vt": vt,
                "route": r[ix["i_VaccineRoute"]],
                "dc": str(r[ix["i_DosageCount"]]),
                "ideal": as_dt(r[ix["i_Timestamp_Ideal"]]),
                "actual": as_dt(r[ix["i_Timestamp_Actual"]]),
                "adm": r[ix["i_IsAdministered?"]],
                "site": r[ix["i_SiteAdministered"]],
                "brand": r[ix["i_VaccineBrand"]],
            }
        )
    return by_patient, relinked, unmatched


def is_booster(x) -> bool:
    return x["dc"] == "Booster" or x["vt"] == "Anti Rabies - Booster"


def segment(rows, gap_days):
    rows = [x for x in rows if (x["actual"] or x["ideal"])]
    rows.sort(key=lambda x: (x["actual"] or x["ideal"]))
    episodes, cur, prev = [], [], None
    for x in rows:
        k = x["actual"] or x["ideal"]
        if cur and (x["dc"] == "1" or (k - prev) > timedelta(days=gap_days)):
            episodes.append(cur)
            cur = []
        cur.append(x)
        prev = k
    if cur:
        episodes.append(cur)
    return episodes


def dedup_migration_shadows(ep):
    """Drop a 'Migration'-site row when a real sibling shares (day, dose#)."""
    seen = Counter()
    kept, dropped = [], []
    for x in sorted(ep, key=lambda x: ((x["actual"] or x["ideal"]), x["site"] == "Migration")):
        day = (x["actual"] or x["ideal"]).date()
        key = (day, x["dc"])
        if x["site"] == "Migration" and seen[key] > 0:
            dropped.append(x)
            continue
        seen[key] += 1
        kept.append(x)
    return kept, dropped


def reconstruct(by_patient):
    out_rows = []
    stats = Counter()
    for pref, rows in by_patient.items():
        pep = [x for x in rows if not is_booster(x)]
        bst = [x for x in rows if is_booster(x)]
        groups = [(segment(pep, EPISODE_GAP_DAYS), False), (segment(bst, BOOSTER_GAP_DAYS), True)]
        ep_no = 0
        for episodes, booster in groups:
            for raw_ep in episodes:
                ep_no += 1
                ep, shadows = dedup_migration_shadows(raw_ep)
                for s in shadows:
                    stats["MIGRATION_DUP"] += 1
                    out_rows.append(_row(pref, ep_no, "MIGRATION_DUP", None, None, s))

                vt_kind = "Booster" if booster else (
                    "PrEP" if Counter(x["vt"] for x in ep).most_common(1)[0][0] == "Anti Rabies - PrEP" else "PEP"
                )
                route = Counter(x["route"] for x in ep).most_common(1)[0][0]
                route = "IM" if route == "IM" else "ID"
                offs = REGIMENS[(vt_kind, route)]
                regname = f"{vt_kind} {route}"

                # Day-0 anchor: date of dose#1, else earliest dose.
                d1 = [x for x in ep if x["dc"] == "1"]
                day0 = (d1[0]["actual"] or d1[0]["ideal"]) if d1 else min((x["actual"] or x["ideal"]) for x in ep)

                # Assign by dose-sequence number (primary key).
                slots = {i: None for i in range(len(offs))}
                seen_ord = Counter()
                na_doses = []
                for x in ep:
                    if x["dc"].isdigit():
                        k = int(x["dc"]) - 1
                        if 0 <= k < len(offs):
                            if slots[k] is None and seen_ord[k] == 0:
                                slots[k] = x
                            else:
                                stats["DUP"] += 1
                                out_rows.append(_row(pref, ep_no, "DUP", regname, None, x))
                            seen_ord[k] += 1
                        else:  # dose# beyond regimen length -> optional 5th (A2) / extra
                            stats["EXTRA_5TH"] += 1
                            out_rows.append(_row(pref, ep_no, "EXTRA_5TH", regname, None, x))
                    else:  # 'N/A' / non-numeric dose# -> defer to date fallback
                        na_doses.append(x)

                # Date fallback for non-numeric dose# rows: place into the nearest
                # still-empty slot within NA_DATE_TOL_DAYS; flag NA only if none fits.
                for x in sorted(na_doses, key=lambda x: (x["actual"] or x["ideal"])):
                    doff = ((x["actual"] or x["ideal"]) - day0).days
                    best, bd = None, 1e9
                    for i, off in enumerate(offs):
                        if slots[i] is None and abs(doff - off) < bd and abs(doff - off) <= NA_DATE_TOL_DAYS:
                            bd, best = abs(doff - off), i
                    if best is not None:
                        slots[best] = x
                    else:
                        stats["NA"] += 1
                        out_rows.append(_row(pref, ep_no, "NA", regname, None, x))

                last_real = max([i for i, v in slots.items() if v is not None], default=-1)
                for i, off in enumerate(offs):
                    ideal = day0 + timedelta(days=off)
                    x = slots[i]
                    if x is not None:
                        status = "ADMINISTERED" if x["adm"] else "SCHEDULED"
                        stats[status] += 1
                        out_rows.append(_row(pref, ep_no, status, regname, slot_label(off), x, ideal))
                    elif i > last_real:  # trailing -> create placeholder (#7)
                        stats["GAP_FILL"] += 1
                        out_rows.append(_row(pref, ep_no, "GAP_FILL", regname, slot_label(off), None, ideal))
                    else:  # interior gap -> flag, do NOT fill (#7)
                        stats["GAP_FLAG_MID"] += 1
                        out_rows.append(_row(pref, ep_no, "GAP_FLAG_MID", regname, slot_label(off), None, ideal))
    return out_rows, stats


def _row(pref, ep_no, status, regimen, slot, x, ideal=None):
    actual = (x["actual"] if x else None)
    drift = ((actual.date() - ideal.date()).days if (actual and ideal) else "")
    return {
        "patient_ref": pref,
        "episode_no": ep_no,
        "regimen": regimen or "",
        "slot": slot or "",
        "status": status,
        "expected_date": ideal.date().isoformat() if ideal else "",
        "actual_date": actual.date().isoformat() if actual else "",
        "drift_days": drift,
        "dose_count_raw": x["dc"] if x else "",
        "brand": (x["brand"] if x else "") or "",
        "site": (x["site"] if x else "") or "",
        "source_row_id": x["row_id"] if x else "",
    }


FIELDS = [
    "patient_ref", "episode_no", "regimen", "slot", "status",
    "expected_date", "actual_date", "drift_days", "dose_count_raw",
    "brand", "site", "source_row_id",
]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--xlsx", default=os.path.expanduser("~/Downloads/surevax_gsheet_db.xlsx"))
    ap.add_argument("--out", default="/tmp/pep_dose_remediation.csv")
    args = ap.parse_args()

    by_patient, relinked, unmatched = load(args.xlsx)
    out_rows, stats = reconstruct(by_patient)

    with open(args.out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(out_rows)

    auto = stats["ADMINISTERED"] + stats["SCHEDULED"] + stats["GAP_FILL"] + stats["MIGRATION_DUP"]
    review = stats["GAP_FLAG_MID"] + stats["EXTRA_5TH"] + stats["DUP"] + stats["NA"]
    print(f"orphan relink: {relinked} matched by name, {unmatched} unmatched (quarantine)")
    print(f"patients with rabies doses: {len(by_patient)}")
    print("\nslot / dose disposition:")
    for k in ["ADMINISTERED", "SCHEDULED", "GAP_FILL", "GAP_FLAG_MID", "EXTRA_5TH", "DUP", "NA", "MIGRATION_DUP"]:
        print(f"  {stats[k]:>6}  {k}")
    print(f"\n  AUTO (no human needed): {auto}")
    print(f"  MANUAL REVIEW queue:    {review}")
    print(f"\nremediation CSV -> {args.out} ({len(out_rows)} rows)")


if __name__ == "__main__":
    main()
