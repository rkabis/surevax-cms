# Security, Privacy, and Tenant-Isolation Audit

Date: 2026-08-02
Scope: backend, database migrations, runtime configuration, CI, workers, attachments, generated API contracts, and the AppSheet migration importer.
Current reconciliation commit: `58592303bac8e2ef4184bb2ac0e13d9838d4ad51` on `codex/audit-integration-20260802`.
Current product baseline: `f743239c32ac94034fdb3e6e59a35d0f9b23cfdf` (`origin/main`), 158 commits ahead of the report's original code-review baseline.
Original report commit: `03fb4e500367854241bff9192d447e2d5f010c3a`.

## Executive summary

The application retains worthwhile controls: signed HttpOnly cookies, access and refresh token separation, rotation and reuse detection, credential-aware CORS, request-size limits, parameterized Drizzle queries, tenant RLS, audit triggers, and a real non-superuser RLS test harness. The 158-commit product delta improved some branch masking and financial-approval controls, but it did not close the security boundary represented by ordinary `branchId: null` application reads.

The original critical finding must be narrowed. Standard patient list and detail responses now mask several cross-branch fields. However, ordinary attachment reads remain tenant-wide and unaudited as break-glass, while several patient child routes disclose or change cross-branch SPI and clinical history. These paths derive their database context from `branchId: null`, which turns on `app.cross_branch_read`, rather than an explicit audited break-glass intent. The new child-route issue is high severity because it permits cross-branch contact-data disclosure and modification by an authenticated user in the same tenant.

Production enablement should remain blocked until the branch-access issues, plaintext platform MFA seed storage, credential-field audit redaction, runtime-role validation, and attachment verification are addressed and tested under the actual runtime role. This report records no product fixes.

## Current-main reconciliation

This section is the authoritative status of every original finding at the current reconciliation commit. `Changed` means the original fact or severity is no longer accurate, even when risk remains. `Unable to verify` is reserved for deployed state or live registry state unavailable from this worktree.

| Finding | Current status | Current conclusion |
| --- | --- | --- |
| S1 | Changed | Patient list/detail masking reduces the originally described full-chart disclosure. Attachment reads still bypass branch break-glass, and related child-route exposure is tracked as N1. |
| S2 | Confirmed | Platform TOTP seeds are still stored and read as plaintext. |
| S3 | Confirmed | `pin_hash` and `mfa_secret_encrypted` are still not redacted from audit snapshots. |
| S4 | Confirmed | PHI access logging remains post-response and fail-open. |
| S5 | Confirmed | Hash-chain assignment still has no serialization lock. |
| S6 | Confirmed | The runtime app role still receives execute on all public functions and procedures, including unbounded privileged maintenance procedures. |
| S7 | Changed | The repository now tests a non-superuser RLS role and checks role attributes in CI, but boot-time runtime-role validation is still absent and E2E still runs as superuser. |
| S8 | Changed | Only the creator can now obtain an upload URL, which reduces overwrite risk. Server-side object existence, length, and checksum verification remain absent. |
| S9 | Confirmed | `/ready` still returns the raw database error message to unauthenticated callers. |
| S10 | Confirmed | Platform lockout remains a per-process `Map`. |
| S11 | Changed | Live DPA purge and restore-drill controls remain unavailable. The control register also contains a stale pre-squash migration reference. |
| S12 | Confirmed | Current live registry evidence reports 35 production advisories. Frozen-lockfile CI remains a positive control, but CI lacks an audit/SBOM/action-SHA policy. |

New current-main findings are N1 and N2 below.

## Method and limitations

This reconciliation reviewed the current product code inherited from `origin/main` at `f743239`, the merge commit named above, and the complete 158-commit delta with focus on RLS and branch access, auth and MFA, audit and PHI logging, attachments, secrets, error exposure, financial approvals, generated contracts, dependency controls, and runtime-role tests. `archive/` and archived handovers were not used as evidence.

Focused static checks completed:

- `git diff --check` passed.
- Source review of all original evidence paths and the current RLS, patient, attachment, MFA, audit, approval, contract-generation, CI, and runtime-role paths completed.
- Commit history and changed-file review completed for `03fb4e5..f743239`.

Focused runtime checks were not completed in the isolated worktree. It has no installed `node_modules`, the available `node` is v26.5.0 rather than the repository-pinned Node 22, and the package-manager invocation did not complete in this execution environment. Database integration and E2E checks also require generated environment files and a mutable Postgres instance. Deployment credentials, database role membership, R2 bucket policy, TLS, backup restoration evidence, production worker flags, and live npm registry advisory state were unavailable. Therefore, no deployed-state assertion is made.

Severity describes realistic impact if exploited. Confidence describes confidence in the code observation, not likelihood of a specific deployment configuration.

## Reconciled original findings

### S1. Changed. Ordinary full patient list/detail reads are now masked, but ordinary attachment reads still bypass the branch boundary

Current status: Changed from Critical to High severity, High confidence branch-access gap.

The original report correctly identified that `withTenantTx` turns a null branch into `app.cross_branch_read=true`. That behavior remains in `apps/backend/src/shared/db/withTenantTx.ts:78-94`, and the restrictive branch policy still admits every branch row when that GUC is true in `apps/backend/drizzle/0001_extensions_and_rls.sql:918-939`. The current source contains 145 `branchId: null` call sites in 30 backend module files, so this is a broad convention rather than a narrowly isolated exception.

The original claim that `GET /api/patients` and `GET /api/patients/:displayId` return the full chart is stale. Current routes pass `req.tenant.branchId` into the patient helpers in `apps/backend/src/modules/patients/routes.ts:96-105` and `:116-126`. `apps/backend/src/modules/patients/db.ts:354-386` masks cross-branch contact and address fields in lists, and `:611-659` masks detailed demographic, allergy, condition, payer, and dose data in the ordinary detail response.

That improvement is application-layer masking, not branch-restricted retrieval. `listPatients` and `getPatient` still execute with null branch context at `apps/backend/src/modules/patients/db.ts:233` and `:516`. More importantly, attachment list, detail, presign lookup, and mark-uploaded paths call helpers that also use null branch context at `apps/backend/src/modules/attachments/routes.ts:137-170`, `:182-299`, and `apps/backend/src/modules/attachments/db.ts:92-144`, `:244-253`. No `crossBranchRead` intent, reason, or `CROSS_BRANCH_ACCESS` audit is required.

Impact: an authenticated same-tenant user can read attachment metadata, including server storage keys, by attachment or owner display ID across branches. The binary-object download path and deployed bucket policy could not be verified, so this report does not claim direct object download.

Remediation: make normal attachment access branch-aware through a verified owner-to-branch relationship, or require the typed break-glass intent for cross-branch access. Eliminate the request-facing null-branch convention or contain it in dedicated, allowlisted tenant-wide helpers. Add HTTP tests using the `surevax_app` role for attachment list, detail, presign, finalization, and delete paths.

### S2. Confirmed. Platform administrator TOTP secrets are stored and read as plaintext

Current status: Confirmed, High confidence.

`platform_users.mfa_secret` remains documented as development plaintext in `apps/backend/src/shared/db/schema.ts:2852-2855`. Login reads it directly and passes it to TOTP verification in `apps/backend/src/modules/auth/operatorRoutes.ts:121-175`; enrollment writes the Base32 secret directly at `:237-274`.

Use authenticated encryption with a managed key, versioned ciphertext and nonce, fail-closed decryption, rotation, and re-enrollment. Do not log plaintext or ciphertext.

### S3. Confirmed. Audit records retain PIN and encrypted-MFA secret fields

Current status: Confirmed, High confidence.

Tenant users still have `pin_hash` and `mfa_secret_encrypted` in `apps/backend/src/shared/db/schema.ts:335-352`. The final audit trigger snapshots rows at `apps/backend/drizzle/0002_audit_and_redaction.sql:468-541`, but its redaction lists omit both fields. The trigger is attached to `users` in the same file at `:161-185`.

Redact `pin_hash`, `mfa_secret_encrypted`, `mfa_secret`, token hashes and identifiers, reset-token fields, and sensitive JSON paths. Verify the raw `audit_logs.changes` value with representative create and update operations.

### S4. Confirmed. PHI access logging is fail-open

Current status: Confirmed, Medium confidence.

The middleware runs after `res.finish` and explicitly never blocks the response in `apps/backend/src/shared/middleware/phiAccessLog.ts:129-145`. Both log writers catch errors and only send a server log at `:360-386` and `:407-438`. List and unresolvable accesses are now recorded with null patient IDs at `:330-347`, which improves coverage but does not create durable evidence when insert fails.

For clinical detail and cross-branch reads, write access evidence in the request transaction before returning data, or use a durable transactional outbox with monitoring and alerting.

### S5. Confirmed. Audit-chain hashes race under concurrent writes

Current status: Confirmed, Medium confidence.

`audit_logs_chain_link` selects the preceding hash without row or advisory locking in `apps/backend/drizzle/0002_audit_and_redaction.sql:266-300`. The verifier expects a single timestamp-and-ID predecessor at `:369-402`. Concurrent rows in one partition can therefore chain against the same predecessor and later fail verification.

Serialize chain assignment per partition, for example with a transaction-scoped advisory lock or locked chain-head row, and test concurrent inserts from separate connections.

### S6. Confirmed. App role can invoke unbounded privileged retention and partition procedures

Current status: Confirmed, Medium confidence.

`surevax_app` is granted execute on all public functions, procedures, and future routines in `apps/backend/drizzle/0001_extensions_and_rls.sql:807-821`. `create_next_audit_partitions` is `SECURITY DEFINER` and accepts unbounded `months_ahead` in `apps/backend/drizzle/0007_retention_procs.sql:22-43`; `purge_phi_access_log` is `SECURITY DEFINER` and accepts unbounded retention days at `:80-96`.

The HTTP invocation path is not established by this review, but least privilege is still broken for a compromised runtime role or future unsafe SQL path. Use a dedicated non-login worker role, grant only required routines, validate bounded parameters, and enforce trusted tenant context inside the procedure.

### S7. Changed. RLS runtime-role assurance improved in CI but remains incomplete

Current status: Changed, Medium confidence.

The original conclusion that CI had no runtime-role coverage is stale. `scripts/check-seed-runtime.sh:71-101` checks that `surevax_app` is neither superuser nor `BYPASSRLS`, and the CI integration job calls it at `.github/workflows/ci.yml:127-130`. The cross-branch integration suite also creates and uses a non-superuser `NOBYPASSRLS` role at `apps/backend/tests/integration/cross-branch-phi.test.ts:293-394`.

The remaining gap is material: `DATABASE_URL` is still merely URL-validated in `apps/backend/src/shared/config/env.ts:20-31`; application boot does not verify `current_user`, role flags, or table ownership. The migration runner still falls back to the runtime URL at `apps/backend/src/shared/db/migrate.ts:68-86`, and E2E explicitly uses the Postgres superuser for both URLs at `.github/workflows/ci.yml:171-175`.

Fail startup for any non-test runtime role that is owner, superuser, or `BYPASSRLS`; require a separate migrator URL outside local development; and run at least one HTTP suite as `surevax_app`.

### S8. Changed. Attachment upload authority improved, but integrity verification remains client-asserted

Current status: Changed, Medium confidence.

Only the attachment creator can now request a presigned PUT URL in `apps/backend/src/modules/attachments/routes.ts:257-278`, which resolves the prior arbitrary-user overwrite case. The server still accepts caller-supplied hash, size, encryption flag, and arbitrary metadata in `:84-108`; it signs only a content type at `:280-289`; and `mark-uploaded` remains a no-op at `:292-310`. `apps/backend/src/modules/attachments/db.ts:203-237` persists the supplied metadata without trusted object inspection.

Use short-lived upload sessions and trusted object `HEAD` or checksum verification before availability. Enforce length and checksum conditions where the object store supports them, record verification time, and reject unverified downloads.

### S9. Confirmed. Readiness response exposes raw backend failures

Current status: Confirmed, Low confidence.

`/ready` returns `err.message` to unauthenticated callers in `apps/backend/src/app.ts:205-218`. Return a fixed `not_ready` response and retain details only in server logs.

### S10. Confirmed. Platform lockout is per process

Current status: Confirmed, Low confidence.

Platform-login attempt state remains an in-memory `Map` in `apps/backend/src/modules/auth/operatorRoutes.ts:49-93`. A restart or another replica resets the five-attempt lockout. Persist counters and lock expiry in the database or a shared rate-limit store and test across processes.

### S11. Changed. DPA live erasure and disaster recovery remain unverified, and one active control reference is stale

Current status: Changed, Low confidence compliance gap.

The route forces dry-run analysis at `apps/backend/src/modules/admin/dpa.ts:1-84`, and `purge_patient` rejects live operation in `apps/backend/drizzle/0007_retention_procs.sql:203-256`. `docs/compliance/dpa-controls.md:77-88` still records no live purge or restore drill, but it cites the deleted pre-squash path `apps/backend/drizzle/0018_dpa_purge_function.sql`; the active function is in `0007_retention_procs.sql`.

Before real data, approve a retention and legal-hold process, deliver a multi-approver purge or anonymization workflow with R2 cleanup and audit evidence, execute a restore drill, record RPO/RTO, and correct the active control evidence path.

### S12. Confirmed. Current production dependency advisories require triage and CI enforcement

Current status: Confirmed, High confidence for the CI control gap and the current registry inventory.

CI uses `pnpm install --frozen-lockfile` at `.github/workflows/ci.yml:46-58`, `:108-110`, and `:195-197`, a positive reproducibility control. It still does not run a production vulnerability scan, generate an SBOM, enforce a dependency-update policy, or pin third-party actions to immutable SHAs. Mutable action tags remain at `.github/workflows/ci.yml:35-41`, `:97-103`, and `:184-190`.

The coordinator reran the production audit against the live registry at the current reconciliation point and reported 35 vulnerabilities across 569 production dependencies: 2 critical, 17 high, 14 moderate, and 2 low. Registry severity does not establish reachability or exploitability in SureVax. Add `pnpm audit --prod` with a documented severity policy, retain an SBOM, triage direct and transitive paths, use reviewed dependency updates, and pin Actions to reviewed commits.

## New current-main findings

### N1. High, High confidence. Patient child routes disclose and modify cross-branch data without break-glass

Evidence:

- `GET /api/patients/:displayId/emergency-contacts`, `GET /external-immunizations`, and `GET /consents` resolve a patient tenant-wide and return full child data without a cross-branch predicate or mask in `apps/backend/src/modules/patients/routes.ts:287-333`, `:360-417`, and `:718-743`.
- Their database helpers use `withTenantTx` with `branchId: null` in `apps/backend/src/modules/patients/db.ts:1016-1046`, `:1126-1151`, and `:1526-1558`, activating the cross-branch read behavior described in S1.
- The contact create and delete paths resolve the target patient tenant-wide, then write child rows that have no `branch_id` policy, in `apps/backend/src/modules/patients/routes.ts:307-353` and `apps/backend/src/modules/patients/db.ts:1048-1121`.
- The normal patient `PATCH` route calls `updatePatient` without a cross-branch guard at `apps/backend/src/modules/patients/routes.ts:156-190`; its lookup and update run with null branch context at `apps/backend/src/modules/patients/db.ts:860-944`.
- The recent masking work protects allergy and condition writes with explicit route guards, demonstrating the missing guard pattern for the other child routes: `apps/backend/src/modules/patients/routes.ts:436-540` and `:584-704`.

Failure scenario: a Branch A authenticated user who knows a Branch B patient display ID reads emergency contact phone/email, consent records, or external immunization history, then changes the patient demographics or creates/deletes emergency contacts. No break-glass reason or cross-branch audit record is required. This is a same-tenant authorization failure, not a cross-tenant RLS failure.

Remediation: centralize patient branch authorization before every patient child read or write. Allow only the documented Tier-1 projection by default; require typed, audited break-glass for Tier-2 cross-branch reads; reject every cross-branch write. Add HTTP tests for all `/api/patients/:id/*` routes, including mutation attempts, using two branch identities and the RLS-bound runtime role.

### N2. Medium, High confidence. Unbounded attachment metadata can enter immutable audit snapshots without redaction

Evidence:

- Attachment creation accepts `metadata: z.record(z.unknown()).nullable()` in `apps/backend/src/modules/attachments/routes.ts:84-108` and passes it to storage in `apps/backend/src/modules/attachments/db.ts:203-237`.
- The attachment schema persists that JSONB value in `apps/backend/src/shared/db/schema.ts:2391-2418`.
- The audit trigger attaches to `attachments` at `apps/backend/drizzle/0002_audit_and_redaction.sql:161-185` and snapshots row JSON after only a fixed denylist at `:468-541`; it does not remove `metadata` or redact nested keys.

Failure scenario: a client or future feature puts PHI, token material, presigned URLs, or other sensitive values in attachment metadata. The value is returned by ordinary attachment reads and copied into the retained audit chain. The schema provides no field-level contract that prevents this.

Remediation: replace free-form metadata with a narrowly typed allowlist, reject secrets and PHI fields, omit metadata from audit snapshots or apply a recursive redactor, and test raw audit rows for representative nested values.

## Focus review of delta areas

- Financial approvals: the current void/refund gate files or consumes approvals transactionally in `apps/backend/src/modules/transactions/db.ts:2079-2359`; approval handlers lock pending requests, reject self-approval, enforce role and branch membership, and prevent duplicate votes in `apps/backend/src/modules/admin/approvals.ts:297-555`. No direct bypass was identified in this focused static review.
- Generated contracts: code generation consumes an explicit side-effect-free registry and writes only frontend type artifacts in `apps/backend/src/contracts/defineContract.ts`, `generate.ts`, and `registry.ts`. No source-controlled route authorization bypass was identified. Contract generation itself runs a formatting subprocess, so CI execution should remain restricted to trusted repository code.
- AppSheet importer: current importer sources are not wired into an unauthenticated HTTP route by this review. Its operational input, credentials, and live-data handling remain deployment and operator controls that could not be verified.
- Secrets and errors: runtime secret values are not committed in the reviewed paths. Production env validation rejects weak auth secrets, localhost/wildcard CORS, and `EXPOSE_ERRORS=true` in `apps/backend/src/shared/config/env.ts:86-130`; S9 remains the identified unauthenticated error-exposure exception.

## Positive controls observed

- Access and refresh cookies are HttpOnly, Secure, and short-lived for access tokens in `apps/backend/src/modules/auth/routes.ts:40-48`.
- Refresh rotation locks the prior row and revokes a reused token family in `apps/backend/src/modules/auth/db.ts:271-335`.
- CORS is credential-aware and state-changing browser requests require a non-simple header in `apps/backend/src/app.ts:140-190` and `apps/backend/src/shared/middleware/csrf.ts:3-17`.
- Tenant RLS is enabled and forced, while the audit trigger rejects tenant-GUC mismatch in `apps/backend/drizzle/0001_extensions_and_rls.sql:465-480` and `apps/backend/drizzle/0002_audit_and_redaction.sql:449-465`.
- Branch writes remain restrictive even when a typed cross-branch read is active in `apps/backend/drizzle/0001_extensions_and_rls.sql:918-945`.
- Upload URL authority is limited to the creating user in `apps/backend/src/modules/attachments/routes.ts:257-278`.
- The repository now includes a non-superuser, `NOBYPASSRLS` branch-isolation test path in `apps/backend/tests/integration/cross-branch-phi.test.ts:293-696`.

## Recommended remediation sequence

1. Close S1 and N1 together: establish one branch-authorization helper, eliminate request-facing null-branch reads, and add RLS-bound HTTP coverage for every patient and attachment route.
2. Fix S2 and S3 before any platform operator or real credential data is introduced. Encrypt platform MFA seeds and redact credential-related fields, including historical audit exposure handling.
3. Address S4 through S8 with durable PHI access evidence, serialized audit chains, least-privilege worker routines, startup runtime-role verification, and verified attachment finalization.
4. Close N2 and S11-S12 before production data: constrain attachment metadata, complete DPA/DR evidence, and implement supply-chain triage and CI policy.
