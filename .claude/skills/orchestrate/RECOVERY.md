# Recovery Procedures

Used by Phase 2 §2c when a worker fails or stalls.

## Decision table

| State on remote                                 | Strategy                                            |
| ----------------------------------------------- | --------------------------------------------------- |
| No branch, no commit                            | Respawn fresh worker (§A1)                          |
| Branch at coordinator HEAD, 0 commits ahead     | Stalled after bootstrap push → wait 2 min, then §A1 |
| Branch with commits, CI failed                  | Inline fix (§B)                                     |
| Uncommitted changes leaked into coordinator CWD | Inline recovery (§A2)                               |

## Silent-failure detection

A worker silently failed when ALL of:

1. Final message lacks a `PR:` line (or ends with an imperative verb like "Let me edit", "I'll fix" — cut off mid-action)
2. `git ls-remote origin <branch>` returns no rows
3. `git worktree list` shows no `agent-<id>` worktree with commits ahead of coordinator HEAD

If only (1) is true but branch + commits exist on remote, the worker did the
work but botched the final message — treat as success, verify per §2b-ii.

---

## §A1. Respawn fresh worker (default for no-commit failures)

Spawn a new background worker with the original prompt plus this header:

```
PRIOR ATTEMPT STALLED — retry with the same scope.

The previous attempt at unit <N> ("<title>") returned:
  "<one-line snippet from the failed agent's last message>"
without pushing any commits. Branch <branch-name> does not exist on remote.

Clean restart — branch from <coordinator HEAD SHA>:
  git fetch origin
  git checkout -b <branch-name> <coordinator HEAD SHA>

<paste original unit prompt verbatim from "## Goal" onward>
```

Track as **attempt 2/2** — only one respawn per unit. If the respawn also
fails, fall back to §A2. Do not respawn a third time.

**When to respawn vs. inline-recover:** respawn when the prompt was solid and
the failure looks like model misbehaviour (cut-off mid-tool-call, hook error).
Inline-recover when the prompt had a defect that likely caused the stall.

---

## §A2. Inline recovery (after respawn fails, or worktree leaked)

**Leaked worktree case** — `git status` shows uncommitted files on a stray
`claude/orch-*` branch in your CWD. The worker made changes but didn't commit:

```bash
git branch --show-current   # confirm stray branch
git diff --stat             # inspect partial work
$PNPM --filter @surevax/backend typecheck
$PNPM --filter @surevax/frontend build
pnpm prettier --write .
pnpm lint:fix
git add <files>
git commit -m "<conventional commit>"
git push -u origin "$(git branch --show-current)"
gh pr create --base main --fill
```

**Respawn-already-tried case** — implement inline on a fresh branch:

```
1. git fetch origin
2. git checkout -b <branch-name>-recovery <coordinator HEAD SHA>
3. Implement what isn't already on main (read original unit prompt section by section)
4. Standard tail: simplify → typecheck → format → commit → push → PR
```

---

## §B. CI failure — branch exists, PR open, CI red

```bash
# 1. Diagnose
gh pr checks <NUM> --json name,status,conclusion,detailsUrl \
  --jq '.[] | select(.conclusion=="FAILURE")'

# 2. Disarm auto-merge before touching the branch
gh api repos/{owner}/{repo}/pulls/<NUM> --jq '.auto_merge'  # check first
gh pr merge <NUM> --disable-auto                             # if armed

# 3. Fix, typecheck, then push
$PNPM --filter @surevax/backend typecheck
$PNPM --filter @surevax/frontend build
HEAD_REF=$(gh pr view <NUM> --json headRefName -q .headRefName)
HEAD_OID=$(gh pr view <NUM> --json headRefOid    -q .headRefOid)
git push --force-with-lease="${HEAD_REF}:${HEAD_OID}" origin HEAD:"$HEAD_REF"

# 4. Re-arm
gh pr merge <NUM> --auto --merge
```

Re-run §2b-ii after pushing. After 2 retries still failing → mark BLOCKED,
ask the user. Do not loop.

---

## Sibling-commit leak resolution

If `git log origin/<branch> ^origin/main` shows commits from a different
worker's prompt:

1. **Sibling already merged via this PR's squash** → close this PR with a
   comment, don't merge twice.
2. **Sibling still in flight** → wait; if this PR merges first, close the
   sibling as redundant.
3. **Sibling failed, this PR is the canonical path** → keep this PR, close
   the sibling.

Never merge two PRs containing the same commits.
