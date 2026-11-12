#!/usr/bin/env bash
# Prevention gate — bug class: "authorization at the wrong layer" (audit SEC-3/4/5).
#
# Every router mounted under /api/admin/* (and /api/audit) MUST carry a
# requireRole(...) guard on the mount, or any authenticated user — Cashier,
# Nurse — reaches admin/audit endpoints. This is non-negotiable rule + the
# canonical convention in .claude/rules/gotchas.md ("Admin routes require
# requireRole") and patterns.md ("Admin authorization").
#
# Real incident: SEC-3 shipped `/api/audit` with NO guard; any role read the
# tenant-wide audit log. Caught by an Opus audit, not by CI. This gate makes
# that class a hard fail at `pnpm agent:check` + CI.
#
# Scope: whole-file (not diff-scoped) — an authz regression anywhere in the
# mount table is a security bug, cheap to check (one file).
#
# Invoked from `pnpm agent:check` (scripts/check-agent-ready.sh).

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

APP_TS="apps/backend/src/app.ts"
[[ -f "$APP_TS" ]] || { echo "check-route-authz: $APP_TS not found" >&2; exit 1; }

# Documented exceptions — a sensitive mount that is guarded by a non-requireRole
# mechanism. Add the full mount path + a `# why` if you ever introduce one.
# Format: one mount-path prefix per line.
ALLOWLIST=()

OFFENDERS=""
# Candidate lines: app.use('/api/admin...  OR  app.use('/api/audit...
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  lineno="${line%%:*}"
  text="${line#*:}"

  # Extract the mounted path (single- or double-quoted first arg of app.use).
  mount=$(printf '%s' "$text" | sed -nE "s/.*app\.use\((['\"])([^'\"]+)\1.*/\2/p")

  # Allowlisted?
  skip=false
  for allowed in "${ALLOWLIST[@]:-}"; do
    [[ -n "$allowed" && "$mount" == "$allowed"* ]] && skip=true && break
  done
  $skip && continue

  # Compliant if the mount statement carries requireRole(.
  if ! printf '%s' "$text" | grep -q 'requireRole('; then
    OFFENDERS+=$'\n'"  $APP_TS:$lineno  → $mount"
  fi
done < <(grep -nE "app\.use\((['\"])/api/(admin|audit)" "$APP_TS" || true)

if [[ -n "$OFFENDERS" ]]; then
  cat >&2 <<EOF
✗ Admin/audit route mounted without requireRole(...):
$OFFENDERS

  Every /api/admin/* and /api/audit router must mount with a requireRole(...)
  guard — otherwise any authenticated user (Cashier, Nurse) reaches it.
  See .claude/rules/gotchas.md "Admin routes require requireRole".
  Fix: app.use('/api/admin/x', requireRole('TenantAdmin','BranchAdmin'), xRouter)
EOF
  exit 1
fi

exit 0
