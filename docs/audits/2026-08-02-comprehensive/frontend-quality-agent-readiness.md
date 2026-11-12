# Frontend Quality and Agent-Readiness Audit

**Audit date:** 2026-08-02
**Original revision assessed:** `03fb4e500367854241bff9192d447e2d5f010c3a`
**Current-main reconciliation:** product code at `f743239c32ac94034fdb3e6e59a35d0f9b23cfdf`, reconciled in audit integration commit `58592303bac8e2ef4184bb2ac0e13d9838d4ad51`
**Scope:** React frontend, `@surevax/shared` contract use, browser session boundary, accessibility, clinical safety, tests, CI, developer workflow, and AI-agent readiness. Historical material was excluded from this review.

## Executive assessment

The frontend has a good structural baseline: strict TypeScript, route-level lazy loading, a common UI primitive set, cookie-based requests, real browser E2E coverage, generated contract types, and a worktree-aware setup script. `pnpm agent:check` passes.

The current assurance level is nevertheless inadequate for a clinical system. Coverage now completes, but is 5.81% lines and 3.15% branches. Browser-visible state still contains clinical draft content and patient identifiers. Generated types improve compile-time drift detection, but API response parsing remains unchecked and many public contracts still expose numeric internal IDs. The AI context graph is built from another worktree, and the canonical context documents still describe an older product state.

### Top priorities

1. Remove clinical drafts and patient identifiers from URL and browser storage. Retain only a server-side, user-bound draft reference, or keep an in-memory draft that is cleared on navigation and logout.
2. Establish runtime-validated API contracts from `@surevax/shared`, then eliminate duplicate response types, role unions, and local fetch implementations.
3. Enforce and expand coverage. The command now passes its 1% threshold, but CI does not run it and safety-critical paths remain sparsely covered.
4. Rebuild the knowledge graph in the active worktree and refresh canonical context before relying on it for agent navigation.

## Current-main reconciliation

This section supersedes older measurements and status language below where they differ. It compares the original audit revision with the product code inherited from `origin/main` at `f743239`. The audit integration commit adds audit material only, so this is the product baseline for the reconciliation.

### Recomputed current state

| Area | Current result | Evidence |
| --- | --- | --- |
| Static and build gates | `pnpm agent:check`, frontend typecheck, and frontend build passed. | `scripts/check-agent-ready.sh`, `apps/frontend/package.json` |
| Unit tests and coverage | `test:coverage` passed: 12 files, 99 tests, 5.71% statements, 3.15% branches, 3.66% functions, and 5.81% lines. The configured threshold is 1% for each metric. | `apps/frontend/vitest.config.ts:15-27` |
| Bundle | Production initial chunk is 573.79 kB minified, 176.67 kB gzip. It remains over Vite's 500 kB warning threshold. | `apps/frontend/vite.config.ts`, current build output |
| Code and test size | 307 frontend TS or TSX files, 12 unit-test files, 13 E2E specs. Excluding generated contracts, 52 source files exceed 300 lines and 21 exceed 500. | `apps/frontend/src`, `e2e` |
| Generated contracts | 16 checked-in generated contract files are imported by 16 feature modules. Drift is checked by `scripts/check-contract-drift.sh`. These are TypeScript types, not browser runtime validators. | `apps/backend/src/contracts/generate.ts:1-5`, `scripts/check-contract-drift.sh` |
| AI context and graph | The context router discloses staleness, but retains its 2026-05-02 date. The graph manifest still records absolute paths under a different worktree. | `docs/ai-context/_INDEX.md:1-5`, `graphify-out/manifest.json:1` |

### Original finding status

| Finding | Status | Current reconciliation |
| --- | --- | --- |
| F-01 Browser-visible clinical data | Confirmed | `arrivals/context.tsx` still stores patient, encounter, and standing-order IDs plus chief complaint, vitals, and bite assessment in `sessionStorage`, then restores the IDs into the URL. URL-as-state now also puts patient or selected-record identifiers on several other clinical and financial views. |
| F-02 Runtime API contracts | Changed | Contract code generation and a drift gate are now present, and 16 feature modules import generated types. `apiFetch<T>` still returns unchecked `res.json()` casts, local transport DTOs remain, and login continues to define a local Zod schema. |
| F-03 Internal numeric IDs | Confirmed | The generated contracts make the boundary leak more visible but do not remove it. Examples include `patientId`, `createdById`, and nested numeric `id` fields in `patients.gen.ts`, `standing-orders.gen.ts`, `inventory.gen.ts`, and `transactions.gen.ts`. |
| F-04 Coverage and CI | Changed | Coverage now passes rather than failing, and unit coverage grew from 4 to 12 files. Coverage remains low, uses a 1% global threshold, and `.github/workflows/ci.yml` runs `test` but not `test:coverage`. |
| F-05 Transport duplication | Confirmed | The five named admin modules still define local `apiFetch` functions and refresh independently. `useRecentList.ts` also performs its own raw refresh path. These bypass the shared single-flight refresh and shared `ApiError` normalization. |
| F-06 Context and graph freshness | Changed | The canonical stack rows now reflect React 19 and Node 22, but broader product-state content remains stale. The graph manifest still indexes another worktree with absolute paths. |
| F-07 Error reporting and accessible banner | Confirmed | Sentry initialization remains opt-in, while `ErrorBoundary.componentDidCatch` only calls `console.error`. `ErrorBanner` remains a plain `div` without alert or live-region semantics. |
| F-08 Bundle budget | Confirmed | The initial chunk increased from 560.09 kB to 573.79 kB minified. There is still no manual chunking strategy or enforced budget in `vite.config.ts` or CI. |
| F-09 Component size | Confirmed | The count over 300 lines rose from 44 to 52 and the count over 500 rose from 17 to 21, excluding generated contracts. `TransactionsCreatePage.tsx` is now 1,219 lines. |
| F-10 Integration branch CI | Confirmed | CI remains restricted to pull requests whose base is `main`, so worker PRs into a coordinator branch do not receive the standard CI workflow. |
| F-11 E2E safety coverage | Changed | The suite expanded from 5 to 13 specifications, including readiness coverage for money, dose queue, patient access, and reminders. This is material progress, but the report's negative-path expectations, including session expiry and several final commit paths, are not made required by a dedicated coverage gate. |

### New or expanded risks in the delta

1. URL-as-state expanded beyond arrivals. `ScheduledOrdersPage.tsx`, `TransactionsPage.tsx`, `ReceivablesPage.tsx`, and `PatientDetail.tsx` retain selected record or patient identifiers in query parameters. These are identifiers, not free text, but they remain browser history and copied-link exposure points.
2. Generated contract types can create misplaced confidence. The generator prints TypeScript from backend schemas and the frontend consumes those types, but it does not emit schemas or parse response bodies. A malformed response can still enter a clinical view as a trusted type.
3. The contract generator faithfully exposes the numeric IDs emitted by backend contracts. This converts the existing public-ID boundary violation from scattered local DTOs into checked-in generated browser-facing types, increasing the need to fix serializers at the source.

### Current priorities

1. Eliminate clinical drafts and record identifiers from browser storage and URLs. Keep only an opaque, short-lived server-bound draft reference if resumption is required.
2. Make generated contracts runtime-parseable at the frontend transport boundary, then remove local DTOs and local refresh implementations.
3. Remove numeric primary keys from response serializers before regenerating contracts, then enforce that browser contract types contain only public identifiers.
4. Run coverage in CI, raise risk-based thresholds, and extend browser tests around administration, financial commits, and expired-session recovery.
5. Rebuild `graphify-out` in the active worktree and refresh stale product-state assertions in the canonical context.

## Original audit method and checks

The following measurements are retained as the baseline at the original revision. Use the current-main reconciliation above for current values and finding status.

Static review covered the frontend source tree, shared schemas, test configuration, E2E specifications, CI, worktree setup, and Codex/Claude automation. Counts are based on files in `apps/frontend/src` at the assessed revision.

| Check | Result | Evidence |
| --- | --- | --- |
| `pnpm --filter @surevax/frontend typecheck` | Passed | Strict frontend typecheck passed. |
| `pnpm --filter @surevax/frontend build` | Passed with bundle warning | Vite emitted a 560.09 kB minified initial chunk, 173.55 kB gzip. |
| `pnpm --filter @surevax/frontend test` | Passed | 4 files, 38 tests, about 1.3 seconds. |
| `pnpm --filter @surevax/frontend test:coverage` | Failed | 3.5% lines and 0.92% branches, below the configured 1% branch threshold. |
| `pnpm agent:check` | Passed | Format, lint, custom static gates, recursive typecheck, and recursive build passed. It does not run frontend tests, coverage, or E2E. |
| Tailwind, design-system, and agent-doc sync checks | Passed | 0 arbitrary text sizes, 0 primitive violations, and agent documentation sync passed. |
| Full local E2E | Not run | Requires the seeded Docker/Postgres environment. Static inspection assessed all five E2E specifications. CI runs the browser suite. |

## Original audit agent-ready scorecard

| Pillar | Rating | Measured state | Priority improvement |
| --- | --- | --- | --- |
| Test coverage | Weak | 4 unit test files and 38 tests cover 3.5% of lines. Coverage does not complete successfully. | Repair coverage collection and require risk-based coverage for auth, transport, patient, arrival, order administration, and payment paths. |
| File structure | Adequate | Feature directories are understandable, but 44 of 252 source files exceed 300 lines and 17 exceed 500. The largest is 1,018 lines. | Split record-detail, patient-form, and transaction flows into co-located views, hooks, contracts, and actions. |
| End-to-end types | Weak | Strict compiler settings are enabled, but only 10 of 252 frontend source files import `@surevax/shared`, responses are unchecked casts, and several public response types expose numeric internal IDs. | Make shared request and response Zod schemas the browser boundary and parse every response. |
| Fast isolated environments | Weak | The intended `pnpm run setup` script provides per-worktree databases and deterministic ports, while Vite enforces the selected port. The documented `pnpm setup` command invokes pnpm's built-in command instead, and the project script requires Docker. | Correct the documented command, add a no-Docker frontend test profile, and fail fast with a concise setup diagnostic when required env files are absent. |
| Automated enforcement | Adequate | CI runs formatting, lint, typechecks, builds, frontend tests, backend tests, and E2E on PRs to `main`. Coverage, dependency vulnerability review, and integration-branch PRs are not enforced. | Add coverage and dependency gates, then include the coordinator/integration branch in CI triggers. |

## Original audit findings

### F-01: Clinical draft data and patient identifiers persist in browser-visible locations

**Severity:** P1, high
**Confidence:** High
**Evidence:** `apps/frontend/src/features/arrivals/context.tsx:4-14`, `apps/frontend/src/features/arrivals/context.tsx:23-36`, `apps/frontend/src/features/arrivals/context.tsx:75-79`, `apps/frontend/src/features/arrivals/context.tsx:91-117`, `apps/frontend/src/features/arrivals/context.tsx:131-135`.

The arrival context stores the selected patient ID, encounter ID, standing-order ID, free-text chief complaint, vitals, and bite assessment in `sessionStorage`. It also writes the identifiers into the browser URL. The user-ID check prevents a same-tab user switch from restoring the draft, but it does not protect data from browser history, copied links, extensions, shared workstation inspection before logout, or URL-bearing logs and referrers. The logout cleanup is defense in depth, not a safe persistence boundary.

**Impact:** Clinical and personal data can remain available outside the authenticated UI boundary, contrary to the system's privacy posture. A copied or logged URL exposes stable record identifiers.

**Remediation:** Keep only a random, opaque server-side draft ID in the URL if resumability is required. Bind the draft to the session and tenant, expire it quickly, and never serialize free text, vitals, or bite assessments to Web Storage. If server drafts are not yet available, retain the draft in memory and display an explicit warning that refresh loses unsaved clinical content.

**Verification:** Add browser tests that inspect URL, `sessionStorage`, and `localStorage` during every arrivals step, after logout, and after user switching. Assert no clinical field or patient identifier is present.

### F-02: API response safety is compile-time only, and shared contract ownership is incomplete

**Severity:** P1, high
**Confidence:** High
**Evidence:** `apps/frontend/src/lib/apiFetch.ts:63-91`, `apps/frontend/src/features/auth/components/LoginPage.tsx:23-27`, `packages/shared/src/schemas/auth.ts:8-13`, `apps/frontend/src/features/admin/usersApi.ts:7-22`, `packages/shared/src/schemas/auth.ts:29-40`.

`apiFetch<T>` returns `res.json()` cast to `Promise<T>` without runtime parsing. A malformed or changed API response therefore passes TypeScript and fails later in a clinical screen. The frontend has 252 TypeScript or TSX source files, but only 10 import `@surevax/shared`; many feature API modules define their own request and response shapes. Login validation is duplicated locally despite a shared login schema. More seriously, frontend role types include `TenantAdmin` while the shared role schema and `ADMIN_ROLES` omit it. Neither the frontend nor backend imports the shared role or login schema for the active auth routes.

**Impact:** API drift can produce incorrect clinical or financial UI states without a boundary failure. Role drift makes authorization-related behavior difficult for people and agents to reason about.

**Remediation:** Define versioned request and response schemas in `@surevax/shared`, including auth and role contracts. Replace `apiFetch<T>` with an API function that accepts a Zod schema and calls `schema.parse` or `safeParse` with a normalized contract error. Remove local role unions and duplicate login schemas. Adopt a temporary rule that every new endpoint must add a shared request and response schema plus a transport test.

**Verification:** Contract tests should reject malformed payloads and prove the frontend, backend handler, and shared schema accept the same valid fixture. Add a lint or architecture check that blocks feature API modules from declaring public transport DTOs outside the shared package.

### F-03: Browser-facing types explicitly expose internal numeric IDs

**Severity:** P1, high
**Confidence:** High
**Evidence:** `apps/frontend/src/features/patients/api.ts:604-655`, `apps/frontend/src/features/admin/attendanceApi.ts:22-28`, `apps/frontend/src/features/admin/partnerLabsApi.ts:19-23`, `apps/frontend/src/features/lab-orders/api.ts:30-34`, `apps/frontend/src/features/services/api.ts:23-27`, `apps/frontend/src/features/transactions/api.ts:100-104`.

The project rule requires public API IDs to be display ID strings and prohibits internal bigint IDs in frontend types or responses. `PatientDemographic` labels its numeric `id` as an internal bigint and additionally exposes numeric branch and lot IDs. At least ten other frontend response types expose numeric `createdBy.id` values or similar numeric IDs.

**Impact:** This breaks a stated API boundary, invites accidental use of database identifiers in UI and routes, and makes response contracts inconsistent.

**Remediation:** Remove internal identifiers from API serializers and frontend types. Return only stable display IDs or explicitly named opaque public IDs. Introduce a shared `DisplayId` schema/type and add serializer tests that fail if numeric primary keys appear in browser responses.

**Verification:** Add backend contract tests over every affected response and a repository check that rejects numeric `id` fields in frontend API DTOs unless explicitly allowlisted and documented.

### F-04: Frontend coverage is near zero, fails its own threshold, and CI does not run it

**Severity:** P1, high
**Confidence:** High
**Evidence:** `apps/frontend/vitest.config.ts:15-25`, `.github/workflows/ci.yml:54-63`, `scripts/check-agent-ready.sh:27-37`.

The coordinator coverage run measured 240 of 7,396 statements, 233 of 6,652 lines, 50 of 2,692 functions, and 66 of 7,135 branches. That is 3.24% statements, 3.5% lines, 1.85% functions, and 0.92% branches. It exits nonzero because branch coverage is below the configured 1% threshold. CI runs `test`, not `test:coverage`; `agent:check` runs neither.

**Impact:** The single test command used in CI can pass while the coverage mechanism is broken and most clinical workflows have no executable behavioral evidence.

**Remediation:** Run coverage in CI and set ratcheting per-file thresholds for safety-critical transport, authentication, arrivals, scheduled-order administration, payments, and break-glass paths. Raise global thresholds only after the report is stable and trustworthy.

**Verification:** A clean coverage run must exit zero, report every included source file, and be required by CI. Require tests for the 401 refresh path, session expiry, consent gate, FEFO and expired-lot UI blocks, transaction balance error, break-glass acknowledgement, and clinical-draft privacy boundary.

### F-05: Five feature modules duplicate fetch, refresh, and error behavior outside the canonical transport

**Severity:** P2, medium
**Confidence:** High
**Evidence:** `apps/frontend/src/lib/apiFetch.ts:40-60`, `apps/frontend/src/features/admin/usersApi.ts:60-85`, `apps/frontend/src/features/admin/attendanceApi.ts:47-71`, `apps/frontend/src/features/admin/approvalsApi.ts:39-62`, `apps/frontend/src/features/admin/auditApi.ts:61-84`, `apps/frontend/src/features/admin/partnerLabsApi.ts:30-53`.

The common transport deduplicates parallel refreshes and normalizes non-OK responses as `ApiError`. Five administrative API modules maintain copied raw-fetch implementations. These copies issue independent refresh calls, return unchecked JSON, do not share the current redirect behavior, and collapse errors to generic strings. Other raw-fetch paths exist for header reads, attachments, health-card download, PIN verification, and auth.

**Impact:** A burst of expired-token requests can race refresh-token rotation in some screens while identical requests behave correctly in others. Error presentation and recovery differ by feature, increasing agent and maintainer error rates.

**Remediation:** Provide a low-level `apiRequest` that returns `Response` for header or blob use cases while retaining common credentials, tenant, CSRF, one-refresh deduplication, and error normalization. Make `apiFetch` a schema-parsing convenience wrapper. Delete the five local implementations.

**Verification:** Add MSW tests that run concurrent 401 requests through every API entry point and assert exactly one refresh request, one retry per request, and the same normalized session-expired behavior.

### F-06: AI context and graph data are stale or point at another worktree

**Severity:** P2, medium
**Confidence:** High
**Evidence:** `docs/ai-context/_INDEX.md:1-23`, `docs/ai-context/00-SYSTEM-CORE.md:3-23`, `graphify-out/manifest.json:2`.

The context router identifies itself as last updated on 2026-05-02. The system-core document describes React 18 and Node 20, whereas the installed frontend declares React 19 and CI runs Node 22. It also describes an earlier G3 state. The graph manifest indexes absolute paths under `.claude/worktrees/nervous-babbage-a0443b`, not this worktree. A graph query returned obsolete-looking JavaScript nodes and unrelated paths, so it is unsafe as an authoritative navigation tool here.

**Impact:** Agents can choose obsolete APIs, dependency assumptions, deployment constraints, and file paths. This directly expands search space and weakens the claimed single source of truth.

**Remediation:** Rebuild `graphify-out` from the active worktree and make its manifest record the Git revision and repository-relative paths. Refresh the canonical documents after each architectural wave, including runtime versions, tenancy/auth state, and shipped modules. Add a CI check that fails when the graph revision or context's last-reviewed revision is behind the source revision by an agreed limit.

**Verification:** In a fresh worktree, run a graph query for `apiFetch`, auth context, and a current feature. Every returned source path must resolve in that worktree and the manifest revision must equal `git rev-parse HEAD`.

### F-07: Render failures are only logged to the browser console, and the common error banner is not announced

**Severity:** P2, medium
**Confidence:** High
**Evidence:** `apps/frontend/src/main.tsx:8-17`, `apps/frontend/src/components/layout/ErrorBoundary.tsx:23-26`, `apps/frontend/src/components/layout/ErrorBanner.tsx:23-28`.

Sentry is initialized when configured, but the application error boundary catches render failures and only calls `console.error`; it does not send the exception to Sentry. The shared error banner is a plain `div` without `role="alert"` or an `aria-live` region. A clinical user can therefore encounter an unreported render failure or an error message that assistive technology does not announce.

**Impact:** Production rendering defects may be invisible to operations, and screen-reader users can miss failed loads or blocked clinical actions.

**Remediation:** Call `Sentry.captureException` from `componentDidCatch` when Sentry is configured, with scrubbed route and feature tags only. Give the error banner an appropriate live-region semantic, verify focus management for blocking errors, and ensure no PHI is sent in telemetry.

**Verification:** Unit-test a throwing child under the boundary, mock Sentry, and assert one sanitized capture. Add accessibility tests that assert critical error states expose an alert or polite live region as appropriate.

### F-08: The initial JavaScript bundle exceeds the Vite warning threshold without a performance budget

**Severity:** P2, medium
**Confidence:** High
**Evidence:** `apps/frontend/src/App.tsx:1-90`, `apps/frontend/vite.config.ts:19-37`.

Route components are lazy-loaded, which is a good baseline. The production build nevertheless emits a 560.09 kB minified `index` chunk, 173.55 kB gzip, and Vite warns that it exceeds 500 kB. The Vite configuration has no chunk strategy or measurable bundle budget.

**Impact:** Slow clinic networks and lower-end devices pay a large first-load cost before users can reach urgent worklists.

**Remediation:** Inspect the chunk with a bundle visualizer, isolate large shared dependencies through deliberate manual chunks where beneficial, and add a CI bundle budget for initial JS and route chunks. Measure real Core Web Vitals on clinic-like hardware before setting limits.

**Verification:** Record baseline and target gzip sizes in CI. Confirm the login and arrivals routes meet the agreed LCP and interaction budgets on a throttled mobile or low-end desktop profile.

### F-09: Large feature components reduce reviewability and testability

**Severity:** P2, medium
**Confidence:** High
**Evidence:** `apps/frontend/src/features/patients/components/PatientDetail.tsx:1`, `apps/frontend/src/features/dashboard/DashboardPage.tsx:1`, `apps/frontend/src/features/encounters/components/EncounterDetail.tsx:1`, `apps/frontend/src/shared/components/AppShell.tsx:1`, `apps/frontend/src/features/patients/components/PatientForm.tsx:1`.

Of 252 frontend source files, 44 exceed 300 lines and 17 exceed 500. The largest examples are `PatientDetail.tsx` at 1,018 lines, `DashboardPage.tsx` at 867, `EncounterDetail.tsx` at 836, `AppShell.tsx` at 814, and `PatientForm.tsx` at 813. These files combine data coordination, state transitions, rendering, and user actions.

**Impact:** High-context files make clinical changes harder to review, increase merge conflicts among agents, and leave individual safety rules difficult to isolate in tests.

**Remediation:** Decompose by record section and action boundary. Co-locate each view with its query, typed action, loading/error state, and focused tests. Extract pure calculation and policy code from React components before splitting UI layers.

**Verification:** Add a size report to `agent:check`, initially as a warning for files above 500 lines. Each decomposition should preserve route-level E2E behavior and introduce unit tests for extracted policy functions.

### F-10: CI bypasses PRs to the integration branch used by parallel workers

**Severity:** P2, medium
**Confidence:** High
**Evidence:** `.github/workflows/ci.yml:21-27`, `.github/workflows/ci.yml:54-63`, `.github/workflows/ci.yml:142-220`.

The workflow runs only for pull requests targeting `main`. Parallel workers are required to open PRs against a coordinator branch, so those PRs do not receive the build, frontend test, backend test, or E2E quality gates. The checks run only after the coordinator later opens a main-targeted PR.

**Impact:** Integration defects accumulate in the coordinator branch, and agents cannot use required CI evidence before handoff.

**Remediation:** Trigger CI for PRs into the coordinator branch pattern, or use `pull_request` without restricting the base branch and preserve concurrency by PR number. Keep deployment steps main-only if needed, but do not gate validation on the final merge target.

**Verification:** Open a test PR against a non-main integration branch and confirm the same static, test, database, and E2E jobs run.

### F-11: Browser E2E gives useful smoke coverage but leaves safety-critical commits unproven

**Severity:** P3, moderate
**Confidence:** High
**Evidence:** `e2e/daily-loop.spec.ts:4-16`, `e2e/arrivals.spec.ts:3-14`, `e2e/transactions.spec.ts:3-12`, `playwright.config.ts:33-45`.

The five E2E specifications cover login, route smoke, arrival bundle creation, transaction creation, and opening the administer dialog. The daily loop explicitly stops before confirming administration, and the transaction flow stops at a pending transaction. The suite serializes one worker against a shared seeded database, which favors determinism but limits concurrent test confidence.

**Impact:** The highest-risk write operations, including consent-gated administration, lot selection, inventory deduction, payment finalization, refunds, and cross-branch access, lack browser-level proof.

**Remediation:** Add deterministic fixtures for a valid due order and cover successful and refused administration, expired-lot hard stop, payment balance validation, refund, break-glass acknowledgement, and session expiry. Continue serializing destructive paths, but split read-only smoke tests into a parallel project.

**Verification:** Require each clinical correctness property with a browser-visible consequence to have at least one passing E2E scenario and one negative scenario where practical.

## Positive controls worth preserving

- TypeScript uses `strict` and `noUncheckedIndexedAccess` in `tsconfig.base.json:2-10`.
- The common transport sends cookies and the CSRF and tenant headers in `apps/frontend/src/lib/apiFetch.ts:63-69` and `apps/frontend/src/shared/lib/api-base.ts:31-42`.
- Routes are lazy-loaded in `apps/frontend/src/App.tsx:10-90`, and authenticated and administrator layouts are explicit in `apps/frontend/src/App.tsx:147-190`.
- The local UI guidance promotes reusable page, table, empty-state, sheet, and error primitives in `apps/frontend/AGENTS.md:5-35`.
- The worktree setup computes isolated ports and a worktree-specific database in `scripts/setup-worktree.sh:1-18` and `scripts/setup-worktree.sh:69-121`; Vite uses a strict configured port in `apps/frontend/vite.config.ts:8-35`.
- CI uses frozen lockfiles, runs a real PostgreSQL service, migrates and seeds before backend and E2E tests, and uploads Playwright artifacts in `.github/workflows/ci.yml:46-63`, `.github/workflows/ci.yml:108-140`, and `.github/workflows/ci.yml:195-228`.

## Recommended execution plan

### Phase 0: Contain privacy and contract risk

1. Remove PHI and record identifiers from URL and Web Storage. Introduce a server-bound draft model if refresh-resume is a product requirement.
2. Remove numeric database identifiers from serializers and frontend DTOs.
3. Create shared Zod contracts for auth, roles, patient, arrival, scheduled-order, and transaction transport. Parse them at the browser boundary.
4. Consolidate all client requests behind a refresh-safe, schema-aware transport.

### Phase 1: Restore executable confidence

1. Fix the coverage provider parse failures, add transport/auth tests, and make coverage a CI requirement.
2. Add E2E fixtures and negative tests for clinical administration, financial commit paths, cross-branch access, and session expiry.
3. Ensure coordinator-branch PRs receive the same CI jobs as main-targeted PRs.

### Phase 2: Improve operational and agent feedback loops

1. Refresh canonical AI context and rebuild graph data from the active revision.
2. Split the largest components around independently testable clinical actions.
3. Add Sentry capture for boundary failures and accessible live error messaging.
4. Establish bundle and Core Web Vitals budgets with a measured baseline.

## Audit limitations

This report assesses the browser boundary and repository controls. It does not claim that backend authorization, RLS, database audit triggers, or production deployment configuration are secure; those require their respective server and infrastructure audits. No production data was accessed, and no product code was modified.
