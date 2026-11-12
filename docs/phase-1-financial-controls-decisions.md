# Phase-1 financial controls — owner decisions

Status: **engineering safeguards implemented in PR #617 and pending merge; two
policy decisions plus one legacy-repair ownership decision remain open**.

Implementation and review record:
[`handovers/2026-08-23-phase-1-financial-controls.md`](handovers/2026-08-23-phase-1-financial-controls.md).
Live closeout checklist: [`STATUS.md`](STATUS.md), **Phase-1 financial controls
closeout**.

This note separates controls that can be enforced without changing legitimate
clinic accounting policy from choices that require an accountable clinic owner
or bookkeeper. The repository is development-only; role counts below describe
the current seeded clinic fixture, not a claim about live staffing.

## Preserved invariants

- Transaction totals, payment amounts, and receipt-number allocation are unchanged.
- Voids, refunds, corrections, and prior payment rows remain immutable/audited.
- Approval thresholds and required approver roles are unchanged.
- No TIN, permit, invoice series, registration status, or tax treatment was invented.

## Decision matrix

| Decision                                                        | Current code and clinic-role evidence                                                                                                                                                                                                                                                                                                                                         | Safe compatibility delivered                                                                                                                                                                                                         | Sign-off still required                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Who approves a void/refund routed to `BranchAdmin`?**         | `enforceMoneyApprovalGate` routes void/refund exposure over PHP 1,000 to `BranchAdmin`; refund exposure over PHP 5,000 routes to `TenantAdmin`. The approvals API permits `BranchAdmin` and `TenantAdmin`, with the tenant-admin override preserved. The current seed creates one `TenantAdmin` and no `BranchAdmin`; shared clinic sessions use the non-human `Branch` role. | No threshold or authorization was widened. The server recovery message names `BranchAdmin or TenantAdmin`, and non-admin users now see “ask a Branch Admin or Tenant Admin” instead of a link to an Approvals page they cannot open. | Owner chooses either **A:** appoint accountable per-branch `BranchAdmin` users, or **B:** formally retain centralized `TenantAdmin` approval. Define the named primary and backup approver before go-live.                                                                |
| **What document/sequence represents a patient-credit deposit?** | An item-less `is_prepayment=true` transaction stores deferred patient credit. Its funding payment currently follows the ordinary settlement path and can allocate `receipt_no`; the generic renderer can switch from acknowledgement to its configured official mode when branch BIR settings exist. Current Phase-1 seed/config resolves to acknowledgement mode.            | Money, allocation, sequence, and accounting state were not changed. The deposit dialog now says it records an acknowledgement of patient credit and does not mark a service as rendered.                                             | Owner + bookkeeper/BIR adviser define whether the deposit is already a billed sale or only a later-applied collection, the principal invoice timing, any supplementary acknowledgement/payment receipt, and the registered serial series/configuration for each document. |

## Why the deposit choice is gated

Current BIR EOPT guidance makes an **Invoice** the principal document for sales
of goods and services; an Official Receipt, Payment Receipt, or Acknowledgement
Receipt may be a supplementary document for collection. That is not enough to
infer when this clinic's advance becomes a sale or billing event. The answer
depends on the clinic's actual registration and accounting treatment, so the
software must not rename the current document or move its sequence by assumption.

## Deployment and legacy-data operations

- The clinical-order guard migration uses a five-second DDL lock timeout. If
  ordinary billing traffic holds the required lock, deployment fails and rolls
  back; retry during a quiet window. The migrator verifies both guard triggers
  and the validated tenant-qualified foreign key before reporting success.
- A legacy payment with no `received_by_id` fails closed during payment-method
  correction. Staff must not guess the receiver. A Tenant Admin must reconcile
  the source receipt/cashier record, record the evidence through the approved
  audited data-repair process, and only then retry the correction. The owner
  must name this repair owner before importing legacy payments.

Primary references:

- [BIR Revenue Regulations No. 7-2024](https://bir-cdn.bir.gov.ph/BIR/pdf/RR%207-2024%20%28final%29.pdf)
- [BIR Revenue Memorandum Circular No. 77-2024](https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2077-2024.pdf)

## Owner/bookkeeper acceptance record

Record the chosen option, effective date, accountable approver, document names,
registered series, and branch scope here only after written sign-off. Until then,
the compatibility behavior above is the Phase-1 boundary.

| Decision                                  | Status   | Required record before closure                                                                                                                                                  |
| ----------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Void/refund approval operating model      | **OPEN** | Option A or B, effective date, branch scope, named primary approver, named backup approver, owner signature/reference.                                                          |
| Patient-credit deposit document treatment | **OPEN** | Accounting treatment, invoice/sale timing, supplementary document name, real registered series/configuration, branch scope, owner + bookkeeper/BIR-adviser signature/reference. |
| Legacy null-receiver repair owner         | **OPEN** | Named TenantAdmin/data-repair owner, permitted source evidence, audited repair procedure, reviewer, and effective date before legacy import/correction.                         |

When an item is signed, replace **OPEN** with the dated decision and update the
matching FC item in `STATUS.md` in the same commit. Do not treat a chat message,
PR comment, seeded role count, or inferred BIR practice as sign-off.
