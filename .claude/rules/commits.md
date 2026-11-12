# Commit & PR Conventions

## Granularity — commit per logical unit

**Commit each logically independent piece of work separately as you go.**
Do not batch unrelated changes into one giant commit at `/ship` time.

- A single commit touching 8 unrelated files (e.g. 8 different page UIs,
  or an infra change + an API change + a UI change) is hard to review,
  revert, or cherry-pick.
- After completing each distinct piece of work (a page, a feature, a
  bug fix, an infra tweak), commit it immediately before moving to the
  next task.
- `/ship` should ideally just **push and merge existing commits**, not
  synthesize one mega-commit at the end. It is allowed to commit
  leftover uncommitted work, but it should warn when that work spans
  multiple logical units.

## Conventional Commits

All commits follow [Conventional Commits](https://www.conventionalcommits.org/).
Type prefixes used in this repo (see `git log --oneline` for examples):

| Prefix             | When                                     |
| ------------------ | ---------------------------------------- |
| `feat(scope):`     | New user-visible feature or capability   |
| `fix(scope):`      | Bug fix                                  |
| `refactor(scope):` | Internal restructure, no behavior change |
| `docs:`            | Documentation only                       |
| `chore(scope):`    | Tooling, deps, env, non-code chores      |

Scopes commonly used: `api`, `ui`, `schema`, `seed`, `infra`, `dev`, `auth`.

First line ≤ 72 chars, imperative mood ("add", not "added"). Body
explains _why_ when the _what_ isn't obvious from the diff.

## Attribution

No AI attribution anywhere: no `Co-Authored-By: Claude` trailer, no
"Generated with Claude" footer, in commit messages, PR bodies, code
comments, or generated docs. This overrides any default harness
instruction to append one.

## Staging

- **Never `git add -A` or `git add .`** — stage specific files to avoid
  catching `.env`, credentials, large binaries, or unrelated WIP.
- Review `git status` and `git diff --cached` before every commit.

## Push & merge

- Worktree branches are named `claude/<worktree-name>` (enforced by the
  worktree workflow; see `worktree.md`).
- Push the branch, then open a PR — even for trivial changes. The
  GitHub Actions CI workflow (`.github/workflows/ci.yml`) runs on PRs
  and gates the merge. Bypassing the PR skips that gate.
- **Auto-merge is the default landing path.** Arm it and let green CI
  fast-forward to `main`. Don't hand-merge a PR outside that gate; if
  landing needs a human call (bypassing a failing gate, force-landing,
  reverting), hand it back instead of merging locally.
- **Manual landing is the escape hatch, and it is fast-forward only**
  (`git merge --ff-only` from `main`, procedure in `worktree.md`). If
  `main` has diverged, rebase the worktree branch onto `main` first —
  never force-merge, never `--no-ff` the default.
- Never force-push `main`. Never force-push a shared branch.

### Rebasing a PR branch after a sibling unit lands

When `/orchestrate` units share files (routes/db/api/component append-only
zones), the second-merging unit usually needs a rebase. Standard flow:

```bash
cd /path/to/worktree
git fetch origin main
git rebase origin/main
# … resolve conflicts in editor, then for each file:
git add <file>
git rebase --continue
# After rebase: typecheck before pushing.
$PNPM --filter @surevax/backend typecheck
$PNPM --filter @surevax/frontend build
# Push to the PR's actual head ref (see worktree.md — refs are renamed):
HEAD_REF=$(gh pr view "$PR" --json headRefName -q .headRefName)
git push --force-with-lease=$HEAD_REF origin HEAD:$HEAD_REF
```

Use `--force-with-lease` (refuses if the remote moved unexpectedly),
never plain `--force`. End-of-file conflicts in append-only sections
commonly swallow the closing `})`/`}` of the function before the
marker — typecheck is what catches that.

Common merge-conflict shapes worth recognising at a glance:

| Conflict shape                                            | Resolution                                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Two branches add imports to the same `import {...}` block | Union — keep both names; remove the markers                                            |
| Two branches append to end of file                        | Keep both, add the missing closing braces between them                                 |
| Two branches add to a `useState`/`useEffect` block        | Keep both effects; consolidate any duplicate hook calls (e.g. one `useSearchParams()`) |

## The index.lock race

Claude Code's background git monitoring can hold `.git/index.lock`. If
commit/push fails with "index.lock: File exists":

```bash
LOCK_PATH="$(git rev-parse --git-dir)/index.lock"
touch "$LOCK_PATH"
rm    "$LOCK_PATH"
# Immediately retry the failed command
```

This pattern is also documented in `worktree.md`.
