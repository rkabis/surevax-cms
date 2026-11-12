# AppSheet → SureVax v2 — Source Data Analysis

> Source: `surevax_gsheet_db.xlsx` (exported 2025-05-21, 17 sheets, ~128k rows, 14 MB).
> Profiling performed 2026-06-04. All numbers below come from iterating the
> actual workbook with openpyxl, not from the AppSheet app metadata.
>
> This complements the metadata-only audit at
> `docs/audits/2026-05-17-appsheet-conformance/`. The audit answers "what does
> the legacy app _think_ it does"; this doc answers "what is _actually_ in the
> data."

> **2026-08-16 superseding recheck:** the latest export has 15,697 patients,
> 76,030 immunizations, 41,274 transactions, 2,376 TimeLog rows and 5,049
> NurseShift rows. Q6 is resolved: the five numeric refs / 30 immunizations are
> exact Patient `Row ID` matches that were misread as far-future dates because
> those XLSX identifier cells carried date formatting. Q7 is now 53 missing
> transaction IDs / 72 immunizations: 42 row links repair from forward
> transaction references, with 30 rows requiring further exact reconciliation.
> The June inventory below remains historical evidence, not the cutover count.

### 2026-08-17 Day-14 animal-status / Remarks recheck

- `p_PetStatus='Dead'`: 48 patients.
- 23/48 have at least one row in the patient-level `Remarks` table (32 rows);
  15 have immunization remarks and 9 have transaction remarks.
- Only one attributable remark describes the animal death: a stray cat died
  after being hit by a vehicle. No attributable remark documents FAT or other
  laboratory testing.
- Three apparent “test” hits are ERIG/ATS skin tests on the human patient; they
  are not animal tests and must not affect the animal outcome.
- Therefore 47/48 remain confirmed-dead with cause/testing unknown. The one
  accidental-death note also does not fit `DiedNaturally` or
  `KilledForTesting`. The target needs a generic, non-cancelling death outcome.
- `Pending` is not proof that the animal remained under observation. Nurses
  were expected to update the field at Day 14 but did not always do so; it means
  the Day-14 result was not recorded/updated. Derive overdue only when a unique
  incident and due date exist.

## 1. Sheet inventory (rows exclude header; no hidden/deleted sheets exist)

| Sheet              |   Rows | Maps to (v2)                                                                    | Import?                       |
| ------------------ | -----: | ------------------------------------------------------------------------------- | ----------------------------- |
| Patient            | 12,469 | `patients`                                                                      | yes                           |
| Immunization       | 60,049 | `clinical_orders` (+ `patient_standing_orders`)                                 | yes                           |
| Transactions       | 33,192 | `transactions` + `transaction_items` + `payments`                               | yes (with consolidation — §6) |
| Remarks            |  5,874 | `encounters.clinical_notes` / `patients.onboarding_data.legacyNotes`            | yes                           |
| Vaccine            |    149 | `products` + `service_catalog` + `service_eligible_products` + `service_prices` | yes                           |
| Branch             |     14 | `branches`                                                                      | yes                           |
| Nurse              |     89 | `users` + `user_roles`                                                          | yes                           |
| BranchReport       |  2,083 | derived at query time (dashboard/day_summary)                                   | **no** (C2)                   |
| ImmunizationBundle |  4,547 | staging-only — already fanned into Immunization                                 | **no** (A2)                   |
| InventoryLog       |    176 | `inventory_lots` + `inventory_movements`                                        | **no** (D1 — not tracked yet) |
| CashBalanceLog     |     10 | `cash_drawer_sessions.opening_float`                                            | yes (pending confirm)         |
| AdminEmails        |      5 | `user_roles` (TenantAdmin)                                                      | yes                           |
| Discount           |      9 | `transactions.discount_id_type` + `discount_amount` (no lookup table)           | yes                           |
| TimeLog            |  2,377 | historical count; valid raw clock events                                        | optional C1 union             |
| NurseShift         |  3,185 | historical count; alternate/consolidated attendance rows                        | optional C1 union             |
| DataRequests       |      2 | test rows                                                                       | **no**                        |
| ChargeAccounts     |  1,064 | enriches `transactions.payer_id` + `payments.reconciliation_status`             | yes (overlay)                 |

`wb.worksheets` confirmed all 17 sheets are `state=visible`; **no `_Deleted` / `_Audit` shadow sheet** was exported (hypothesis H16 falsified). Unresolved FK pointers are therefore permanently dangling — drop with warning, no recovery source.

## 2. Patient identifier evolution (the key surprise)

The Patient `Row ID` format **changed over the app's life** and is NOT a single UNIQUEID scheme:

| Format                                                 |  Count |   % | Example                  |
| ------------------------------------------------------ | -----: | --: | ------------------------ |
| `[p_Initials]&[_RowNumber]` (2–3 letters + 3–5 digits) | 10,001 | 80% | `PAB2957`, `MA2461`      |
| 22-char `UNIQUEID()`                                   |  2,455 | 20% | `IDXsoZqM_w4P2Gha3HLyk8` |
| Other / malformed                                      |     13 | <1% | —                        |

By first-visit month, the cutover is sharp:

```
month     UNIQUEID  INITIALS
2024-08      146        0
...
2025-03      318        0
2025-04      476       51   ← transition begins
2025-05        0      641   ← flip complete
2025-06+       0      ~800/mo
```

**The flip was NOT retroactive.** 2024 immunizations point at UNIQUEID-format
patients (4,380 UNIQUEID vs 0 INITIALS_ROWNUM in 2024). Old references stay
internally consistent. The `RowIdMap` treats both as opaque strings, so import
is unaffected — but per **decision A3 the legacy patient ID is dropped** (the old
`update row id` action mutated these, so they're unstable; not worth preserving).

## 3. Duplicate patients (cross-format re-registration)

Same person registered twice — once under each ID format — after the April 2025 flip.

- **77 distinct (firstName, lastName, DOB) groups** with >1 patient row (155 rows total)
- **15 of those are mixed-format** (one UNIQUEID + one INITIALS_ROWNUM)
- Example: Jason Garganta, DOB 2000-03-11 → `_1buNnajMt4rmg_0nu4Dz3` (UNIQUEID) **and** `JG10938` (INITIALS), matching phone 9179476214

**Phone-only dedup is unsafe**: 501 distinct phones are shared across >1 patient,
but most are placeholder junk (`9876543210` on 7 patients, `9228173566` on 10) or
family groups. **Require name + DOB + phone triple match.** The importer marks the
newer row's `merged_into_id` → older row, and tags both `POTENTIAL_DUPLICATE`
(uses existing `patients.merged_into_id` + `patient_tags` — no new schema).

## 4. Foreign-key integrity (Immunization → other sheets)

| FK                 | Unresolved rows |                                                                                                           Distinct bad values | Disposition                                                         |
| ------------------ | --------------: | ----------------------------------------------------------------------------------------------------------------------------: | ------------------------------------------------------------------- |
| `i_PatientRef`     |               0 | The five numeric values are exact Patient `Row ID`s after date-formatted identifier cells are converted back to Excel serials | **resolved in extractor** (2026-08-16)                              |
| `i_VaccineRef`     |           1,829 |                                                         7 (all `SERVICE_Consultation_*` / `SERVICE_MedCert_*` / 1 lab string) | **resolved** by sibling-RowID fix (§5)                              |
| `i_TransactionRef` |              51 |                                                                                                    39 (historical June count) | superseded: latest 72 rows / 53 refs; forward-repair then reconcile |

The older claim that the 30 + 51 pointers were "gone for good" is superseded:
transaction forward references, labels, clinic trackers and later snapshots
can recover logical identity even when the exact back-reference row is absent. The 1,829
"unresolved" vaccine refs were a **bug in the first importer pass** — fixed (§5).

## 5. Vaccine catalog structure

- 149 Vaccine rows, but **82 (55%) are never referenced** in Immunization — partner-suffixed variants (`ARVPEP_SpeedaID_MedAsia`, `CHICKENPOX_Varilrix_HH`) that were defined but unused. v2's collapsed model loses nothing.
- The sheet collapses **four orthogonal axes** into one row: brand, route, payer, physician. v2 splits them: brand→`products`, (type,route)→`service_catalog`, payer→`service_prices.payer_id`, physician→`transaction_items.performed_by_id`.
- **Bug found + fixed**: `SERVICE_Consultation_NoOR` (1,475 imms), `_OR` (177), `_Lacuarin`/`_Lintag`/etc. and bare `SERVICE_Consultation` (13) all collapse to one `SVC_CONSULTATION`. The first importer registered only the _first_ source Row ID per collapsed service, silently dropping 1,644 immunizations. Fix: register **every** source Row ID → service id in `legacyRefToServiceId`.
- **Denormalization drift is negligible** — of 57,677 imms with a resolvable `i_VaccineRef`, the redundant `i_VaccineType/Brand/Route` columns disagree with the Vaccine sheet in only 2 / 12 / 2 rows. Trust `i_VaccineRef`.

## 6. Transaction grain — "one txn per patient per day" (the core billing finding)

A transaction = a record of payment received. The intended grain is one per
patient per day, but some nurses ring each vaccine as a separate transaction.

- **32,510 distinct (patient, day) groups**; 31,915 (98.2%) already have exactly 1 transaction.
- **595 groups have >1 transaction**; **576 are same-nurse** (the per-vaccine habit), 19 different-nurse.
- The split habit is operator-specific: JessicaMayAgliam (104), JulienneNicdao (50), JillianCarlos (37) account for a third.

Timing of same-nurse splits proves single payment events:

| gap between split txns       | count |
| ---------------------------- | ----: |
| <1 min (batch entry)         |   292 |
| 1–5 min                      |   139 |
| 5–60 min                     |    73 |
| 1–4 hr                       |    52 |
| >4 hr (maybe separate visit) |    20 |

Item overlap across same-nurse splits:

|                   | count | meaning                                                  |
| ----------------- | ----: | -------------------------------------------------------- |
| disjoint items    |   569 | clean to merge (txn A = ARV, txn B = TT, same visit)     |
| overlapping items |     5 | **suspected duplicate charges** — same item billed twice |
| no item refs      |     2 | manual                                                   |

Payment methods within split groups: 521 same method, **55 mixed** (e.g. ₱1,500
cash + ₱300 GCash) — the legacy schema couldn't express "one sale, two tenders"
so the nurse split it; **v2 expresses this natively as one `transactions` header +
multiple `payments` rows.**

**Consolidation impact**: merging the 576 same-nurse groups removes 655 rows
(33,192 → 32,537), preserves ₱1,582,810 exactly, and makes ~100% of patient-days
exactly one transaction. See the consolidation rule in `DESIGN.md` §"Transaction
consolidation."

The 5 overlapping cases are duplicate charges (4 are identical: same item, same
₱800, billed twice). These must NOT be auto-merged (would double the charge) —
they need per-case ops review.

## 7. Financial reconciliation

- **Payments reconcile 99.7%**: 33,105/33,192 have `amount_paid == total` exactly. 10 underpaid, 77 overpaid, 1 negative, 49 zero. Method-column sums match `t_TotalAmountPaid` in all but 7. **Payment data is trustworthy.**
- **Item-sum reconciliation 90.3%**: `Σ(immunization i_DosagePrice) == t_TotalAmount` for 29,954/33,154. The 3,200 mismatches are discounts, comped (total=0) doses, and service add-ons.
- **`t_TransactionValueNonService` = ₱18.1M across 12,761 rows** = the vaccine portion (vs `t_TransactionValue` = service/consult portion). The split exists only for BIR discount math. The importer must NOT add both into gross — the immunization fan-out already captures the full amount.

## 8. Discount sheet — 8 codes, one is a MARKUP

| Code         | Type       | Value                   | Usage | Real meaning                       | v2 mapping                 |
| ------------ | ---------- | ----------------------- | ----: | ---------------------------------- | -------------------------- |
| `Senior`     | Percentage | −20%                    | 1,699 | BIR senior citizen                 | `discount_id_type='OSCA'`  |
| `PWD`        | Percentage | −20%                    |   938 | BIR PWD                            | `discount_id_type='PWD'`   |
| `FullyPaid`  | Flat       | −₱200                   |    61 | pay-all-4-doses incentive          | `Other` + amount=200       |
| `QCID`       | Percentage | −10%                    |    25 | Quezon City ID                     | `Other` + number=QCID      |
| `DMCI`       | Percentage | −5%                     |    29 | DMCI corporate                     | `Other` + number=DMCI      |
| `BFP`        | Percentage | −10%                    |     3 | Bureau of Fire Protection          | `Other` + number=BFP       |
| `PPSV3`      | Percentage | −30%                    |     1 | pneumonia vaccine promo            | `Other` + number=PPSV3     |
| `AyalaMalls` | Percentage | **+15%**                |    24 | **partner UPLIFT, not a discount** | `service_prices` payer row |
| `Employee`   | —          | (not in Discount sheet) |     1 | stale/typo                         | drop + warn                |

**Two corrections vs the first importer:**

1. It mapped only Senior/PWD/SoloParent/FullyPaid → 79 transactions silently lost their discount. Need the full 8-code map.
2. **`AyalaMalls` is a +15% markup** — treating it as a discount would subtract instead of add. Same Ayala Malls that appears as a charge-account payer → belongs in `service_prices` with `payer_id`, like Hati Health / Forticare.

`FullyPaid` distribution: 61 txns across 60 patients (one patient has 2). Whether
the ₱200 lands on the first or last txn of the course is **open question H8**.

## 9. Dose number is in the LABEL, not `i_DosageCount`

`i_Label` reliably encodes dose sequence:

| marker    |  count |
| --------- | -----: |
| dose_1    | 20,346 |
| dose_2    | 16,525 |
| dose_3    |  9,478 |
| dose_4    |  7,937 |
| dose_5    |    613 |
| booster   |  1,546 |
| no marker |  3,064 |

`i_DosageCount` is almost always "1" — it's the _quantity given this visit_, not
the _sequence position_. The first importer set `doseNumber = i_DosageCount`
(a bug — every order gets dose 1). Fix: parse `(\d+)(?:st|nd|rd|th) Dose` from
`i_Label`.

## 10. ARV-PEP course completeness

Administered ARV-PEP dose count per patient (8,924 patients with ≥1 ARV-PEP imm):

| doses administered | patients |
| -----------------: | -------: |
|                  0 |       14 |
|                  1 |    1,571 |
|                  2 |    1,275 |
|                  3 |    2,571 |
|                  4 |    3,241 |
|                  5 |      165 |
|                  6 |       73 |
|                7–8 |       14 |

3,241 complete 4-dose courses; 5,417 partial. The importer synthesises one
`patient_standing_orders` row per course (60-day-gap clustering splits
multi-bite patients). Whether 60 days is the right split threshold is **open
question H11**.

## 11. Cross-patient "group drive" transactions

68 transactions span multiple patients (one bills **77 patients, ₱90,650**). All
labeled `"… - Multiple Patients - …"`, mostly `VIRT` (Virtual-branch corporate
vaccination drives). `t_PatientRef` is a comma-list. The importer currently takes
the first patient → mis-attributes the other 76. **Open question**: split per-patient
(each patient's `i_PatientRef` immunizations → their own transaction) or keep one
group transaction. This is orthogonal to the per-vaccine split problem (§6).

## 12. Date anomalies

86,883 immunization timestamps; 26 out of range (0.03%):
`1970`×9 (epoch-coerced nulls), `2001`×8, `2016`×2, `2027`×5, `2028`×1, `2520`×1.
The importer must clamp **both** ends (pre-2024/epoch → null; >export+2y → clamp to
export+1y) and warn. The first importer only clamped the future.

## 13. Branch activity (for is_active classification)

| branch     | last imm    | imm count |
| ---------- | ----------- | --------: |
| Timog      | 2026-12     |    15,995 |
| HolySpirit | 2026-12     |    15,360 |
| Salcedo    | 2026-12     |     7,337 |
| Aguirre    | 2026-10     |     6,176 |
| Taguig     | 2026-11     |     4,316 |
| Maysilo    | 2026-11     |     3,307 |
| SanJuan    | 2026-11     |     2,398 |
| Marikina   | 2026-12     |       981 |
| Pasig      | (2027 typo) |       657 |
| Cainta     | 2026-11     |       652 |
| Virtual    | 2026-06     |       409 |
| Novaliches | 2026-10     |       370 |
| Alabang    | 2026-06     |        15 |

11 clearly active; Virtual + Alabang low/stale — candidates for `is_active=false`
(ops confirm). Note the receipt-label sequence (`HS2032`) is **NOT gapless** —
HS alone has 4,476 gaps + 5 dups — so legacy receipt numbers cannot become
`branch_seq`; assign fresh gapless seq and keep the label as a reference field.

---

# Round 2 (2026-06-04) — hypothesis tests + new dimensions

## 14. PEP schedule adherence — actual ≈ ideal (administer action stamps it)

For 9,567 administered Anti-Rabies-PEP doses, `i_Timestamp_Actual − i_Timestamp_Ideal`:
median 0d, p90 0d, p99 0d, range −20…+27. **99.4% are on-time (±1d)**; only 21
rows late >3d. Interpretation: the administer action stamps `actual = ideal`, so
`actual` is NOT an independent observation of when a dose was given — it's the
scheduled date confirmed at administration. **Consequence: the 60-day PSO
course-split threshold is very safe** (real same-course doses are days apart, not
months). Don't try to mine "late administration" from historical actual-vs-ideal.

## 15. H13 — route consistency within PEP courses ✅ mostly clean

Of 8,924 patients with IM/ID ARV-PEP doses: **8,862 single-route (99.3%)**, **62
mixed IM+ID**. Of the 62: 46 have all doses within 30 days (genuine mid-course
route switch — e.g. started ID, switched to IM on supply), 8 are >60 days apart
(two separate bite courses — the 60-day split already separates them). The
single-template-per-course assumption holds for 99.3%; for the 46 mid-course
switches the PSO template uses the **first dose's route** (defensible default) —
flag them for review.

## 16. H12 — cancelled-or-missed: 93% truly cancelled

2,551 cancelled-or-missed rows (2024+, past-dated, not administered). **2,366
(93%) are truly cancelled** (no later administered dose of the same vaccine for
that patient). **185 (7%) look rescheduled** — the patient has a same-vaccine dose
administered within 90 days after the missed ideal date. Refinement: the 185
could be dropped (the later row is the real dose) — minor; default is to import
all as `Cancelled` and let the later `Completed` row stand alongside.

## 17. H10 — dose-2+ rows: Bot 1 fan-out confirmed

Dose-2+ rows by nurse: **13,269 have NULL nurse** (= future-scheduled, created by
Bot 1 fan-out, not yet administered), the rest carry the administering nurse
(RoberosePuri 2,426, LorraineRosario 1,792, …; AppSheetAdmin only 883). Confirms
the status model: NULL-nurse + future date = `Scheduled`; named nurse +
administered = `Completed`. No manual-entry inconsistency to worry about.

## 18. Patient data completeness

| field           | present                                                             | note                                         |
| --------------- | ------------------------------------------------------------------- | -------------------------------------------- |
| first/last name | ~100%                                                               |                                              |
| date of birth   | 99.9%                                                               | 30 implausible (age <0 or >120) → clamp/null |
| gender          | 99.9%                                                               |                                              |
| home address    | 98.2%                                                               |                                              |
| branch          | 99.9%                                                               |                                              |
| contact number  | 95.4% present; **88% valid PH-mobile**                              | 12% junk/landline                            |
| **email**       | **33% present; only ~34% of those valid → ~11% of patients usable** |                                              |

**Notification implication: SMS-first.** Email reaches ~11% of patients —
`email_opt_in` should default false; SMS is the channel. 30 implausible DOBs need
clamping before they hit `date_of_birth`.

## 19. Remarks clinical content — keep as legacyNotes, flag ~200 for review

5,863 non-empty remarks (median 28 chars). Pattern hits:

| pattern                   |     hits |    % |
| ------------------------- | -------: | ---: |
| refused/declined          |      379 | 6.5% |
| prior dose / other clinic |      342 | 5.8% |
| Hx / history              |      127 | 2.2% |
| paid/payment              |      110 | 1.9% |
| DM / diabetes             |       61 | 1.0% |
| allergy                   |       17 | 0.3% |
| HTN, pregnant, adverse    | <10 each |      |

The ~205 rows mentioning allergy/Hx/DM/HTN are candidates for
`patient_allergies`/`patient_conditions`, and the 342 "prior dose/other clinic"
for `patient_external_immunizations`. **Recommendation: do NOT auto-parse
free-text clinical notes into structured tables (too error-prone for clinical
data).** Keep all in `onboarding_data.legacyNotes` per C3, but emit a
`LEGACY_NOTE_NEEDS_CLINICAL_REVIEW` tag for the ~205 condition-mentioning patients
so a clinician structures them post-cutover.

## 20. H17 — branch-email resolution: 86%, 3 aliases missing 🔴 bug

NurseShift branch resolution: 2,737/3,184 (86%) resolve. The 447 unresolved (14%)
are 3 missing aliases:

| email suffix | count | maps to                                                  |
| ------------ | ----: | -------------------------------------------------------- |
| `abf`        |   271 | Aguirre (its receipt prefix is ABF — "Aguirre BF Homes") |
| `nova`       |   167 | Novaliches                                               |
| `alabang15`  |     9 | Alabang                                                  |

**Fix `transform/shifts.ts` `BRANCH_BY_EMAIL_SUFFIX`**: add `abf→Aguirre`,
`nova→Novaliches`, `alabang15→Alabang`. Currently 447 staff-time-log rows are
silently dropped.

## 21. Payer landscape 🔴 two dominant HMOs unmapped

ChargeAccounts by partner (the importer's `mapPayerCode` coverage):

| account            | txns |     ₱ due | mapped?                |
| ------------------ | ---: | --------: | ---------------------- |
| **Intellicare**    |  679 | 3,385,900 | **NO** 🔴              |
| **Avega**          |  238 | 1,075,100 | **NO** 🔴              |
| Ayala Malls (UPTC) |   76 |   194,370 | yes                    |
| Hati Health        |   29 |    96,525 | yes                    |
| SureVax            |   15 |    13,430 | no (self-pay → null)   |
| Ayala Malls        |   10 |    72,380 | yes                    |
| Forticare          |    7 |    17,000 | yes                    |
| MedAsia            |    6 |     6,300 | yes                    |
| Luis Sia           |    4 |     3,800 | no (individual → null) |

**The two biggest partner payers — Intellicare (₱3.39M) and Avega (₱1.08M),
together 917 transactions / ₱4.46M AR — are NOT mapped.** The importer would set
`payer_id=null` for all 917, losing the partner attribution. **Required: seed
`PAYER_INTELLICARE` + `PAYER_AVEGA` (both HMO type), add both to
`mapPayerCode`.** `SureVax`/`Luis Sia` are internal/individual → leave `payer_id`
null (self-pay). Reconciliation status across all charge accounts: 974 Matched,
90 MISMATCH (8.5%).

## 22. Vaccine usage + transaction value distribution

Service usage by `v_Type` (this is overwhelmingly a rabies/tetanus bite clinic):
ARV-PEP 33,035 · Tetanus Toxoid 14,762 · ARV-Booster 2,175 · ERIG 1,679 ·
ARV-PrEP 1,606 · Service (consult/medcert) 1,156 · Flu 953 · ATS 950 · HRIG 363 ·
HTIG 241 · then a small tail (Chickenpox, TDAP, Hep, Pneumonia, MMR, HPV,
Shingles all <140). The 1,829 `<unmapped>` are the Consultation/MedCert rows the
catalog sibling-RowID fix resolves. **Validates seeding the rabies SOT templates
as the priority.**

Transaction value: 33,142 positive, 49 zero (comped), 1 negative (refund). Min
₱100, median ₱800 (one ARV dose), p90 ₱1,800, p99 ₱10,000, max ₱183,600. The 6
txns >₱50k are all corporate "Multiple patients" group drives (PrimeTech,
Teltrend, PayMongo, VIRT) — see §11 cross-patient handling.

## Round-2 correction summary (feeds DESIGN "not yet applied")

| #   | Correction                                                                   | Severity | Rows affected       |
| --- | ---------------------------------------------------------------------------- | -------- | ------------------- |
| R1  | Seed `PAYER_INTELLICARE` + `PAYER_AVEGA`; add to `mapPayerCode`              | 🔴 high  | 917 txns / ₱4.46M   |
| R2  | Add `abf`/`nova`/`alabang15` branch-email aliases in shifts.ts               | 🔴 high  | 447 shift rows      |
| R3  | `email_opt_in` default false (SMS-first); clamp 30 implausible DOBs          | medium   | ~30 + notifications |
| R4  | Tag ~205 condition-mentioning patients `LEGACY_NOTE_NEEDS_CLINICAL_REVIEW`   | low      | ~205                |
| R5  | Flag 46 mid-course route-switch PEP patients (PSO uses first-dose route)     | low      | 46                  |
| R6  | `SureVax`/`Luis Sia` charge accounts → `payer_id` null (self-pay/individual) | low      | 19                  |

---

# Round 3 (2026-06-04) — grounded against AppSheet metadata

Cross-referenced the round-2 data findings against the AppSheet app definition
(`docs/audits/2026-05-17-appsheet-conformance/columns_parsed.json` +
`appdoc.txt`). The metadata explains _why_ the data looks the way it does and
corrects how the importer should read payers.

## 23. The payer is `t_MiscPaymentType`, not ChargeAccounts 🔴 design correction

The audit metadata shows `Transaction.t_MiscPaymentType` is an **Enum with a
closed 11-value list** (`AllowOtherValues:false`), shown + required exactly when
`t_AmountPaid_Misc > 0`:

```
Ayala Malls (UPTC), Luis Sia, Hati Health, Intellicare, Avega, MedAsia,
Forticare, Philbritish, SureVax, Lacson & Lacson Insurance Brokers Inc.,
Wellcare Health Maintenance
```

Data confirms **perfect referential integrity**: 0 rows with misc-amount>0 and no
payer type; 0 rows with payer type and misc-amount≤0. So **`t_AmountPaid_Misc` IS
the partner-settled amount and `t_MiscPaymentType` names the payer** — the
authoritative per-transaction payer signal.

Actual usage (transaction counts / ₱ misc-paid):

| payer                     | txns |    ₱ misc | note                                         |
| ------------------------- | ---: | --------: | -------------------------------------------- |
| Intellicare               |  367 | 1,007,986 | HMO                                          |
| Avega                     |  117 |   289,350 | HMO                                          |
| Ayala Malls (UPTC)        |   49 |    76,770 | + 3 free-text "Ayala Malls" rows → normalise |
| Hati Health               |   24 |    74,075 | also a Vaccine-catalog partner-rate          |
| SureVax                   |   15 |    13,430 | internal/self → `payer_id` null              |
| MedAsia                   |    5 |     5,650 |                                              |
| Forticare                 |    4 |     8,000 | also a catalog partner-rate                  |
| Luis Sia                  |    3 |     2,700 | individual → `payer_id` null                 |
| Philbritish/LLBI/Wellcare |    0 |         0 | defined in enum, never used in data          |

**Importer correction (supersedes R1):** set `transactions.payer_id` from
`t_MiscPaymentType` (normalising "Ayala Malls" → "Ayala Malls (UPTC)"), NOT from
ChargeAccounts. Seed payer profiles for the **used** payers (Intellicare, Avega,
Ayala Malls, Hati Health, MedAsia, Forticare); SureVax + Luis Sia → null
(self-pay/individual). Philbritish/LLBI/Wellcare may be seeded for completeness
but carry zero historical rows. `t_AmountPaid_Misc` becomes a `payments` row
representing the partner settlement.

## 24. ChargeAccounts is a derived reconciliation view (≡ the 587 misc txns)

ChargeAccounts has 1,064 rows but only **587 distinct `Transaction ID`s** — it's
exploded one row per immunization line. Those 587 ids are **exactly** the set of
transactions with `t_AmountPaid_Misc > 0` (587 ≡ 587, 0 difference either way).
Grounding: ChargeAccounts is `SELECT … FROM Transactions WHERE t_AmountPaid_Misc

> 0`enriched per-item with a`Reconciliation Status`. It is **not** a base table
(absent from `columns_parsed.json`'s 12 real tables). **Use it only for
`payments.reconciliation_status`\*\* (Matched → Cleared, MISMATCH → Mismatch); the
> payer + amount come from the Transaction row itself.

## 25. Transaction column semantics (metadata-confirmed)

| column                         | AppSheet formula / type                                                                                         | grounds                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `t_TransactionValue`           | `sum([t_ImmunizationRef][i_DosagePrice])`                                                                       | forward EnumList link is the billing source of truth                  |
| `t_TransactionValueNonService` | `sum(SELECT(Immunization[i_DosagePrice], AND(IN([Row ID],[t_ImmunizationRef]), [i_VaccineType] <> "Service")))` | the **discountable (vaccine-only) base** — excludes consult/medcert   |
| `t_Adjustment`                 | `IF([t_DiscountRef].[d_Type]="Flat", d_Value, base × d_Percentage)`; Valid_If forbids total < 0                 | signed: negative=discount, **positive=AyalaMalls +15% markup**        |
| `t_TotalAmount`                | `t_TransactionValue + t_Adjustment`                                                                             | discount/markup already materialised → import `t_Adjustment` directly |
| `t_PatientRef`                 | **EnumList** "Patient Name"                                                                                     | metadata-confirms cross-patient group drives are legal (§11)          |
| `t_ImmunizationRef`            | **EnumList** "Immunizations Paid For"                                                                           | metadata-confirms multi-item forward link (§6 / C5)                   |

Discount-base test on 1,285 Senior/PWD (−20%) txns: 167 match `−0.2 × NonService`
where it differs from full value (14 anomalies) — confirms the discountable base
is the non-service portion (relevant for the v2 go-forward discount engine, not
the import, which just carries `t_Adjustment`).

## 26. Branch + cash semantics (metadata-confirmed)

- `Branch.Row ID = [b_Name]` (slug), `b_TransactionInitials` = 3-letter code → branches transformer correct; **Branch has no `is_active` column** (only dropped `b_AllowAccess`), so active/inactive is inferred from data activity (§13).
- `Branch.b_CashBalance = SUM(Transaction.t_AmountPaid_Cash) + SUM(CashBalanceLog…)` → grounds CashBalanceLog as opening-float padding added to cash receipts (the `cash_drawer_sessions.opening_float` mapping is right).

## Round-3 correction summary

| #   | Correction                                                                                                                     | Supersedes           |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| R1′ | Payer from `t_MiscPaymentType` (not ChargeAccounts); normalise "Ayala Malls"→"(UPTC)"; seed used payers; SureVax/Luis Sia→null | R1                   |
| R7  | ChargeAccounts used ONLY for `reconciliation_status` (derived view = the 587 misc txns)                                        | —                    |
| R8  | AyalaMalls markup = **positive** `t_Adjustment`; import `t_Adjustment` signed (already materialised)                           | DESIGN §4 AyalaMalls |

---

# Round 4 (2026-06-04) — cutover blockers + dropped-data validation

## 27. 🔴🔴 Export date is 2026-05-21, NOT 2025-05-21 — confirmed off-by-a-year bug

Administered immunizations p99.9 = **2026-05-20**; transactions p99.9 = max =
**2026-05-20**; min = 2024-07-29. (A single 2026-10-26 administered row is an
outlier/typo.) So the real data cutoff — the export date — is **2026-05-21**,
exactly one year after the importer's hardcoded
`EXPORT_DATE = new Date('2025-05-21')` in `transform/clinicalOrders.ts`.

**Impact:** the status rule is `not administered AND ideal > EXPORT_DATE →
Scheduled, else Cancelled`. With the cutoff a year too early, **every
unadministered dose with an ideal date between 2025-05 and 2026-05 is wrongly
classified `Scheduled` instead of `Cancelled`** — roughly a year of missed/lapsed
doses mislabelled as upcoming. Also the 2-year typo-clamp threshold shifts.

**Fix:** derive the cutoff from the data — `max(administered i_Timestamp_Actual,
txn t_Timestamp)` rounded to the export day — rather than hardcoding. Pass it via
`MigrationContext`. The 60-day PSO course-split and typo-clamp both key off this.
This invalidates the date assumptions baked into the recreated code + its tests.

## 28. 🔴 Consent gap — migrated patients block the clinical-write gate

The source has **no consent sheet** (none of the 17 sheets is consent). v2's
`assertActiveConsent(tx, tenantId, patientId)` (per `.claude/rules` H7) throws
`LifecycleError('Active patient consent required', 'CONSENT_REVOKED', 403)` at the
START of every clinical-write path — `administerOrderTx`, `createLabOrder`,
`createEncounter`, `fanOutBundle`. The importer's direct inserts may bypass it,
but **the first post-cutover action on a migrated patient (e.g. administering the
next PEP dose for a mid-course patient) will fail the gate** because no `consents`
row exists.

**Fix (structural, no source data):** the importer must synthesise one active
polymorphic `consents` row per migrated patient (`scope_ref_type='patient'`,
`revoked_at=NULL`) — exactly what `seed.ts` does for seeded patients. Without it,
migrated patients are clinically frozen. **This is a genuine cutover blocker not
previously surfaced.**

## 29. Paid × administered matrix — AR state + prepaid doses

| state                       |   count | meaning → v2                                                                                      |
| --------------------------- | ------: | ------------------------------------------------------------------------------------------------- |
| administered + paid         |  45,375 | normal Completed + Paid txn                                                                       |
| administered + **not paid** | **664** | AR owed — ≈ the 665 Bot-12-race orphans (§clinicalOrders); `paymentReconciliationRequired`        |
| **not administered + paid** | **223** | **prepaid future doses** — map to `Scheduled` clinical_orders + `transactions.is_prepayment=true` |
| not administered + not paid |  13,247 | normal scheduled-future                                                                           |

The 664 confirms the Bot-12-race count. The **223 prepaid** is a new category (the
FullyPaid-course patients who paid all 4 doses up front) — v2 has first-class
`is_prepayment` + prepaid-item handling; these should set it.

## 30. Dropping ImmunizationBundle loses 19 patients' ERIG (refines A2)

Bundle rows: 4,547; 629 carry an ERIG price (₱1,468,000). Of 609 patients with a
bundle-ERIG entry, **590 have a corresponding ERIG immunization row, 19 do NOT** —
their ERIG administration exists ONLY on the bundle (never fanned out by Bot 9).
A2 ("bundle is staging, drop it") is **97% safe** but would silently lose 19 ERIG
administrations (weight-based, high-value). **Refinement:** import bundle ERIG as
a fallback `clinical_orders` row for the 19 un-fanned-out cases, or at minimum
emit a warning. The other bundle fields (ARV brand/route/site, TT site) are fully
represented in the corresponding Immunization rows.

## 31. Co-administration validates the encounter-collapse model

Same-patient same-day vaccine-family combos: ARV alone 28,614 · TT alone 7,190 ·
**ARV+TT 5,599** · **ARV+ERIG+TT 1,564** (the full bite-victim PEP starter pack =
Bot 9's "bundle") · ARV+ERIG 287 · ERIG alone 180. So 1,851 visits co-administer
ERIG. The synthesised `(patient, branch, day)` encounter correctly groups these
into ONE encounter with multiple `clinical_orders` — confirms the encounter design
and that the Immunization rows (not the bundle table) are the real record.

## 32. Staff + report resolution

- **`i_NurseRef` resolves 100%** (0/45,777 unresolved) → `clinical_orders.administered_by_id` is safe. 87/89 nurse FullName == First+Last (2 minor mismatches).
- **`ns_NurseRef` (full name) — 30 unresolved across 6 names** (~1%): `Kristine Cartonegos`, `Christine Mar Soriano Pagallaman`, `Abegail Joy Victorini`, `Faith Aragob` (typo of Aragon?), etc. — not in the Nurse sheet. Fuzzy-match by last name or skip-with-warning; affects 30 staff_time_logs.
- **BranchReport re-derivation: 2,037/2,062 (98.8%) cash subtotals match** transactions re-derived by (branch, date). 25 mismatch (cross-day cash / CashBalanceLog padding). **C2 (drop + re-derive) validated**; the 25 won't reconcile to the peso but the aggregate is sound.

## Round-4 correction summary

| #   | Correction                                                                                                                  | Severity                      |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| R9  | **Derive `EXPORT_DATE` from data max (≈2026-05-21), not hardcoded 2025-05-21** — fixes Scheduled/Cancelled for ~1yr of rows | 🔴🔴 critical (confirmed bug) |
| R10 | **Synthesise one active `consents` row per migrated patient** — else clinical-write gate freezes them post-cutover          | 🔴 blocker                    |
| R11 | 223 prepaid doses (not-admin + paid) → `Scheduled` + `transactions.is_prepayment=true`                                      | medium                        |
| R12 | Import bundle ERIG fallback for the 19 un-fanned-out patients (refines A2)                                                  | medium                        |
| R13 | 30 NurseShift names unresolved → fuzzy-match by last name or skip-with-warning                                              | low                           |

---

# Round 5 (2026-06-04) — residual data-quality gaps + out-of-scope inventory

The cheap remaining checks, resolved so nothing lives only in conversation.

## 33. The 13 "OTHER" patient Row IDs — 6 are corrupted dates

Enumerated: 5 are `pYItuJJO9WsBEBMxuKoMcG1…5` (23-char UNIQUEID + digit suffix —
test/dup-looking); `A03189`, `R0A6385`, `K.K8788` (malformed initials); and **6
are dates written into the ID column**: `4007-03-01`, `5333-03-01`, `5427-02-01`,
`6373-04-01`, `8772-03-01`, and `K.K8788`. These rows still import (they have
name/DOB; the legacy id is dropped per A3) — flag as data-quality, no blocker.

## 34. Key integrity — essentially clean

Duplicate Row IDs within a sheet: Patient 0, Transactions 0, Vaccine 0, Branch 0,
Nurse 0, Remarks 0; **Immunization has exactly 1 duplicate key**
(`lEBmC1bYax4XYx2mcEu2M2` ×2). ON CONFLICT handles it. Referential-key integrity
across the export is excellent.

## 35. Minors — 1,972 (15.8%), zero guardian data in source 🟡 compliance gap

1,972 of 12,443 valid-DOB patients are minors (<18); 84 are under 2. **The Patient
sheet has NO guardian/parent columns** — but v2 has
`guardian_name`/`guardian_relationship`/`guardian_contact`. So all 1,972 migrated
minors land with **null guardian fields**. Not an import blocker, but a clinical/
DPA gap: guardian consent + contact must be collected for minors post-cutover.

## 36. OSCA/PWD ID numbers — not captured 🟡 BIR gap

No Transaction or Discount column holds the senior/PWD ID number; only 19 free-text
remarks mention an OSCA/PWD number. So `transactions.discount_id_number` stays a
placeholder (`SENIOR_LEGACY`/`PWD_LEGACY`). BIR requires the actual ID number on
discounted receipts — it's **unrecoverable from this export**; ops must accept the
historical gap or backfill.

## 37. Fractional dosing (documented; no action — inventory dropped)

Vaccine `v_DosageAmount` by route: ID = 0.1/0.2 ml (fractional — shared-vial via
FEFO), IM = 0.5/1.0 ml, SC = 0.5 ml. Confirms the ID-route shared-vial clinical
fact and the `requires_dose_calculation` services (ERIG/HRIG weight-based). Moot
for this migration (inventory dropped, D1) but recorded for the eventual
inventory-tracking phase.

## Round-5 correction summary

| #   | Correction                                                                                 | Severity           |
| --- | ------------------------------------------------------------------------------------------ | ------------------ |
| R14 | Flag 6 patients with corrupted date-in-ID Row IDs (+ ~7 malformed) — import OK, id dropped | low (data quality) |
| R15 | 1 duplicate Immunization Row ID → ON CONFLICT dedup                                        | low                |
| R16 | 1,972 minors land with null guardian fields (no source data) — collect post-cutover        | 🟡 compliance      |
| R17 | OSCA/PWD ID numbers not in source → `discount_id_number` placeholder (BIR historical gap)  | 🟡 compliance      |

---

# Deliberately out-of-scope / not analysed (durable gap inventory)

Recorded so the boundary of this analysis is explicit, not implied-complete.

| Area                                                                   | Status       | Why                                                                                                                       |
| ---------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Inventory stock movements / negative inventory (InventoryLog 176 rows) | not analysed | D1 — inventory not tracked yet; sheet dropped                                                                             |
| TimeLog raw clock events (2,377 in June; 2,376 latest)                 | not analysed | C1 revised — union/dedupe with NurseShift only if optional attendance history is imported                                 |
| DataRequests (2 rows)                                                  | not analysed | test rows; dropped                                                                                                        |
| Per-branch growth curves / seasonality                                 | not analysed | not migration-relevant (volume baseline already in §13/§3)                                                                |
| Free-text address parsing → region/province/city/barangay              | not analysed | v2 has structured address cols; legacy is one free-text `p_HomeAddress` → import as `address`, leave structured cols null |
| `i_DosageAmount` (cc consumed per dose) reconciliation vs inventory    | not analysed | inventory dropped (D1)                                                                                                    |
| Attachment/file columns beyond health-card (none found)                | n/a          | only `p_HealthCard` (dropped, B2)                                                                                         |
| Real PSO day-offset validation vs SOP PDF appendix                     | deferred     | needs clinical sign-off (open in remaining-todos)                                                                         |
| Vaccine `v_DosageVial` exact vial sizing                               | not analysed | inventory dropped (D1)                                                                                                    |
| BIR receipt-number continuity (legacy `HSxxxx` non-gapless)            | analysed §13 | fresh gapless `branch_seq`; legacy label kept as reference                                                                |

---

# Round 6 (2026-06-04) — verification + self-cross-check

Audited prior rounds for claims asserted-but-not-verified and cross-checked the
counts. Two corrections to earlier numbers, two new code gaps.

## 38. 🔴🔴 Export-date bug quantified — and it corrects earlier rounds

Re-ran the status split under both cutoffs (administered → Completed regardless):

| cutoff                                  | Scheduled |  Cancelled |
| --------------------------------------- | --------: | ---------: |
| WRONG `2025-05-21` (what the code uses) |    10,867 |      2,570 |
| RIGHT `2026-05-21` (real export)        | **1,721** | **11,716** |

**9,146 clinical_orders flip Scheduled→Cancelled when fixed.** So the true
future-scheduled count is **1,721, not the ~10,687** quoted in the original
round-1 orphan tally and the `clinicalOrders.ts` status-mapping comment (both
computed with the wrong 2025 cutoff — now corrected in the code comment).
Authoritative status distribution after the fix:
**Completed ≈ 46,039 · Scheduled ≈ 1,721 · Cancelled ≈ 11,716.** Confirmed the
bug is live in code: `transform/clinicalOrders.ts:30` `EXPORT_DATE =
new Date('2025-05-21T00:00:00Z')`. (Reinforces R9.)

## 39. 🔴 `v_Type = 'Other'` (21 rows) is not in the catalog map — silent drop

`TYPE_TO_SERVICE_CODE` covers every vaccine type in the data **except `Other`**
(21 immunizations) — those resolve to no service → the clinical_order and its
transaction_item are silently dropped. Fix: map `Other → SVC_OTHER` (or
explicit skip-with-warning). New correction **V1**.

## 40. 8 lab-panel-string refs truly unresolvable; ~29 items lost total

After the Consultation/MedCert sibling-RowID fix, the only remaining unresolvable
`i_VaccineRef` is a diagnostic panel referenced by its **name string**
("Complete Blood Count (14 Panel), Urinalysis (10 Panel), …") on 8 rows. Combined
with the 21 `Other` rows, **~29 transaction_items (and their clinical_orders)
would be dropped** — should be skip-with-warning, not silent. New correction **V2**
(name-match seeded bundle or warn).

## 41. Encounter volume confirmed: 44,189

The `(patient, branch, day)` collapse produces **44,189 encounters** from 59,509
immunizations (avg 1.35 imm/encounter) — the real insert volume for the
encounters stage (no prior verified number existed).

## 42. Branch codes — 14 unique, all from real initials (ABF = Aguirre)

Simulating the transformer: 14 branches → **14 distinct 3-letter codes**, all
taken from real `b_TransactionInitials` except `TestBranch` (initials `TEST` is
4 chars → synthesised `TES`; TestBranch should be inactive/dropped). Full set:
HST, TMG, **ABF (Aguirre)**, TAG, SAL, MYS, SJN, CNT, MRK, NOV, PSG, ALB, VRT.
**ABF = Aguirre confirms R2** (the `abf` NurseShift email suffix → Aguirre). The
importer should use these real codes, not synthesise.

## 43. Dedup triple-match catches only 5 of 15 mixed-format dups

The importer's `(name, DOB, phone)` rule finds 43 duplicate groups (44 rows
merged) but catches **only 5 of the 15 known cross-format duplicates** — the other
10 have a different/missing phone between their two records, so the strict triple
won't merge them. This is the **safe floor** (zero false merges); loosening to
name+DOB would catch all 15 but risks false-merging the 62 name+DOB-only groups
that are NOT the same person (siblings, shared DOB). **Recommendation:** keep the
strict triple as the auto-merge; emit the 10 phone-mismatch near-matches as
`POTENTIAL_DUPLICATE` for manual review rather than auto-merging. New note **V3**.

## 44. Weight-based services — single catalog list-price is nominal

ERIG ₱400–10,000, HRIG ₱10,000–50,000, ATS ₱400–1,600, HTIG ₱2,000–4,000 (price
scales with patient weight). The importer's `transaction_items.unit_price` uses
the per-row `i_DosagePrice` snapshot ✓ (correct), but `transform/catalog.ts`
emits **one nominal `service_prices` list-price** for these `requires_dose_calculation`
services — which would mislead the v2 pricing engine if it ever reads it as
authoritative. **V4:** mark these services `requires_dose_calculation=true` and
suppress / nominal-flag the single list-price.

## 45. MRN sequencing clean

**0 of 12,469 patients have a null/invalid `p_DateFirstVisit`** → the
chronological MRN allocation has a clean anchor for every patient, no
arbitrary-order tail. (Earlier worry unfounded.)

## Round-6 correction summary

| #   | Correction                                                                                         | Severity        |
| --- | -------------------------------------------------------------------------------------------------- | --------------- |
| V1  | Map `v_Type='Other'` (21 rows) → `SVC_OTHER` or explicit skip-with-warning (currently silent drop) | 🔴 (was silent) |
| V2  | 8 lab-panel-string refs → name-match seeded bundle or skip-with-warning (~29 items lost with V1)   | medium          |
| V3  | Keep strict triple dedup (catches 5/15 mixed-format); flag the 10 phone-mismatch ones for review   | medium          |
| V4  | Weight-based services: suppress/nominal-flag the single `service_prices` list-price                | low             |

**Superseded numbers:** the round-1 orphan tally's "~10,687 future-scheduled /
~3,099 cancelled" (and the matching `clinicalOrders.ts` comment) were computed
with the wrong 2025 cutoff — use §38's **1,721 Scheduled / 11,716 Cancelled**
instead.

---

# Round 7 (2026-06-19) — workbook re-pass to resolve open questions

Re-ran the profiler against `surevax_gsheet_db.xlsx` to answer the still-open
items in OPEN-QUESTIONS. Q6/Q7/Q9/Q12 are now **resolved** (moved to
`DECISIONS.md`); Q2/Q4/Q8 are **quantified** (annotated in OPEN-QUESTIONS). One
new data-quality finding:

## 46. 🟡 2,076 immunizations have a blank `i_BranchRef`

Branch attribution across all 60,049 immunizations: the 13 named branches carry
the rest, but **2,076 imms (3.5%) have an empty `i_BranchRef`**. v2 requires
`clinical_orders.branch_id NOT NULL` (PHI tables are branch-scoped under FORCE
RLS), so these rows **cannot import branch-less**. The importer must backfill
branch from a fallback chain — the linked transaction's `t_BranchRef`, else the
patient's first `p_Branch` — and warn on any residual that still can't resolve.
New correction **R18**.

## Confirmations (no code change — recorded for traceability)

- **Discount codes** exactly as §8: 1,699 Senior, 938 PWD, 61 FullyPaid, 29 DMCI, 25 QCID, 24 AyalaMalls, 3 BFP, 1 PPSV3, 1 `Employee` (stale → drop). `t_DiscountRef` IS the discount Row ID; `FullyPaid`'s display name is "Fully Paid".
- **FullyPaid placement (Q9):** of 61 FullyPaid txns, 43 are the patient's only txn, 14 are the first, 2 last, 2 middle; the FullyPaid txn carries 4–5 items (the whole course) → ₱200 belongs on the **up-front/first** transaction.
- **`b_AllowAccess` = False on every branch** — the legacy shared-access flag was never used; safe to drop in v2.
- **Export cutoff** re-confirmed ≈ 2026-05-20/21 (max administered date; one stray 2026-10-26 typo at Salcedo) — reinforces R9.

## Round-7 correction summary

| #   | Correction                                                                                   | Severity              |
| --- | -------------------------------------------------------------------------------------------- | --------------------- |
| R18 | Backfill blank `i_BranchRef` (2,076 imms) from txn branch → patient branch; warn on residual | 🟡 medium — unapplied |
