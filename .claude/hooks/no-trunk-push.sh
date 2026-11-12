#!/usr/bin/env bash
# PreToolUse hook — block direct pushes to trunk branches from worker worktrees.
#
# Workers must push to their own worktree-agent-* branch only. Pushing directly
# to a *-trunk branch (e.g. claude/id-redesign-trunk) from a worker worktree
# produced a closed-dup PR (#380) and wasted ~268k tokens (see MEMORY.md).
#
# Blocks when ALL of:
#   1. tool is Bash
#   2. command contains "git push" targeting a *-trunk ref
#   3. current working directory is inside .claude/worktrees/
#
# Hook contract: reads JSON event on stdin, exits 0 to allow, 2 to block.

set -u

block() { printf 'no-trunk-push BLOCK: %s\n' "$1" >&2; exit 2; }

event="$(cat 2>/dev/null || true)"
[[ -z "$event" ]] && exit 0
command -v jq >/dev/null 2>&1 || exit 0

tool="$(printf '%s' "$event" | jq -r '.tool_name // empty' 2>/dev/null)"
[[ "$tool" != "Bash" ]] && exit 0

cmd="$(printf '%s' "$event" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[[ -z "$cmd" ]] && exit 0

# Only care about git push commands that mention a trunk branch.
if ! printf '%s' "$cmd" | grep -Eq '(^|[[:space:]])git\s+push\b'; then
  exit 0
fi
if ! printf '%s' "$cmd" | grep -Eq '\-trunk\b'; then
  exit 0
fi

# Only block when we are inside a worker worktree directory.
cwd="$(pwd)"
if printf '%s' "$cwd" | grep -q '/\.claude/worktrees/'; then
  block "Refusing to push to a *-trunk branch from a worker worktree ($cwd).
Workers must push to their own branch (worktree-agent-*) and open a PR.
The coordinator merges to trunk; workers do not push to trunk directly."
fi

exit 0
