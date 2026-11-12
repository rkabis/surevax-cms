# Corporate / Group Billing PR Handover — 2026-08-23

This is an append-only implementation record for PR
[#615](https://github.com/njvil/surevax-cms-revamp/pull/615). The live backlog and
owner-gated next steps are maintained only in [`../STATUS.md`](../STATUS.md); the
durable accounting and boundary decisions are in the
[ADR](../decisions/2026-08-22-corporate-group-billing-vertical-slice.md).

## Objective and evidence

The legacy clinic contains genuine multi-patient corporate vaccination
transactions, including 69 profiled group transactions and an 80-patient /
₱90,650 drive. The existing family transaction can attribute items to several
patients, but `transactions.patient_id` still makes one real patient appear to be
the debtor. Splitting one corporate settlement into artificial per-patient bills
would lose the authoritative payer/accounting grain.

The delivered slice therefore creates one corporate payer receivable and one
settlement while retaining exact real-patient clinical/service attribution. It
does not create a placeholder patient, invent paid allocations, rewrite legacy
transactions, or bundle tenant billing, EDI, or campaign CRM.

## What was investigated

The implementation was based on code and documentation traces through:

- transaction header, patient subheaders, items, totals, price resolution, and
  idempotency;
- patient account balance/ledger, payer profiles, claims, AR worklist, payments,
  receipt acknowledgement, day summary, void/refund/method correction;
- clinical-order fan-out/completion, consent and branch gates, inventory FEFO and
  stock movements, and duplicate billing behavior;
- tenant/branch RLS, database audit triggers, PHI access logging, public ID
  contracts, role routing, and AppSheet migration assumptions;
- frontend navigation, role layout, patient/service selection, review-before-
  commit behavior, generated contracts, unit tests, and Playwright setup.

## Delivered implementation

| Layer                 | Work recorded in PR #615                                                                                                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Additive data model   | `group_bills` is one-to-one with `transactions`, carries its own `GBL_` display ID, tenant, branch, Corporate payer, reference, audit metadata, and create idempotency key.                                                         |
| Accounting grain      | The linked transaction remains authoritative for totals, payments, status, receipt/day summary, void/refund, and inventory/clinical fan-out. The sidecar makes its payer the AR owner.                                              |
| Patient attribution   | Existing `transaction_patients` and `transaction_items.patient_id` retain exact real-patient/service allocation. The first patient remains only a compatibility header anchor and is excluded from patient AR.                      |
| Shared/API contracts  | Shared strict Zod create/payment schemas feed the backend contract and generated frontend `group-billing.gen.ts`; public contracts expose display IDs only.                                                                         |
| Backend surface       | Create, list/detail, payment, and whole-group void endpoints under `/api/group-bills`; AR list includes outstanding balance; PHI reads map to the group-bill audit resource.                                                        |
| Database safety       | RLS for the sidecar, tenant/branch/payer matching triggers, exact-total checks, patient-credit prohibition, payer-matched payments, and a serialized one-live-bill-per-clinical-order trigger.                                      |
| Lifecycle safety      | Generic transaction void/refund/payment-method-correction paths call the same group-bill admin guard, so callers cannot bypass the group route. Paid group void still requires refund first.                                        |
| Atomicity/concurrency | One transaction commits the group wrapper, financial transaction, patient/item allocation, clinical/inventory fan-out, or none. Create retries replay by stored idempotency key; concurrent billing of one order yields one winner. |
| Frontend              | Billing navigation plus list/detail and focused create flow; staff select payer/reference and multiple patient/services, review exact totals and attribution, then commit once.                                                     |
| Documentation         | ADR, documentation map/index, data/compliance, backend API, frontend UI/UX, product workflow, agent gotchas, this handover, and the living status/backlog.                                                                          |

## Accounting and product decisions

1. **Additive sidecar, not a transaction rewrite.** Reusing the transaction
   engine avoids a parallel payments/receipt/inventory implementation and
   preserves all existing single-patient behavior.
2. **Payer receivable, patient clinical allocation.** The payer owes one exact
   balance. Patients retain service attribution but receive no proportional AR,
   credit, or payment allocation.
3. **One branch and one Corporate payer.** Multi-branch, multi-payer, patient
   share, eligibility roster, and consolidated tenant invoices are Phase 2.
4. **Exact totals only.** The group total is the sum of stored item allocations.
   There is no proportional allocation rule or rounding convention because this
   slice does not allocate settlement down to patients.
5. **Whole-group financial reversal.** Partial patient/service credits and
   rebills require a future explicit model; they are not inferred from the shared
   receipt or payment.
6. **Clinical and stock behavior remains atomic.** Existing consent, D2 branch,
   order, inventory, completion, and void unwind rules remain authoritative.
7. **Minimum disclosure by default.** The implemented surface is internal clinic
   staff UI/API. No payer portal/export/API is enabled without an owner-approved
   purpose and field-level disclosure contract.
8. **No BIR policy invention.** A `GBL_` reference is not a tax-document number.
   Existing acknowledgement/invoice wording must follow approved branch
   configuration and operating policy.
9. **Migration is compatibility-only.** A future importer must preserve one
   source payer/branch/payment and every exact patient/service link, carry source
   provenance, and route ambiguity to exceptions. The throwing Drizzle adapter
   remains a separate P0 blocker.

## Adversarial review and remediations

An independent adversarial code review was run before publication. Four high-risk
bypasses were confirmed and fixed:

| Finding                                                                | Remediation                                                                                                                                                                   |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Patient pay-on-account, credit, or prepayment could settle group AR    | Patient balance/open-bill queries exclude group transactions; application and database guards reject patient Credit/prepayment against a group bill.                          |
| Generic transaction lifecycle endpoints could bypass group route roles | Group lifecycle authorization moved into shared transaction DB functions; only TenantAdmin/BranchAdmin can void, refund, or correct a group payment method through any route. |
| Ambiguous client retry could create a second bill/fan-out              | Stored create idempotency on `group_bills`, middleware replay, shared response contract, and frontend key reuse until unambiguous success.                                    |
| A clinical order could be billed under the wrong patient or service    | Create resolves the order's patient/service and rejects either mismatch before mutation; the database trigger serializes concurrent attempts to bill one live order.          |

The review also removed duplicated backend request validation in favor of the
shared schema and added exact group-bill PHI audit-resource mapping.

## Verification and CI history

| Check                                               | Result                                                                                                                                                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused backend group-billing integration suite     | 8 passed: totals/AR/audit, roles/RLS, payment/refund boundaries, patient-credit exclusion, void, concurrency, wrong-patient rollback, and create replay.                   |
| Full backend suite after CI fixture correction      | 47 files, 396 tests passed.                                                                                                                                                |
| Frontend focused unit suite                         | 2 passed.                                                                                                                                                                  |
| Chromium group-billing browser path plus auth setup | 3 passed.                                                                                                                                                                  |
| `pnpm agent:check`                                  | Passed: doc sync, contract drift, formatting, lint, recursive typecheck/build, route auth, modeled-not-wired, design-system, and token checks.                             |
| Initial GitHub CI                                   | Build/typecheck passed; Playwright passed; backend failed one test because a group test reused seeded `PAT_AAAAAAA1` while another file concurrently created unrelated AR. |
| CI correction                                       | The credit-exclusion test now creates and deletes two dedicated patients plus consent rows. This tests only the group invariant and removes cross-file state dependence.   |

Local setup used the isolated worktree database. The repository-pinned pnpm
9.15.0 was used because the machine-wide pnpm executable under Node 26 hung; a
pnpm 11 fallback also attempted to inject placeholder `allowBuilds` entries,
which were removed and never committed.

## Files that own the result

- Decision: [`../decisions/2026-08-22-corporate-group-billing-vertical-slice.md`](../decisions/2026-08-22-corporate-group-billing-vertical-slice.md)
- Live backlog: [`../STATUS.md`](../STATUS.md#pending-review-2026-08-23-corporategroup-billing-pr-615)
- Backend aggregate: `apps/backend/src/modules/group_billing/`
- Database invariants: `apps/backend/drizzle/0001_extensions_and_rls.sql`,
  `0002_audit_and_redaction.sql`, and `0003_invariants.sql`
- Shared schema: `packages/shared/src/schemas/group-billing.ts`
- Frontend feature: `apps/frontend/src/features/group-bills/`
- Integration tests: `apps/backend/tests/integration/group-billing.test.ts`
- Browser test: `e2e/group-billing.spec.ts`

## Deferred boundaries

No code was added for legacy migration, payer-facing export/portal/API, tax
document certification, payer aging/statements/collections, partial group
credit/rebill, claims EDI, patient cost share, corporate eligibility/CRM,
multi-payer/multi-branch bills, or tenant subscription billing. Re-open those
only at the triggers and with the owner decisions recorded in
[`../STATUS.md`](../STATUS.md#pending-review-2026-08-23-corporategroup-billing-pr-615).
