#!/usr/bin/env bash
# Layer 3 of the doc-drift defense.
#
# Reports staleness of documented surface areas given the current worktree's
# diff vs main. Consumed by the /ship skill — see .claude/skills/ship/SKILL.md.
#
# Usage:   scripts/check-doc-surface.sh
# Output:  one TSV line per stale surface:
#            <surface name>\t<doc path>\t<example changed file>
#          empty output = no stale surfaces.
# Exit:    0 always. The consumer decides whether to block.
#
# Note: this is a heuristic, not a proof. False positives are easy to "skip
# and ship" past in the /ship prompt; false negatives are silent. Tune the
# patterns below as the codebase evolves — see the `parallel-work` skill for
# the per-batch checklist this complements.

set -euo pipefail

# All changes in this branch vs main: committed + staged + unstaged.
# `git diff --name-only` will show nothing if the worktree is clean and all
# changes are already committed; that's fine — the merge-base diff covers it.
CHANGED=$(
  {
    git diff --name-only main..HEAD 2>/dev/null || true
    git diff --name-only            2>/dev/null || true
    git diff --cached --name-only   2>/dev/null || true
  } | sort -u
)

if [[ -z "$CHANGED" ]]; then
  exit 0
fi

# Emit one TSV line per stale surface.
# Args: <code pattern (extended regex)> <doc path> <human surface name>
check() {
  local code_pattern="$1"
  local doc_path="$2"
  local surface="$3"

  local matches
  matches=$(printf '%s\n' "$CHANGED" | grep -E "$code_pattern" || true)
  if [[ -z "$matches" ]]; then return; fi

  # If the doc itself is also in the changed set, treat the surface as
  # documented for this PR.
  if printf '%s\n' "$CHANGED" | grep -qFx "$doc_path"; then return; fi

  # First matching file becomes the example shown to the user.
  local example
  example=$(printf '%s\n' "$matches" | head -1)
  printf '%s\t%s\t%s\n' "$surface" "$doc_path" "$example"
}

# ── Surface map ──────────────────────────────────────────────────────────────
# Order is presentation order in the /ship prompt — most-impactful first.

check '^apps/backend/src/modules/[^/]+/routes\.ts$' \
      'docs/ai-context/02-BACKEND-API.md' \
      'Backend API surface (route added/removed/changed)'

check '^apps/backend/src/shared/db/schema\.ts$' \
      'docs/ai-context/01-DATA-AND-COMPLIANCE.md' \
      'Data model (schema column/table changed)'

check '^apps/backend/src/shared/db/migrations/|^apps/backend/src/shared/db/seed\.ts$' \
      'docs/ai-context/01-DATA-AND-COMPLIANCE.md' \
      'Migrations / seed data'

check '^apps/backend/src/shared/middleware/' \
      'docs/ai-context/02-BACKEND-API.md' \
      'Backend middleware (order / auth / CSRF / RLS)'

check '^apps/frontend/src/features/[^/]+/' \
      'docs/ai-context/03-FRONTEND-UI-UX.md' \
      'Frontend feature (new/changed page or component surface)'

check '^apps/frontend/src/(App|router)\.tsx$|^apps/frontend/src/shared/components/AppShell\.tsx$' \
      'docs/ai-context/03-FRONTEND-UI-UX.md' \
      'Frontend routing / AppShell nav'

check '^railpack\.json$|^railway\.toml$|^docker-compose|^scripts/setup-worktree\.sh$|^\.github/workflows/' \
      'docs/ai-context/04-INFRASTRUCTURE-DEPLOYMENT.md' \
      'Infrastructure / deployment / CI'

check '^apps/backend/src/shared/config/env\.ts$|^apps/backend/\.env\.example$' \
      'docs/ENVIRONMENTS.md' \
      'Environment posture (env vars, dev→prod transition)'

# Workflow surface — clinical flow narrative changes.
check '^apps/backend/src/modules/(encounters|standing_orders|patient_standing_orders|clinical_orders|recall|transactions|patients)/' \
      'docs/ai-context/06-PRODUCT-WORKFLOWS.md' \
      'Clinical workflow (intake → orders → recall → billing)'
