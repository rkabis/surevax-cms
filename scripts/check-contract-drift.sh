#!/usr/bin/env bash
# Contract-codegen drift gate — regenerates apps/frontend/src/api/contracts
# from the backend contract registry and fails if the checked-in output is
# stale (or hand-edited). See docs/specs/api-contract-codegen.md.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

GEN_DIR="apps/frontend/src/api/contracts"

pnpm --filter @surevax/backend gen:contracts >/dev/null

if ! git diff --quiet -- "$GEN_DIR"; then
  git --no-pager diff --stat -- "$GEN_DIR" >&2
  echo "contract-drift: generated contracts are stale — run 'pnpm gen:contracts' and commit the result" >&2
  exit 1
fi

UNTRACKED="$(git ls-files --others --exclude-standard -- "$GEN_DIR")"
if [[ -n "$UNTRACKED" ]]; then
  echo "$UNTRACKED" >&2
  echo "contract-drift: new generated contract files are uncommitted — run 'pnpm gen:contracts' and commit the result" >&2
  exit 1
fi

echo "contract-drift: clean"
