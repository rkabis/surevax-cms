# 2026-05-17 — UI/UX audit shipping session (Phase 0 + 2 orchestrate waves + Railway hotfix)

## Source

Implementation pass for the 9-wave audit captured in [`2026-05-17-ui-ux-audit.md`](2026-05-17-ui-ux-audit.md) (1785 lines, 59 PR-shape items). This handover documents what got shipped, the orchestrate-skill lessons learned, and what's left.

## Shipped to main this session

| PR                                                               | Title                                         | Notes                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#314](https://github.com/njvil/surevax-cms-revamp/pull/314)     | Phase 0 bundle (8 micro-fixes)                | Day-summary `il.service_id`→`product_id` join, attachment storageKey BLOCKER fix (server-derives `uploads/{tenantId}/{uuid}/{file}`), logout clears `surevax.*` / `branch.*` storage (PHI fix), Resp rate `(bpm)`→`(breaths/min)`, FSM→State humanization, Send-invoice hide-when-zero, ConsentsTab Invalid Date guard, Inventory `Expired` vs `expiring` badge                                                      |
| [#316](https://github.com/njvil/surevax-cms-revamp/pull/316)     | CI seed hotfix                                | `0012_sot_specialty.sql` was never in `_journal.json` or `SUPPLEMENTAL_SQL_FILES` — 4 main CI runs were red. Added to supplemental list                                                                                                                                                                                                                                                                              |
| [#319](https://github.com/njvil/surevax-cms-revamp/pull/319)     | W1 ID-format sweep                            | Administer-dose `IVM` → `childId(lot.id, 'INVTX')`, reschedule trigger `SC-…` → `{co_id}.CLI-{6 hex}` via new `0013_fix_schedule_change_id.sql`, initiate-protocol `clinical_orders.id` middle segment ENC→PSO. Sibling-leak: also carried W3's commit into the squash                                                                                                                                               |
| [#318](https://github.com/njvil/surevax-cms-revamp/pull/318)     | W2 frontend visual consistency                | `lib/status.ts` humanizer + ~10 list pages: Export stubs removed, KpiStrip ports for Transactions+Inventory, `humanizeStatus` wired in Lab Orders + AEFI. DEVIATION: Status columns kept (real variance, not 100% Active)                                                                                                                                                                                            |
| ~~[#317](https://github.com/njvil/surevax-cms-revamp/pull/317)~~ | W3 (CLOSED dup)                               | Content landed via #319's sibling-leaked squash. Closed-without-merge to avoid duplicate squash                                                                                                                                                                                                                                                                                                                      |
| [#320](https://github.com/njvil/surevax-cms-revamp/pull/320)     | W4 wizard URL+state sync                      | `useWizardGuardTarget(n)` redirect on deep-link, per-user sessionStorage hydration (kills cross-user PHI leak on kiosks), triple-stepper dedup, embed real `<VitalsPanel>` + `<BiteAssessmentPanel>` in Step 2 (replaces dev TODO copy). Required inline-recovery of a rules-of-hooks error in `Step3Protocol.tsx`                                                                                                   |
| [#321](https://github.com/njvil/surevax-cms-revamp/pull/321)     | W8 backend audit + ID hygiene                 | `audit_logs.entity_type` plural normalization (backfill of 6 singular forms), `staff_time_logs` audit trigger attached, `NTP` prefix synced to `packages/shared/displayId.ts`                                                                                                                                                                                                                                        |
| [#322](https://github.com/njvil/surevax-cms-revamp/pull/322)     | W6 form modernization                         | New shared `<PatientPicker>` + `<BranchPicker>` + payer picker primitives, 3 free-text ID inputs replaced (AEFI Patient, Book Appointment Branch, Record Payment Payer — last is conditional on method ∈ {HMO, Corporate}), ApplyPrepayment native→shadcn `<Select>` + `formatMoney`, region cascade native→shadcn `<Select>`, Patient edit form wired in detail rail                                                |
| [#324](https://github.com/njvil/surevax-cms-revamp/pull/324)     | W7 detail-rail completions (inline-recovered) | Audit log entity-ID `<Link>` click-through, Approval rail Approve/Reject inside the rail, DoseStrip aria-label + Tooltip a11y. Original W7 worker silent-failed mid-fix; recovered after verifying that close-drawer variance preview + initiate-protocol physician picker were already shipped                                                                                                                      |
| [#323](https://github.com/njvil/surevax-cms-revamp/pull/323)     | W5 polish sweep + a11y                        | New `apps/frontend/src/lib/format.ts` (`formatDate` relative/MMM-D, `formatDateTime`, `formatMoney`), DialogTitle on every Radix Dialog (kills 72 console warnings), required-asterisks audit (Invite User, AEFI, Allergies, Conditions), kiosk + payment-toast money formatting, Inventory lot rail humanization, Address autocomplete fallback notice, Attachment dropzone MIME whitelist + indeterminate progress |
| [#325](https://github.com/njvil/surevax-cms-revamp/pull/325)     | Railway hotfix + skill update + two-wave docs | The `0012_sot_specialty.sql` UPDATEs were unwrapped, so the audit trigger raised on every Railway deploy boot. Wrapped in a `DO` block with `set_config('app.current_tenant_id', …, true)`. Same PR ships orchestrate skill improvements (silent-failure respawn §2c-A1, sibling-leak auto-check §2b-ii, pre-extract verification §0g, supplemental-SQL GUC §5b) + gotchas + design-system rule updates              |

**Net** (first half of the session): ~35 of the 59 audit items closed across 11 PRs.

## Second half — Waves 3-8 (after this handover was first written)

Eighteen more PRs landed across six additional waves, closing the
remaining audit critical path. Detail in
[`2026-05-17-preview-walkthrough.md`](2026-05-17-preview-walkthrough.md) —
each PR is linked with its scope, plus an in-browser verification
checklist for the next pass.

| PR   | Title                                                                                    |
| ---- | ---------------------------------------------------------------------------------------- |
| #327 | useSearchParams filter state — Encounters, ScheduledOrders, LabOrders                    |
| #328 | DirtyFormGuard + auth `?returnTo=`                                                       |
| #329 | Cash-drawer poll gate + PATTERNS.md #25–28                                               |
| #330 | Claim → txn linking + region cascade `<Combobox>`                                        |
| #331 | WHO bite-category radio cards                                                            |
| #332 | Lab-order Sent + Result transition endpoints (backend)                                   |
| #333 | ICD-10 picker + bundled ABTC-relevant dataset                                            |
| #334 | Lab result-receipt frontend (dialogs + status-driven rail)                               |
| #336 | Kiosk 4-digit PIN backend                                                                |
| #337 | `<SortableHead>` primitive + `useTableSort`                                              |
| #338 | Kiosk PIN frontend (keypad + admin reset/clear)                                          |
| #339 | R2 presigned-PUT + real binary upload progress                                           |
| #340 | Sortable columns full-stack sweep (5 modules + 5 pages)                                  |
| #341 | Hotfix: 0015_users_pin_hash supplemental-SQL + idempotency (same shape as #316)          |
| #342 | UI paper-cuts: deterministic avatars + breadcrumb + Services width                       |
| #343 | `<ComingSoonButton>` primitive + Pattern 30 + 9-file sweep                               |
| #344 | Malformed `:id` → 400 backend sweep (12 modules)                                         |
| #345 | Inline wrap-up — 4 paper-cuts (subtitle bug, qty fmt, ICD-10 conditions, dashboard menu) |

**Net (full session)**: ~55 of the 59 audit items closed across 29 PRs.

Second-half recurring incidents (additional pattern data for the orchestrate skill):

- **Silent-failure rate ~50%** of workers across waves 5-7 returned mid-action without a `PR:` line. Almost all recoverable by inspecting the worker's worktree and finishing the tail inline (typecheck → format → commit → push → PR).
- **Sibling-commit leaks** continued (Wave 7 W2 ← W3, Wave 8 W3 ← Wave 7's sortable). Detected via §2b-ii `COMMITS_AHEAD` check; dropped cleanly on rebase once the canonical PR merged.
- **Supplemental-SQL gotcha recurred** — PR #336 added migration 0015 without updating `_journal.json` AND `SUPPLEMENTAL_SQL_FILES` AND adding `IF NOT EXISTS`. Same shape as #316. Hotfix in #341.
- **AWS SDK imports without `pnpm add`** — Wave 7 W3 imported `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` without installing. Caught by CI typecheck on #339; fixed via a follow-up commit on the same branch.

## Orchestrate skill — incidents recorded + codified

Three recurring failure modes were observed; all now have explicit handling in [`.claude/skills/orchestrate/SKILL.md`](../../.claude/skills/orchestrate/SKILL.md):

1. **Silent failure** (Wave 1 W4, Wave 2 W7) — agent returns a truncated mid-edit message with no `PR:` line, branch absent on remote. Skill §2c-A1 now mandates one respawn attempt before falling back to inline recovery.
2. **Sibling-commit leak** (Wave 1 W1←W3, Wave 2 W5←W8) — worker worktree picks up a sibling commit even with `isolation: "worktree"`. Skill §2b-ii now requires an explicit `COMMITS_AHEAD` check; multi-commit branches require triage before merge (close-dup OR rebase).
3. **Pre-extract drift** (Wave 2 W7) — prompt claimed two features were missing; both were already implemented. ~107k tokens wasted. Skill §0g now requires verifying current source before drafting "X is missing" claims.

Additional infrastructure gotcha recorded: supplemental SQL files that touch audited tables must wrap mutations in a `DO` block that sets `app.current_tenant_id` GUC — captured in [`gotchas.md`](../../.claude/rules/gotchas.md) "Audit trigger raises on missing tenant GUC" section.

## What's left — triaged

### Tier 1 — design-first features (multi-PR, ~150-300 LoC each)

- WHO bite-category structured field in PEP intake step 2 (Wave 2 #5)
- Lab result-receipt action in detail rail (Wave 2 #6) — Mark sent / Upload result / Enter result data
- `<DirtyFormGuard>` router blocker — wizard + edit dialogs + cashier form (Wave 3 #14)
- `useSearchParams` filter-state sweep — Encounters, Transactions, Scheduled Orders, Inventory, Lab Orders (Wave 3 #15)
- ICD-10 picker with autocomplete + description (Wave 5 #30)
- Sortable list-page columns + `<SortableHead>` primitive (Wave 6 #42)
- Kiosk Clock-in PIN/badge identity verification (Wave 5 #34)
- Real signed-URL upload progress on attachment dropzone (Wave 7 #48 deep)

### Tier 2 — polish (~30-150 LoC each, often coordinator-inline)

- Stop `/api/cash-drawer/current` polling for non-Branch users (`enabled: isBranch` gate in `useCurrentDrawer`)
- Claim → transaction linking on `+ New Claim` (Wave 7 #44)
- Region cascade typeahead-search via `<Combobox>` (Wave 7 #46 deep)
- Consolidate `@/shared/lib/format` + `@/lib/format` into a single module
- `apps/frontend/docs/PATTERNS.md` entries 26-28 (`<FormSectionHeader>`, `<ErrorBanner>`, `<ErrorBoundary>` + `<NotFoundPage>`)
- Schedule-dot click-through on PatientDetail Active Encounter card (Wave 6 #38) — needs upstream dose-fetching first

### Tier 3 — genuinely deferred (out-of-MCP or out-of-scope)

- Cashier / Nurse / Physician role-walk audits (only SuperAdmin + Branch covered)
- Tagalog UI swap
- Mobile / tablet / dark mode
- True two-tab interactions (`window.open` blocked in preview MCP)
- Web Bluetooth / WebUSB printing with real hardware
- Forcing access-token expiry mid-action (HTTP-Only cookies)
- Forgot password + Sign-in-with-Google on `/login` (intentional Pattern-23 stubs)

## Recommended next steps

1. **Verify Railway deploy is healthy** once #325 merges — pull `railway logs` and confirm `/health` returns 200 (4 prior boots failed on the GUC issue).
2. **Next orchestrate wave: 2-3 workers maximum.** This session ran 4-worker waves and hit 2 silent failures across them. Smaller waves reduce aggregate stall risk.
3. **Suggested next wave (Tier 1)**: `<DirtyFormGuard>` + `useSearchParams` filter sweep — both pure frontend, both cross-cutting on different state mechanisms (RHF dirty vs router URL state), minimal file overlap. WHO bite-category + Lab result-receipt should wait for explicit design acknowledgement first.
4. **Tier 2 items work as coordinator-inline batches** — each <100 LoC, doesn't justify a worker.
