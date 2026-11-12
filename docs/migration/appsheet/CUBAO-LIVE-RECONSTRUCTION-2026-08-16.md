# Cubao Live Reconstruction — 2026-08-16

> **Status:** provisional live-source reconstruction; not a cutover snapshot
> **Classification:** aggregate findings and source locators only; no patient
> rows are committed here

## Sources read through the connector

| Source                                                                                                                     | Drive ID                                       | Tabs/ranges used                                                            | Metadata observed at read start (UTC) |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------- |
| [`surevax_gsheet_db`](https://docs.google.com/spreadsheets/d/18D6KXggNxmAliJwtDGcIDyKxWCDGuOkL4rKa3FQoI64/edit)            | `18D6KXggNxmAliJwtDGcIDyKxWCDGuOkL4rKa3FQoI64` | `Patient`, `Transactions`, `Immunization`                                   | 2026-08-16 05:07:29                   |
| [`Manual Sales Tracker - Cubao`](https://docs.google.com/spreadsheets/d/1S-CRkWAD2is8nhGvMUNTc69FxYQAS7Y1qnaw_ShBUqA/edit) | `1S-CRkWAD2is8nhGvMUNTc69FxYQAS7Y1qnaw_ShBUqA` | `Manual Sales 2026!A1:I19`; `TRACKER!A1:AE12` for daily-total corroboration | 2026-08-16 03:49:12                   |

The Cubao workbook declares `Asia/Hong_Kong`; the AppSheet workbook declares
`Asia/Manila`. Both were UTC+8 for the observed dates, so clock values were not
shifted. The source timezone is still retained in provenance.

### Moving-source warning

The AppSheet database changed during the connector pass. Read-start metadata
showed 2026-08-16 05:07:29 UTC; a later metadata read showed 05:23:50 UTC and
the revisions endpoint reported revision `445124` at 05:24:08 UTC. Because the
range reads were not taken from one frozen revision, this reconstruction is
diagnostic and may combine observations from adjacent live revisions. It must
be rerun after write freeze and bot/sync drain.

## Drive-connector export run

Every live branch workbook in `SOURCE-MANIFEST.json` was exported through the
Drive connector to XLSX on 2026-08-16. The connector returned authenticated
file references; the exports were not committed to Git.

| Branch      | Drive ID                                       | Live modified (UTC) | XLSX bytes | Result   |
| ----------- | ---------------------------------------------- | ------------------: | ---------: | -------- |
| Aguirre     | `1eJU8xi4OYsWtBWMSM-i6PPctAsKDP4C4F2rI_OoXdlc` | 2026-08-16 00:36:25 |    768,425 | exported |
| Alabang     | `1AYO484U1Ypp9cex81Xnavk04nvX8dNTvIWSnVg3m-Ss` | 2026-08-16 01:22:27 |  1,742,822 | exported |
| Cainta      | `1xai-9RclG_OMiA4brcRXsdE_hPAdovPKQ0i73thWEkk` | 2026-08-16 04:51:17 |    827,784 | exported |
| Cubao       | `1S-CRkWAD2is8nhGvMUNTc69FxYQAS7Y1qnaw_ShBUqA` | 2026-08-16 03:49:12 |  1,429,901 | exported |
| Holy Spirit | `1RX_TNXGmK69cXtWmV8dDcSYeXMwYANl_zWhh0Cs1E_g` | 2026-08-16 05:15:52 |    984,989 | exported |
| Marikina    | `17K_SABdNm-FHkODx184YULL3-CnCVsUJtfsAYZuat4U` | 2026-08-16 05:09:14 |  1,590,662 | exported |
| Maysilo     | `1cNroKY1f8p8NsMl1aOZmEdQgR1kcCkGtJlQ58BZ2tVE` | 2026-08-16 04:55:31 |    399,389 | exported |
| Novaliches  | `1HgkkDmfbADgWj6q5493Mwy30YDI_vR1v3yDDfYJ9npk` | 2026-08-15 23:48:53 |  1,464,255 | exported |
| Pasig       | `1jBeZC70LVxT21FjsLti7Tn6smm4VJIiVrCN1nPffMXM` | 2026-08-16 04:29:10 |  1,609,715 | exported |
| Salcedo     | `1n2EOX0gB9TLqWX9EXLLimSsMV-W4FwNC2a1KgQ1Mg8c` | 2026-08-16 03:22:02 |  1,098,862 | exported |
| San Juan    | `18eyrI2cLr_ao8U0j8mgkfJ1xLVLY94HSN87yHiUT4yw` | 2026-08-16 01:56:39 |    670,632 | exported |
| Sta Mesa    | `1JitUwlj1Y6uoxAofThkiCDzk3rV0IdSUn2UTFllL8NY` | 2026-08-15 12:57:18 |  1,446,182 | exported |
| Taguig      | `1wBtr9PenK65OacPD-1c6_KFjvcsGTM-R7VCsPZtN-sg` | 2026-08-16 04:53:15 |    644,142 | exported |
| Timog       | `13MTeIuz2czxUxt1m0X2mrUaUWDM6om5x5kqZSsq1c-E` | 2026-08-16 05:16:08 |  2,085,015 | exported |

These are live exports, not immutable final inputs: the sources were not frozen
and can continue changing. Re-export and hash them after the cutover freeze.

## Cubao reconciliation result

| Measure                                              |     Result |
| ---------------------------------------------------- | ---------: |
| Patient-level clinic rows                            |         18 |
| Distinct matched patients                            |         13 |
| Clinic sales total                                   | ₱21,688.58 |
| Matched AppSheet transaction headers                 |         22 |
| Matched administered events                          |         36 |
| Administered vaccine/biologic events                 |         30 |
| Observed planned vaccine rows                        |         40 |
| Clinic rows matching exact grouped amount and tender |    18 / 18 |
| Clinic rows matching administered service set        |    18 / 18 |
| Clinic rows matching route set                       |    18 / 18 |
| Clinic rows matching brand set                       |    18 / 18 |

Several clinic rows represent one visit while AppSheet split the services into
multiple same-day transaction headers. Reconciliation therefore groups by
matched patient + branch + calendar date before comparing total, tender and
items; it does not require one clinic row to equal one transaction header.

## Reconstructed dose-state summary

The provisional canonical schedule contains 74 dose/service slots:

| State                           | Slots | Meaning                                                                                                              |
| ------------------------------- | ----: | -------------------------------------------------------------------------------------------------------------------- |
| Administered                    |    30 | internal vaccine/biologic administration supported by current AppSheet state and clinic visit evidence where present |
| External, date unknown          |     2 | explicit attributable note says TT doses 1 and 2 occurred at another clinic                                          |
| Overdue                         |     1 | planned ARV dose before the observed cutoff with no administration evidence                                          |
| Due on cutoff date              |     1 | planned ARV dose due 2026-08-16 with no administration evidence yet                                                  |
| Future scheduled                |    33 | observed future schedule rows after deterministic duplicate selection                                                |
| Synthetic future scheduled      |     6 | one absent ARV day-28 slot and five absent TT dose-3 slots reconstructed from regimen rules                          |
| Actual-date/admin-flag conflict |     1 | selected current row has a populated future actual value but `i_IsAdministered=FALSE`                                |

Four duplicate schedule groups were found for one patient. The provisional
schedule selects the coherent sequence anchored to the administered first dose,
but preserves every conflicting source row for manual review.

## Assumptions used

1. `Manual Sales 2026` column A is the visit date even though cell A1 contains
   the malformed header value `13`.
2. A clinic row is accepted as a deterministic AppSheet visit match only when
   normalized identity, exact date, grouped total, tender, service set, route
   set and brand set agree. A spelling variant remains in the review queue.
3. `i_IsAdministered=TRUE` plus an actual date is required for an internal
   administration. An actual timestamp with `FALSE` is not administration.
4. A past planned dose without administration evidence is `overdue`, never
   automatically `Cancelled`.
5. ARV PEP synthetic schedule positions use days 0, 3, 7 and 28 anchored to
   locally administered dose 1. Observed administration dates are never moved.
6. ARV booster positions use days 0 and 3 anchored to the local booster dose 1.
7. TT synthetic positions use +1 and +6 **calendar months** from local TT dose
   1, matching the legacy scheduling behavior.
8. A booster label implies prior vaccination but does not prove the prior
   dates, clinic, brand or completed course. No prior PEP doses are synthesized.
9. An attributable note explicitly stating TT doses 1 and 2 occurred at another
   clinic supports external administrations, but their dates and facility stay
   unknown.
10. AppSheet patient reference alone is not identity proof: one current patient
    reference is also attached to an older transaction whose label names a
    different person.
11. Every result remains provisional until AppSheet writes/bots are frozen,
    sync drains, and both sources are re-exported.

## Manual reconciliation queue

Sixteen restricted queue items were emitted outside Git. Categories include:

- one patient-reference identity collision;
- one name spelling variant;
- two patient/encounter branch inconsistencies;
- one valid one-way transaction→immunization link with a blank reverse link;
- four duplicate dose-slot groups;
- two actual-date/admin-flag contradictions;
- one external-course detail gap;
- two booster prior-course evidence gaps;
- six synthetic slots requiring clinical acceptance;
- one overdue ARV dose requiring follow-up or outside-clinic evidence;
- final-freeze and timezone controls.

Restricted run artifacts currently live at:

```text
/private/tmp/surevax-cubao-reconciliation-2026-08-16/
├── README.md
├── cubao-reconstruction.json
├── manual-reconciliation.csv
└── outputs/01a005a4-efc5-7273-aa87-76be658429c5/
    └── cubao-reconciliation.xlsx
```

They contain live patient references and must not be committed or pasted into
ordinary tickets. The production pipeline must generate the same artifacts in
an access-controlled evidence directory with a run ID and hashes.
