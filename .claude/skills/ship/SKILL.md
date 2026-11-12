---
name: ship
description: Commits any remaining session changes, updates docs if needed, pushes the worktree branch, opens a PR, and enables auto-merge so GitHub fast-forwards to main once CI passes. Use this skill whenever the user says "ship", "ship it", "land this", "merge everything", "push and merge", or wants to wrap up a session's work and get it onto main. Also trigger when the user types /ship.
---

# Ship

One-command workflow to land the current worktree session's work onto
`main` **through a PR** so that `.github/workflows/ci.yml` gets a chance
to run before the merge. Handles commit, push, PR open, auto-merge
enable, and the index.lock race.

Solo workflow: we enable GitHub's auto-merge on the PR and exit. GitHub
fast-forwards to `main` once CI turns green. We do **not** block the
session waiting on CI — the user can pick up other work and glance at
the PR later.

Commit conventions live in [`.claude/rules/commits.md`](../../rules/commits.md)
— this skill enforces them but doesn't duplicate them.

## Prerequisites

- `gh` CLI authenticated (`gh auth status` should show a valid account).
  If `gh` is missing or unauthenticated, stop and tell the user —
  don't silently fall back to a direct merge that bypasses CI.

## Steps

### 0. Pre-flight

Run before touching git or opening a PR.

```bash
# 1. Refuse to ship directly from main
BRANCH=$(git branch --show-current)
if [ "$BRANCH" = "main" ]; then
  echo "ERROR: on main — create a worktree branch first"; exit 1
fi

# 2. Typecheck + build (catches stale column/endpoint references before push)
PNPM=$(command -v pnpm || echo /opt/homebrew/bin/pnpm)
$PNPM --filter @surevax/backend typecheck
$PNPM --filter @surevax/frontend build
```

**If either check fails, fix it before continuing.** Don't push broken code and rely on CI to catch it — CI failures on an already-auto-merge-armed PR require a disarm/fix/re-arm cycle that wastes tokens.

```bash
# 3. If a PR already exists for this branch, capture its auto-merge state
AUTO_MERGE=$(gh pr view --json autoMergeRequest --jq '.autoMergeRequest' 2>/dev/null || echo "null")
```

If `AUTO_MERGE` is not `null`, auto-merge is already armed. Any force-push (e.g. to amend a commit) must follow the disarm → push → re-arm sequence:

```bash
PR_NUM=$(gh pr view --json number --jq .number)
gh pr merge "$PR_NUM" --disable-auto   # disarm
# ... push ...
gh pr merge "$PR_NUM" --auto --merge   # re-arm after push
```

If no PR exists yet, `AUTO_MERGE` stays `null` and no guard is needed.

### 1. Assess what changed

```bash
git status
git diff --cached && git diff
git log --oneline main..HEAD
```

- If there are **no** uncommitted changes AND **no** unmerged commits,
  tell the user there's nothing to ship and stop.
- If there are uncommitted changes spanning multiple clearly-independent
  logical units (e.g. an API change + an unrelated UI change + a docs
  change for a third feature), warn the user that this violates the
  granularity rule in `.claude/rules/commits.md` and ask whether to:
  (a) proceed with one combined commit anyway, or (b) abort so they can
  split it. Default to (a) if they already typed `/ship`.

### 2. Check if docs need updating

Run the doc-surface check. It maps changed code paths to the doc files
that should track them and reports stale surfaces:

```bash
scripts/check-doc-surface.sh
```

- **Empty output** → skip to step 3.
- **Non-empty output** → each line is `<surface>\t<doc-path>\t<example file>`.
  Present the list to the user with `AskUserQuestion` and three
  options:
  1. **Update docs now (Recommended)** — write the doc deltas inline
     before continuing. Edit only the files the script flagged. For
     each, update the relevant table row / bullet / status. Match the
     existing style of the file (don't restructure).
  2. **Skip and ship** — the change is genuinely internal (refactor,
     test, comment-only). Continue to step 3.
  3. **Cancel** — abort `/ship` so the user can do something else.

  Default to (1) when the user already typed `/ship` without
  qualifying it, but always respect their explicit choice.

The script is deliberately heuristic. False positives are cheap to
"skip past"; the cost of a false negative (drift) is much higher,
which is why we err on the side of flagging.

Other docs the script does **not** cover but you should still touch
when relevant (use judgment — don't prompt the user for these unless
the diff obviously warrants it):

- **CLAUDE.md** — stack choices, rules, conventions, monorepo layout
- **README.md** — current status line + the "Last updated" footer
- **TODO.md** — tasks completed or invalidated
- **.claude/rules/** — new gotchas, patterns, or commit conventions
  discovered during the session

Update the "Updated" date in doc headers if present. Skip this step
entirely when no doc updates are needed.

### 3. Commit

If there are uncommitted changes:

1. Stage specific files (`git add <file> <file>`) — **never** `git add -A`
   or `git add .` (catches secrets, binaries, WIP).
2. Write a Conventional Commit message per
   [`.claude/rules/commits.md`](../../rules/commits.md). Match style by
   inspecting `git log --oneline -5`. No AI attribution: no co-author
   trailer, no "Generated with Claude" footer.
3. If `git commit` fails with "index.lock: File exists":

```bash
LOCK_PATH="$(git rev-parse --git-dir)/index.lock"
touch "$LOCK_PATH"
rm    "$LOCK_PATH"
# immediately retry the commit
```

If commits already exist on the branch and there's nothing uncommitted,
skip to step 4.

### 4. Push the worktree branch

```bash
BRANCH=$(git branch --show-current)
git push -u origin "$BRANCH"
```

`-u` is safe on repeat pushes (sets upstream on first push, no-op after).

### 5. Open (or reuse) a PR

Check whether a PR already exists for this branch:

```bash
gh pr view --json number,url,state --jq '.'
```

- If no PR exists, create one with `--fill`, which reuses the commit
  subject as the PR title and the commit body as the PR body:

```bash
gh pr create --base main --head "$BRANCH" --fill
```

**Do not** write a bespoke PR title or body. The session's commit
messages are the source of truth; duplicating them into a PR
description wastes tokens and drifts. If the commit messages are
good (they should be, per `.claude/rules/commits.md`), `--fill` is
sufficient.

Exception: only write a custom body if the user explicitly asks for
one, or the change spans multiple commits with no single commit that
summarizes the whole thing — in that case a short 2–3 bullet body is
fine.

- If a PR exists but is closed/merged already, stop — something's off,
  tell the user.
- If a PR exists and is open, reuse it. The push from step 4 already
  updated its head.

Report the PR URL to the user **before** enabling auto-merge.

### 6. Enable auto-merge

The repo has "Allow auto-merge" enabled in Settings → General. GitHub
will fast-forward the PR onto `main` as soon as required checks pass.

```bash
gh pr merge "$PR_NUMBER" --auto --merge
```

- `--merge` preserves the branch's commits on `main` as-is (matches
  the ff-only history we kept before). Do **not** use `--squash` or
  `--rebase` without the user's explicit ask — they change history.
- If the PR has **zero** required checks and is already mergeable,
  `--auto` will merge immediately. That's fine.
- If `gh pr merge --auto` errors with "auto-merge not enabled for this
  repository", stop and tell the user to enable it (Settings → General
  → Pull Requests → Allow auto-merge). Do **not** fall back to a
  direct merge — that bypasses CI.
- If the PR is not mergeable (e.g. conflicts with `main`), stop. Tell
  the user to rebase the worktree branch onto `origin/main` and re-run
  `/ship`.

Do **not** wait for CI or manually merge. The whole point of this step
is to exit the session cleanly and let GitHub handle the merge.

### 7. Report

Give the user:

- The commit hash(es) pushed
- The PR URL with a note that auto-merge is enabled
- The list of checks that will run (from `gh pr checks` without
  `--watch`) so they know what needs to turn green
- Any docs that were updated
- Any follow-ups (e.g. "main worktree had unstaged changes — left alone")

Keep it to a short paragraph or bulleted list. Do **not** promise the
merge has landed — only that auto-merge is queued.

## Important constraints

- **PR is mandatory.** The whole point of this flow is to let CI run.
  Bypassing the PR defeats the gate.
- **Auto-merge, not manual merge.** Don't ff-merge from the main
  worktree anymore — GitHub handles it. Manual merge while `--auto`
  is queued is fine but redundant, and it's easy to accidentally merge
  before CI finishes.
- **Never force-push.** If push fails, diagnose and tell the user.
- **Never use `git add -A` or `git add .`.**
- **Don't create empty commits.** If there's nothing to commit, push
  and PR the existing commits.
- **Handle the index.lock race** via touch-then-rm (see
  `.claude/rules/worktree.md`).
