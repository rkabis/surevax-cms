#!/usr/bin/env bash
# SessionStart hook: guarantee node_modules exists in this worktree/checkout.
#
# Why: Claude Code creates a new worktree as a fresh checkout but never installs
# deps, so tsc/prettier/eslint aren't on PATH until you manually `pnpm install`.
# pnpm's store is global (hard-links), so install is ~5s the first time.
#
# Idempotent: instant no-op once deps are installed, so it's safe on every
# session start (startup/resume/clear). Only does real work on a never-installed
# worktree. Never blocks the session: always exits 0, even on failure.
#
# Deliberately runs `pnpm install` only, not `pnpm run setup` (which also spins up
# Docker + Postgres + migrations + seed). Full DB bootstrap stays manual; run
# `pnpm run setup` yourself when you actually need to run the app or E2E.
set -u

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -n "${ROOT}" ] || exit 0
[ -d "${ROOT}/node_modules" ] && exit 0 # already installed -> instant exit

# pnpm isn't reliably on PATH in hook shells -- resolve it explicitly.
PNPM="$(command -v pnpm 2>/dev/null || true)"
if [ -z "${PNPM}" ]; then
  [ -x /opt/homebrew/bin/pnpm ] && PNPM=/opt/homebrew/bin/pnpm
fi
[ -n "${PNPM}" ] || {
  echo "ensure-node-modules: pnpm not found on PATH; run 'pnpm install' manually" >&2
  exit 0
}

echo "ensure-node-modules: node_modules missing -- installing deps (one-time per worktree)..." >&2
(cd "${ROOT}" && "${PNPM}" install --frozen-lockfile) >&2 \
  || echo "ensure-node-modules: install failed -- run 'pnpm install' manually" >&2
exit 0
