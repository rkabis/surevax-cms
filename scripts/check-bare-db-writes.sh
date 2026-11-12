#!/usr/bin/env bash
# AUTH-2 lockdown: block new bare `db.(select|insert|update|delete|execute|transaction)`
# calls in changed backend files. Under FORCE ROW LEVEL SECURITY (the app connects as
# the non-BYPASSRLS `surevax_app` role), bare reads return zero rows as silently as bare
# writes — both MUST go through withTenantTx / withPlatformTx / withSystemTx so the
# audit trigger GUCs (app.current_tenant_id etc.) are set and RLS filters apply.
#
# Invoked from `pnpm agent:check`. Local pre-PR gate; CI also runs it on
# pull_request via `.github/workflows/ci.yml`.
#
# Allowlist: seed/db.ts and migrate.ts intentionally bypass the helpers
# (bootstrap path, runs as the migrator role with BYPASSRLS).

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Compare against origin/main when available, fall back to HEAD~1 locally.
BASE_REF="${BASE_REF:-origin/main}"
if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  BASE_REF="HEAD~1"
fi

CHANGED=$(git diff --name-only "$BASE_REF"...HEAD -- 'apps/backend/src/modules/**' 'apps/backend/src/workers/**' 'apps/backend/src/shared/**' 2>/dev/null || true)
[[ -z "$CHANGED" ]] && exit 0

OFFENDERS=""
for f in $CHANGED; do
  [[ -f "$f" ]] || continue
  # Skip the canonical helpers themselves and the bootstrap files.
  case "$f" in
    apps/backend/src/shared/db/withTenantTx.ts) continue ;;
    apps/backend/src/shared/db/seed*) continue ;;
    apps/backend/src/shared/db/migrate.ts) continue ;;
    apps/backend/src/shared/db/index.ts) continue ;;
  esac
  # Match bare db. calls (reads AND writes). All must go through a tx helper.
  #
  # Two classes of false positive are filtered out, because otherwise ANY edit
  # to a file that merely MENTIONS the pattern fails the gate and the fix is to
  # reword prose (which teaches nothing) instead of to wrap a call:
  #   1. Comment lines — `// … runs inside an open db.transaction()` and the
  #      docblocks that tell callers to do exactly the right thing.
  #   2. `typeof db.transaction` — the codebase-wide idiom for deriving the
  #      Drizzle tx type (`type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]`),
  #      a type-position reference that emits no runtime call.
  matches=$(grep -nE '\bdb\.(select|insert|update|delete|execute|transaction)\b' "$f" 2>/dev/null |
    grep -vE '^[0-9]+:[[:space:]]*(//|\*|/\*)' |
    grep -vE '\btypeof[[:space:]]+db\.transaction\b' || true)
  [[ -z "$matches" ]] && continue
  OFFENDERS+=$'\n'"$f:"$'\n'"$matches"
done

if [[ -n "$OFFENDERS" ]]; then
  cat >&2 <<EOF
✗ Bare db.(select|insert|update|delete|execute|transaction) calls detected in changed files.

  Wrap ALL db access in withTenantTx / withPlatformTx / withSystemTx.
  Under FORCE RLS, bare reads return zero rows; bare writes skip audit GUCs.
  See .claude/rules/patterns.md "Reads need the GUC too" + AUTH-2 handover.
$OFFENDERS
EOF
  exit 1
fi

exit 0
