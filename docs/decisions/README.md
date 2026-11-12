# Architecture Decision Index

Durable design and boundary decisions live here. Dated implementation history
belongs in [`../handovers/`](../handovers/); current open work belongs only in
[`../STATUS.md`](../STATUS.md).

| Date       | Decision                                                                                         | Status                           | Implementation evidence                                                                                  | History                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 2026-08-22 | [Corporate / Group Billing Vertical Slice](2026-08-22-corporate-group-billing-vertical-slice.md) | Implemented; proposed for review | PR [#615](https://github.com/njvil/surevax-cms-revamp/pull/615), initial implementation commit `bb3c51a` | [2026-08-23 handover](../handovers/2026-08-23-corporate-group-billing-pr.md) |

## Decision status meanings

- **Proposed:** investigated and written, but not authorized or implemented.
- **Implemented; proposed for review:** code exists on a review branch, but the
  decision has not landed on `main`.
- **Accepted:** reviewed and merged; later changes require a superseding ADR or an
  explicit amendment that preserves history.
- **Superseded:** retained as history and linked to the replacement decision.

## Corporate/group billing decision boundary

The current ADR deliberately decides only the safe vertical slice:

- the existing transaction remains the authoritative money, payment, receipt,
  day-summary, inventory fan-out, and lifecycle record;
- `group_bills` is an additive one-to-one payer-AR wrapper, while patient/service
  allocation remains on the existing transaction subheaders/items;
- the compatibility-header patient is real but is not the debtor;
- group create is exact and atomic; no fake patient and no unstored proportional
  allocation rule;
- payment identity, one-live-bill-per-clinical-order, RLS, audit, idempotency, and
  whole-group reversal boundaries are enforced below the UI;
- payer-facing disclosure policy, tax-document configuration, legacy migration,
  partial credit/rebill, payer collections, and claims remain unresolved or
  explicitly out of scope.

The implementation record and acceptance evidence are in the ADR and handover.
The remaining owner decisions and Phase 2 triggers are tracked in
[`../STATUS.md`](../STATUS.md#pending-review-2026-08-23-corporategroup-billing-pr-615).
