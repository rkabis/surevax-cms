#!/usr/bin/env bash
# pr-format-gate.sh — PreToolUse hook for Bash.
# Blocks `gh pr create` and `git push` when prettier or lint would fail CI.
# Workers that skip the format-write step in their tail will hit this gate.
#
# Reads the tool input from stdin (Claude Code passes it as JSON on stdin).
# Exits 0 to allow, exits 2 with stderr message to block (Claude Code respects).
set -u

# Read JSON input from stdin
input=$(cat)

# Extract the command being run
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null || echo "")

# Only gate on pr-create or branch-push to a claude/ ref
if ! echo "$cmd" | grep -qE 'gh pr create|git push.*claude/'; then
  exit 0
fi

# Find repo root (works in worktrees + agent worktrees).
# Strategy: prettier (and shared node_modules) lives ONLY in the main repo
# checkout. Agent worktrees and feature worktrees don't have their own
# node_modules — we need to discover the main checkout and run from there.
repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0

# Resolve main-repo root via git common dir. For a regular worktree this
# returns `<repo>/.git/worktrees/<name>` and we want `<repo>`. For the main
# checkout it returns `<repo>/.git` which is also <repo>'s parent.
common_dir=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
main_root=""
if [ -n "$common_dir" ]; then
  # Walk up from common_dir looking for a node_modules
  candidate="$common_dir"
  for _ in 1 2 3 4 5; do
    candidate=$(dirname "$candidate")
    if [ -x "$candidate/node_modules/.bin/prettier" ]; then
      main_root="$candidate"
      break
    fi
  done
fi

# Pick the directory we'll cd into: prefer the main_root if it has node_modules
if [ -n "$main_root" ]; then
  cd "$main_root" || exit 0
else
  cd "$repo_root" || exit 0
fi

# Resolve a usable prettier binary. Order:
#  1. Local node_modules (cwd after the cd above)
#  2. pnpm via PATH (with /opt/homebrew/bin/pnpm fallback for hooks that
#     don't inherit a login shell PATH)
#  3. Skip — don't false-block when the formatter isn't reachable. The
#     worker's tail step is supposed to run prettier; if the hook can't
#     even find a formatter, that's an environment issue, not a content gate.
PRETTIER_CMD=""
if [ -x "./node_modules/.bin/prettier" ]; then
  PRETTIER_CMD="./node_modules/.bin/prettier"
elif command -v pnpm >/dev/null 2>&1 && pnpm prettier --version >/dev/null 2>&1; then
  PRETTIER_CMD="pnpm prettier"
elif [ -x "/opt/homebrew/bin/pnpm" ] && \
     /opt/homebrew/bin/pnpm prettier --version >/dev/null 2>&1; then
  PRETTIER_CMD="/opt/homebrew/bin/pnpm prettier"
else
  echo "[pr-format-gate] no prettier binary reachable (cwd=$(pwd)) — skipping format check" >&2
  exit 0
fi

# Run format check
fmt_out=$($PRETTIER_CMD --check . 2>&1)
fmt_exit=$?

if [ $fmt_exit -ne 0 ]; then
  echo "BLOCK: prettier --check failed. Run \`pnpm prettier --write .\` then retry." >&2
  echo "Drift detected in:" >&2
  echo "$fmt_out" | grep -E '^\[warn\]' | head -10 >&2
  exit 2
fi

# Run lint check (best-effort — don't block if pnpm/lint script unavailable)
PNPM_BIN=""
if command -v pnpm >/dev/null 2>&1; then
  PNPM_BIN="pnpm"
elif [ -x "/opt/homebrew/bin/pnpm" ]; then
  PNPM_BIN="/opt/homebrew/bin/pnpm"
fi
if [ -n "$PNPM_BIN" ] && $PNPM_BIN run 2>/dev/null | grep -q "  lint"; then
  lint_out=$($PNPM_BIN lint 2>&1)
  lint_exit=$?
  if [ $lint_exit -ne 0 ]; then
    # Skip-with-warning when ESLint trips on multiple tsconfig roots (sibling
    # worktrees under .claude/worktrees/* trigger this on the main checkout).
    # The CI environment has only one root and isn't affected.
    if echo "$lint_out" | grep -q "multiple candidate TSConfigRootDirs"; then
      echo "[pr-format-gate] eslint hit multi-tsconfig-root drift from sibling worktrees — skipping lint gate (CI will catch real issues)" >&2
      exit 0
    fi
    echo "BLOCK: pnpm lint failed. Fix lint errors then retry." >&2
    echo "$lint_out" | tail -20 >&2
    exit 2
  fi
fi

exit 0
