# SureVax CMS Migration Audit — Handover Package

**Source system:** AppSheet app `SureVaxCMS-270623905` (app ID `e9e1aa25-7584-42e5-bb13-66eb1bbec814`)
**Audit date:** 2026-05-17
**Audited by:** Claude (Cowork mode), as `surevax.admin@gmail.com`
**Purpose:** Verify the new revamped CMS covers every behavior of the old AppSheet system.

---

## Read order

1. **`SureVaxCMS_Conformance_Checklist.md`** ← **START HERE**. Fill-in-the-blanks table. One row per workflow / action / view / slice / gotcha. Mark each row ✅ Match / ⚠️ Different / ❌ Missing / 🗑️ Drop. This is the handoff acceptance artifact.

2. **`SureVaxCMS_Audit.md`** — Full reference doc. Detailed prose on every bot (trigger, condition, steps), every custom action (formula, condition, type), every view (config, action buttons), all 6 slices, format rule, plus migration risk register. Use when the Conformance Checklist row isn't enough context.

3. **`SureVaxCMS_Schema_Reference.md`** — Every column in every user table: type, key/label/hidden/virtual flags, app formulas, initial values. Use for field-by-field schema mapping verification.

4. **`security_filters.md`** — Per-table row visibility rules. Use when wiring up the new CMS role/permission system.

5. **`_audit_inventory.md`** — Pre-audit raw enumeration (12 bots, 117 actions, 16 custom + 46 system-gen views, 16 tables). Useful as a top-level inventory check.

## Reference / structured data

- **`actions_parsed.json`** — All 123 actions as structured JSON (type, formula, condition, table, prominence, all metadata). Easier to grep / process programmatically than the markdown.
- **`views_parsed.json`** — All 62 views with full `View configuration` JSON (Events, GroupBy, SortBy, ActionBarEntries, FinishView, Icon, etc.).
- **`columns_parsed.json`** — All 1,083 columns across 53 tables (17 user + 36 auto-generated process state tables) with every metadata field.

## Raw source

- **`appdoc.html`** — Original AppSheet Application Documentation HTML export (5.1 MB). Authoritative source — every formula, every config detail. Open in browser.
- **`appdoc.txt`** — Plain-text conversion of the HTML (1.2 MB, 26k lines). Easier to `grep` / search. Sections: Data (lines 19-23402: Tables + Columns), Slices (23403+), UX/Views (23464-24124), Format Rules (24125-24136), Behavior/Actions (24137+).

---

## Handover prompt (paste this to the new CMS team's AI/dev)

> You're verifying that a newly-built CMS covers every workflow of an older AppSheet-based system being decommissioned. The old system is a Philippine vaccination/immunization clinic management app.
>
> Your task: walk through `SureVaxCMS_Conformance_Checklist.md` row by row. For each row, find the equivalent behavior in the new CMS and mark the **Status** column with one of:
> - ✅ **Match** — new CMS has equivalent behavior (note where in the Δ Notes column)
> - ⚠️ **Different** — new CMS handles it differently (describe the delta in Δ Notes)
> - ❌ **Missing** — new CMS does NOT cover this (decide: implement, or get explicit sign-off to drop)
> - 🗑️ **Drop** — intentionally not migrating (note rationale)
>
> Use the supporting files when a row needs more context:
> - `SureVaxCMS_Audit.md` for the "why" behind any workflow
> - `SureVaxCMS_Schema_Reference.md` to verify column-level field mappings
> - `security_filters.md` for permission rule equivalence
> - `appdoc.html` / `appdoc.txt` to spot-check any formula that needs deeper inspection
> - `actions_parsed.json`, `views_parsed.json`, `columns_parsed.json` for programmatic queries
>
> Specific things to verify carefully (high-risk areas):
>
> 1. **Bot 3 (Adjust future appointments)** uses AppSheet's `_THISROW_BEFORE` / `_THISROW_AFTER` diff to detect state transitions. Verify your new CMS replicates this cascade — patient comes in late, all subsequent doses must shift forward.
> 2. **Bot 12 (Update immunization details)** is the Transaction → Immunization sync. Must be atomic. Loss of this would break the entire payment-completion flow.
> 3. **Bot 1 (Create ARV succeeding doses)** has 3 unconfigured `New step` placeholders in its process flow — you'll need a decision from the original app owner before considering this bot fully migrated.
> 4. **Vaccine table polymorphism** — old system mixed vaccines, medical services, and wellness packages in one table. Confirm new schema's handling.
> 5. **Health card generation** uses a sentinel-string trigger pattern (`"Updating..."` string). Verify equivalent file-generation workflow exists.
> 6. **Branch-scoped data access** — 8 tables filter by branch via email lookup. Verify the new CMS's role/permission system enforces equivalent scoping.
> 7. **`_SD` dose-creator template (16 variants)** — each creates the next dose row with specific day offsets. Verify dose-scheduling logic in new CMS handles all 16 variants correctly.
>
> Specific things explicitly flagged for DROP / decision:
>
> - Patient action `update row id` — confirmed deprecated by original owner. Do not migrate.
> - 3 `New step` actions in Bot 1 — get sign-off; either delete or specify intent.
>
> When you complete the checklist, hand the marked-up file back to the audit owner with the **Pre-migration Decisions** section (#8) filled in.

---

## Audit caveats / things NOT in this handover

- **No data export.** Patient/Transaction/Immunization actual row data is NOT in this package. Get from the source Google Sheet directly (or via AppSheet API).
- **No AdminEmails list.** The `AdminEmails` table contents (which emails have admin permissions) need to be exported from the source sheet — they drive the admin permission check throughout.
- **No row counts.** Migration team should query the source for current row counts per table to plan import strategy.
- **No mobile UI screenshots.** Only desktop preview was captured. If the app has nurses using AppSheet mobile primarily, audit that surface separately.
- **No external integration endpoints.** PayMongo API config, Google Drive folder IDs, etc. need to be sourced from the original team.
- **Inferred ALL `_SD` action day-offsets are "(see UI)".** The `i_Timestamp_Ideal` offset formulas in each `_SD` action's "Assignments" can be read from `appdoc.txt` directly — `grep -A 20 "Action name _SD"` in that file.
