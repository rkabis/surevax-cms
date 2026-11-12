---
name: parallel-work
description: Repo-specific conventions for parallel orchestration in SureVax CMS — applies to `/orchestrate-pilot` (preferred) and the legacy `/orchestrate`. Use when planning to spawn 2+ subagents for independent units, deciding whether to push back on a batch request, drafting worker prompts (deviation rule, doc-surface check, e2e recipe), handling the push-ref rename gotcha, and rendering worker reports. Skip for single-agent work — only loads when batch-shape work is on the table.
---

# Parallel Work — repo conventions

`/orchestrate` decomposes a request into independent worktree units and spawns one subagent per unit. This skill captures repo-specific conventions on top of the generic orchestration instructions.

## When to push back

Don't pad to hit the 5-unit floor when the work doesn't decompose. Push back, propose fewer units, and ask the user to confirm. Strong signals the work is **not** orchestrate-shaped:

- Decomposition naturally yields ≤3 units even with vertical slicing.
- Multiple units would touch the same file at the same insertion point (`routes.ts`, `db.ts`, a single React component's body). File-overlap reduction beats unit count — see memory feedback `feedback_batch_decomposition_check_file_overlap.md`.
- The named feature is mostly already implemented (verify file state before planning — don't assume the user knows the current status of every module).
- The work is sequential by nature: tooling/CI/format/test setup, schema migrations that depend on each other, RLS or audit-trigger changes that ripple through every sibling unit's e2e against the shared dev DB.
- A single DB-level invariant change retroactively breaks every other unit's e2e — see memory `feedback_batch_db_invariant_ripples.md`.

## Pre-flight checks

1. **Verify the user's premise.** If the instruction names a feature already shipped or already in flight, ask via `AskUserQuestion` before decomposing. The G3 transactions batch (2026-04-26) caught this: user said "transaction routing and display"; that page had already shipped 95% complete.
2. **Pre-allocate migration sequence numbers** if any unit adds a migration — see memory `feedback_batch_migration_numbering.md`.
3. **List file overlaps** explicitly in the plan. Routes/db/component files that every unit touches are conflict zones; either own them in one unit or document append-only insertion points each worker must respect.
4. **Decide the e2e recipe up-front** and embed it in every worker's prompt verbatim. Curl-against-dev-server beats typecheck-only — see memory `feedback_e2e_recipes_earn_signal.md`.
5. **Land shared-spine changes FIRST, before parallel dispatch.** If 2+ units would all need to add to the same union/list/index file (e.g. `displayId.ts` `ChildPrefix`, `migrate.ts` `SUPPLEMENTAL_SQL_FILES`, `02-BACKEND-API.md` route table), that file becomes a serialization point — each merge invalidates the next, forcing a rebase cascade. The 2026-05-06 schema-v2 batch hit this pattern 6 times on `displayId.ts` alone, costing the coordinator ~80k tokens fighting the same conflict. Coordinator should land all spine additions in one foreground change BEFORE workers are dispatched. Workers branch from the post-spine main HEAD and append-only against a stable base. See memory `feedback_orchestrate_spine_first.md`.
6. **Prefer module-ownership over feature-ownership.** If "patients reads" + "patients extras" + "patients writes" are all in the same wave, collapse them into ONE worker that owns the whole module across phases. Same-module overlap on `routes.ts` / `db.ts` / per-feature docs cascades just like spine files. One module-PR per worker is the right granularity; splitting into feature-PRs wastes prefix tokens and creates rebase cascades. See memory `feedback_orchestrate_module_ownership.md`.
7. **Minimum-scope: combine tiny adjacent units.** If two units are each <150 LoC expected AND share a parent directory (or are both docs-only / test-only), combine into ONE worker. Worker boot cost is ~6-8k tokens of fixed overhead per dispatch — splitting tiny adjacent units only multiplies it. Example anti-pattern from 2026-05-06: `admin/attendance` + `admin/approvals` should have been one worker, not two. See memory `feedback_orchestrate_min_scope.md`.

## Worker prompt template — required sections

Every worker prompt must include:

1. **Goal** — one sentence on the overall change and why.
2. **This unit's task** — title, file list, exact change, copied verbatim from the plan file.
3. **What you do NOT touch** — explicit list of sibling units' files, to defuse landmines.
4. **Conventions** — link to `.claude/rules/gotchas.md`, `patterns.md`, plus inline reminders for the high-traffic gotchas (inline Zod in backend, `idSchema` for params, audit-trigger tenant GUC, CSRF header, numeric→string, JSONB stringify, text PKs via displayId helpers).
5. **E2E verification recipe:** exact commands. Include `pnpm run setup`, `pnpm dev`, login curl, the specific endpoint smoke, `pnpm --filter typecheck`, lint, format.
6. **Spec deviation rule (REQUIRED)** — verbatim:

   > If you discover the spec cannot be implemented as written (constraint conflict, missing schema column, broken assumption), **stop and report at the TOP of your final message**, before the PR-summary bullets. Do not bury the deviation in a paragraph the coordinator will skim past. Format:
   >
   > `DEVIATION: <one-line summary>. Plan said <X>; I did <Y> because <Z>.`
   >
   > The coordinator may need to update other units, the schema, or the merge plan. A buried deviation is the same as a silent deviation. (See memory `feedback_verify_worker_reports.md`.)

7. **Doc-surface self-check (REQUIRED)** — before `gh pr create`, workers must run:

   ```bash
   scripts/check-doc-surface.sh
   ```

   If the script reports stale surfaces inside this unit's file list, the worker updates those docs in the same PR. If reported surfaces are outside the unit's scope, the worker leaves them alone and notes them under a `DOC-DRIFT:` line so the coordinator can route the work.

   Rationale: `/orchestrate` workers bypass `/ship`, so the Layer 3 doc check in `.claude/skills/ship/SKILL.md` never fires. Without this self-check, doc drift accumulates one PR at a time.

8. **Worker tail** — simplify → tests → e2e → doc-surface check → **`pnpm prettier --write . && pnpm lint:fix`** → commit → push → `gh pr create` → `PR: <url>` line. If a `DOC-DRIFT:` line is included, place it directly above `PR: <url>` so the coordinator's render picks it up.

   The format-write step is **mandatory**. The 2026-05-05 schema-v2 batch had ~10/18 workers' PRs fail CI on `prettier --check` because the worker ran typecheck/build but never `prettier --write`. The PR-format gate hook (`.claude/hooks/pr-format-gate.sh`) fires on `gh pr create` and rejects if `prettier --check .` or `pnpm lint` fails — workers that skip step 4 will hit it. See memory `feedback_orchestrate_fmt_prereq.md`.

## Push-ref rename gotcha

When a worker pushes its branch, the remote ref name is rewritten from `worktree-agent-<id>` to `claude/agent-<id>`. After a rebase, push to the actual `headRefName` from `gh pr view`, not the local branch name. Full details in `.claude/rules/worktree.md`.

## Coordinator: render worker reports

When parsing each completed worker's report, scan for two leading markers:

| Marker         | Where it goes                            | Example                                                                                 |
| -------------- | ---------------------------------------- | --------------------------------------------------------------------------------------- |
| `DEVIATION: …` | ⚠️ next to the unit row                  | spec said "negative payment row"; CHECK constraint forced status-transition model       |
| `DOC-DRIFT: …` | 📝 next to the unit row, separate column | reported by `check-doc-surface.sh` but outside this unit's scope — needs a follow-up PR |

If a worker reports `DOC-DRIFT:`, spawn a small follow-up task (or flag inline at end of summary) so it doesn't slip past the merge step.

## Merge order

When sibling units must merge in a specific order (read-side fix before write-side, schema before consumers, etc.), state it in the plan and at the top of the user-facing summary. Don't leave it implicit.
