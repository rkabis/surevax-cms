# Data Migration — AppSheet/Google Sheets → SureVax CMS v2

The clinic runs today on an AppSheet app backed by Google Sheets. This directory
holds the **data-migration** workstream (importing the live data); the
**behavioral-conformance** audit (does the new CMS cover every old workflow)
lives separately at
[`docs/audits/2026-05-17-appsheet-conformance/`](../audits/2026-05-17-appsheet-conformance/).

> ⚠️ The source export (`surevax_gsheet_db.xlsx`) contains **real patient PII**
> and is **never committed**. Migration scripts read it from an external path.

## Contents

| Doc                                                                                  | Scope                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`appsheet/WHAT-REMAINS-BEFORE-CUTOVER.md`](appsheet/WHAT-REMAINS-BEFORE-CUTOVER.md) | Plain-language current status, remaining production work, priority-sorted manual queues, source locations and execution order. Start here.                                                                                                                                                            |
| [`appsheet/README.md`](appsheet/README.md)                                           | Canonical AppSheet migration dossier: source manifest, evidence/reconciliation model, decisions, open questions, analysis and importer design.                                                                                                                                                        |
| [`pep-prep-dose-reconstruction.md`](pep-prep-dose-reconstruction.md)                 | Deterministic reconstruction of every patient's PEP/PrEP rabies dose schedule — episode segmentation, regimen catalog, dose#-keyed matching, fill/flag taxonomy, reconciliation invariants. Source: [`scripts/migration/reconstruct_pep_doses.py`](../../scripts/migration/reconstruct_pep_doses.py). |

## Related

- Legacy schema reference (field-by-field): [`docs/audits/2026-05-17-appsheet-conformance/SureVaxCMS_Schema_Reference.md`](../audits/2026-05-17-appsheet-conformance/SureVaxCMS_Schema_Reference.md)
- Open migration gate: [`.claude/rules/risks.md`](../../.claude/rules/risks.md) #4
- Cutover-approach decision (big-bang vs parallel-run): [`docs/STATUS.md`](../STATUS.md)

## Status

| Entity                                  | State                                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| PEP/PrEP rabies doses                   | evidence history and schedule candidates reconstructed; target standing-order/clinical-order writer and overdue validation remain P0 |
| AppSheet + tracker source manifest      | 15/15 rehearsal sources usable and hash-checked; protected final cutover pack and catch-up checkpoint still required                 |
| Multi-source event reconciliation       | evidence/inference policies and all-branch rehearsal exist; transaction items and clinical schedule projection remain unfinished     |
| Patients and financial headers/payments | one-pass local load proven; invoice items withheld; durable target links, clean double-run and production environment still required |
