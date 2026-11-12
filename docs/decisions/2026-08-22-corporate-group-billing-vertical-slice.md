# ADR: Corporate / Group Billing Vertical Slice

**Status:** Implemented; proposed for review
**Date:** 2026-08-22
**Owners:** Product, Finance Operations, Engineering, Privacy Owner
**Scope:** A single corporate or group-sponsored bill at one branch for one payer.

**Implementation:** PR [#615](https://github.com/njvil/surevax-cms-revamp/pull/615),
[decision index](README.md),
[implementation handover](../handovers/2026-08-23-corporate-group-billing-pr.md), and
[live release/next-step gates](../STATUS.md#pending-review-2026-08-23-corporategroup-billing-pr-615).

## Context and current flaw

SureVax already supports a _family/group transaction_: one transaction may contain
multiple real patients, per-patient discount metadata, patient-attributed line
items, and one combined payment. The header patient is the primary/bill-to patient.
This is the current canonical workflow, not a proposed schema
([workflow context](../ai-context/06-PRODUCT-WORKFLOWS.md#billing--transactions-story-11)).

That shape is not yet a corporate billing vertical slice:

- A corporate payer is only a payer profile/type; it does not own a separate,
  explicit AR position for a group bill.
- The compatibility header patient can be mistaken for the debtor in patient AR
  even though a corporate payer settles the bill.
- There is no explicit group-bill identity, corporate invoice/worklist view, or
  boundary for a whole-group reversal.
- The historic AppSheet importer analysis identifies cross-patient corporate
  drives and recommends splitting them into per-patient transactions, preserving
  the group payment only in notes. That is a migration decision, not a current
  corporate-billing model ([open question Q2](../migration/appsheet/OPEN-QUESTIONS.md#open-questions)).

The result is a risk of wrong debtor attribution, accidental proportional
allocation, and an implementation that exposes more patient detail to a payer than
the collection purpose needs.

## Decision

Create an **additive `group_bills` sidecar** that is one-to-one with an existing
`transactions` row. It introduces corporate/group billing identity and payer-owned
AR without replacing the proven transaction engine.

### Data and ownership boundary

| Concern               | Decision                                                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Group-bill identity   | `group_bills` has its own public `display_id`; public API/UI contracts use display IDs, never bigint keys.                                                                                                                            |
| Link to money engine  | `group_bills.transaction_id` is required and unique. The linked transaction remains the source for money, payment legs, receipt rendering/numbering, day summary, status, void, and refund.                                           |
| Payer                 | `group_bills.payer_id` is required. The payer owns the receivable for the linked transaction; payer AR is derived from that transaction's outstanding balance.                                                                        |
| Branch                | The group bill has exactly one branch, equal to the linked transaction's branch. Multi-branch corporate bills are out of scope.                                                                                                       |
| Patients and services | `transaction_patients` and `transaction_items` remain the exact patient and service allocation. Every billed person must be a real patient; no synthetic or placeholder "Corporate/Group" patient is permitted.                       |
| Compatibility anchor  | The first real patient remains `transactions.patient_id` solely because the existing clinical/transaction contract requires a header patient. It is **not** the debtor and the linked transaction is excluded from that patient's AR. |
| Payments              | One payment/charge-to-account position settles the transaction. Do not create proportional patient payment allocations, patient credits, or patient AR entries from a group-bill payment.                                             |

### Write and control boundary

1. Create `group_bills`, the transaction, `transaction_patients`, and
   `transaction_items` in one database transaction. Existing consent, D2 branch,
   pricing, and duplicate-clinical-order billing checks apply to **every** patient
   before any row is committed. A supplied clinical order must match both the
   attributed patient and billed service. An idempotency key is persisted on the
   aggregate so an ambiguous retry cannot create a second bill or repeat inventory
   fan-out.
2. The transaction's existing payer/price semantics remain authoritative for the
   sale. The sidecar's payer must match the linked transaction's payer; a payer
   change is not a sidecar-only update.
3. Tenant and branch isolation remain database-first: tenant-scoped rows carry
   `tenant_id`, RLS is enabled, and request context is established with `SET LOCAL`
   inside the database transaction. Group-bill writes and material state changes
   are audit-triggered like the linked financial rows.
4. A void or refund is a **whole-group** operation. It acts through the linked
   transaction and must not partially reverse one patient allocation while leaving
   the shared payment, receipt, and payer AR open. A partial clinical correction
   requires a later Phase 2 credit/rebill design, not an implied proportional
   refund.
   The admin-only boundary is enforced by transaction lifecycle functions as well
   as the group route, so generic transaction void/refund/correction endpoints
   cannot bypass it.
5. The group-bill detail may show patient/service allocations only to clinic roles
   allowed to see those records. A payer-facing worklist or export starts with the
   least disclosure needed to identify the bill, payer, branch, amount, status,
   due date, and approved reference; patient clinical detail is opt-in by a
   documented purpose and disclosure rule.

## Receipt and invoicing terminology

Repository wording currently drifts: the requirements say “BIR-compliant
receipts,” while the active workflow says the current implementation is an
acknowledgement receipt rather than an Official Receipt and describes a future
BIR-configured layout. This ADR does **not** assert that any clinic, branch,
printer, software, registration, or configuration is compliant.

For terminology only, the official BIR materials describe an **Invoice** as the
principal evidence of a sale and treat Official Receipts and acknowledgement/cash
receipts as supplementary documents:

- [BIR Revenue Regulations No. 7-2024](https://bir-cdn.bir.gov.ph/BIR/pdf/RR%20No.%207-%202024.pdf)
- [BIR Revenue Memorandum Circular No. 77-2024](https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2077-2024%20Digest.pdf)

Therefore the vertical slice must label its rendered document according to the
configured, approved operational process. It must not represent an
acknowledgement, transaction reference, or group-bill display ID as a tax invoice.
Finance Operations and the tax owner must approve any invoice/receipt field,
numbering, printer, registration, or customer-facing wording before release.

## Privacy and minimum payer disclosure

The [NPC Data Privacy Act IRR](https://privacy.gov.ph/implementing-rules-regulations-data-privacy-act-2012/)
states the proportionality principle: processing must be adequate, relevant,
necessary, and not excessive for a declared and specified purpose. For this slice,
translate that principle into a product default: a payer receives the minimum bill
and reconciliation data necessary for collection, and no diagnosis, encounter note,
allergy, vaccine/clinical-order detail, address, or unrelated patient profile data
by default.

This is a system-design boundary, **not** a legal conclusion about authorization to
disclose a particular field. The lawful basis, patient notice/consent position,
data-sharing agreement (DSA), permitted payer fields, retention, and any exception
for claims or employer reporting are decisions for the Privacy Owner and counsel.
Those decisions must be recorded before a payer-facing export, portal, or API is
enabled.

## Migration compatibility contract — no implementation in this ADR

This ADR does not change the AppSheet importer or author a migration. If a future
migration imports a source group-drive transaction into this model, it must:

1. retain every real patient and exact service allocation from authoritative source
   links;
2. use a real primary patient only as the compatibility anchor, never a placeholder;
3. preserve the source payer, branch, source reference, and one shared payment
   amount without inventing per-patient paid amounts;
4. create one group-bill/transaction pair only when the source establishes one
   branch, one payer, and complete patient/service allocation; otherwise route the
   row to an explicit exception queue; and
5. preserve the legacy group identifier and migration provenance for reconciliation.

The current importer remains non-production-ready: its Drizzle adapter is a
documented throwing stub, and this ADR authorizes no workaround or direct data
write. See the [importer design](../migration/appsheet/DESIGN.md#module-structure).

## Consequences

### Positive

- Reuses established transaction/payment/receipt/day-summary/void mechanics.
- Keeps clinical allocation exact without constructing artificial patients or
  allocation percentages.
- Makes corporate debt and patient clinical identity distinct in the data model and
  AR views.
- Gives audit, RLS, and reconciliation an explicit group-bill object to reference.

### Costs and constraints

- Patient-account queries must explicitly exclude linked group-bill transactions;
  payer AR needs a distinct derived worklist.
- The first patient's presence on the existing transaction is a compatibility debt,
  so all new reporting must use sidecar semantics rather than infer debtor from
  `transactions.patient_id`.
- Whole-group reversal protects financial integrity but deliberately defers partial
  group credits, rebills, and patient-level payment allocation.
- A payer-facing surface cannot be released merely because internal staff can see
  the group-bill detail.

## Acceptance mapping for the vertical slice

| ID    | Acceptance condition                                                                                                                                                                                             |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GB-01 | A staff user can create one group bill for one payer and one branch with two or more real patients and exact item-to-patient allocation.                                                                         |
| GB-02 | Creation atomically produces the sidecar, transaction, patient subheaders, and items, or produces none; every patient passes consent, D2 branch, and duplicate-clinical-order billing gates.                     |
| GB-03 | The payer AR worklist shows the linked transaction's outstanding balance; no included patient shows that balance in patient AR or receives a proportional payment/credit allocation.                             |
| GB-04 | Payment, acknowledgement/invoice rendering, day summary, and transaction status continue to use the linked transaction; group-bill display ID is a reference, not a tax-document number.                         |
| GB-05 | Void/refund reverses the whole linked group bill through existing authorization/audit controls; a single-patient partial reversal is rejected as unsupported.                                                    |
| GB-06 | All group-bill API surfaces use display IDs, enforce tenant/branch RLS, and emit audit evidence for financial state changes.                                                                                     |
| GB-07 | No payer-facing portal, export, or API is enabled by this slice. Any later surface must use an approved minimum field set and remain denied until the Privacy Owner records the purpose and disclosure decision. |
| GB-08 | Migration is unchanged by this slice; any later import follows the compatibility contract and routes ambiguous source groups to exceptions.                                                                      |

## Explicitly out of scope

- Claims EDI submission, adjudication integration, and remittance automation
- Corporate eligibility rosters or employee enrollment
- Mixed copay, co-insurance, deductibles, and patient-share payment allocation
- Tenant-level billing/consolidated invoices across branches
- CRM, sales pipeline, employer account management, or collections workflow
- Multi-payer and multi-branch group bills
- Partial group refunds, credits, rebills, and per-patient payment allocation

## Unresolved Phase 2 items

1. Corporate payer AR aging, statements, due dates, collections, and payment
   allocation at the payer level.
2. A credit/rebill model for one patient or one service within a shared group bill.
3. Claims generation and the relationship between claim lines, group allocations,
   payer contracts, LOAs, and remittances.
4. Payer-facing disclosure schema, lawful basis, DSA, notice/consent treatment,
   retention, access controls, and audit review with the Privacy Owner and counsel.
5. Tax-owner confirmation of invoice document form, numbering, approval,
   registration, and branch-specific operational configuration.
6. Migration cutover rules for historical corporate drives, reconciliation evidence,
   and exception-queue ownership.
