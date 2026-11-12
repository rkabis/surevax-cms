# SureVax CMS Comprehensive Codebase Audit

- **Audit date:** 2026-08-02
- **Initial workspace revision:** `03fb4e500367854241bff9192d447e2d5f010c3a`
- **Current product baseline reconciled:** `f743239c32ac94034fdb3e6e59a35d0f9b23cfdf`
- **Coordinator branch:** `codex/comprehensive-audit-20260802`
- **Decision:** Not ready for production or real clinical data

## Executive summary

SureVax has a strong development baseline. TypeScript is strict, the database uses forced RLS, clinical and financial tables use audit and soft-delete patterns, the frontend uses cookie sessions, FEFO allocation uses database locking, and the main static quality gate passes.

Those controls are not yet sufficient for a production clinical system. The audit confirmed two critical correctness and authorization defects:

1. Passing `branchId: null` automatically enables cross-branch reads. Ordinary clinical request paths use that context without an explicit break-glass decision or required PHI audit event.
2. Normal payment and patient-account credit locking improved on current main, but the still-mounted legacy prepayment route retains an unlocked read-then-write balance check. Concurrent requests can still spend the same deposit balance twice.

The audit also confirmed high-risk gaps in dependency hygiene, platform MFA secret storage, audit redaction, browser PHI handling, API identifier boundaries, shared runtime contracts, AppSheet migration readiness, and notification delivery truthfulness.

Production enablement should remain blocked until the Phase 0 items in this report are fixed and verified under the runtime database role.

## Audit reports

- [Security, privacy, compliance, and supply chain](./security-privacy.md)
- [Backend, database, architecture, and integrations](./backend-data-architecture.md)
- [Frontend quality, testing, UX safety, and agent readiness](./frontend-quality-agent-readiness.md)

## Scope and method

The audit covered:

- authentication, authorization, tenant and branch isolation, RLS, secrets, audit trails, attachments, privacy, logging, and dependency advisories
- API and database correctness, transactionality, data integrity, migrations, background workers, integration completeness, query behavior, and public ID contracts
- frontend session state, PHI exposure, runtime response validation, accessibility, error reporting, bundle size, component size, and browser tests
- unit, integration, E2E, and coverage posture
- CI triggers, custom static checks, local setup, documentation freshness, knowledge graph trustworthiness, and Codex workflow readiness

The assessment used two waves of three independent Terra audit workers plus coordinator verification. The first wave audited the workspace revision. After the initial PR exposed a 158-commit divergence from remote `main`, the coordinator merged that delta into a clean worktree and a second Terra wave revalidated every finding against the current product baseline. Every worker committed a report, pushed a dedicated branch, opened a PR against the coordinator branch, and had its remote commit and PR state verified before integration.

Historical content under `archive/` and archived handovers was treated as context only. No production system or production data was accessed.

## Repository profile

| Measure | Result |
| --- | ---: |
| Backend source files | 202 |
| Frontend source files | 307 |
| Shared source files | 10 |
| Production TS and TSX files assessed | 519 |
| Production TS and TSX lines | 122,238 |
| Files over 300 lines | 116 |
| Files over 500 lines | 50 |
| Files over 800 lines | 15 |
| Backend test files | 41 |
| Frontend unit test files | 12 |
| E2E spec files | 13 |
| SQL migration files | 9 |

The largest production files include the 3,236-line transaction persistence module, 2,916-line database schema, 2,074-line scheduled-order persistence module, 2,007-line patient persistence module, and 1,219-line transaction creation screen. This concentration increased during the product delta and makes safety rules harder to test in isolation.

## Consolidated risk register

### Critical

#### A-01: Branch scope can become implicit cross-branch clinical access

`withTenantTx` treats `branchId: null` as permission to set `app.cross_branch_read=true`. The current baseline has 145 such occurrences across 30 backend module files. Some are legitimate tenant-wide or system operations. Current main added masking and branch predicates to ordinary patient and scheduled-order list responses, but scheduled-order detail, timeline, and preview helpers, attachment operations, and several patient child routes still use implicit cross-branch context without a separate authorization grant, reason, expiry, or synchronous PHI read audit. Some patient child routes also permit cross-branch modification.

**Impact:** A user can receive same-tenant PHI from branches outside the expected branch boundary. This weakens the database-first isolation model and bypasses the intended break-glass ceremony.

**Required action:** Separate branch absence from cross-branch authorization. Require an explicit, typed authorization object for cross-branch reads. Verify the caller, role, reason, expiry, resource class, and synchronous audit event before setting the RLS GUC. Default every request-scoped clinical transaction to a concrete branch.

**Verification:** Add negative API and database tests under `surevax_app` for patient, attachment, encounter, scheduled-order, transaction, and inventory reads. A null or missing branch must fail closed. Break-glass tests must prove explicit grant, scope, expiry, and audit evidence.

**Mapped findings:** S1, N1, BD-01.

#### A-02: Concurrent financial requests can violate balances

Current main fixed normal payments by locking the transaction header, and the newer patient-account credit flow locks the patient account, bills, and credit sources. The active legacy `POST /api/transactions/:id/apply-prepayment` path still reads its source and consuming transactions without `FOR UPDATE`, calculates a draw, and inserts afterward.

**Impact:** Two concurrent legacy prepayment requests can both observe the same deposit balance and double-spend it.

**Required action:** Retire the legacy endpoint or lock source and destination transaction headers in a canonical order before calculating the balance. Reuse the newer patient-account locking design and preserve idempotency.

**Verification:** Add deterministic concurrent integration tests that synchronize two requests after the initial read and before insertion. Exactly one request may consume the remaining balance.

**Mapped finding:** BD-02.

### High

#### A-03: Production dependencies contain unresolved advisories

The live registry audit reported 35 production dependency vulnerabilities across 569 dependencies: 2 critical, 17 high, 14 moderate, and 2 low. The set includes advisories in direct or transitive paths through Drizzle, bcrypt tooling, tar, React Router, PostCSS, and other packages.

Registry severity is not proof that every advisory is reachable in this application. It is proof that dependency triage, upgrade, and CI enforcement are incomplete. Direct Drizzle SQL identifier injection advisories require special attention because the application uses a small number of dynamic SQL identifier paths.

**Required action:** Upgrade direct dependencies first, regenerate the lockfile, document reachability for residual transitive advisories, and add a production dependency audit gate with an explicit expiring allowlist.

**Mapped finding:** S12.

#### A-04: Platform administrator TOTP secrets are plaintext

Platform user MFA enrollment writes and reads the Base32 TOTP secret directly. The tenant-user schema has a field intended for encrypted MFA material, but the platform-admin path does not provide equivalent protection.

**Required action:** Encrypt TOTP secrets with a managed key, define rotation and recovery behavior, restrict read access, and add platform audit events for enrollment, reset, and use.

**Mapped finding:** S2.

#### A-05: Database audit rows retain sensitive credential fields

The audit trigger redacts several credential fields but does not remove `pin_hash` or `mfa_secret_encrypted` from old and new row images.

**Required action:** Extend trigger redaction, migrate or purge existing development audit content as appropriate, and add trigger tests for every credential-like column.

**Mapped finding:** S3.

#### A-06: Browser state persists clinical drafts and identifiers

The arrivals context writes patient, encounter, and standing-order identifiers to the URL and persists chief complaint, vitals, bite assessment, and identifiers in `sessionStorage`.

**Required action:** Keep drafts in memory or store them server-side behind an opaque, session-bound, short-lived reference. Clear on logout and user change. Add browser assertions that clinical data and record identifiers never appear in URL, `localStorage`, or `sessionStorage`.

**Mapped finding:** F-01.

#### A-07: Internal bigint identifiers cross the public API boundary

Backend serializers and frontend DTOs expose numeric database identifiers despite the project rule that public IDs are display ID strings.

**Required action:** Remove internal keys from responses, introduce shared public ID schemas, and add serializer tests and a static rule that reject numeric public `id` fields unless narrowly allowlisted.

**Mapped findings:** BD-03, F-03.

#### A-08: Shared runtime contracts are not the actual source of truth

The backend has 45 module files that import Zod directly and no backend module files that value-import `@surevax/shared`. Current main adds 16 registered feature contracts, checked-in generated frontend types, and a passing contract-drift gate. This materially improves compile-time drift detection, but `apiFetch<T>` still casts JSON without runtime validation, public types still expose internal IDs, and feature-local contracts remain outside the stated shared-package source of truth.

**Required action:** Resolve the backend runtime import constraint, define request and response schemas in the shared package, parse at both transport boundaries, and eliminate duplicated role unions and public DTOs.

**Mapped findings:** BD-06, F-02.

#### A-09: The AppSheet non-dry-run migration path is a throwing stub

The default migration adapter throws for writes, so the documented real import path is not executable.

**Required action:** Implement the production adapter, validate transaction and rollback behavior, and run dry-run plus reconciliation tests against a fresh isolated database before any cutover planning.

**Mapped finding:** BD-04.

#### A-10: Notifications can be marked sent without delivery

The notification sender logs and returns success without a provider. The dispatcher can therefore record delivery success for a message that was never sent.

**Required action:** Introduce a provider interface with explicit delivered, retryable, permanent-failure, and disabled states. Never mark sent on a development logger stub.

**Mapped finding:** BD-05.

### Medium

#### A-11: Runtime RLS enforcement is not verified end to end

Current main adds a real non-superuser RLS policy harness and role-attribute checks, which is material progress. Ordinary application endpoint tests and CI E2E still use a migrator or superuser path, and the service does not verify at startup that its effective role is `NOBYPASSRLS` and non-superuser.

**Required action:** Add a startup assertion and a CI test lane that serves real API requests through `surevax_app`.

**Mapped findings:** S7, BD-07.

#### A-12: PHI read logging is asynchronous and fail-open

PHI access evidence is written after the response and logging failures do not block the read.

**Required action:** Define which regulated reads require synchronous evidence, use an outbox or durable queue for the remainder, and alarm on logging lag or failure.

**Mapped finding:** S4.

#### A-13: Audit-chain hashes can fork under concurrency

The trigger selects the previous hash without serializing concurrent inserts.

**Required action:** Serialize chain-head updates per tenant or partition and add concurrent trigger tests.

**Mapped finding:** S5.

#### A-14: Attachment integrity and size are client-asserted

The server stores client-provided size and hash metadata without verifying the object during finalization.

**Required action:** Verify object existence, length, content type, checksum, and ownership before a record becomes available.

**Mapped finding:** S8.

#### A-15: Maintenance procedures have broad application-role execution

Security-definer retention and partition procedures are callable by the application role without sufficiently narrow parameter bounds.

**Required action:** Revoke broad execute privileges, expose narrowly scoped job roles, and validate bounds inside every security-definer function.

**Mapped finding:** S6.

#### A-16: Coverage is far below a useful clinical assurance level

Frontend coverage now passes its 1% thresholds with 5.71% statements, 5.81% lines, 3.66% functions, and 3.15% branches across 12 files and 99 tests. Backend unit-only coverage is 8.59% statements, 8.4% lines, 7.58% functions, and 7.73% branches across 19 files and 161 tests, and still fails its global thresholds. CI runs frontend tests but not coverage. The E2E suite expanded to 13 specs, but several negative authorization, concurrency, and expired-session cases remain outside a required gate.

**Required action:** Establish reliable coverage collection, then ratchet by safety-critical module. Add positive and negative concurrent, authorization, clinical administration, payment, refund, and session-expiry cases.

**Mapped findings:** F-04, F-11.

#### A-17: Setup, toolchain, and agent guidance were inconsistent

The repository defines a script named `setup`, but `pnpm setup` invokes pnpm's built-in environment setup command. It does not run the project bootstrap. The intended command is `pnpm run setup`. The repository also declares pnpm 9.15.0, while the host default was pnpm 11 with Node 26. The audit branch corrects active setup guidance, pins Node 22 in `.nvmrc`, and narrows the engine constraints to the verified major versions.

**Required action:** Keep Node 22 and pnpm 9.15.0 as the verified baseline, use Corepack or an equivalent pin, and test the documented bootstrap command in CI.

#### A-18: The knowledge graph and canonical context are stale

The graph was built from another worktree and predates the assessed revision. An update attempt refused to overwrite because the regenerated graph had fewer nodes, and stale queries included historical archive content. The canonical React and Node rows were refreshed in this PR, but broader product-state content remains stale.

**Required action:** Rebuild from the active revision, store repository-relative paths and the source commit in the manifest, exclude historical material from default navigation, and add a freshness check.

**Mapped finding:** F-06.

#### A-19: Integration-branch PRs do not receive CI

CI triggers only for PRs targeting `main`, while repository policy requires parallel workers to target a coordinator branch first.

**Required action:** Run validation on pull requests to integration branches. Keep deployment conditions restricted to the intended protected branch.

**Mapped finding:** F-10.

#### A-20: Client transport behavior is duplicated

Five administrative API modules duplicate fetch, token refresh, and error handling outside the canonical transport. This can race refresh-token rotation and creates inconsistent failure behavior.

**Required action:** Provide one low-level response-aware transport and one schema-parsing JSON wrapper, then migrate all callers.

**Mapped finding:** F-05.

#### A-21: Several list and fan-out paths are unbounded

Scheduled-order listing lacks a bounded pagination contract, and recall fan-out performs repeated per-item work.

**Required action:** Add cursor pagination, maximum limits, set-based queries, and query-count regression tests.

**Mapped finding:** BD-08.

#### A-22: Error exposure configuration accepts misleading false strings

`EXPOSE_ERRORS` uses `z.coerce.boolean()`. In Zod, non-empty strings such as `"false"` and `"0"` coerce to `true`. Every currently deployed environment is documented as development, so the production-only startup rejection is not an effective fallback there.

**Required action:** Parse an explicit enum such as `true`, `false`, `1`, and `0`; default closed; and test every supported value.

#### A-23: Observability, accessibility, and performance gates are incomplete

The React error boundary only logs to the console, the common error banner lacks live-region semantics, and the initial Vite chunk increased to 573.79 kB minified and 176.67 kB gzip without a budget.

**Required action:** Capture scrubbed render exceptions, add accessible alert semantics and focus behavior, and enforce measured initial and route-level bundle budgets.

**Mapped findings:** F-07, F-08.

#### A-24: Free-form attachment metadata can persist sensitive values into audit history

Attachment creation accepts arbitrary JSON metadata. The same value is returned by ordinary attachment reads and copied into audit snapshots without a nested-field contract or recursive redaction.

**Required action:** Replace free-form metadata with a typed allowlist, reject PHI and secret-bearing keys, and either omit the field from audit snapshots or recursively redact it. Test the raw audit row with representative nested values.

**Mapped finding:** N2.

### Lower-priority operational debt

- Readiness output can disclose backend failure messages.
- Platform account lockout is process-local and resets on restart.
- DPA erasure and disaster-recovery procedures are documented but not operational.
- Large backend persistence modules and frontend components concentrate sensitive rules and slow review.

These items remain relevant but should not displace the Critical and High remediation sequence.

## Controls worth preserving

- Forced RLS exists on tenant-scoped tables, and request GUCs are generally set inside transactions.
- Authentication uses signed HttpOnly cookies, refresh rotation, issuer and audience checks, CSRF headers, strict CORS, and generic login failure responses.
- Helmet, request-size limits, rate limiting, structured redaction, and Sentry PII defaults provide a useful security baseline.
- Audit triggers enforce tenant consistency and already redact several credential fields.
- FEFO inventory selection uses ordering plus locking and `SKIP LOCKED`.
- TypeScript uses `strict`, `noUncheckedIndexedAccess`, and `noImplicitOverride`.
- Frontend routes are lazy-loaded, shared UI primitives are established, and the application has useful smoke E2E coverage.
- `pnpm agent:check` combines instruction sync, design-token checks, formatting, lint, typecheck, and builds.
- CI uses frozen lockfiles and a real PostgreSQL service for migration, seed, backend, and browser test lanes on main-targeted PRs.

## Agent-readiness scorecard

| Pillar | Rating | Evidence | Exit condition |
| --- | --- | --- | --- |
| Test coverage | Weak | Frontend improved to 5.81% lines and passes a 1% threshold; backend unit-only is 8.4% lines; coverage is not enforced; highest-risk negative cases remain. | CI ratchets critical modules and workflows with concurrency and negative authorization cases. |
| File structure | Weak | 116 production files exceed 300 lines, 50 exceed 500, and 15 exceed 800. | Safety rules and data access are split into focused modules with co-located tests. |
| End-to-end types | Weak | Strict TS and a generated-type drift gate are present, but backend shared value imports are absent, responses are unchecked casts, and generated types faithfully reproduce numeric ID leaks. | Shared request and response schemas are parsed at both boundaries, and generated public types exclude internal keys. |
| Fast isolated environments | Weak | The script designs per-worktree ports and databases, but the documented command was wrong and Docker is required for DB verification. | A fresh worktree bootstrap is command-tested, pinned, fast, and has a no-Docker unit profile. |
| Automated enforcement | Adequate | Static checks and contract drift are broad and pass; a non-superuser policy harness exists. Coverage, dependency audit, integration-branch CI, startup role validation, and several architecture rules are absent. | Each missing gate is automated with a narrow, actionable failure message. |

## Verification results

| Check | Result |
| --- | --- |
| `pnpm agent:check` under Node 22.23.1 and pnpm 9.15.0 | Passed |
| Formatting, ESLint, recursive typecheck, recursive build | Passed through `agent:check` |
| Tailwind token and design-system checks | Passed |
| Generated contract drift check | Passed, 16 registered feature contracts matched checked-in frontend types |
| Frontend unit tests and coverage | Passed, 12 files and 99 tests; 5.81% line and 3.15% branch coverage |
| Backend unit project | Passed, 19 files and 161 tests |
| Backend unit-only coverage | Failed global thresholds, 8.4% line coverage |
| Live production dependency audit | Failed, 35 advisories reported |
| Secret pattern scan | No committed private key or obvious real credential found; dedicated secret scanners were unavailable |
| Full database bootstrap | Blocked, the Docker daemon is unavailable in the audit environment |
| Backend integration and local E2E | Not run because the isolated database could not be created |
| Graph rebuild | Refused to overwrite because the regenerated graph lost nodes; existing graph remains untrusted |

## Remediation plan

### Phase 0: Contain release-blocking risk, target 0 to 72 hours

1. Make branch scoping fail closed and remove implicit `branchId: null` authorization.
2. Retire or lock the legacy prepayment route and add deterministic concurrent tests.
3. Encrypt platform TOTP secrets and extend audit redaction.
4. Remove clinical data and identifiers from browser storage and URLs.
5. Remove internal numeric IDs from public serializers and DTOs.
6. Triage and upgrade critical and high production dependency paths.
7. Keep production enablement and real-data use blocked until these controls pass under `surevax_app`.

### Phase 1: Restore trustworthy boundaries, target 1 to 2 weeks

1. Make shared Zod request and response contracts executable in both applications.
2. Add startup role assertions and runtime-role API integration tests.
3. Serialize or redesign audit-chain updates and make required PHI read evidence durable.
4. Verify attachment object integrity before finalization.
5. Replace notification and AppSheet stubs with explicit disabled states or real implementations.
6. Raise and enforce coverage with negative E2E cases for clinical, financial, and authorization paths.
7. Add dependency and integration-branch CI gates.

### Phase 2: Improve scale and change safety, target 2 to 6 weeks

1. Paginate scheduled orders and replace recall fan-out with set-based work.
2. Consolidate browser transport and refresh behavior.
3. Split the largest database and React modules around policy and transaction boundaries.
4. Add accessible error semantics, scrubbed render telemetry, and bundle budgets.
5. Rebuild graph data, refresh canonical context, and enforce revision freshness.
6. Operationalize DPA erasure, restore exercises, retention jobs, and platform lockout storage before production.

## Codex operating baseline

Use this sequence in a fresh worktree:

```bash
pnpm install --frozen-lockfile
pnpm run setup
pnpm agent:check
```

The verified toolchain is Node 22.23.1 with pnpm 9.15.0. Do not use bare `pnpm setup`; it invokes pnpm's built-in environment command. Use `pnpm run setup --force` only when intentionally regenerating local environment files and the worktree database.

Until the knowledge graph is rebuilt and revision-pinned, treat it as a navigation hint only. Use direct source search to verify every result, and exclude `archive/` plus archived handovers from current architecture decisions.

For task execution:

1. Read root `AGENTS.md`, then the relevant context router and feature-specific `AGENTS.md`.
2. Check worktree status and preserve unrelated user changes.
3. Create a `codex/` branch. Never commit to `main`.
4. For database or API work, use `pnpm run setup` and verify `apps/backend/.env` exists before testing.
5. Run the narrow test first, then `pnpm agent:check`. Add token and design-system checks for frontend UI work.
6. Treat shared Zod schemas, display IDs, tenant RLS, soft deletes, audit triggers, and FEFO as mandatory boundaries.
7. For parallel workers, branch from the coordinator's exact HEAD. Require commit, push, and PR evidence. Verify remote commit and PR state before integration.
8. Update `AGENTS.md`, `CLAUDE.md`, `README.md`, and canonical context in the same PR when workflow or architecture changes.

## Limitations

- The Docker daemon and local PostgreSQL were unavailable, so coordinator-run integration, migration, seed, and E2E verification could not be repeated locally.
- Dependency counts reflect registry advisories at audit time. Application reachability needs package-by-package analysis.
- The scan did not use gitleaks, TruffleHog, Semgrep, OSV-Scanner, Syft, or Grype because they were not installed.
- The assessment is a code and repository-control audit, not a penetration test, legal opinion, clinical safety certification, or production infrastructure review.
- No real clinical data was accessed.
