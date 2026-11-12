# AppSheet Cross-Check + Data Pass — 2026-06-19

> A full re-audit of the legacy AppSheet system against the current CMS, grounded
> in **both** authoritative sources: the app-definition export (`appdoc.txt`) and
> the live data export (`surevax_gsheet_db.xlsx`, profiled directly). Supersedes
> the summarized findings where they diverged. The headline below — **CMS
> capabilities the live data proves are needed but not yet coded** — is the part
> that feeds the product backlog; everything else updates the migration record.

**Inputs:** conformance audit `docs/audits/2026-05-17-appsheet-conformance/` (incl. raw `appdoc.txt`) · migration analysis `docs/migration/appsheet/` · the live workbook `~/Downloads/surevax_gsheet_db.xlsx` (60,049 imms · 33,192 txns · 12,469 patients; **not** in repo — PHI). **Tree:** rebased onto `main` @ d5d961e (through PR #575).

---

## TL;DR

1. **Feature conformance is essentially complete** — 0 go-live blockers remain from the AppSheet audit. The legacy feature set is covered, consciously dropped, or specced-and-deferred (see the conformance checklist §9 source-grounded pass).
2. **The live data exposes a handful of CMS capabilities that are not yet coded** — the two biggest are money-side and partner-driven: **group/corporate billing** and an **AR/receivables reporting surface** (together they govern ₱4.5M+ of real partner revenue). **SMS reminders** is the operational must-have the email-coverage data exposes (promote from STATUS.md's owner-deferred list to P1).
3. **Several migration open-questions are now answered from the data** (Q6/Q7/Q9/Q12 resolved; Q2/Q4/Q8 quantified) and **5 new behavior-parity decisions** were filed (Q17–Q21).

---

## 1. CMS capabilities the live data implies are NOT yet coded

These are feature gaps the actual data proves are real (distinct from importer tasks). Priority is by data materiality.

| Data signal                                                                                                                | Implied CMS capability                                                                                                           | Current state                                                                                                                                                                               | Priority                |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 69 multi-patient txns, one bills **80 patients / ₱90,650**; corporate drives (VIRT) + HMO partners (DATA-ANALYSIS §11, Q2) | **Group / corporate billing** — one invoice spanning N patients with a single payer settlement                                   | `transactions.patient_id` is a single FK; no group-invoice model. Importer is forced to split per-patient, losing the grouping                                                              | **High**                |
| 709 administered-but-unbilled doses ≈₱696k (Q8) + Intellicare ₱3.39M + Avega ₱1.08M = **₱4.46M partner AR** (§21/§23)      | **AR surface** — an "administered-but-unbilled" worklist + **AR-aging-by-payer** report + a `paymentReconciliationRequired` flag | Plumbing exists (`payer_id`, `payments.reconciliation_status`, claims module) but **no reporting/worklist surface** (`ReportsPage` still ComingSoon); the reconciliation flag has no column | **High**                |
| Only **~11% of patients have usable email**; 88% valid PH mobile (§18)                                                     | **SMS** as the _primary_ reminder channel                                                                                        | Notifications module + `email_opt_in=false` exist, but the **SMS gateway sits in STATUS.md's owner-deferred list**. For a PEP clinic, dose reminders ARE the product                        | **Promote to P1**       |
| 77 duplicate (name,DOB) groups, 15 cross-format (§3)                                                                       | **Patient-merge workflow** + a "potential duplicates" review queue                                                               | `merged_into_id` + `POTENTIAL_DUPLICATE` tag exist in schema; no operational **merge UI**                                                                                                   | Medium                  |
| 9 imms billed on 2 txns each (Q4)                                                                                          | **Double-billing guard** — prevent one `clinical_order` on >1 active `transaction_item`                                          | Items link `clinical_order_id`, but the uniqueness guard is unverified — the legacy duplicate-charge pattern can recur                                                                      | Medium                  |
| 1,972 minors (84 under-2), **zero guardian data** in source (§35)                                                          | **"Guardian data needed" flag + collection prompt/worklist** for minors                                                          | `guardian_*` columns exist; no surfaced worklist to chase the gap at next visit                                                                                                             | Medium (DPA/clinical)   |
| 342 "prior dose / other clinic" remarks (§19)                                                                              | **External-immunization capture UI** (continuity for courses started elsewhere)                                                  | `patient_external_immunizations` table exists; capture/display UI likely partial — verify                                                                                                   | Medium                  |
| OSCA/PWD ID numbers never captured; **BIR requires them** (§36)                                                            | **Enforce `discount_id_number` capture** when a senior/PWD discount is applied                                                   | Column exists; go-forward validation likely not enforced                                                                                                                                    | Medium (ties to BIR P0) |
| ₱200 "Fully Paid" on 61 up-front course payments (Q9)                                                                      | **Course-prepayment incentive rule** (pay all doses → auto ₱200 off)                                                             | `is_prepayment` + discount `Other` exist; today it'd be a manual discount                                                                                                                   | Low                     |

**Reinforced (already-known) gaps:** the **reporting surface** (V14 brand analytics _and_ the AR report above both live in the stubbed `ReportsPage`); the **cash-deposit ledger** (A1/Q21); **calendar-month dose scheduling + late-patient cascade** (Q17/Q18); **discount-base service-exclusion** (Q19).

**The through-line:** the two biggest un-coded capabilities are both money-side and partner-driven — **group/corporate billing** and an **AR/receivables reporting surface** — together governing the ₱4.5M+ partner revenue the clinic currently tracks in AppSheet's `ChargeAccounts`/`t_MiscPaymentType`. After those, **SMS reminders**. None block a _cash-only single-clinic_ go-live, but the partner-AR pair blocks running this clinic's actual billing reality.

---

## 2. Migration open-questions resolved / quantified from the data

Recorded in `docs/migration/appsheet/DECISIONS.md` (resolved) and `OPEN-QUESTIONS.md` (quantified):

- **Q9 — FullyPaid ₱200 placement → first/up-front.** 60 patients / 61 txns: 43 single-txn, 14 first, 2 last, 2 middle; the txn bills the whole 4–5-dose course.
- **Q12 — Branch is_active.** Virtual (last 2026-04-30, 409 imms) + Alabang (2026-05-17, 15) → `is_active=false`; 11 others active to the ~2026-05-20 cutoff. **New finding: 2,076 imms (3.5%) have a blank `i_BranchRef`** → importer must backfill from txn→patient branch (DATA-ANALYSIS §46, correction R18).
- **Q6 — 5 unresolved numeric `i_PatientRef`s** are 6–7-digit externals/PhilHealth IDs (not deleted patients) → drop link + warn.
- **Q7 — 51 unresolved `i_TransactionRef`s** (39 distinct) = deleted txns → drop link, imm still imports.
- **Q8 (quantified)** — 709 administered/unbilled imms ≈₱696k (ARV-PEP 320 / TT 145 / Flu 137) → import Completed + `paymentReconciliationRequired`.
- **Q2 (quantified)** — 69 multi-patient txns / ₱549k; 52 are 2-patient, one is 80-patient → split per-patient.
- **Q4 (quantified)** — 9 imms double-referenced across ~5–6 txn pairs → flag `SUSPECTED_DUPLICATE_CHARGE`.

Also confirmed from the data: `b_AllowAccess = False` on every branch (legacy shared-access flag never used → safe to drop); discount-code counts exactly as §8; export cutoff ≈ 2026-05-20/21 (reinforces the R9 off-by-a-year importer bug).

## 3. Conformance-checklist corrections (source-grounded, from `appdoc.txt`)

In the checklist's new **§9** addendum:

- **§6 dose offsets ✅→⚠️** — `_SD` creators schedule TT/Hep/CP/Shingles/TDAP-D3 by **calendar month** (`EOMONTH`, day-of-month preserved), not the seed's fixed 28/30/180-day offsets; ARV PEP uses `SWITCH(DosageCount→offset)` catch-up-to-target. Net on-time dates match; late-patient behavior differs → clinical sign-off (Q17/Q18).
- **Bot 1 "3 unconfigured steps" debunked** — they're configured (set `i_Label`, append remarks, trigger Pet); moot under v2 SOT.
- **Closed since 2026-05-21** (code-verified): all 23 SOT templates seeded; A19 bulk cancel-pending; void/refund; V15 branch detail; `branch_seq`; bite-incident animal observation; AEFI.

## 4. New behavior-parity decisions filed (OPEN-QUESTIONS Q17–Q21)

Q17 calendar-month vs fixed-day dose intervals · Q18 late-patient cascade direction · Q19 discount base = non-service items only · Q20 overpayment policy (AppSheet allowed; v2 rejects) · Q21 cash-deposit-to-bank ledger. Each has a recommendation + owner.

---

## 5. Docs changed in this PR

- `docs/audits/2026-05-17-appsheet-conformance/SureVaxCMS_Conformance_Checklist.md` — §9 source-grounded recheck pass (2026-06-19).
- `docs/migration/appsheet/OPEN-QUESTIONS.md` — Q17–Q21 added; Q6/Q7/Q9/Q12 resolved; Q2/Q4/Q8 quantified.
- `docs/migration/appsheet/DECISIONS.md` — "Resolved from the 2026-06-19 workbook data pass" section.
- `docs/migration/appsheet/DATA-ANALYSIS.md` — Round 7 + §46 (blank-branch) + R18.
- `docs/handovers/2026-06-19-appsheet-data-crosscheck.md` — this doc.

## 6. Suggested sequencing

These are catalogued, not committed to a sprint. For a real-clinic go-live with this clinic's actual billing, the order that maximizes value:

1. **AR/receivables reporting surface** (unbilled-dose worklist + AR-aging-by-payer) — unblocks ₱4.46M partner reconciliation; also retires the `ReportsPage` stub.
2. **Group/corporate billing** — one invoice, N patients, one payer settlement.
3. **SMS reminder gateway** (currently owner-deferred in STATUS.md) — the only channel that reaches patients.
4. Then the hardening set: patient-merge UI, double-bill guard, guardian/external-imm capture, OSCA/PWD enforcement.

Importer-side prerequisites (separate from CMS features) remain as tracked: R9 export-date, R10 consent synthesis, R18 branch backfill, the production `drizzleAdapter` (still a stub), and the seed prereqs (`PAYER_AVEGA`/`PAYER_AYALA_MALLS` + the 3 migration tags).

---

## Cross-references

- [`docs/STATUS.md`](../STATUS.md) — the living status + backlog (single home); the §1 capability gaps feed it · [`docs/ROADMAP.md`](../ROADMAP.md) — roadmap
- [`docs/audits/2026-05-17-appsheet-conformance/SureVaxCMS_Conformance_Checklist.md`](../audits/2026-05-17-appsheet-conformance/SureVaxCMS_Conformance_Checklist.md) — conformance checklist (§9 = this pass)
- [`docs/migration/appsheet/`](../migration/appsheet/) — DATA-ANALYSIS / DECISIONS / DESIGN / OPEN-QUESTIONS
