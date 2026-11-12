#!/usr/bin/env bash
# Claude Code PostToolUse hook for Edit/Write — runs prettier (and eslint
# for code files) on the file that was just edited. Silent on success;
# fails are non-fatal so the agent's flow isn't blocked by tooling hiccups.
#
# Wired up in .claude/settings.json.
#
# Worktree-aware: agent worktrees (created by `Agent isolation: "worktree"`)
# share `.git` with the main repo but do NOT have their own `node_modules`.
# `pnpm exec prettier` from inside an agent worktree silently fails (no local
# install). To make this hook actually fire in agent contexts, walk up via
# `git --git-common-dir` to find the main checkout's `node_modules/.bin/prettier`.
#
# Lesson encoded after 2026-05-09 review batch: 6 of 10 PRs needed prettier
# follow-ups because this hook was no-op'ing in worker contexts. CI runs
# `prettier --check .` first and exits before typecheck — so silent drift =
# guaranteed CI red.

set -uo pipefail

input="$(cat)"
file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"

# No file path or file doesn't exist (e.g. just deleted) → nothing to do.
[[ -z "$file_path" ]] && exit 0
[[ ! -f "$file_path" ]] && exit 0

# Resolve a prettier binary that actually works from the current cwd.
#   1. Local ./node_modules (main checkout case)
#   2. Walk up from `git --git-common-dir` to find the main checkout's
#      node_modules (agent/feature worktree case)
#   3. pnpm via PATH (or /opt/homebrew/bin/pnpm fallback) as last resort
PRETTIER=""
ESLINT=""

if [[ -x "./node_modules/.bin/prettier" ]]; then
  PRETTIER="./node_modules/.bin/prettier"
  [[ -x "./node_modules/.bin/eslint" ]] && ESLINT="./node_modules/.bin/eslint"
fi

if [[ -z "$PRETTIER" ]]; then
  common_dir=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
  if [[ -n "$common_dir" ]]; then
    candidate="$common_dir"
    for _ in 1 2 3 4 5; do
      candidate=$(dirname "$candidate")
      if [[ -x "$candidate/node_modules/.bin/prettier" ]]; then
        PRETTIER="$candidate/node_modules/.bin/prettier"
        [[ -x "$candidate/node_modules/.bin/eslint" ]] && ESLINT="$candidate/node_modules/.bin/eslint"
        break
      fi
    done
  fi
fi

if [[ -z "$PRETTIER" ]]; then
  PNPM="${PNPM:-pnpm}"
  if ! command -v "$PNPM" >/dev/null 2>&1; then
    if [[ -x /opt/homebrew/bin/pnpm ]]; then
      PNPM=/opt/homebrew/bin/pnpm
    else
      exit 0
    fi
  fi
  PRETTIER="$PNPM exec prettier"
  ESLINT="$PNPM exec eslint"
fi

case "$file_path" in
  *.ts|*.tsx|*.js|*.mjs|*.cjs|*.json|*.md|*.yml|*.yaml)
    $PRETTIER --write --log-level=warn "$file_path" >/dev/null 2>&1 || true
    ;;
esac

if [[ -n "$ESLINT" ]]; then
  case "$file_path" in
    *.ts|*.tsx|*.js|*.mjs|*.cjs)
      $ESLINT --fix "$file_path" >/dev/null 2>&1 || true
      ;;
  esac
fi

exit 0
