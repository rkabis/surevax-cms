# AppSheet → SureVax CMS Conformance Audit (2026-05-17)

Archived source-of-truth artifacts for the migration audit performed on
2026-05-17. The audit verified the new CMS covers every workflow of the
old AppSheet-based system (`ABTC clinic management app`, Philippines).

> **Where to go next:** the original wave-by-wave scope derived from this
> audit is archived at
> [`../../handovers/archive/2026-05-17-post-audit-next-waves.md`](../../handovers/archive/2026-05-17-post-audit-next-waves.md)
> (all waves shipped 2026-05-18 → 2026-05-19). Remaining follow-ups live
> in [`../../handovers/archive/2026-05-19-remaining-todos.md`](../../handovers/archive/2026-05-19-remaining-todos.md)
> (consolidated into [`../../STATUS.md`](../../STATUS.md)).
> Read those for what to _do_; read this folder for the _why_ and the
> as-was reference.

## Files in this archive

### Audit deliverables

| File                                                                         | Purpose                                                                                                                                                                                            |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`SureVaxCMS_Conformance_Checklist.md`](SureVaxCMS_Conformance_Checklist.md) | **The marked-up audit result.** Row-by-row ✅ Match / ⚠️ Different / ❌ Missing / 🗑️ Drop with Δ Notes citing file paths in this repo. Includes Section 8 pre-migration decisions. **Start here.** |
| [`SureVaxCMS_Audit.md`](SureVaxCMS_Audit.md)                                 | The narrative "why" behind each old workflow — bot conditions, action semantics, view rationale. Reference when a checklist row needs context.                                                     |
| [`SureVaxCMS_Schema_Reference.md`](SureVaxCMS_Schema_Reference.md)           | Field-by-field schema mapping from AppSheet tables to the new Drizzle schema.                                                                                                                      |
| [`security_filters.md`](security_filters.md)                                 | Permission-rule equivalence: AppSheet's `IN(USEREMAIL(), AdminEmails[Email])` patterns mapped to the new `requireRole` + `user_roles` model.                                                       |
| [`_audit_inventory.md`](_audit_inventory.md)                                 | The original inventory the audit was built from — entry-points for each AppSheet object class.                                                                                                     |
| [`README.md`](README.md)                                                     | The audit owner's intro doc shipped with the original handover packet.                                                                                                                             |

### Raw AppSheet exports (reference)

| File                                         | Purpose                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [`appdoc.html`](appdoc.html)                 | Full AppSheet app definition (5 MB). The canonical export.                                              |
| [`appdoc.txt`](appdoc.txt)                   | Text rendering of `appdoc.html` for grep / formula spot-checks.                                         |
| [`actions_parsed.json`](actions_parsed.json) | Structured JSON of all user-triggered actions (~30 entries). Used to derive `_SD` dose-creator offsets. |
| [`columns_parsed.json`](columns_parsed.json) | Structured JSON of all table columns + formula definitions.                                             |
| [`views_parsed.json`](views_parsed.json)     | Structured JSON of all UI views (16 entries).                                                           |

### Clinical source documents

| File                                                                                             | Purpose                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`standing-order-rabies-vaccines-2025-09-22.pdf`](standing-order-rabies-vaccines-2025-09-22.pdf) | Animal Bite Center clinical SOP (2025-09-22). Source for all 23 standing-order templates seeded in `apps/backend/src/shared/db/seed/standing-orders.ts`. Pages 2–13 = rabies/TT/ATS/RIG protocols; pages 14–16 = appendix (cholera, Hep A/B, HPV, MMR, TDAP, Shingles, Varicella, Flu). |
| [`standing-order-abc-2025-09-22.pdf`](standing-order-abc-2025-09-22.pdf)                         | "ABC" (Animal Bite Center) variant of the same SOP. Identical clinical content; preserved for traceability.                                                                                                                                                                             |

## Audit roll-up (as of 2026-05-17)

- **Bots (12):** 2 ✅ Match, 2 ⚠️ Different, 8 ❌ Missing (4 are out-of-scope non-rabies templates; 2 are genuine missing features — B10 reciprocal inventory, B11 health card)
- **Actions (~28):** 7 ✅, 4 ⚠️, 12 ❌, 5 🗑️ (pet-related, all re-classified as biting-animal observation per Wave 1.1)
- **Views (16):** 8 ✅, 4 ⚠️, 3 ❌, 1 🗑️
- **Slices (6):** 3 ✅, 1 ⚠️, 1 ❌, 1 🗑️
- **Security (7 rules):** 3 ✅, 4 ⚠️ (branch-scoping below tenant level — addressed in Wave 2.1 RLS)
- **Special behaviors (16):** 6 ✅, 5 ⚠️, 4 ❌, 1 🗑️
- **Standing-order templates:** 23 seeded (rabies + tetanus + adjuncts + appendix vaccines). Pneumococcal blocked on catalog entries.

## How to navigate this from a fresh session

1. Read [`SureVaxCMS_Conformance_Checklist.md`](SureVaxCMS_Conformance_Checklist.md) Sections 1–7 for the marked-up audit, Section 8 for decision context.
2. Read [`../../handovers/archive/2026-05-17-post-audit-next-waves.md`](../../handovers/archive/2026-05-17-post-audit-next-waves.md) for the original wave-by-wave scope (all shipped 2026-05-18 → 2026-05-19).
3. Reference the raw exports (`appdoc.*`, `*_parsed.json`) only when a specific Δ Note needs verification against AppSheet's original definition.
