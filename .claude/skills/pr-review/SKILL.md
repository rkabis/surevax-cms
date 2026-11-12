---
name: pr-review
description: Parallel review-and-fix orchestration for one or more open PRs. Workers check out each PR, audit against repo conventions (gotchas + patterns), classify findings BLOCKER vs NIT, fix BLOCKERs in-place on the PR's own branch with auto-merge guard, verify doc parity, and post a `--comment` review (never --approve / --request-changes). Use when the user asks for "code review on the open PRs", "review-and-fix the PR queue", or invokes `/pr-review`.
trigger: /pr-review
---

# /pr-review

Parallel "review and fix" orchestration for open PRs. Each worker owns
one PR, reviews against `.claude/rules/gotchas.md` + `patterns.md`,
fixes every BLOCKER in-place on the PR's own branch, verifies doc
parity, and posts a `--comment` review summarizing findings + fixes.

> **What this skill is NOT.** It does not implement features. For
> parallel implementation work, use `/orchestrate`. The two skills
> share dispatch/verification machinery but specialize on opposite
> ends: `/orchestrate` creates new branches from coordinator HEAD;
> `/pr-review` operates on existing PR branches.

## When to use vs. push back

Use `/pr-review` when:

- ≥ 2 open PRs need review.
- The PRs are independent (different branches, no merge-order dependency).
- The user wants comments + fixes, not just comments.

Push back when:

- Only one PR is open — do it inline; the worker overhead isn't worth it.
- The PRs share a branch (stacked PRs) — fixes on one rebase the others; do them sequentially.
- The user wants approve/request-changes stamping — escalate back to
  the user; this skill never `--approve`s. (See memory:
  `feedback_review_means_review_and_fix.md`.)

## Authority gate — never approve

`gh pr review --approve` and `--request-changes` are stamping actions.
With repo-wide auto-merge armed, an `--approve` can directly cause a
merge to `main`. "Code review" is too general to authorize that — only
explicit user direction ("approve the green ones", "stamp it") does.

**Always use `gh pr review --comment`.** Workers that emit `--approve`
in their final command will be denied by the harness anyway; bake the
constraint into every worker prompt.

## Phase 0 — Triage

Enumerate the open PRs the user wants reviewed:

```bash
gh pr list --state open --json number,title,isDraft,headRefName,additions,deletions,changedFiles \
  --limit 50 \
  --jq '.[] | select(.isDraft == false) | "\(.number)\t+\(.additions)/-\(.deletions) (\(.changedFiles)f)\t\(.title)"'
```

For each PR, decide:

1. **Inline-only** — diff < 50 LoC AND only stylistic concerns. Skip the
   worker; the coordinator reviews + comments inline. Per-worker boot
   cost (~50–80k tokens) outweighs the value for tiny PRs. Document
   the call: "PR #X: 30 LoC, no security/schema surface — inline."
2. **Combine into one worker** — two adjacent tiny PRs (each < 50 LoC)
   touching unrelated areas can share one worker. Don't combine PRs
   that share files.
3. **Dedicated worker** — everything else.

Wave-size cap inherited from `/orchestrate`: **max 6 workers per wave**.
Split into sequential waves if more PRs.

Model selection: default Sonnet. Escalate to Opus only for very large
multi-feature PRs (~20+ files spanning 3+ subsystems) where missing a
cross-feature contract has real cost. Memory:
`feedback_default_sonnet_escalate_opus.md`.

## Phase 1 — Worker dispatch

Spawn workers in a **single** `Agent` tool call. Every worker prompt
must include all sections below; section 5 (the invariants checklist)
is the load-bearing one — undersized invariants checklists produce
shallow reviews.

### Parallelize independent calls — non-negotiable

Audit data (2026-05-09 review batch via `/orch-audit`): every worker in
the 10-PR batch ran **0% Par%** — 100% sequential tool calls. That's the
2026-05-05 baseline reproducing exactly. Each sequential round-trip
replays the cache prefix (~6-8k tokens of CLAUDE.md + rules + tools)
once, so a worker that does 6 independent reads sequentially pays ~5×
more than the same worker batching them in one assistant turn.

**Every worker prompt MUST include this directive verbatim:**

> **Parallelize independent tool calls.** When the next 2+ tool calls
> don't depend on each other's outputs, batch them in ONE assistant
> turn (multiple `tool_use` blocks in the same response). Mandatory
> parallel cases for this skill:
>
> 1. The 3 conventions reads (CLAUDE.md + gotchas.md + patterns.md) —
>    single batched turn.
> 2. `gh pr view <N>` + `gh pr diff <N>` — independent, single batched
>    turn.
> 3. Multiple `Read` calls with offset/limit on different files in
>    the same module — batched.
> 4. Format/typecheck verification: `prettier --write` (per-file) +
>    `format:check` + `typecheck` + `frontend build` — when all four
>    apply, one assistant turn with four `Bash` blocks.
> 5. Final reporting: `gh pr review` + `gh pr merge --auto` (when
>    re-arming) can be in the same turn.
>
> Sequential is correct ONLY when call N's input is computed from call
> N-1's output (e.g. `git push` after `gh pr merge --disable-auto`,
> or extracting `pr_url` from a previous `gh pr view` output to feed
> into the next call).

The coordinator's Phase 2 verification step inspects each worker's
Par% via `/orch-audit`; sustained 0% across a wave is grounds for
prompt-template revision.

### 1. Goal

> Review and fix PR **#N** ("`<title>`"). Post a `--comment` review
> (NEVER `--approve` / `--request-changes`). Fix every BLOCKER inline
> on the PR's own branch with auto-merge guard.

### 2. Required reading (in order — but BATCHED in a single turn)

- `CLAUDE.md` (project root)
- `.claude/rules/gotchas.md`
- `.claude/rules/patterns.md`

These three Reads MUST be issued in one assistant turn (three `Read`
tool_use blocks in the same response), not three sequential turns. See
the parallelize directive above.

Plus per-PR-hot-zone reading. If the PR touches the schema, also read
the relevant section of `.claude/skills/gotchas/` for low-frequency
gotchas. If it touches Railway / migrations, mention `railway-ops`.

### 3. Fetch + checkout

Issue these as TWO PARALLEL `Bash` blocks in one assistant turn —
`gh pr view` and `gh pr diff` are independent metadata lookups. The
`gh pr checkout` follows in the next turn (it changes branch state,
so depending on its result for the next read is sequential by nature).

```bash
# Turn N: two Bash blocks batched in one assistant message
gh -R njvil/surevax-cms-revamp pr view <N> --json title,body,headRefName,files,changedFiles,additions,deletions,statusCheckRollup
gh -R njvil/surevax-cms-revamp pr diff <N>

# Turn N+1: checkout
cd /Users/njvil/Documents/Personal_Projects/surevax-cms-revamp/ && gh pr checkout <N>
```

(Use `gh -R <owner>/<repo>` for the metadata lookups so they don't
depend on the worktree's cwd; the checkout is the only call that
needs to be in the repo dir.)

Use `Grep` + targeted `Read` (with `offset`/`limit`) to study large
PRs. Do NOT full-Read every changed file — for a 19-file PR that's
~50KB of context the worker doesn't need.

### 4. Pre-extract field-parity table for backend modules

The dominant bug class observed in the 2026-05-09 review batch was
**schema ↔ Zod ↔ frontend drift** — fields that exist in one layer
but are dropped or misnamed in another. Typecheck passes; the feature
silently no-ops in production (4 of 10 PRs in the batch).

For any PR touching a backend module, the worker MUST build a 4-column
table before classifying findings:

| field name | DB column? | Zod schema? | Frontend type? | Notes |
| ---------- | ---------- | ----------- | -------------- | ----- |

- Source of truth: `apps/backend/src/shared/db/schema.ts` for DB columns.
- The Zod schema is in the route or service file (inline, per the
  `@surevax/shared` runtime gotcha).
- The frontend type is in `apps/frontend/src/features/<feature>/api.ts`.

Any row where one cell is missing or differs from the others is a
BLOCKER.

### 5. Repo invariants checklist

Every worker checks every applicable invariant. Mark each one
"✅ holds", "❌ violated", or "n/a" in the worker's internal scratch
before classifying findings. The list:

#### Backend

- **Tenant transaction wrap**: every read/write inside
  `db.transaction(async tx => { await tx.execute(sql\`select set_config('app.current_tenant_id', ${tenantId}, true)\`) ... })`.
  Audit trigger raises otherwise.
- **`tenantId` in WHERE clauses**: defense-in-depth on `PATCH`/`DELETE`/single-row `SELECT`.
  RLS catches some, but the explicit WHERE is the documented pattern.
  Cross-tenant mutation gap was a real bug in the batch (#236, 2026-05-09).
- **`requireRole`** on `/api/admin/*` routers (`SuperAdmin`,`BranchAdmin`).
- **Inline Zod** — no `@surevax/shared` value imports at runtime.
- **`idSchema`** for route `:id` params (NOT `z.string().uuid()`).
- **Text PKs** via `randomId` / `yearId` / `childId` / `codeId` —
  no `uuid` PKs on new tables.
- **JSONB inserts** via `JSON.stringify(value)`.
- **Schema-v2 stale references**: dropped objects (per `gotchas.md`)
  must NOT appear: `users.role`, `users.branch_id`, `inventory_transactions`,
  `consent_records`, `service_catalog.base_price`, `staff_time_logs.float_amount`/`drawer_state`,
  `clinical_orders.completed_by_id`, `patients.allergies`/`.conditions` JSONB,
  `patient_tags.tag` text, `lab_orders.result_file_url`.
- **Display ID prefix** must exist in the union types in
  `apps/backend/src/shared/utils/displayId.ts`.
- **Soft delete (`deleted_at`)** for clinical/financial records.
- **`amount_outstanding` is GENERATED** — never UPDATE directly.
- **Completed clinical_orders / Paid transactions** are DB-immutable —
  UI must not offer rejected transitions.
- **List-endpoint envelope**: backend returns a bare JSON array
  (`res.json(rows)`); frontend reads `await res.json()` directly,
  NOT `(await res.json()).data`. Mismatch silently renders empty
  (#241, 2026-05-09). Pagination metadata (if needed) goes in
  response headers, not body wrapper. See `patterns.md`.
- **Idempotency for queue consumers**: dedupe on event id before
  inserting downstream rows (#235, 2026-05-09).

#### Frontend

- **`apiFetch` from `@/lib/apiFetch`** — no local copies.
- **`X-Requested-With: fetch`** header on every state-changing fetch
  (apiFetch sends it; bare `fetch(...)` calls must too).
- **`numeric(12,2)` arrives as `string`** — frontend types declare `string`,
  not `number`. Currency display parses explicitly.
- **No `localStorage`/`sessionStorage`** for JWTs.
- **No `any`**, no `console.log` in production paths.
- **Shadcn primitives composed directly** — never wrapped (CLAUDE.md rule 8).
- **TanStack Query keys** consistently scoped (e.g. `['patients', tenantId, ...]`).
- **Money formula**: SC/PWD discount = `(base_price / 1.12) * 0.20` (VAT strip first).

### 6. Doc parity check

After classifying code findings, run:

```bash
scripts/check-doc-surface.sh
```

This emits TSV: `<surface>\t<doc-path>\t<example-changed-file>` for
every documented surface that the PR touched without updating the
matching doc. The `gh pr checkout` left the worktree on the PR's
branch, so the script's `main..HEAD` diff IS the PR diff.

Then:

1. **Surfaces flagged as stale** (script emitted) → if the PR
   added/changed a route, page, schema, middleware, infra config, or
   workflow, but didn't update the listed doc, that's a `DOC-DRIFT`
   finding. Report in the review under a "Doc parity" section. Don't
   fix the doc unless it's a one-line append (e.g. one new route in
   `02-BACKEND-API.md`'s table) — fixing docs at scale is a separate
   PR. NIT, not BLOCKER, unless the missing doc would mislead a
   future reader (e.g. new admin route not listed in the auth section).
2. **Surfaces NOT flagged but the PR touched a documented file**: the
   PR updated the doc. Verify the doc's claim matches the diff. The
   cheap version: grep the doc for the new feature's name; check the
   route path / column name / prefix matches what the code actually
   does. A doc that says "`POST /api/foo`" while the code routes
   `POST /api/bar` is worse than no doc — flag as BLOCKER.
3. **Tier-3 surfaces** (`CLAUDE.md`, `.claude/rules/*.md`): only flag
   if the PR changes a fundamental contract (e.g. adds a new tenant
   resolution path, changes the audit trigger contract, drops a
   convention). 99% of PRs don't.

If the PR is purely a refactor or fix (no surface change), the
doc-surface script will return empty — that's the expected case.

### 7. Classify findings

- **BLOCKER**: real bug, security gap, schema/Zod/frontend drift,
  invariant violation, dead code (introduced by THIS PR), broken type,
  missing tenant scope, doc that misrepresents the code.
- **NIT**: style, ordering, naming, accessibility, performance hint,
  missing UX nicety (confirmation dialogs, debounce). Goes in the
  review comment only — not fixed.

Don't expand scope. Only fix issues introduced or directly touched by
the PR's own diff. Pre-existing repo-wide drift is out of scope.

### 8. Fix BLOCKERs

Apply edits. After EVERY edit batch — and definitely BEFORE staging:

```bash
PNPM=$(command -v pnpm || echo /opt/homebrew/bin/pnpm)
$PNPM prettier --write <files-you-touched>     # auto-fix style
$PNPM format:check                              # mirror CI exactly
$PNPM --filter @surevax/backend typecheck       # if backend touched
$PNPM --filter @surevax/frontend build          # if frontend touched
```

If `format:check` fails after a localized `prettier --write`, run
`$PNPM prettier --write .` (whole repo) — there may be drift on
sibling files that the worker didn't touch but the workspace
`format:check` will trip on. Lesson from 2026-05-09: 6 of 10 PRs
needed prettier follow-ups because `typecheck` was treated as
sufficient verification — it isn't. CI runs `prettier --check` and
will fail any drift.

### 9. Commit

Conventional Commits + co-author trailer:

```bash
git add <specific files>     # never -A or .
git commit -m "$(cat <<'EOF'
fix(review): <one-line summary>

<bullet list grouped by feature if PR is multi-feature>
EOF
)"
```

(Use the worker's actual model in the trailer — e.g. `Claude Opus 4.8` for opus-escalated workers.)

### 10. Auto-merge guard before push

This is non-negotiable. A force-push to an auto-merge-armed PR can
silently drop the pushed commits during the squash. Even normal pushes
risk dropping commits if the auto-merge fires between push and
re-arm.

```bash
AUTO_MERGE=$(gh api "repos/njvil/surevax-cms-revamp/pulls/<N>" --jq '.auto_merge')
WAS_ARMED=0
if [ "$AUTO_MERGE" != "null" ]; then
  gh pr merge <N> --disable-auto
  WAS_ARMED=1
fi
git push        # not --force unless rebasing on top of new main
if [ "$WAS_ARMED" = "1" ]; then
  gh pr merge <N> --auto --squash
fi
```

If no fix → no push, no guard needed.

### 11. Post the review

```bash
gh pr review <N> --comment -b "$(cat <<'EOF'
**Code review (commented, not approving)**

## Summary
<one paragraph>

## BLOCKER findings
<list with file:line, or "None.">

## Fixed in <SHA>
<bullets, or omit section if no fixes>

## NITs (not fixed)
<list>

## Doc parity
<DOC-DRIFT findings if any, or "Doc surface unchanged.">

CI status: <quote conclusions of every check>
EOF
)"
```

### 12. Final message format

End the worker's response with EXACTLY:

```
PR #<N>: <url>
BLOCKERS: <n> | FIXED: <n> (commit: <SHA or "none">) | NITS: <n>
DOC-DRIFT: <count or "none">
SUMMARY: <one sentence>
```

If the worker hit a structural blocker that requires user input, prefix
with `DEVIATION: <issue>` and skip the fix.

## Phase 2 — Coordinator verification

After workers return, for each reported PR run:

```bash
gh pr view <N> --json state,mergeable,mergeStateStatus,statusCheckRollup,headRefOid,headRefName \
  --jq '{state, ms: .mergeStateStatus, head: .headRefOid[0:7], branch: .headRefName, checks: [.statusCheckRollup[] | (.name + ":" + (.conclusion // .status // "-"))] | join(" | ")}'
git log "origin/$(gh pr view <N> --json headRefName -q .headRefName)" --oneline -5
```

Check:

- The PR's branch tip moved to a new SHA matching the worker's reported commit.
- The latest commits' subjects match THIS unit's task (no sibling-leak from another worker's worktree — see memory `feedback_orchestrate_isolation_required.md`).
- CI is green or in-progress. If CI failed AFTER the worker's fix, the
  worker introduced a regression — coordinator fixes inline (max 2
  retries) per `/orchestrate` Phase 2 §2c.

The most common post-fix CI failure is **prettier drift on a sibling
file** that `format:check` would have caught locally. Coordinator fix
pattern (when a worker's worktree is no longer accessible):

```bash
# Use the main worktree's node_modules; create a temp worktree on the PR branch
git worktree add /tmp/pr<N>-fix <branch-name>
cd /tmp/pr<N>-fix
git fetch origin <branch-name>
git reset --hard origin/<branch-name>
/Users/njvil/Documents/Personal_Projects/surevax-cms-revamp/node_modules/.bin/prettier --write <files>
git add <files>
git commit -m "fix(review): prettier --write <files>"
# Auto-merge guard same as above
git push origin HEAD:<branch-name>
cd -
git worktree remove /tmp/pr<N>-fix
```

(The temp worktree has no `node_modules` — point at the main repo's
prettier binary directly.)

## Phase 3 — Final report

Output a Markdown table:

```markdown
## /pr-review — Final Report

PRs reviewed: <N>

| #   | PR         | Title   | Branch     | BLOCKERs | Fixed | NITs | Doc-drift | CI       | Merge       |
| --- | ---------- | ------- | ---------- | -------- | ----- | ---- | --------- | -------- | ----------- |
| 1   | [#NN](url) | <title> | `<branch>` | n        | n     | n    | n         | ✅/❌/🔄 | OPEN/MERGED |

### Highest-signal findings

<bulleted list of the cross-cutting bug classes found — security, schema drift, etc>

### Cross-cutting workflow lessons

<patterns the user might want to bake into a hook, lint rule, or PR template>

### NITs (left as comments)

<short list grouped by PR>

### Action items

<what the user needs to do next: review fix commits, arm auto-merge, etc>
```

CI legend: ✅ green / 🔄 pending / ❌ failed / — not started

---

## Important constraints

- **Never `--approve` or `--request-changes`.** Only `--comment`.
- **Auto-merge guard before every push.** No exceptions.
- **`isolation: "worktree"`** on every Agent call. Even with it,
  inspect `git log origin/<branch>` post-completion for sibling-leak
  (memory: `feedback_orchestrate_isolation_required.md`).
- **Workers default to Sonnet.** Escalate to Opus only with reason.
- **Fix scope = the PR's own diff.** Don't refactor unrelated code.
  Don't add tests unless the PR diff itself is missing a critical guard.
- **Format:check is mandatory after every fix.** Typecheck doesn't
  catch what CI's prettier check catches.
- **Field-parity table for backend modules.** Schema/Zod/frontend
  drift is the dominant bug class — eyeball the columns explicitly.
- **Doc-parity check via `scripts/check-doc-surface.sh`.** Stale
  surfaces → `DOC-DRIFT` finding. Wrong-claim docs → BLOCKER.
- **2 inline retries max** when a worker's fix breaks CI; then escalate
  to the user.
