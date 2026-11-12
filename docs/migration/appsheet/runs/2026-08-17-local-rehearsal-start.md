# Local Migration Rehearsal Start — 2026-08-17

> **Mode:** local read-only dry run
> **Cutoff:** 2026-08-16, Asia/Manila
> **Database writes:** none
> **Railway writes:** none

## Frozen rehearsal pack

- 15 of 15 expected source snapshots are present and hash-verified.
- Source-pack hash:
  `e90aec3ab9e4926e8c75d7133046170639c0e7bac0093e05f22cb5a7de93b767`.
- Inputs: AppSheet export, 13 local clinic trackers and the Cubao Drive
  snapshot.
- The AppSheet local export is older than the current live Sheet. This run is
  rehearsal evidence only and cannot be promoted to production.

## Reconciliation output

| Control                   |  Count |
| ------------------------- | -----: |
| Canonical events          | 60,914 |
| Local administrations     | 59,017 |
| External dose-1 facts     |  1,897 |
| Tracker rows read         | 20,422 |
| P0 run blockers           |      3 |
| P1 record blockers        |  3,364 |
| P2 review confirmations   |  6,227 |
| P3 operational follow-ups |  3,519 |

The initial dry run exposed one transaction whose source patient value was
`Multiple`. It is now withheld as a P1 financial-group exception instead of
breaking the entire LoadPlan.

## Remaining P0 blockers

1. Materialize and hash a current coordinated AppSheet freeze; live source
   drift is recorded.
2. Approve the Salcedo month/tab ownership roster.
3. Reconstruct regimen-complete scheduled doses from the canonical
   administration ledger before any target database write.

## Artifacts

- Source inventory:
  `/private/tmp/surevax-local-migration-start/source-inventory.json`
- PHI-safe source report:
  `/private/tmp/surevax-local-migration-start/source-inventory-report.md`
- PHI-safe rehearsal report:
  `/private/tmp/surevax-local-migration-start/rehearsal-report.json`

These temporary artifacts may contain source locators and, for the Cubao raw
snapshot only, restricted row data. They must not be committed.
