#!/usr/bin/env bash
# Fast local readiness check for coding agents.
#
# This intentionally skips DB-backed tests because those require `pnpm run setup`
# and Docker. Use this before broader edits to confirm the repo has the
# instruction files and non-DB gates an agent needs.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

require_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "agent-ready: missing $path" >&2
    exit 1
  fi
}

require_file AGENTS.md
require_file apps/frontend/AGENTS.md
require_file CLAUDE.md
require_file package.json
require_file pnpm-lock.yaml

bash -n scripts/setup-worktree.sh
bash scripts/check-agent-doc-sync.sh
bash scripts/check-tailwind-tokens.sh
bash scripts/check-design-system.sh
bash scripts/check-bare-db-writes.sh
bash scripts/check-route-authz.sh
bash scripts/check-modeled-not-wired.sh
bash scripts/check-contract-drift.sh
pnpm format:check
pnpm lint
pnpm --recursive typecheck
pnpm --recursive build

echo "agent-ready: clean"
