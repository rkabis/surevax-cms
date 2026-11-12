# AppSheet live-source reconciliation — 2026-08-16

## What changed

- Indexed the live native `surevax_gsheet_db`, six connector-observed
  revisions across multiple API reads (only three returned in the latest listing),
  three historical-copy candidates, the shared tracker folder, 14
  live clinic trackers, 13 local tracker exports, exact local SHA-256 hashes,
  and copied-sheet quarantines.
- Added Cubao, which was absent from the original local workbook set.
- Follow-up connector pass exported all 14 live tracker workbooks and profiled
  Cubao's patient-level `Manual Sales 2026!A1:I19` range. Its 18 clinic rows
  reconcile to 22 AppSheet transaction headers and 36 administered events;
  assumptions and aggregate dose results are in
  [`../migration/appsheet/CUBAO-LIVE-RECONSTRUCTION-2026-08-16.md`](../migration/appsheet/CUBAO-LIVE-RECONSTRUCTION-2026-08-16.md).
- Terra agents then profiled the selected live ledger for all 14 branches:
  26,407 candidate tracker rows and ₱36,662,058.38 in tracker-row amounts
  (not revenue). The result, copy quarantines, deterministic inference rules,
  10 P0 cutover gates, 4 P1 record blockers and 3 P2 confirmations are in
  [`../migration/appsheet/PRE-CUTOVER-READINESS-2026-08-16.md`](../migration/appsheet/PRE-CUTOVER-READINESS-2026-08-16.md).
- During that pass the live AppSheet source advanced again to revision
  `445181` at 2026-08-16 13:41:11 PHT, confirming that a production snapshot
  requires a write freeze plus bot/offline-sync drain.
- Recorded that every August 1 local tracker export is older than its live Drive
  file and cannot be treated as the final cutover input.
- Replaced the single-source assumption with a multi-source evidence model:
  transaction, purchase item, payment, dose slot, administration and external
  administration are separate facts.
- Recorded delete/recreate handling, name-only tracker matching boundaries,
  multi-dose payment semantics, external-start behavior, provenance, exception
  queues and cutover invariants.
- Corrected the status rule: past planned doses are due/overdue, not automatically
  cancelled.
- Corrected prepayment semantics: an allocated four-dose purchase is a normal
  transaction with multiple items; `is_prepayment=true` remains an itemless
  patient-credit deposit.

## Durable locations

- Source locations/hashes: [`../migration/appsheet/SOURCE-MANIFEST.md`](../migration/appsheet/SOURCE-MANIFEST.md)
- Machine-readable source inventory: [`../migration/appsheet/SOURCE-MANIFEST.json`](../migration/appsheet/SOURCE-MANIFEST.json)
- Evidence and reconciliation model: [`../migration/appsheet/EVIDENCE-AND-RECONCILIATION.md`](../migration/appsheet/EVIDENCE-AND-RECONCILIATION.md)
- All-branch pre-cutover readiness: [`../migration/appsheet/PRE-CUTOVER-READINESS-2026-08-16.md`](../migration/appsheet/PRE-CUTOVER-READINESS-2026-08-16.md)
- Inference/manual queue policy: [`../migration/appsheet/INFERENCE-AND-MANUAL-REVIEW-POLICY.md`](../migration/appsheet/INFERENCE-AND-MANUAL-REVIEW-POLICY.md)
- Superseding decisions: [`../migration/appsheet/DECISIONS.md`](../migration/appsheet/DECISIONS.md)
- Unresolved owner/ops questions: [`../migration/appsheet/OPEN-QUESTIONS.md`](../migration/appsheet/OPEN-QUESTIONS.md)
- Current backlog: [`../STATUS.md`](../STATUS.md), P0 item 4
- Cubao live reconstruction and connector export log:
  [`../migration/appsheet/CUBAO-LIVE-RECONSTRUCTION-2026-08-16.md`](../migration/appsheet/CUBAO-LIVE-RECONSTRUCTION-2026-08-16.md)

## Gotchas

- The Drive revisions API can return an incomplete list for the large native
  Sheet. Recent revision content was retrievable, but older checkpoints should
  be copied from the Sheets version-history UI without restoring the live file.
- Google/API revision attribution currently resolves to the AppSheet admin
  account; AppSheet Audit History is needed for recent user-level deletes where
  retained.
- Workbook filename does not establish ownership of an internally copied sheet.
- No patient row or workbook was committed; only restricted source locators,
  hashes and aggregate findings were recorded.

## Next implementation slice

Implement source envelopes and manifest ingestion, then emit canonical events
and exception queues before changing the production loader. The backlog remains
in [`../STATUS.md`](../STATUS.md); this handover is narrative only.
