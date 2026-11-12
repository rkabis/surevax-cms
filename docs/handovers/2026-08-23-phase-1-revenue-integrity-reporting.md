# Phase-1 Revenue-Integrity Reporting

> **Implementation state:** proposed on PR
> [#618](https://github.com/njvil/surevax-cms-revamp/pull/618), branch
> `codex/phase-1-revenue-reconciliation-reports`, implementation commit
> `13cf200`. This note records the work and decisions on that PR; it is not a
> claim that the PR has merged to `main`.
>
> **Backlog ownership:** open work is maintained only in
> [`../STATUS.md`](../STATUS.md#revenue-integrity-reporting-next-step-register).
> Do not turn this dated handover into a second TODO list.

## Outcome

The former `/reports` ComingSoon shell is now an operational, role-aware
revenue-integrity surface for the first clinic. The bounded Phase-1 scope is:

1. accounts-receivable aging;
2. administered-but-unbilled clinical work;
3. payment-reconciliation exceptions;
4. daily branch transaction, tender, drawer, and deposit truth; and
5. an audit-blocking CSV export for the stable branch/day contract only.

No generic analytics framework, historical warehouse, or Phase-2/3 dashboard
was introduced.

## Investigation result: reused truth versus new queries

| Area investigated                      | Existing authoritative data reused                                                                                                           | Phase-1 addition                                                                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts receivable and patient ledger | `transactions.amount_outstanding`, transaction status, transaction-header payer, existing patient account/ledger and `/receivables` surfaces | A bounded aggregate grouped by branch, responsible payer, and aging bucket, plus a paged detail list                                                              |
| Clinical billing linkage               | Completed `clinical_orders`, their transaction-item links, and the imported `paymentReconciliationRequired` indication                       | A paged worklist for completed work with no active billing link; the legacy indication is exposed as a signal rather than promoted to a universal financial state |
| Transactions and payments              | Financial transaction headers remain the bill truth; payment rows remain tender truth; voided/deleted payment semantics are preserved        | A paged exception view over live reconciliation states, including imported `Mismatch`, while displaying responsible payer and tender payer separately             |
| Day summary and deposits               | Existing `day_summary` queries, cash-drawer sessions, tender breakdown, and actual `cash_deposits` rows                                      | A typed reports facade over one explicit branch/day and a stable audited CSV contract                                                                             |
| Payer profiles                         | Existing tenant-scoped payer profiles and transaction-header attribution                                                                     | Bounded branch/payer filter options; no new payer master or inferred payer values                                                                                 |
| Audit/export                           | Existing append-only `audit_logs` and export action                                                                                          | Server-side CSV generation, SHA-256 binding, and an `EXPORT` audit write that must commit before file delivery                                                    |

The feature adds report queries, not new financial tables or balancing rows.
Financial headers and payment records remain authoritative.

## Delivered contract

Shared Zod schemas in
[`packages/shared/src/schemas/reports.ts`](../../packages/shared/src/schemas/reports.ts)
are the contract source. The backend exports the module under
`@surevax/shared/reports`; the generated frontend contract is checked by the
existing contract-drift gate.

| Capability                | HTTP contract                             | Bound/filter behavior                                                                                      |
| ------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| AR aging                  | `GET /api/reports/ar-aging`               | Explicit `scope`, `branchId`, `payerId`, `agingBucket`, `page`, and `pageSize`; default 50, maximum 100    |
| Administered but unbilled | `GET /api/reports/unbilled-clinical-work` | Explicit branch, legacy-signal, search, page, and page-size filters; default 50, maximum 100               |
| Reconciliation exceptions | `GET /api/reports/payment-reconciliation` | Explicit branch, payer, exception-status, search, page, and page-size filters; default 50, maximum 100     |
| Daily branch facts        | `GET /api/reports/daily-revenue`          | Exactly one branch and one clinic-calendar date; combined multi-branch output is intentionally unsupported |
| Filter options            | `GET /api/reports/options`                | Branches/payers are tenant-scoped and capped at 200 rows                                                   |
| Daily CSV                 | `POST /api/reports/daily-revenue/export`  | Exactly one branch/day; server-generated CSV returned only after its hash-bound audit write commits        |

Potentially large lists are paged or hard-capped. Public payloads use display
IDs; internal bigint identifiers do not cross the API boundary.

## Access and isolation decisions

Every report query runs inside `withTenantTx`, so the HTTP role/scope checks
are backed by tenant and branch RLS context rather than replacing it.

| Role                                              | Scope                                                                                               | Visible report areas                                                                               |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `TenantAdmin`, `BranchAdmin`, legacy `SuperAdmin` | Explicit tenant or branch scope; an explicit branch display ID is resolved inside the active tenant | All four report areas and the stable daily CSV                                                     |
| `Cashier`, `Branch`                               | Current branch only; tenant scope is rejected                                                       | All four report areas and the stable daily CSV                                                     |
| `Nurse`, `Physician`                              | Current branch only                                                                                 | Administered-but-unbilled worklist only; no payer options, AR, tender, deposit, or export endpoint |

This preserves least privilege for clinical and shared-kiosk roles. Tenant-wide
views are never inferred from a missing branch filter and remain admin-gated.

## Financial and calendar decisions

| Decision            | Operational meaning                                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AR source           | Current `transactions.amount_outstanding` on non-prepayment Draft/Pending headers. The `asOf` parameter ages current balances; it is not a historical snapshot.                                 |
| Responsible payer   | Comes from the transaction header. It is not synthesized from tender legs.                                                                                                                      |
| Tender payer        | Comes from the payment leg and remains separately visible when present.                                                                                                                         |
| Exception states    | `AwaitingReconciliation`, `Disputed`, `Failed`, `Mismatch`, and `Pending`; voided/cleared payments and void/refund transaction states are excluded.                                             |
| Daily headline      | Named `transactionNetTotal`, not revenue recognized. It delegates to the existing day-summary transaction-header total, including Draft/Pending/Paid and excluding Voided/Refunded/prepayments. |
| Tender and deposits | Live payment-method totals and actual deposit rows are shown without synthesized balancing values.                                                                                              |
| Calendar boundary   | Phase 1 uses the clinic's `Asia/Manila` calendar date. Reports, Day Summary, and Today now share this rule; timestamp-to-date SQL uses `AT TIME ZONE 'Asia/Manila'`.                            |
| CSV eligibility     | Only the branch/day contract is considered stable enough for export. AR, unbilled, and exception CSVs remain intentionally absent.                                                              |

## Frontend result

`/reports` is an authenticated Records route using the existing `PageHeader`,
`PageToolbar`, `TableCard`, `KpiStrip`, and `DetailSheet` patterns. It provides:

- honest loading, error, empty, and retry states;
- explicit branch, payer, bucket, exception-state, date, and search filters;
- 50-row paged worklists;
- conditional finance tabs based on the authenticated role; and
- a browser download only after the audited server export succeeds.

The Day Summary and Today pages also moved to the shared Manila clinic-date
helper so adjacent financial screens do not disagree around UTC midnight.

## Adversarial review and decisions changed by it

The requested adversarial review initially blocked shipment on four material
issues:

1. imported `Mismatch` reconciliation states were omitted;
2. the day headline implied accounting revenue recognition;
3. the first export approach could deliver a file without a durable audit row;
4. date defaults and day-summary SQL could split one Philippine clinic day
   across UTC dates.

Those findings changed the implementation: `Mismatch` was added, the headline
was renamed to `transactionNetTotal`, export became server-generated and
audit-blocking, and calendar-date handling was centralized on Asia/Manila. A
follow-up review found Day Summary still used a UTC browser default; that page
and its regression test were corrected. The final adversarial verdict was
**SHIP**, with no residual material finding recorded.

## Verification evidence

| Layer                  | Evidence on implementation commit `13cf200`                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend focused tests  | 9 report tests passed: aggregation, status semantics including `Mismatch`, role/scope boundaries, Manila date handling, and export audit behavior |
| Frontend focused tests | 4 tests across Reports Page, Day Summary Page, and clinic-date helper                                                                             |
| Browser journey        | 3 Playwright report journeys passed, including a successful `201` audited export and download                                                     |
| Repository gate        | `pnpm agent:check` passed, including formatting, lint, typecheck, build, design-system checks, and generated-contract drift                       |
| Pull-request CI        | Install/typecheck/build, backend integration, and E2E checks were green when this handover was written; refresh PR #618 before merge              |

## Known limits and intentionally excluded work

- Current AR is a present-balance aging lens, not period-end historical AR.
- `transactionNetTotal` is an operational header total, not formal accounting
  recognition. No recognition event or ledger was invented for this MVP.
- The exception view is read-only; assignment, resolution notes, write-off,
  appeal, and workflow mutations are not part of Phase 1.
- Group/corporate invoices spanning multiple patients remain a separate P1
  model gap.
- Tenant-configurable timezones are deferred until the tenant #2 work; the
  first clinic is explicitly bound to Asia/Manila.
- Additional CSVs require a stable data contract, retention decision, and
  audit semantics before implementation.
- No brand analytics, forecasting, denial-management dashboard, generic query
  builder, or Phase-3 KPI system was added.

## Local setup findings outside the report feature

Two pre-existing bootstrap issues were encountered while proving the browser
journey on a disposable worktree database:

- `pnpm setup` reached the graphify step and then failed because the graphify
  shell wrapper combines `set -e` with command substitution; and
- the application database role lacked `EXECUTE` on `citext_eq` in that
  disposable database despite the intended migration posture.

The report implementation and PR checks pass, but these bootstrap issues can
make a clean local E2E proof require manual repair. They are tracked in the
next-step register rather than silently attributed to the reporting code.

## File map

| Boundary        | Primary files                                                                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared contract | `packages/shared/src/schemas/reports.ts`, `packages/shared/src/index.ts`, `packages/shared/package.json`                                                                         |
| Backend         | `apps/backend/src/modules/reports/{contract,db,routes}.ts`, `apps/backend/src/shared/utils/clinicDate.ts`, day-summary module updates                                            |
| Frontend        | `apps/frontend/src/features/reports/ReportsPage.tsx`, `apps/frontend/src/features/reports/api.ts`, generated report contract, `src/lib/clinicDate.ts`, Day Summary/Today updates |
| Tests           | `apps/backend/tests/reports.test.ts`, Reports/Day Summary/clinic-date component tests, `e2e/reports.spec.ts`                                                                     |
| Durable context | `docs/ai-context/02-BACKEND-API.md`, `docs/ai-context/03-FRONTEND-UI-UX.md`, and this handover                                                                                   |

For current priorities and owner decisions, continue at the
[`Revenue-integrity reporting next-step register`](../STATUS.md#revenue-integrity-reporting-next-step-register).
