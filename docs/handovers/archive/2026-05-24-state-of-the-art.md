# State of the Art — 2026-05-24

> Consolidates outstanding work after Waves 6–9 closed across this session.
> Supersedes [`2026-05-19-remaining-todos.md`](2026-05-19-remaining-todos.md),
> [`2026-05-23-360-codebase-review.md`](2026-05-23-360-codebase-review.md),
> and [`2026-05-23-ui-audit-deep-dive.md`](2026-05-23-ui-audit-deep-dive.md)
> (all moved to archive — their actionable items are either shipped or rolled
> into this doc).
>
> One handover stays active alongside this one:
> [`2026-05-23-preview-workflow-coverage.md`](2026-05-23-preview-workflow-coverage.md)
> (browser-driven workflow tracking). The cross-branch PHI RFC, the post-AUTH-2
> pending list, and the UI form-surface redesign were all resolved 2026-06-03
> (PR #531) and moved to `archive/`; their last open items (SEC-7 operator
> lockout + the deferred UI "later" list) are folded into this doc below.

---

## TL;DR

**Foundation is genuinely shippable for a single-clinic Phase 1 deploy.** Eleven
of fourteen HIGH-severity audit findings from the 2026-05-23 360 review are
closed. Every CRITICAL is closed. The remaining gaps cluster around three
buckets: design decisions that need a human call, vendor / external sign-off
for things like BIR receipt fields, and Phase 2 multi-tenant operational work
(no real Phase 2 customer yet to drive it).

Across this session **5 dispatch waves shipped ~22 PRs**:

| Wave     | Theme                                                                                                                    | PRs                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| 6        | B32 ServicePicker, Wave 3 ID hygiene, H4 Helmet, Wave 7 backend Zod, apiErrorMessage, TODO refresh                       | #465 #466 #467 #468 |
| 7        | Edit patient silent-drop, a11y + chrome + Wave 9 kiosk renames, currency polish + B48, TODO v1.7 + Clinic-day rename     | #469 #470 #471 #472 |
| 8        | Phase 2 tenant-onboarding playbook, format-module canonical-semantics spec                                               | #473 #474           |
| Refactor | H6 strict-tenant audit trigger + M8 DirtyFormGuard data-router migration                                                 | #475 #476           |
| 9        | Branch role PSO + format Phase A + receipt branch name + Sentry M14 + PayerProfile edit + eslint sibling-worktree ignore | #477 #478           |

Plus a hotfix PR-in-flight for the env.ts Sentry-fields oversight ([#477](https://github.com/njvil/surevax-cms-revamp/pull/477) follow-up).

---

## Design decisions locked in this session

1. **Format helpers** (per [#474](https://github.com/njvil/surevax-cms-revamp/pull/474) spec): 14-day relative-date cutoff stays; `formatMoney` outputs `₱4,820.00` (peso symbol); helpers named per `Intl.DateTimeFormat dateStyle` convention (`formatDate`, `formatLongDate`, `formatDateTime`, `formatLongDateTime`, `formatTime`, `formatMoney`, `formatNumber`).
2. **Branch role posture**: Branch is the **comprehensive single-login-per-physical-location** — cashier + clinical access. Per-user roles defer to a later phase. Tenant + Branch admin handle user/branch/audit management. No separate kiosk layout needed.
3. **Receipt clinic header**: sourced from the signed-in user's primary branch via `/api/auth/me` extension. Phase 2 multi-tenant works without further code change.
4. **Sentry**: free tier, init gated on DSN so dev needs no project. Backend `setupExpressErrorHandler` + frontend `browserTracingIntegration` at 0.0 sample rate (errors only). PII not shipped.
5. **Dark mode**: deferred indefinitely.
6. **JSONB encryption (M17)**: deferred until threat model + key-mgmt strategy chosen.

---

## Open work

### Worker-eligible — ready to dispatch

~~**Format Phase B codemod.**~~ **Shipped 2026-05-24 (Wave 10).** Phase A landed canonical helpers in `@/lib/format` ([#477](https://github.com/njvil/surevax-cms-revamp/pull/477)); Phase B + C migrated all 38 callers from `@/shared/lib/format` to the canonical module in a single PR with 7 commits (6 batch commits + Phase C cleanup). Legacy module deleted; `.claude/rules/design-system.md` "two modules exist" warning replaced with the canonical helper table. Spec preserved at [`docs/specs/format-module-consolidation.md`](../../specs/format-module-consolidation.md) as historical record.

### Investigation-first — need focused session

| Item                                          | What's needed                                                                                                                                                                     |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B34 Lab Critical interpretation flow**      | Server contradicts user action. Needs reading the lab-orders state machine + UI flow to understand the contradiction before drafting a fix.                                       |
| **B38 Radix dialog DOM cleanup on Cancel**    | Some dialogs leak DOM nodes on cancel — needs Chrome DevTools investigation against the Radix portal/unmount behaviour.                                                           |
| **AppointmentDetail Participants**            | 6 raw-ID Participants fields at `AppointmentDetail.tsx:161-212` need resolution to names. Needs picking the right resolver pattern (probably new `<ParticipantLabel>` primitive). |
| **Currency-input programmatic value-set bug** | RHF `setValue` doesn't fire change handlers on numeric inputs in some flows. Needs Playwright reproduction.                                                                       |
| **Cross-midnight kiosk day-rollover**         | Requires system-clock advance OR seeded yesterday's drawer. Behaviour unverified.                                                                                                 |
| **Mobile viewport clips (375px / 768px)**     | Need preview MCP or actual browser to find clipped surfaces.                                                                                                                      |

### External / decision-blocked

| Item                                                                                                                            | Blocker                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BIR receipt rebuild** (TIN, PTU/ATP, accreditation, OR series, VAT breakdown, SC/PWD line, cashier signature, dynamic footer) | Real values from ops. `AcknowledgementReceipt.tsx` + `escpos/receipt.ts` ready to receive structured fields.                                                                                                                                                                                   |
| **Phase 2 customer trial**                                                                                                      | Onboarding playbook lives at [`docs/runbooks/tenant-onboarding.md`](../../runbooks/tenant-onboarding.md) (#473) but no second tenant has been onboarded. Catalog-copy SQL + rollback steps unverified. Cloudflare wildcard SSL + self-serve operator-console tenant-create form not yet built. |
| **H3 Redis-backed rate-limit**                                                                                                  | In-memory store works in single-process Phase 1. Redis decision is a Phase 2 + multi-replica requirement.                                                                                                                                                                                      |
| **M14 expanded observability** (structured-log shipping, OTel performance metrics)                                              | Sentry error aggregation shipped (#477). Vendor for log aggregation (Loki / Datadog / Honeycomb / self-hosted) needs decision.                                                                                                                                                                 |
| **M17 audit JSONB encryption**                                                                                                  | Need threat model + key-mgmt choice (KMS-backed vs Vault vs pgcrypto per-tenant).                                                                                                                                                                                                              |
| **Railway spend cap**                                                                                                           | Set in Railway dashboard. External knob.                                                                                                                                                                                                                                                       |
| **Cloudflare custom domains + R2 bucket**                                                                                       | `api.surevax.com`, `app.surevax.com`, DNS, SSL, R2. External knob.                                                                                                                                                                                                                             |
| **Bot 1 / Pneumococcal / Hep-TDAP-Varicella-Shingles SOT offsets**                                                              | Need ops sign-off before catalog/seed changes (carried over from 2026-05-19).                                                                                                                                                                                                                  |
| **Audit log Wave A emit sites** (`BREAK_GLASS`, `CONFIG_CHANGE`, `AUDIT_ACCESS`)                                                | Upstream UI work — don't implement speculatively.                                                                                                                                                                                                                                              |
| **SEC-7 operator DB-backed lockout** (from post-AUTH-2 section 5, now archived)                                                 | Deferred. In-process lockout (5 fails to 15-min) works for Phase 1 low-traffic operator login but resets on restart. The durable version (platform_users.failed_login_count + locked_until, mirroring auth/db.ts) is cheap to add when operator login becomes higher-traffic.                  |

### Phase 2 multi-tenant code references (unblock when tenant #2 onboards)

| File                                                   | Today                                     | Phase 2 unblock                                                             |
| ------------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------- |
| `apps/frontend/src/features/admin/BranchesPage.tsx:91` | Hardcoded `value="SVX"` KPI               | Pull from tenant context                                                    |
| `apps/backend/src/shared/db/seed/*`                    | Single-tenant seed                        | `pnpm db:seed --tenant <slug>` CLI flag (~50 LoC)                           |
| `tenants.timezone` consumption                         | Stored but only consumed in some surfaces | Audit + thread through day-summary / retention helpers (C2 from 2026-05-19) |
| H3 Redis rate-limit                                    | In-memory                                 | Redis-backed when multi-replica                                             |

### Wave 11 verification long tail — needs seed prereqs first

These workflows can't be browser-verified until specific seed data is added. From [`2026-05-23-preview-workflow-coverage.md`](2026-05-23-preview-workflow-coverage.md):

- Bite incident new + 14-day outcome — needs PatientPicker workflow exercise
- AEFI new report E2E — needs PatientPicker workflow exercise
- Lab result with `criticalValue=true` flag — needs B34 lab-critical fix first
- Apply prepayment to a draft — needs prepayment-state TXN seeded
- Each payment method exercised (Cash / GCash / Maya / Card / HMO / Corporate)
- BIR senior/PWD discount on a real receipt
- Cash drawer close with variance — needs counted-total flow
- Day Summary "Close day" actually fired (defer to staging)
- Inventory transfer ship → confirm receipt — needs second branch seeded
- Standing-order template version bump
- External-dose append
- Notification template create + dry-run + send
- Approval request approve / reject — seed has zero approvals
- Recall affecting an existing lot — needs recall row seeded
- WHO category I and III variants of arrivals wizard
- Edit patient + add allergy/condition inline
- Mobile / tablet viewport (kiosk is tablet-sized)
- Dark mode (deferred)
- Tagalog `fil-PH` UI swap
- Keyboard nav / focus order / focus-trap on dialogs
- axe-core a11y scan + color contrast
- Empty states on each list (re-seed with no data)
- Loading skeleton rendering (throttle network)
- ErrorBoundary fallback (force a render error)
- `row_version` conflict (open same record in two tabs)
- Refresh-token rotation in long-running kiosk session (>15 min idle)

### Seed-data prereqs

To unblock the verification tail:

- A prepayment-state transaction
- A notification template
- A pending approval request
- A product recall affecting a current lot
- A second branch
- A lab order flagged `criticalValue = true`

---

## Active design decisions still queued

### Cross-branch PHI access (RFC) — D1–D5 locked 2026-05-24, D6 deferred — ✅ IMPLEMENTED 2026-06-03 (steps 4–10)

See [`archive/2026-05-23-cross-branch-phi-rfc.md`](2026-05-23-cross-branch-phi-rfc.md) (archived — implemented 2026-06-03) for the full RFC. Decisions resolved 2026-05-24:

| #      | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **D1** | **Pattern B** with a 4th-option grant model: when a branch breaks glass for a patient, the grant is **persistent per-branch** — patient becomes visible at that branch from then on, no re-prompting. Audit row still fires per-access; the modal only fires once per (branch, patient) pair. RFC step 3's `cross_branch_access_grants` table stores `(branch_id, patient_id, granted_at, granted_by, initial_reason)` with no expiry column.                                                                      |
| **D2** | **Branch-scoped + TenantAdmin consolidated.** Branch staff see their own branch financials only; TenantAdmin sees consolidated revenue/AR/claims. Plus a hard invariant: **a transaction cannot span branches.** Next-dose-at-different-branch logs the new transaction under the new branch. Implementation requires a DB-level constraint or trigger that rejects `transactions` inserts where the cashier's branch doesn't match the patient's last-administered-branch. Tracked as a Wave 11 follow-up ticket. |
| **D3** | **Persistent grant** (subsumed by D1). The per-request / per-session / per-patient-per-shift options are not used.                                                                                                                                                                                                                                                                                                                                                                                                 |
| **D4** | **All chart details visible once glass is broken** at a branch — consistent with D1's persistent grant.                                                                                                                                                                                                                                                                                                                                                                                                            |
| **D5** | **Critical labs visible in Tier 1.** Last 90d, `ResultReceived` only, critical-flagged only.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **D6** | **Defer to Phase 2.** Phase 1 ships break-glass only. The `approval_requests` infra exists; switching to an approval-queue path is a config change later, not a rewrite.                                                                                                                                                                                                                                                                                                                                           |

**Implementation effort remaining:** ~4 person-days across RFC steps 2-10. Steps 2-6 are non-breaking and can land incrementally. Step 7 (breaking RLS flip) requires D2's transaction-invariant DB trigger to land first.

### Format module Phase B codemod kick-off — design parameters locked 2026-05-24

Spec sign-off complete (#474). Design parameters resolved 2026-05-24:

- **Execution shape:** 6 PRs in 2 parallel waves of 3 workers (not one mega-PR, not one-by-one).
- **Batch ownership:** per spec — patients+encounters / transactions+receipts / scheduled+clinical+arrivals / lab+adverse+bite / inventory / admin+branch.
- **Phase C:** 5-line PR deletes `apps/frontend/src/shared/lib/format.ts` after all six batches merge.

Ready for execution in a fresh session off main (see the codemod-session prompt at the bottom of this doc).

### Observability beyond Sentry — deferred 2026-05-24

Sentry error aggregation shipped (#477) is the Phase 1 ceiling. Structured-log shipping (Loki / Datadog / Honeycomb) + distributed tracing (OpenTelemetry) deferred until:

- Phase 2 customer reports an issue Sentry stack-trace alone can't diagnose, OR
- Recurring error in Sentry can't be reproduced from logs, OR
- Railway log retention bites (today: 7-day retention sufficient)

Integration when triggered is ~30 LoC + vendor DSN env var. Not a code blocker today.

### Investigation-first items — deferred 2026-05-24

| Item                                                   | Status                                                                                               |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| **B34** Lab Critical interpretation flow contradiction | Deferred. Re-open when a real clinic uses critical-flagged labs. Phase 1 has none.                   |
| **B38** Radix dialog DOM cleanup on Cancel             | Deferred. Cosmetic; not blocking. Re-open only if long kiosk sessions show memory growth.            |
| **Mobile clips at 375px / 768px**                      | Deferred until a Phase 2 customer's hardware needs it. Kiosk hardware is ABTC-controlled at 1024px+. |
| **AppointmentDetail Participants raw-ID resolution**   | Still open — small inline polish ticket when next session pivots to UI.                              |
| **Currency-input programmatic-set bug**                | Still open — Playwright-reproducible when Wave 11 verification needs to drive it.                    |
| **Cross-midnight kiosk day-rollover**                  | Still open — needs seed-data or clock-advance to verify.                                             |

---

## Codebase hygiene status

| Area                      | State                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Frontend test scaffold    | MSW + RTL + jsdom; 3 sample tests; coverage thresholds at 1% baseline (intentionally low; raise incrementally)                                                           |
| Backend integration tests | ~141 `it()` blocks across 10 files; new BEGIN/ROLLBACK helper (#462) + H6 strict-tenant tests (#475)                                                                     |
| Schema v2                 | Cutover complete since 2026-05-07. Dual-write pairs collapsed. Migrations consolidated to 8 files (baseline + 7 themed supplementals) in the 2026-05-28 AUTH-2 capstone. |
| Audit trigger             | Strict-tenant mode (#475) — refuses cross-tenant writes at the trigger layer.                                                                                            |
| Routing                   | Data router (`createBrowserRouter`) live since #476. DirtyFormGuard SPA-nav prompt working.                                                                              |
| Helmet                    | Hardened — CSP locked to `'none'` (JSON-only API), HSTS 2y + preload, CORP same-site.                                                                                    |
| RLS                       | `branch_isolation` policy active; `cross_branch_read` GUC explicit-flag pattern in `withTenantTx`.                                                                       |
| Type safety               | Strict TS across all packages. ~14 callers of `formatMoney` consume the canonical `₱`-prefixed form.                                                                     |
| Observability             | Sentry SDK init (errors only). Correlation IDs via pino-http. PHI access log default-on.                                                                                 |

---

## Recommended next actions in priority order

1. ~~**Implement Cross-branch PHI RFC steps 2-7**~~ **✅ DONE 2026-06-03 — steps 2–10 landed.** RESTRICTIVE `branch_isolation` flip, break-glass route + `BreakGlassReveal` modal, `/admin/cross-branch-access` page, and the 4-scenario integration suite (`cross-branch-phi.test.ts`). The RFC + `cross-branch-phi-access.md` now record D1's persistent-grant model.
2. ~~**D2 transaction-invariant DB trigger**~~ **✅ DONE** — `enforce_transaction_branch_invariant` lives in `0003_invariants.sql` (folded from the former `0025_d2_branch_isolation.sql`); it rejects a `transactions` insert whose branch doesn't match the patient's last-administered branch.
3. **External chasing:** BIR ops sign-off (TIN/PTU/ATP values), Sentry DSN provisioned on Railway + Cloudflare Pages, Railway spend cap set, Cloudflare R2 bucket + custom domains. All external knobs — no code blocker.
4. **Phase 2 sandbox-tenant trial** — ~1 day focused work. Onboard a `STJUDE_DEMO` tenant via the playbook end-to-end. Surfaces gaps. Also exercises `pnpm db:seed --tenant <slug>` (CLI flag still needs to be added to the seed module — ~50 LoC).

> Format Phase B + C shipped 2026-05-24 (Wave 10) — the previously-listed codemod item is closed.

---

## Cross-references

- [`TODO.md`](../../../TODO.md) — running ship-status backlog (currently v1.9)
- [`docs/specs/format-module-consolidation.md`](../../specs/format-module-consolidation.md) — Phase A/B/C plan
- [`docs/specs/cross-branch-phi-access.md`](../../specs/cross-branch-phi-access.md) — Pattern B implementation design
- [`docs/runbooks/tenant-onboarding.md`](../../runbooks/tenant-onboarding.md) — Phase 2 playbook
- [`docs/handovers/archive/2026-05-23-cross-branch-phi-rfc.md`](2026-05-23-cross-branch-phi-rfc.md) — D1–D6 decisions (implemented 2026-06-03)
- [`docs/handovers/2026-05-23-preview-workflow-coverage.md`](2026-05-23-preview-workflow-coverage.md) — workflow verification tracking
- [`.claude/rules/gotchas.md`](../../../.claude/rules/gotchas.md) — known low-frequency landmines
- [`.claude/rules/patterns.md`](../../../.claude/rules/patterns.md) — implementation patterns
