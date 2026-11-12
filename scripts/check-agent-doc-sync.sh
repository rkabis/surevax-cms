#!/usr/bin/env bash
# Guard the Codex-facing AGENTS.md files against drifting away from the
# Claude-facing guidance that still carries the deeper project rules.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

require_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "agent-doc-sync: missing $path" >&2
    exit 1
  fi
}

require_term() {
  local path="$1"
  local term="$2"
  if ! grep -Fq "$term" "$path"; then
    echo "agent-doc-sync: $path is missing required term: $term" >&2
    exit 1
  fi
}

require_file AGENTS.md
require_file CLAUDE.md
require_file apps/frontend/AGENTS.md
require_file apps/frontend/CLAUDE.md

root_terms=(
  "docs/ai-context/_INDEX.md"
  "tenant_id"
  "RLS"
  "Zod"
  "FEFO"
  "display_id"
  "pnpm run setup"
)

frontend_terms=(
  "shadcn"
  "PageHeader"
  "PageToolbar"
  "TableCard"
  "KpiStrip"
  "DetailSheet"
  "text-["
)

for term in "${root_terms[@]}"; do
  require_term AGENTS.md "$term"
  require_term CLAUDE.md "$term"
done

for term in "${frontend_terms[@]}"; do
  require_term apps/frontend/AGENTS.md "$term"
  require_term apps/frontend/CLAUDE.md "$term"
done

echo "agent-doc-sync: clean"
