---
name: orchestrate
description: Parallel work orchestration with safety guardrails — reserves migration filenames and branch names upfront, spawns Task subagents branching from coordinator HEAD, verifies each PR and CI post-completion (retries inline up to 2×), blocks force-pushes to auto-merge-armed PRs, and outputs a structured final report. Use when the user invokes /orchestrate with a list of independent work units.
trigger: /orchestrate
---

# /orchestrate

> **Status: LEGACY — prefer `/orchestrate-pilot` for new waves.** The pilot
> workflow's deterministic JS fan-out eliminates this protocol's documented
> ~50% silent-worker-failure mode, schema-forces every worker return, and
> lands one consolidated PR instead of a per-unit PR + auto-merge + rebase
> cascade (see `pilot-integration` for invocation + patch recovery). Use this
> prose protocol only when you genuinely need **per-unit PRs** (units must
> land independently / be individually revertable) or workers that must run
> their own CI before merge. The pre-flight discipline below (Phase 0:
> grep-verify gaps, spine-first, module ownership, inline-vs-worker gate)
> still applies to pilot waves — it's the dispatch/PR machinery that's
> superseded.

Parallel work orchestration with mandatory verification. Supersedes ad-hoc
parallel `Agent` usage when you need the full safety net: pre-allocated names,
per-worker CI checks, auto-merge guard, and a final status table.

> For parallel review-and-fix on existing open PRs, use [`/pr-review`](../pr-review/SKILL.md).
> The two skills share dispatch/verification machinery but specialize on
> opposite ends of the SDLC.

## When to use vs. push back

Push back when:

- Any unit's expected diff is **< 100 LoC** of mechanical change — inline beats
  parallel ~10× for small work.
- The unit is an "audit and fix where needed" task expressible as a 1-line
  shell command — coordinator does it directly.
- Multiple units write to the **same insertion point** in any file.
- Work is sequential by nature (migrations that depend on each other, CI/format
  setup).
- A DB-level invariant change in one unit would break siblings' e2e.

When unsure, state the decomposition, list file overlaps, and ask for
confirmation.

## Wave-size budget

Three hard caps per dispatch wave:

1. **Max 4 workers per wave.** Research and session history converge on 3–4
   as the practical sweet spot; coordination overhead scales faster than
   parallelism gains beyond that. Exception: 5–6 requires explicit user
   confirmation and a written justification in the manifest.
2. **Max 3 spine-touching units per wave.** A spine-touching unit appends to
   a shared file: `displayId.ts` (prefix unions), `migrate.ts`
   (`SUPPLEMENTAL_SQL_FILES`), `docs/ai-context/02-BACKEND-API.md` (route
   table), `apps/backend/src/index.ts` (worker boot wiring). With 4+
   spine-touchers the 4th merge always conflicts with the first three.
3. **Max 4 findings per unit (the ~90k stall ceiling).** Background Sonnet
   workers are reliably terminated at **~80–95k tokens / ~50–70 tool uses**
   mid-task, often without committing. Measured across the 2026-05-27/28
   audit-remediation run: units with 6+ findings stalled ~50% of the time
   (auth, orders, dose-calc-UI v1); units with ≤4 findings + light
   verification stalled ~10%. Scope each unit to fit comfortably under
   the cliff; if a module needs more, split into 2 units.

If the work decomposes into >4 units or >3 spine-touchers, split into
sequential waves. Land wave N + auto-merge before dispatching wave N+1.

---

## Phase 0 — Pre-flight manifest

### 0a. Verify current state first

Before committing any unit to the manifest, grep to confirm the gap is real:

```bash
# Feature claimed as missing
grep -rn "useFeatureX\|<FeatureXButton" apps/frontend/src --include="*.tsx" | head -5
# Field claimed as free-text input
grep -B2 -A5 'name="patientId"\|placeholder=.PAT-' apps/frontend/src/features/<feature>/ | head -20
# Trigger claimed as missing
grep -B1 -A3 "CREATE TRIGGER.*<table>" apps/backend/drizzle/*.sql | head
```

Drop any unit where the claimed gap is already shipped. 5 min of grep here
saves ~107k tokens of wasted worker cycle.

### 0b. Reserve names

Check current migration max:

```bash
ls apps/backend/src/shared/db/migrations/*.sql 2>/dev/null | grep -oE '[0-9]{4}' | sort -n | tail -1
```

Assign `NNNN_<slug>.sql` sequentially per unit. Branch names:
`claude/orch-<slug>-<wave>-<nonce>` (include wave + 4-char nonce to survive
worktree reuse).

### 0c. Record the manifest

```
ORCHESTRATE MANIFEST
=====================
coordinator HEAD: <git rev-parse HEAD output>

Unit N: <title>
  branch:       claude/orch-<slug>-<wave>-<nonce>
  migration:    NNNN_<slug>.sql  (or "none")
  supplemental: NNNN_<slug>.sql  (or "none")
  depends_on:   none  (or "Unit N — <reason this must land first>")
  files:        <owned files>

ESTIMATED COST
==============
Workers: <N> × ~85k avg = ~<N×85>k tokens   (per-worker cliff ~90k — see Wave-size budget #3)
Expected LoC: ~<est> | Tok/LoC: ~<calc>  (threshold: 700 — above that, inline wins; 2026-05-28 audit mean was 742)
```

Units with `depends_on` are deferred to a second wave — never dispatch a
dependent unit in the same wave as its prerequisite.

### 0d. Resolve file overlaps

If two units own the same file: assign full ownership to one, or document the
exact line ranges each may touch. Do not proceed with unresolved overlaps.

### 0e. Spine-first — land shared files before dispatch

If 2+ units would touch the same spine file, commit all additions in one
foreground change, push + merge to main, then branch workers from the new
HEAD. Skipping this on a 4-unit batch costs ~80k coordinator tokens fighting
the same rebase repeatedly.

### 0f. Prefer module ownership over feature splitting

If 2+ units touch the same `routes.ts` / `db.ts`, collapse into one worker.
One module-owned PR beats three feature PRs each rebasing on the others.

### 0g. Combine tiny adjacent units

If two units are both <150 LoC and share a parent directory, combine into one
worker. Per-worker boot cost is ~6–8k tokens regardless of unit size.

### 0h. Inline-vs-worker declaration (REQUIRED before any Agent call)

Answer all four questions in chat before spawning. A "yes" to any of the first
three gates the unit to inline:

| Question                                                   | Gate                                  |
| ---------------------------------------------------------- | ------------------------------------- |
| Is the expected diff < 100 LoC of mechanical change?       | **yes → inline**                      |
| Does the change touch ≤ 2 file paths total?                | **yes → inline**                      |
| Is this tooling / CI / format / sequential-migration work? | **yes → inline**                      |
| Does the worker need schema columns from `schema.ts`?      | **yes → pre-extract before dispatch** |

Declare the answers as a brief checklist comment before the `Agent` call, e.g.:

```
// 0h: >100 LoC, 8 files, not sequential, schema pre-extracted below → dispatch OK
```

Anti-pattern from 2026-05-19 Wave 3: frontend worker produced 6 LoC of changes
at 133k tokens — entirely inline-eligible. The `post-agent-audit.sh` hook will
warn post-hoc, but this gate catches it before dispatch.

---

## Phase 1 — Worker dispatch

Spawn all workers in a **single** `Agent` call (parallel tool_use blocks).
Build each worker prompt from [`WORKER_TEMPLATE.md`](WORKER_TEMPLATE.md) —
substitute unit-specific values for every `<placeholder>`. Every section in
the template is required.

### Required on every Agent call

- `isolation: "worktree"` — mandatory; without it, parallel workers clobber
  each other's branch state.
- `model: "sonnet"` — workers default to Sonnet. Escalate a specific worker to
  `model: "opus"` only for novel architecture or multi-file refactors with
  non-obvious dependencies; state the reason in the manifest.
- `run_in_background: true` — all workers in parallel.

### Schema pre-extraction (REQUIRED — #9)

Before building any worker prompt that touches a DB module, grep `schema.ts`
for the relevant table columns and paste them inline in the prompt (§5c of
WORKER_TEMPLATE). Do **not** let workers discover columns themselves.

```bash
grep -A 40 "export const <table> = " apps/backend/src/shared/db/schema.ts
```

Each saved schema lookup ≈ 5–10k tokens × N workers. The 2026-05-19 audit
found a Read:Edit ratio of 3.2:1 — most of those reads were workers searching
for columns they should have been handed.

### Hook compatibility

Agent worktrees share `.git` but not `node_modules`. Hooks resolving
`./node_modules/.bin/X` false-block pushes. `pr-format-gate.sh` walks up via
`git rev-parse --git-common-dir` and skips with a warning if no binary found.
New hooks must follow the same pattern.

### Light verification is the default — CI is the DB gate

Default the worker's verification recipe (WORKER_TEMPLATE §6) to:

```
pnpm install (or `corepack pnpm install`)
pnpm --filter @surevax/backend typecheck
pnpm --filter @surevax/frontend build
pnpm --filter @surevax/frontend test    (if the unit touches frontend)
pnpm lint
```

Do NOT have workers run `pnpm run setup` / Docker / seed / the 98-test integration
suite locally. Those exist in CI's `Migrations apply` + `Backend integration
tests` jobs and gate the merge via `--auto --squash`. The 2026-05-27/28 audit
measured ~5× reduction in worker stalls when local DB verification was dropped
(50% to 10%). `pnpm run setup` plus the test suite was burning 30-60k tokens of the
~90k worker budget on infrastructure, leaving too little for the actual code.

Only opt into full E2E (worker runs `pnpm run setup` plus curl smoke) when the unit's
DB-layer correctness genuinely cannot wait for CI (e.g. the unit IS the
migration spine, as with the W1 dbfix worker on PR #493, or it is a one-shot
correctness probe that CI doesn't cover).

### Commit-after-each-finding is mandatory

Promote WORKER_TEMPLATE §4b's "push after each logical layer" from a >200-LoC
hint to a **hard requirement for every unit**. Workers stall mid-task often;
uncommitted work in a reaped worktree is lost (CLIN-1 UI worker v1 lost ~all
work this way before commit-panel-first was added to v2's prompt). Prompts
must instruct the worker to commit + push after EACH finding/component, not
batch into one end-commit.

---

## Phase 2 — Post-completion verification

After all workers return, verify every PR. Do not merge-plan until all pass
or retries are exhausted.

### 2a. Parse worker reports

Extract from each worker: `PR:` line, `DEVIATION:` line, `BLOCKED:` line,
`DOC-DRIFT:` line.

Terse message ("Done", "Acknowledged") with no `PR:` URL = **silent failure**
→ §2c ([RECOVERY.md](RECOVERY.md)).

### 2b-i. Batch sanity

```bash
gh pr list --author @me

# Migration collision check
ls apps/backend/src/shared/db/migrations/ | sort | uniq -d

# Branch existence + commit count for each worker
for branch in <worker-branches>; do
  echo "=== $branch ==="
  git ls-remote origin "$branch"
  git log --oneline "origin/$branch" ^origin/main 2>/dev/null | wc -l
done
```

Three-state signal (enabled by the bootstrap push in WORKER_TEMPLATE §4b):

| Remote branch | Commits ahead | Meaning                                                                |
| ------------- | ------------- | ---------------------------------------------------------------------- |
| Missing       | —             | Never started → §2c-A1 (respawn)                                       |
| Exists        | 0             | Bootstrap-pushed, stalled before first commit → wait 2 min then §2c-A1 |
| Exists        | >0            | Real work on remote → §2b-ii                                           |

### 2b-ii. Per-PR verify

```bash
BRANCH=$(gh pr view <NUM> --json headRefName -q .headRefName)
git ls-remote origin "$BRANCH"
COMMITS_AHEAD=$(git log --oneline "origin/$BRANCH" ^origin/main 2>/dev/null | wc -l)
git log --oneline "origin/$BRANCH" ^origin/main
gh pr view <NUM> --json state,mergeable,statusCheckRollup \
  --jq '{state, mergeable, checks: (.statusCheckRollup // [] | map({name:.name,status:.status,conclusion:.conclusion}))}'
```

Passes when: ref on remote · `state == "OPEN"` · `mergeable == "MERGEABLE"` ·
all COMPLETED checks have `conclusion == "SUCCESS"` ·
`COMMITS_AHEAD` matches expectation.

If the branch log contains sibling-unit commits, or any step fails →
§2c ([RECOVERY.md](RECOVERY.md)).

### 2c. Recovery

See [`RECOVERY.md`](RECOVERY.md) for: respawn (§A1), inline recovery (§A2),
CI-fix (§B), and sibling-commit-leak resolution.

### 2d. Auto-merge guard — before ANY force-push

```bash
gh api repos/{owner}/{repo}/pulls/<NUM> --jq '.auto_merge'
```

If non-null: `gh pr merge <NUM> --disable-auto` → push fix →
`gh pr merge <NUM> --auto --merge`. Never force-push while auto-merge is armed.

---

## Phase 3 — Merge plan

1. State merge order for dependent units (schema → consumers, read-fix →
   write-fix). Independent units can merge in any order.
2. **Arm auto-merge on every green PR immediately** — don't batch:
   ```bash
   gh pr merge <NUM> --auto --squash
   ```
3. Report blocked units separately; ask the user (manual fix, abandon, or fold
   into another unit).

### Drive the BEHIND → update loop

`--auto --squash` arms but does not auto-update branches. Drive the loop until
all PRs land:

```bash
for n in <pr-numbers>; do
  state=$(gh pr view "$n" --json state,mergeStateStatus \
            --jq '.state + " " + (.mergeStateStatus // "")')
  case "$state" in
    "OPEN BEHIND") gh pr update-branch "$n" 2>&1 ;;
    "MERGED "*)    : ;;
    *)             : ;;
  esac
done
```

If `gh pr update-branch` returns a conflict error, run the inline rebase from
RECOVERY.md §A2 (disarm → rebase → resolve → force-push → re-arm).

### Cross-cutting hotfix

If a merged PR breaks several still-open PRs' CI: diagnose from one failure
log, push a hotfix PR, then run a single batched rebase loop across all blocked
PRs once the fix lands.

### Coordinator checkpoint commits (#8)

After every wave fully merges to main, create a no-op commit on the coordinator
branch summarising the wave:

```bash
git commit --allow-empty -m "chore: wave <N> complete — <K> units, <M> silent stalls"
```

This creates labelled anchor commits that `scripts/orch-audit.sh` can slice on,
and gives recovery points if a later wave goes sideways. It also surfaces
silent-stall counts explicitly in the git log for post-session review.

---

## Phase 4 — Final report

```markdown
## Orchestrate — Final Report

Base HEAD: <SHA> Units: <N> dispatched / <N> passed / <N> blocked

| #   | Title   | Branch     | PR         | CI         | Merge                | Notes          |
| --- | ------- | ---------- | ---------- | ---------- | -------------------- | -------------- |
| 1   | <title> | `<branch>` | [#NN](url) | ✅ green   | ⏳ auto-merge queued |                |
| 2   | <title> | `<branch>` | [#NN](url) | 🔄 pending | ⏳ auto-merge queued |                |
| 3   | <title> | `<branch>` | [#NN](url) | ❌ failed  | 🚫 blocked           | DEVIATION: ... |

### Deviations

<one per worker>

### Doc drift (needs follow-up PR)

<one per worker>

### Blocked units — action required

<detail + what the user needs to decide>
```

CI: ✅ green / 🔄 pending / ❌ failed / — not started
Merge: ⏳ auto-merge queued / ✅ merged / 🚫 blocked / — skipped

---

## Phase 5 — Teardown (don't skip)

Worker worktrees + per-unit branches are NOT self-cleaning, and squash-merge
leaves the remote head branch behind. Skipping teardown is how the repo
accreted 80 worktrees / 345 local / 57 remote branches (2026-05-31 cleanup).
That pile also feeds the port-collision bug in `setup-worktree.sh` (it scans
every sibling `.env` for a claimed port).

Once all units are merged (or blocked ones triaged), run the teardown — it is
safe-by-default (dry run) and never auto-deletes unmerged remote work:

```bash
pnpm prune:worktrees            # dry run — review what it would remove
pnpm prune:worktrees --apply    # remove stale worktrees + merged/stale branches
```

It removes worktrees with no file activity in the last 5 days, deletes local
branches that are merged-into-`main` or stale, and deletes **only merged**
remote branches. `main`, the current worktree/branch, and any checked-out or
recently-active branch are always preserved. Unmerged remote branches are
reported, never deleted — triage those by hand.

---

## Constraints

- **`isolation: "worktree"` on every Agent call.** Omitting it = workers clobber each other's branch state AND the coordinator worktree, racing branch checkouts (lost a full Wave 1 once). Inspect `git log origin/<branch> --oneline -10` post-completion — worktrees occasionally pick up sibling commits. Close duplicate PRs; let the canonical one merge.
- **Branch-name collision watch.** Never reuse a branch-name stem the coordinator (or a prior inline fix) already used. A worker's push can land on the same ref → `gh pr create` opens a PR with the worker's diff but **GitHub may carry over a confusingly stale title** (#497 was mis-titled "fix(auth)" with cash content). At verification, **always query `gh pr view <NUM> --json headRefName`** rather than trusting the prompt's prescribed branch name, and grep `gh pr view <NUM> --json files` to confirm the diff matches the unit's scope.
- **Verify independently.** Never trust a worker's self-reported "done" — always run §2b-i + §2b-ii. A "completed" notification with a final-message snippet that cuts off mid-sentence is a stall, not a success.
- **Auto-merge guard is non-negotiable.** Disarm → push → re-arm (§2d). Normal (non-force) push to an armed PR is OK — it just updates the branch and CI re-runs; only **force-push** requires disarm-first.
- **Drive the BEHIND loop** — GitHub doesn't auto-update branches (§3).
- **Hooks must be agent-worktree-aware** — no `node_modules` in worker worktrees; walk up via `git rev-parse --git-common-dir`.
- **Parallelization in worker prompts: include a concrete example.** The abstract "batch independent tool calls" instruction has yielded **0% parallelization across 18 workers in the 2026-05-28 audit** (and 0% across 21 workers in 2026-05-19). Worker prompts must show the exact batch (e.g. "in ONE response: `git status` + `git diff --stat` + `gh pr view <num> --json state,mergeStateStatus`") rather than only state the rule.
