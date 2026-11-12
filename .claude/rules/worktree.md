# Git Worktree & Tooling

## Worktree assumptions

Always assume you are in a git worktree (`claude/<name>`), not on `main`.

### index.lock race

Claude Code's background git monitoring can hold the index lock. If `git commit` fails with "index.lock: File exists":

```bash
touch /path/to/repo/.git/worktrees/<name>/index.lock
rm    /path/to/repo/.git/worktrees/<name>/index.lock
git -C /path/to/worktree commit -m "..."   # immediately after rm
```

Worktree name = branch name (e.g. `happy-hopper`).

### Landing on main

Auto-merge is the default path (see `commits.md`) — arm it and let green CI
fast-forward. The manual sequence below is the escape hatch, for when landing
needs a human call:

```bash
# From the repo root (not the worktree)
git checkout main
git merge --ff-only <worktree-branch>
git push origin main
```

### Push refs are renamed `worktree-agent-*` → `claude/agent-*`

Background subagents launched with `isolation: "worktree"` get a local
branch like `worktree-agent-<id>`. **Something on the push path
silently rewrites that ref to `claude/agent-<id>`** when it hits
GitHub — the resulting PR's `headRefName` is the renamed form, not the
local branch name. (Confirmed 2026-04-26 during the G3 transactions
batch; no local pre-push hook found, so the rewrite is happening
server-side or in the gh transport.)

Practical implication when rebasing a subagent's PR after a sibling
unit landed:

```bash
# WRONG — creates an orphan remote branch the PR doesn't track
git push --force-with-lease origin HEAD

# RIGHT — query the PR's actual head ref first, push to that
PR=59
HEAD_REF=$(gh pr view "$PR" --json headRefName -q .headRefName)
HEAD_OID=$(gh pr view "$PR" --json headRefOid    -q .headRefOid)
git push --force-with-lease="${HEAD_REF}:${HEAD_OID}" \
         origin HEAD:"$HEAD_REF"
```

Symptom you'll see if you push to the wrong ref: `gh pr view <num>`
still shows the old `headRefOid`, the PR is still `CONFLICTING`, and
the remote has a stray `worktree-agent-*` branch that nothing tracks.
Delete the orphan with `git push origin --delete worktree-agent-<id>`.

## Bootstrap a new worktree

Run once per worktree:

```bash
pnpm run setup
```

This wraps `scripts/setup-worktree.sh`, which:

- Brings up the shared local Postgres container (`docker-compose.dev.yml`)
- Creates a worktree-specific database (`surevax_<worktree-slug>`) — isolation from sibling worktrees
- Computes a deterministic per-worktree port offset (sha1 of the worktree name → 0..99) so `pnpm dev` never collides between worktrees. Backend port = `3000 + offset`, frontend port = `5173 + offset`
- Writes `apps/backend/.env` (DATABASE_URL, PORT, secrets, CORS_ORIGIN) and `apps/frontend/.env.local` (VITE_DEV_PORT, VITE_API_PROXY_TARGET)
- Runs migrations + seed against the new DB

Re-run with `pnpm run setup --force` to regenerate the `.env` files (e.g. after rotating secrets). Without `--force` it refuses to overwrite an existing `apps/backend/.env`.

### Opting into the shared Railway dev DB

The local-docker setup is the default. To point a worktree at the shared Railway dev DB instead — useful for testing against staging-like data — write `apps/backend/.env` by hand using the values in `apps/backend/.env.example` and the Railway service variables (see the `railway-ops` skill for the full env-var list and CLI commands). The setup script will leave it alone unless you pass `--force`.

### Prerequisites

- Docker Desktop running (the script `docker compose up -d`s the Postgres container).
- `openssl` on PATH (used to generate per-worktree dev secrets).

### Agent worktrees

Orchestrate workers that run E2E already call `$PNPM setup` as step 1 of their
verification recipe. Workers that only typecheck/build (no curl smoke) can skip
Docker setup entirely and symlink the root worktree's env files instead:

```bash
ln -sf "$(git rev-parse --show-toplevel)/apps/backend/.env" apps/backend/.env
ln -sf "$(git rev-parse --show-toplevel)/apps/frontend/.env.local" apps/frontend/.env.local
```

Before smoke testing in any worktree, verify `apps/backend/.env` exists; fall
back to typecheck/build if it does not.

## pnpm PATH

`pnpm` may not be on `$PATH` in Bash tool sessions. Resolve it via `command -v pnpm`, falling back to the Homebrew symlink (verified 2026-06-12 — the old `/opt/homebrew/opt/node@22/bin/pnpm` path no longer exists):

```bash
PNPM=$(command -v pnpm || echo /opt/homebrew/bin/pnpm)
$PNPM --filter @surevax/frontend add <pkg>
```
