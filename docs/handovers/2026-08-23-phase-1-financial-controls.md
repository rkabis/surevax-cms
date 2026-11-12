# Phase-1 financial controls — implementation and decision handover

- Date: **2026-08-23**
- Publication: **PR [#617](https://github.com/njvil/surevax-cms-revamp/pull/617), open and mergeable at handover time**
- Branch: `codex/phase1-financial-controls`
- Implementation commit: `3314f6b`

This is the dated record of what changed, what was reproduced, what the
adversarial review found, and which decisions remain outside engineering's
authority. The live next-step checklist is in [`../STATUS.md`](../STATUS.md),
and the sign-off record is
[`../phase-1-financial-controls-decisions.md`](../phase-1-financial-controls-decisions.md).

## Scope and boundary

The work hardened existing clinic accounting flows without changing totals,
receipt allocation, approval thresholds, or the clinic's accounting policy by
assumption. It implemented the unambiguous controls requested for:

1. one active bill per clinical order;
2. mandatory SC/PWD identification evidence;
3. fail-closed money-receiver attestation;
4. accountable `received_by` attribution on every current payment route;
5. directly related contract/UI drift;
6. safe compatibility for two decision-gated operating questions.

No Phase-2 feature, tax registration value, receipt series, new approval role,
or weakened authorization rule was introduced.

## Confirmed failures reproduced before repair

| Failure                     | Reproduction/evidence                                                  | Result before repair                                                                              |
| --------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Double billing              | Sequential and concurrent attempts to bill the same `clinical_order`   | No database-wide active-claim invariant existed.                                                  |
| Missing discount evidence   | SC/PWD transaction submitted without `discount_id_number`              | Some entry paths could reach the service without the required evidence.                           |
| Money-route caller omission | Direct runtime call with the caller context omitted                    | Omission could previously fall through to the shared `Branch` service account.                    |
| Shared-kiosk attribution    | Branch session submitted money without valid staff PIN attestation     | Receiver accountability depended on every caller remembering optional fields.                     |
| Correction receiver drift   | Correcting a payment that had an original receiver                     | Replacement attribution risked describing the correction actor rather than the original receiver. |
| Misleading approval UI      | Non-admin user was directed to an Approvals page they could not access | Recovery guidance led to a 403 instead of an accountable approver.                                |

## Implemented safeguards

### 1. One active bill per clinical order

Primary files:

- `apps/backend/drizzle/0012_active_clinical_order_billing.sql`
- `apps/backend/src/modules/transactions/db.ts`
- `apps/backend/src/shared/db/migrate.ts`
- `apps/backend/tests/integration/financial-controls.test.ts`

Database boundary:

- A validated composite foreign key now enforces
  `transaction_items(tenant_id, clinical_order_id) → clinical_orders(tenant_id, id)`.
- The item trigger locks the clinical-order row as the concurrency key and
  rejects a second claim whose parent transaction is active.
- A transaction activation trigger covers the path an item-only trigger cannot
  see: restoring a soft-deleted Draft/Pending transaction rechecks every order
  claim, while Voided/Refunded transactions are terminal and cannot reactivate.
- Corrected rebilling remains allowed after a legitimate Void/Refund because
  the historical transaction/item rows stay in place but no longer own the
  active claim.
- The migration uses a bounded five-second DDL lock timeout, validates the
  tenant FK, and the migrator asserts both triggers plus the validated FK before
  reporting success.

API boundary:

- The service performs a tenant-scoped active-bill precheck for usable feedback.
- The database race-time `unique_violation` is normalized to deterministic HTTP
  `409 CLINICAL_ORDER_ALREADY_BILLED`.
- Public errors and responses use display IDs only.

### 2. SC/PWD discount evidence

Primary files:

- `packages/shared/src/schemas/transaction.ts`
- `apps/backend/src/modules/transactions/contract.ts`
- `apps/backend/src/modules/transactions/db.ts`
- `apps/frontend/src/features/transactions/formSchema.ts`
- `apps/frontend/src/features/transactions/TransactionsCreatePage.tsx`

Decisions implemented:

- `discount_id_number` is mandatory and nonblank for `OSCA`/senior and `PWD`.
- The shared Zod schema is the contract source; backend route and service
  boundaries enforce it again before any write.
- Cashier fields clearly show when the ID is required and return inline,
  actionable validation.
- `NA` and `Other` behavior was not changed because that would be a policy
  decision, not a safety repair.

### 3. Fail-closed money caller and receiver attestation

Primary files:

- `apps/backend/src/modules/transactions/db.ts`
- `apps/backend/src/modules/transactions/routes.ts`
- `apps/backend/src/modules/patient_accounts/routes.ts`
- `apps/frontend/src/features/transactions/components/StaffAttestationField.tsx`

The service contract now requires the discriminated union:

```ts
type MoneyCallerContext = { kind: 'http'; role: string; displayId: string } | { kind: 'internal' }
```

- HTTP callers must provide the authenticated role and public user display ID.
- Internal jobs/tests must make the typed, explicit `{ kind: 'internal' }`
  choice; omission is not an opt-out.
- Runtime omission fails closed with `MONEY_CALLER_CONTEXT_REQUIRED`.
- A shared `Branch` session still requires named-user PIN attestation, including
  branch and role authorization plus existing PIN lockout behavior.
- An unresolved frontend login role no longer counts as implicit
  self-attestation.

### 4. Current payment-route identity matrix

| HTTP money route                                                | Caller identity source                        | Accountable receiver behavior                                                                                       |
| --------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `POST /api/transactions` with inline payment(s)                 | Authenticated `req.user.role` + `req.user.id` | Self for accountable personal login; named/PIN-attested staff for shared Branch login.                              |
| `POST /api/transactions/:id/payments`                           | Authenticated `req.user.role` + `req.user.id` | Same rule; `received_by_id` is persisted for the payment leg.                                                       |
| `POST /api/transactions/:id/payments/:paymentId/correct-method` | Authenticated correction actor                | Replacement preserves the original payment receiver; the correction actor is separately recorded in audit metadata. |
| `POST /api/patients/:id/payments`                               | Authenticated `req.user.role` + `req.user.id` | Every oldest-first allocated payment leg carries the accountable receiver.                                          |

Public payment contracts now expose the receiver's `USR_…` display ID rather
than the internal bigint. A legacy payment with no receiver fails closed during
method correction; staff must not guess attribution.

### 5. Safe compatibility/UI corrections

- Duplicate billing errors tell staff to refresh and open the existing active
  transaction before collecting again.
- Collect-payment and deposit dialogs surface attestation failures inline.
- The deposit UI describes an acknowledgement of patient credit and explicitly
  says it does not mark service rendered; money and receipt-sequence semantics
  are unchanged.
- Void/refund dialogs only link to Approvals for roles that can open it.
  Other staff are told to contact a Branch Admin or Tenant Admin.
- Payment correction gives a specific TenantAdmin remediation path when legacy
  receiver attribution is missing.

## Adversarial review and remediation

A bounded read-only adversarial review was completed before publication.

| Priority | Finding                                                                     | Resolution in PR #617                                                                                               |
| -------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| P1       | Refunded/soft-deleted bills could be reactivated after corrected rebilling. | Added transaction activation/terminal-state guard and direct DB regression.                                         |
| P1       | `clinical_order_id` was not tenant-qualified at the FK boundary.            | Added validated composite tenant FK and fail-closed trigger check.                                                  |
| P2       | Trigger DDL can lose a short lock race during deployment.                   | Kept bounded timeout, documented quiet-window retry, and added post-migration assertions.                           |
| P2       | API `Promise.all` did not prove the database race path.                     | Replaced it with coordinated competing inserts on two database connections and asserted the named constraint error. |
| P2       | Legacy missing receiver attribution had no usable recovery guidance.        | Documented evidence-backed TenantAdmin repair ownership and added actionable UI copy.                               |

The review found no blocker in the normal HTTP caller map, receiver preservation,
SC/PWD validation, or public display-ID contract after these changes.

## Preserved invariants

- Money totals, VAT/discount calculations, payment allocation, and outstanding
  balance derivation are unchanged.
- Receipt and transaction sequences are unchanged.
- Historical transaction items, payments, corrections, Voids, Refunds, and
  their audit history remain preserved.
- Approval thresholds and authorized reviewer roles were not widened.
- Tenant/branch isolation remains database-first and uses parameterized SQL.
- No TIN, ATP/PTU, permit, registered series, VAT status, or legal document
  classification was invented.

## Verification evidence

| Gate                        | Result                                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Isolated worktree migration | Applied successfully; both triggers and validated tenant FK verified.                                                              |
| Focused backend suites      | **87 passed** across financial controls, attestation, correction, transaction routes, and patient-account routes.                  |
| Focused frontend suite      | **5 passed** for SC/PWD validation, duplicate-bill recovery copy, legacy receiver recovery copy, and fail-closed role handling.    |
| `pnpm agent:check`          | Clean: doc sync, contract drift, formatting, lint, all workspace typechecks/builds, Tailwind token check, and design-system check. |
| Diff hygiene                | `git diff --check` clean before the implementation commit.                                                                         |

Earlier affected-suite verification in the same worktree also covered brand
selection, multi-patient transactions, void side effects, authorization, and
shared-kiosk PIN scenarios.

## Decisions made versus decisions still gated

| Topic                           | Engineering decision now recorded                                                                             | External decision still required                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Active clinical-order billing   | Enforce one active owner at DB/API boundaries; Void/Refund releases only the active claim, not history.       | None.                                                                                                                                |
| SC/PWD evidence                 | Require nonblank OSCA/PWD ID; do not alter `NA`/`Other`.                                                      | None for the implemented rule.                                                                                                       |
| Money receiver                  | HTTP fails closed; internal opt-out is explicit and typed; original receiver survives correction.             | Name the TenantAdmin owner and evidence procedure for repairing imported legacy rows with null receiver.                             |
| Void/refund approval            | Preserve existing PHP 1,000 BranchAdmin and PHP 5,000 refund TenantAdmin gates; TenantAdmin override remains. | Owner chooses staffed per-branch BranchAdmins or formally retains centralized TenantAdmin approval, including primary/backup names.  |
| Patient-credit deposit document | Preserve current amount, allocation, and receipt sequence; describe UI as patient-credit acknowledgement.     | Owner + bookkeeper/BIR adviser define sale timing, principal/supplementary document class, and real registered series/configuration. |

## Next-step pointer

Do not maintain a second checklist here. The current merge, deployment,
verification, and sign-off tasks are the **Phase-1 financial controls closeout**
section in [`../STATUS.md`](../STATUS.md). Record signed decisions in
[`../phase-1-financial-controls-decisions.md`](../phase-1-financial-controls-decisions.md)
and update `STATUS.md` in the same change so the backlog does not drift.
